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

  async getMessages(currentUserId, targetUserId) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readonly');
      const store = tx.objectStore('messages');
      const request = store.getAll();

      request.onsuccess = () => {
        const all = request.result || [];
        const filtered = all.filter(m => {
          const sId = String(m.senderId || m.sender_id);
          const rId = String(m.receiverId || m.receiver_id);
          const cId = String(currentUserId);
          const tId = String(targetUserId);
          return (sId === cId && rId === tId) || (sId === tId && rId === cId);
        });
        filtered.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        resolve(filtered);
      };
      request.onerror = (e) => reject(e.target.error);
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
}

// Global Singleton Instance
window.digiStore = new DigiStore();
