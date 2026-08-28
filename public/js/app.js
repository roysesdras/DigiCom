/**
 * DigiCom - Direct 1-to-1 Sovereign Messaging & Support Engine
 * Modern Bento Glassmorphic Controller
 * With Client-Side Compressed Attachments (Images, PDF, Files, Voice Notes, Clickable Links)
 */

let state = {
  user: null,
  socket: null,
  pushClient: null,
  activeTab: 'contacts', // 'contacts' | 'support'
  activeContact: null,   // { id, username, displayName, role }
  activeSupportSession: null, // targetUserId for support replies
  contacts: [],
  salons: [],
  activeSalon: null,     // { id, name, description, icon, created_by, my_role }
  unreadCounts: {},      // contactId -> unread count
  unreadSalonCounts: {}, // salonId -> unread count
  directMessages: {},    // contactId -> array of messages
  salonMessages: {},     // salonId -> array of messages
  supportMessages: {},   // senderId -> array of messages
  activeSalonMembers: [], // active salon members for @mentions
  currentMentionList: [], // filtered members list in popover
  mentionSelectedIndex: 0,
  currentMentionAtIndex: -1,
  onlineUserIds: [],
  supportConversations: [],
  replyingTo: null,      // { id, senderName, previewText, type }
  editingMessage: null,  // { id, text }
  processedMsgIds: new Set()
};

window.state = state;

// Voice recording state
let voiceRecorder = {
  mediaRecorder: null,
  audioChunks: [],
  startTime: null,
  timerInterval: null,
  stream: null,
  isRecording: false
};

// ---------------- EMOJIS & STICKERS DATA ----------------
const EMOJI_CATEGORIES = [
  {
    name: 'Fréquents',
    emojis: ['😀', '😂', '😊', '👍', '❤️', '🙏', '🔥', '🎉', '🚀', '👌', '👏', '😍', '🤔', '💯']
  },
  {
    name: 'Smileys & Visages',
    emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😋', '😜', '😎', '🤩', '🥳', '😏', '😒', '😔', '😟', '😕', '🙁', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '👽', '👾', '🤖']
  },
  {
    name: 'Mains & Gestes',
    emojis: ['👋', '🤚', '🖐', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪']
  },
  {
    name: 'Cœurs & Symboles',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '🔥', '✨', '🌟', '💫', '💥', '⚡', '🎯', '🏆', '👑', '💎', '💡', '📌', '📈', '✅', '❌', '⚠️', 'ℹ️', '🔔']
  }
];

const STICKERS = [
  '👍 Validé !', '🎉 Félicitations !', '🙏 Merci !', '🔥 Incroyable !',
  '💪 Force à vous !', '❤️ Merci beaucoup !', '👋 Bonjour !', '👌 C\'est noté !',
  '🚀 C\'est parti !', '⭐ Parfait !', '😊 Avec plaisir !', '🤝 D\'accord !'
];

document.addEventListener('DOMContentLoaded', async () => {
  if (window.digiStore) {
    await window.digiStore.init().catch(err => console.warn('DigiStore init error:', err));
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'FLUSH_OUTBOX') {
        flushOutbox();
      }
    });
  }

  window.addEventListener('online', () => {
    console.log('[+] Connection restored. Flushing outbox...');
    flushOutbox();
  });

  state.pushClient = new DigiPushClient();
  state.pushClient.init();

  setupEventListeners();
  await checkAuthAndInit();
});

function hideMentionsPopover() {
  const popover = document.getElementById('mentions-popover');
  if (popover) popover.style.display = 'none';
  state.currentMentionList = [];
  state.mentionSelectedIndex = 0;
}
window.hideMentionsPopover = hideMentionsPopover;

async function authFetch(url, options = {}) {
  const token = localStorage.getItem('digicom_token');
  const headers = { ...(options.headers || {}) };
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include'
  });
  if ((res.status === 401 || res.status === 403) && url !== '/api/login' && url !== '/api/setup') {
    if (token) {
      console.warn('[!] Session token invalid or expired. Prompting login.');
      localStorage.removeItem('digicom_token');
      localStorage.removeItem('digicom_user');
      state.user = null;
      showModal('login-modal');
    }
  }
  return res;
}

async function checkAuthAndInit() {
  const cachedUserStr = localStorage.getItem('digicom_user');

  // Instant restoration: immediately render app interface with 0ms latency!
  if (cachedUserStr) {
    try {
      state.user = JSON.parse(cachedUserStr);
      hideModals();
      initAppInterface();
    } catch (e) {}
  }

  try {
    const meRes = await authFetch('/api/me');
    if (meRes.ok) {
      const data = await meRes.json();
      state.user = data.user;
      if (data.token) {
        localStorage.setItem('digicom_token', data.token);
      }
      localStorage.setItem('digicom_user', JSON.stringify(data.user));
      hideModals();
      if (!state.contacts || state.contacts.length === 0) {
        initAppInterface();
      }
    } else {
      localStorage.removeItem('digicom_user');
      localStorage.removeItem('digicom_token');
      showModal('login-modal');
    }
  } catch (err) {
    console.error('[-] Initialization check error:', err);
    if (!state.user) {
      showModal('login-modal');
    }
  }
}

function initAppInterface() {
  const username = state.user.displayName || state.user.username;
  const usernameEl = document.getElementById('current-username');
  if (usernameEl) usernameEl.textContent = username;

  const roleEl = document.getElementById('user-role-badge');
  if (roleEl) roleEl.textContent = state.user.role === 'admin' ? 'Admin' : 'Membre';

  if (state.user.role === 'admin') {
    document.getElementById('tab-btn-support').style.display = 'flex';
    document.getElementById('btn-admin-manage').style.display = 'flex';
    const chatAdmin = document.getElementById('chat-header-admin-actions');
    if (chatAdmin) chatAdmin.style.display = 'flex';
  } else {
    document.getElementById('tab-btn-support').style.display = 'none';
    document.getElementById('btn-admin-manage').style.display = 'none';
    const chatAdmin = document.getElementById('chat-header-admin-actions');
    if (chatAdmin) chatAdmin.style.display = 'none';
  }

  // Auto-activate & Auto-heal push subscription if permission already granted
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const pushBtn = document.getElementById('btn-push-toggle');
    if (pushBtn) pushBtn.classList.add('active');
    if (state.pushClient) {
      state.pushClient.autoSync(state.user.id).catch(() => {});
    }
  }

  // Initialize Socket.io
  initSocket();

  // Load Contacts List
  loadContacts();

  // Load Salons List
  loadSalons();

  if (state.user.role === 'admin') {
    loadSupportConversations();
  }
}

function initSocket() {
  if (typeof io === 'undefined') {
    console.warn('[!] Socket.io library not available offline. Operating in local store mode.');
    return;
  }
  state.socket = io({
    transports: ['websocket', 'polling'],
    upgrade: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 10
  });

  window.socket = state.socket;

  state.socket.on('connect', () => {
    console.log('[+] Socket connected:', state.socket.id);
    state.socket.emit('authenticate', state.user);
    if (state.activeContact && state.activeTab === 'contacts' && !document.hidden && document.visibilityState === 'visible') {
      state.socket.emit('enter_active_chat', { partnerId: state.activeContact.id });
      state.socket.emit('mark_read', { senderId: state.activeContact.id });
    }
    if (state.activeSalon && state.activeTab === 'salons') {
      state.socket.emit('join_salon', state.activeSalon.id);
    }
    if (state.salons && state.salons.length > 0) {
      state.salons.forEach(s => state.socket.emit('join_salon', s.id));
    }
    if (window.bindSocketWebRTC) {
      window.bindSocketWebRTC(state.socket);
    }
    flushOutbox();
  });

  state.socket.on('presence_update', (data) => {
    state.onlineUserIds = data.onlineUserIds || [];
    renderContactsList();
    updateActiveContactStatus();
  });

  // Direct 1-to-1 Message Received
  state.socket.on('private_message', (msg) => {
    const otherPartyId = msg.senderId === state.user.id ? msg.receiverId : msg.senderId;

    if (msg.id) {
      if (state.processedMsgIds.has(msg.id)) return;
      state.processedMsgIds.add(msg.id);
      if (state.processedMsgIds.size > 500) {
        const first = state.processedMsgIds.values().next().value;
        state.processedMsgIds.delete(first);
      }
    }

    if (!state.directMessages[otherPartyId]) {
      state.directMessages[otherPartyId] = [];
    }

    if (window.digiStore) {
      window.digiStore.saveMessage(msg).catch(() => {});
    }

    // Ignore socket echo for sender (already rendered locally)
    if (msg.senderId === state.user.id) {
      return;
    }

    state.directMessages[otherPartyId].push(msg);

    const isChatVisibleToUser = Boolean(
      state.activeTab === 'contacts' &&
      state.activeContact &&
      String(state.activeContact.id) === String(otherPartyId) &&
      !document.hidden &&
      document.visibilityState === 'visible'
    );

    if (!isChatVisibleToUser) {
      // User is in background, locked screen, on another app (WhatsApp/YouTube) or on another contact -> DO NOT mark as read!
      const cBadge = document.getElementById('contacts-badge');
      if (cBadge) {
        const count = parseInt(cBadge.textContent || '0', 10) + 1;
        cBadge.textContent = count > 99 ? '99+' : count;
        cBadge.style.display = 'inline-block';
      }

      state.unreadCounts[otherPartyId] = (state.unreadCounts[otherPartyId] || 0) + 1;
      renderContactsList();

      let textSnippet = typeof msg.content === 'object' ? (msg.content.text || 'Nouveau fichier') : msg.content;
      if (typeof textSnippet === 'string' && (textSnippet.startsWith('{') || textSnippet.startsWith('&quot;{'))) {
        try {
          const inner = JSON.parse(textSnippet.replace(/&quot;/g, '"'));
          textSnippet = inner.text || 'Nouveau message';
        } catch(e) {}
      }

      // If page is visible (user is in Digicom but in Salons/Support tab), show in-app toast
      if (!document.hidden) {
        showInAppToast({
          title: msg.senderName || 'Discussion',
          body: textSnippet,
          type: 'private',
          senderId: otherPartyId
        });
        playNotificationSound();
      }

      // If this contact was previously selected, append silently to feed without marking as read
      if (state.activeContact && String(state.activeContact.id) === String(otherPartyId)) {
        appendMessageToFeed(msg, false, false);
      }
    } else {
      // User is actively staring at this conversation right now!
      if (state.socket) {
        state.socket.emit('mark_read', { senderId: otherPartyId });
      }

      // Append incoming message in active conversation and auto-scroll to bottom
      appendMessageToFeed(msg, false, true);
      scrollToBottom(false);
      requestAnimationFrame(() => scrollToBottom(false));
      setTimeout(() => scrollToBottom(true), 80);
    }
  });

  // Real-time Read Receipts (Eye Icon Updates to Orange)
  state.socket.on('messages_read_by_recipient', (data) => {
    if (state.activeContact && String(state.activeContact.id) === String(data.readerId)) {
      const unreadEyes = document.querySelectorAll('.msg-status-eye.unread');
      unreadEyes.forEach(eye => {
        eye.className = 'msg-status-eye read';
        eye.title = 'Message lu';
        eye.innerHTML = `
          <svg width="14" height="10" viewBox="0 0 16 12" fill="none">
            <path d="M8 1.5C4.5 1.5 1.5 6 1.5 6C1.5 6 4.5 10.5 8 10.5C11.5 10.5 14.5 6 14.5 6C14.5 6 11.5 1.5 8 1.5Z" stroke="#f97316" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="8" cy="6" r="2.2" fill="#f97316"/>
          </svg>
        `;
      });

      if (state.directMessages[data.readerId]) {
        state.directMessages[data.readerId].forEach(m => {
          if (m.senderId === state.user.id || m.sender_id === state.user.id) {
            m.is_read = 1;
            m.isRead = true;
          }
        });
      }
    }
  });

  // Real-time Salon Read Receipts (Eye Icon Updates to Orange in Salons)
  state.socket.on('salon_messages_read', (data) => {
    if (state.activeSalon && String(state.activeSalon.id) === String(data.salonId)) {
      const unreadEyes = document.querySelectorAll('.msg-status-eye.unread');
      unreadEyes.forEach(eye => {
        eye.className = 'msg-status-eye read';
        eye.title = 'Message lu';
        eye.innerHTML = `
          <svg width="14" height="10" viewBox="0 0 16 12" fill="none">
            <path d="M8 1.5C4.5 1.5 1.5 6 1.5 6C1.5 6 4.5 10.5 8 10.5C11.5 10.5 14.5 6 14.5 6C14.5 6 11.5 1.5 8 1.5Z" stroke="#f97316" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="8" cy="6" r="2.2" fill="#f97316"/>
          </svg>
        `;
      });

      if (state.salonMessages[data.salonId]) {
        const myId = state.user ? state.user.id : '';
        state.salonMessages[data.salonId].forEach(m => {
          if (m.senderId === myId || m.sender_id === myId) {
            m.is_read = 1;
            m.isRead = true;
          }
        });
      }
    }
  });

  // Real-time Support Read Receipts (Eye Icon Updates to Orange in Support Chat)
  state.socket.on('support_read_receipt', (data) => {
    if (state.activeTab === 'support' && state.activeSupportSession && String(state.activeSupportSession) === String(data.senderId)) {
      const unreadEyes = document.querySelectorAll('.msg-status-eye.unread');
      unreadEyes.forEach(eye => {
        eye.className = 'msg-status-eye read';
        eye.title = 'Message lu';
        eye.innerHTML = `
          <svg width="14" height="10" viewBox="0 0 16 12" fill="none">
            <path d="M8 1.5C4.5 1.5 1.5 6 1.5 6C1.5 6 4.5 10.5 8 10.5C11.5 10.5 14.5 6 14.5 6C14.5 6 11.5 1.5 8 1.5Z" stroke="#f97316" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="8" cy="6" r="2.2" fill="#f97316"/>
          </svg>
        `;
      });

      if (state.supportMessages[data.senderId]) {
        state.supportMessages[data.senderId].forEach(m => {
          if (m.senderId === 'admin' || m.senderId === state.user.id || m.sender_id === state.user.id) {
            m.is_read = 1;
            m.isRead = true;
          }
        });
      }
    }
  });

  // Support Message (RebOnly SOS Widget & Admin Reply)
  state.socket.on('support_message', (msg) => {
    // Determine the student / target user ID for this support conversation
    const targetId = (msg.senderId === 'admin' || msg.senderId === state.user.id) ? msg.receiverId : msg.senderId;
    if (!targetId) return;

    if (!state.supportMessages[targetId]) {
      state.supportMessages[targetId] = [];
    }
    state.supportMessages[targetId].push(msg);

    const isFromOther = (msg.senderId !== 'admin' && msg.senderId !== state.user.id);
    if (isFromOther) {
      playNotificationSound();
    }

    const isCurrentActive = state.activeTab === 'support' && state.activeSupportSession === targetId;

    if (isCurrentActive) {
      if (state.socket && isFromOther) {
        state.socket.emit('support_mark_read', { senderId: targetId });
      }
      appendMessageToFeed(msg, true);
      scrollToBottom(true);
    } else if (isFromOther) {
      const badge = document.getElementById('support-badge');
      if (badge) {
        const count = parseInt(badge.textContent || '0', 10) + 1;
        badge.textContent = count > 99 ? '99+' : count;
        badge.style.display = 'inline-block';
      }

      let textSnippet = typeof msg.content === 'object' ? (msg.content.text || 'Alerte SOS') : msg.content;
      if (typeof textSnippet === 'string' && (textSnippet.startsWith('{') || textSnippet.startsWith('&quot;{'))) {
        try {
          const inner = JSON.parse(textSnippet.replace(/&quot;/g, '"'));
          textSnippet = inner.text || 'Demande d\'assistance SOS';
        } catch(e) {}
      }

      showInAppToast({
        title: `SOS Support - ${msg.senderName || 'Formateur'}`,
        body: textSnippet,
        type: 'support',
        senderId: targetId
      });
    }

    if (state.user.role === 'admin') {
      loadSupportConversations();
    }
  });

  // ---------------- SALON REALTIME SOCKET LISTENERS ----------------
  state.socket.on('salon_created', (data) => {
    if (data && data.salon) {
      const exists = state.salons.some(s => String(s.id) === String(data.salon.id));
      if (!exists) {
        state.salons.unshift(data.salon);
        renderSalonsList();
        state.socket.emit('join_salon', data.salon.id);
        const sBadge = document.getElementById('salons-badge');
        if (sBadge && state.activeTab !== 'salons') {
          const count = parseInt(sBadge.textContent || '0', 10) + 1;
          sBadge.textContent = count > 99 ? '99+' : count;
          sBadge.style.display = 'inline-block';
        }
        showInAppToast({
          title: `Nouveau Salon : ${formatSalonName(data.salon.name)}`,
          body: `Vous avez été ajouté à ce Salon.`,
          type: 'private'
        });
        playNotificationSound();
      }
    }
  });

  state.socket.on('salon_invited', (data) => {
    if (data && data.salonId) {
      loadSalons();
      state.socket.emit('join_salon', data.salonId);
      showInAppToast({
        title: 'Invitation à un Salon',
        body: 'Vous avez été ajouté à un nouveau Salon.',
        type: 'private'
      });
      playNotificationSound();
    }
  });

  state.socket.on('salon_updated', (data) => {
    if (data && data.salonId) {
      loadSalons();
      if (state.activeSalon && String(state.activeSalon.id) === String(data.salonId)) {
        if (data.name) {
          state.activeSalon.name = data.name;
          const formattedName = formatSalonName(data.name);
          const headerName = document.getElementById('active-contact-name');
          if (headerName) headerName.textContent = formattedName;
          const inputEl = document.getElementById('message-input');
          if (inputEl && !inputEl.disabled) inputEl.placeholder = `Écrire dans ${formattedName}...`;
        }
        if (data.description !== undefined) {
          state.activeSalon.description = data.description;
        }
      }
    }
  });

  state.socket.on('salon_member_blocked_status', (data) => {
    if (data && state.activeSalon && String(data.salonId) === String(state.activeSalon.id)) {
      updateSalonBlockedComposerState(Boolean(data.isBlocked), formatSalonName(state.activeSalon.name));
      if (data.isBlocked) {
        showInAppToast({
          title: 'Accès restreint',
          body: 'Vous avez été bloqué dans ce Salon par l\'administrateur.',
          type: 'private'
        });
      }
    }
  });

  state.socket.on('salon_error', (data) => {
    if (data && data.message) {
      showInAppToast({
        title: 'Action impossible',
        body: data.message,
        type: 'private'
      });
      playNotificationSound();
    }
  });

  state.socket.on('salon_deleted', (data) => {
    if (data && data.salonId) {
      state.salons = state.salons.filter(s => String(s.id) !== String(data.salonId));
      renderSalonsList();
      if (state.activeSalon && String(state.activeSalon.id) === String(data.salonId)) {
        state.activeSalon = null;
        showEmptyFeed(true, 'Ce Salon a été supprimé par son administrateur.');
        showInAppToast({
          title: 'Salon supprimé',
          body: 'Ce Salon a été supprimé.',
          type: 'private'
        });
      }
    }
  });

  state.socket.on('new_salon_message', (msg) => {
    const salonId = msg.receiverId || msg.receiver_id;
    if (!salonId) return;

    if (msg.id) {
      if (state.processedMsgIds.has(msg.id)) return;
      state.processedMsgIds.add(msg.id);
      if (state.processedMsgIds.size > 500) {
        const first = state.processedMsgIds.values().next().value;
        state.processedMsgIds.delete(first);
      }
    }

    if (!state.salonMessages[salonId]) {
      state.salonMessages[salonId] = [];
    }

    const exists = state.salonMessages[salonId].some(m => m.id === msg.id);
    if (exists) return;

    state.salonMessages[salonId].push(msg);

    const isSalonActive = Boolean(
      state.activeTab === 'salons' &&
      state.activeSalon &&
      String(state.activeSalon.id) === String(salonId) &&
      !document.hidden &&
      document.visibilityState === 'visible'
    );

    if (isSalonActive) {
      if (state.socket && (msg.senderId !== state.user.id && msg.sender_id !== state.user.id)) {
        state.socket.emit('salon_mark_read', { salonId });
      }
      appendMessageToFeed(msg, false, true);
      scrollToBottom(false);
      requestAnimationFrame(() => scrollToBottom(false));
      setTimeout(() => scrollToBottom(true), 80);
    } else {
      if (msg.senderId !== state.user.id) {
        state.unreadSalonCounts[salonId] = (state.unreadSalonCounts[salonId] || 0) + 1;
        renderSalonsList();

        const sBadge = document.getElementById('salons-badge');
        if (sBadge && state.activeTab !== 'salons') {
          const currentCount = parseInt(sBadge.textContent || '0', 10) + 1;
          sBadge.textContent = currentCount > 99 ? '99+' : currentCount;
          sBadge.style.display = 'inline-block';
        }

        let snippet = typeof msg.content === 'object' ? (msg.content.text || 'Nouveau fichier') : msg.content;
        try {
          if (typeof snippet === 'string' && (snippet.startsWith('{') || snippet.startsWith('&quot;{'))) {
            const inner = JSON.parse(snippet.replace(/&quot;/g, '"'));
            snippet = inner.text || 'Nouveau message';
          }
        } catch (e) {}

        const salonObj = state.salons.find(s => String(s.id) === String(salonId));
        const salonName = formatSalonName(salonObj ? salonObj.name : 'Salon');

        if (!document.hidden) {
          showInAppToast({
            title: `${salonName} • ${msg.senderName || msg.sender_name || 'Membre'}`,
            body: snippet,
            type: 'private'
          });
          playNotificationSound();
        }
      }
    }
  });

  state.socket.on('salon_typing', (data) => {
    if (data && data.salonId && state.activeSalon && String(state.activeSalon.id) === String(data.salonId)) {
      if (data.userId === state.user.id) return;
      const bar = document.getElementById('typing-indicator');
      if (bar) {
        if (data.isTyping !== false) {
          bar.innerHTML = `<span style="color: #10b981; font-weight: 500; display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>${escapeHtml(data.userName || data.senderName || 'Un membre')} est en train d'écrire...</span>`;
          clearTimeout(window.typingTimeout);
          window.typingTimeout = setTimeout(() => {
            if (bar) bar.innerHTML = '';
          }, 2500);
        } else {
          bar.innerHTML = '';
        }
      }
    }
  });

  // Typing indicator (Display at the bottom above composer only)
  state.socket.on('typing', (data) => {
    if (data.channel === 'support') {
      if (state.activeTab === 'support' && state.activeSupportSession === data.senderId) {
        const bar = document.getElementById('typing-indicator');
        if (bar) {
          bar.innerHTML = `<span style="color: #f43f5e; font-weight: 500;">${escapeHtml(data.senderName || 'Le formateur')} est en train d'écrire...</span>`;
          clearTimeout(window.typingTimeout);
          window.typingTimeout = setTimeout(() => {
            if (bar) bar.innerHTML = '';
          }, 2500);
        }
      }
      return;
    }

    if (state.activeContact && data.senderId === state.activeContact.id) {
      const bar = document.getElementById('typing-indicator');

      if (bar) {
        bar.innerHTML = `<span style="color: var(--emerald-light); font-weight: 500;">${escapeHtml(data.senderName || 'Votre correspondant')} est en train d'écrire...</span>`;
      }

      clearTimeout(window.typingTimeout);
      window.typingTimeout = setTimeout(() => {
        if (bar) bar.innerHTML = '';
      }, 2500);
    }
  });

  // Realtime Message Deletion
  state.socket.on('message_deleted', (data) => {
    const msgId = data && (data.messageId || data.id);
    if (!msgId) return;

    const el = document.getElementById(msgId);
    if (el) {
      el.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
      el.style.opacity = '0';
      el.style.transform = 'scale(0.95)';
      setTimeout(() => el.remove(), 250);
    }

    // Filter out from memory cache
    for (const cId in state.directMessages) {
      state.directMessages[cId] = state.directMessages[cId].filter(m => m.id !== msgId);
    }
    for (const sId in state.salonMessages) {
      state.salonMessages[sId] = state.salonMessages[sId].filter(m => m.id !== msgId);
    }

    // Remove from IndexedDB cache
    if (window.digiStore) {
      window.digiStore.deleteMessage(msgId).catch(() => {});
    }
  });

  // Helper for applying message edit across Memory, DOM, and IndexedDB
  window.applyMessageEditLocally = function(messageId, newContent, isEdited = 1, editedAt = null) {
    if (!messageId || newContent === undefined || newContent === null) return;

    let plainText = newContent;
    if (typeof newContent === 'object' && newContent !== null) {
      plainText = newContent.text || '';
    } else if (typeof newContent === 'string' && (newContent.startsWith('{"') || newContent.startsWith('{&quot;'))) {
      try {
        const inner = JSON.parse(newContent.replace(/&quot;/g, '"'));
        plainText = inner.text || newContent;
      } catch (e) {}
    }
    if (typeof plainText !== 'string') plainText = String(plainText || '');

    // 1. Update in memory cache
    for (const cId in state.directMessages) {
      const msg = state.directMessages[cId].find(m => m.id === messageId);
      if (msg) {
        if (typeof msg.content === 'object' && msg.content !== null) {
          msg.content.text = plainText;
        } else {
          msg.content = { type: 'text', text: plainText };
        }
        msg.is_edited = isEdited ? 1 : 0;
        msg.isEdited = isEdited ? 1 : 0;
        if (editedAt) msg.edited_at = editedAt;
      }
    }
    for (const sId in state.salonMessages) {
      const msg = state.salonMessages[sId].find(m => m.id === messageId);
      if (msg) {
        if (typeof msg.content === 'object' && msg.content !== null) {
          msg.content.text = plainText;
        } else {
          msg.content = { type: 'text', text: plainText };
        }
        msg.is_edited = isEdited ? 1 : 0;
        msg.isEdited = isEdited ? 1 : 0;
        if (editedAt) msg.edited_at = editedAt;
      }
    }

    // 2. Update the DOM element
    const row = document.getElementById(messageId);
    if (row) {
      const bubble = row.querySelector('.msg-bubble');
      if (bubble) {
        const audit = bubble.querySelector('.msg-audit-badge, .msg-deleted-badge');
        const quoted = bubble.querySelector('.msg-quoted-reply');
        const meta = bubble.querySelector('.msg-meta');

        // Adjust emoji bubble classes if applicable
        const emojiCount = typeof getOnlyEmojisCount === 'function' ? getOnlyEmojisCount(plainText) : 0;
        bubble.classList.remove('emoji-only-bubble', 'emoji-only-1', 'emoji-only-2', 'emoji-only-3');
        if (emojiCount >= 1 && emojiCount <= 3) {
          bubble.classList.add('emoji-only-bubble', `emoji-only-${emojiCount}`);
        }

        const formattedHtml = typeof linkifyText === 'function' ? linkifyText(plainText) : escapeHtml(plainText);
        let newInner = '';
        if (audit) newInner += audit.outerHTML;
        if (quoted) newInner += quoted.outerHTML;
        newInner += formattedHtml;

        if (meta) {
          if (!meta.querySelector('.msg-edited-tag')) {
            const metaTime = meta.querySelector('.msg-meta-time');
            const tag = document.createElement('span');
            tag.className = 'msg-edited-tag';
            tag.textContent = 'modifié';
            if (metaTime) {
              meta.insertBefore(tag, metaTime);
            } else {
              meta.prepend(tag);
            }
          }
          newInner += meta.outerHTML;
        }
        bubble.innerHTML = newInner;
      }
    }

    // 3. Persist edit in IndexedDB
    if (window.digiStore && typeof window.digiStore.updateMessageContent === 'function') {
      window.digiStore.updateMessageContent(messageId, plainText, isEdited, editedAt).catch(() => {});
    }
  };

  // Realtime Message Edit Handler
  state.socket.on('message_edited', async (data) => {
    if (!data) return;
    const messageId = data.messageId || data.id;
    const newContent = data.newContent !== undefined ? data.newContent : data.content;
    if (!messageId || newContent === undefined) return;

    window.applyMessageEditLocally(messageId, newContent, data.is_edited || data.isEdited || 1, data.edited_at || data.editedAt);
  });

  // Admin Audit Notification on Recall
  state.socket.on('message_audit_update', (data) => {
    const msgId = data && data.messageId;
    if (!msgId) return;

    const el = document.getElementById(msgId);
    if (el) {
      const bubble = el.querySelector('.msg-bubble');
      if (bubble && !el.querySelector('.msg-deleted-badge')) {
        const badge = document.createElement('div');
        badge.className = 'msg-deleted-badge';
        badge.innerHTML = `<span style="display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>Supprimé par ${escapeHtml(data.deletedBy || "l'expéditeur")}</span>`;
        bubble.insertBefore(badge, bubble.firstChild);
      }
    }
  });
}

function playNotificationSound() {
  // Discreet haptic feedback if app is open in foreground and user has interacted
  try {
    const hasUserActivated = !navigator.userActivation || navigator.userActivation.hasBeenActive;
    if (navigator.vibrate && !document.hidden && hasUserActivated) {
      navigator.vibrate(40);
    }
  } catch (e) {}
}

function showLocalNotification(title, body) {
  if (Notification.permission === 'granted') {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, {
          body: body,
          icon: '/img/icon-192.png',
          badge: '/img/badge-72.png',
          vibrate: [200, 100, 200]
        });
      });
    } else {
      new Notification(title, { body, icon: '/img/icon-192.png' });
    }
  }
}

function showInAppToast({ title, body, type = 'private', senderId = null }) {
  let container = document.getElementById('toast-notifications-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-notifications-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const iconSvg = type === 'support'
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"></path><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"></path></svg>`
    : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;

  const card = document.createElement('div');
  card.className = `toast-card ${type}`;
  card.innerHTML = `
    <div class="toast-icon" style="display: flex; align-items: center;">${iconSvg}</div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title.replace(/^[🚨💬🛡️]\s*/, ''))}</div>
      <div class="toast-body">${escapeHtml(body || 'Nouveau message')}</div>
    </div>
    <button type="button" class="toast-action-btn" style="display: inline-flex; align-items: center; gap: 4px;">
      Voir
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="5" y1="12" x2="19" y2="12"></line>
        <polyline points="12 5 19 12 12 19"></polyline>
      </svg>
    </button>
  `;

  const btnAction = card.querySelector('.toast-action-btn');
  if (btnAction) {
    btnAction.addEventListener('click', () => {
      card.remove();
      if (type === 'support') {
        if (senderId) {
          window.openSupportConversationBySenderId(senderId);
        } else {
          switchTab('support');
        }
      } else {
        switchTab('contacts');
        if (senderId && state.contacts) {
          const found = state.contacts.find(c => String(c.id) === String(senderId));
          if (found) selectContact(found);
        }
      }
    });
  }

  container.appendChild(card);

  setTimeout(() => {
    card.style.opacity = '0';
    card.style.transform = 'translateX(100%)';
    setTimeout(() => card.remove(), 250);
  }, 6000);
}

function getMessagePreviewText(content) {
  if (typeof content === 'string') {
    try {
      const obj = JSON.parse(content);
      if (obj.type === 'image') return 'Photo';
      if (obj.type === 'file') return `Fichier : ${obj.fileName}`;
      if (obj.type === 'audio') return 'Note vocale';
    } catch (e) {}
    return content;
  }
  if (typeof content === 'object' && content !== null) {
    if (content.type === 'image') return 'Photo';
    if (content.type === 'file') return `Fichier : ${content.fileName}`;
    if (content.type === 'audio') return 'Note vocale';
  }
  return 'Nouveau message';
}

function setupEventListeners() {
  document.getElementById('tab-btn-contacts').addEventListener('click', () => switchTab('contacts'));
  document.getElementById('tab-btn-salons').addEventListener('click', () => switchTab('salons'));
  document.getElementById('tab-btn-support').addEventListener('click', () => switchTab('support'));

  // Sidebar Search Listeners
  const searchInput = document.getElementById('search-contacts-input');
  const clearSearchBtn = document.getElementById('btn-clear-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      if (clearSearchBtn) {
        clearSearchBtn.style.display = state.searchQuery ? 'flex' : 'none';
      }
      renderContactsList();
    });
  }
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      state.searchQuery = '';
      clearSearchBtn.style.display = 'none';
      renderContactsList();
    });
  }

  // Mobile Back Button (Return to contacts/salons list)
  const btnBack = document.getElementById('btn-back-to-contacts');
  if (btnBack) {
    btnBack.addEventListener('click', () => {
      document.body.classList.remove('mobile-chat-open');
      if (state.socket) {
        if (state.activeContact) {
          state.socket.emit('leave_active_chat', { partnerId: state.activeContact.id });
        }
        if (state.activeSalon) {
          state.socket.emit('leave_active_chat', { partnerId: state.activeSalon.id });
        }
      }
      localStorage.removeItem('digicom_active_contact');
      state.activeContact = null;
      state.activeSalon = null;
      cancelReply();
      showEmptyFeed(true);
      if (state.activeTab === 'salons') {
        renderSalonsList();
      } else {
        renderContactsList();
      }
    });
  }

  // Context Menu Action Listeners
  const ctxModal = document.getElementById('msg-context-modal');
  const btnCtxReply = document.getElementById('ctx-action-reply');
  const btnCtxCopy = document.getElementById('ctx-action-copy');
  const btnCtxDelete = document.getElementById('ctx-action-delete');
  const btnCtxCancel = document.getElementById('ctx-action-cancel');

  if (btnCtxReply) {
    btnCtxReply.addEventListener('click', () => {
      if (window.currentActiveCtxMessage) {
        startReply(window.currentActiveCtxMessage.id, window.currentActiveCtxMessage.senderName, window.currentActiveCtxMessage.content);
      }
      closeMessageContextMenu();
    });
  }

  if (btnCtxCopy) {
    btnCtxCopy.addEventListener('click', () => {
      if (window.currentActiveCtxMessage) {
        let textToCopy = '';
        const content = window.currentActiveCtxMessage.content;
        if (typeof content === 'string') {
          try {
            const parsed = JSON.parse(content);
            textToCopy = parsed.text || content;
          } catch (e) {
            textToCopy = content;
          }
        } else if (typeof content === 'object' && content !== null) {
          textToCopy = content.text || '';
        }
        if (textToCopy && navigator.clipboard) {
          navigator.clipboard.writeText(textToCopy);
        }
      }
      closeMessageContextMenu();
    });
  }

  if (btnCtxDelete) {
    btnCtxDelete.addEventListener('click', () => {
      if (window.currentActiveCtxMessage) {
        deleteMessage(window.currentActiveCtxMessage.id);
      }
      closeMessageContextMenu();
    });
  }

  if (btnCtxCancel) {
    btnCtxCancel.addEventListener('click', closeMessageContextMenu);
  }

  if (ctxModal) {
    ctxModal.addEventListener('click', (e) => {
      if (e.target === ctxModal) closeMessageContextMenu();
    });
  }

  // Scroll to bottom button handler & scroll observer
  const feed = document.getElementById('messages-feed');
  const scrollBtn = document.getElementById('btn-scroll-bottom');
  const btnRefreshChat = document.getElementById('btn-refresh-chat');

  if (btnRefreshChat) {
    btnRefreshChat.addEventListener('click', () => {
      if (state.activeContact) {
        btnRefreshChat.style.transform = 'rotate(180deg)';
        btnRefreshChat.style.transition = 'transform 0.4s ease';
        setTimeout(() => { btnRefreshChat.style.transform = ''; }, 400);
        loadDirectHistory(state.activeContact.id);
      }
    });
  }

  if (feed && scrollBtn) {
    feed.addEventListener('scroll', () => {
      const distFromBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
      if (distFromBottom > 180) {
        scrollBtn.style.display = 'flex';
      } else {
        scrollBtn.style.display = 'none';
        const badge = document.getElementById('scroll-unread-badge');
        if (badge) {
          badge.textContent = '0';
          badge.style.display = 'none';
        }
      }
    }, { passive: true });

    scrollBtn.addEventListener('click', () => {
      scrollToBottom(true);
      scrollBtn.style.display = 'none';
      const badge = document.getElementById('scroll-unread-badge');
      if (badge) {
        badge.textContent = '0';
        badge.style.display = 'none';
      }
    });
  }

  const btnCtxEdit = document.getElementById('ctx-action-edit');
  if (btnCtxEdit) {
    btnCtxEdit.addEventListener('click', () => {
      if (window.currentActiveCtxMessage) {
        let textToEdit = '';
        const content = window.currentActiveCtxMessage.content;
        if (typeof content === 'string') {
          try {
            const parsed = JSON.parse(content);
            textToEdit = parsed.text || content;
          } catch (e) {
            textToEdit = content;
          }
        } else if (typeof content === 'object' && content !== null) {
          textToEdit = content.text || '';
        }
        if (textToEdit) {
          startEdit(window.currentActiveCtxMessage.id, textToEdit);
        }
      }
      closeMessageContextMenu();
    });
  }

  // Cancel Reply Button
  const btnCancelReply = document.getElementById('btn-cancel-reply');
  if (btnCancelReply) {
    btnCancelReply.addEventListener('click', () => {
      cancelReply();
    });
  }

  // Cancel Edit Button
  const btnCancelEdit = document.getElementById('btn-cancel-edit');
  if (btnCancelEdit) {
    btnCancelEdit.addEventListener('click', () => {
      cancelEdit();
    });
  }

  let lastTypingEmit = 0;

  // Handle Notification Click message from Service Worker to open direct chat, salon or SOS ticket
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', async (event) => {
      if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
        const notifData = event.data.data || {};
        if (notifData.channel === 'support' || notifData.channel === 'sos') {
          if (notifData.senderId) {
            window.openSupportConversationBySenderId(notifData.senderId);
          } else {
            await switchTab('support');
          }
        } else if (notifData.salonId) {
          await switchTab('salons');
          const found = state.salons ? state.salons.find(s => String(s.id) === String(notifData.salonId)) : null;
          if (found) {
            selectSalon(found);
          }
        } else if (notifData.senderId) {
          await switchTab('contacts');
          const found = state.contacts ? state.contacts.find(c => c.id === notifData.senderId) : null;
          if (found) {
            selectContact(found);
          }
        }
      }
    });
  }

  // Page Visibility & Tab Focus Handler (Leaves active chat when app is in background)
  document.addEventListener('visibilitychange', () => {
    if (!state.socket) return;

    if (document.hidden) {
      if (state.activeContact) {
        state.socket.emit('leave_active_chat', { partnerId: state.activeContact.id });
      }
      if (state.activeSalon) {
        state.socket.emit('leave_active_chat', { partnerId: state.activeSalon.id });
      }
      if (state.activeSupportSession) {
        state.socket.emit('leave_active_chat', { partnerId: 'admin_' + state.activeSupportSession });
      }
    } else {
      if (state.activeTab === 'contacts' && state.activeContact) {
        state.socket.emit('enter_active_chat', { partnerId: state.activeContact.id });
        state.socket.emit('mark_read', { senderId: state.activeContact.id });
      }
      if (state.activeTab === 'salons' && state.activeSalon) {
        state.socket.emit('enter_active_chat', { partnerId: state.activeSalon.id });
        state.socket.emit('salon_mark_read', { salonId: state.activeSalon.id });
      }
      if (state.activeTab === 'support' && state.activeSupportSession) {
        state.socket.emit('enter_active_chat', { partnerId: 'admin_' + state.activeSupportSession });
        state.socket.emit('support_mark_read', { senderId: state.activeSupportSession });
      }
    }
  });

  window.addEventListener('blur', () => {
    if (!state.socket) return;
    if (state.activeContact) {
      state.socket.emit('leave_active_chat', { partnerId: state.activeContact.id });
    }
    if (state.activeSalon) {
      state.socket.emit('leave_active_chat', { partnerId: state.activeSalon.id });
    }
    if (state.activeSupportSession) {
      state.socket.emit('leave_active_chat', { partnerId: 'admin_' + state.activeSupportSession });
    }
  });

  window.addEventListener('focus', () => {
    if (!state.socket || document.hidden) return;
    if (state.activeTab === 'contacts' && state.activeContact) {
      state.socket.emit('enter_active_chat', { partnerId: state.activeContact.id });
      state.socket.emit('mark_read', { senderId: state.activeContact.id });
    }
    if (state.activeTab === 'salons' && state.activeSalon) {
      state.socket.emit('enter_active_chat', { partnerId: state.activeSalon.id });
      state.socket.emit('salon_mark_read', { salonId: state.activeSalon.id });
    }
    if (state.activeTab === 'support' && state.activeSupportSession) {
      state.socket.emit('enter_active_chat', { partnerId: 'admin_' + state.activeSupportSession });
      state.socket.emit('support_mark_read', { senderId: state.activeSupportSession });
    }
  });

  // Push subscription toggle & Immediate Test
  document.getElementById('btn-push-toggle').addEventListener('click', async () => {
    const ok = await state.pushClient.subscribeUser(state.user ? state.user.id : null);
    if (ok) {
      document.getElementById('btn-push-toggle').classList.add('active');
      playNotificationSound();
      showLocalNotification('DigiCom', 'Notifications activées avec succès !');
      // Trigger background test push from server
      fetch('/api/test-notification', { method: 'POST' }).catch(() => {});
    } else {
      alert('Veuillez autoriser les notifications dans votre navigateur pour recevoir les alertes.');
    }
  });

  // ---------------- MENTIONS & TAGGING AUTOCOMPLETE ----------------
  function handleMessageInputMention() {
    const input = document.getElementById('message-input');
    const popover = document.getElementById('mentions-popover');
    const listEl = document.getElementById('mentions-list-scroll');
    if (!input || !popover || !listEl) return;

    const cursorPos = input.selectionStart || 0;
    const textBefore = input.value.substring(0, cursorPos);

    // Look for an active '@' pattern before the cursor
    const match = textBefore.match(/(?:^|\s)@([a-zA-Z0-9_\-]*)$/);
    if (!match) {
      hideMentionsPopover();
      return;
    }

    const query = match[1].toLowerCase();
    const atIndex = textBefore.lastIndexOf('@');

    let candidates = [];
    if (state.activeSalon && state.activeSalonMembers && state.activeSalonMembers.length > 0) {
      candidates = state.activeSalonMembers;
    } else if (state.contacts && state.contacts.length > 0) {
      candidates = state.contacts;
    }

    const currentUserId = state.user ? String(state.user.id) : '';
    const matched = candidates.filter(u => {
      if (String(u.id) === currentUserId) return false;
      const uname = (u.username || '').toLowerCase();
      const dname = (u.display_name || '').toLowerCase();
      return !query || uname.includes(query) || dname.includes(query);
    });

    if (matched.length === 0) {
      hideMentionsPopover();
      return;
    }

    renderMentionsList(matched, atIndex);
  }

  function renderMentionsList(members, atIndex) {
    const popover = document.getElementById('mentions-popover');
    const listEl = document.getElementById('mentions-list-scroll');
    if (!popover || !listEl) return;

    listEl.innerHTML = '';
    state.mentionSelectedIndex = 0;
    state.currentMentionList = members;
    state.currentMentionAtIndex = atIndex;

    members.forEach((m, idx) => {
      const item = document.createElement('div');
      item.className = `mention-item ${idx === 0 ? 'selected' : ''}`;
      item.dataset.index = idx;
      const initial = (m.display_name || m.username || '?').charAt(0).toUpperCase();
      const isOnline = state.onlineUserIds.includes(m.id);
      const isCreator = m.salon_role === 'creator' || (state.activeSalon && m.id === state.activeSalon.created_by);

      item.innerHTML = `
        <div class="mention-item-left">
          <div style="position: relative;">
            <div class="mention-avatar">${initial}</div>
            <div class="micro-dot ${isOnline ? 'online' : ''}" style="width: 8px; height: 8px;"></div>
          </div>
          <div style="min-width: 0; overflow: hidden;">
            <div class="mention-name">${escapeHtml(m.display_name || m.username)}</div>
            <div class="mention-username">@${escapeHtml(m.username)}</div>
          </div>
        </div>
        ${isCreator ? '<span class="mention-role-tag">Admin</span>' : ''}
      `;

      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectMentionUser(m, atIndex);
      });

      listEl.appendChild(item);
    });

    popover.style.display = 'block';
  }

  function updateMentionSelectionUI() {
    const listEl = document.getElementById('mentions-list-scroll');
    if (!listEl) return;
    const items = listEl.querySelectorAll('.mention-item');
    items.forEach((item, idx) => {
      if (idx === state.mentionSelectedIndex) {
        item.classList.add('selected');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('selected');
      }
    });
  }

  function selectMentionUser(user, atIndex) {
    const input = document.getElementById('message-input');
    if (!input) return;

    const val = input.value;
    const cursorPos = input.selectionStart || val.length;

    const before = val.substring(0, atIndex);
    const after = val.substring(cursorPos);
    const inserted = `@${user.username} `;

    input.value = before + inserted + after;
    const newCursorPos = before.length + inserted.length;
    input.selectionStart = newCursorPos;
    input.selectionEnd = newCursorPos;

    hideMentionsPopover();
    input.focus();
    autoResizeInput(input);
    updateComposerButtons();
  }

  function hideMentionsPopover() {
    const popover = document.getElementById('mentions-popover');
    if (popover) popover.style.display = 'none';
    state.currentMentionList = [];
    state.mentionSelectedIndex = 0;
  }

  // Message Send Logic
  const msgInput = document.getElementById('message-input');
  const btnSend = document.getElementById('btn-send');

  function autoResizeInput(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }

  function updateComposerButtons() {
    if (!msgInput) return;
    const text = (msgInput.value || '').trim();
    if (text.length > 0) {
      if (btnRecordVoice) btnRecordVoice.style.display = 'none';
      if (btnSend) btnSend.style.display = 'flex';
    } else {
      if (btnRecordVoice) btnRecordVoice.style.display = 'flex';
      if (btnSend) btnSend.style.display = 'none';
    }
  }

  function handleSend() {
    const text = (msgInput.value || '').trim();
    if (!text) return;

    hideMentionsPopover();
    msgInput.value = '';
    autoResizeInput(msgInput);
    updateComposerButtons();
    sendMessage(text);

    // Auto-scroll feed immediately to bottom across rendering frames
    scrollToBottom(false);
    requestAnimationFrame(() => scrollToBottom(false));
    setTimeout(() => scrollToBottom(false), 50);
    setTimeout(() => scrollToBottom(true), 150);

    // Maintain keyboard open and focused for fluid continuous typing
    if (msgInput) {
      msgInput.focus();
    }
  }

  if (btnSend) {
    const onSendTrigger = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      handleSend();
    };

    btnSend.addEventListener('touchstart', onSendTrigger, { passive: false });
    btnSend.addEventListener('click', onSendTrigger);
  }

  if (msgInput) {
    // Auto-resize, typing indicator and mentions autocomplete
    msgInput.addEventListener('input', () => {
      autoResizeInput(msgInput);
      updateComposerButtons();
      handleMessageInputMention();
      const now = Date.now();
      if (state.socket && now - lastTypingEmit > 1500) {
        lastTypingEmit = now;
        if (state.activeTab === 'contacts' && state.activeContact) {
          state.socket.emit('typing', {
            channel: 'private',
            senderId: state.user.id,
            senderName: state.user.displayName || state.user.username,
            receiverId: state.activeContact.id
          });
        } else if (state.activeTab === 'salons' && state.activeSalon) {
          state.socket.emit('typing', {
            channel: 'salon',
            salonId: state.activeSalon.id,
            senderId: state.user.id,
            senderName: state.user.displayName || state.user.username,
            isTyping: true
          });
        } else if (state.activeTab === 'support' && state.activeSupportSession) {
          state.socket.emit('typing', {
            channel: 'support',
            senderId: state.user.id,
            senderName: state.user.displayName || 'Support DigiCom',
            targetRoom: `support_${state.activeSupportSession}`
          });
        }
      }
    });

    msgInput.addEventListener('keyup', (e) => {
      if (['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key)) return;
      handleMessageInputMention();
    });

    msgInput.addEventListener('click', () => {
      handleMessageInputMention();
    });

    // Enter key handling (Line break on Mobile, Send on Desktop) + Mentions autocomplete navigation
    const isTouchMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || window.matchMedia('(max-width: 768px)').matches;

    msgInput.addEventListener('keydown', (e) => {
      const popover = document.getElementById('mentions-popover');
      if (popover && popover.style.display !== 'none' && state.currentMentionList && state.currentMentionList.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          state.mentionSelectedIndex = (state.mentionSelectedIndex + 1) % state.currentMentionList.length;
          updateMentionSelectionUI();
          return;
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          state.mentionSelectedIndex = (state.mentionSelectedIndex - 1 + state.currentMentionList.length) % state.currentMentionList.length;
          updateMentionSelectionUI();
          return;
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const selectedUser = state.currentMentionList[state.mentionSelectedIndex || 0];
          if (selectedUser) {
            selectMentionUser(selectedUser, state.currentMentionAtIndex);
          }
          return;
        } else if (e.key === 'Escape') {
          e.preventDefault();
          hideMentionsPopover();
          return;
        }
      }

      if (e.key === 'Enter') {
        if (isTouchMobile) {
          // On mobile touch keyboards, Enter inserts a newline for multiline text
          setTimeout(() => autoResizeInput(msgInput), 0);
          return;
        }

        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          // On desktop, Shift+Enter inserts a newline
          setTimeout(() => autoResizeInput(msgInput), 0);
          return;
        }

        // On desktop, plain Enter sends the message
        e.preventDefault();
        handleSend();
      }
    });
  }

  // Emoji & Sticker Picker Toggle
  const btnEmoji = document.getElementById('btn-emoji');
  const emojiPopover = document.getElementById('emoji-picker-popover');
  const tabEmojis = document.getElementById('tab-emoji-emojis');
  const tabStickers = document.getElementById('tab-emoji-stickers');

  if (btnEmoji && emojiPopover) {
    btnEmoji.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = emojiPopover.style.display === 'flex';
      if (isVisible) {
        emojiPopover.style.display = 'none';
      } else {
        renderEmojiTab();
        if (tabEmojis) tabEmojis.className = 'emoji-nav-tab active';
        if (tabStickers) tabStickers.className = 'emoji-nav-tab';
        emojiPopover.style.display = 'flex';
      }
    });

    if (tabEmojis) {
      tabEmojis.addEventListener('click', (e) => {
        e.stopPropagation();
        tabEmojis.className = 'emoji-nav-tab active';
        if (tabStickers) tabStickers.className = 'emoji-nav-tab';
        renderEmojiTab();
      });
    }

    if (tabStickers) {
      tabStickers.addEventListener('click', (e) => {
        e.stopPropagation();
        tabStickers.className = 'emoji-nav-tab active';
        if (tabEmojis) tabEmojis.className = 'emoji-nav-tab';
        renderStickerTab();
      });
    }

    document.addEventListener('click', (e) => {
      if (!emojiPopover.contains(e.target) && e.target !== btnEmoji && !btnEmoji.contains(e.target)) {
        emojiPopover.style.display = 'none';
      }
      const mentionsPopover = document.getElementById('mentions-popover');
      if (mentionsPopover && !mentionsPopover.contains(e.target) && e.target !== msgInput) {
        hideMentionsPopover();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && emojiPopover.style.display !== 'none') {
        emojiPopover.style.display = 'none';
      }
    });
  }

  // File & Image Attachment Trigger
  const btnAttach = document.getElementById('btn-attach');
  const fileInput = document.getElementById('file-input');

  if (btnAttach && fileInput) {
    btnAttach.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      try {
        btnAttach.disabled = true;
        btnAttach.style.opacity = '0.4';
        btnAttach.style.pointerEvents = 'none';

        showUploadProgress(`Préparation de ${file.name}...`);
        let fileToUpload = file;

        // Compress image or video before uploading to preserve bandwidth and storage
        if (file.type.startsWith('image/') && file.type !== 'image/gif' && file.type !== 'image/svg+xml') {
          updateUploadProgressText(`Optimisation de l'image ${file.name}...`);
          fileToUpload = await compressImage(file, 1600, 0.82);
        } else if (file.type.startsWith('video/') && file.size > 100 * 1024 * 1024) {
          updateUploadProgressText(`Compression de la vidéo ${file.name}...`);
          fileToUpload = await compressVideo(file);
        }

        updateUploadProgressText(`Envoi de ${file.name} en cours...`);
        const uploaded = await uploadFile(fileToUpload);

        if (file.type.startsWith('image/')) {
          sendMessage({
            type: 'image',
            url: uploaded.url,
            fileName: uploaded.fileName,
            fileSize: uploaded.fileSize
          });
        } else if (file.type.startsWith('video/')) {
          sendMessage({
            type: 'video',
            url: uploaded.url,
            fileName: uploaded.fileName,
            fileSize: uploaded.fileSize
          });
        } else {
          sendMessage({
            type: 'file',
            url: uploaded.url,
            fileName: uploaded.fileName,
            fileSize: uploaded.fileSize,
            mimeType: uploaded.mimeType
          });
        }
      } catch (err) {
        alert('Erreur lors de l\'envoi du fichier : ' + err.message);
      } finally {
        hideUploadProgress();
        fileInput.value = '';
        btnAttach.disabled = false;
        btnAttach.style.opacity = '1';
        btnAttach.style.pointerEvents = 'auto';
      }
    });
  }

  // Voice Note Recording
  const btnRecordVoice = document.getElementById('btn-record-voice');
  const btnCancelVoice = document.getElementById('btn-cancel-voice');
  const btnSendVoice = document.getElementById('btn-send-voice');

  if (btnRecordVoice) {
    btnRecordVoice.addEventListener('click', startVoiceRecording);
  }
  if (btnCancelVoice) {
    btnCancelVoice.addEventListener('click', cancelVoiceRecording);
  }
  if (btnSendVoice) {
    btnSendVoice.addEventListener('click', stopAndSendVoiceRecording);
  }

  // Lightbox Close (Backdrop click or Escape key)
  const btnCloseLightbox = document.getElementById('btn-close-lightbox');
  const lightbox = document.getElementById('image-lightbox');
  if (lightbox) {
    if (btnCloseLightbox) {
      btnCloseLightbox.addEventListener('click', (e) => {
        e.stopPropagation();
        lightbox.style.display = 'none';
      });
    }
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox || e.target.classList.contains('lightbox-container') || e.target.classList.contains('lightbox-backdrop')) {
        lightbox.style.display = 'none';
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && lightbox.style.display !== 'none') {
        lightbox.style.display = 'none';
      }
    });
  }

  // First time setup form
  document.getElementById('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('setup-username').value.trim();
    const displayName = document.getElementById('setup-displayname').value.trim();
    const password = document.getElementById('setup-password').value;
    const errBox = document.getElementById('setup-error');

    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, displayName, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de l\'initialisation');

      state.user = data.user;
      if (data.token) {
        localStorage.setItem('digicom_token', data.token);
      }
      localStorage.setItem('digicom_user', JSON.stringify(data.user));

      hideModals();
      initAppInterface();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.style.display = 'block';
    }
  });

  // Login form
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errBox = document.getElementById('login-error');

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Identifiants invalides');

      state.user = data.user;
      if (data.token) {
        localStorage.setItem('digicom_token', data.token);
      }
      localStorage.setItem('digicom_user', JSON.stringify(data.user));

      state.directMessages = {};
      state.activeContact = null;
      state.supportMessages = {};
      state.activeSupportSession = null;
      hideModals();
      initAppInterface();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.style.display = 'block';
    }
  });

  // Registration / Login Modal Switchers
  const linkShowRegister = document.getElementById('link-show-register');
  const linkShowLogin = document.getElementById('link-show-login');
  if (linkShowRegister) {
    linkShowRegister.addEventListener('click', (e) => {
      e.preventDefault();
      hideModals();
      showModal('register-modal');
    });
  }
  if (linkShowLogin) {
    linkShowLogin.addEventListener('click', (e) => {
      e.preventDefault();
      hideModals();
      showModal('login-modal');
    });
  }

  // Register form
  const registerForm = document.getElementById('register-form');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const displayName = document.getElementById('register-displayname').value.trim();
      const username = document.getElementById('register-username').value.trim();
      const password = document.getElementById('register-password').value;
      const errBox = document.getElementById('register-error');
      const pendingInvite = localStorage.getItem('digicom_pending_invite') || new URLSearchParams(window.location.search).get('invite');

      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, displayName, password, inviteUsername: pendingInvite })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur lors de l\'inscription');

        if (pendingInvite) {
          localStorage.removeItem('digicom_pending_invite');
        }

        state.user = data.user;
        if (data.token) {
          localStorage.setItem('digicom_token', data.token);
        }
        localStorage.setItem('digicom_user', JSON.stringify(data.user));

        state.directMessages = {};
        state.activeContact = null;
        state.supportMessages = {};
        state.activeSupportSession = null;
        hideModals();
        initAppInterface();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    });
  }

  // Add Contact Modal Handlers
  const btnAddContact = document.getElementById('btn-add-contact');
  const btnCloseAddContactModal = document.getElementById('btn-close-add-contact-modal');
  const addContactModal = document.getElementById('add-contact-modal');
  const contactSearchInput = document.getElementById('contact-search-input');
  const contactSearchResults = document.getElementById('contact-search-results');
  const myUsernameTag = document.getElementById('my-username-tag');
  const btnCopyMyUsername = document.getElementById('btn-copy-my-username');

  if (btnAddContact && addContactModal) {
    btnAddContact.addEventListener('click', () => {
      showModal('add-contact-modal');
      if (myUsernameTag && state.user) {
        myUsernameTag.textContent = `@${state.user.username}`;
      }

      const searchSection = document.getElementById('add-contact-search-section');
      const isAdmin = state.user && state.user.role === 'admin';
      if (searchSection) {
        searchSection.style.display = isAdmin ? 'block' : 'none';
      }

      if (isAdmin) {
        if (contactSearchInput) {
          contactSearchInput.value = '';
          contactSearchInput.focus();
        }
        if (contactSearchResults) {
          contactSearchResults.innerHTML = `
            <div class="contact-search-placeholder">
              <div class="placeholder-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              </div>
              <div>Saisissez le <strong>@pseudo</strong> d'un ami pour l'ajouter à vos discussions.</div>
            </div>
          `;
        }
      }
    });
  }

  if (btnCopyMyUsername) {
    btnCopyMyUsername.addEventListener('click', () => {
      if (state.user && state.user.username && navigator.clipboard) {
        navigator.clipboard.writeText(`@${state.user.username}`);
        const origText = btnCopyMyUsername.innerHTML;
        btnCopyMyUsername.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: middle;"><polyline points="20 6 9 17 4 12"></polyline></svg>Copié !';
        btnCopyMyUsername.style.background = 'var(--emerald-light)';
        btnCopyMyUsername.style.color = '#000';
        setTimeout(() => {
          btnCopyMyUsername.innerHTML = origText;
          btnCopyMyUsername.style.background = '';
          btnCopyMyUsername.style.color = '';
        }, 2000);
      }
    });
  }

  const btnCopyInviteLink = document.getElementById('btn-copy-invite-link');
  if (btnCopyInviteLink) {
    btnCopyInviteLink.addEventListener('click', () => {
      if (state.user && state.user.username && navigator.clipboard) {
        const inviteUrl = `${window.location.origin}/?invite=${encodeURIComponent(state.user.username)}`;
        navigator.clipboard.writeText(inviteUrl);
        const origText = btnCopyInviteLink.innerHTML;
        btnCopyInviteLink.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: middle;"><polyline points="20 6 9 17 4 12"></polyline></svg>Lien copié !';
        btnCopyInviteLink.style.background = 'var(--emerald-light)';
        btnCopyInviteLink.style.color = '#000';
        setTimeout(() => {
          btnCopyInviteLink.innerHTML = origText;
          btnCopyInviteLink.style.background = '';
          btnCopyInviteLink.style.color = '';
        }, 2000);
      }
    });
  }

  // Create Salon Modal Handlers
  const btnOpenCreateSalon = document.getElementById('btn-open-create-salon-modal');
  const btnCloseCreateSalon = document.getElementById('btn-close-create-salon-modal');
  const btnCancelCreateSalon = document.getElementById('btn-cancel-create-salon');
  const createSalonForm = document.getElementById('create-salon-form');

  if (btnOpenCreateSalon) {
    btnOpenCreateSalon.addEventListener('click', () => {
      showModal('create-salon-modal');
      renderSalonMembersChecklist();
    });
  }
  if (btnCloseCreateSalon) {
    btnCloseCreateSalon.addEventListener('click', () => hideModal('create-salon-modal'));
  }
  if (btnCancelCreateSalon) {
    btnCancelCreateSalon.addEventListener('click', () => hideModal('create-salon-modal'));
  }

  if (createSalonForm) {
    createSalonForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('salon-name-input').value.trim();
      const description = document.getElementById('salon-desc-input').value.trim();
      const errBox = document.getElementById('create-salon-error');
      if (errBox) errBox.style.display = 'none';

      const selectedCheckboxes = document.querySelectorAll('.salon-member-checkbox:checked');
      const memberIds = Array.from(selectedCheckboxes).map(cb => cb.value);

      if (!name) return;

      try {
        const res = await authFetch('/api/salons/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description, memberIds })
        });
        const data = await res.json();
        if (!res.ok) {
          if (errBox) {
            errBox.textContent = data.error || 'Erreur lors de la création du Salon';
            errBox.style.display = 'block';
          }
          return;
        }

        hideModal('create-salon-modal');
        document.getElementById('salon-name-input').value = '';
        document.getElementById('salon-desc-input').value = '';
        await loadSalons();
        if (data.salon) {
          selectSalon(data.salon);
        }
      } catch (err) {
        if (errBox) {
          errBox.textContent = 'Erreur de connexion au serveur';
          errBox.style.display = 'block';
        }
      }
    });
  }

  if (btnCloseAddContactModal && addContactModal) {
    btnCloseAddContactModal.addEventListener('click', () => {
      addContactModal.style.display = 'none';
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('single-line-textarea') && e.key === 'Enter') {
      e.preventDefault();
    }
  });

  let contactSearchTimeout = null;
  if (contactSearchInput) {
    contactSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
    });
    contactSearchInput.addEventListener('input', () => {
      clearTimeout(contactSearchTimeout);
      const query = contactSearchInput.value.trim();
      if (!query) {
        if (contactSearchResults) {
          contactSearchResults.innerHTML = '<div class="contact-search-placeholder">Tapez un @pseudo pour rechercher un ami.</div>';
        }
        return;
      }

      contactSearchTimeout = setTimeout(async () => {
        try {
          if (!state.user || state.user.role !== 'admin') return;
          const res = await authFetch(`/api/contacts/search?q=${encodeURIComponent(query)}`);
          if (!res.ok) return;
          const data = await res.json();
          renderContactSearchResults(data.users || []);
        } catch (e) {
          console.error('[-] Error searching contacts:', e);
        }
      }, 250);
    });
  }

  // Admin user creation form
  const addUserForm = document.getElementById('add-user-form');
  if (addUserForm) {
    addUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('new-username').value.trim();
      const displayName = document.getElementById('new-displayname').value.trim();
      const password = document.getElementById('new-password').value;
      const role = document.getElementById('new-role').value;
      const errBox = document.getElementById('add-user-error');

      try {
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, displayName, password, role })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur d\'ajout');

        alert(`Utilisateur ${displayName || username} créé avec succès !`);
        addUserForm.reset();
        document.getElementById('admin-modal').style.display = 'none';
        loadContacts();
        loadAdminUsers();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    });
  }

  // Admin modal trigger
  const btnAdmin = document.getElementById('btn-admin-manage');
  if (btnAdmin) {
    btnAdmin.addEventListener('click', () => {
      document.getElementById('admin-modal').style.display = 'flex';
      loadAdminUsers();
    });
  }

  const btnChatAdmin = document.getElementById('btn-chat-admin-manage');
  if (btnChatAdmin) {
    btnChatAdmin.addEventListener('click', () => {
      document.getElementById('admin-modal').style.display = 'flex';
      loadAdminUsers();
    });
  }

  const btnCloseAdmin = document.getElementById('btn-close-admin-modal');
  if (btnCloseAdmin) {
    btnCloseAdmin.addEventListener('click', () => {
      document.getElementById('admin-modal').style.display = 'none';
    });
  }

  // Logout
  document.getElementById('btn-logout').addEventListener('click', async () => {
    try {
      await authFetch('/api/logout', { method: 'POST' });
    } catch (e) {}
    localStorage.removeItem('digicom_token');
    localStorage.removeItem('digicom_user');
    localStorage.removeItem('digicom_active_contact');
    window.location.reload();
  });
}

// ---------------- CLIENT-SIDE IMAGE COMPRESSION ----------------
async function compressImage(file, maxDimension = 1600, quality = 0.82) {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') {
      return resolve(file);
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (!blob) return resolve(file);
          const compressedName = file.name.replace(/\.[^/.]+$/, "") + ".webp";
          const compressedFile = new File([blob], compressedName, {
            type: 'image/webp',
            lastModified: Date.now()
          });
          console.log(`[+] Image compressed: ${(file.size / 1024).toFixed(0)} KB -> ${(compressedFile.size / 1024).toFixed(0)} KB`);
          resolve(compressedFile);
        }, 'image/webp', quality);
      };
      img.onerror = () => resolve(file);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

// ---------------- CLIENT-SIDE VIDEO COMPRESSION ----------------
async function compressVideo(file) {
  return new Promise((resolve) => {
    if (!window.MediaRecorder || file.size <= 100 * 1024 * 1024) {
      return resolve(file);
    }

    console.log(`[*] Video size ${(file.size / (1024 * 1024)).toFixed(1)} MB exceeds 100 MB. Starting client-side compression...`);

    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      let width = video.videoWidth || 1280;
      let height = video.videoHeight || 720;
      const targetMax = 1280;

      if (width > targetMax || height > targetMax) {
        if (width > height) {
          height = Math.round((height * targetMax) / width);
          width = targetMax;
        } else {
          width = Math.round((width * targetMax) / height);
          height = targetMax;
        }
      }

      width = width % 2 === 0 ? width : width - 1;
      height = height % 2 === 0 ? height : height - 1;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(30);

      let mimeType = 'video/webm;codecs=vp8,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }

      const recorder = new MediaRecorder(stream, {
        mimeType: mimeType,
        videoBitsPerSecond: 2200000 // ~2.2 Mbps
      });

      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        const compressedName = file.name.replace(/\.[^/.]+$/, '') + '_compressed.webm';
        const compressedFile = new File([blob], compressedName, {
          type: 'video/webm',
          lastModified: Date.now()
        });
        console.log(`[+] Video compressed: ${(file.size / (1024 * 1024)).toFixed(1)} MB -> ${(compressedFile.size / (1024 * 1024)).toFixed(1)} MB`);
        URL.revokeObjectURL(video.src);
        resolve(compressedFile);
      };

      recorder.start(100);
      video.play();

      function drawFrame() {
        if (!video.paused && !video.ended) {
          ctx.drawImage(video, 0, 0, width, height);
          requestAnimationFrame(drawFrame);
        }
      }
      drawFrame();

      video.onended = () => {
        if (recorder.state === 'recording') recorder.stop();
      };

      setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, (video.duration + 5) * 1000);
    };

    video.onerror = () => resolve(file);
  });
}

// ---------------- EMOJI & STICKER RENDERERS ----------------
function renderEmojiTab() {
  const body = document.getElementById('emoji-picker-body');
  if (!body) return;
  body.innerHTML = '';

  EMOJI_CATEGORIES.forEach(cat => {
    const title = document.createElement('div');
    title.className = 'emoji-category-title';
    title.textContent = cat.name;
    body.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'emoji-grid';

    cat.emojis.forEach(emo => {
      const item = document.createElement('div');
      item.className = 'emoji-item';
      item.textContent = emo;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        insertEmojiAtCursor(emo);
      });
      grid.appendChild(item);
    });

    body.appendChild(grid);
  });
}

function renderStickerTab() {
  const body = document.getElementById('emoji-picker-body');
  if (!body) return;
  body.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'sticker-grid';

  STICKERS.forEach(stk => {
    const item = document.createElement('div');
    item.className = 'sticker-item';
    item.textContent = stk;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      sendMessage({ type: 'text', text: stk });
      const popover = document.getElementById('emoji-picker-popover');
      if (popover) popover.style.display = 'none';
    });
    grid.appendChild(item);
  });

  body.appendChild(grid);
}

function insertEmojiAtCursor(emoji) {
  const input = document.getElementById('message-input');
  if (!input) return;

  const start = input.selectionStart !== undefined ? input.selectionStart : input.value.length;
  const end = input.selectionEnd !== undefined ? input.selectionEnd : input.value.length;
  const original = input.value;

  input.value = original.substring(0, start) + emoji + original.substring(end);
  input.selectionStart = input.selectionEnd = start + emoji.length;
  input.focus();

  // Auto resize textarea height and show send button
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  const btnVoice = document.getElementById('btn-record-voice');
  const btnSend = document.getElementById('btn-send');
  if (btnVoice && btnSend) {
    btnVoice.style.display = 'none';
    btnSend.style.display = 'flex';
  }
}

// ---------------- UPLOAD PROGRESS INDICATORS ----------------
function showUploadProgress(text = 'Envoi du fichier en cours...') {
  const banner = document.getElementById('upload-progress-banner');
  const textEl = document.getElementById('upload-progress-text');
  if (banner && textEl) {
    textEl.textContent = text;
    banner.style.display = 'flex';
  }
}

function updateUploadProgressText(text) {
  const textEl = document.getElementById('upload-progress-text');
  if (textEl) textEl.textContent = text;
}

function hideUploadProgress() {
  const banner = document.getElementById('upload-progress-banner');
  if (banner) banner.style.display = 'none';
}

// ---------------- MULTIPART FILE UPLOADER ----------------
async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/api/upload', {
    method: 'POST',
    body: formData
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Échec de l\'envoi du fichier');
  }
  return data;
}

// ---------------- UNIVERSAL WAV AUDIO RECORDER (Ultra-Lightweight 16kHz PCM) ----------------

function downsampleBuffer(buffer, inputSampleRate, outputSampleRate = 16000) {
  if (outputSampleRate >= inputSampleRate) {
    return buffer;
  }
  const sampleRateRatio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    let accum = 0, count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  // RIFF header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // SubChunk1Size (16 for PCM)
  view.setUint16(20, 1, true);  // AudioFormat (1 for PCM)
  view.setUint16(22, 1, true);  // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true); // SampleRate (16000 Hz)
  view.setUint32(28, sampleRate * 2, true); // ByteRate (16000 * 2)
  view.setUint16(32, 2, true);  // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample (16 bits)
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true); // SubChunk2Size

  // 16-bit PCM audio samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}

let audioRecordCtx = null;
let scriptNode = null;
let micSource = null;
let pcmBuffers = [];

async function startVoiceRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    audioRecordCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioRecordCtx.state === 'suspended') {
      await audioRecordCtx.resume();
    }

    micSource = audioRecordCtx.createMediaStreamSource(stream);
    scriptNode = audioRecordCtx.createScriptProcessor(4096, 1, 1);
    pcmBuffers = [];

    scriptNode.onaudioprocess = (e) => {
      if (!voiceRecorder.isRecording) return;
      const input = e.inputBuffer.getChannelData(0);
      pcmBuffers.push(new Float32Array(input));
    };

    micSource.connect(scriptNode);
    scriptNode.connect(audioRecordCtx.destination);

    voiceRecorder.stream = stream;
    voiceRecorder.isRecording = true;
    voiceRecorder.startTime = Date.now();

    // UI Switches
    document.getElementById('normal-composer-pill').style.display = 'none';
    document.getElementById('voice-recording-panel').style.display = 'flex';

    const timerEl = document.getElementById('recording-timer');
    timerEl.textContent = '00:00';
    voiceRecorder.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - voiceRecorder.startTime) / 1000);
      const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const secs = String(elapsed % 60).padStart(2, '0');
      timerEl.textContent = `${mins}:${secs}`;
    }, 1000);

  } catch (err) {
    alert('Accès au microphone refusé ou non disponible. Veuillez autoriser le microphone dans votre navigateur.');
  }
}

function cancelVoiceRecording() {
  if (voiceRecorder.isRecording) {
    clearInterval(voiceRecorder.timerInterval);
    voiceRecorder.isRecording = false;
    if (scriptNode) {
      scriptNode.disconnect();
      scriptNode = null;
    }
    if (micSource) {
      micSource.disconnect();
      micSource = null;
    }
    if (voiceRecorder.stream) {
      voiceRecorder.stream.getTracks().forEach(t => t.stop());
      voiceRecorder.stream = null;
    }
    if (audioRecordCtx) {
      audioRecordCtx.close().catch(() => {});
      audioRecordCtx = null;
    }
    pcmBuffers = [];
  }
  document.getElementById('voice-recording-panel').style.display = 'none';
  document.getElementById('normal-composer-pill').style.display = 'flex';
}

async function stopAndSendVoiceRecording() {
  if (!voiceRecorder.isRecording) return;

  clearInterval(voiceRecorder.timerInterval);
  const durationSec = Math.max(1, Math.floor((Date.now() - voiceRecorder.startTime) / 1000));
  voiceRecorder.isRecording = false;

  try {
    if (scriptNode) {
      scriptNode.disconnect();
      scriptNode = null;
    }
    if (micSource) {
      micSource.disconnect();
      micSource = null;
    }
    if (voiceRecorder.stream) {
      voiceRecorder.stream.getTracks().forEach(t => t.stop());
      voiceRecorder.stream = null;
    }

    // Merge PCM audio buffers
    let totalLength = 0;
    for (const buf of pcmBuffers) totalLength += buf.length;
    const mergedPcm = new Float32Array(totalLength);
    let offset = 0;
    for (const buf of pcmBuffers) {
      mergedPcm.set(buf, offset);
      offset += buf.length;
    }

    const inputSampleRate = audioRecordCtx ? audioRecordCtx.sampleRate : 44100;
    if (audioRecordCtx) {
      audioRecordCtx.close().catch(() => {});
      audioRecordCtx = null;
    }

    // Downsample to 16kHz mono for ultra-lightweight and instant transmission
    const targetSampleRate = 16000;
    const downsampledPcm = downsampleBuffer(mergedPcm, inputSampleRate, targetSampleRate);

    const wavBlob = encodeWAV(downsampledPcm, targetSampleRate);
    const audioFile = new File([wavBlob], `voice_${Date.now()}.wav`, { type: 'audio/wav' });

    const uploaded = await uploadFile(audioFile);

    sendMessage({
      type: 'audio',
      url: uploaded.url,
      duration: durationSec
    });
  } catch (err) {
    alert('Erreur lors de l\'envoi de la note vocale : ' + err.message);
  } finally {
    document.getElementById('voice-recording-panel').style.display = 'none';
    document.getElementById('normal-composer-pill').style.display = 'flex';
  }
}

async function loadContacts() {
  try {
    const res = await authFetch('/api/contacts');
    if (res.ok) {
      const data = await res.json();
      state.contacts = data.contacts || [];
      if (window.digiStore) {
        window.digiStore.saveContacts(state.contacts).catch(() => {});
      }
    } else if (window.digiStore) {
      state.contacts = await window.digiStore.getContacts();
    }
  } catch (err) {
    console.error('[-] Error loading contacts from network, using offline store:', err);
    if (window.digiStore) {
      try {
        state.contacts = await window.digiStore.getContacts();
      } catch (e) {}
    }
  }

  state.contacts.forEach(c => {
    if (c.unreadCount !== undefined && (!state.activeContact || String(state.activeContact.id) !== String(c.id))) {
      state.unreadCounts[c.id] = c.unreadCount;
    } else if (state.activeContact && String(state.activeContact.id) === String(c.id)) {
      state.unreadCounts[c.id] = 0;
    }
  });
  renderContactsList();

  // Restore active salon, contact, or support session from URL
  const urlParams = new URLSearchParams(window.location.search);
  const urlSalon = urlParams.get('salon') || urlParams.get('salonId');
  const urlChannel = urlParams.get('channel');
  const urlSender = urlParams.get('sender') || urlParams.get('senderId');

  if (urlSalon) {
    switchTab('salons').then(() => {
      const found = state.salons.find(s => String(s.id) === String(urlSalon));
      if (found) selectSalon(found);
    });
    return;
  }

  if (urlChannel === 'support' || urlParams.get('support')) {
    if (urlSender) {
      window.openSupportConversationBySenderId(urlSender);
      return;
    } else {
      switchTab('support');
      return;
    }
  }

  // Handle direct invite link (?invite=username)
  const inviteUsername = urlParams.get('invite') || localStorage.getItem('digicom_pending_invite');
  if (inviteUsername) {
    localStorage.setItem('digicom_pending_invite', inviteUsername);
    if (state.user) {
      (async () => {
        try {
          const cleanName = inviteUsername.trim().replace(/^@/, '');
          const res = await authFetch('/api/contacts/accept-invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: cleanName })
          });
          if (res.ok) {
            const data = await res.json();
            localStorage.removeItem('digicom_pending_invite');
            await loadContacts();
            if (data.contact) {
              const contactToSelect = state.contacts.find(c => c.id === data.contact.id);
              if (contactToSelect) selectContact(contactToSelect);
            }
          }
        } catch (e) {}
      })();
    }
  }

  const targetContactId = urlParams.get('contact') || localStorage.getItem('digicom_active_contact');
  if (targetContactId) {
    const found = state.contacts.find(c => String(c.id) === String(targetContactId));
    if (found) {
      selectContact(found);
      return;
    }
  }
}

function renderContactSearchResults(users) {
  const container = document.getElementById('contact-search-results');
  if (!container) return;

  if (!users || users.length === 0) {
    container.innerHTML = `
      <div class="contact-search-placeholder">
        <div class="placeholder-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
        </div>
        <div>Aucun utilisateur trouvé avec ce pseudo.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  users.forEach(u => {
    const item = document.createElement('div');
    item.className = 'user-search-row';
    const isContact = Boolean(u.is_contact);

    if (isContact) {
      item.innerHTML = `
        <div class="user-meta-left">
          <div class="user-avatar-sm">${(u.display_name || u.username).charAt(0).toUpperCase()}</div>
          <div>
            <div class="user-name-title">${escapeHtml(u.display_name || u.username)}</div>
            <div class="user-username-subtitle">@${escapeHtml(u.username)}</div>
          </div>
        </div>
        <div class="badge-already-contact" style="display: inline-flex; align-items: center; gap: 4px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          Dans vos contacts
        </div>
      `;
    } else {
      item.innerHTML = `
        <div class="user-meta-left">
          <div class="user-avatar-sm">${(u.display_name || u.username).charAt(0).toUpperCase()}</div>
          <div>
            <div class="user-name-title">${escapeHtml(u.display_name || u.username)}</div>
            <div class="user-username-subtitle">@${escapeHtml(u.username)}</div>
          </div>
        </div>
        <button type="button" class="btn-add-searched-user" data-user-id="${u.id}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 3px; vertical-align: middle;">
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="8.5" cy="7.5" r="4"></circle>
            <line x1="20" y1="8" x2="20" y2="14"></line>
            <line x1="23" y1="11" x2="17" y2="11"></line>
          </svg>
          Ajouter
        </button>
      `;

      const addBtn = item.querySelector('.btn-add-searched-user');
      addBtn.addEventListener('click', async () => {
        try {
          addBtn.disabled = true;
          const res = await authFetch('/api/contacts/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contactId: u.id })
          });
          if (res.ok) {
            const parent = addBtn.parentElement;
            if (parent) {
              parent.innerHTML = `
                <div class="badge-already-contact" style="display: inline-flex; align-items: center; gap: 4px;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  Dans vos contacts
                </div>
              `;
            }
            loadContacts();
          } else {
            const data = await res.json();
            alert(data.error || 'Erreur lors de l\'ajout');
            addBtn.disabled = false;
            addBtn.style.opacity = '1';
            addBtn.innerHTML = '<span>+ Ajouter</span>';
          }
        } catch (e) {
          alert('Erreur lors de l\'ajout du contact');
          addBtn.disabled = false;
          addBtn.style.opacity = '1';
          addBtn.innerHTML = '<span>+ Ajouter</span>';
        }
      });
    }

    container.appendChild(item);
  });
}

function getLastMessagePreview(contactId) {
  const history = state.directMessages[contactId];
  if (!history || history.length === 0) {
    return '';
  }

  const lastMsg = history[history.length - 1];
  const isMe = lastMsg.senderId === state.user.id || lastMsg.sender_id === state.user.id;
  const prefix = isMe ? 'Vous : ' : '';

  let parsed = null;
  if (typeof lastMsg.content === 'object' && lastMsg.content !== null) {
    parsed = lastMsg.content;
  } else if (typeof lastMsg.content === 'string') {
    try {
      parsed = JSON.parse(lastMsg.content);
    } catch (e) {
      parsed = { text: lastMsg.content };
    }
  }

  let text = '';
  if (parsed && parsed.type === 'image') text = 'Photo';
  else if (parsed && parsed.type === 'video') text = 'Vidéo';
  else if (parsed && parsed.type === 'audio') text = 'Note vocale';
  else if (parsed && parsed.type === 'file') text = `Fichier: ${parsed.fileName || 'Document'}`;
  else text = (parsed && parsed.text !== undefined) ? String(parsed.text) : String(lastMsg.content || '');

  while (typeof text === 'string' && (text.startsWith('{"') || text.startsWith('{&quot;'))) {
    try {
      const inner = JSON.parse(text.replace(/&quot;/g, '"'));
      text = inner.text || inner.previewText || text;
    } catch (e) {
      break;
    }
  }

  const snippet = text.length > 30 ? text.substring(0, 30) + '...' : text;
  return `${prefix}${snippet}`;
}

function renderContactsList() {
  const container = document.getElementById('contacts-list-container');
  if (!container || state.activeTab !== 'contacts') return;

  container.innerHTML = '';
  if (state.contacts.length === 0) {
    container.innerHTML = `
      <div style="padding: 1.5rem; font-size: 0.85rem; color: var(--text-dim); text-align: center;">
        Aucun contact pour le moment.<br>
        ${state.user.role === 'admin' ? 'Cliquez sur l\'icône en haut pour ajouter un membre.' : 'Votre administrateur ajoutera bientôt des contacts.'}
      </div>
    `;
    return;
  }

  // Priority sorting: Online users at top, then unread messages, then alphabetical
  const sortedContacts = [...state.contacts].sort((a, b) => {
    const aOnline = state.onlineUserIds.includes(a.id);
    const bOnline = state.onlineUserIds.includes(b.id);
    if (aOnline && !bOnline) return -1;
    if (!aOnline && bOnline) return 1;

    const aUnread = state.unreadCounts[a.id] || 0;
    const bUnread = state.unreadCounts[b.id] || 0;
    if (aUnread > 0 && bUnread === 0) return -1;
    if (aUnread === 0 && bUnread > 0) return 1;

    return (a.display_name || a.username || '').localeCompare(b.display_name || b.username || '');
  });

  const query = (state.searchQuery || '').trim().toLowerCase();
  let contactsToRender = sortedContacts;
  if (query) {
    contactsToRender = sortedContacts.filter(c => {
      const name = (c.display_name || c.username || '').toLowerCase();
      const username = (c.username || '').toLowerCase();
      const lastMsg = (getLastMessagePreview(c.id) || '').toLowerCase();
      return name.includes(query) || username.includes(query) || lastMsg.includes(query);
    });
  }

  if (contactsToRender.length === 0) {
    container.innerHTML = `
      <div style="padding: 1.5rem; font-size: 0.85rem; color: var(--text-dim); text-align: center;">
        Aucune discussion trouvée pour "${escapeHtml(state.searchQuery)}"
      </div>
    `;
    return;
  }

  contactsToRender.forEach(c => {
    const isOnline = state.onlineUserIds.includes(c.id);
    const isActive = state.activeContact && String(state.activeContact.id) === String(c.id);
    const initial = (c.display_name || c.username || '?').charAt(0).toUpperCase();
    const unreadCount = state.unreadCounts[c.id] || 0;
    const lastPreview = getLastMessagePreview(c.id);

    const item = document.createElement('div');
    item.className = `contact-card ${isActive ? 'active' : ''}`;
    item.innerHTML = `
      <div class="contact-avatar-box">
        ${initial}
        <div class="micro-dot ${isOnline ? 'online' : ''}"></div>
      </div>
      <div class="contact-details" style="min-width: 0; flex: 1;">
        <div class="contact-title" style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600;">${escapeHtml(c.display_name || c.username)}</span>
          ${unreadCount > 0 ? `<span class="contact-unread-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>` : ''}
        </div>
        <div class="contact-desc">${escapeHtml(lastPreview)}</div>
      </div>
    `;

    item.addEventListener('click', () => {
      selectContact(c);
    });

    container.appendChild(item);
  });
}

function showEmptyFeed(show, text = 'Choisissez un contact dans la liste pour démarrer votre échange 100% privé.') {
  const feed = document.getElementById('messages-feed');
  const composer = document.getElementById('chat-input-area');
  if (!feed) return;

  if (show) {
    const nameEl = document.getElementById('active-contact-name');
    if (nameEl) nameEl.textContent = 'Sélectionnez une discussion';
    const statusEl = document.getElementById('active-contact-status');
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.style.display = 'none';
    }
    const avatarEl = document.getElementById('active-contact-avatar');
    if (avatarEl) avatarEl.textContent = '?';
    const inputEl = document.getElementById('message-input');
    if (inputEl) inputEl.placeholder = 'Écrire un message...';

    feed.innerHTML = `
      <div class="empty-state" id="empty-feed-placeholder">
        <div class="empty-icon">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </div>
        <h3>Messagerie Privée Sécurisée</h3>
        <p>${escapeHtml(text)}</p>
      </div>
    `;
    if (composer) composer.style.display = 'none';
  } else {
    if (composer) composer.style.display = 'block';
  }
}

function selectContact(contact) {
  if (!contact) return;

  if (state.socket) {
    if (state.activeSalon) {
      state.socket.emit('leave_active_chat', { partnerId: state.activeSalon.id });
    }
    if (state.activeContact && String(state.activeContact.id) !== String(contact.id)) {
      state.socket.emit('leave_active_chat', { partnerId: state.activeContact.id });
    }
    state.socket.emit('enter_active_chat', { partnerId: contact.id });
    state.socket.emit('mark_read', { senderId: contact.id });
  }

  hideMentionsPopover();
  state.activeContact = contact;
  state.activeSalon = null;
  state.activeSalonMembers = [];
  state.activeSupportSession = null;
  state.activeTab = 'contacts';
  state.unreadCounts[contact.id] = 0;
  localStorage.setItem('digicom_active_contact', contact.id);

  // Reset scroll unread badge
  const scrollBadge = document.getElementById('scroll-unread-badge');
  if (scrollBadge) {
    scrollBadge.textContent = '0';
    scrollBadge.style.display = 'none';
  }

  // Open mobile chat view
  document.body.classList.add('mobile-chat-open');

  // Immediately clear feed container so no messages from previous contact remain visible
  const feed = document.getElementById('messages-feed');
  if (feed) {
    feed.innerHTML = '';
  }

  // Update top bar avatar initial & names
  const avatarEl = document.getElementById('active-contact-avatar');
  if (avatarEl) {
    const initial = (contact.display_name || contact.username || '?').charAt(0).toUpperCase();
    avatarEl.textContent = initial;
  }
  const nameEl = document.getElementById('active-contact-name');
  if (nameEl) {
    nameEl.textContent = contact.display_name || contact.username;
  }
  const statusEl = document.getElementById('active-contact-status');
  if (statusEl) {
    statusEl.textContent = '';
    statusEl.style.display = 'none';
  }
  updateActiveContactStatus();

  // Update composer placeholder
  const inputEl = document.getElementById('message-input');
  if (inputEl) {
    inputEl.placeholder = `Écrire à ${contact.display_name || contact.username}...`;
  }

  // Show composer and call actions
  const composer = document.getElementById('chat-input-area');
  if (composer) composer.style.display = 'block';
  const callActions = document.getElementById('chat-header-call-actions');
  if (callActions) callActions.style.display = 'flex';

  renderContactsList();
  loadDirectHistory(contact.id);
}

function updateActiveContactStatus() {
  const dotEl = document.getElementById('active-contact-status-dot');
  const statusEl = document.getElementById('active-contact-status');
  if (!dotEl || !state.activeContact) return;

  const isOnline = state.onlineUserIds.includes(state.activeContact.id);
  dotEl.className = `status-dot-overlay ${isOnline ? 'online' : 'offline'}`;
  dotEl.removeAttribute('title');
  if (statusEl && state.activeTab === 'contacts') {
    statusEl.textContent = '';
    statusEl.style.display = 'none';
  }
}

async function loadDirectHistory(targetUserId) {
  const feed = document.getElementById('messages-feed');

  // 1. Instant local offline load from IndexedDB
  if (window.digiStore && state.user) {
    try {
      const cachedMsgs = await window.digiStore.getMessages(state.user.id, targetUserId);
      if (cachedMsgs && cachedMsgs.length > 0) {
        state.directMessages[targetUserId] = cachedMsgs;
        if (state.activeContact && String(state.activeContact.id) === String(targetUserId)) {
          renderDirectFeed(targetUserId);
        }
      }
    } catch (e) {}
  }

  if (feed && (!state.directMessages[targetUserId] || state.directMessages[targetUserId].length === 0)) {
    feed.innerHTML = '<div style="margin: auto; color: var(--text-dim); font-size: 0.85rem; text-align: center;">Chargement de vos messages...</div>';
  }

  try {
    const res = await authFetch(`/api/history/direct/${targetUserId}`);
    if (res.ok) {
      const data = await res.json();
      state.directMessages[targetUserId] = data.messages || [];
      state.unreadCounts[targetUserId] = 0;
      if (window.digiStore) {
        window.digiStore.saveMessagesBatch(state.directMessages[targetUserId]).catch(() => {});
      }
      renderContactsList();
      if (state.activeContact && String(state.activeContact.id) === String(targetUserId)) {
        renderDirectFeed(targetUserId);
        updateActiveContactStatus();
      }
    }
  } catch (err) {
    console.error('[-] Error loading direct history from network:', err);
  }
}

function safeParseDate(dateInput) {
  if (!dateInput) return new Date();
  if (dateInput instanceof Date) return dateInput;
  let str = String(dateInput).trim();
  // Normalize SQLite space-separated timestamps "YYYY-MM-DD HH:MM:SS" into ISO "YYYY-MM-DDTHH:MM:SSZ" (UTC)
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}/.test(str)) {
    str = str.replace(' ', 'T') + 'Z';
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? new Date() : d;
}

function formatMessageDateGroup(dateStr) {
  if (!dateStr) return '';
  const date = safeParseDate(dateStr);
  const now = new Date();
  
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) return "Aujourd'hui";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  if (isYesterday) return "Hier";

  const isSameYear = date.getFullYear() === now.getFullYear();
  if (isSameYear) {
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  }
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

window.startReply = function(msgId, senderName, content) {
  let previewText = '';
  let contentType = 'text';

  let parsed = content;
  if (typeof content === 'string') {
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      parsed = { type: 'text', text: content };
    }
  }

  // Recursively unwrap JSON
  while (parsed && typeof parsed.text === 'string' && (parsed.text.startsWith('{"') || parsed.text.startsWith('{&quot;'))) {
    try {
      parsed = JSON.parse(parsed.text.replace(/&quot;/g, '"'));
    } catch (e) {
      break;
    }
  }

  if (parsed && typeof parsed === 'object') {
    if (parsed.type === 'image') {
      previewText = 'Photo';
      contentType = 'image';
    } else if (parsed.type === 'video') {
      previewText = 'Vidéo';
      contentType = 'video';
    } else if (parsed.type === 'audio') {
      previewText = 'Note vocale';
      contentType = 'audio';
    } else if (parsed.type === 'file') {
      previewText = `Fichier: ${parsed.fileName || 'Document'}`;
      contentType = 'file';
    } else {
      previewText = parsed.text || '';
    }
  } else {
    previewText = String(content || '');
  }

  // Remove any leftover JSON syntax from preview text
  while (typeof previewText === 'string' && (previewText.startsWith('{"') || previewText.startsWith('{&quot;'))) {
    try {
      const inner = JSON.parse(previewText.replace(/&quot;/g, '"'));
      previewText = inner.text || inner.previewText || previewText;
    } catch (e) {
      break;
    }
  }

  state.replyingTo = {
    id: msgId,
    senderName: senderName || 'Membre',
    previewText: previewText.length > 80 ? previewText.substring(0, 80) + '...' : previewText,
    type: contentType
  };

  const replyBar = document.getElementById('chat-reply-bar');
  const replySender = document.getElementById('reply-sender-name');
  const replyText = document.getElementById('reply-text-preview');
  if (replyBar && replySender && replyText) {
    replySender.textContent = `Répondre à ${state.replyingTo.senderName}`;
    replyText.textContent = state.replyingTo.previewText;
    replyBar.style.display = 'flex';
  }

  const input = document.getElementById('message-input');
  if (input) {
    input.focus();
    input.scrollIntoView({ behavior: 'smooth' });
  }
};

window.cancelReply = function() {
  state.replyingTo = null;
  const replyBar = document.getElementById('chat-reply-bar');
  if (replyBar) replyBar.style.display = 'none';
};

window.scrollToMessage = function(targetMsgId) {
  if (!targetMsgId) return;
  const el = document.getElementById(targetMsgId);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const bubble = el.querySelector('.msg-bubble');
    if (bubble) {
      bubble.style.transition = 'box-shadow 0.3s ease';
      bubble.style.boxShadow = '0 0 0 3px var(--emerald)';
      setTimeout(() => {
        bubble.style.boxShadow = '';
      }, 1500);
    }
  }
};

window.deleteMessage = function(msgId) {
  if (!msgId) return;
  const isConfirmed = confirm('Voulez-vous vraiment supprimer ce message ?');
  if (!isConfirmed) return;

  if (state.socket) {
    state.socket.emit('delete_message', { messageId: msgId });
  }

  fetch(`/api/messages/${msgId}`, { method: 'DELETE' }).catch(() => {});
};

window.startEdit = function(msgId, plainText) {
  if (!msgId) return;
  if (window.cancelReply) window.cancelReply();

  state.editingMessage = {
    id: msgId,
    text: plainText
  };

  const editBar = document.getElementById('chat-edit-bar');
  const editText = document.getElementById('edit-text-preview');
  if (editBar && editText) {
    editText.textContent = plainText.length > 80 ? plainText.substring(0, 80) + '...' : plainText;
    editBar.style.display = 'flex';
  }

  const input = document.getElementById('message-input');
  if (input) {
    input.value = plainText;
    input.focus();
    input.scrollIntoView({ behavior: 'smooth' });
  }
};

window.cancelEdit = function() {
  state.editingMessage = null;
  const editBar = document.getElementById('chat-edit-bar');
  if (editBar) editBar.style.display = 'none';
  const input = document.getElementById('message-input');
  if (input) {
    input.value = '';
  }
};

window.currentActiveCtxMessage = null;

window.openMessageContextMenu = function(msgId, senderName, content, canDelete, msgTimestamp) {
  window.currentActiveCtxMessage = { id: msgId, senderName, content, timestamp: msgTimestamp };
  const modal = document.getElementById('msg-context-modal');
  const delBtn = document.getElementById('ctx-action-delete');
  const editBtn = document.getElementById('ctx-action-edit');
  
  const row = document.getElementById(msgId);
  const isMe = row && row.classList.contains('me');

  // 15-minute edit window check (900,000 ms)
  let isWithin15Min = true;
  if (msgTimestamp) {
    const msgTime = new Date(msgTimestamp).getTime();
    if (!isNaN(msgTime)) {
      isWithin15Min = (Date.now() - msgTime <= 15 * 60 * 1000);
    }
  }
  const canEdit = isMe && isWithin15Min;

  if (delBtn) delBtn.style.display = canDelete ? 'flex' : 'none';
  if (editBtn) editBtn.style.display = canEdit ? 'flex' : 'none';

  if (modal) modal.style.display = 'flex';
  if (navigator.vibrate) {
    try { navigator.vibrate(35); } catch (e) {}
  }
};

window.closeMessageContextMenu = function() {
  window.currentActiveCtxMessage = null;
  const modal = document.getElementById('msg-context-modal');
  if (modal) modal.style.display = 'none';
};

function scrollToBottom(smooth = false) {
  const feed = document.getElementById('messages-feed');
  if (!feed) return;
  if (smooth) {
    feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
  } else {
    feed.scrollTop = feed.scrollHeight;
  }
}

// Adapt to mobile virtual keyboard height changes
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    const feed = document.getElementById('messages-feed');
    if (feed && (document.body.classList.contains('mobile-chat-open') || state.activeContact)) {
      feed.scrollTop = feed.scrollHeight;
    }
  });
}

function renderDirectFeed(targetUserId) {
  const feed = document.getElementById('messages-feed');
  feed.innerHTML = '';

  const msgs = state.directMessages[targetUserId] || [];
  if (msgs.length === 0) {
    const emptyNotice = document.createElement('div');
    emptyNotice.style.cssText = 'margin: auto; text-align: center; color: var(--text-dim); font-size: 0.85rem;';
    emptyNotice.textContent = `Début de votre conversation privée avec ${(state.activeContact && (state.activeContact.display_name || state.activeContact.username)) || 'votre contact'}.`;
    feed.appendChild(emptyNotice);
    return;
  }

  let lastDateKey = null;
  msgs.forEach(msg => {
    try {
      const dateKey = formatMessageDateGroup(msg.timestamp);
      if (dateKey && dateKey !== lastDateKey) {
        const sep = document.createElement('div');
        sep.className = 'chat-date-separator';
        sep.dataset.dateKey = dateKey;
        sep.innerHTML = `<span>${escapeHtml(dateKey)}</span>`;
        feed.appendChild(sep);
        lastDateKey = dateKey;
      }
      appendMessageToFeed(msg, false, false, false);
    } catch (err) {
      console.error('[-] Error rendering message:', err, msg);
    }
  });

  // Guarantee instant positioning on the very latest message even with heavy images
  scrollToBottom(false);
  requestAnimationFrame(() => scrollToBottom(false));
  setTimeout(() => scrollToBottom(false), 50);
  setTimeout(() => scrollToBottom(false), 200);
  setTimeout(() => scrollToBottom(false), 600);
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function linkifyText(text) {
  if (!text) return '';
  const normalized = String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  let escaped = escapeHtml(normalized).replace(urlRegex, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="chat-link">${url}</a>`;
  });

  // Highlight @username mentions
  const currentUsername = (state.user && state.user.username) ? state.user.username.toLowerCase() : '';
  const currentDisplayName = (state.user && state.user.displayName) ? state.user.displayName.toLowerCase() : '';
  const mentionRegex = /@([a-zA-Z0-9_\-]+)/g;
  escaped = escaped.replace(mentionRegex, (match, username) => {
    const isSelf = username.toLowerCase() === currentUsername || (currentDisplayName && username.toLowerCase() === currentDisplayName);
    return `<span class="chat-mention-pill ${isSelf ? 'self-mention' : ''}" data-mention="${escapeHtml(username)}">@${escapeHtml(username)}</span>`;
  });

  return escaped.replace(/\n/g, '<br>');
}

function getOnlyEmojisCount(str) {
  if (!str) return 0;
  const trimmed = String(str).trim();
  if (!trimmed) return 0;

  const emojiRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g;
  const nonEmojiText = trimmed.replace(emojiRegex, '').replace(/[\s\uFE0F\u200D]+/g, '');
  if (nonEmojiText.length > 0) return 0;

  const matches = trimmed.match(emojiRegex);
  return matches ? matches.length : 0;
}

function appendMessageToFeed(msg, isSos = false, autoScroll = true, insertDateSep = true) {
  const feed = document.getElementById('messages-feed');
  if (!feed) return;

  if (insertDateSep) {
    const dateKey = formatMessageDateGroup(msg.timestamp);
    const dateSeps = feed.querySelectorAll('.chat-date-separator');
    const lastDateKey = dateSeps.length > 0 ? dateSeps[dateSeps.length - 1].dataset.dateKey : null;
    if (dateKey && dateKey !== lastDateKey) {
      const sep = document.createElement('div');
      sep.className = 'chat-date-separator';
      sep.dataset.dateKey = dateKey;
      sep.innerHTML = `<span>${escapeHtml(dateKey)}</span>`;
      feed.appendChild(sep);
    }
  }

  const currentUserId = state.user ? String(state.user.id || '') : '';
  const msgSenderId = String(msg.senderId || msg.sender_id || '');
  const isMe = currentUserId !== '' && msgSenderId !== '' && currentUserId === msgSenderId;
  const row = document.createElement('div');
  const msgId = msg.id || 'msg_' + Date.now();
  row.id = msgId;
  row.className = `message-row ${isMe ? 'me' : 'other'} ${isSos ? 'sos' : ''}`;

  let parsedContent = null;
  if (typeof msg.content === 'object' && msg.content !== null) {
    parsedContent = { ...msg.content };
  } else if (typeof msg.content === 'string') {
    try {
      parsedContent = JSON.parse(msg.content);
    } catch (e) {
      parsedContent = { type: 'text', text: msg.content };
    }
  }

  // Unpack nested JSON strings if present
  while (parsedContent && typeof parsedContent.text === 'string' && (parsedContent.text.startsWith('{"') || parsedContent.text.startsWith('{&quot;'))) {
    try {
      const inner = JSON.parse(parsedContent.text.replace(/&quot;/g, '"'));
      if (!parsedContent.replyTo && inner.replyTo) parsedContent.replyTo = inner.replyTo;
      if (inner.text !== undefined) parsedContent.text = inner.text;
      if (inner.type) parsedContent.type = inner.type;
      if (inner.url) parsedContent.url = inner.url;
    } catch (e) {
      break;
    }
  }

  if (msg.replyTo && !parsedContent.replyTo) {
    parsedContent.replyTo = msg.replyTo;
  }

  // Quoted reply box if replying to another message
  let quotedReplyHtml = '';
  if (parsedContent && parsedContent.replyTo) {
    let replySender = parsedContent.replyTo.senderName || 'Membre';
    let replyText = parsedContent.replyTo.previewText || parsedContent.replyTo.text || '';
    if (typeof replyText === 'string' && (replyText.startsWith('{"') || replyText.startsWith('{&quot;'))) {
      try {
        const inner = JSON.parse(replyText.replace(/&quot;/g, '"'));
        replyText = inner.text || inner.previewText || 'Message';
      } catch (e) {}
    }
    quotedReplyHtml = `
      <div class="msg-quoted-reply" onclick="scrollToMessage('${escapeHtml(parsedContent.replyTo.id)}')">
        <div class="quoted-author">${escapeHtml(replySender)}</div>
        <div class="quoted-text">${escapeHtml(replyText)}</div>
      </div>
    `;
  }

  let bodyHtml = '';
  let textContent = '';

  if (parsedContent && parsedContent.type === 'image') {
    bodyHtml = `
      <div class="chat-image-card" onclick="openLightbox('${parsedContent.url}')">
        <img src="${parsedContent.url}" alt="${escapeHtml(parsedContent.fileName || 'Image')}" loading="lazy">
      </div>
    `;
  } else if (parsedContent && parsedContent.type === 'video') {
    bodyHtml = `
      <div class="chat-video-card">
        <video src="${parsedContent.url}" controls preload="metadata" playsinline class="chat-video-player"></video>
      </div>
    `;
  } else if (parsedContent && parsedContent.type === 'file') {
    const isPdf = (parsedContent.fileName || '').toLowerCase().endsWith('.pdf') || (parsedContent.mimeType || '').includes('pdf');
    bodyHtml = `
      <a href="${parsedContent.url}" download="${escapeHtml(parsedContent.fileName || 'fichier')}" class="chat-file-card" target="_blank" rel="noopener">
        <div class="file-icon-box ${isPdf ? 'pdf' : ''}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
        </div>
        <div class="file-meta">
          <div class="file-name">${escapeHtml(parsedContent.fileName || 'Document')}</div>
          <div class="file-size">${formatBytes(parsedContent.fileSize)}</div>
        </div>
        <div class="file-download-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </div>
      </a>
    `;
  } else if (parsedContent && parsedContent.type === 'audio') {
    const audioId = 'audio_' + Math.random().toString(36).substr(2, 9);
    const durationFormatted = parsedContent.duration ? formatDuration(parsedContent.duration) : '0:00';
    bodyHtml = `
      <div class="chat-voice-note" id="box_${audioId}">
        <audio id="${audioId}" src="${parsedContent.url}" preload="metadata" playsinline webkit-playsinline
          onloadedmetadata="if(this.duration){ var el=document.getElementById('time_${audioId}'); if(el) el.textContent = '0:00 / ' + formatDuration(this.duration); }"
          ontimeupdate="updateAudioProgress('${audioId}')"
          onended="resetAudioPlayback('${audioId}')">
        </audio>
        
        <button type="button" class="voice-play-btn" onclick="toggleAudioPlay('${audioId}')" title="Lire / Pause" aria-label="Lire la note vocale">
          <svg id="icon_play_${audioId}" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
          <svg id="icon_pause_${audioId}" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="display: none;">
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
          </svg>
        </button>
        
        <div class="voice-main-content">
          <div class="voice-progress-container" onclick="seekAudio(event, '${audioId}')">
            <div class="voice-progress-bar">
              <div class="voice-progress-fill" id="fill_${audioId}"></div>
              <div class="voice-progress-thumb" id="thumb_${audioId}"></div>
            </div>
          </div>
          
          <div class="voice-meta-row">
            <span class="voice-mic-icon">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
              </svg>
            </span>
            <span class="voice-duration" id="time_${audioId}">0:00 / ${durationFormatted}</span>
          </div>
        </div>

        <button type="button" class="voice-speed-badge" id="speed_${audioId}" onclick="cycleAudioSpeed('${audioId}')" title="Vitesse de lecture">1x</button>
      </div>
    `;
  } else {
    if (parsedContent && typeof parsedContent.text === 'string') {
      textContent = parsedContent.text;
    } else if (typeof msg.content === 'string') {
      textContent = msg.content;
    } else {
      textContent = (parsedContent && parsedContent.text !== undefined) ? String(parsedContent.text) : (typeof msg.content === 'object' ? (msg.content.text || '') : String(msg.content || ''));
    }

    // Fully unwrap stringified JSON in case of nested payload
    while (typeof textContent === 'string' && (textContent.startsWith('{"') || textContent.startsWith('{&quot;'))) {
      try {
        const inner = JSON.parse(textContent.replace(/&quot;/g, '"'));
        if (inner.text !== undefined) textContent = inner.text;
        else break;
      } catch (e) {
        break;
      }
    }

    bodyHtml = linkifyText(textContent);
  }

  const timeStr = msg.timestamp ? safeParseDate(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const isImage = parsedContent && parsedContent.type === 'image';
  const rawSender = msg.senderName || msg.sender_name || 'Contact';

  const isDeletedAudit = (msg.deleted_scope === 'sender_only' || msg.deletedScope === 'sender_only') && state.user && state.user.role === 'admin';
  const auditBadgeHtml = isDeletedAudit ? `<div class="msg-deleted-badge"><span style="display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>Supprimé par le membre</span></div>` : '';

  const canDelete = isMe || (state.user && state.user.role === 'admin');
  const deleteBtnHtml = canDelete ? `
    <button type="button" class="msg-action-btn msg-btn-del" title="Supprimer ce message">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    </button>
  ` : '';

  const actionsHtml = `
    <div class="msg-actions">
      <button type="button" class="msg-action-btn msg-btn-reply" title="Répondre à ce message">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 17 4 12 9 7"></polyline>
          <path d="M20 18v-2a4 4 0 0 0-4-4H4"></path>
        </svg>
      </button>
      ${deleteBtnHtml}
    </div>
  `;

  const isRead = Boolean(msg.is_read === 1 || msg.is_read === true || msg.isRead === true);
  const isPending = msg.status === 'pending';

  const pendingClockHtml = `
    <span class="msg-status-pending" title="En attente d'envoi (hors-ligne)" style="font-size: 0.75rem; margin-left: 4px; color: #fbbf24; display: inline-flex; align-items: center;">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
    </span>
  `;

  const openEyeHtml = `
    <span class="msg-status-eye read" title="Message lu">
      <svg width="14" height="10" viewBox="0 0 16 12" fill="none">
        <path d="M8 1.5C4.5 1.5 1.5 6 1.5 6C1.5 6 4.5 10.5 8 10.5C11.5 10.5 14.5 6 14.5 6C14.5 6 11.5 1.5 8 1.5Z" stroke="#f97316" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="8" cy="6" r="2.2" fill="#f97316"/>
      </svg>
    </span>
  `;

  const closedEyeHtml = `
    <span class="msg-status-eye unread" title="Message distribué (non lu)">
      <svg width="14" height="10" viewBox="0 0 16 12" fill="none">
        <path d="M2 4.5C4 7 6.5 8.5 8 8.5C9.5 8.5 12 7 14 4.5" stroke="#8696a0" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M4 6.5L3 8M8 8.5V10M12 6.5L13 8" stroke="#8696a0" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </span>
  `;

  const eyeIconHtml = isPending ? pendingClockHtml : (isRead ? openEyeHtml : closedEyeHtml);
  const isEdited = Boolean(msg.is_edited === 1 || msg.is_edited === true || msg.isEdited === true);
  const editedTagHtml = isEdited ? `<span class="msg-edited-tag">modifié</span>` : '';

  const metaHtml = `
    <span class="msg-meta">
      ${editedTagHtml}
      <span class="msg-meta-time">${timeStr}</span>
      ${isMe ? eyeIconHtml : ''}
    </span>
  `;

  const contentType = parsedContent ? parsedContent.type : 'text';
  const isMediaBubble = contentType === 'image' || contentType === 'video' || contentType === 'file';

  let emojiClass = '';
  if (!isMediaBubble && contentType !== 'audio') {
    const emojiCount = getOnlyEmojisCount(textContent);
    if (emojiCount >= 1 && emojiCount <= 3) {
      emojiClass = `emoji-only-bubble emoji-only-${emojiCount}`;
    }
  }

  const bubbleTypeClass = isMediaBubble ? `${contentType}-bubble media-bubble` : emojiClass;

  row.innerHTML = `
    <span class="msg-sender">${escapeHtml(rawSender)}</span>
    <div style="display: inline-flex; align-items: center; gap: 0.25rem; ${isMe ? 'flex-direction: row;' : 'flex-direction: row-reverse;'} width: fit-content; max-width: 100%;">
      ${actionsHtml}
      <div class="msg-bubble ${bubbleTypeClass}">
        ${auditBadgeHtml}
        ${quotedReplyHtml}
        ${bodyHtml}
        ${metaHtml}
      </div>
    </div>
  `;

  const replyBtn = row.querySelector('.msg-btn-reply');
  if (replyBtn) {
    replyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startReply(msgId, rawSender, msg.content);
    });
  }

  const delBtn = row.querySelector('.msg-btn-del');
  if (delBtn) {
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteMessage(msgId);
    });
  }

  // Long press timer & Fluid Swipe-to-Reply Gesture (Touch & Desktop Mouse Drag)
  let startX = 0;
  let startY = 0;
  let isSwiping = false;
  let swipeDirectionLocked = null; // null = undecided, true = locked to vertical scroll, false = locked to horizontal swipe
  let hasVibrated = false;
  let longPressTimer = null;
  let indicatorEl = null;

  const bubbleEl = row.querySelector('.msg-bubble');

  const onGestureStart = (clientX, clientY) => {
    startX = clientX;
    startY = clientY;
    isSwiping = false;
    swipeDirectionLocked = null;
    hasVibrated = false;
    row.style.transition = 'none';

    if (!indicatorEl) {
      indicatorEl = document.createElement('div');
      indicatorEl.className = 'swipe-reply-indicator';
      indicatorEl.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 0 0-4-4H4"></path></svg>`;
      row.insertBefore(indicatorEl, row.firstChild);
    }

    longPressTimer = setTimeout(() => {
      if (!isSwiping) {
        if (navigator.vibrate) {
          try { navigator.vibrate(40); } catch (err) {}
        }
        openMessageContextMenu(msgId, rawSender, msg.content, canDelete, msg.timestamp);
      }
    }, 520);
  };

  const onGestureMove = (clientX, clientY) => {
    const deltaX = clientX - startX;
    const deltaY = clientY - startY;

    // Immediately cancel long-press menu timer if user starts scrolling or moving
    if (Math.abs(deltaX) > 6 || Math.abs(deltaY) > 6) {
      clearTimeout(longPressTimer);
    }

    if (swipeDirectionLocked === null) {
      if (Math.abs(deltaY) > Math.abs(deltaX) || deltaX < -5) {
        swipeDirectionLocked = true;
      } else if (deltaX > 8 && Math.abs(deltaX) > Math.abs(deltaY)) {
        clearTimeout(longPressTimer);
        swipeDirectionLocked = false;
        isSwiping = true;
      }
    }

    if (swipeDirectionLocked === true) return;

    if (isSwiping && deltaX > 0) {
      clearTimeout(longPressTimer);
      const dampedX = Math.min(deltaX * 0.55, 75);
      row.style.transform = `translateX(${dampedX}px)`;

      if (indicatorEl) {
        const opacity = Math.min(dampedX / 30, 1);
        const scale = Math.min(0.5 + (dampedX / 75), 1.0);
        indicatorEl.style.opacity = opacity;
        indicatorEl.style.transform = `translateY(-50%) scale(${scale})`;

        if (dampedX >= 48) {
          indicatorEl.classList.add('swipe-active');
          if (!hasVibrated) {
            hasVibrated = true;
            if (navigator.vibrate) {
              try { navigator.vibrate(30); } catch (err) {}
            }
          }
        } else {
          indicatorEl.classList.remove('swipe-active');
          hasVibrated = false;
        }
      }
    }
  };

  const onGestureEnd = () => {
    clearTimeout(longPressTimer);
    if (!isSwiping) return;

    row.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.9, 0.3, 1.25)';
    row.style.transform = 'translateX(0px)';

    if (indicatorEl) {
      indicatorEl.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      indicatorEl.style.opacity = '0';
      indicatorEl.style.transform = 'translateY(-50%) scale(0.5)';
      indicatorEl.classList.remove('swipe-active');
    }

    if (hasVibrated) {
      startReply(msgId, rawSender, msg.content);
    }

    setTimeout(() => {
      row.style.transition = '';
      row.style.transform = '';
      if (indicatorEl) {
        indicatorEl.style.transition = '';
      }
      isSwiping = false;
      swipeDirectionLocked = null;
      hasVibrated = false;
    }, 260);
  };

  // Touch Event Listeners (Mobile)
  row.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches[0]) {
      onGestureStart(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: true });

  row.addEventListener('touchmove', (e) => {
    if (e.touches && e.touches[0]) {
      onGestureMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: true });

  row.addEventListener('touchend', onGestureEnd, { passive: true });
  row.addEventListener('touchcancel', onGestureEnd, { passive: true });

  // Mouse Drag Event Listeners (Desktop)
  let isMouseDown = false;
  row.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button') || e.target.closest('a') || e.target.closest('img')) return;
    isMouseDown = true;
    onGestureStart(e.clientX, e.clientY);
  });
  window.addEventListener('mousemove', (e) => {
    if (!isMouseDown) return;
    onGestureMove(e.clientX, e.clientY);
  });
  window.addEventListener('mouseup', () => {
    if (!isMouseDown) return;
    isMouseDown = false;
    onGestureEnd();
  });

  // Context menu on right-click (desktop) / true long press (mobile)
  if (bubbleEl) {
    bubbleEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openMessageContextMenu(msgId, rawSender, msg.content, canDelete, msg.timestamp);
    });
  }

  if (parsedContent && parsedContent.type === 'image') {
    const imgEl = row.querySelector('.chat-image-card img');
    if (imgEl) {
      imgEl.addEventListener('load', () => {
        if (autoScroll || (feed.scrollHeight - feed.scrollTop - feed.clientHeight < 500)) {
          scrollToBottom(false);
        }
      });
    }
  }

  feed.appendChild(row);

  // Bind audio element events
  if (parsedContent && parsedContent.type === 'audio') {
    const audioEl = row.querySelector('audio');
    if (audioEl) {
      setupAudioPlayer(audioEl.id);
    }
  }

  if (autoScroll) {
    scrollToBottom(false);
    requestAnimationFrame(() => scrollToBottom(false));
    setTimeout(() => scrollToBottom(false), 50);
  }
}

function formatDuration(sec) {
  if (!sec || isNaN(sec) || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function setupAudioPlayer(audioId) {
  const audio = document.getElementById(audioId);
  const fill = document.getElementById('fill_' + audioId);
  const timeEl = document.getElementById('time_' + audioId);
  const playIcon = document.getElementById('icon_play_' + audioId);
  const pauseIcon = document.getElementById('icon_pause_' + audioId);

  if (!audio) return;

  const updateDuration = () => {
    if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
      if (timeEl && audio.paused && (!audio.currentTime || audio.currentTime === 0)) {
        timeEl.textContent = formatDuration(audio.duration);
      }
    }
  };

  audio.addEventListener('loadedmetadata', updateDuration);
  audio.addEventListener('durationchange', updateDuration);

  audio.addEventListener('timeupdate', () => {
    if (audio.duration && isFinite(audio.duration)) {
      const pct = (audio.currentTime / audio.duration) * 100;
      if (fill) fill.style.width = pct + '%';
      if (timeEl) timeEl.textContent = formatDuration(audio.currentTime);
    }
  });

  audio.addEventListener('ended', () => {
    if (playIcon) playIcon.style.display = 'block';
    if (pauseIcon) pauseIcon.style.display = 'none';
    if (fill) fill.style.width = '0%';
    if (timeEl && audio.duration && isFinite(audio.duration)) {
      timeEl.textContent = formatDuration(audio.duration);
    }
  });
}

let globalAudioCtx = null;
let currentBufferSource = null;

window.toggleAudioPlay = async function(audioId) {
  const audio = document.getElementById(audioId);
  const playIcon = document.getElementById('icon_play_' + audioId);
  const pauseIcon = document.getElementById('icon_pause_' + audioId);
  const fill = document.getElementById('fill_' + audioId);
  const timeEl = document.getElementById('time_' + audioId);

  if (!audio) return;

  if (audio.paused && !currentBufferSource) {
    // Pause any other playing audios and reset their icons
    document.querySelectorAll('audio').forEach(a => {
      if (a !== audio && !a.paused) {
        a.pause();
        const otherId = a.id;
        const otherPlay = document.getElementById('icon_play_' + otherId);
        const otherPause = document.getElementById('icon_pause_' + otherId);
        if (otherPlay) otherPlay.style.display = 'block';
        if (otherPause) otherPause.style.display = 'none';
      }
    });

    if (currentBufferSource) {
      try { currentBufferSource.stop(); } catch (e) {}
      currentBufferSource = null;
    }

    try {
      await audio.play();
      if (playIcon) playIcon.style.display = 'none';
      if (pauseIcon) pauseIcon.style.display = 'block';
    } catch (err) {
      console.warn('Native HTML5 audio playback failed, falling back to Web Audio decoder:', err);
      // Fallback: Fetch audio buffer and decode in memory via Web Audio API
      try {
        if (!globalAudioCtx) {
          globalAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (globalAudioCtx.state === 'suspended') {
          await globalAudioCtx.resume();
        }

        const res = await fetch(audio.src);
        const arrayBuf = await res.arrayBuffer();
        const decodedBuffer = await globalAudioCtx.decodeAudioData(arrayBuf);

        const source = globalAudioCtx.createBufferSource();
        source.buffer = decodedBuffer;
        source.connect(globalAudioCtx.destination);

        const startTime = globalAudioCtx.currentTime;
        const totalDuration = decodedBuffer.duration;

        source.onended = () => {
          if (playIcon) playIcon.style.display = 'block';
          if (pauseIcon) pauseIcon.style.display = 'none';
          if (fill) fill.style.width = '0%';
          if (timeEl) timeEl.textContent = formatDuration(totalDuration);
          currentBufferSource = null;
        };

        source.start(0);
        currentBufferSource = source;

        if (playIcon) playIcon.style.display = 'none';
        if (pauseIcon) pauseIcon.style.display = 'block';

        const progressTimer = setInterval(() => {
          if (!currentBufferSource) {
            clearInterval(progressTimer);
            return;
          }
          const elapsed = globalAudioCtx.currentTime - startTime;
          const pct = Math.min(100, (elapsed / totalDuration) * 100);
          if (fill) fill.style.width = pct + '%';
          if (timeEl) timeEl.textContent = formatDuration(elapsed);
        }, 100);

      } catch (fallbackErr) {
        console.error('All playback methods failed:', fallbackErr);
      }
    }
  } else {
    if (currentBufferSource) {
      try { currentBufferSource.stop(); } catch (e) {}
      currentBufferSource = null;
    }
    audio.pause();
    if (playIcon) playIcon.style.display = 'block';
    if (pauseIcon) pauseIcon.style.display = 'none';
  }
};

window.updateAudioProgress = function(audioId) {
  const audio = document.getElementById(audioId);
  const fill = document.getElementById('fill_' + audioId);
  const thumb = document.getElementById('thumb_' + audioId);
  const timeEl = document.getElementById('time_' + audioId);
  if (!audio || !audio.duration) return;

  const pct = Math.min(100, Math.max(0, (audio.currentTime / audio.duration) * 100));
  if (fill) fill.style.width = pct + '%';
  if (thumb) thumb.style.left = pct + '%';
  if (timeEl) {
    const curStr = formatDuration(audio.currentTime);
    const totStr = formatDuration(audio.duration);
    timeEl.textContent = `${curStr} / ${totStr}`;
  }
};

window.resetAudioPlayback = function(audioId) {
  const audio = document.getElementById(audioId);
  const playIcon = document.getElementById('icon_play_' + audioId);
  const pauseIcon = document.getElementById('icon_pause_' + audioId);
  const fill = document.getElementById('fill_' + audioId);
  const thumb = document.getElementById('thumb_' + audioId);
  const timeEl = document.getElementById('time_' + audioId);

  if (playIcon) playIcon.style.display = 'block';
  if (pauseIcon) pauseIcon.style.display = 'none';
  if (fill) fill.style.width = '0%';
  if (thumb) thumb.style.left = '0%';
  if (audio && timeEl && audio.duration) {
    timeEl.textContent = `0:00 / ${formatDuration(audio.duration)}`;
  }
};

window.cycleAudioSpeed = function(audioId) {
  const audio = document.getElementById(audioId);
  const speedBtn = document.getElementById('speed_' + audioId);
  if (!audio || !speedBtn) return;

  let currentRate = audio.playbackRate || 1.0;
  let nextRate = 1.0;
  if (currentRate === 1.0) nextRate = 1.5;
  else if (currentRate === 1.5) nextRate = 2.0;
  else nextRate = 1.0;

  audio.playbackRate = nextRate;
  speedBtn.textContent = `${nextRate}x`;
  if (nextRate > 1.0) {
    speedBtn.classList.add('active-speed');
  } else {
    speedBtn.classList.remove('active-speed');
  }
};

window.seekAudio = function(event, audioId) {
  const audio = document.getElementById(audioId);
  const bar = event.currentTarget.querySelector('.voice-progress-bar');
  if (!audio || !bar || !audio.duration) return;

  const rect = bar.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const pct = Math.max(0, Math.min(1, clickX / rect.width));
  audio.currentTime = pct * audio.duration;
  updateAudioProgress(audioId);
};

window.openLightbox = function(url) {
  const lightbox = document.getElementById('image-lightbox');
  const img = document.getElementById('lightbox-img');
  if (lightbox && img) {
    img.src = url;
    lightbox.style.display = 'flex';
  }
};

async function sendMessage(contentPayload) {
  if (state.editingMessage) {
    const editMsgId = state.editingMessage.id;
    let textToEdit = typeof contentPayload === 'string' ? contentPayload : (contentPayload && contentPayload.text ? contentPayload.text : '');
    if (textToEdit && textToEdit.trim()) {
      const cleanText = textToEdit.trim();

      // 1. Instant local optimistic update for UI and IndexedDB
      if (window.applyMessageEditLocally) {
        window.applyMessageEditLocally(editMsgId, cleanText, 1, new Date().toISOString());
      }

      // 2. Realtime Socket emit
      if (state.socket && state.socket.connected) {
        state.socket.emit('edit_message', {
          messageId: editMsgId,
          newContent: cleanText
        });
      }

      // 3. Fallback REST API request (resilience for PWA/mobile reconnects)
      authFetch(`/api/messages/${encodeURIComponent(editMsgId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newContent: cleanText })
      }).catch(() => {});
    }
    cancelEdit();
    return;
  }

  if (state.activeTab === 'contacts' && state.activeContact) {
    const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    let replyData = null;
    if (state.replyingTo) {
      replyData = { ...state.replyingTo };
      cancelReply();
    }

    let finalContent = contentPayload;
    if (typeof contentPayload === 'string') {
      finalContent = { type: 'text', text: contentPayload };
    } else if (typeof contentPayload === 'object' && contentPayload !== null) {
      finalContent = { ...contentPayload };
    }
    if (replyData) {
      finalContent.replyTo = replyData;
    }

    const isConnected = state.socket && state.socket.connected;

    const msgPayload = {
      id: msgId,
      senderId: state.user.id,
      senderName: state.user.displayName || state.user.username,
      receiverId: state.activeContact.id,
      content: finalContent,
      replyTo: replyData,
      status: isConnected ? 'sent' : 'pending',
      timestamp: new Date().toISOString()
    };

    if (window.digiStore) {
      await window.digiStore.saveMessage(msgPayload).catch(() => {});
    }

    if (isConnected) {
      state.socket.emit('private_message', msgPayload);
    } else {
      console.warn('[!] Socket offline. Message stored in Outbox queue:', msgId);
      if (window.digiStore) {
        await window.digiStore.addToOutbox(msgPayload).catch(() => {});
      }
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        navigator.serviceWorker.ready.then(reg => reg.sync.register('digicom-outbox-sync')).catch(() => {});
      }
    }

    if (!state.directMessages[state.activeContact.id]) {
      state.directMessages[state.activeContact.id] = [];
    }
    state.directMessages[state.activeContact.id].push(msgPayload);
    appendMessageToFeed(msgPayload, false, true);

  } else if (state.activeTab === 'salons' && state.activeSalon) {
    const salonId = state.activeSalon.id;
    const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    let replyData = null;
    if (state.replyingTo) {
      replyData = { ...state.replyingTo };
      cancelReply();
    }

    let finalContent = contentPayload;
    if (typeof contentPayload === 'string') {
      finalContent = { type: 'text', text: contentPayload };
    } else if (typeof contentPayload === 'object' && contentPayload !== null) {
      finalContent = { ...contentPayload };
    }
    if (replyData) {
      finalContent.replyTo = replyData;
    }

    const isConnected = state.socket && state.socket.connected;

    const msgPayload = {
      id: msgId,
      channelType: 'salon',
      channel_type: 'salon',
      salonId: salonId,
      senderId: state.user.id,
      sender_id: state.user.id,
      senderName: state.user.displayName || state.user.username,
      sender_name: state.user.displayName || state.user.username,
      receiverId: salonId,
      receiver_id: salonId,
      content: finalContent,
      replyTo: replyData,
      status: isConnected ? 'sent' : 'pending',
      timestamp: new Date().toISOString()
    };

    if (isConnected) {
      state.socket.emit('salon_message', msgPayload);
    } else {
      console.warn('[!] Socket offline in Salon. Message stored in Outbox:', msgId);
      if (window.digiStore) {
        await window.digiStore.addToOutbox(msgPayload).catch(() => {});
      }
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        navigator.serviceWorker.ready.then(reg => reg.sync.register('digicom-outbox-sync')).catch(() => {});
      }
    }

    if (!state.salonMessages[salonId]) {
      state.salonMessages[salonId] = [];
    }
    state.salonMessages[salonId].push(msgPayload);
    appendMessageToFeed(msgPayload, false, true);

  } else if (state.activeTab === 'support' && state.activeSupportSession) {
    const replyPayload = {
      targetUserId: state.activeSupportSession,
      senderName: state.user.displayName || 'Support DigiCom',
      content: contentPayload
    };

    state.socket.emit('admin_reply', replyPayload);
  }
}

async function flushOutbox() {
  if (!state.socket || !state.socket.connected || !window.digiStore) return;

  try {
    const pendingMsgs = await window.digiStore.getOutbox();
    if (!pendingMsgs || pendingMsgs.length === 0) return;

    console.log(`[+] Flushing ${pendingMsgs.length} offline pending messages...`);

    for (const msg of pendingMsgs) {
      msg.status = 'sent';
      if (msg.channelType === 'salon' || msg.channel_type === 'salon') {
        state.socket.emit('salon_message', msg);
      } else {
        state.socket.emit('private_message', msg);
      }
      await window.digiStore.saveMessage(msg);
      await window.digiStore.removeFromOutbox(msg.id);

      const el = document.getElementById(msg.id);
      if (el) {
        const pendingBadge = el.querySelector('.msg-status-pending');
        if (pendingBadge) {
          pendingBadge.outerHTML = `
            <span class="msg-status-eye unread" title="Message distribué (non lu)">
              <svg width="14" height="10" viewBox="0 0 16 12" fill="none">
                <path d="M2 4.5C4 7 6.5 8.5 8 8.5C9.5 8.5 12 7 14 4.5" stroke="#8696a0" stroke-width="1.5" stroke-linecap="round"/>
                <path d="M4 6.5L3 8M8 8.5V10M12 6.5L13 8" stroke="#8696a0" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </span>
          `;
        }
      }
    }
  } catch (err) {
    console.error('[-] Error flushing outbox:', err);
  }
}

async function switchTab(tab) {
  if (tab !== 'salons' && state.activeSalon && state.socket) {
    state.socket.emit('leave_active_chat', { partnerId: state.activeSalon.id });
    state.activeSalon = null;
  }
  if (tab !== 'contacts' && state.activeContact && state.socket) {
    state.socket.emit('leave_active_chat', { partnerId: state.activeContact.id });
    state.activeContact = null;
  }
  if (tab !== 'support' && state.activeSupportSession && state.socket) {
    state.socket.emit('leave_active_chat', { partnerId: 'admin_' + state.activeSupportSession });
    state.activeSupportSession = null;
  }

  const mentionsPopover = document.getElementById('mentions-popover');
  if (mentionsPopover) mentionsPopover.style.display = 'none';

  state.activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

  const contactsFeed = document.getElementById('contacts-list-container');
  const salonsFeed = document.getElementById('salons-list-container');

  if (tab === 'contacts') {
    document.getElementById('tab-btn-contacts').classList.add('active');
    if (contactsFeed) contactsFeed.style.display = 'block';
    if (salonsFeed) salonsFeed.style.display = 'none';
    const cBadge = document.getElementById('contacts-badge');
    if (cBadge) {
      cBadge.textContent = '0';
      cBadge.style.display = 'none';
    }
    renderContactsList();
  } else if (tab === 'salons') {
    document.getElementById('tab-btn-salons').classList.add('active');
    if (contactsFeed) contactsFeed.style.display = 'none';
    if (salonsFeed) salonsFeed.style.display = 'block';
    const sBadge = document.getElementById('salons-badge');
    if (sBadge) {
      sBadge.textContent = '0';
      sBadge.style.display = 'none';
    }
    await loadSalons();
  } else if (tab === 'support') {
    document.getElementById('tab-btn-support').classList.add('active');
    if (contactsFeed) contactsFeed.style.display = 'block';
    if (salonsFeed) salonsFeed.style.display = 'none';
    const badge = document.getElementById('support-badge');
    if (badge) {
      badge.textContent = '0';
      badge.style.display = 'none';
    }
    await loadSupportConversations();
  }
}

async function loadSupportConversations() {
  try {
    const res = await fetch('/api/support/conversations');
    if (res.ok) {
      const data = await res.json();
      state.supportConversations = data.conversations || [];
      const totalUnreads = state.supportConversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);
      const badge = document.getElementById('support-badge');
      if (badge) {
        if (totalUnreads > 0 && state.activeTab !== 'support') {
          badge.textContent = totalUnreads > 99 ? '99+' : totalUnreads;
          badge.style.display = 'inline-block';
        } else if (totalUnreads === 0) {
          badge.textContent = '0';
          badge.style.display = 'none';
        }
      }
      if (state.activeTab === 'support') {
        renderSupportConversations();
      }
    }
  } catch (e) {
    console.error('[-] Error loading support conversations:', e);
  }
}

function renderSupportConversations() {
  const container = document.getElementById('contacts-list-container');
  if (!container || state.activeTab !== 'support') return;

  container.innerHTML = '';
  if (state.supportConversations.length === 0) {
    container.innerHTML = '<div style="padding: 1.5rem; font-size: 0.85rem; color: var(--text-dim); text-align: center;">Aucun ticket SOS pour le moment.</div>';
    return;
  }

  state.supportConversations.forEach(conv => {
    let ctxTitle = '';
    if (conv.context_data) {
      try {
        const ctx = JSON.parse(conv.context_data);
        ctxTitle = ctx.courseTitle || '';
      } catch (e) {}
    }

    const studentDisplayName = (conv.sender_name && conv.sender_name.trim()) ? conv.sender_name : (conv.sender_id || 'Étudiant');
    const initial = studentDisplayName.charAt(0).toUpperCase();
    const item = document.createElement('div');
    item.className = `contact-card ${state.activeSupportSession === conv.sender_id ? 'active' : ''}`;
    item.innerHTML = `
      <div class="contact-avatar-box" style="background: linear-gradient(135deg, #e11d48 0%, #881337 100%); color: #ffffff; font-weight: 700; font-size: 1.1rem; border: 1px solid rgba(244, 63, 94, 0.4);">
        <span>${escapeHtml(initial)}</span>
        <span class="micro-dot online" style="background: #f43f5e; box-shadow: 0 0 6px #f43f5e;" title="Ticket SOS Actif"></span>
      </div>
      <div class="contact-details">
        <div class="contact-title" style="display: flex; align-items: center; justify-content: space-between;">
          <span>${escapeHtml(studentDisplayName)}</span>
          <span style="display: inline-flex; align-items: center; gap: 4px;">
            ${(conv.unread_count > 0 && state.activeSupportSession !== conv.sender_id) ? `<span class="contact-unread-badge">${conv.unread_count > 99 ? '99+' : conv.unread_count}</span>` : ''}
            <span style="font-size: 0.65rem; background: rgba(244, 63, 94, 0.18); color: #f43f5e; border: 1px solid rgba(244, 63, 94, 0.35); padding: 1px 6px; border-radius: 4px; font-weight: 700; text-transform: uppercase;">SOS</span>
          </span>
        </div>
        <div class="contact-desc">${escapeHtml(ctxTitle || 'Assistance SOS')}</div>
      </div>
    `;

    item.addEventListener('click', () => {
      window.openSupportConversationBySenderId(conv.sender_id);
    });

    container.appendChild(item);
  });
}

window.openSupportConversationBySenderId = async function(senderId) {
  if (state.socket) {
    if (state.activeContact) {
      state.socket.emit('leave_active_chat', { partnerId: state.activeContact.id });
    }
    if (state.activeSalon) {
      state.socket.emit('leave_active_chat', { partnerId: state.activeSalon.id });
    }
    if (state.activeSupportSession && String(state.activeSupportSession) !== String(senderId)) {
      state.socket.emit('leave_active_chat', { partnerId: 'admin_' + state.activeSupportSession });
    }
    state.socket.emit('enter_active_chat', { partnerId: 'admin_' + senderId });
    state.socket.emit('support_mark_read', { senderId });
  }

  switchTab('support');
  state.activeSupportSession = senderId;
  state.activeContact = null;
  state.activeSalon = null;
  document.body.classList.add('mobile-chat-open');

  const mainChat = document.getElementById('main-chat');
  if (mainChat) mainChat.classList.add('mobile-active');

  let conv = (state.supportConversations || []).find(c => c.sender_id === senderId);
  if (conv) {
    conv.unread_count = 0;
  }
  renderSupportConversations();
  let studentName = conv ? conv.sender_name : (senderId || 'Formateur / Étudiant');
  let ctxTitle = 'Assistance SOS';
  if (conv && conv.context_data) {
    try {
      const ctx = typeof conv.context_data === 'string' ? JSON.parse(conv.context_data) : conv.context_data;
      ctxTitle = ctx.courseTitle || ctx.pageTitle || ctxTitle;
    } catch(e) {}
  }

  const avatarEl = document.getElementById('active-contact-avatar');
  if (avatarEl) {
    avatarEl.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"></polygon>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
    `;
  }
  const nameEl = document.getElementById('active-contact-name');
  if (nameEl) nameEl.textContent = studentName;
  const statusEl = document.getElementById('active-contact-status');
  if (statusEl) statusEl.textContent = ctxTitle ? ctxTitle : 'Ticket SOS';
  const composer = document.getElementById('chat-input-area');
  if (composer) composer.style.display = 'block';

  loadSupportHistory(senderId);
};



async function loadSupportHistory(senderId) {
  try {
    if (state.socket) {
      state.socket.emit('support_mark_read', { senderId });
    }
    const res = await fetch(`/api/history/support?senderId=${senderId}`);
    if (res.ok) {
      const data = await res.json();
      const feed = document.getElementById('messages-feed');
      feed.innerHTML = '';
      const msgs = data.messages || [];
      msgs.forEach(m => appendMessageToFeed(m, true, false));
      feed.scrollTop = feed.scrollHeight;
    }
  } catch (e) {
    console.error('[-] Error loading support history:', e);
  }
}

async function loadAdminUsers() {
  const list = document.getElementById('admin-users-list');
  if (!list) return;

  try {
    const res = await fetch('/api/users');
    if (res.ok) {
      const data = await res.json();
      list.innerHTML = data.users.map(u => {
        const isSelf = state.user && state.user.id === u.id;
        const userJson = JSON.stringify(u).replace(/"/g, '&quot;');
        return `
          <div class="admin-user-card">
            <div class="user-info-text">
              <strong>${escapeHtml(u.display_name || u.username)}</strong>
              <span class="user-username-tag">(@${escapeHtml(u.username)})</span>
              <span class="role-badge-pill ${u.role === 'admin' ? 'admin' : 'family'}">${u.role}</span>
            </div>
            <div class="user-card-actions">
              <button type="button" class="btn-card-edit" onclick="openEditUser(${userJson})">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: middle;">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                Modifier
              </button>
              ${!isSelf ? `
                <button type="button" class="btn-card-delete" onclick="deleteUser('${u.id}', '${escapeHtml(u.display_name || u.username)}')">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: middle;">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                  Supprimer
                </button>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (e) {}
}

window.openEditUser = function(user) {
  document.getElementById('edit-user-id').value = user.id;
  document.getElementById('edit-username').value = user.username;
  document.getElementById('edit-displayname').value = user.display_name || user.username;
  document.getElementById('edit-password').value = '';
  document.getElementById('edit-role').value = user.role || 'family';
  document.getElementById('edit-user-error').style.display = 'none';

  document.getElementById('edit-user-modal').style.display = 'flex';
};

window.deleteUser = async function(userId, name) {
  if (!confirm(`Voulez-vous vraiment supprimer définitivement le contact "${name}" et toutes ses discussions ?`)) {
    return;
  }

  try {
    const res = await fetch(`/api/users/${userId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur de suppression');

    alert(`Le contact "${name}" a été supprimé.`);
    loadAdminUsers();
    loadContacts();
  } catch (err) {
    alert(err.message);
  }
};

// Edit User Form submission & close
const editUserForm = document.getElementById('edit-user-form');
if (editUserForm) {
  editUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = document.getElementById('edit-user-id').value;
    const username = document.getElementById('edit-username').value.trim();
    const displayName = document.getElementById('edit-displayname').value.trim();
    const password = document.getElementById('edit-password').value;
    const role = document.getElementById('edit-role').value;
    const errBox = document.getElementById('edit-user-error');

    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, displayName, password, role })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la modification');

      alert('Contact mis à jour avec succès !');
      document.getElementById('edit-user-modal').style.display = 'none';
      loadAdminUsers();
      loadContacts();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.style.display = 'block';
    }
  });
}

const btnCloseEditModal = document.getElementById('btn-close-edit-user-modal');
if (btnCloseEditModal) {
  btnCloseEditModal.addEventListener('click', () => {
    document.getElementById('edit-user-modal').style.display = 'none';
  });
}

function showModal(id) {
  document.querySelectorAll('.modal-backdrop').forEach(m => m.style.display = 'none');
  const modal = document.getElementById(id);
  if (modal) modal.style.display = 'flex';
}

function hideModals() {
  document.querySelectorAll('.modal-backdrop').forEach(m => m.style.display = 'none');
}

function hideModal(id) {
  if (!id) {
    hideModals();
    return;
  }
  const modal = document.getElementById(id);
  if (modal) modal.style.display = 'none';
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatSalonName(name) {
  if (!name) return '#Salon';
  const clean = String(name).trim().replace(/^#+/, '');
  return `#${clean}`;
}

// PWA Direct Install & Cross-Platform Installation Guide Handling
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
});

async function handlePWAInstallAction() {
  const installBtn = document.getElementById('btn-pwa-install');
  const banner = document.getElementById('pwa-floating-banner');
  if (banner) {
    banner.classList.remove('pwa-banner-visible');
  }

  // 1. If Chrome / Android beforeinstallprompt event is available, trigger immediate native prompt!
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const choiceResult = await deferredInstallPrompt.userChoice;
    if (choiceResult.outcome === 'accepted') {
      localStorage.setItem('digicom_pwa_installed', 'true');
      if (installBtn) installBtn.style.display = 'none';
      if (banner) banner.style.display = 'none';
      showInAppToast({ title: 'Application installée !', body: 'DigiCom a été ajouté avec succès.', type: 'private' });
    }
    deferredInstallPrompt = null;
    return;
  }

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isInstalled = localStorage.getItem('digicom_pwa_installed') === 'true';

  // 2. Check if already installed & running as standalone PWA
  if (isStandalone || isInstalled) {
    if (installBtn) installBtn.style.display = 'none';
    if (banner) banner.style.display = 'none';
    showInAppToast({ title: 'Déjà installée !', body: 'L\'application DigiCom est déjà installée sur cet appareil.', type: 'private' });
    return;
  }

  // 3. Device & Browser Detection for Step-by-Step Guide
  const userAgent = window.navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(userAgent);
  const isAndroid = /android/.test(userAgent);

  const guideContent = document.getElementById('pwa-guide-content');

  let guideHtml = '';

  if (isIOS) {
    guideHtml = `
      <div class="pwa-guide-hero">
        <div class="pwa-guide-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="3" ry="3"></rect>
            <line x1="12" y1="18" x2="12.01" y2="18"></line>
          </svg>
        </div>
        <strong class="pwa-guide-title">Installation sur iPhone & iPad (Safari)</strong>
      </div>
      <ol class="pwa-guide-list">
        <li>Appuyez sur le bouton <strong>Partager</strong> <span class="pwa-guide-badge" title="Partager"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg></span> dans la barre de Safari.</li>
        <li>Faites défiler les options vers le bas.</li>
        <li>Sélectionnez <strong>"Sur l'écran d'accueil"</strong> <span class="pwa-guide-badge" title="Ajouter"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></span>.</li>
        <li>Confirmez en touchant <strong>Ajouter</strong> en haut à droite.</li>
      </ol>
    `;
  } else if (isAndroid) {
    guideHtml = `
      <div class="pwa-guide-hero">
        <div class="pwa-guide-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
            <line x1="12" y1="18" x2="12.01" y2="18"></line>
          </svg>
        </div>
        <strong class="pwa-guide-title">Installation sur Android (Chrome / Navigateur)</strong>
      </div>
      <ol class="pwa-guide-list">
        <li>Appuyez sur le menu <span class="pwa-guide-badge" title="Menu"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1.5"></circle><circle cx="12" cy="5" r="1.5"></circle><circle cx="12" cy="19" r="1.5"></circle></svg></span> en haut à droite.</li>
        <li>Sélectionnez <strong>"Installer l'application"</strong> ou <strong>"Ajouter à l'écran d'accueil"</strong> <span class="pwa-guide-badge" title="Installer"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></span>.</li>
        <li>Validez l'installation pour créer le raccourci sur votre téléphone.</li>
      </ol>
    `;
  } else {
    guideHtml = `
      <div class="pwa-guide-hero">
        <div class="pwa-guide-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
        </div>
        <strong class="pwa-guide-title">Installation sur Ordinateur (Chrome / Edge / Brave)</strong>
      </div>
      <ol class="pwa-guide-list">
        <li>Regardez dans la barre d'adresse (URL) en haut de votre navigateur.</li>
        <li>Cliquez sur l'icône <strong>Installer l'application</strong> <span class="pwa-guide-badge" title="Installer"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg></span> située à droite de l'URL.</li>
        <li>Cliquez sur <strong>Installer</strong> pour lancer DigiCom en fenêtre d'application indépendante.</li>
      </ol>
    `;
  }

  if (guideContent) {
    const parsedDoc = new DOMParser().parseFromString(guideHtml, 'text/html');
    guideContent.replaceChildren(...parsedDoc.body.childNodes);
  }

  showModal('modal-pwa-guide');
}

document.addEventListener('DOMContentLoaded', () => {
  const installBtn = document.getElementById('btn-pwa-install');
  const closeBtn = document.getElementById('btn-close-pwa-modal');
  const floatingBanner = document.getElementById('pwa-floating-banner');
  const bannerBtn = document.getElementById('btn-pwa-banner-action');

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isInstalled = localStorage.getItem('digicom_pwa_installed') === 'true';

  if (installBtn && (isStandalone || isInstalled)) {
    installBtn.style.display = 'none';
  }

  if (floatingBanner && (isStandalone || isInstalled)) {
    floatingBanner.style.display = 'none';
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', hideModals);
  }

  if (installBtn) {
    installBtn.addEventListener('click', handlePWAInstallAction);
  }

  if (bannerBtn) {
    bannerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handlePWAInstallAction();
    });
  }

  if (floatingBanner) {
    floatingBanner.addEventListener('click', () => {
      handlePWAInstallAction();
    });
  }

  // Floating banner appearance: show after 2.5s, stay for 7s, then auto-hide
  if (floatingBanner && !isStandalone && !isInstalled) {
    const hasSeenBanner = sessionStorage.getItem('digicom_banner_shown');
    if (!hasSeenBanner) {
      setTimeout(() => {
        const stillNotInstalled = localStorage.getItem('digicom_pwa_installed') !== 'true';
        const isStillBrowser = !window.matchMedia('(display-mode: standalone)').matches && window.navigator.standalone !== true;
        if (stillNotInstalled && isStillBrowser) {
          floatingBanner.classList.add('pwa-banner-visible');
          sessionStorage.setItem('digicom_banner_shown', 'true');

          // Auto-hide after 7 seconds smoothly
          setTimeout(() => {
            floatingBanner.classList.remove('pwa-banner-visible');
          }, 7000);
        }
      }, 2500);
    }
  }
});

window.addEventListener('appinstalled', () => {
  localStorage.setItem('digicom_pwa_installed', 'true');
  const installBtn = document.getElementById('btn-pwa-install');
  const floatingBanner = document.getElementById('pwa-floating-banner');
  if (installBtn) installBtn.style.display = 'none';
  if (floatingBanner) {
    floatingBanner.classList.remove('pwa-banner-visible');
    floatingBanner.style.display = 'none';
  }
  console.log('[+] DigiCom PWA was installed successfully!');
});

// ---------------- SALONS (CONFIDENTIAL GROUP WORKSPACES) LOGIC ----------------
function renderSalonMembersChecklist() {
  const container = document.getElementById('salon-members-checklist');
  if (!container) return;

  container.innerHTML = '';
  if (state.contacts.length === 0) {
    container.innerHTML = `
      <div style="font-size: 0.78rem; color: var(--text-dim); text-align: center; padding: 0.5rem;">
        Aucun contact disponible à inviter.
      </div>
    `;
    return;
  }

  state.contacts.forEach(c => {
    const name = escapeHtml(c.display_name || c.username);
    const item = document.createElement('label');
    item.className = 'salon-checklist-item';
    item.innerHTML = `
      <input type="checkbox" class="salon-member-checkbox" value="${escapeHtml(c.id)}">
      <span style="font-weight: 600; font-size: 0.82rem; color: var(--text-main);">${name}</span>
      <span style="font-size: 0.72rem; color: var(--text-dim);">(@${escapeHtml(c.username)})</span>
    `;
    container.appendChild(item);
  });
}

async function loadSalons() {
  try {
    const res = await authFetch('/api/salons');
    if (res.ok) {
      const data = await res.json();
      state.salons = data.salons || [];
      let totalSalonUnreads = 0;
      state.salons.forEach(s => {
        if (s.unread_count !== undefined && (!state.activeSalon || String(state.activeSalon.id) !== String(s.id))) {
          state.unreadSalonCounts[s.id] = s.unread_count;
        } else if (state.activeSalon && String(state.activeSalon.id) === String(s.id)) {
          state.unreadSalonCounts[s.id] = 0;
        }
        totalSalonUnreads += (state.unreadSalonCounts[s.id] || 0);
      });
      const sBadge = document.getElementById('salons-badge');
      if (sBadge) {
        if (totalSalonUnreads > 0 && state.activeTab !== 'salons') {
          sBadge.textContent = totalSalonUnreads > 99 ? '99+' : totalSalonUnreads;
          sBadge.style.display = 'inline-block';
        } else if (totalSalonUnreads === 0) {
          sBadge.textContent = '0';
          sBadge.style.display = 'none';
        }
      }
      renderSalonsList();
    }
  } catch (err) {
    console.error('[-] Error loading salons:', err);
  }
}

function renderSalonsList() {
  const container = document.getElementById('salons-cards-list');
  if (!container) return;

  container.innerHTML = '';
  if (state.salons.length === 0) {
    container.innerHTML = `
      <div style="padding: 1.5rem; font-size: 0.85rem; color: var(--text-dim); text-align: center;">
        Aucun Salon pour le moment.<br>
        Cliquez sur "Nouveau Salon" ci-dessus pour créer votre premier espace de travail confidentiel.
      </div>
    `;
    return;
  }

  state.salons.forEach(s => {
    const isActive = state.activeSalon && String(state.activeSalon.id) === String(s.id);
    const unreadCount = state.unreadSalonCounts[s.id] || 0;
    const isCreator = s.my_role === 'creator' || s.created_by === (state.user ? state.user.id : '');
    const displayName = formatSalonName(s.name);

    const card = document.createElement('div');
    card.className = `salon-card ${isActive ? 'active' : ''}`;
    card.innerHTML = `
      <div class="salon-icon-box" style="font-weight: 800; color: #10b981; font-size: 1.05rem;">#</div>
      <div class="salon-details">
        <div class="salon-title-row">
          <span class="salon-title">${escapeHtml(displayName)}</span>
          ${isCreator ? `<span class="salon-creator-tag">Admin</span>` : ''}
          ${unreadCount > 0 ? `<span class="contact-unread-badge">${unreadCount}</span>` : ''}
        </div>
        <div class="salon-desc">${escapeHtml(s.description || `${s.member_count || 1} membre(s)`)}</div>
      </div>
    `;
    card.addEventListener('click', () => selectSalon(s));
    container.appendChild(card);
  });
}

function updateSalonBlockedComposerState(isBlocked, salonName = '') {
  const inputEl = document.getElementById('message-input');
  const btnSend = document.getElementById('btn-send');
  const btnVoice = document.getElementById('btn-record-voice');
  const btnAttach = document.getElementById('btn-attach');
  const btnEmoji = document.getElementById('btn-emoji');

  if (isBlocked) {
    if (inputEl) {
      inputEl.disabled = true;
      inputEl.placeholder = "Vous avez été bloqué dans ce Salon par l'administrateur.";
      inputEl.value = '';
    }
    if (btnSend) btnSend.disabled = true;
    if (btnVoice) btnVoice.style.display = 'none';
    if (btnAttach) btnAttach.style.display = 'none';
    if (btnEmoji) btnEmoji.style.display = 'none';
  } else {
    if (inputEl) {
      inputEl.disabled = false;
      inputEl.placeholder = `Écrire dans ${salonName || 'le Salon'}...`;
    }
    if (btnSend) btnSend.disabled = false;
    if (btnVoice) btnVoice.style.display = '';
    if (btnAttach) btnAttach.style.display = '';
    if (btnEmoji) btnEmoji.style.display = '';
  }
}

async function selectSalon(salon) {
  if (state.socket) {
    if (state.activeContact) {
      state.socket.emit('leave_active_chat', { partnerId: state.activeContact.id });
    }
    if (state.activeSalon && String(state.activeSalon.id) !== String(salon.id)) {
      state.socket.emit('leave_active_chat', { partnerId: state.activeSalon.id });
    }
    state.socket.emit('enter_active_chat', { partnerId: salon.id });
    state.socket.emit('salon_mark_read', { salonId: salon.id });
  }

  hideMentionsPopover();
  state.activeSalon = salon;
  state.activeSalonMembers = [];
  state.activeContact = null;
  state.activeSupportSession = null;
  state.activeTab = 'salons';
  state.unreadSalonCounts[salon.id] = 0;
  cancelReply();

  if (window.innerWidth <= 768) {
    document.body.classList.add('mobile-chat-open');
  }

  const formattedName = formatSalonName(salon.name);

  // Update top bar for Salon
  const avatarEl = document.getElementById('active-contact-avatar');
  if (avatarEl) {
    avatarEl.textContent = '#';
    avatarEl.style.fontWeight = '800';
  }
  const nameEl = document.getElementById('active-contact-name');
  if (nameEl) {
    nameEl.textContent = formattedName;
  }
  const statusEl = document.getElementById('active-contact-status');
  if (statusEl) {
    statusEl.textContent = '';
    statusEl.style.display = 'none';
  }
  const statusDot = document.getElementById('active-contact-status-dot');
  if (statusDot) {
    statusDot.className = 'status-dot-overlay online';
    statusDot.removeAttribute('title');
  }

  const headerInfo = document.getElementById('active-contact-info');
  if (headerInfo) {
    headerInfo.title = 'Cliquez pour voir les participants du Salon';
  }

  // Reset composer state
  updateSalonBlockedComposerState(false, formattedName);

  // Show composer and hide standard call buttons (calls are 1-to-1)
  const composer = document.getElementById('chat-input-area');
  if (composer) composer.style.display = 'block';
  const callActions = document.getElementById('chat-header-call-actions');
  if (callActions) callActions.style.display = 'none';

  // Clear feed container before loading
  const feed = document.getElementById('messages-feed');
  if (feed) feed.innerHTML = '';

  renderSalonsList();
  await loadSalonHistory(salon.id);

  // Check if current user is blocked in this salon and cache members for @mentions
  try {
    const memRes = await authFetch(`/api/salons/${salon.id}/members`);
    if (memRes.ok) {
      const memData = await memRes.json();
      state.activeSalonMembers = memData.members || [];
      const me = state.activeSalonMembers.find(m => m.id === (state.user ? state.user.id : ''));
      if (me && Boolean(me.is_blocked)) {
        updateSalonBlockedComposerState(true, formattedName);
      }
    }
  } catch(e) {}

  if (state.socket) {
    state.socket.emit('join_salon', salon.id);
  }
}

async function loadSalonHistory(salonId) {
  const feed = document.getElementById('messages-feed');
  if (!feed) return;
  feed.innerHTML = '';

  try {
    const res = await authFetch(`/api/salons/${salonId}/messages`);
    if (res.ok) {
      const data = await res.json();
      state.salonMessages[salonId] = data.messages || [];
      state.unreadSalonCounts[salonId] = 0;
      renderSalonsList();
      const messages = state.salonMessages[salonId];

      if (messages.length === 0) {
        feed.innerHTML = `
          <div style="padding: 2rem; text-align: center; color: var(--text-dim); font-size: 0.85rem;">
            Début du Salon Confidentiel <strong>${escapeHtml(formatSalonName(state.activeSalon ? state.activeSalon.name : ''))}</strong>.<br>
            Vos échanges dans ce Salon sont strictement privés et isolés.
          </div>
        `;
        return;
      }

      let currentDateGroup = '';
      messages.forEach(msg => {
        const msgDateStr = safeParseDate(msg.timestamp);
        const dateGroup = formatMessageDateGroup(msgDateStr);
        if (dateGroup !== currentDateGroup) {
          currentDateGroup = dateGroup;
          const dateDivider = document.createElement('div');
          dateDivider.className = 'chat-date-divider';
          dateDivider.innerHTML = `<span>${dateGroup}</span>`;
          feed.appendChild(dateDivider);
        }
        appendMessageToFeed(msg);
      });
      scrollToBottom(false);
    }
  } catch (err) {
    console.error('[-] Error loading Salon history:', err);
  }
}

// Salon Info / Members Modal with Creator Controls (Rename, Remove Member, Block/Unblock, Add Members)
async function openSalonInfoModal(salonId) {
  const modal = document.getElementById('salon-info-modal');
  const titleEl = document.getElementById('salon-info-title');
  const metaEl = document.getElementById('salon-info-meta');
  const listEl = document.getElementById('salon-info-members-list');
  const deleteBtn = document.getElementById('btn-delete-active-salon');
  const btnClose = document.getElementById('btn-close-salon-info-modal');

  const btnToggleEdit = document.getElementById('btn-toggle-edit-salon');
  const editSection = document.getElementById('salon-edit-section');
  const editNameInput = document.getElementById('salon-edit-name-input');
  const editDescInput = document.getElementById('salon-edit-desc-input');
  const btnCancelEdit = document.getElementById('btn-cancel-edit-salon');
  const btnSaveEdit = document.getElementById('btn-save-edit-salon');

  const addMembersSection = document.getElementById('salon-add-members-section');
  const btnToggleAdd = document.getElementById('btn-toggle-add-members');
  const addMembersPicker = document.getElementById('salon-add-members-picker');
  const availableContactsList = document.getElementById('salon-available-contacts-list');
  const btnCancelAdd = document.getElementById('btn-cancel-add-members');
  const btnConfirmAdd = document.getElementById('btn-confirm-add-members');

  if (btnClose) {
    btnClose.onclick = () => hideModal('salon-info-modal');
  }

  if (!modal) return;
  showModal('salon-info-modal');

  // Reset collapsible sections
  if (editSection) editSection.style.display = 'none';
  if (addMembersPicker) addMembersPicker.style.display = 'none';

  try {
    const [salonRes, membersRes] = await Promise.all([
      authFetch(`/api/salons`),
      authFetch(`/api/salons/${salonId}/members`)
    ]);

    if (salonRes.ok && membersRes.ok) {
      const salonData = await salonRes.json();
      const membersData = await membersRes.json();

      const salon = (salonData.salons || []).find(s => String(s.id) === String(salonId)) || state.activeSalon;
      const members = membersData.members || [];
      state.activeSalonMembers = members;

      const isCreatorOrAdmin = salon && (
        salon.my_role === 'creator' ||
        salon.created_by === (state.user ? state.user.id : '') ||
        (state.user && state.user.role === 'admin')
      );

      if (titleEl && salon) titleEl.textContent = formatSalonName(salon.name);
      if (metaEl && salon) {
        metaEl.innerHTML = `
          <div style="font-size: 0.82rem; color: var(--text-dim); margin-bottom: 0.5rem;">
            ${escapeHtml(salon.description || 'Salon confidentiel')} • <strong>${members.length} participant(s)</strong>
          </div>
        `;
      }

      // Setup Edit Salon feature
      if (btnToggleEdit) {
        btnToggleEdit.style.display = isCreatorOrAdmin ? 'inline-flex' : 'none';
        btnToggleEdit.onclick = () => {
          if (!editSection) return;
          const isOpening = editSection.style.display === 'none';
          editSection.style.display = isOpening ? 'block' : 'none';
          if (isOpening && editNameInput) {
            editNameInput.value = (salon.name || '').replace(/^#+/, '');
            if (editDescInput) editDescInput.value = salon.description || '';
            editNameInput.focus();
          }
        };
      }

      if (btnCancelEdit && editSection) {
        btnCancelEdit.onclick = () => {
          editSection.style.display = 'none';
        };
      }

      if (btnSaveEdit && editSection) {
        btnSaveEdit.onclick = async () => {
          const newName = (editNameInput ? editNameInput.value.trim() : '').replace(/^#+/, '');
          const newDesc = editDescInput ? editDescInput.value.trim() : '';

          if (!newName) {
            alert('Le nom du Salon ne peut pas être vide.');
            return;
          }

          try {
            btnSaveEdit.disabled = true;
            const putRes = await authFetch(`/api/salons/${salonId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: newName, description: newDesc })
            });

            if (putRes.ok) {
              const updatedData = await putRes.json();
              if (updatedData.salon) {
                salon.name = updatedData.salon.name;
                salon.description = updatedData.salon.description;
              } else {
                salon.name = newName;
                salon.description = newDesc;
              }

              if (state.activeSalon && String(state.activeSalon.id) === String(salonId)) {
                state.activeSalon.name = salon.name;
                state.activeSalon.description = salon.description;
                const headerName = document.getElementById('active-contact-name');
                if (headerName) headerName.textContent = formatSalonName(salon.name);
                const inputEl = document.getElementById('message-input');
                if (inputEl && !inputEl.disabled) inputEl.placeholder = `Écrire dans ${formatSalonName(salon.name)}...`;
              }

              if (titleEl) titleEl.textContent = formatSalonName(salon.name);
              if (metaEl) {
                metaEl.innerHTML = `
                  <div style="font-size: 0.82rem; color: var(--text-dim); margin-bottom: 0.5rem;">
                    ${escapeHtml(salon.description || 'Salon confidentiel')} • <strong>${members.length} participant(s)</strong>
                  </div>
                `;
              }

              editSection.style.display = 'none';
              await loadSalons();
            } else {
              alert('Erreur lors de la modification du Salon.');
            }
          } catch (e) {
            console.error('[-] Error saving salon edits:', e);
            alert('Erreur de communication avec le serveur.');
          } finally {
            btnSaveEdit.disabled = false;
          }
        };
      }

      // Setup Add Members Section
      if (addMembersSection) {
        addMembersSection.style.display = isCreatorOrAdmin ? 'block' : 'none';
      }

      if (btnToggleAdd && addMembersPicker) {
        btnToggleAdd.onclick = () => {
          const isOpening = addMembersPicker.style.display === 'none';
          addMembersPicker.style.display = isOpening ? 'block' : 'none';
          if (isOpening && availableContactsList) {
            const currentMemberIds = new Set(members.map(m => String(m.id)));
            const eligibleContacts = (state.contacts || []).filter(c => !currentMemberIds.has(String(c.id)));

            availableContactsList.innerHTML = '';
            if (eligibleContacts.length === 0) {
              availableContactsList.innerHTML = '<div style="font-size: 0.76rem; color: var(--text-dim); padding: 0.5rem; text-align: center;">Tous vos contacts sont déjà membres de ce Salon.</div>';
              if (btnConfirmAdd) btnConfirmAdd.style.display = 'none';
            } else {
              if (btnConfirmAdd) btnConfirmAdd.style.display = 'inline-block';
              eligibleContacts.forEach(c => {
                const label = document.createElement('label');
                label.className = 'salon-checklist-item';
                label.style.display = 'flex';
                label.style.alignItems = 'center';
                label.style.gap = '8px';
                label.style.padding = '4px 0';
                label.style.cursor = 'pointer';

                const initial = (c.display_name || c.username || '?').charAt(0).toUpperCase();
                label.innerHTML = `
                  <input type="checkbox" value="${c.id}" class="salon-add-contact-checkbox">
                  <div style="width: 24px; height: 24px; border-radius: 50%; background: rgba(0,168,132,0.2); display: flex; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 700; color: #10b981;">${initial}</div>
                  <span style="font-size: 0.8rem; color: var(--text-main); font-weight: 500;">${escapeHtml(c.display_name || c.username)}</span>
                  <span style="font-size: 0.72rem; color: var(--text-dim);">(@${escapeHtml(c.username)})</span>
                `;
                availableContactsList.appendChild(label);
              });
            }
          }
        };
      }

      if (btnCancelAdd && addMembersPicker) {
        btnCancelAdd.onclick = () => {
          addMembersPicker.style.display = 'none';
        };
      }

      if (btnConfirmAdd) {
        btnConfirmAdd.onclick = async () => {
          const checkedBoxes = document.querySelectorAll('.salon-add-contact-checkbox:checked');
          const memberIds = Array.from(checkedBoxes).map(cb => cb.value);

          if (memberIds.length === 0) {
            alert('Veuillez sélectionner au moins un contact à ajouter.');
            return;
          }

          try {
            btnConfirmAdd.disabled = true;
            const addRes = await authFetch(`/api/salons/${salonId}/members/add`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ memberIds })
            });

            if (addRes.ok) {
              if (addMembersPicker) addMembersPicker.style.display = 'none';
              await openSalonInfoModal(salonId);
            } else {
              alert('Erreur lors de l\'ajout des participants.');
            }
          } catch (e) {
            console.error('[-] Error adding members:', e);
            alert('Erreur lors de l\'ajout des participants.');
          } finally {
            btnConfirmAdd.disabled = false;
          }
        };
      }

      // Delete Salon button
      if (deleteBtn) {
        deleteBtn.style.display = isCreatorOrAdmin ? 'flex' : 'none';
        deleteBtn.onclick = async () => {
          if (confirm(`Êtes-vous sûr de vouloir supprimer définitivement le Salon "${formatSalonName(salon.name)}" ? Tous les messages seront effacés.`)) {
            try {
              const delRes = await authFetch(`/api/salons/${salonId}`, { method: 'DELETE' });
              if (delRes.ok) {
                hideModal('salon-info-modal');
                state.activeSalon = null;
                showEmptyFeed(true);
                await loadSalons();
              }
            } catch (e) {
              alert('Erreur lors de la suppression du Salon.');
            }
          }
        };
      }

      // Render participants list
      if (listEl) {
        listEl.innerHTML = '';
        if (members.length === 0) {
          listEl.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--text-dim); font-size: 0.82rem;">Aucun participant trouvé.</div>';
        } else {
          members.forEach(m => {
            const row = document.createElement('div');
            row.className = 'salon-member-row';
            const isCreator = m.salon_role === 'creator' || m.id === salon.created_by;
            const isBlocked = Boolean(m.is_blocked === 1 || m.is_blocked === true);
            const isOnline = state.onlineUserIds.includes(m.id);
            const initial = (m.display_name || m.username || '?').charAt(0).toUpperCase();

            // Creator actions for other members (Clean icon-only SVG buttons for space and aesthetics)
            let actionsHtml = '';
            if (isCreatorOrAdmin && !isCreator && m.id !== (state.user ? state.user.id : '')) {
              actionsHtml = `
                <div class="salon-member-actions-row">
                  ${isBlocked ? `
                    <button type="button" class="btn-member-icon-action unblock-btn" data-action="unblock" data-user-id="${m.id}" data-name="${escapeHtml(m.display_name || m.username)}" title="Débloquer ce participant" aria-label="Débloquer">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                        <polyline points="9 12 11 14 15 10"></polyline>
                      </svg>
                    </button>
                  ` : `
                    <button type="button" class="btn-member-icon-action block-btn" data-action="block" data-user-id="${m.id}" data-name="${escapeHtml(m.display_name || m.username)}" title="Bloquer ce participant dans le Salon" aria-label="Bloquer">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
                      </svg>
                    </button>
                  `}
                  <button type="button" class="btn-member-icon-action remove-btn" data-action="remove" data-user-id="${m.id}" data-name="${escapeHtml(m.display_name || m.username)}" title="Retirer du Salon" aria-label="Retirer">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                </div>
              `;
            } else {
              actionsHtml = `
                <div style="display: flex; align-items: center; gap: 4px;">
                  ${isBlocked ? `<span class="salon-blocked-tag">Bloqué</span>` : ''}
                  <span class="salon-creator-tag" style="${isCreator ? '' : 'background: rgba(255,255,255,0.08); color: var(--text-dim);'}">
                    ${isCreator ? 'Admin / Créateur' : 'Participant'}
                  </span>
                </div>
              `;
            }

            row.innerHTML = `
              <div style="display: flex; align-items: center; gap: 0.65rem; min-width: 0;">
                <div style="position: relative; width: 32px; height: 32px; border-radius: 50%; background: rgba(0,168,132,0.15); border: 1px solid rgba(0,168,132,0.3); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.82rem; color: #10b981; flex-shrink: 0;">
                  ${initial}
                  <div class="micro-dot ${isOnline ? 'online' : ''}" style="width: 9px; height: 9px;"></div>
                </div>
                <div style="min-width: 0; overflow: hidden;">
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <div style="font-size: 0.88rem; font-weight: 600; color: var(--text-main); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(m.display_name || m.username)}</div>
                    ${(isBlocked && isCreatorOrAdmin && !isCreator) ? `<span class="salon-blocked-tag">Bloqué</span>` : ''}
                  </div>
                  <div style="font-size: 0.72rem; color: var(--text-dim);">@${escapeHtml(m.username)}</div>
                </div>
              </div>
              ${actionsHtml}
            `;

            // Attach action listeners
            const btnBlock = row.querySelector('[data-action="block"]');
            if (btnBlock) {
              btnBlock.onclick = async () => {
                const targetName = btnBlock.getAttribute('data-name');
                const targetId = btnBlock.getAttribute('data-user-id');
                if (confirm(`Bloquer "${targetName}" ? Il ne pourra plus envoyer de messages dans ce Salon.`)) {
                  try {
                    const blkRes = await authFetch(`/api/salons/${salonId}/members/${targetId}/block`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ blocked: true })
                    });
                    if (blkRes.ok) {
                      await openSalonInfoModal(salonId);
                    }
                  } catch (e) {
                    alert('Erreur lors du blocage du membre.');
                  }
                }
              };
            }

            const btnUnblock = row.querySelector('[data-action="unblock"]');
            if (btnUnblock) {
              btnUnblock.onclick = async () => {
                const targetId = btnUnblock.getAttribute('data-user-id');
                try {
                  const blkRes = await authFetch(`/api/salons/${salonId}/members/${targetId}/block`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ blocked: false })
                  });
                  if (blkRes.ok) {
                    await openSalonInfoModal(salonId);
                  }
                } catch (e) {
                  alert('Erreur lors du déblocage du membre.');
                }
              };
            }

            const btnRemove = row.querySelector('[data-action="remove"]');
            if (btnRemove) {
              btnRemove.onclick = async () => {
                const targetName = btnRemove.getAttribute('data-name');
                const targetId = btnRemove.getAttribute('data-user-id');
                if (confirm(`Retirer définitivement "${targetName}" de ce Salon ?`)) {
                  try {
                    const remRes = await authFetch(`/api/salons/${salonId}/members/${targetId}`, {
                      method: 'DELETE'
                    });
                    if (remRes.ok) {
                      await openSalonInfoModal(salonId);
                    }
                  } catch (e) {
                    alert('Erreur lors du retrait du participant.');
                  }
                }
              };
            }

            listEl.appendChild(row);
          });
        }
      }
    }
  } catch (e) {
    console.error('[-] Error opening Salon info modal:', e);
  }
}

// Attach listener to active contact header avatar to open Salon info if active
const activeContactHeaderUser = document.getElementById('active-contact-info');
if (activeContactHeaderUser) {
  activeContactHeaderUser.addEventListener('click', () => {
    if (state.activeSalon) {
      openSalonInfoModal(state.activeSalon.id);
    }
  });
}
