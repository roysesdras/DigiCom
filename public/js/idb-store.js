/**
 * DigiCom - IndexedDB Offline Storage & Sync Engine
 * Sovereign Client-Side Persistent Store
 */

class DigiStore {
  constructor() {
    this.dbName = 'digicom_offline_db';
    this.dbVersion = 1;
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Store: contacts
        if (!db.objectStoreNames.contains('contacts')) {
          db.createObjectStore('contacts', { keyPath: 'id' });
        }

        // Store: messages
        if (!db.objectStoreNames.contains('messages')) {
          const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
          msgStore.createIndex('senderId', 'senderId', { unique: false });
          msgStore.createIndex('receiverId', 'receiverId', { unique: false });
          msgStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Store: outbox (pending messages sent while offline)
        if (!db.objectStoreNames.contains('outbox')) {
          db.createObjectStore('outbox', { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        console.log('[+] DigiStore IndexedDB initialized successfully.');
        resolve(this.db);
        this.scheduleBackgroundPrune();
      };

      request.onerror = (event) => {
        console.error('[-] DigiStore IndexedDB error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  // --- CONTACTS METHODS ---
  async saveContacts(contactsList) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('contacts', 'readwrite');
      const store = tx.objectStore('contacts');
      contactsList.forEach(contact => {
        store.put(contact);
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async getContacts() {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('contacts', 'readonly');
      const store = tx.objectStore('contacts');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  // --- MESSAGES METHODS ---
  async saveMessage(msg) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      store.put(msg);
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async saveMessagesBatch(messages) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      messages.forEach(msg => store.put(msg));
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async getMessage(id) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readonly');
      const store = tx.objectStore('messages');
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async updateMessageContent(id, newContent, isEdited = 1, editedAt = null) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      const request = store.get(id);
      request.onsuccess = () => {
        const msg = request.result;
        if (msg) {
          if (typeof msg.content === 'object' && msg.content !== null) {
            msg.content.text = newContent;
          } else {
            msg.content = { type: 'text', text: newContent };
          }
          msg.is_edited = isEdited;
          msg.isEdited = isEdited;
          if (editedAt) msg.edited_at = editedAt;
          store.put(msg);
        }
        resolve(true);
      };
      request.onerror = (e) => reject(e.target.error);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async deleteMessage(id) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      store.delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async getMessages(currentUserId, targetUserId, limit = 50, beforeTimestamp = null) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readonly');
      const store = tx.objectStore('messages');
      const index = store.index('timestamp');
      const cId = String(currentUserId);
      const tId = String(targetUserId);

      let keyRange = null;
      if (beforeTimestamp) {
        keyRange = IDBKeyRange.upperBound(beforeTimestamp, true);
      }

      const results = [];
      const cursorRequest = index.openCursor(keyRange, 'prev');

      cursorRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && results.length < limit) {
          const m = cursor.value;
          const sId = String(m.senderId || m.sender_id || '');
          const rId = String(m.receiverId || m.receiver_id || '');
          if ((sId === cId && rId === tId) || (sId === tId && rId === cId)) {
            results.push(m);
          }
          cursor.continue();
        } else {
          // Sort ascending chronologically
          results.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
          resolve(results);
        }
      };

      cursorRequest.onerror = (e) => reject(e.target.error);
    });
  }

  // --- OUTBOX METHODS (OFFLINE QUEUE) ---
  async addToOutbox(msgPayload) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('outbox', 'readwrite');
      const store = tx.objectStore('outbox');
      store.put(msgPayload);
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async getOutbox() {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('outbox', 'readonly');
      const store = tx.objectStore('outbox');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async removeFromOutbox(id) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('outbox', 'readwrite');
      const store = tx.objectStore('outbox');
      store.delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async pruneOldMessages(maxTotalMessages = 100) {
    if (!this.db) await this.init();
    try {
      const tx = this.db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      const countReq = store.count();
      const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();

      countReq.onsuccess = () => {
        const index = store.index('timestamp');
        const cursorReq = index.openCursor(); // Ascending (oldest first)
        let deleted = 0;
        const total = countReq.result || 0;
        const toKeep = maxTotalMessages;

        cursorReq.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const m = cursor.value;
            const isOld = m.timestamp && m.timestamp < fifteenDaysAgo;
            const isExcess = (total - deleted) > toKeep;

            if (isOld || isExcess) {
              cursor.delete();
              deleted++;
              cursor.continue();
            }
          }
        };
      };
    } catch (e) {
      console.warn('[-] DigiStore prune warning:', e);
    }
  }

  scheduleBackgroundPrune() {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => this.pruneOldMessages(100), { timeout: 5000 });
    } else {
      setTimeout(() => this.pruneOldMessages(100), 3000);
    }
  }

  async clearAllStores() {
    if (!this.db) {
      try { await this.init(); } catch (e) {}
    }
    if (!this.db) return false;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(['contacts', 'messages', 'outbox'], 'readwrite');
        tx.objectStore('contacts').clear();
        tx.objectStore('messages').clear();
        tx.objectStore('outbox').clear();
        tx.oncomplete = () => {
          console.log('[+] DigiStore cleared successfully on logout.');
          resolve(true);
        };
        tx.onerror = () => resolve(false);
      } catch (e) {
        console.warn('[-] Error clearing DigiStore:', e);
        resolve(false);
      }
    });
  }
}

// Global Singleton Instance
window.digiStore = new DigiStore();
