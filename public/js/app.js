/**
 * DigiCom - Direct 1-to-1 Sovereign Messaging & Support Engine
 * Modern Bento Glassmorphic Controller
 * With Client-Side Compressed Attachments (Images, PDF, Files, Voice Notes, Clickable Links)
 */

let state = {
  user: null,
  socket: null,
  pushClient: null,
  activeTab: 'all',      // 'all' | 'contacts' | 'salons' | 'support'
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

// Dynamic On-Demand Script Loader (Zero Initial Overhead)
function loadDynamicScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"], script[src^="${src.split('?')[0]}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true' || window.DigiQR || window.DigiComTour) {
        return resolve();
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', (e) => reject(e));
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = (err) => reject(err);
    document.head.appendChild(script);
  });
}

// Guided Tour On-Demand Loader & Auto-Trigger
async function triggerGuidedTour(force = false) {
  if (!force && localStorage.getItem('digicom_tour_done_v1') === 'true') return;
  try {
    if (typeof window.startDigiComTour !== 'function') {
      await loadDynamicScript('/js/guided-tour.min.js?v=1131');
    }
    if (typeof window.startDigiComTour === 'function') {
      window.startDigiComTour(force);
    }
  } catch (e) {
    console.warn('[-] Unable to load guided tour script:', e);
  }
}
window.triggerGuidedTour = triggerGuidedTour;

// Client-Side Image Compressor (WebP / Canvas scaling before upload)
async function compressImageForUpload(file, maxDimension = 1920, quality = 0.82) {
  if (!file || !file.type || !file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') {
    return file;
  }
  if (file.size < 200 * 1024) {
    return file;
  }
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
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

      const exportType = 'image/webp';
      canvas.toBlob((blob) => {
        if (blob && blob.size < file.size) {
          const newName = file.name.replace(/\.[^/.]+$/, '') + '.webp';
          const compressedFile = new File([blob], newName, { type: exportType, lastModified: Date.now() });
          console.log(`[+] Image optimized before upload: ${(file.size / 1024).toFixed(1)} KB -> ${(compressedFile.size / 1024).toFixed(1)} KB (-${((1 - compressedFile.size / file.size) * 100).toFixed(0)}%)`);
          resolve(compressedFile);
        } else {
          resolve(file);
        }
      }, exportType, quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  if (window.digiStore) {
    await window.digiStore.init().catch(err => console.warn('DigiStore init error:', err));
  }

  if ('serviceWorker' in navigator) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        console.log('[+] New version detected. Auto-refreshing app...');
        window.location.reload();
      }
    });

    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'FLUSH_OUTBOX') {
        flushOutbox();
      }
    });
  }

  state.pushClient = new DigiPushClient();
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => state.pushClient.init(), { timeout: 2500 });
  } else {
    setTimeout(() => state.pushClient.init(), 1500);
  }

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

async function authFetch(url, options = {}, retries = 1) {
  const token = localStorage.getItem('digicom_token');
  const headers = { ...(options.headers || {}) };
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  try {
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
  } catch (err) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 600));
      return authFetch(url, options, retries - 1);
    }
    throw err;
  }
}

let isAppInitializing = false;
let isAppInitialized = false;

async function checkAuthAndInit() {
  if (isAppInitializing) return;
  isAppInitializing = true;

  const cachedUserStr = localStorage.getItem('digicom_user');

  // Instant restoration: immediately render app interface with 0ms latency!
  if (cachedUserStr) {
    try {
      state.user = JSON.parse(cachedUserStr);
      hideModals();
      await initAppInterface();
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
      if (!isAppInitialized) {
        await initAppInterface();
      } else {
        updateCurrentUserUI();
      }
    } else {
      localStorage.removeItem('digicom_user');
      localStorage.removeItem('digicom_token');
      isAppInitialized = false;
      showModal('login-modal');
    }
  } catch (err) {
    console.error('[-] Initialization check error:', err);
    if (!state.user) {
      showModal('login-modal');
    }
  } finally {
    isAppInitializing = false;
  }
}

function updateCurrentUserUI() {
  if (!state.user) return;
  const username = state.user.displayName || state.user.username;
  const usernameEl = document.getElementById('current-username');
  if (usernameEl) usernameEl.textContent = username;

  const roleEl = document.getElementById('user-role-badge');
  if (roleEl) roleEl.textContent = state.user.role === 'admin' ? 'Admin' : 'Membre';

  const tabSupport = document.getElementById('tab-btn-support');
  if (tabSupport) {
    tabSupport.style.display = (state.user && state.user.role === 'admin') ? 'inline-flex' : 'none';
  }

  const btnAdminManage = document.getElementById('btn-admin-manage');
  if (btnAdminManage) {
    btnAdminManage.style.display = (state.user && state.user.role === 'admin') ? 'inline-flex' : 'none';
  }

  const btnChatAdminManage = document.getElementById('btn-chat-admin-manage');
  if (btnChatAdminManage) {
    btnChatAdminManage.style.display = (state.user && state.user.role === 'admin') ? 'flex' : 'none';
  }

  const btnSuperAdmin = document.getElementById('btn-superadmin-dashboard');
  if (btnSuperAdmin) {
    btnSuperAdmin.style.display = (state.user && state.user.role === 'admin') ? 'inline-flex' : 'none';
  }

  const menuSuperAdmin = document.getElementById('menu-item-superadmin');
  if (menuSuperAdmin) {
    menuSuperAdmin.style.display = (state.user && state.user.role === 'admin') ? 'flex' : 'none';
  }
}

async function initAppInterface() {
  if (!state.user) return;
  isAppInitialized = true;
  updateCurrentUserUI();
  if (typeof updatePWAInstallUI === 'function') updatePWAInstallUI();

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
  await loadContacts();

  // Load Salons List
  await loadSalons();

  // Load Pending Contact Requests
  loadPendingContactRequests();

  if (state.user && state.user.role === 'admin') {
    await loadSupportConversations();
  }

  // Render initial active tab
  await switchTab(state.activeTab || 'all');

  // Check for incoming call deep link in URL params
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('openCall') === 'true' || urlParams.get('callerId')) {
    const callerId = urlParams.get('callerId');
    const callerName = urlParams.get('callerName') || 'Correspondant';
    const callType = urlParams.get('callType') || 'audio';
    const act = urlParams.get('action');

    setTimeout(() => {
      if (window.triggerIncomingCallUI) {
        window.triggerIncomingCallUI({
          callerId,
          callerName,
          callType,
          autoAnswer: act === 'answer',
          autoReject: act === 'reject'
        });
      }
    }, 600);
  }

  // Handle URL deep links on cold start (?salon=... &msg=..., ?contact=..., ?support=...)
  const coldSalon = urlParams.get('salon') || urlParams.get('salonId');
  const coldContact = urlParams.get('contact') || urlParams.get('contactId');
  const coldSender = urlParams.get('sender') || urlParams.get('senderId');
  const coldChannel = urlParams.get('channel') || (urlParams.get('support') ? 'support' : null);
  const coldMsg = urlParams.get('msg') || urlParams.get('messageId');

  if (coldSalon || coldContact || coldSender || coldChannel) {
    console.log('[+] Deep link detected at startup:', { coldSalon, coldContact, coldSender, coldChannel, coldMsg });
    await navigateToTarget({
      salonId: coldSalon,
      contactId: coldContact || coldSender,
      senderId: coldSender,
      channel: coldChannel,
      messageId: coldMsg
    });
  } else if (localStorage.getItem('digicom_active_contact') && window.innerWidth > 900) {
    const savedContactId = localStorage.getItem('digicom_active_contact');
    const found = state.contacts.find(c => String(c.id) === String(savedContactId));
    if (found) selectContact(found);
  }

  // Trigger Guided Tour on first visit for new users only (Zero initial JS footprint for returning users)
  if (localStorage.getItem('digicom_tour_done_v1') !== 'true') {
    setTimeout(() => {
      triggerGuidedTour(false);
    }, 1500);
  }
}

function highlightAndScrollMessage(messageId) {
  if (!messageId) return;
  let attempts = 0;
  const maxAttempts = 15;

  const checkAndScroll = () => {
    const el = document.getElementById(messageId) || 
               document.getElementById(`msg_${messageId}`) || 
               document.getElementById(`msg-${messageId}`) ||
               document.querySelector(`[data-msg-id="${messageId}"]`);

    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('highlight-message');
      void el.offsetWidth; // Force CSS reflow
      el.classList.add('highlight-message');
      setTimeout(() => {
        el.classList.remove('highlight-message');
      }, 3000);
    } else if (attempts < maxAttempts) {
      attempts++;
      setTimeout(checkAndScroll, 200);
    }
  };

  requestAnimationFrame(checkAndScroll);
}

async function navigateToTarget(targetData) {
  if (!targetData) return;
  const payloadData = targetData.data || targetData;
  let salonId = payloadData.salonId || targetData.salonId;
  let contactId = payloadData.contactId || payloadData.senderId || targetData.contactId || targetData.senderId;
  let messageId = payloadData.messageId || targetData.messageId;
  let channel = payloadData.channel || targetData.channel;
  const senderName = payloadData.senderName || payloadData.sender_name || targetData.senderName || targetData.title || 'Contact';
  const salonName = payloadData.salonName || payloadData.salon_name || targetData.salonName || targetData.title || 'Salon';

  const rawUrl = targetData.url || targetData.targetUrl || (payloadData && (payloadData.url || payloadData.targetUrl));
  if (rawUrl) {
    try {
      const parsedUrl = new URL(rawUrl, window.location.origin);
      if (!salonId) salonId = parsedUrl.searchParams.get('salon') || parsedUrl.searchParams.get('salonId');
      if (!contactId) contactId = parsedUrl.searchParams.get('contact') || parsedUrl.searchParams.get('contactId') || parsedUrl.searchParams.get('sender') || parsedUrl.searchParams.get('senderId');
      if (!messageId) messageId = parsedUrl.searchParams.get('msg') || parsedUrl.searchParams.get('messageId');
      if (!channel) channel = parsedUrl.searchParams.get('channel');
    } catch (e) {}
  }

  console.log('[+] navigateToTarget -> switching active conversation to:', { salonId, contactId, messageId, channel, senderName, salonName });
  try {
    fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: 'info',
        tag: 'APP_NAV',
        message: `App navigating to target conversation: ${contactId ? 'Contact ' + contactId : 'Salon ' + salonId}`,
        data: { salonId, contactId, messageId, channel, senderName }
      })
    }).catch(() => {});
  } catch (e) {}

  if (targetData.openRequests || (targetData.url && targetData.url.includes('openRequests=true'))) {
    await switchTab('contacts');
    showModal('add-contact-modal');
    switchAddContactModalTab('requests');
    return;
  }

  if (channel === 'support' || targetData.type === 'support') {
    if (contactId) {
      if (window.openSupportConversationBySenderId) {
        window.openSupportConversationBySenderId(contactId);
      }
    } else {
      await switchTab('support');
    }
    if (messageId) highlightAndScrollMessage(messageId);
    return;
  }

  if (salonId) {
    await switchTab('salons');
    let found = Array.isArray(state.salons) ? state.salons.find(s => String(s.id) === String(salonId)) : null;
    if (!found) {
      found = { id: salonId, name: salonName };
    }
    selectSalon(found);
    document.body.classList.add('mobile-chat-open');
    if (messageId) {
      highlightAndScrollMessage(messageId);
    }
    // Background async refresh without blocking UI
    if (!state.salons || !Array.isArray(state.salons) || state.salons.length === 0) {
      authFetch('/api/salons').then(r => r.ok && r.json()).then(sData => {
        if (sData) state.salons = sData.salons || sData || [];
      }).catch(() => {});
    }
  } else if (contactId) {
    const rawContactId = String(contactId);
    await switchTab('contacts');
    let found = Array.isArray(state.contacts)
      ? state.contacts.find(c => String(c.id) === rawContactId || String(c.id) === rawContactId.replace(/^admin_/, '') || (c.username && c.username.toLowerCase() === senderName.toLowerCase()))
      : null;
    if (!found) {
      found = { id: rawContactId, username: senderName, display_name: senderName };
    }
    selectContact(found);
    document.body.classList.add('mobile-chat-open');
    if (messageId) {
      highlightAndScrollMessage(messageId);
    }
    setTimeout(() => {
      const inp = document.getElementById('message-input');
      if (inp) inp.focus();
    }, 150);

    // Background async refresh without blocking UI
    if (!state.contacts || !Array.isArray(state.contacts) || state.contacts.length === 0) {
      authFetch('/api/contacts').then(r => r.ok && r.json()).then(cData => {
        if (cData) state.contacts = cData.contacts || cData || [];
      }).catch(() => {});
    }
  }

  // Clean URL parameters cleanly without reloading page
  if (window.location.search && (window.location.search.includes('salon') || window.location.search.includes('contact') || window.location.search.includes('msg') || window.location.search.includes('sender'))) {
    try {
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (e) {}
  }
}
window.navigateToTarget = navigateToTarget;
window.highlightAndScrollMessage = highlightAndScrollMessage;

function isUserOnline(userId) {
  if (!userId || !Array.isArray(state.onlineUserIds)) return false;
  const strId = String(userId);
  return state.onlineUserIds.some(id => String(id) === strId);
}

function updateOnlineIndicatorsInLists(userId, isOnline) {
  const strId = String(userId);
  const contactItems = document.querySelectorAll(`.contact-card[data-user-id="${strId}"], .contact-item[data-user-id="${strId}"]`);
  contactItems.forEach(contactItem => {
    let microDot = contactItem.querySelector('.micro-dot');
    const avatarBox = contactItem.querySelector('.contact-avatar-box, .salon-icon-box');
    if (isOnline) {
      if (!microDot && avatarBox && !contactItem.querySelector('.salon-icon-box')) {
        microDot = document.createElement('div');
        microDot.className = 'micro-dot online';
        microDot.title = 'En ligne';
        avatarBox.appendChild(microDot);
      } else if (microDot) {
        microDot.classList.add('online');
        microDot.style.display = 'block';
        microDot.title = 'En ligne';
      }
    } else {
      if (microDot) {
        microDot.remove();
      }
    }
    const badge = contactItem.querySelector('.contact-online-badge, .status-indicator');
    if (badge) {
      badge.className = isOnline ? 'contact-online-badge online' : 'contact-online-badge offline';
    }
  });

  if (state.activeContact && String(state.activeContact.id) === strId) {
    updateActiveContactStatus();
  }
  if (state.activeSupportSession && String(state.activeSupportSession) === strId) {
    const statusEl = document.getElementById('active-contact-status');
    if (statusEl) {
      statusEl.style.display = 'none';
      statusEl.textContent = '';
    }
  }
}

function initSocket() {
  if (typeof io === 'undefined') {
    console.warn('[!] Socket.io library not available offline. Operating in local store mode.');
    return;
  }
  if (state.socket && state.socket.connected) {
    if (state.user) {
      state.socket.emit('authenticate', state.user);
    }
    return;
  }
  if (state.socket) {
    try {
      state.socket.off();
      state.socket.disconnect();
    } catch (e) {}
    state.socket = null;
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

  state.socket.on('presence_initial', (data) => {
    state.onlineUserIds = data.onlineUserIds || [];
    renderCurrentActiveTabFeed();
    updateActiveContactStatus();
  });

  state.socket.on('presence_delta', (data) => {
    if (!data || !data.userId) return;
    if (data.status === 'online') {
      if (!state.onlineUserIds.includes(data.userId)) {
        state.onlineUserIds.push(data.userId);
      }
    } else if (data.status === 'offline') {
      state.onlineUserIds = state.onlineUserIds.filter(id => String(id) !== String(data.userId));
    }
    updateActiveContactStatus();
    updateOnlineIndicatorsInLists(data.userId, data.status === 'online');
  });

  state.socket.on('presence_update', (data) => {
    if (data.onlineUserIds) {
      state.onlineUserIds = data.onlineUserIds;
    }
    renderCurrentActiveTabFeed();
    updateActiveContactStatus();
  });

  state.socket.on('admin_announcement', (data) => {
    if (data && data.content) {
      alert(`[ANNONCE DE L'ADMINISTRATION]\n\n${data.content}`);
    }
  });

  state.socket.on('force_disconnect', (data) => {
    alert(data && data.reason ? data.reason : 'Votre connexion a été interrompue par l\'administration.');
    window.location.reload();
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
      state.unreadCounts[otherPartyId] = (state.unreadCounts[otherPartyId] || 0) + 1;
      renderCurrentActiveTabFeed();
      updateAllTabsBadges();

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

  // Contact Request & Direct Connection Real-time Events
  state.socket.on('contact_added', (data) => {
    loadContacts();
    if (data && data.contact) {
      showInAppToast({
        title: 'Nouveau Contact Connecté',
        body: `${data.contact.displayName || data.contact.display_name || data.contact.username} fait désormais partie de vos contacts.`,
        type: 'system'
      });
    }
  });

  state.socket.on('new_contact_request', (data) => {
    playNotificationSound();
    showInAppToast({
      title: 'Demande de contact reçue',
      body: `${data.sender.displayName || data.sender.username} (@${data.sender.username}) souhaite vous ajouter. Cliquez pour voir.`,
      type: 'system',
      onClick: () => {
        switchTab('contacts');
        showModal('add-contact-modal');
        switchAddContactModalTab('requests');
      }
    });
    loadPendingContactRequests();
  });

  state.socket.on('contact_request_accepted', (data) => {
    loadContacts();
    if (data && data.contact) {
      showInAppToast({
        title: 'Demande acceptée',
        body: `Votre demande à @${data.contact.username} a été acceptée.`,
        type: 'system',
        onClick: () => {
          switchTab('contacts');
          const found = state.contacts ? state.contacts.find(c => c.id === data.contact.id) : null;
          if (found) selectContact(found);
        }
      });
    }
  });

  state.socket.on('contact_request_rejected', (data) => {
    if (data && data.receiver) {
      showInAppToast({
        title: 'Demande refusée',
        body: `Votre demande à @${data.receiver.username} a été refusée.`,
        type: 'system'
      });
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
        if (data.broadcastOnly !== undefined) {
          state.activeSalon.broadcast_only = data.broadcastOnly ? 1 : 0;
          const isSalonAdmin = (state.activeSalon.created_by === (state.user ? state.user.id : '')) || (state.user && state.user.role === 'admin');
          updateSalonBroadcastComposerState(Boolean(data.broadcastOnly), isSalonAdmin);
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
        renderCurrentActiveTabFeed();
        updateAllTabsBadges();

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
          bar.innerHTML = `<div class="typing-dots-wrapper"><span class="typing-dots-name">${escapeHtml(data.userName || data.senderName || 'Un membre')}</span><div class="typing-dots-bubble"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div></div>`;
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
          bar.innerHTML = `<div class="typing-dots-wrapper"><span class="typing-dots-name" style="color: #f43f5e;">${escapeHtml(data.senderName || 'Le formateur')}</span><div class="typing-dots-bubble"><span class="typing-dot" style="background: #f43f5e;"></span><span class="typing-dot" style="background: #f43f5e;"></span><span class="typing-dot" style="background: #f43f5e;"></span></div></div>`;
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
        bar.innerHTML = `<div class="typing-dots-bubble"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>`;
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

  // Universal Message Pinning Updates
  state.socket.on('chat_pinned_update', (data) => {
    let currentTargetId = null;
    if (state.activeTab === 'salons' && state.activeSalon) currentTargetId = state.activeSalon.id;
    else if (state.activeContact) currentTargetId = state.activeContact.id;
    else if (state.activeTab === 'support') currentTargetId = state.activeSupportSession || (state.user ? state.user.id : null);

    if (currentTargetId === data.targetId) {
      updatePinnedMessageBanner(data.channelType, data.targetId, data.pinnedMessages || []);
    }
  });

  state.socket.on('salon_pinned_update', (data) => {
    if (state.activeSalon && state.activeSalon.id === data.salonId) {
      updatePinnedMessageBanner('salon', data.salonId, data.pinnedMessages || []);
    }
  });

  // Direct 1-on-1 Modules Realtime Socket Listeners
  state.socket.on('direct_contract_updated', (data) => {
    const isRelated = state.activeContact && (
      state.activeContact.id === data.contactId ||
      (state.user && state.user.id === data.contactId) ||
      (data.user1Id && [data.user1Id, data.user2Id].includes(state.activeContact.id))
    );
    if (isRelated) {
      if (data.contracts) {
        window.directModulesState.contracts = data.contracts;
      }
      if (document.getElementById('modal-direct-contract')?.style.display !== 'none') {
        if (typeof openDirectContractModal === 'function') openDirectContractModal();
      }
    }
  });

  state.socket.on('direct_deadline_updated', (data) => {
    if (state.activeContact && (state.activeContact.id === data.contactId || (state.user && state.user.id === data.contactId))) {
      if (document.getElementById('modal-direct-deadlines')?.style.display !== 'none') {
        if (typeof openDirectDeadlinesModal === 'function') openDirectDeadlinesModal();
      }
    }
  });

  state.socket.on('direct_payment_updated', (data) => {
    if (state.activeContact && (state.activeContact.id === data.contactId || (state.user && state.user.id === data.contactId))) {
      if (document.getElementById('modal-direct-payments')?.style.display !== 'none') {
        if (typeof openDirectPaymentsModal === 'function') openDirectPaymentsModal();
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
          icon: '/img/icon-192.webp',
          badge: '/img/badge-72.webp',
          vibrate: [200, 100, 200]
        });
      });
    } else {
      new Notification(title, { body, icon: '/img/icon-192.webp' });
    }
  }
}

function showInAppToast({ title, body, type = 'private', senderId = null, onClick = null }) {
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
      if (typeof onClick === 'function') {
        onClick();
        return;
      }
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

  card.addEventListener('click', (e) => {
    if (e.target !== btnAction && !btnAction.contains(e.target)) {
      if (typeof onClick === 'function') {
        card.remove();
        onClick();
      }
    }
  });

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
  const btnStartTour = document.getElementById('btn-start-tour');
  if (btnStartTour) {
    btnStartTour.addEventListener('click', () => {
      triggerGuidedTour(true);
    });
  }

  const btnTabAll = document.getElementById('tab-btn-all');
  if (btnTabAll) btnTabAll.addEventListener('click', () => switchTab('all'));
  const btnTabContacts = document.getElementById('tab-btn-contacts');
  if (btnTabContacts) btnTabContacts.addEventListener('click', () => switchTab('contacts'));
  const btnTabSalons = document.getElementById('tab-btn-salons');
  if (btnTabSalons) btnTabSalons.addEventListener('click', () => switchTab('salons'));
  const btnTabSupport = document.getElementById('tab-btn-support');
  if (btnTabSupport) btnTabSupport.addEventListener('click', () => switchTab('support'));

  // Sidebar Search Listeners
  const searchInput = document.getElementById('search-contacts-input');
  const clearSearchBtn = document.getElementById('btn-clear-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      if (clearSearchBtn) {
        clearSearchBtn.style.display = state.searchQuery ? 'flex' : 'none';
      }
      renderCurrentActiveTabFeed();
    });
  }
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      state.searchQuery = '';
      clearSearchBtn.style.display = 'none';
      renderCurrentActiveTabFeed();
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

  const btnCtxPin = document.getElementById('ctx-action-pin');
  if (btnCtxPin) {
    btnCtxPin.addEventListener('click', () => {
      if (window.currentActiveCtxMessage) {
        window.pinCurrentChatMessage(window.currentActiveCtxMessage.id);
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

  if (feed) {
    if (scrollBtn) {
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

        // Infinite scroll upward to load older messages
        if (feed.scrollTop <= 60) {
          if (state.activeTab === 'contacts' && state.activeContact) {
            loadDirectHistory(state.activeContact.id, true);
          } else if (state.activeTab === 'salons' && state.activeSalon) {
            loadSalonHistory(state.activeSalon.id, true);
          } else if (state.activeTab === 'support' && state.activeSupportSession) {
            loadSupportHistory(state.activeSupportSession, true);
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

    // 1. Single click delegation for Reply and Delete buttons
    feed.addEventListener('click', (e) => {
      const replyBtn = e.target.closest('.msg-btn-reply');
      if (replyBtn) {
        e.stopPropagation();
        const row = replyBtn.closest('.message-row');
        if (row) {
          startReply(row.dataset.msgId || row.id, row.dataset.sender, row._msgContent);
        }
        return;
      }
      const delBtn = e.target.closest('.msg-btn-del');
      if (delBtn) {
        e.stopPropagation();
        const row = delBtn.closest('.message-row');
        if (row) {
          deleteMessage(row.dataset.msgId || row.id);
        }
        return;
      }
    });

    // 2. Single context menu delegation (desktop right-click & long-press fallback)
    feed.addEventListener('contextmenu', (e) => {
      const bubble = e.target.closest('.msg-bubble');
      if (bubble) {
        const row = bubble.closest('.message-row');
        if (row) {
          e.preventDefault();
          openMessageContextMenu(
            row.dataset.msgId || row.id,
            row.dataset.sender || 'Contact',
            row._msgContent,
            row.dataset.canDelete === 'true',
            row.dataset.timestamp
          );
        }
      }
    });

    // 3. Global single gesture delegator for Swipe-to-Reply & Long-Press (Touch & Mouse)
    let activeGestureRow = null;
    let gestureStartX = 0;
    let gestureStartY = 0;
    let isGestureSwiping = false;
    let gestureDirLocked = null;
    let hasGestureVibrated = false;
    let gestureLongPressTimer = null;
    let gestureIndicatorEl = null;

    const onGlobalGestureStart = (target, clientX, clientY) => {
      if (!target) return;
      if (target.closest('button') || target.closest('a') || target.closest('audio') || target.closest('.chat-video-player') || target.closest('input')) return;
      const row = target.closest('.message-row');
      if (!row) return;

      activeGestureRow = row;
      gestureStartX = clientX;
      gestureStartY = clientY;
      isGestureSwiping = false;
      gestureDirLocked = null;
      hasGestureVibrated = false;
      activeGestureRow.style.transition = 'none';

      gestureIndicatorEl = activeGestureRow.querySelector('.swipe-reply-indicator');
      if (!gestureIndicatorEl) {
        gestureIndicatorEl = document.createElement('div');
        gestureIndicatorEl.className = 'swipe-reply-indicator';
        gestureIndicatorEl.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 0 0-4-4H4"></path></svg>`;
        activeGestureRow.insertBefore(gestureIndicatorEl, activeGestureRow.firstChild);
      }

      clearTimeout(gestureLongPressTimer);
      gestureLongPressTimer = setTimeout(() => {
        if (activeGestureRow && !isGestureSwiping) {
          if (navigator.vibrate) {
            try { navigator.vibrate(40); } catch (err) {}
          }
          openMessageContextMenu(
            activeGestureRow.dataset.msgId || activeGestureRow.id,
            activeGestureRow.dataset.sender || 'Contact',
            activeGestureRow._msgContent,
            activeGestureRow.dataset.canDelete === 'true',
            activeGestureRow.dataset.timestamp
          );
          activeGestureRow = null;
        }
      }, 520);
    };

    const onGlobalGestureMove = (clientX, clientY) => {
      if (!activeGestureRow) return;
      const deltaX = clientX - gestureStartX;
      const deltaY = clientY - gestureStartY;

      if (Math.abs(deltaX) > 6 || Math.abs(deltaY) > 6) {
        clearTimeout(gestureLongPressTimer);
      }

      if (gestureDirLocked === null) {
        if (Math.abs(deltaY) > Math.abs(deltaX) || deltaX < -5) {
          gestureDirLocked = true;
        } else if (deltaX > 8 && Math.abs(deltaX) > Math.abs(deltaY)) {
          clearTimeout(gestureLongPressTimer);
          gestureDirLocked = false;
          isGestureSwiping = true;
        }
      }

      if (gestureDirLocked === true) return;

      if (isGestureSwiping && deltaX > 0) {
        clearTimeout(gestureLongPressTimer);
        const dampedX = Math.min(deltaX * 0.55, 75);
        activeGestureRow.style.transform = `translateX(${dampedX}px)`;

        if (gestureIndicatorEl) {
          const opacity = Math.min(dampedX / 30, 1);
          const scale = Math.min(0.5 + (dampedX / 75), 1.0);
          gestureIndicatorEl.style.opacity = opacity;
          gestureIndicatorEl.style.transform = `translateY(-50%) scale(${scale})`;

          if (dampedX >= 48) {
            gestureIndicatorEl.classList.add('swipe-active');
            if (!hasGestureVibrated) {
              hasGestureVibrated = true;
              if (navigator.vibrate) {
                try { navigator.vibrate(30); } catch (err) {}
              }
            }
          } else {
            gestureIndicatorEl.classList.remove('swipe-active');
            hasGestureVibrated = false;
          }
        }
      }
    };

    const onGlobalGestureEnd = () => {
      clearTimeout(gestureLongPressTimer);
      if (!activeGestureRow) return;

      const currentRow = activeGestureRow;
      const shouldReply = hasGestureVibrated;
      const msgId = currentRow.dataset.msgId || currentRow.id;
      const sender = currentRow.dataset.sender;
      const content = currentRow._msgContent;

      if (isGestureSwiping) {
        currentRow.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.9, 0.3, 1.25)';
        currentRow.style.transform = 'translateX(0px)';

        if (gestureIndicatorEl) {
          gestureIndicatorEl.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
          gestureIndicatorEl.style.opacity = '0';
          gestureIndicatorEl.style.transform = 'translateY(-50%) scale(0.5)';
          gestureIndicatorEl.classList.remove('swipe-active');
        }

        if (shouldReply) {
          startReply(msgId, sender, content);
        }

        setTimeout(() => {
          currentRow.style.transition = '';
          currentRow.style.transform = '';
        }, 260);
      }

      activeGestureRow = null;
      isGestureSwiping = false;
      gestureDirLocked = null;
      hasGestureVibrated = false;
      gestureIndicatorEl = null;
    };

    feed.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches[0]) {
        onGlobalGestureStart(e.target, e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    feed.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches[0]) {
        onGlobalGestureMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    feed.addEventListener('touchend', onGlobalGestureEnd, { passive: true });
    feed.addEventListener('touchcancel', onGlobalGestureEnd, { passive: true });

    feed.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      onGlobalGestureStart(e.target, e.clientX, e.clientY);
    });

    window.addEventListener('mousemove', (e) => {
      onGlobalGestureMove(e.clientX, e.clientY);
    });

    window.addEventListener('mouseup', () => {
      onGlobalGestureEnd();
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

  // Handle Notification Click message from Service Worker (postMessage + BroadcastChannel)
  async function handleNotificationNavigationEvent(eventData) {
    if (!eventData) return;
    if (eventData.action === 'NAVIGATE_TO_SALON' || eventData.type === 'NOTIFICATION_CLICK') {
      const notifData = eventData.data || eventData || {};
      const targetUrl = eventData.url || eventData.targetUrl || '';
      const act = eventData.action;

      // Merge URL params into notifData as fallback
      if (targetUrl) {
        try {
          const parsedUrl = new URL(targetUrl, window.location.origin);
          if (!notifData.contactId && !notifData.senderId) {
            const urlContact = parsedUrl.searchParams.get('contact') || parsedUrl.searchParams.get('contactId') || parsedUrl.searchParams.get('sender') || parsedUrl.searchParams.get('senderId');
            if (urlContact) notifData.contactId = urlContact;
          }
          if (!notifData.salonId) {
            const urlSalon = parsedUrl.searchParams.get('salon') || parsedUrl.searchParams.get('salonId');
            if (urlSalon) notifData.salonId = urlSalon;
          }
          if (!notifData.messageId) {
            const urlMsg = parsedUrl.searchParams.get('msg') || parsedUrl.searchParams.get('messageId');
            if (urlMsg) notifData.messageId = urlMsg;
          }
          if (!notifData.channel) {
            const urlChannel = parsedUrl.searchParams.get('channel');
            if (urlChannel) notifData.channel = urlChannel;
          }
        } catch (e) {}
      }

      if (notifData.type === 'call_incoming' || notifData.callerId) {
        if (window.triggerIncomingCallUI) {
          window.triggerIncomingCallUI({
            callerId: notifData.callerId,
            callerName: notifData.callerName || 'Correspondant',
            callType: notifData.callType || 'audio',
            autoAnswer: act === 'answer',
            autoReject: act === 'reject'
          });
        }
        return;
      }

      await navigateToTarget(notifData);
    }
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', async (event) => {
      if (event.data) {
        await handleNotificationNavigationEvent(event.data);
      }
    });
  }

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const navChannel = new BroadcastChannel('digicom_nav_channel');
      navChannel.onmessage = async (event) => {
        if (event.data) {
          await handleNotificationNavigationEvent(event.data);
        }
      };
    } catch (e) {}
  }

  // Page Visibility & Tab Focus Handler (Debounced, eliminates duplicate socket spam)
  let currentActiveRoomId = null;
  let activeRoomSyncTimeout = null;

  function syncActiveChatPresence() {
    if (activeRoomSyncTimeout) clearTimeout(activeRoomSyncTimeout);
    activeRoomSyncTimeout = setTimeout(() => {
      // Check if URL parameters have deep link (e.g. from background notification navigation)
      if (window.location.search) {
        const currentSearchParams = new URLSearchParams(window.location.search);
        const urlContact = currentSearchParams.get('contact') || currentSearchParams.get('contactId');
        const urlSalon = currentSearchParams.get('salon') || currentSearchParams.get('salonId');
        const urlMsg = currentSearchParams.get('msg') || currentSearchParams.get('messageId');
        const urlChannel = currentSearchParams.get('channel');
        const urlRequests = currentSearchParams.get('openRequests');

        if (urlContact || urlSalon || urlMsg || urlChannel || urlRequests) {
          navigateToTarget({
            contactId: urlContact,
            salonId: urlSalon,
            messageId: urlMsg,
            channel: urlChannel,
            openRequests: urlRequests === 'true'
          });
        }
      }

      if (!state.socket || !state.socket.connected) return;

      let targetRoomId = null;
      let targetSenderId = null;
      const isVisible = !document.hidden && document.visibilityState === 'visible';

      if (isVisible) {
        if (state.activeTab === 'contacts' && state.activeContact) {
          targetRoomId = String(state.activeContact.id);
          targetSenderId = state.activeContact.id;
        } else if (state.activeTab === 'salons' && state.activeSalon) {
          targetRoomId = String(state.activeSalon.id);
        } else if (state.activeTab === 'support' && state.activeSupportSession) {
          targetRoomId = 'admin_' + state.activeSupportSession;
        }
      }

      if (currentActiveRoomId && currentActiveRoomId !== targetRoomId) {
        state.socket.emit('leave_active_chat', { partnerId: currentActiveRoomId });
      }

      if (targetRoomId && targetRoomId !== currentActiveRoomId) {
        state.socket.emit('enter_active_chat', { partnerId: targetRoomId });
        if (targetSenderId) {
          state.socket.emit('mark_read', { senderId: targetSenderId });
        }
      }

      currentActiveRoomId = targetRoomId;
    }, 200);
  }

  document.addEventListener('visibilitychange', syncActiveChatPresence);
  window.addEventListener('blur', syncActiveChatPresence);
  window.addEventListener('focus', syncActiveChatPresence);
  window.addEventListener('pagehide', () => {
    if (state.socket && currentActiveRoomId) {
      state.socket.emit('leave_active_chat', { partnerId: currentActiveRoomId });
      currentActiveRoomId = null;
    }
  });

  // Push subscription toggle & Immediate Test
  const btnPushToggle = document.getElementById('btn-push-toggle');
  if (btnPushToggle) {
    btnPushToggle.addEventListener('click', async () => {
      const ok = await state.pushClient.subscribeUser(state.user ? state.user.id : null);
      if (ok) {
        btnPushToggle.classList.add('active');
        playNotificationSound();
        showLocalNotification('DigiCom', 'Notifications activées avec succès !');
        // Trigger background test push from server
        fetch('/api/test-notification', { method: 'POST' }).catch(() => {});
      } else {
        alert('Veuillez autoriser les notifications dans votre navigateur pour recevoir les alertes.');
      }
    });
  }

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
  const setupForm = document.getElementById('setup-form');
  if (setupForm) {
    setupForm.addEventListener('submit', async (e) => {
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
        if (errBox) {
          errBox.textContent = err.message;
          errBox.style.display = 'block';
        }
      }
    });
  }

  // Login form
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
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
      if (errBox) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    }
  });
}

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

  // Add Contact Modal & Sovereign Connection Handlers
  const btnAddContact = document.getElementById('btn-add-contact');
  const btnCloseAddContactModal = document.getElementById('btn-close-add-contact-modal');
  const addContactModal = document.getElementById('add-contact-modal');
  const btnCopyMyUsername = document.getElementById('btn-copy-my-username');
  const btnCopyInviteLink = document.getElementById('btn-copy-invite-link');
  const formExactSearch = document.getElementById('form-exact-contact-search');

  if (btnAddContact && addContactModal) {
    btnAddContact.addEventListener('click', () => {
      showModal('add-contact-modal');
      switchAddContactModalTab('qr');
      loadPendingContactRequests();
    });
  }

  if (btnCloseAddContactModal && addContactModal) {
    btnCloseAddContactModal.addEventListener('click', () => {
      hideModal('add-contact-modal');
    });
  }

  // Modal Tabs Switching
  document.querySelectorAll('.modal-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      if (tab) switchAddContactModalTab(tab);
    });
  });

  if (formExactSearch) {
    formExactSearch.addEventListener('submit', handleExactContactSearch);
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

  const btnSuperAdmin = document.getElementById('btn-superadmin-dashboard');
  if (btnSuperAdmin) {
    btnSuperAdmin.addEventListener('click', () => {
      if (window.AdminDashboard) {
        window.AdminDashboard.open();
      } else {
        const script = document.createElement('script');
        script.src = '/js/admin-dashboard.min.js?v=1137';
        script.onload = () => {
          if (window.AdminDashboard) window.AdminDashboard.open();
        };
        document.body.appendChild(script);
      }
    });
  }

  const btnCloseAdmin = document.getElementById('btn-close-admin-modal');
  if (btnCloseAdmin) {
    btnCloseAdmin.addEventListener('click', () => {
      document.getElementById('admin-modal').style.display = 'none';
    });
  }

  // Logout
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        if (window.digiPushClient) {
          await window.digiPushClient.unsubscribeUser().catch(() => {});
        }
      } catch (e) {}
      try {
        if (window.digiStore) {
          await window.digiStore.clearAllStores().catch(() => {});
        }
      } catch (e) {}
      try {
        await authFetch('/api/logout', { method: 'POST' });
      } catch (e) {}
      localStorage.removeItem('digicom_token');
      localStorage.removeItem('digicom_user');
      localStorage.removeItem('digicom_active_contact');
      window.location.reload();
    });
  }

  // Chat options dropdown menu listeners
  const btnChatMoreMenu = document.getElementById('btn-chat-more-menu');
  if (btnChatMoreMenu) {
    btnChatMoreMenu.onclick = (e) => {
      if (window.toggleChatMoreMenu) window.toggleChatMoreMenu(e);
    };
    btnChatMoreMenu.ontouchend = (e) => {
      e.preventDefault();
      if (window.toggleChatMoreMenu) window.toggleChatMoreMenu(e);
    };
  }

  const menuItemMeeting = document.getElementById('menu-item-meeting');
  if (menuItemMeeting) {
    menuItemMeeting.addEventListener('click', () => {
      if (typeof startSalonMeeting === 'function') startSalonMeeting();
      else if (window.startSalonMeeting) window.startSalonMeeting();
      if (window.closeChatMoreMenu) window.closeChatMoreMenu();
    });
  }

  const menuItemFiles = document.getElementById('menu-item-files');
  if (menuItemFiles) {
    menuItemFiles.addEventListener('click', () => {
      if (typeof openSalonFilesDrawer === 'function') openSalonFilesDrawer();
      else if (window.openSalonFilesDrawer) window.openSalonFilesDrawer();
      if (window.closeChatMoreMenu) window.closeChatMoreMenu();
    });
  }

  const menuItemMembers = document.getElementById('menu-item-members');
  if (menuItemMembers) {
    menuItemMembers.addEventListener('click', () => {
      if (state.activeSalon) {
        if (typeof openSalonInfoModal === 'function') openSalonInfoModal(state.activeSalon.id);
        else if (window.openSalonInfoModal) window.openSalonInfoModal(state.activeSalon.id);
      }
      if (window.closeChatMoreMenu) window.closeChatMoreMenu();
    });
  }

  const menuItemSuperadmin = document.getElementById('menu-item-superadmin');
  if (menuItemSuperadmin) {
    menuItemSuperadmin.addEventListener('click', () => {
      if (window.AdminDashboard) {
        window.AdminDashboard.open();
      } else {
        const s = document.createElement('script');
        s.src = '/js/admin-dashboard.min.js?v=1192';
        s.onload = () => window.AdminDashboard && window.AdminDashboard.open();
        document.body.appendChild(s);
      }
      if (window.closeChatMoreMenu) window.closeChatMoreMenu();
    });
  }

  const menuItemRefresh = document.getElementById('menu-item-refresh');
  if (menuItemRefresh) {
    menuItemRefresh.addEventListener('click', () => {
      if (typeof refreshActiveChat === 'function') refreshActiveChat();
      else if (window.refreshActiveChat) window.refreshActiveChat();
      if (window.closeChatMoreMenu) window.closeChatMoreMenu();
    });
  }

  const menuItemAdmin = document.getElementById('menu-item-admin');
  if (menuItemAdmin) {
    menuItemAdmin.addEventListener('click', () => {
      const adminModal = document.getElementById('admin-modal');
      if (adminModal) adminModal.style.display = 'flex';
      if (typeof loadAdminUsers === 'function') loadAdminUsers();
      else if (window.loadAdminUsers) window.loadAdminUsers();
      if (window.closeChatMoreMenu) window.closeChatMoreMenu();
    });
  }

  const menuItemSalonTasks = document.getElementById('menu-item-salon-tasks');
  if (menuItemSalonTasks) {
    menuItemSalonTasks.addEventListener('click', () => {
      if (state.activeSalon) {
        if (typeof openSalonTasksModal === 'function') openSalonTasksModal(state.activeSalon.id);
        else if (window.openSalonTasksModal) window.openSalonTasksModal(state.activeSalon.id);
      }
      if (window.closeChatMoreMenu) window.closeChatMoreMenu();
    });
  }

  const menuItemSalonBroadcast = document.getElementById('menu-item-salon-broadcast');
  if (menuItemSalonBroadcast) {
    menuItemSalonBroadcast.addEventListener('click', () => {
      if (state.activeSalon) {
        if (typeof toggleSalonBroadcastMode === 'function') toggleSalonBroadcastMode(state.activeSalon.id);
        else if (window.toggleSalonBroadcastMode) window.toggleSalonBroadcastMode(state.activeSalon.id);
      }
      if (window.closeChatMoreMenu) window.closeChatMoreMenu();
    });
  }

  const menuItemSalonSearch = document.getElementById('menu-item-salon-search');
  if (menuItemSalonSearch) {
    menuItemSalonSearch.addEventListener('click', () => {
      if (state.activeSalon) {
        if (typeof openSalonSearchModal === 'function') openSalonSearchModal(state.activeSalon.id);
        else if (window.openSalonSearchModal) window.openSalonSearchModal(state.activeSalon.id);
      }
      if (window.closeChatMoreMenu) window.closeChatMoreMenu();
    });
  }

  const menuItemSalonDecisions = document.getElementById('menu-item-salon-decisions');
  if (menuItemSalonDecisions) {
    menuItemSalonDecisions.addEventListener('click', () => {
      if (state.activeSalon) {
        if (typeof openSalonDecisionsModal === 'function') openSalonDecisionsModal(state.activeSalon.id);
        else if (window.openSalonDecisionsModal) window.openSalonDecisionsModal(state.activeSalon.id);
      }
      if (window.closeChatMoreMenu) window.closeChatMoreMenu();
    });
  }

  const menuItemSalonCaisse = document.getElementById('menu-item-salon-caisse');
  if (menuItemSalonCaisse) {
    menuItemSalonCaisse.addEventListener('click', () => {
      if (state.activeSalon) {
        if (typeof openSalonCaisseModal === 'function') openSalonCaisseModal(state.activeSalon.id);
        else if (window.openSalonCaisseModal) window.openSalonCaisseModal(state.activeSalon.id);
      }
      if (window.closeChatMoreMenu) window.closeChatMoreMenu();
    });
  }
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

// ---------------- MULTIPART FILE UPLOADER (With Client-Side Image Pre-Compression) ----------------
async function uploadFile(file) {
  let fileToUpload = file;
  if (file && file.type && file.type.startsWith('image/')) {
    try {
      fileToUpload = await compressImageForUpload(file);
    } catch (e) {
      console.warn('[-] Client image compression error, sending original:', e);
    }
  }

  const formData = new FormData();
  formData.append('file', fileToUpload);

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

// ---------------- COMPRESSED OPUS/WEBM VOICE RECORDER (24 kbps Ultra-Lightweight) ----------------

let mediaRecorder = null;
let recordedAudioChunks = [];

function getSupportedAudioMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/aac'
  ];
  for (const t of types) {
    if (window.MediaRecorder && typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return '';
}

async function startVoiceRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    const mimeType = getSupportedAudioMimeType();
    // Fixed 16 kbps Opus mono encoding for ultra-low data usage (~120 KB/min)
    const recorderOptions = mimeType ? { mimeType, audioBitsPerSecond: 16000 } : { audioBitsPerSecond: 16000 };

    if (window.MediaRecorder) {
      try {
        mediaRecorder = new MediaRecorder(stream, recorderOptions);
      } catch (e) {
        mediaRecorder = new MediaRecorder(stream);
      }
      recordedAudioChunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedAudioChunks.push(e.data);
        }
      };

      mediaRecorder.start(250); // collect chunks every 250ms
    }

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
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try { mediaRecorder.stop(); } catch (e) {}
    }
    mediaRecorder = null;
    if (voiceRecorder.stream) {
      voiceRecorder.stream.getTracks().forEach(t => t.stop());
      voiceRecorder.stream = null;
    }
    recordedAudioChunks = [];
  }
  document.getElementById('voice-recording-panel').style.display = 'none';
  document.getElementById('normal-composer-pill').style.display = 'flex';
}

async function stopAndSendVoiceRecording() {
  if (!voiceRecorder.isRecording) return;

  clearInterval(voiceRecorder.timerInterval);
  const durationSec = Math.max(1, Math.floor((Date.now() - voiceRecorder.startTime) / 1000));
  voiceRecorder.isRecording = false;

  const panel = document.getElementById('voice-recording-panel');
  const btnSend = document.getElementById('btn-send-voice');
  const btnCancel = document.getElementById('btn-cancel-voice');
  const timerEl = document.getElementById('recording-timer');
  const waveVisualizer = panel ? panel.querySelector('.recording-wave-visualizer') : null;

  // 1. Instantly lock buttons & show spinner so user knows upload is processing
  if (btnSend) {
    btnSend.disabled = true;
    btnSend.classList.add('loading');
    btnSend.innerHTML = `
      <svg class="spinner-audio-upload" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="2" x2="12" y2="6"></line>
        <line x1="12" y1="18" x2="12" y2="22"></line>
        <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
        <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
        <line x1="2" y1="12" x2="6" y2="12"></line>
        <line x1="18" y1="12" x2="22" y2="12"></line>
        <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
        <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
      </svg>
    `;
  }
  if (btnCancel) btnCancel.disabled = true;
  if (panel) panel.classList.add('uploading');
  if (timerEl) timerEl.textContent = 'Envoi...';
  if (waveVisualizer) waveVisualizer.style.opacity = '0.3';

  // 2. Insert optimistic placeholder bubble in chat feed
  const tempVoiceId = 'temp_voice_' + Date.now();
  const feed = document.getElementById('messages-feed');
  let tempBubble = null;
  if (feed) {
    tempBubble = document.createElement('div');
    tempBubble.className = 'message-row outgoing temp-voice-row';
    tempBubble.id = tempVoiceId;
    tempBubble.innerHTML = `
      <div class="message-bubble outgoing optimistic-voice-bubble">
        <svg class="spinner-audio-upload" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="2" x2="12" y2="6"></line>
          <line x1="12" y1="18" x2="12" y2="22"></line>
          <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
          <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
          <line x1="2" y1="12" x2="6" y2="12"></line>
          <line x1="18" y1="12" x2="22" y2="12"></line>
        </svg>
        <span>🎤 Envoi de la note vocale (${durationSec}s)...</span>
      </div>
    `;
    feed.appendChild(tempBubble);
    feed.scrollTop = feed.scrollHeight;
  }

  try {
    const audioBlob = await new Promise((resolve, reject) => {
      if (!mediaRecorder) return reject(new Error('MediaRecorder non initialisé'));

      mediaRecorder.onstop = () => {
        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        const blob = new Blob(recordedAudioChunks, { type: mimeType });
        resolve(blob);
      };

      mediaRecorder.onerror = (err) => reject(err);

      if (mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
    });

    if (voiceRecorder.stream) {
      voiceRecorder.stream.getTracks().forEach(t => t.stop());
      voiceRecorder.stream = null;
    }

    const isMp4 = audioBlob.type.includes('mp4') || audioBlob.type.includes('aac');
    const ext = isMp4 ? 'm4a' : 'webm';
    const audioFile = new File([audioBlob], `voice_${Date.now()}.${ext}`, { type: audioBlob.type || 'audio/webm' });

    console.log(`[+] Voice note compressed: ${(audioFile.size / 1024).toFixed(1)} KB for ${durationSec}s`);

    const uploaded = await uploadFile(audioFile);

    // Remove optimistic placeholder before standard message insertion
    if (tempBubble && tempBubble.parentNode) {
      tempBubble.remove();
    }

    sendMessage({
      type: 'audio',
      url: uploaded.url,
      duration: durationSec
    });
  } catch (err) {
    if (tempBubble && tempBubble.parentNode) {
      tempBubble.remove();
    }
    alert('Erreur lors de l\'envoi de la note vocale : ' + err.message);
  } finally {
    recordedAudioChunks = [];
    mediaRecorder = null;
    if (panel) {
      panel.classList.remove('uploading');
      panel.style.display = 'none';
    }
    if (btnSend) {
      btnSend.disabled = false;
      btnSend.classList.remove('loading');
      btnSend.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      `;
    }
    if (btnCancel) btnCancel.disabled = false;
    if (waveVisualizer) waveVisualizer.style.opacity = '1';
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
    if (err.name !== 'AbortError') {
      console.warn('[-] Error loading contacts from network, using offline store:', err.message || err);
    }
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
  renderCurrentActiveTabFeed();
  updateAllTabsBadges();

  // Restore active salon, contact, or support session from URL on startup
  const urlParams = new URLSearchParams(window.location.search);
  const urlSalon = urlParams.get('salon') || urlParams.get('salonId');
  const urlContact = urlParams.get('contact') || urlParams.get('contactId');
  const urlChannel = urlParams.get('channel') || (urlParams.get('support') ? 'support' : null);
  const urlSender = urlParams.get('sender') || urlParams.get('senderId');
  const urlMsg = urlParams.get('msg') || urlParams.get('messageId');

  if (urlSalon || urlContact || urlSender || urlChannel) {
    navigateToTarget({
      salonId: urlSalon,
      contactId: urlContact || urlSender,
      senderId: urlSender,
      channel: urlChannel,
      messageId: urlMsg
    });
    return;
  }

  if (urlParams.get('openRequests') === 'true') {
    switchTab('contacts');
    showModal('add-contact-modal');
    switchAddContactModalTab('requests');
  }

  // Handle direct invite link (?invite=username) with Confirmation Dialog
  const inviteUsername = urlParams.get('invite') || localStorage.getItem('digicom_pending_invite');
  if (inviteUsername) {
    localStorage.setItem('digicom_pending_invite', inviteUsername);
    if (state.user) {
      (async () => {
        try {
          const cleanName = inviteUsername.trim().replace(/^@/, '');
          if (cleanName.toLowerCase() === (state.user.username || '').toLowerCase()) {
            localStorage.removeItem('digicom_pending_invite');
            return;
          }
          const infoRes = await authFetch(`/api/contacts/invite-info/${encodeURIComponent(cleanName)}`);
          if (infoRes.ok) {
            const infoData = await infoRes.json();
            if (infoData.isContact) {
              localStorage.removeItem('digicom_pending_invite');
              const found = state.contacts.find(c => c.id === infoData.user.id);
              if (found) selectContact(found);
              return;
            }

            // Show Confirmation Dialog Modal
            const confirmModal = document.getElementById('confirm-invite-modal');
            const avatarEl = document.getElementById('confirm-invite-avatar');
            const nameEl = document.getElementById('confirm-invite-name');
            const tagEl = document.getElementById('confirm-invite-tag');
            const btnAccept = document.getElementById('btn-accept-direct-invite');
            const btnReject = document.getElementById('btn-reject-direct-invite');

            if (avatarEl) avatarEl.textContent = (infoData.user.displayName || infoData.user.username || '?').charAt(0).toUpperCase();
            if (nameEl) nameEl.textContent = infoData.user.displayName || infoData.user.username;
            if (tagEl) tagEl.textContent = `@${infoData.user.username}`;

            showModal('confirm-invite-modal');

            if (btnAccept) {
              btnAccept.onclick = async () => {
                btnAccept.disabled = true;
                const accRes = await authFetch('/api/contacts/accept-invite', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ username: cleanName })
                });
                localStorage.removeItem('digicom_pending_invite');
                hideModal('confirm-invite-modal');
                btnAccept.disabled = false;
                if (accRes.ok) {
                  const data = await accRes.json();
                  await loadContacts();
                  if (data.contact) {
                    const contactToSelect = state.contacts.find(c => c.id === data.contact.id);
                    if (contactToSelect) selectContact(contactToSelect);
                  }
                }
              };
            }

            if (btnReject) {
              btnReject.onclick = () => {
                localStorage.removeItem('digicom_pending_invite');
                hideModal('confirm-invite-modal');
              };
            }
          }
        } catch (e) {
          console.error('[-] Error handling invite modal:', e);
        }
      })();
    }
  }

}

async function renderMyQrCode() {
  const qrBox = document.getElementById('user-qr-code-box');
  const myTag = document.getElementById('my-username-tag');
  if (!qrBox || !state.user) return;
  const username = state.user.username;
  if (myTag) myTag.textContent = `@${username}`;
  const inviteUrl = `${window.location.origin}/?invite=${encodeURIComponent(username)}`;

  if (typeof window.DigiQR === 'undefined') {
    qrBox.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:200px;color:#94a3b8;font-size:0.85rem;"><div class="inline-spinner" style="width:20px;height:20px;border:2px solid rgba(16,185,129,0.2);border-top-color:#10b981;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:8px;"></div> Chargement du QR Code...</div>';
    try {
      await loadDynamicScript('/js/qrcode.min.js?v=1131');
    } catch (e) {
      console.warn('[-] Unable to load QR code engine:', e);
      qrBox.innerHTML = '<div style="color:#ef4444;font-size:0.85rem;padding:20px;">Erreur de chargement du QR Code</div>';
      return;
    }
  }

  if (window.DigiQR && typeof window.DigiQR.renderTo === 'function') {
    window.DigiQR.renderTo(qrBox, inviteUrl, 200, '#00a884', '#ffffff');
  }
}

function switchAddContactModalTab(tabName) {
  document.querySelectorAll('.modal-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
  });
  const panels = {
    qr: document.getElementById('modal-panel-qr'),
    exact: document.getElementById('modal-panel-exact'),
    requests: document.getElementById('modal-panel-requests')
  };
  Object.keys(panels).forEach(k => {
    if (panels[k]) {
      panels[k].style.display = (k === tabName) ? 'block' : 'none';
    }
  });

  if (tabName === 'qr') {
    renderMyQrCode();
  } else if (tabName === 'exact') {
    const input = document.getElementById('contact-exact-input');
    if (input) input.focus();
  } else if (tabName === 'requests') {
    loadPendingContactRequests();
  }
}

async function loadPendingContactRequests() {
  try {
    const res = await authFetch('/api/contacts/requests/pending');
    if (res.ok) {
      const data = await res.json();
      state.pendingContactRequests = data.requests || [];
      updateContactRequestsBadge();
      renderPendingContactRequests(state.pendingContactRequests);
    }
  } catch (e) {
    console.error('[-] Error loading pending contact requests:', e);
  }
}

function updateContactRequestsBadge() {
  const modalBadge = document.getElementById('modal-requests-badge');
  const headerBadge = document.getElementById('btn-add-contact-badge');
  const count = (state.pendingContactRequests || []).length;

  if (modalBadge) {
    if (count > 0) {
      modalBadge.textContent = count > 99 ? '99+' : count;
      modalBadge.style.display = 'inline-block';
    } else {
      modalBadge.textContent = '0';
      modalBadge.style.display = 'none';
    }
  }

  if (headerBadge) {
    if (count > 0) {
      headerBadge.textContent = count > 99 ? '99+' : count;
      headerBadge.classList.remove('action-btn-badge-hidden');
      headerBadge.style.display = 'block';
    } else {
      headerBadge.textContent = '0';
      headerBadge.classList.add('action-btn-badge-hidden');
      headerBadge.style.display = 'none';
    }
  }

  if (state.activeTab === 'contacts') {
    renderContactsList();
  }
}

function renderPendingContactRequests(requests) {
  const container = document.getElementById('pending-requests-container');
  if (!container) return;
  container.innerHTML = '';
  if (!requests || requests.length === 0) {
    container.innerHTML = `
      <div class="contact-search-placeholder">
        <div class="placeholder-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <div>Aucune demande de contact en attente.</div>
      </div>
    `;
    return;
  }

  requests.forEach(r => {
    const initial = (r.display_name || r.username || '?').charAt(0).toUpperCase();
    const card = document.createElement('div');
    card.className = 'pending-request-card';
    card.innerHTML = `
      <div class="exact-user-info">
        <div class="exact-user-avatar">${initial}</div>
        <div class="exact-user-details">
          <strong>${escapeHtml(r.display_name || r.username)}</strong>
          <span>@${escapeHtml(r.username)}</span>
        </div>
      </div>
      <div class="pending-actions">
        <button type="button" class="btn-action-reject" data-req-id="${r.request_id}">Rejet</button>
        <button type="button" class="btn-action-accept" data-req-id="${r.request_id}">Confirm</button>
      </div>
    `;

    card.querySelector('.btn-action-accept').onclick = async () => {
      try {
        const acceptRes = await authFetch(`/api/contacts/requests/${r.request_id}/accept`, { method: 'POST' });
        if (acceptRes.ok) {
          const accData = await acceptRes.json();
          hideModal('add-contact-modal');
          await loadContacts();
          if (accData.contact) {
            const newC = state.contacts.find(c => c.id === accData.contact.id);
            if (newC) selectContact(newC);
          }
          showInAppToast({
            title: 'Contact Ajouté !',
            body: `Vous pouvez désormais échanger avec ${r.display_name || r.username}.`,
            type: 'system'
          });
        }
      } catch (e) {
        alert('Erreur lors de l\'acceptation');
      }
    };

    card.querySelector('.btn-action-reject').onclick = async () => {
      try {
        const rejRes = await authFetch(`/api/contacts/requests/${r.request_id}/reject`, { method: 'POST' });
        if (rejRes.ok) {
          state.pendingContactRequests = state.pendingContactRequests.filter(x => x.request_id !== r.request_id);
          updateContactRequestsBadge();
          renderPendingContactRequests(state.pendingContactRequests);
        }
      } catch (e) {
        alert('Erreur lors du refus');
      }
    };

    container.appendChild(card);
  });
}

async function handleExactContactSearch(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('contact-exact-input');
  const feedback = document.getElementById('exact-search-feedback');
  if (!input || !feedback) return;
  const raw = input.value.trim().replace(/^@/, '');
  if (!raw) return;

  feedback.innerHTML = '<div style="text-align:center; padding: 1rem; color: var(--text-dim); font-size: 0.85rem;">Recherche en cours...</div>';

  try {
    const res = await authFetch('/api/contacts/find-exact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: raw })
    });
    const data = await res.json();
    if (!res.ok) {
      feedback.innerHTML = `
        <div style="text-align: center; padding: 1rem; color: #f43f5e; font-size: 0.85rem;">
          ${escapeHtml(data.error || 'Utilisateur introuvable.')}
        </div>
      `;
      return;
    }

    const u = data.user;
    const initial = (u.displayName || u.username || '?').charAt(0).toUpperCase();

    let actionBtnHtml = '';
    if (data.isContact) {
      actionBtnHtml = `<span class="exact-status-pill">Déjà dans vos contacts</span>`;
    } else if (data.hasPendingSent) {
      actionBtnHtml = `<span class="exact-status-pill" style="color: #f59e0b;">Demande déjà envoyée</span>`;
    } else if (data.incomingRequestId) {
      actionBtnHtml = `<button type="button" class="btn-action-accept" id="btn-exact-accept-now">Confirm</button>`;
    } else {
      actionBtnHtml = `<button type="button" class="btn-action-accept" id="btn-exact-send-invite">+ Envoyer une invitation</button>`;
    }

    feedback.innerHTML = `
      <div class="exact-user-card">
        <div class="exact-user-info">
          <div class="exact-user-avatar">${initial}</div>
          <div class="exact-user-details">
            <strong>${escapeHtml(u.displayName || u.username)}</strong>
            <span>@${escapeHtml(u.username)}</span>
          </div>
        </div>
        <div id="exact-card-actions">
          ${actionBtnHtml}
        </div>
      </div>
    `;

    const btnSend = document.getElementById('btn-exact-send-invite');
    if (btnSend) {
      btnSend.onclick = async () => {
        try {
          btnSend.disabled = true;
          const reqRes = await authFetch('/api/contacts/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetUserId: u.id })
          });
          const reqData = await reqRes.json();
          if (reqRes.ok) {
            if (reqData.autoAccepted) {
              hideModal('add-contact-modal');
              await loadContacts();
              const newC = state.contacts.find(c => c.id === u.id);
              if (newC) selectContact(newC);
            } else {
              document.getElementById('exact-card-actions').innerHTML = `<span class="exact-status-pill" style="color: #10b981;">✓ Invitation envoyée</span>`;
            }
          } else {
            alert(reqData.error || 'Erreur lors de l\'envoi');
            btnSend.disabled = false;
          }
        } catch (e) {
          alert('Erreur réseau');
          btnSend.disabled = false;
        }
      };
    }

    const btnAcceptNow = document.getElementById('btn-exact-accept-now');
    if (btnAcceptNow && data.incomingRequestId) {
      btnAcceptNow.onclick = async () => {
        try {
          btnAcceptNow.disabled = true;
          const accRes = await authFetch(`/api/contacts/requests/${data.incomingRequestId}/accept`, { method: 'POST' });
          if (accRes.ok) {
            hideModal('add-contact-modal');
            await loadContacts();
            const newC = state.contacts.find(c => c.id === u.id);
            if (newC) selectContact(newC);
          }
        } catch (e) {
          alert('Erreur');
        }
      };
    }

  } catch (err) {
    feedback.innerHTML = '<div style="text-align: center; padding: 1rem; color: #f43f5e; font-size: 0.85rem;">Erreur de connexion.</div>';
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

function formatConversationTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  
  const isToday = d.getDate() === now.getDate() &&
                  d.getMonth() === now.getMonth() &&
                  d.getFullYear() === now.getFullYear();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.getDate() === yesterday.getDate() &&
                      d.getMonth() === yesterday.getMonth() &&
                      d.getFullYear() === yesterday.getFullYear();
  if (isYesterday) {
    return 'Hier';
  }

  const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  if (diffDays < 7) {
    const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    return days[d.getDay()];
  }

  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function renderEyeStatusHtml(isRead, isPending) {
  if (isPending) {
    return `
      <span class="preview-status-eye pending" title="En attente">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8696a0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
      </span>
    `;
  }
  if (isRead) {
    return `
      <span class="preview-status-eye read" title="Message lu">
        <svg width="14" height="10" viewBox="0 0 16 12" fill="none">
          <path d="M8 1.5C4.5 1.5 1.5 6 1.5 6C1.5 6 4.5 10.5 8 10.5C11.5 10.5 14.5 6 14.5 6C14.5 6 11.5 1.5 8 1.5Z" stroke="#f97316" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="8" cy="6" r="2.2" fill="#f97316"/>
        </svg>
      </span>
    `;
  }
  return `
    <span class="preview-status-eye unread" title="Message distribué">
      <svg width="14" height="10" viewBox="0 0 16 12" fill="none">
        <path d="M8 1.5C4.5 1.5 1.5 6 1.5 6C1.5 6 4.5 10.5 8 10.5C11.5 10.5 14.5 6 14.5 6C14.5 6 11.5 1.5 8 1.5Z" stroke="#8696a0" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="8" cy="6" r="2.2" fill="#8696a0"/>
      </svg>
    </span>
  `;
}

function getCleanMessageDisplayText(content) {
  if (!content) return '';
  let parsed = content;
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try { parsed = JSON.parse(trimmed); } catch (e) { parsed = content; }
    }
  }

  if (typeof parsed === 'object' && parsed !== null) {
    if (parsed.text) return parsed.text;
    if (parsed.type === 'direct_contract_card') return `📜 [Micro-Contrat] ${parsed.title || ''}`;
    if (parsed.type === 'direct_payment_card') return `💳 [Règlement] ${Number(parsed.amount || 0).toLocaleString('fr-FR')} ${parsed.currency || 'FCFA'}`;
    if (parsed.type === 'decision_announcement' || parsed.isDecisionAnnouncement) return '📌 [Décision] ' + (parsed.title || '');
    if (parsed.type === 'task_announcement' || parsed.isTaskAnnouncement) return '📌 [Tâche] ' + (parsed.title || '');
    if (parsed.type === 'task_reminder') return '⏰ [Rappel Tâche] ' + (parsed.title || '');
    if (parsed.type === 'poll' || parsed.pollId) return '📊 [Sondage] ' + (parsed.question || '');
    if (parsed.type === 'meeting') return '📹 [Réunion] ' + (parsed.title || '');
    if (parsed.type === 'image') return '📷 [Photo] ' + (parsed.caption || parsed.fileName || '');
    if (parsed.type === 'video') return '🎥 [Vidéo] ' + (parsed.caption || parsed.fileName || '');
    if (parsed.type === 'audio') return '🎙️ [Note vocale]';
    if (parsed.type === 'file') return '📄 [Document] ' + (parsed.fileName || '');
    if (parsed.title) return parsed.title;
    return typeof content === 'string' ? content : '';
  }
  return String(parsed);
}

function getLastMessageInfo(type, id, item) {
  let content = null;
  let timestamp = null;
  let senderId = null;
  let isRead = false;
  let isPending = false;

  if (type === 'contact') {
    const history = state.directMessages[id];
    if (history && history.length > 0) {
      const lastMsg = history[history.length - 1];
      content = lastMsg.content;
      timestamp = lastMsg.timestamp || lastMsg.created_at;
      senderId = lastMsg.senderId || lastMsg.sender_id;
      isRead = Boolean(lastMsg.is_read === 1 || lastMsg.is_read === true || lastMsg.isRead === true);
      isPending = Boolean(lastMsg.isPending || lastMsg.pending);
    } else if (item && item.last_message) {
      content = item.last_message;
      timestamp = item.last_message_time;
      senderId = item.last_sender_id;
      isRead = Boolean(item.last_is_read === 1 || item.last_is_read === true);
    } else if (item) {
      timestamp = item.created_at;
    }
  } else if (type === 'salon') {
    const history = state.salonMessages[id];
    if (history && history.length > 0) {
      const lastMsg = history[history.length - 1];
      content = lastMsg.content;
      timestamp = lastMsg.timestamp || lastMsg.created_at;
      senderId = lastMsg.senderId || lastMsg.sender_id;
      isRead = Boolean(lastMsg.is_read === 1 || lastMsg.is_read === true || lastMsg.isRead === true);
    } else if (item && item.last_message) {
      content = item.last_message;
      timestamp = item.last_activity || item.created_at;
      senderId = item.last_sender_id;
      isRead = Boolean(item.last_is_read === 1 || item.last_is_read === true);
    } else if (item) {
      timestamp = item.last_activity || item.created_at;
    }
  } else if (type === 'support') {
    content = item ? item.last_message : null;
    timestamp = item ? (item.last_message_at || item.last_activity) : null;
    senderId = item ? item.last_sender_id : null;
    isRead = Boolean(item && (item.last_is_read === 1 || item.last_is_read === true));
  }

  const isMe = Boolean(state.user && senderId && (String(senderId) === String(state.user.id) || String(senderId).startsWith('admin_')));

  let text = '';
  if (content !== null && content !== undefined) {
    text = getCleanMessageDisplayText(content);
  }

  const snippet = text.length > 32 ? text.substring(0, 32) + '...' : text;
  const timeStr = formatConversationTime(timestamp);

  return {
    snippet,
    timestamp: timestamp ? new Date(timestamp).getTime() : 0,
    timeStr,
    isMe,
    isRead,
    isPending
  };
}

function renderConversationCardHtml({ type, id, title, avatarInitial, isOnline, isActive, unreadCount, categoryTag, categoryClass, lastInfo }) {
  const eyeHtml = lastInfo.isMe ? renderEyeStatusHtml(lastInfo.isRead, lastInfo.isPending) : '';
  const isUnreadMsg = !lastInfo.isMe && unreadCount > 0;
  const timeClass = unreadCount > 0 ? 'contact-time-text has-unread' : 'contact-time-text';
  const previewClass = isUnreadMsg ? 'contact-preview-box unread-text' : 'contact-preview-box';

  let avatarClass = 'contact-avatar-box';
  let badgeOnline = isOnline ? `<div class="micro-dot online" title="En ligne"></div>` : '';

  if (type === 'salon') {
    avatarClass = 'salon-icon-box';
    badgeOnline = '';
  } else if (type === 'support') {
    avatarClass = 'contact-avatar-box sos';
    badgeOnline = isOnline ? `<div class="micro-dot online" title="En ligne (Widget actif)"></div>` : '';
  }

  const categoryTagHtml = categoryTag ? `<span class="conversation-category-tag ${categoryClass}">${categoryTag}</span>` : '';
  const unreadBadgeHtml = unreadCount > 0 ? `<span class="contact-unread-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>` : '';

  return `
    <div class="${avatarClass}">
      ${avatarInitial}
      ${badgeOnline}
    </div>
    <div class="contact-details">
      <div class="contact-row-top">
        <div style="display: flex; align-items: center; min-width: 0; gap: 4px; overflow: hidden;">
          <span class="contact-name-text">${escapeHtml(title)}</span>
          ${categoryTagHtml}
        </div>
        <span class="${timeClass}">${escapeHtml(lastInfo.timeStr || '')}</span>
      </div>
      <div class="contact-row-bottom">
        <div class="${previewClass}">
          ${eyeHtml}
          <span>${escapeHtml(lastInfo.snippet || '')}</span>
        </div>
        ${unreadBadgeHtml}
      </div>
    </div>
  `;
}

function renderAllConversationsList() {
  const container = document.getElementById('all-list-container');
  if (!container || state.activeTab !== 'all') return;

  container.innerHTML = '';

  // Render prominent Pending Contact Requests banner if any
  if (state.pendingContactRequests && state.pendingContactRequests.length > 0) {
    const reqBanner = document.createElement('div');
    reqBanner.className = 'pending-requests-banner';
    const reqCount = state.pendingContactRequests.length;
    reqBanner.innerHTML = `
      <div class="pending-requests-banner-content">
        <div class="pending-banner-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="8.5" cy="7" r="4"></circle>
            <line x1="20" y1="8" x2="20" y2="14"></line>
            <line x1="23" y1="11" x2="17" y2="11"></line>
          </svg>
        </div>
        <div class="pending-banner-text">
          <strong>${reqCount} demande${reqCount > 1 ? 's' : ''} de contact reçue${reqCount > 1 ? 's' : ''}</strong>
          <span>Cliquez pour confirmer ou refuser</span>
        </div>
      </div>
      <button type="button" class="btn-pending-banner-action">Voir (${reqCount})</button>
    `;
    reqBanner.addEventListener('click', () => {
      showModal('add-contact-modal');
      switchAddContactModalTab('requests');
    });
    container.appendChild(reqBanner);
  }

  const allItems = [];

  // Add Direct Contacts
  (state.contacts || []).forEach(c => {
    const lastInfo = getLastMessageInfo('contact', c.id, c);
    const unreadCount = state.unreadCounts[c.id] || 0;
    const isOnline = state.onlineUserIds.includes(c.id);
    allItems.push({
      type: 'contact',
      id: c.id,
      title: c.display_name || c.username,
      rawItem: c,
      avatarInitial: (c.display_name || c.username || '?').charAt(0).toUpperCase(),
      isOnline,
      unreadCount,
      categoryTag: '',
      categoryClass: '',
      lastInfo
    });
  });

  // Add Salons
  (state.salons || []).forEach(s => {
    const lastInfo = getLastMessageInfo('salon', s.id, s);
    const unreadCount = state.unreadSalonCounts[s.id] || 0;
    allItems.push({
      type: 'salon',
      id: s.id,
      title: formatSalonName(s.name),
      rawItem: s,
      avatarInitial: '#',
      isOnline: false,
      unreadCount,
      categoryTag: 'Salon',
      categoryClass: 'salon',
      lastInfo
    });
  });

  // Add Support SOS if Admin
  if (state.user && state.user.role === 'admin') {
    (state.supportConversations || []).forEach(conv => {
      const lastInfo = getLastMessageInfo('support', conv.sender_id, conv);
      const unreadCount = conv.unread_count || 0;
      const title = (conv.sender_name && conv.sender_name.trim()) ? conv.sender_name : (conv.sender_id || 'Étudiant');
      const isOnline = isUserOnline(conv.sender_id);
      allItems.push({
        type: 'support',
        id: conv.sender_id,
        title,
        rawItem: conv,
        avatarInitial: title.charAt(0).toUpperCase(),
        isOnline,
        unreadCount,
        categoryTag: 'SOS',
        categoryClass: 'support',
        lastInfo
      });
    });
  }

  if (allItems.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.style.cssText = 'padding: 2rem 1.5rem; font-size: 0.85rem; color: var(--text-dim); text-align: center; line-height: 1.5;';
    emptyDiv.innerHTML = `
      Aucune conversation pour le moment.<br>
      Utilisez le bouton <strong>Connexions</strong> ci-dessus pour inviter vos amis ou créer un Salon.
    `;
    container.appendChild(emptyDiv);
    return;
  }

  // Filter with Search query
  const query = (state.searchQuery || '').trim().toLowerCase();
  let filteredItems = allItems;
  if (query) {
    filteredItems = allItems.filter(item => {
      return item.title.toLowerCase().includes(query) ||
             (item.lastInfo && item.lastInfo.snippet.toLowerCase().includes(query));
    });
  }

  // Sort by latest message timestamp descending
  filteredItems.sort((a, b) => (b.lastInfo.timestamp || 0) - (a.lastInfo.timestamp || 0));

  filteredItems.forEach(item => {
    let isActive = false;
    if (item.type === 'contact') isActive = state.activeContact && String(state.activeContact.id) === String(item.id);
    else if (item.type === 'salon') isActive = state.activeSalon && String(state.activeSalon.id) === String(item.id);
    else if (item.type === 'support') isActive = state.activeSupportSession && String(state.activeSupportSession) === String(item.id);

    const card = document.createElement('div');
    card.className = `contact-card ${isActive ? 'active' : ''}`;
    card.dataset.userId = item.id;
    card.innerHTML = renderConversationCardHtml({
      type: item.type,
      id: item.id,
      title: item.title,
      avatarInitial: item.avatarInitial,
      isOnline: item.isOnline,
      isActive,
      unreadCount: item.unreadCount,
      categoryTag: item.categoryTag,
      categoryClass: item.categoryClass,
      lastInfo: item.lastInfo
    });

    card.addEventListener('click', () => {
      if (item.type === 'contact') selectContact(item.rawItem);
      else if (item.type === 'salon') selectSalon(item.rawItem);
      else if (item.type === 'support') window.openSupportConversationBySenderId(item.rawItem.sender_id);
    });

    container.appendChild(card);
  });
}

function renderContactsList() {
  const container = document.getElementById('contacts-list-container');
  if (!container || state.activeTab !== 'contacts') return;

  container.innerHTML = '';

  // Render prominent Pending Contact Requests banner if any
  if (state.pendingContactRequests && state.pendingContactRequests.length > 0) {
    const reqBanner = document.createElement('div');
    reqBanner.className = 'pending-requests-banner';
    const reqCount = state.pendingContactRequests.length;
    reqBanner.innerHTML = `
      <div class="pending-requests-banner-content">
        <div class="pending-banner-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="8.5" cy="7" r="4"></circle>
            <line x1="20" y1="8" x2="20" y2="14"></line>
            <line x1="23" y1="11" x2="17" y2="11"></line>
          </svg>
        </div>
        <div class="pending-banner-text">
          <strong>${reqCount} demande${reqCount > 1 ? 's' : ''} de contact reçue${reqCount > 1 ? 's' : ''}</strong>
          <span>Cliquez pour confirmer ou refuser</span>
        </div>
      </div>
      <button type="button" class="btn-pending-banner-action">Voir (${reqCount})</button>
    `;
    reqBanner.addEventListener('click', () => {
      showModal('add-contact-modal');
      switchAddContactModalTab('requests');
    });
    container.appendChild(reqBanner);
  }

  if (state.contacts.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.style.cssText = 'padding: 2rem 1.5rem; font-size: 0.85rem; color: var(--text-dim); text-align: center; line-height: 1.5;';
    emptyDiv.innerHTML = `
      Aucun contact pour le moment.<br>
      Cliquez sur l'icône <strong>Connexions</strong> en haut pour partager votre QR Code ou ajouter un ami par @pseudo.
    `;
    container.appendChild(emptyDiv);
    return;
  }

  const query = (state.searchQuery || '').trim().toLowerCase();
  let contactsToRender = [...state.contacts];

  if (query) {
    contactsToRender = contactsToRender.filter(c => {
      const name = (c.display_name || c.username || '').toLowerCase();
      const username = (c.username || '').toLowerCase();
      const lastInfo = getLastMessageInfo('contact', c.id, c);
      return name.includes(query) || username.includes(query) || (lastInfo.snippet || '').toLowerCase().includes(query);
    });
  }

  // Sort by latest message timestamp descending
  contactsToRender.sort((a, b) => {
    const infoA = getLastMessageInfo('contact', a.id, a);
    const infoB = getLastMessageInfo('contact', b.id, b);
    return (infoB.timestamp || 0) - (infoA.timestamp || 0);
  });

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
    const unreadCount = state.unreadCounts[c.id] || 0;
    const lastInfo = getLastMessageInfo('contact', c.id, c);
    const initial = (c.display_name || c.username || '?').charAt(0).toUpperCase();

    const item = document.createElement('div');
    item.className = `contact-card ${isActive ? 'active' : ''}`;
    item.dataset.userId = c.id;
    item.innerHTML = renderConversationCardHtml({
      type: 'contact',
      id: c.id,
      title: c.display_name || c.username,
      avatarInitial: initial,
      isOnline,
      isActive,
      unreadCount,
      categoryTag: '',
      categoryClass: '',
      lastInfo
    });

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
  localStorage.removeItem('digicom_active_salon');

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

  // Show composer and 1-on-1 call actions
  const composer = document.getElementById('chat-input-area');
  if (composer) composer.style.display = 'block';
  const callActions = document.getElementById('chat-header-call-actions');
  if (callActions) callActions.style.display = 'flex';

  // Strictly hide all Salon-specific tools in 1-on-1 private chat
  const btnCreatePoll = document.getElementById('btn-create-poll');
  if (btnCreatePoll) btnCreatePoll.style.display = 'none';

  ['menu-item-meeting', 'menu-item-files', 'menu-item-members', 'menu-item-salon-tasks', 'menu-item-salon-broadcast', 'menu-item-salon-search', 'menu-item-salon-decisions', 'menu-item-salon-caisse'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Show Direct 1-on-1 items in 3-dots dropdown
  ['menu-item-direct-contract', 'menu-item-direct-deadlines', 'menu-item-direct-privacy', 'menu-item-direct-payments', 'menu-item-direct-files'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'flex';
  });

  renderContactsList();
  loadDirectHistory(contact.id);
  loadPinnedMessageForActiveChat();
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

async function loadDirectHistory(targetUserId, loadMore = false) {
  const feed = document.getElementById('messages-feed');

  if (!state.feedPagination) {
    state.feedPagination = {};
  }
  const pag = state.feedPagination[targetUserId] || { hasMore: true, isLoading: false, oldestTimestamp: null };
  state.feedPagination[targetUserId] = pag;

  if (loadMore) {
    if (pag.isLoading || !pag.hasMore || !pag.oldestTimestamp) return;
    pag.isLoading = true;
    try {
      const res = await authFetch(`/api/history/direct/${targetUserId}?limit=50&before=${encodeURIComponent(pag.oldestTimestamp)}`);
      if (res.ok) {
        const data = await res.json();
        const olderMsgs = data.messages || [];
        if (olderMsgs.length < 50) {
          pag.hasMore = false;
        }
        if (olderMsgs.length > 0) {
          pag.oldestTimestamp = olderMsgs[0].timestamp;
          state.directMessages[targetUserId] = [...olderMsgs, ...(state.directMessages[targetUserId] || [])];
          if (window.digiStore) {
            window.digiStore.saveMessagesBatch(olderMsgs).catch(() => {});
          }
          prependOlderMessagesToFeed(olderMsgs);
        }
      }
    } catch (e) {
      console.error('[-] Error loading older direct messages:', e);
    } finally {
      pag.isLoading = false;
    }
    return;
  }

  // Initial load of 50 messages
  pag.hasMore = true;
  pag.isLoading = false;

  // 1. Instant local offline load from IndexedDB (first 50)
  if (window.digiStore && state.user) {
    try {
      const cachedMsgs = await window.digiStore.getMessages(state.user.id, targetUserId, 50);
      if (cachedMsgs && cachedMsgs.length > 0) {
        state.directMessages[targetUserId] = cachedMsgs;
        pag.oldestTimestamp = cachedMsgs[0].timestamp;
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
    const res = await authFetch(`/api/history/direct/${targetUserId}?limit=50`);
    if (res.ok) {
      const data = await res.json();
      const newMsgs = data.messages || [];

      // Reconcile: compare message IDs to avoid destroying and rebuilding DOM if identical
      const currentIds = (state.directMessages[targetUserId] || []).map(m => m.id).join(',');
      const incomingIds = newMsgs.map(m => m.id).join(',');
      const hasChanged = currentIds !== incomingIds;

      state.directMessages[targetUserId] = newMsgs;
      state.unreadCounts[targetUserId] = 0;
      if (newMsgs.length > 0) {
        pag.oldestTimestamp = newMsgs[0].timestamp;
        if (newMsgs.length < 50) pag.hasMore = false;
      } else {
        pag.hasMore = false;
      }
      if (window.digiStore) {
        window.digiStore.saveMessagesBatch(newMsgs).catch(() => {});
        window.digiStore.pruneOldMessages().catch(() => {});
      }
      renderContactsList();
      if (hasChanged && state.activeContact && String(state.activeContact.id) === String(targetUserId)) {
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
  const pinBtn = document.getElementById('ctx-action-pin');
  
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
  if (pinBtn) pinBtn.style.display = 'flex';

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

// ---- Link Preview Engine (with Promise Caching & Hotlink Protection) ----
const _linkPreviewCache = new Map(); // url -> Promise<data>

function extractFirstUrl(text) {
  if (!text) return null;
  const m = String(text).match(/https?:\/\/[^\s<>"]+/i);
  if (!m) return null;
  let url = m[0];
  // Strip trailing punctuation attached to url
  url = url.replace(/[.,;:!?)\]>]+$/, '');
  return url;
}

async function fetchLinkPreview(url) {
  if (!url) return null;
  if (_linkPreviewCache.has(url)) {
    return await _linkPreviewCache.get(url);
  }

  const promise = (async () => {
    try {
      const res = await authFetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
      if (!res.ok) return null;
      const data = await res.json();
      return (data && (data.title || data.image || data.description)) ? data : null;
    } catch {
      return null;
    }
  })();

  _linkPreviewCache.set(url, promise);
  return await promise;
}

function buildLinkPreviewCard(data) {
  if (!data || (!data.title && !data.image && !data.description)) return null;
  const card = document.createElement('a');
  card.href = data.url;
  card.target = '_blank';
  card.rel = 'noopener noreferrer';
  card.className = 'link-preview-card';

  let imageHtml = '';
  if (data.image) {
    imageHtml = `<img class="link-preview-image" src="${escapeHtml(data.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`;
  }

  card.innerHTML = `
    ${imageHtml}
    <div class="link-preview-body">
      ${data.domain ? `<span class="link-preview-domain">${escapeHtml(data.domain)}</span>` : ''}
      ${data.title ? `<span class="link-preview-title">${escapeHtml(data.title)}</span>` : ''}
      ${data.description ? `<span class="link-preview-desc">${escapeHtml(data.description)}</span>` : ''}
    </div>
  `;
  return card;
}

async function attachLinkPreviews(rowEl) {
  if (!rowEl) return;
  const bubble = rowEl.querySelector('.msg-bubble');
  if (!bubble) return;

  // Only text bubbles (skip media and voice notes)
  if (bubble.classList.contains('media-bubble') || bubble.classList.contains('image-bubble') ||
      bubble.classList.contains('video-bubble') || bubble.classList.contains('file-bubble') ||
      bubble.classList.contains('audio-bubble')) return;
  if (bubble.querySelector('.link-preview-card') || bubble.querySelector('.link-preview-loading')) return;

  const linkEl = bubble.querySelector('a.chat-link');
  let url = linkEl ? linkEl.getAttribute('href') : null;
  if (!url) {
    const metaEl = bubble.querySelector('.msg-meta');
    const tempText = metaEl ? bubble.innerText.replace(metaEl.innerText, '') : bubble.innerText;
    url = extractFirstUrl(tempText);
  }
  if (!url || !url.startsWith('http')) return;

  // If already resolved in cache, render immediately without any loading spinner
  if (_linkPreviewCache.has(url)) {
    const cachedData = await _linkPreviewCache.get(url);
    if (cachedData && !bubble.querySelector('.link-preview-card')) {
      const card = buildLinkPreviewCard(cachedData);
      if (card) bubble.appendChild(card);
      return;
    }
  }

  // Not in cache: show subtle spinner and fetch
  const loader = document.createElement('div');
  loader.className = 'link-preview-loading';
  loader.innerHTML = `<div class="link-preview-spinner"></div><span>Aperçu du lien…</span>`;
  bubble.appendChild(loader);

  const data = await fetchLinkPreview(url);
  loader.remove();

  if (data && !bubble.querySelector('.link-preview-card')) {
    const card = buildLinkPreviewCard(data);
    if (card) {
      bubble.appendChild(card);
      const feed = document.getElementById('messages-feed');
      if (feed && (feed.scrollHeight - feed.scrollTop - feed.clientHeight < 400)) {
        scrollToBottom(false);
      }
    }
  }
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

function createMessageRowElement(msg, isSos = false) {
  const currentUserId = state.user ? String(state.user.id || '') : '';
  const msgSenderId = String(msg.senderId || msg.sender_id || '');
  const isMe = currentUserId !== '' && msgSenderId !== '' && currentUserId === msgSenderId;
  const row = document.createElement('div');
  const msgId = msg.id || 'msg_' + Date.now();
  row.id = msgId;
  row.dataset.msgId = msgId;
  const rawSender = msg.senderName || msg.sender_name || 'Contact';
  row.dataset.sender = rawSender;
  row.dataset.timestamp = msg.timestamp || '';
  row._msgContent = msg.content;

  const canDelete = isMe || (state.user && state.user.role === 'admin');
  row.dataset.canDelete = canDelete ? 'true' : 'false';
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
    const fn = escapeHtml(parsedContent.fileName || 'Image');
    bodyHtml = `
      <div class="chat-image-card" onclick="openLightbox('${parsedContent.url}', '${fn}')" style="position: relative;">
        <img src="${parsedContent.url}" alt="${fn}" loading="lazy">
        ${!isMe ? `
        <a href="${parsedContent.url}" download="${fn}" class="media-download-overlay" onclick="handleMediaDownload(event, this);" title="Télécharger">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </a>` : ''}
      </div>
    `;
  } else if (parsedContent && parsedContent.type === 'video') {
    const fn = escapeHtml(parsedContent.fileName || 'Video');
    bodyHtml = `
      <div class="chat-video-card" style="position: relative;">
        <video src="${parsedContent.url}" controls preload="metadata" playsinline class="chat-video-player"></video>
        ${!isMe ? `
        <a href="${parsedContent.url}" download="${fn}" class="media-download-overlay" onclick="handleMediaDownload(event, this);" title="Télécharger la vidéo">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </a>` : ''}
      </div>
    `;
  } else if (parsedContent && parsedContent.type === 'file') {
    const fn = escapeHtml(parsedContent.fileName || 'Document');
    bodyHtml = `
      <a href="${parsedContent.url}" download="${fn}" class="chat-file-card" target="_blank" rel="noopener">
        <div class="file-icon-box">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
        </div>
        <div class="file-meta">
          <div class="file-name">${fn}</div>
          <div class="file-size">${formatBytes(parsedContent.fileSize)}</div>
        </div>
        ${!isMe ? `
        <div class="file-download-btn" onclick="handleMediaDownload(event, this);" title="Télécharger le fichier">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>Télécharger</span>
        </div>` : ''}
      </a>
    `;
  } else if (parsedContent && parsedContent.type === 'audio') {
    const audioId = 'audio_' + Math.random().toString(36).substr(2, 9);
    const durationFormatted = parsedContent.duration ? formatDuration(parsedContent.duration) : '0:00';
    bodyHtml = `
      <div class="chat-voice-note" id="box_${audioId}">
        <audio id="${audioId}" src="${parsedContent.url}" preload="none" playsinline webkit-playsinline
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
  } else if (parsedContent && parsedContent.type === 'meeting') {
    const roomName = parsedContent.roomName || `DigiCom_Salon_${msg.receiverId || msg.receiver_id}`;
    const startedBy = parsedContent.startedBy || msg.senderName || 'un membre';
    bodyHtml = `
      <div class="meeting-card" style="display:flex; flex-direction:column; gap:8px; padding:6px 0;">
        <div style="font-weight:700; font-size:0.9rem; color:#ffffff;">Réunion vidéo de Salon</div>
        <div style="font-size:0.8rem; color:rgba(255,255,255,0.7);">Démarrée par ${escapeHtml(startedBy)}</div>
        <button type="button" class="btn-join-salon-meeting-card" onclick="window.joinJitsiSalonMeeting('${escapeHtml(roomName)}')" style="background:rgba(16,185,129,0.2); border:1px solid rgba(16,185,129,0.4); color:#10b981; padding:8px 14px; border-radius:8px; font-size:0.82rem; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:6px; margin-top:4px;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="23 7 16 12 23 17 23 7"></polygon>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
          </svg>
          Rejoindre la réunion
        </button>
      </div>
    `;
  } else if (parsedContent && parsedContent.type === 'direct_contract_card') {
    const ctrId = parsedContent.contractId || '';
    const ctrTitle = escapeHtml(parsedContent.title || 'Micro-Contrat');
    const ctrDesc = escapeHtml(parsedContent.description || '');
    const ctrAmount = `${Number(parsedContent.amount || 0).toLocaleString('fr-FR')} ${escapeHtml(parsedContent.currency || 'FCFA')}`;
    const ctrDeadline = parsedContent.deadline ? new Date(parsedContent.deadline).toLocaleDateString('fr-FR') : 'Non spécifiée';
    const ctrStatus = parsedContent.status || 'pending';
    const myId = state.user ? state.user.id : '';
    const isCreator = (parsedContent.createdBy === myId);

    let statusPillClass = 'contract-status-pending';
    let statusLabel = 'En attente';
    if (ctrStatus === 'accepted') { statusPillClass = 'contract-status-accepted'; statusLabel = 'Scellé & En cours'; }
    else if (ctrStatus === 'adjustment_requested') { statusPillClass = 'contract-status-adjustment'; statusLabel = 'Ajustement proposé'; }
    else if (ctrStatus === 'completed') { statusPillClass = 'contract-status-completed'; statusLabel = 'Mission terminée'; }
    else if (ctrStatus === 'cancelled') { statusPillClass = 'contract-status-cancelled'; statusLabel = 'Annulé / Rejeté'; }

    let actionsHtml = '';
    if (['pending', 'adjustment_requested'].includes(ctrStatus)) {
      if (!isCreator) {
        actionsHtml = `
          <div class="contract-actions-group">
            <button type="button" class="btn-contract-btn btn-contract-accept-lg" onclick="window.handleContractAction('${ctrId}', 'accept')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span>Accepter &amp; Sceller l'engagement</span>
            </button>
            <div class="contract-actions-subrow">
              <button type="button" class="btn-contract-btn btn-contract-adjust-sm" onclick="window.handleContractAction('${ctrId}', 'adjust')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                <span>Ajuster</span>
              </button>
              <button type="button" class="btn-contract-btn btn-contract-reject-sm" onclick="window.handleContractAction('${ctrId}', 'reject')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                <span>Rejeter</span>
              </button>
            </div>
          </div>
        `;
      } else {
        actionsHtml = `
          <div class="contract-actions-group">
            <button type="button" class="btn-contract-btn btn-contract-cancel-lg" onclick="window.handleContractAction('${ctrId}', 'cancel')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              <span>Annuler la proposition de contrat</span>
            </button>
          </div>
        `;
      }
    } else if (ctrStatus === 'accepted') {
      actionsHtml = `
        <div class="contract-actions-group">
          <button type="button" class="btn-contract-btn btn-contract-complete-lg" onclick="window.handleContractAction('${ctrId}', 'complete')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            <span>Marquer la mission comme Terminée</span>
          </button>
          <div class="contract-actions-subrow">
            <button type="button" class="btn-contract-btn btn-contract-reject-sm" style="width: 100%;" onclick="window.handleContractAction('${ctrId}', 'cancel')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              <span>Annuler l'engagement</span>
            </button>
          </div>
        </div>
      `;
    }

    bodyHtml = `
      <div class="chat-contract-card-premium status-${ctrStatus}">
        <div class="contract-card-header-bar">
          <div class="contract-card-badge-pill">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
            <span>MICRO-CONTRAT D'ENGAGEMENT</span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="contract-card-status-pill ${statusPillClass}">${statusLabel}</span>
            <button type="button" class="btn-contract-btn btn-contract-reject-sm" style="padding: 2px 6px; min-width: auto; border-radius: 6px;" onclick="window.deleteDirectContract('${ctrId}')" title="Supprimer ce contrat">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>

        <div class="contract-box-title">
          <div class="contract-title-text">${ctrTitle}</div>
          ${ctrDesc ? `<div class="contract-desc-text">${ctrDesc}</div>` : ''}
          ${parsedContent.actionNote ? `<div class="contract-note-text"><strong>Ajustement demandé :</strong> "${escapeHtml(parsedContent.actionNote)}"</div>` : ''}
        </div>

        <div class="contract-box-amount">
          <span class="contract-amount-label">Montant convenu</span>
          <span class="contract-amount-value">${ctrAmount}</span>
        </div>

        <div class="contract-box-deadline">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #34d399;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
          <span>Livraison prévue : <strong>${ctrDeadline}</strong></span>
        </div>

        ${actionsHtml}
      </div>
    `;
  } else if (parsedContent && parsedContent.type === 'direct_payment_card') {
    const payAmount = `${Number(parsedContent.amount || 0).toLocaleString('fr-FR')} ${escapeHtml(parsedContent.currency || 'FCFA')}`;
    const payMethod = escapeHtml(parsedContent.paymentMethod || 'Mobile Money');
    const isMe = (parsedContent.paidBy === (state.user ? state.user.id : ''));

    bodyHtml = `
      <div class="direct-chat-contract-card" style="background: linear-gradient(145deg, #064e3b, #0f172a);">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
          <span style="font-size:0.7rem; font-weight:700; color:#34d399; text-transform:uppercase; letter-spacing:0.04em;">Versement Déclaré</span>
          <span style="background:rgba(52,211,153,0.2); color:#34d399; font-weight:700; font-size:0.8rem; padding:2px 8px; border-radius:12px;">${payAmount}</span>
        </div>
        <div style="font-size:0.82rem; color:#e2e8f0; margin-top:2px;">Via <strong>${payMethod}</strong> ${parsedContent.reference ? `• Réf: ${escapeHtml(parsedContent.reference)}` : ''}</div>
        ${parsedContent.note ? `<div style="font-size:0.75rem; color:#cbd5e1; font-style:italic;">"${escapeHtml(parsedContent.note)}"</div>` : ''}
        <button type="button" class="btn-contract-action btn-contract-accept" style="margin-top:6px;" onclick="window.openDirectPaymentsModal && window.openDirectPaymentsModal()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"></rect><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
          <span>${isMe ? 'Consulter le règlement' : 'Confirmer la réception'}</span>
        </button>
      </div>
    `;
  } else if (parsedContent && (parsedContent.isTaskAnnouncement || parsedContent.type === 'task_announcement')) {
    const isCreated = parsedContent.action !== 'updated';
    const taskTitle = escapeHtml(parsedContent.title || 'Tâche du salon');
    const creator = escapeHtml(parsedContent.creatorName || parsedContent.changerName || 'Membre');
    const assigned = escapeHtml(parsedContent.assignedName || 'Toute l\'équipe');
    const statusLbl = escapeHtml(parsedContent.statusLabel || 'Mise à jour');

    bodyHtml = `
      <div class="chat-task-card">
        <div class="task-card-header">
          <div class="task-card-badge">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 11 12 14 22 4"></polyline>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
            </svg>
            <span>${isCreated ? 'NOUVELLE TÂCHE' : 'MISE À JOUR DE TÂCHE'}</span>
          </div>
        </div>

        <div class="task-card-body">
          <div class="task-card-title">${taskTitle}</div>
          <div class="task-card-details">
            ${isCreated ? `
              <span class="task-detail-item">Créée par : <strong>${creator}</strong></span>
              <span class="task-detail-item">Assignée à : <strong>${assigned}</strong></span>
            ` : `
              <span class="task-detail-item">Modifiée par : <strong>${creator}</strong></span>
              <span class="task-detail-item">Nouveau statut : <strong class="status-highlight">${statusLbl}</strong></span>
            `}
          </div>
        </div>

        <button type="button" class="btn-task-card-action" onclick="if(state.activeSalon){openSalonTasksModal(state.activeSalon.id);}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
          <span>Ouvrir les Tâches du Salon</span>
        </button>
      </div>
    `;
  } else if (parsedContent && parsedContent.type === 'task_reminder') {
    const taskTitle = escapeHtml(parsedContent.title || 'Tâche');
    const assignedName = escapeHtml(parsedContent.assignedName || 'Toute l\'équipe');
    const taskId = escapeHtml(parsedContent.taskId || '');

    bodyHtml = `
      <div class="chat-task-card task-reminder-card">
        <div class="task-card-header">
          <div class="task-card-badge reminder-badge">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <span>RAPPEL D'ÉCHÉANCE DU JOUR</span>
          </div>
        </div>

        <div class="task-card-body">
          <div class="task-card-title">${taskTitle}</div>
          <div class="task-reminder-desc">
            La tâche <strong>"${taskTitle}"</strong> (Assignée à : <strong>${assignedName}</strong>) est prévue pour <strong>aujourd'hui</strong> !<br>
            <span class="task-reminder-instruction">Si entamée, basculez sur <strong>En cours</strong>. Une fois terminée, passez sur <strong>Terminé</strong>.</span>
          </div>
        </div>

        <div class="task-quick-actions-row">
          <button type="button" class="btn-task-quick-action btn-task-start" onclick="window.moveSalonTask('${taskId}', 'in_progress')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            <span>Démarrer</span>
          </button>
          <button type="button" class="btn-task-quick-action btn-task-finish" onclick="window.moveSalonTask('${taskId}', 'done')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span>Fin</span>
          </button>
        </div>
      </div>
    `;
  } else if (parsedContent && (parsedContent.isDecisionAnnouncement || parsedContent.type === 'decision_announcement')) {
    const decisionTitle = escapeHtml(parsedContent.title || 'Décision Actée');
    const responsible = escapeHtml(parsedContent.responsibleName || 'Toute l\'équipe');
    const creator = escapeHtml(parsedContent.creatorName || 'Membre');
    const desc = escapeHtml(parsedContent.description || '');

    bodyHtml = `
      <div class="chat-task-card chat-decision-card">
        <div class="task-card-header">
          <div class="task-card-badge decision-badge">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            </svg>
            <span>DÉCISION ACTÉE</span>
          </div>
        </div>

        <div class="task-card-body">
          <div class="task-card-title">${decisionTitle}</div>
          ${desc ? `<div class="decision-card-desc-preview">${desc}</div>` : ''}
          <div class="task-card-details" style="margin-top: 0.35rem;">
            <span class="task-detail-item">Responsable : <strong>${responsible}</strong></span>
            <span class="task-detail-item">Acté par : <strong>${creator}</strong></span>
          </div>
        </div>

        <button type="button" class="btn-task-card-action btn-decision-action" onclick="if(state.activeSalon){openSalonDecisionsModal(state.activeSalon.id);}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
          <span>Consulter le Registre des Décisions</span>
        </button>
      </div>
    `;
  } else if (msg.pollId || (parsedContent && parsedContent.pollId)) {
    const pollId = msg.pollId || parsedContent.pollId;
    bodyHtml = `<div class="poll-container-placeholder" id="poll-container-${pollId}">Chargement du sondage...</div>`;
    setTimeout(() => loadAndRenderPollCard(pollId), 50);
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
  const isDeletedAudit = (msg.deleted_scope === 'sender_only' || msg.deletedScope === 'sender_only') && state.user && state.user.role === 'admin';
  const auditBadgeHtml = isDeletedAudit ? `<div class="msg-deleted-badge"><span style="display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>Supprimé par le membre</span></div>` : '';

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

  if (parsedContent && parsedContent.type === 'audio') {
    const audioEl = row.querySelector('audio');
    if (audioEl) {
      setupAudioPlayer(audioEl.id);
    }
  }

  return row;
}

function prependOlderMessagesToFeed(olderMsgs) {
  const feed = document.getElementById('messages-feed');
  if (!feed || !olderMsgs || olderMsgs.length === 0) return;

  const previousScrollHeight = feed.scrollHeight;
  const previousScrollTop = feed.scrollTop;

  const fragment = document.createDocumentFragment();
  let lastDateKey = null;

  olderMsgs.forEach(msg => {
    const dateKey = formatMessageDateGroup(msg.timestamp);
    if (dateKey && dateKey !== lastDateKey) {
      const sep = document.createElement('div');
      sep.className = 'chat-date-separator';
      sep.dataset.dateKey = dateKey;
      sep.innerHTML = `<span>${escapeHtml(dateKey)}</span>`;
      fragment.appendChild(sep);
      lastDateKey = dateKey;
    }
    const row = createMessageRowElement(msg, false);
    if (row) {
      fragment.appendChild(row);
      attachLinkPreviews(row);
    }
  });

  feed.insertBefore(fragment, feed.firstChild);

  // Maintain precise scroll position
  const newScrollHeight = feed.scrollHeight;
  feed.scrollTop = previousScrollTop + (newScrollHeight - previousScrollHeight);
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

  const row = createMessageRowElement(msg, isSos);
  if (!row) return;

  const parsedContent = typeof msg.content === 'object' ? msg.content : null;
  if (parsedContent && parsedContent.type === 'image') {
    const imgEl = row.querySelector('.chat-image-card img');
    if (imgEl) {
      imgEl.addEventListener('load', () => {
        if (autoScroll || (feed.scrollHeight - feed.scrollTop - feed.clientHeight < 500)) {
          scrollToBottom(false);
        }
      }, { once: true });
    }
  }

  feed.appendChild(row);
  attachLinkPreviews(row);

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

window.handleMediaDownload = function(event, btnEl) {
  if (event) event.stopPropagation();
  if (btnEl) {
    btnEl.classList.add('downloaded');
    const span = btnEl.querySelector('span');
    if (span) span.textContent = 'Téléchargé';
    setTimeout(() => {
      btnEl.style.opacity = '0.35';
      btnEl.style.pointerEvents = 'none';
    }, 1500);
  }
};

window.toggleAudioPlay = async function(audioId) {
  const audio = document.getElementById(audioId);
  const playIcon = document.getElementById('icon_play_' + audioId);
  const pauseIcon = document.getElementById('icon_pause_' + audioId);

  if (!audio) return;

  if (audio.paused) {
    // Reset currentTime if audio ended or reached near end to allow seamless replay on mobile WebKit/Chrome
    if (audio.ended || (audio.duration && audio.currentTime >= audio.duration - 0.1)) {
      try { audio.currentTime = 0; } catch (e) {}
    }

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

    try {
      await audio.play();
      if (playIcon) playIcon.style.display = 'none';
      if (pauseIcon) pauseIcon.style.display = 'block';
    } catch (err) {
      console.warn('Native HTML5 audio playback error:', err);
    }
  } else {
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

  if (audio) {
    try { audio.currentTime = 0; } catch (e) {}
    if (audio.src && audio.src.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(audio.src);
      } catch (e) {}
    }
  }

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

window.openLightbox = function(url, fileName = '') {
  const lightbox = document.getElementById('image-lightbox');
  const img = document.getElementById('lightbox-img');
  const downloadBtn = document.getElementById('btn-download-lightbox');
  if (lightbox && img) {
    img.src = url;
    if (downloadBtn) {
      downloadBtn.href = url;
      downloadBtn.download = fileName || 'image_' + Date.now();
    }
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
  if (tab !== 'salons' && tab !== 'all' && state.activeSalon && state.socket) {
    state.socket.emit('leave_active_chat', { partnerId: state.activeSalon.id });
    state.activeSalon = null;
  }
  if (tab !== 'contacts' && tab !== 'all' && state.activeContact && state.socket) {
    state.socket.emit('leave_active_chat', { partnerId: state.activeContact.id });
    state.activeContact = null;
  }
  if (tab !== 'support' && tab !== 'all' && state.activeSupportSession && state.socket) {
    state.socket.emit('leave_active_chat', { partnerId: 'admin_' + state.activeSupportSession });
    state.activeSupportSession = null;
  }

  const mentionsPopover = document.getElementById('mentions-popover');
  if (mentionsPopover) mentionsPopover.style.display = 'none';

  state.activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

  const allFeed = document.getElementById('all-list-container');
  const contactsFeed = document.getElementById('contacts-list-container');
  const salonsFeed = document.getElementById('salons-list-container');
  const supportFeed = document.getElementById('support-list-container');

  if (allFeed) allFeed.style.display = (tab === 'all') ? 'block' : 'none';
  if (contactsFeed) contactsFeed.style.display = (tab === 'contacts') ? 'block' : 'none';
  if (salonsFeed) salonsFeed.style.display = (tab === 'salons') ? 'block' : 'none';
  if (supportFeed) supportFeed.style.display = (tab === 'support') ? 'block' : 'none';

  const tabBtn = document.getElementById(`tab-btn-${tab}`);
  if (tabBtn) tabBtn.classList.add('active');

  renderCurrentActiveTabFeed();
  updateAllTabsBadges();
}

function renderCurrentActiveTabFeed() {
  if (state.activeTab === 'all') {
    renderAllConversationsList();
  } else if (state.activeTab === 'contacts') {
    renderContactsList();
  } else if (state.activeTab === 'salons') {
    renderSalonsList();
  } else if (state.activeTab === 'support') {
    renderSupportConversations();
  }
}

function updateAllTabsBadges() {
  const contactsUnread = Object.values(state.unreadCounts || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  const salonsUnread = Object.values(state.unreadSalonCounts || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  const supportUnread = (state.supportConversations || []).reduce((a, c) => a + (Number(c.unread_count) || 0), 0);
  const totalUnread = contactsUnread + salonsUnread + (state.user && state.user.role === 'admin' ? supportUnread : 0);

  const allBadge = document.getElementById('all-badge');
  const contactsBadge = document.getElementById('contacts-badge');
  const salonsBadge = document.getElementById('salons-badge');
  const supportBadge = document.getElementById('support-badge');

  if (allBadge) {
    allBadge.textContent = totalUnread > 99 ? '99+' : totalUnread;
    allBadge.style.display = totalUnread > 0 ? 'inline-block' : 'none';
  }
  if (contactsBadge) {
    contactsBadge.textContent = contactsUnread > 99 ? '99+' : contactsUnread;
    contactsBadge.style.display = contactsUnread > 0 ? 'inline-block' : 'none';
  }
  if (salonsBadge) {
    salonsBadge.textContent = salonsUnread > 99 ? '99+' : salonsUnread;
    salonsBadge.style.display = salonsUnread > 0 ? 'inline-block' : 'none';
  }
  if (supportBadge) {
    supportBadge.textContent = supportUnread > 99 ? '99+' : supportUnread;
    supportBadge.style.display = supportUnread > 0 ? 'inline-block' : 'none';
  }
}

async function loadSupportConversations() {
  try {
    const res = await fetch('/api/support/conversations');
    if (res.ok) {
      const data = await res.json();
      state.supportConversations = data.conversations || [];
      updateAllTabsBadges();
      if (state.activeTab === 'support') {
        renderSupportConversations();
      } else if (state.activeTab === 'all') {
        renderAllConversationsList();
      }
    }
  } catch (e) {
    console.error('[-] Error loading support conversations:', e);
  }
}

function renderSupportConversations() {
  const container = document.getElementById('support-list-container');
  if (!container || state.activeTab !== 'support') return;

  container.innerHTML = '';
  if (state.supportConversations.length === 0) {
    container.innerHTML = '<div style="padding: 2rem 1.5rem; font-size: 0.85rem; color: var(--text-dim); text-align: center;">Aucun ticket SOS pour le moment.</div>';
    return;
  }

  const query = (state.searchQuery || '').trim().toLowerCase();
  let supportToRender = [...state.supportConversations];
  if (query) {
    supportToRender = supportToRender.filter(conv => {
      const name = (conv.sender_name || conv.sender_id || '').toLowerCase();
      const lastInfo = getLastMessageInfo('support', conv.sender_id, conv);
      return name.includes(query) || (lastInfo.snippet || '').toLowerCase().includes(query);
    });
  }

  supportToRender.forEach(conv => {
    const studentDisplayName = (conv.sender_name && conv.sender_name.trim()) ? conv.sender_name : (conv.sender_id || 'Formateur / Étudiant');
    const initial = studentDisplayName.charAt(0).toUpperCase();
    const isActive = String(state.activeSupportSession) === String(conv.sender_id);
    const isOnline = isUserOnline(conv.sender_id);
    const unreadCount = conv.unread_count || 0;
    const lastInfo = getLastMessageInfo('support', conv.sender_id, conv);

    const item = document.createElement('div');
    item.className = `contact-card ${isActive ? 'active' : ''}`;
    item.dataset.userId = conv.sender_id;
    item.innerHTML = renderConversationCardHtml({
      type: 'support',
      id: conv.sender_id,
      title: studentDisplayName,
      avatarInitial: initial,
      isOnline,
      isActive,
      unreadCount,
      categoryTag: 'SOS',
      categoryClass: 'support',
      lastInfo
    });

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
  if (statusEl) {
    statusEl.style.display = 'none';
    statusEl.textContent = '';
  }
  const composer = document.getElementById('chat-input-area');
  if (composer) composer.style.display = 'block';

  loadSupportHistory(senderId);
  loadPinnedMessageForActiveChat();
};



async function loadSupportHistory(senderId, loadMore = false) {
  try {
    if (!state.supportPagination) {
      state.supportPagination = {};
    }
    const pag = state.supportPagination[senderId] || { hasMore: true, isLoading: false, oldestTimestamp: null };
    state.supportPagination[senderId] = pag;

    if (loadMore) {
      if (pag.isLoading || !pag.hasMore || !pag.oldestTimestamp) return;
      pag.isLoading = true;
      try {
        const res = await fetch(`/api/history/support?senderId=${senderId}&limit=50&before=${encodeURIComponent(pag.oldestTimestamp)}`);
        if (res.ok) {
          const data = await res.json();
          const olderMsgs = data.messages || [];
          if (olderMsgs.length < 50) pag.hasMore = false;
          if (olderMsgs.length > 0) {
            pag.oldestTimestamp = olderMsgs[0].timestamp;
            prependOlderMessagesToFeed(olderMsgs);
          }
        }
      } catch (e) {
        console.error('[-] Error loading older support messages:', e);
      } finally {
        pag.isLoading = false;
      }
      return;
    }

    pag.hasMore = true;
    pag.isLoading = false;

    if (state.socket) {
      state.socket.emit('support_mark_read', { senderId });
    }
    const res = await fetch(`/api/history/support?senderId=${senderId}&limit=50`);
    if (res.ok) {
      const data = await res.json();
      const feed = document.getElementById('messages-feed');
      feed.innerHTML = '';
      const msgs = data.messages || [];
      if (msgs.length > 0) {
        pag.oldestTimestamp = msgs[0].timestamp;
        if (msgs.length < 50) pag.hasMore = false;
      } else {
        pag.hasMore = false;
      }
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
  const modal = document.getElementById(id);
  if (modal) modal.style.display = 'flex';
}

function hideModals() {
  document.querySelectorAll('.modal-backdrop, .drawer-backdrop').forEach(m => m.style.display = 'none');
}

function hideModal(id) {
  if (!id) {
    hideModals();
    return;
  }
  const modal = document.getElementById(id);
  if (modal) modal.style.display = 'none';
}

window.openModal = showModal;
window.closeModal = hideModal;
window.closeDrawer = function(id) {
  const drawer = document.getElementById(id);
  if (drawer) drawer.style.display = 'none';
};

// Global backdrop click to close any modal or drawer
document.addEventListener('click', (e) => {
  if (e.target && (e.target.classList.contains('modal-backdrop') || e.target.classList.contains('drawer-backdrop'))) {
    e.target.style.display = 'none';
  }
});

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

// Helper to detect if the PWA is installed / running in standalone mode
function isPWAInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true ||
         document.referrer.includes('android-app://') ||
         localStorage.getItem('digicom_pwa_installed') === 'true';
}

function updatePWAInstallUI() {
  const installBtn = document.getElementById('btn-pwa-install');
  const floatingBanner = document.getElementById('pwa-floating-banner');
  const installed = isPWAInstalled();

  if (installBtn) {
    installBtn.style.display = installed ? 'none' : 'flex';
  }
  if (floatingBanner && installed) {
    floatingBanner.classList.remove('pwa-banner-visible');
    floatingBanner.style.display = 'none';
  }
}

// PWA Direct Install & Cross-Platform Installation Guide Handling
let deferredInstallPrompt = null;
let pwaBannerTimeoutId = null;

function showFloatingInstallBanner(autoHideMs = 7000) {
  if (isPWAInstalled()) return;
  const banner = document.getElementById('pwa-floating-banner');
  if (!banner) return;

  banner.style.display = 'flex';
  banner.classList.add('pwa-banner-visible');

  if (pwaBannerTimeoutId) {
    clearTimeout(pwaBannerTimeoutId);
  }
  if (autoHideMs > 0) {
    pwaBannerTimeoutId = setTimeout(() => {
      banner.classList.remove('pwa-banner-visible');
    }, autoHideMs);
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (!isPWAInstalled()) {
    updatePWAInstallUI();
    showFloatingInstallBanner(7000);
  }
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
      updatePWAInstallUI();
      showInAppToast({ title: 'Application installée !', body: 'DigiCom a été ajouté avec succès.', type: 'private' });
    }
    deferredInstallPrompt = null;
    return;
  }

  // 2. Check if already running as standalone PWA or installed
  if (isPWAInstalled()) {
    updatePWAInstallUI();
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

  updatePWAInstallUI();

  if (installBtn) {
    installBtn.addEventListener('click', handlePWAInstallAction);
  }

  if (floatingBanner) {
    floatingBanner.addEventListener('click', () => {
      handlePWAInstallAction();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', hideModals);
  }

  if (bannerBtn) {
    bannerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handlePWAInstallAction();
    });
  }

  // Floating banner appearance: show after 1.5s if not installed, auto-hide after 7s
  if (!isPWAInstalled()) {
    setTimeout(() => {
      showFloatingInstallBanner(7000);
    }, 1500);
  }
});

window.addEventListener('appinstalled', () => {
  localStorage.setItem('digicom_pwa_installed', 'true');
  updatePWAInstallUI();
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
      renderCurrentActiveTabFeed();
      updateAllTabsBadges();
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
      <div style="padding: 2rem 1.5rem; font-size: 0.85rem; color: var(--text-dim); text-align: center; line-height: 1.5;">
        Aucun Salon pour le moment.<br>
        Cliquez sur "Nouveau Salon" ci-dessus pour créer votre premier espace de travail confidentiel.
      </div>
    `;
    return;
  }

  const query = (state.searchQuery || '').trim().toLowerCase();
  let salonsToRender = [...state.salons];
  if (query) {
    salonsToRender = salonsToRender.filter(s => {
      const name = (s.name || '').toLowerCase();
      const lastInfo = getLastMessageInfo('salon', s.id, s);
      return name.includes(query) || (lastInfo.snippet || '').toLowerCase().includes(query);
    });
  }

  salonsToRender.sort((a, b) => {
    const infoA = getLastMessageInfo('salon', a.id, a);
    const infoB = getLastMessageInfo('salon', b.id, b);
    return (infoB.timestamp || 0) - (infoA.timestamp || 0);
  });

  salonsToRender.forEach(s => {
    const isActive = state.activeSalon && String(state.activeSalon.id) === String(s.id);
    const unreadCount = state.unreadSalonCounts[s.id] || 0;
    const isCreator = s.my_role === 'creator' || s.created_by === (state.user ? state.user.id : '');
    const displayName = formatSalonName(s.name);
    const lastInfo = getLastMessageInfo('salon', s.id, s);

    const card = document.createElement('div');
    card.className = `salon-card ${isActive ? 'active' : ''}`;
    card.innerHTML = renderConversationCardHtml({
      type: 'salon',
      id: s.id,
      title: displayName,
      avatarInitial: '#',
      isOnline: false,
      isActive,
      unreadCount,
      categoryTag: isCreator ? 'Admin' : '',
      categoryClass: 'salon',
      lastInfo
    });

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
  localStorage.removeItem('digicom_active_contact');
  localStorage.setItem('digicom_active_salon', salon.id);

  document.body.classList.add('mobile-chat-open');

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

  // Show composer and hide 1-on-1 call buttons (calls are 1-to-1)
  const composer = document.getElementById('chat-input-area');
  if (composer) composer.style.display = 'block';
  const callActions = document.getElementById('chat-header-call-actions');
  if (callActions) callActions.style.display = 'none';

  // Show poll button in composer
  const btnCreatePoll = document.getElementById('btn-create-poll');
  if (btnCreatePoll) btnCreatePoll.style.display = 'flex';

  // Show Salon items in 3-dots options menu
  ['menu-item-meeting', 'menu-item-files', 'menu-item-members', 'menu-item-salon-tasks', 'menu-item-salon-search', 'menu-item-salon-decisions', 'menu-item-salon-caisse'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'flex';
  });

  // Hide Direct 1-on-1 items
  ['menu-item-direct-contract', 'menu-item-direct-deadlines', 'menu-item-direct-privacy', 'menu-item-direct-payments', 'menu-item-direct-files'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Load universal pinned message banner
  loadPinnedMessageForActiveChat();

  // Clear feed container before loading
  const feed = document.getElementById('messages-feed');
  if (feed) feed.innerHTML = '';

  renderSalonsList();
  await loadSalonHistory(salon.id);

  // Check member role, broadcast mode & mentions cache
  let isSalonAdmin = (salon.created_by === (state.user ? state.user.id : '')) || (state.user && state.user.role === 'admin');
  try {
    const memRes = await authFetch(`/api/salons/${salon.id}/members`);
    if (memRes.ok) {
      const memData = await memRes.json();
      state.activeSalonMembers = memData.members || [];
      const me = state.activeSalonMembers.find(m => m.id === (state.user ? state.user.id : ''));
      if (me) {
        if (me.role === 'admin') isSalonAdmin = true;
        if (Boolean(me.is_blocked)) {
          updateSalonBlockedComposerState(true, formattedName);
        }
      }
    }
  } catch(e) {}

  // Mode Annonces Menu Item: Visible ONLY to Salon Admins
  const menuItemBroadcast = document.getElementById('menu-item-salon-broadcast');
  if (menuItemBroadcast) {
    menuItemBroadcast.style.display = isSalonAdmin ? 'flex' : 'none';
  }

  // Update Broadcast Mode Composer lock state
  updateSalonBroadcastComposerState(Boolean(salon.broadcast_only), isSalonAdmin);

  if (state.socket) {
    state.socket.emit('join_salon', salon.id);
  }
}

async function loadSalonHistory(salonId, loadMore = false) {
  const feed = document.getElementById('messages-feed');
  if (!feed) return;

  if (!state.salonPagination) {
    state.salonPagination = {};
  }
  const pag = state.salonPagination[salonId] || { hasMore: true, isLoading: false, oldestTimestamp: null };
  state.salonPagination[salonId] = pag;

  if (loadMore) {
    if (pag.isLoading || !pag.hasMore || !pag.oldestTimestamp) return;
    pag.isLoading = true;
    try {
      const res = await authFetch(`/api/salons/${salonId}/messages?limit=50&before=${encodeURIComponent(pag.oldestTimestamp)}`);
      if (res.ok) {
        const data = await res.json();
        const olderMsgs = data.messages || [];
        if (olderMsgs.length < 50) pag.hasMore = false;
        if (olderMsgs.length > 0) {
          pag.oldestTimestamp = olderMsgs[0].timestamp;
          state.salonMessages[salonId] = [...olderMsgs, ...(state.salonMessages[salonId] || [])];
          prependOlderMessagesToFeed(olderMsgs);
        }
      }
    } catch (e) {
      console.error('[-] Error loading older salon messages:', e);
    } finally {
      pag.isLoading = false;
    }
    return;
  }

  pag.hasMore = true;
  pag.isLoading = false;
  feed.innerHTML = '';

  try {
    const res = await authFetch(`/api/salons/${salonId}/messages?limit=50`);
    if (res.ok) {
      const data = await res.json();
      state.salonMessages[salonId] = data.messages || [];
      state.unreadSalonCounts[salonId] = 0;
      renderSalonsList();
      const messages = state.salonMessages[salonId];

      if (messages.length === 0) {
        pag.hasMore = false;
        feed.innerHTML = `
          <div style="padding: 2rem; text-align: center; color: var(--text-dim); font-size: 0.85rem;">
            Début du Salon Confidentiel <strong>${escapeHtml(formatSalonName(state.activeSalon ? state.activeSalon.name : ''))}</strong>.<br>
            Vos échanges dans ce Salon sont strictement privés et isolés.
          </div>
        `;
        return;
      }

      pag.oldestTimestamp = messages[0].timestamp;
      if (messages.length < 50) pag.hasMore = false;

      let lastDateKey = null;
      messages.forEach(msg => {
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

      const isCurrentUserCreator = salon && (
        String(salon.created_by) === String(state.user ? state.user.id : '') ||
        (state.user && state.user.role === 'superadmin')
      );
      const isCurrentUserAdmin = isCurrentUserCreator || (members && members.some(m => String(m.id) === String(state.user?.id) && (m.salon_role === 'admin' || m.salon_role === 'creator')));
      const isCreatorOrAdmin = isCurrentUserAdmin;

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

      if (btnSaveEdit) {
        btnSaveEdit.onclick = async () => {
          const newName = (editNameInput ? editNameInput.value.trim() : '');
          const newDesc = (editDescInput ? editDescInput.value.trim() : '');
          if (!newName) {
            alert('Le nom du Salon ne peut pas être vide.');
            return;
          }

          try {
            btnSaveEdit.disabled = true;
            const updateRes = await authFetch(`/api/salons/${salonId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: newName, description: newDesc })
            });

            if (updateRes.ok) {
              const updatedData = await updateRes.json();
              if (updatedData.salon && state.activeSalon && state.activeSalon.id === salonId) {
                state.activeSalon.name = updatedData.salon.name;
                state.activeSalon.description = updatedData.salon.description;
                renderChatHeader();
              }
              await loadSalons();
              if (editSection) editSection.style.display = 'none';
              await openSalonInfoModal(salonId);
            } else {
              const errData = await updateRes.json();
              alert(errData.error || 'Erreur lors de la modification du Salon.');
            }
          } catch (e) {
            alert('Erreur de connexion au serveur.');
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
              addMembersPicker.style.display = 'none';
              await openSalonInfoModal(salonId);
            } else {
              const errData = await addRes.json();
              alert(errData.error || 'Erreur lors de l\'ajout des participants.');
            }
          } catch (e) {
            alert('Erreur lors de l\'ajout des participants.');
          } finally {
            btnConfirmAdd.disabled = false;
          }
        };
      }

      // Delete Salon button (Creator only)
      if (deleteBtn) {
        deleteBtn.style.display = isCurrentUserCreator ? 'flex' : 'none';
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
            const isTargetCreator = m.salon_role === 'creator' || String(m.id) === String(salon.created_by);
            const isTargetAdmin = m.salon_role === 'admin';
            const isBlocked = Boolean(m.is_blocked === 1 || m.is_blocked === true);
            const isOnline = state.onlineUserIds.includes(m.id);
            const initial = (m.display_name || m.username || '?').charAt(0).toUpperCase();

            // Role Badge
            // Role Badge (Clean text only, zero emoji)
            let roleBadgeHtml = '';
            if (isTargetCreator) {
              roleBadgeHtml = `<span class="salon-role-badge creator">Créateur</span>`;
            } else if (isTargetAdmin) {
              roleBadgeHtml = `<span class="salon-role-badge coadmin">Admin</span>`;
            } else {
              roleBadgeHtml = `<span class="salon-role-badge member">Membre</span>`;
            }

            // Creator actions for other members (Nommer Admin, Rétrograder, Bloquer, Retirer)
            let actionsHtml = '';
            if (isCurrentUserCreator && !isTargetCreator && String(m.id) !== String(state.user ? state.user.id : '')) {
              actionsHtml = `
                <div class="salon-member-actions-row">
                  ${isTargetAdmin ? `
                    <button type="button" class="btn-member-icon-action demote-admin-btn" data-action="demote" data-user-id="${m.id}" data-name="${escapeHtml(m.display_name || m.username)}" title="Rétrograder au rang de Membre" aria-label="Rétrograder">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="12" x2="6" y2="12"></line>
                      </svg>
                    </button>
                  ` : `
                    <button type="button" class="btn-member-icon-action promote-admin-btn" data-action="promote" data-user-id="${m.id}" data-name="${escapeHtml(m.display_name || m.username)}" title="Nommer Administrateur délégué" aria-label="Nommer Admin">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                      </svg>
                    </button>
                  `}
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
                </div>
              `;
            }

            const isAlreadyContact = (state.contacts || []).some(c => String(c.id) === String(m.id));
            let addContactHtml = '';
            if (!isAlreadyContact && m.id !== (state.user ? state.user.id : '')) {
              addContactHtml = `
                <button type="button" class="btn-salon-add-contact" data-user-id="${m.id}" data-username="${escapeHtml(m.username)}" title="Ajouter à mes contacts directs">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                  Ajouter
                </button>
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
                    ${roleBadgeHtml}
                    ${(isBlocked && isCurrentUserCreator && !isTargetCreator) ? `<span class="salon-blocked-tag">Bloqué</span>` : ''}
                  </div>
                  <div style="font-size: 0.72rem; color: var(--text-dim);">@${escapeHtml(m.username)}</div>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 6px;">
                ${addContactHtml}
                ${actionsHtml}
              </div>
            `;

            // Attach promote / demote listeners
            const btnPromote = row.querySelector('[data-action="promote"]');
            if (btnPromote) {
              btnPromote.onclick = async () => {
                const targetName = btnPromote.getAttribute('data-name');
                const targetId = btnPromote.getAttribute('data-user-id');
                if (confirm(`Nommer "${targetName}" Administrateur délégué de ce salon ?\n\nIl aura accès aux Tâches, Décisions, Annonces et à la Caisse pour vous assister.`)) {
                  try {
                    const res = await authFetch(`/api/salons/${salonId}/members/${targetId}/role`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ role: 'admin' })
                    });
                    const data = await res.json();
                    if (data.error) {
                      if (typeof showToast === 'function') showToast(data.error);
                      else alert(data.error);
                    } else {
                      if (typeof showToast === 'function') showToast(`${targetName} est maintenant Administrateur délégué`);
                      await openSalonInfoModal(salonId);
                    }
                  } catch (e) {
                    alert('Erreur lors de la nomination de l\'administrateur.');
                  }
                }
              };
            }

            const btnDemote = row.querySelector('[data-action="demote"]');
            if (btnDemote) {
              btnDemote.onclick = async () => {
                const targetName = btnDemote.getAttribute('data-name');
                const targetId = btnDemote.getAttribute('data-user-id');
                if (confirm(`Rétrograder "${targetName}" au rang de simple participant ?`)) {
                  try {
                    const res = await authFetch(`/api/salons/${salonId}/members/${targetId}/role`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ role: 'member' })
                    });
                    const data = await res.json();
                    if (data.error) {
                      if (typeof showToast === 'function') showToast(data.error);
                      else alert(data.error);
                    } else {
                      if (typeof showToast === 'function') showToast(`${targetName} est redevenu simple membre`);
                      await openSalonInfoModal(salonId);
                    }
                  } catch (e) {
                    alert('Erreur lors de la rétrogradation.');
                  }
                }
              };
            }

            // Attach salon add contact listener
            const addBtn = row.querySelector('.btn-salon-add-contact');
            if (addBtn) {
              addBtn.onclick = async (ev) => {
                ev.stopPropagation();
                const uId = addBtn.getAttribute('data-user-id');
                try {
                  addBtn.disabled = true;
                  const reqRes = await authFetch('/api/contacts/request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetUserId: uId })
                  });
                  const reqData = await reqRes.json();
                  if (reqRes.ok) {
                    if (reqData.autoAccepted) {
                      await loadContacts();
                      addBtn.outerHTML = '<span class="exact-status-pill" style="color: #10b981;">Ami</span>';
                    } else {
                      addBtn.outerHTML = '<span class="exact-status-pill" style="color: #f59e0b;">Envoyé</span>';
                    }
                  } else {
                    alert(reqData.error || 'Erreur');
                    addBtn.disabled = false;
                  }
                } catch(e) {
                  addBtn.disabled = false;
                }
              };
            }

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

// ==========================================
// COLLABORATIVE SALON EXTENSIONS
// ==========================================

// 1. Salon Jitsi Meeting
window.joinJitsiSalonMeeting = async function(roomName) {
  if (typeof window.startJitsiCall === 'function') {
    window.startJitsiCall(roomName, 'video');
  } else {
    const incomingModal = document.getElementById('call-incoming-modal');
    const activeModal = document.getElementById('active-call-modal');
    const container = document.getElementById('jitsi-container');
    if (incomingModal) incomingModal.style.display = 'none';
    if (activeModal) activeModal.style.display = 'flex';
    if (container) {
      if (typeof JitsiMeetExternalAPI === 'undefined' && typeof window.loadJitsiScript === 'function') {
        container.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#94a3b8;font-size:0.95rem;gap:12px;"><div class="inline-spinner" style="width:28px;height:28px;border:3px solid rgba(16,185,129,0.2);border-top-color:#10b981;border-radius:50%;animation:spin 0.8s linear infinite;"></div><span>Connexion à la réunion...</span></div>';
        try {
          await window.loadJitsiScript();
        } catch (e) {
          alert('Module Jitsi Meet indisponible sur le serveur.');
          if (activeModal) activeModal.style.display = 'none';
          return;
        }
      }
      if (typeof JitsiMeetExternalAPI !== 'undefined') {
        container.innerHTML = '';
        const domain = 'meet.digiroys.com';
        const myDisplayName = (state.user) ? (state.user.display_name || state.user.username) : 'Membre DigiCom';
        const options = {
          roomName: roomName,
          width: '100%',
          height: '100%',
          parentNode: container,
          userInfo: { displayName: myDisplayName },
          configOverwrite: {
            prejoinPageEnabled: false,
            disableThirdPartyRequests: true,
            enableWelcomePage: false,
            enableClosePage: false
          },
          interfaceConfigOverwrite: {
            SHOW_JITSI_WATERMARK: false,
            MOBILE_APP_PROMO: false
          }
        };
        const api = new JitsiMeetExternalAPI(domain, options);
        api.addEventListener('videoConferenceLeft', () => {
          try { api.dispose(); } catch(e) {}
          if (activeModal) activeModal.style.display = 'none';
        });
      }
    }
  }
};

async function startSalonMeeting() {
  if (!state.activeSalon) return;
  const salonId = state.activeSalon.id;
  try {
    const res = await authFetch(`/api/salons/${salonId}/meeting/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.success && data.roomName) {
      window.joinJitsiSalonMeeting(data.roomName);
    }
  } catch (e) {
    console.error('[-] Error starting salon meeting:', e);
  }
}

// 2. Salon Files Drawer
async function openSalonFilesDrawer() {
  if (!state.activeSalon) return;
  const drawerOverlay = document.getElementById('salon-files-drawer-overlay');
  const filesList = document.getElementById('salon-files-list');
  if (drawerOverlay) drawerOverlay.style.display = 'flex';
  if (filesList) filesList.innerHTML = '<div class="drawer-empty-state">Chargement des fichiers...</div>';

  try {
    const res = await authFetch(`/api/salons/${state.activeSalon.id}/files`);
    if (res.ok) {
      const data = await res.json();
      window.currentSalonFiles = data.files || [];
      renderSalonFilesList('all');
    }
  } catch (e) {
    if (filesList) filesList.innerHTML = '<div class="drawer-empty-state">Erreur lors de la récupération des fichiers</div>';
  }
}

function closeSalonFilesDrawer() {
  const drawerOverlay = document.getElementById('salon-files-drawer-overlay');
  if (drawerOverlay) drawerOverlay.style.display = 'none';
}

function renderSalonFilesList(filterTab = 'all') {
  const filesList = document.getElementById('salon-files-list');
  if (!filesList) return;
  const files = window.currentSalonFiles || [];
  if (files.length === 0) {
    filesList.innerHTML = '<div class="drawer-empty-state">Aucun fichier partagé dans ce salon</div>';
    return;
  }

  const filtered = files.filter(f => {
    if (filterTab === 'all') return true;
    if (filterTab === 'image') return f.file_type && f.file_type.startsWith('image');
    if (filterTab === 'video') return f.file_type && f.file_type.startsWith('video');
    if (filterTab === 'audio') return f.file_type && f.file_type.startsWith('audio');
    if (filterTab === 'doc') return f.file_type && (f.file_type.includes('pdf') || f.file_type.includes('word') || f.file_type.includes('document') || f.file_type.includes('sheet') || f.file_type.includes('zip'));
    return true;
  });

  if (filtered.length === 0) {
    filesList.innerHTML = `<div class="drawer-empty-state">Aucun fichier dans la catégorie "${filterTab}"</div>`;
    return;
  }

  filesList.innerHTML = filtered.map(f => {
    const fname = f.file_name || f.content || 'Fichier';
    const fsize = f.file_size ? (Math.round(f.file_size / 1024) + ' Ko') : '';
    const dateStr = new Date(f.timestamp).toLocaleDateString('fr-FR');
    return `
      <div class="drawer-file-card">
        <div class="drawer-file-info">
          <div class="drawer-file-name" title="${escapeHtml(fname)}">${escapeHtml(fname)}</div>
          <div class="drawer-file-meta">${escapeHtml(f.sender_name)} • ${dateStr} ${fsize ? '• ' + fsize : ''}</div>
        </div>
        <a href="${escapeHtml(f.file_url)}" download="${escapeHtml(fname)}" target="_blank" rel="noopener" class="btn-lightbox-download" style="padding:6px 10px; font-size:0.75rem; border-radius:6px; background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.3); color:#10b981; text-decoration:none; display:inline-flex; align-items:center; gap:4px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Télécharger
        </a>
      </div>
    `;
  }).join('');
}

// 3. Mentions Autocomplete Popup
function handleMentionInput(e) {
  if (!state.activeSalon || state.activeTab !== 'salons') {
    hideMentionsPopover();
    return;
  }
  const input = e.target;
  const val = input.value;
  const cursorPos = input.selectionStart;
  const textBefore = val.slice(0, cursorPos);
  const match = textBefore.match(/@([a-zA-Z0-9_\-]*)$/);

  if (match) {
    const query = match[1].toLowerCase();
    const members = state.activeSalonMembers || [];
    const filtered = members.filter(m => {
      const uname = (m.username || '').toLowerCase();
      const dname = (m.display_name || '').toLowerCase();
      return uname.includes(query) || dname.includes(query);
    });

    if (filtered.length > 0) {
      showMentionsPopover(filtered, match.index, cursorPos);
    } else {
      hideMentionsPopover();
    }
  } else {
    hideMentionsPopover();
  }
}

function showMentionsPopover(members, matchIndex, cursorPos) {
  const popup = document.getElementById('mention-autocomplete-popup');
  const itemsContainer = document.getElementById('mention-list-items');
  if (!popup || !itemsContainer) return;

  itemsContainer.innerHTML = members.map((m, idx) => `
    <div class="mention-item ${idx === 0 ? 'selected' : ''}" data-username="${escapeHtml(m.display_name || m.username)}">
      <div class="mention-item-name">${escapeHtml(m.display_name || m.username)}</div>
      <div class="mention-item-user">@${escapeHtml(m.username)}</div>
    </div>
  `).join('');

  popup.style.display = 'block';

  itemsContainer.querySelectorAll('.mention-item').forEach(item => {
    item.addEventListener('click', () => {
      const username = item.dataset.username;
      insertMention(username);
      hideMentionsPopover();
    });
  });
}

function insertMention(username) {
  const input = document.getElementById('message-input');
  if (!input) return;
  const val = input.value;
  const cursorPos = input.selectionStart;
  const textBefore = val.slice(0, cursorPos);
  const textAfter = val.slice(cursorPos);
  const newBefore = textBefore.replace(/@([a-zA-Z0-9_\-]*)$/, `@${username} `);
  input.value = newBefore + textAfter;
  input.focus();
  input.setSelectionRange(newBefore.length, newBefore.length);
}

function hideMentionsPopover() {
  const popup = document.getElementById('mention-autocomplete-popup');
  if (popup) popup.style.display = 'none';
}

// 4. Polls Handling
async function loadAndRenderPollCard(pollId) {
  const container = document.getElementById(`poll-container-${pollId}`);
  if (!container) return;

  try {
    const res = await authFetch(`/api/polls/${pollId}`);
    if (res.ok) {
      const data = await res.json();
      if (data.poll) {
        renderPollCard(container, data.poll);
      }
    }
  } catch (e) {
    container.innerHTML = '<div style="font-size:0.8rem; color:rgba(255,255,255,0.5);">Impossible de charger le sondage</div>';
  }
}

function renderPollCard(container, poll) {
  if (!container || !poll) return;
  const currentUserId = state.user ? String(state.user.id || '') : '';
  const votes = poll.votes || [];
  const totalVotes = votes.length;

  const myVote = votes.find(v => String(v.user_id) === currentUserId);
  const myVotedOptionIndex = myVote ? parseInt(myVote.option_index, 10) : -1;

  const options = poll.options || [];
  const optionVotes = options.map((_, idx) => votes.filter(v => parseInt(v.option_index, 10) === idx).length);

  const optionsHtml = options.map((opt, idx) => {
    const voteCount = optionVotes[idx] || 0;
    const percent = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
    const isMyChoice = myVotedOptionIndex === idx;

    return `
      <div class="poll-option-row">
        <button type="button" class="poll-option-btn ${isMyChoice ? 'voted' : ''}" onclick="window.submitPollVote('${poll.id}', ${idx})">
          <span>${escapeHtml(opt)}</span>
          <span style="font-size:0.75rem; font-weight:700;">${percent}% (${voteCount})</span>
        </button>
        <div class="poll-bar-container">
          <div class="poll-bar-fill" style="width: ${percent}%;"></div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="poll-card">
      <div class="poll-question">${escapeHtml(poll.question)}</div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${optionsHtml}
      </div>
      <div class="poll-meta-text">${totalVotes} vote${totalVotes > 1 ? 's' : ''} au total</div>
    </div>
  `;
}

window.submitPollVote = async function(pollId, optionIndex) {
  try {
    const res = await authFetch(`/api/polls/${pollId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ optionIndex })
    });
    const data = await res.json();
    if (data.success && data.poll) {
      const container = document.getElementById(`poll-container-${pollId}`);
      if (container) renderPollCard(container, data.poll);
    }
  } catch (e) {
    console.error('[-] Error submitting poll vote:', e);
  }
};

// Global Window Exports for Collaborative Salon Helpers
window.startSalonMeeting = startSalonMeeting;
window.openSalonFilesDrawer = openSalonFilesDrawer;
window.closeSalonFilesDrawer = closeSalonFilesDrawer;
window.openCreatePollModal = function() {
  const modal = document.getElementById('modal-create-poll');
  if (modal) modal.style.display = 'flex';
};
window.closeCreatePollModal = function() {
  const modal = document.getElementById('modal-create-poll');
  if (modal) modal.style.display = 'none';
};
window.toggleChatMoreMenu = function(e) {
  if (e) e.stopPropagation();
  const dropdown = document.getElementById('chat-more-dropdown-menu');
  if (!dropdown) return;
  const isShown = dropdown.style.display === 'flex';
  dropdown.style.display = isShown ? 'none' : 'flex';
};
window.closeChatMoreMenu = function() {
  const dropdown = document.getElementById('chat-more-dropdown-menu');
  if (dropdown) dropdown.style.display = 'none';
};

document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('chat-more-dropdown-menu');
  const btn = document.getElementById('btn-chat-more-menu');
  if (dropdown && dropdown.style.display === 'flex') {
    if (btn && btn.contains(e.target)) return;
    if (!dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  }
});

// Bind Collaborative UI Buttons
const btnSalonMeeting = document.getElementById('btn-start-salon-meeting');
if (btnSalonMeeting) {
  btnSalonMeeting.onclick = startSalonMeeting;
  btnSalonMeeting.ontouchend = (e) => { e.preventDefault(); startSalonMeeting(); };
}

const btnSalonFiles = document.getElementById('btn-toggle-salon-files');
if (btnSalonFiles) {
  btnSalonFiles.onclick = openSalonFilesDrawer;
  btnSalonFiles.ontouchend = (e) => { e.preventDefault(); openSalonFilesDrawer(); };
}

const btnCloseSalonFiles = document.getElementById('btn-close-salon-files');
if (btnCloseSalonFiles) {
  btnCloseSalonFiles.onclick = closeSalonFilesDrawer;
  btnCloseSalonFiles.ontouchend = (e) => { e.preventDefault(); closeSalonFilesDrawer(); };
}

const drawerOverlay = document.getElementById('salon-files-drawer-overlay');
if (drawerOverlay) {
  drawerOverlay.addEventListener('click', (e) => {
    if (e.target === drawerOverlay) closeSalonFilesDrawer();
  });
}

document.querySelectorAll('.drawer-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.drawer-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    renderSalonFilesList(tab.dataset.tab);
  });
});

const msgInput = document.getElementById('message-input');
if (msgInput) {
  msgInput.addEventListener('input', handleMentionInput);
  msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideMentionsPopover();
  });
}

const btnCreatePoll = document.getElementById('btn-create-poll');
const modalCreatePoll = document.getElementById('modal-create-poll');
const btnClosePollModal = document.getElementById('btn-close-poll-modal');
const btnAddPollOption = document.getElementById('btn-add-poll-option');
const formCreatePoll = document.getElementById('form-create-poll');

if (btnCreatePoll) {
  btnCreatePoll.onclick = window.openCreatePollModal;
  btnCreatePoll.ontouchend = (e) => { e.preventDefault(); window.openCreatePollModal(); };
}

if (btnClosePollModal) {
  btnClosePollModal.onclick = window.closeCreatePollModal;
  btnClosePollModal.ontouchend = (e) => { e.preventDefault(); window.closeCreatePollModal(); };
}

if (btnAddPollOption) {
  btnAddPollOption.addEventListener('click', () => {
    const container = document.getElementById('poll-options-container');
    if (!container) return;
    const count = container.querySelectorAll('.poll-option-input').length + 1;
    if (count > 6) return alert('Maximum 6 options');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'poll-option-input';
    input.placeholder = `Option ${count}`;
    input.required = true;
    input.autocomplete = 'off';
    container.appendChild(input);
  });
}

if (formCreatePoll) {
  formCreatePoll.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.activeSalon) return;
    const questionInput = document.getElementById('poll-question-input');
    const optionInputs = document.querySelectorAll('.poll-option-input');
    const question = questionInput ? questionInput.value.trim() : '';
    const options = Array.from(optionInputs).map(i => i.value.trim()).filter(Boolean);

    if (!question || options.length < 2) {
      return alert('La question et au moins 2 options sont requises.');
    }

    try {
      const res = await authFetch(`/api/salons/${state.activeSalon.id}/polls/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, options })
      });
      const data = await res.json();
      if (data.success) {
        if (modalCreatePoll) modalCreatePoll.style.display = 'none';
        if (questionInput) questionInput.value = '';
        optionInputs.forEach((i, idx) => {
          if (idx < 2) i.value = '';
          else i.remove();
        });
      }
    } catch (err) {
      alert('Erreur lors de la création du sondage.');
    }
  });
}

// Universal Message Pinning Helpers (Discussions, Salons & Support SOS - Limit 3 Pinned Messages)
state.pinnedMessages = [];
state.pinnedCurrentIndex = 0;

window.pinCurrentChatMessage = async function(messageId, action = 'pin') {
  let channelType = 'private';
  let targetId = null;

  if (state.activeTab === 'salons' && state.activeSalon) {
    channelType = 'salon';
    targetId = state.activeSalon.id;
  } else if (state.activeTab === 'support') {
    channelType = 'support';
    targetId = state.activeSupportSession || (state.user ? state.user.id : null);
  } else if (state.activeContact) {
    channelType = 'private';
    targetId = state.activeContact.id;
  }

  if (!channelType || !targetId) return;

  try {
    const res = await authFetch('/api/chat/pin-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelType, targetId, messageId, action })
    });
    const data = await res.json();
    if (data.success) {
      updatePinnedMessageBanner(channelType, targetId, data.pinnedMessages);
      if (typeof showToast === 'function') {
        if (action === 'unpin') {
          showToast('Message dépinglé');
        } else {
          showToast('Message épinglé (max 3 par discussion)');
        }
      }
    }
  } catch (e) {
    console.error('[-] Error pinning message:', e);
  }
};

window.loadPinnedMessageForActiveChat = async function() {
  let channelType = 'private';
  let targetId = null;

  if (state.activeTab === 'salons' && state.activeSalon) {
    channelType = 'salon';
    targetId = state.activeSalon.id;
  } else if (state.activeTab === 'support') {
    channelType = 'support';
    targetId = state.activeSupportSession || (state.user ? state.user.id : null);
  } else if (state.activeContact) {
    channelType = 'private';
    targetId = state.activeContact.id;
  }

  const banner = document.getElementById('salon-pinned-banner');
  if (!banner || !channelType || !targetId) {
    if (banner) banner.style.display = 'none';
    return;
  }

  try {
    const res = await authFetch(`/api/chat/pinned-messages?channelType=${channelType}&targetId=${targetId}`);
    const data = await res.json();
    updatePinnedMessageBanner(channelType, targetId, data.pinnedMessages || []);
  } catch (e) {
    if (banner) banner.style.display = 'none';
  }
};

window.updatePinnedMessageBanner = function(channelType, targetId, pinnedMessages = []) {
  const banner = document.getElementById('salon-pinned-banner');
  const bannerText = document.getElementById('pinned-banner-text');
  const btnJump = document.getElementById('btn-jump-pinned');
  const btnUnpin = document.getElementById('btn-unpin-message');
  if (!banner) return;

  const msgs = Array.isArray(pinnedMessages) ? pinnedMessages : (pinnedMessages ? [pinnedMessages] : []);
  state.pinnedMessages = msgs;

  if (msgs.length === 0) {
    banner.style.display = 'none';
    state.pinnedCurrentIndex = 0;
    return;
  }

  banner.style.display = 'flex';

  if (state.pinnedCurrentIndex >= msgs.length) {
    state.pinnedCurrentIndex = 0;
  }

  const currentMsg = msgs[state.pinnedCurrentIndex];
  
  // Clean text preview
  let rawText = currentMsg.content || '';
  try {
    const parsed = JSON.parse(rawText);
    if (parsed.text) rawText = parsed.text;
    else if (parsed.fileName) rawText = `[Fichier] ${parsed.fileName}`;
    else if (parsed.type === 'voice') rawText = '[Note vocale]';
  } catch (e) {}

  if (rawText.length > 40) {
    rawText = rawText.substring(0, 40) + '...';
  }

  const countBadge = msgs.length > 1 ? ` (${state.pinnedCurrentIndex + 1}/${msgs.length})` : '';
  if (bannerText) {
    bannerText.textContent = `${currentMsg.sender_name || currentMsg.senderName || 'Message'}${countBadge} : ${rawText}`;
  }

  if (btnJump) {
    btnJump.textContent = msgs.length > 1 ? 'Suivant' : 'Voir';
    btnJump.onclick = (e) => {
      e.stopPropagation();
      const msgEl = document.getElementById(currentMsg.id);
      if (msgEl) {
        msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        msgEl.style.transition = 'background 0.3s ease';
        const origBg = msgEl.style.background;
        msgEl.style.background = 'rgba(0, 168, 132, 0.35)';
        setTimeout(() => { msgEl.style.background = origBg; }, 1800);
      } else {
        if (typeof showToast === 'function') showToast('Message épinglé disponible dans l\'historique');
      }

      // If multiple pinned messages, cycle index to next pinned message on click
      if (msgs.length > 1) {
        state.pinnedCurrentIndex = (state.pinnedCurrentIndex + 1) % msgs.length;
        window.updatePinnedMessageBanner(channelType, targetId, msgs);
      }
    };
  }

  if (btnUnpin) {
    btnUnpin.style.display = 'flex';
    btnUnpin.onclick = (e) => {
      e.stopPropagation();
      window.pinCurrentChatMessage(currentMsg.id, 'unpin');
    };
  }
};

/* ==========================================================================
   6 Collaborative Salon Modules (Tâches, Fils, Annonces, Recherche, Décisions, Caisse)
   ========================================================================== */

window.salonModulesState = {
  tasks: [],
  decisions: [],
  finances: null,
  activeThreadParentId: null,
  activeFilter: 'all'
};

function initSalonModulesBar() {
  const bar = document.getElementById('salon-modules-bar');
  if (!bar) return;

  const tabTasks = document.getElementById('tab-salon-tasks');
  if (tabTasks) {
    tabTasks.addEventListener('click', () => {
      if (state.activeSalon) openSalonTasksModal(state.activeSalon.id);
    });
  }

  const tabThreads = document.getElementById('tab-salon-threads');
  if (tabThreads) {
    tabThreads.addEventListener('click', () => {
      if (state.activeSalon) {
        if (typeof showToast === 'function') showToast('Cliquez sur "Discuter en fil" sous un message du salon.');
        else alert('Cliquez sur "Discuter en fil" sous un message du salon.');
      }
    });
  }

  const tabBroadcast = document.getElementById('tab-salon-broadcast');
  if (tabBroadcast) {
    tabBroadcast.addEventListener('click', () => {
      if (state.activeSalon) toggleSalonBroadcastMode(state.activeSalon.id);
    });
  }

  const tabSearch = document.getElementById('tab-salon-search');
  if (tabSearch) {
    tabSearch.addEventListener('click', () => {
      if (state.activeSalon) openSalonSearchModal(state.activeSalon.id);
    });
  }

  const tabDecisions = document.getElementById('tab-salon-decisions');
  if (tabDecisions) {
    tabDecisions.addEventListener('click', () => {
      if (state.activeSalon) openSalonDecisionsModal(state.activeSalon.id);
    });
  }

  const tabCaisse = document.getElementById('tab-salon-caisse');
  if (tabCaisse) {
    tabCaisse.addEventListener('click', () => {
      if (state.activeSalon) openSalonCaisseModal(state.activeSalon.id);
    });
  }
}

// 1. Tâches (Tasks & Kanban)
async function openSalonTasksModal(salonId) {
  if (typeof window.openModal === 'function') window.openModal('modal-salon-tasks');
  else {
    const m = document.getElementById('modal-salon-tasks');
    if (m) m.style.display = 'flex';
  }
  populateSalonMembersDropdown('task-select-assigned');
  try {
    const res = await authFetch(`/api/salons/${salonId}/tasks`);
    const data = await res.json();
    window.salonModulesState.tasks = data.tasks || [];
    renderKanbanBoard(window.salonModulesState.tasks);
  } catch (err) {
    console.error('[-] Error fetching salon tasks:', err);
  }
}

function renderKanbanBoard(tasks) {
  const todoList = document.getElementById('list-kanban-todo');
  const inProgressList = document.getElementById('list-kanban-in_progress');
  const doneList = document.getElementById('list-kanban-done');
  if (!todoList || !inProgressList || !doneList) return;

  const todo = tasks.filter(t => t.status === 'todo');
  const inProgress = tasks.filter(t => t.status === 'in_progress');
  const done = tasks.filter(t => t.status === 'done');

  document.getElementById('count-kanban-todo').textContent = todo.length;
  document.getElementById('count-kanban-in_progress').textContent = inProgress.length;
  document.getElementById('count-kanban-done').textContent = done.length;

  const renderCards = (items, currentStatus) => {
    if (items.length === 0) return '<div style="font-size:0.75rem; color:var(--text-muted); text-align:center; padding:1rem;">Aucune tâche</div>';
    return items.map(t => `
      <div class="kanban-card">
        <span class="kanban-card-title">${escapeHtml(t.title)}</span>
        ${t.description ? `<span style="font-size:0.78rem; color:var(--text-muted);">${escapeHtml(t.description)}</span>` : ''}
        <div class="kanban-card-meta">
          <span>${t.assigned_name ? `Assigné: ${escapeHtml(t.assigned_name)}` : 'Non assigné'}</span>
          ${t.due_date ? `<span>Échéance: ${new Date(t.due_date).toLocaleDateString()}</span>` : ''}
        </div>
        <div class="kanban-card-actions">
          ${currentStatus !== 'todo' ? `<button type="button" class="btn-kanban-move" onclick="moveSalonTask('${t.id}', 'todo')">À faire</button>` : ''}
          ${currentStatus !== 'in_progress' ? `<button type="button" class="btn-kanban-move" onclick="moveSalonTask('${t.id}', 'in_progress')">En cours</button>` : ''}
          ${currentStatus !== 'done' ? `<button type="button" class="btn-kanban-move" onclick="moveSalonTask('${t.id}', 'done')">Terminé</button>` : ''}
          <button type="button" class="btn-kanban-move" style="color:#f43f5e;" onclick="deleteSalonTask('${t.id}')">Supprimer</button>
        </div>
      </div>
    `).join('');
  };

  todoList.innerHTML = renderCards(todo, 'todo');
  inProgressList.innerHTML = renderCards(inProgress, 'in_progress');
  doneList.innerHTML = renderCards(done, 'done');
}

window.moveSalonTask = async function(taskId, newStatus) {
  if (!state.activeSalon) return;
  try {
    const res = await authFetch(`/api/salons/${state.activeSalon.id}/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();
    if (data.tasks) {
      window.salonModulesState.tasks = data.tasks;
      renderKanbanBoard(data.tasks);
    }
  } catch (err) {
    console.error('[-] Error moving task:', err);
  }
};

window.deleteSalonTask = async function(taskId) {
  if (!state.activeSalon) return;
  try {
    const res = await authFetch(`/api/salons/${state.activeSalon.id}/tasks/${taskId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.tasks) {
      window.salonModulesState.tasks = data.tasks;
      renderKanbanBoard(data.tasks);
    }
  } catch (err) {
    console.error('[-] Error deleting task:', err);
  }
};

// 2. Fils (Threads)
window.openSalonThreadDrawer = async function(messageId, parentText, senderName) {
  window.salonModulesState.activeThreadParentId = messageId;
  const drawer = document.getElementById('drawer-salon-threads');
  if (drawer) drawer.style.display = 'flex';
  
  const parentCard = document.getElementById('thread-parent-message');
  if (parentCard) {
    parentCard.innerHTML = `
      <div style="font-size:0.75rem; font-weight:700; color:var(--emerald-light); margin-bottom:2px;">${escapeHtml(senderName || 'Membre')}</div>
      <div style="font-size:0.85rem; color:var(--text-main);">${escapeHtml(parentText || 'Message')}</div>
    `;
  }
  
  try {
    const res = await authFetch(`/api/salons/${state.activeSalon.id}/threads/${messageId}`);
    const data = await res.json();
    renderThreadReplies(data.messages || []);
  } catch (err) {
    console.error('[-] Error loading thread messages:', err);
  }
};

function renderThreadReplies(messages) {
  const feed = document.getElementById('thread-replies-feed');
  if (!feed) return;
  if (messages.length === 0) {
    feed.innerHTML = '<div style="text-align:center; color:var(--text-muted); font-size:0.8rem; padding:2rem;">Aucune réponse dans ce fil pour le moment.</div>';
    return;
  }
  feed.innerHTML = messages.map(m => `
    <div class="thread-reply-card">
      <div style="display:flex; justify-content:space-between; font-size:0.74rem; margin-bottom:2px;">
        <span style="font-weight:700; color:var(--text-main);">${escapeHtml(m.sender_name)}</span>
        <span style="color:var(--text-muted);">${new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
      </div>
      <div style="font-size:0.84rem; color:var(--text-main);">${escapeHtml(m.content)}</div>
    </div>
  `).join('');
}

function updateSalonBroadcastComposerState(isBroadcastOnly, isUserAdmin) {
  const composer = document.getElementById('chat-input-area');
  const lockedBanner = document.getElementById('broadcast-locked-banner');

  if (isBroadcastOnly && !isUserAdmin) {
    if (composer) composer.style.display = 'none';
    if (lockedBanner) lockedBanner.style.display = 'flex';
  } else {
    if (lockedBanner) lockedBanner.style.display = 'none';
    if (composer && state.activeSalon) composer.style.display = 'block';
  }
}

// 3. Annonces (Broadcast Mode Toggle)
async function toggleSalonBroadcastMode(salonId) {
  if (!state.activeSalon) return;
  const currentBroadcast = Boolean(state.activeSalon.broadcast_only);
  const newBroadcast = !currentBroadcast;
  const confirmMsg = newBroadcast 
    ? 'Activer le mode Annonces ? Seuls les administrateurs pourront publier dans ce salon.'
    : 'Désactiver le mode Annonces ? Tous les membres pourront à nouveau publier.';
  
  if (!confirm(confirmMsg)) return;

  try {
    const res = await authFetch(`/api/salons/${salonId}/broadcast`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ broadcastOnly: newBroadcast })
    });
    const data = await res.json();
    if (data.error) {
      if (typeof showToast === 'function') showToast(data.error);
      else alert(data.error);
    } else {
      state.activeSalon.broadcast_only = data.broadcastOnly ? 1 : 0;
      const isSalonAdmin = (state.activeSalon.created_by === (state.user ? state.user.id : '')) || (state.user && state.user.role === 'admin');
      updateSalonBroadcastComposerState(Boolean(data.broadcastOnly), isSalonAdmin);
      if (typeof showToast === 'function') showToast(data.broadcastOnly ? 'Mode Annonces activé' : 'Mode Annonces désactivé');
    }
  } catch (err) {
    console.error('[-] Error toggling broadcast mode:', err);
  }
}

function isCurrentActiveSalonAdmin() {
  if (!state.user || !state.activeSalon) return false;

  // 1. Is user creator of the salon?
  if (state.activeSalon.created_by && String(state.activeSalon.created_by) === String(state.user.id)) {
    return true;
  }

  // 2. Is user global superadmin?
  if (state.user.role === 'superadmin') {
    return true;
  }

  // 3. Is user an admin in salon_members list?
  if (state.activeSalonMembers && Array.isArray(state.activeSalonMembers)) {
    const me = state.activeSalonMembers.find(m => String(m.id) === String(state.user.id));
    if (me && (me.role === 'admin' || me.salon_role === 'admin' || me.role === 'creator')) {
      return true;
    }
  }

  return false;
}

function populateDecisionMembersPicker() {
  const container = document.getElementById('decision-members-chips');
  if (!container) return;

  if (!state.activeSalonMembers || state.activeSalonMembers.length === 0) {
    container.innerHTML = '<span style="color:var(--text-muted); font-size:0.75rem;">Aucun membre dans le salon</span>';
    return;
  }

  container.innerHTML = state.activeSalonMembers.map(m => {
    const name = escapeHtml(m.display_name || m.username);
    return `
      <div class="member-select-chip" data-user-id="${m.id}" onclick="this.classList.toggle('selected')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="chip-check-icon">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>${name}</span>
      </div>
    `;
  }).join('');
}

// 5. Décisions (Decision Log)
async function openSalonDecisionsModal(salonId) {
  if (typeof window.openModal === 'function') window.openModal('modal-salon-decisions');
  else {
    const m = document.getElementById('modal-salon-decisions');
    if (m) m.style.display = 'flex';
  }

  // Hide form by default immediately
  const decisionForm = document.getElementById('form-create-salon-decision');
  if (decisionForm) decisionForm.style.display = 'none';

  // Ensure active salon members are loaded
  try {
    if (!state.activeSalonMembers || state.activeSalonMembers.length === 0) {
      const memRes = await authFetch(`/api/salons/${salonId}/members`);
      if (memRes.ok) {
        const memData = await memRes.json();
        state.activeSalonMembers = memData.members || [];
      }
    }
  } catch(e) {}

  populateDecisionMembersPicker();
  const monthFilter = document.getElementById('decision-filter-month');
  const yearFilter = document.getElementById('decision-filter-year');
  if (monthFilter) monthFilter.value = '';
  if (yearFilter) yearFilter.value = '';

  // Check admin status strictly
  const isUserAdmin = isCurrentActiveSalonAdmin();
  if (decisionForm) {
    if (isUserAdmin) {
      decisionForm.classList.add('active-admin-form');
      decisionForm.style.display = 'flex';
    } else {
      decisionForm.classList.remove('active-admin-form');
      decisionForm.style.display = 'none';
    }
  }

  try {
    const res = await authFetch(`/api/salons/${salonId}/decisions`);
    const data = await res.json();
    window.salonModulesState.decisions = data.decisions || [];
    renderDecisions(window.salonModulesState.decisions);
  } catch (err) {
    console.error('[-] Error fetching decisions:', err);
  }
}

function applyDecisionFilters() {
  const month = document.getElementById('decision-filter-month')?.value || '';
  const year = document.getElementById('decision-filter-year')?.value || '';
  const allDecisions = window.salonModulesState.decisions || [];

  let filtered = allDecisions.filter(d => {
    if (!d.created_at) return true;
    const dateObj = new Date(d.created_at);
    if (isNaN(dateObj.getTime())) return true;
    
    if (year && String(dateObj.getFullYear()) !== String(year)) return false;
    if (month) {
      const mStr = String(dateObj.getMonth() + 1).padStart(2, '0');
      if (mStr !== month) return false;
    }
    return true;
  });

  renderDecisions(filtered);
}

async function deleteSalonDecision(decisionId) {
  if (!state.activeSalon) return;
  if (!confirm('Voulez-vous vraiment supprimer cette décision du registre ?')) return;

  try {
    const res = await authFetch(`/api/salons/${state.activeSalon.id}/decisions/${decisionId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.decisions) {
      window.salonModulesState.decisions = data.decisions;
      applyDecisionFilters();
      if (typeof showToast === 'function') showToast('Décision supprimée du registre');
    }
  } catch (err) {
    console.error('[-] Error deleting decision:', err);
  }
}

function renderDecisions(decisions) {
  const container = document.getElementById('list-salon-decisions');
  if (!container) return;
  if (!Array.isArray(decisions) || decisions.length === 0) {
    container.innerHTML = '<div style="text-align:center; color:var(--text-muted); font-size:0.8rem; padding:2rem;">Aucune décision actée pour ce filtre.</div>';
    return;
  }

  const isUserAdmin = isCurrentActiveSalonAdmin();

  container.innerHTML = decisions.map(d => `
    <div class="decision-card">
      <div class="decision-header">
        <span class="decision-title">${escapeHtml(d.title)}</span>
        <span class="decision-badge-verified">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          Décision Validée
        </span>
      </div>
      ${d.description ? `<div class="decision-desc">${escapeHtml(d.description)}</div>` : ''}
      <div class="decision-meta">
        <span>${d.responsible_name ? `Responsable: ${escapeHtml(d.responsible_name)}` : 'Équipe entière'}</span>
        <span>Acté le ${new Date(d.created_at).toLocaleDateString()}</span>
      </div>
      ${isUserAdmin ? `
        <div style="margin-top: 0.4rem; text-align: right;">
          <button type="button" class="btn-delete-decision" onclick="deleteSalonDecision('${d.id}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            <span>Supprimer</span>
          </button>
        </div>
      ` : ''}
    </div>
  `).join('');
}

// 6. Caisse (Finances & Mobile Money Ledger)
async function openSalonCaisseModal(salonId) {
  if (typeof window.openModal === 'function') window.openModal('modal-salon-caisse');
  else {
    const m = document.getElementById('modal-salon-caisse');
    if (m) m.style.display = 'flex';
  }

  // Hide form and target edit box by default immediately
  const txForm = document.getElementById('form-create-salon-transaction');
  const btnEditTarget = document.getElementById('btn-edit-caisse-target');
  const targetEditBox = document.getElementById('caisse-target-edit-box');
  if (txForm) {
    txForm.classList.remove('active-admin-form');
    txForm.style.display = 'none';
  }
  if (btnEditTarget) btnEditTarget.style.display = 'none';
  if (targetEditBox) targetEditBox.style.display = 'none';

  // Ensure active salon members are loaded
  try {
    if (!state.activeSalonMembers || state.activeSalonMembers.length === 0) {
      const memRes = await authFetch(`/api/salons/${salonId}/members`);
      if (memRes.ok) {
        const memData = await memRes.json();
        state.activeSalonMembers = memData.members || [];
      }
    }
  } catch(e) {}

  populateSalonMembersDropdown('tx-select-member');

  // Check admin status strictly
  const isUserAdmin = isCurrentActiveSalonAdmin();
  if (txForm) {
    if (isUserAdmin) {
      txForm.classList.add('active-admin-form');
      txForm.style.display = 'flex';
    } else {
      txForm.classList.remove('active-admin-form');
      txForm.style.display = 'none';
    }
  }
  if (btnEditTarget) {
    btnEditTarget.style.display = isUserAdmin ? 'inline-flex' : 'none';
  }

  try {
    const res = await authFetch(`/api/salons/${salonId}/finances`);
    const data = await res.json();
    window.salonModulesState.finances = data.finances;
    renderCaisse(data.finances);
  } catch (err) {
    console.error('[-] Error fetching finances:', err);
  }
}

function renderCaisse(finances) {
  if (!finances) return;
  const balance = finances.balance || 0;
  const contributions = finances.total_contributions || 0;
  const expenses = finances.total_expenses || 0;
  const target = finances.target_amount || 0;
  const isUserAdmin = isCurrentActiveSalonAdmin();

  document.getElementById('caisse-stat-balance').textContent = balance.toLocaleString() + ' FCFA';
  document.getElementById('caisse-stat-contributions').textContent = contributions.toLocaleString() + ' FCFA';
  document.getElementById('caisse-stat-expenses').textContent = expenses.toLocaleString() + ' FCFA';

  const targetEl = document.getElementById('caisse-stat-target');
  const pctEl = document.getElementById('caisse-progress-pct');
  const fill = document.getElementById('caisse-progress-fill');

  if (target > 0) {
    const pct = Math.min(Math.round((contributions / target) * 100), 100);
    if (targetEl) targetEl.textContent = target.toLocaleString() + ' FCFA';
    if (pctEl) pctEl.textContent = `${pct}% (${contributions.toLocaleString()} / ${target.toLocaleString()} FCFA)`;
    if (fill) fill.style.width = `${pct}%`;
  } else {
    if (targetEl) targetEl.textContent = 'Non défini';
    if (pctEl) pctEl.textContent = '0% (Aucun objectif fixé)';
    if (fill) fill.style.width = '0%';
  }

  const list = document.getElementById('list-salon-transactions');
  if (!list) return;
  const txs = finances.transactions || [];
  if (txs.length === 0) {
    list.innerHTML = '<div style="text-align:center; color:var(--text-muted); font-size:0.8rem; padding:1.5rem;">Aucune transaction enregistrée.</div>';
    return;
  }

  list.innerHTML = txs.map(t => {
    const isPlus = t.type === 'contribution';
    const catClass = 'badge-' + (t.category || 'autre').toLowerCase();
    const deleteBtnHtml = isUserAdmin ? `
      <button type="button" class="btn-delete-decision" onclick="deleteSalonTransaction('${t.id}')" title="Supprimer cette transaction">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    ` : '';

    return `
      <div class="caisse-tx-item">
        <div style="display:flex; align-items:center; gap:0.6rem;">
          <span class="tx-badge ${catClass}">${escapeHtml(t.category)}</span>
          <div style="display:flex; flex-direction:column;">
            <span style="font-size:0.82rem; font-weight:600; color:var(--text-main);">${escapeHtml(t.member_name || 'Membre')}</span>
            <span style="font-size:0.72rem; color:var(--text-muted);">${escapeHtml(t.note || (isPlus ? 'Cotisation' : 'Dépense'))} • ${new Date(t.created_at).toLocaleDateString()}</span>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:0.65rem;">
          <span class="${isPlus ? 'tx-amount-plus' : 'tx-amount-minus'}">${isPlus ? '+' : '-'}${Number(t.amount).toLocaleString()} FCFA</span>
          ${deleteBtnHtml}
        </div>
      </div>
    `;
  }).join('');
}

async function deleteSalonTransaction(txId) {
  if (!state.activeSalon) return;
  if (!confirm('Voulez-vous vraiment supprimer cette transaction ?')) return;

  try {
    const res = await authFetch(`/api/salons/${state.activeSalon.id}/finances/transactions/${txId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.finances) {
      window.salonModulesState.finances = data.finances;
      renderCaisse(data.finances);
      if (typeof showToast === 'function') showToast('Transaction supprimée');
    }
  } catch (err) {
    console.error('[-] Error deleting transaction:', err);
  }
}


// 4. Recherche & Filtres
function openSalonSearchModal(salonId) {
  if (typeof window.openModal === 'function') window.openModal('modal-salon-search');
  else {
    const m = document.getElementById('modal-salon-search');
    if (m) m.style.display = 'flex';
  }
  const input = document.getElementById('salon-search-keyword');
  if (input) {
    input.value = '';
    input.focus();
  }
  window.salonModulesState.activeFilter = 'all';
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  const firstChip = document.querySelector('.filter-chip[data-filter="all"]');
  if (firstChip) firstChip.classList.add('active');
  renderSearchResults('', 'all');
}

function renderSearchResults(query, filterType) {
  const container = document.getElementById('list-salon-search-results');
  if (!container || !state.activeSalon) return;

  const msgs = state.salonMessages[state.activeSalon.id] || [];
  let filtered = msgs.filter(m => {
    let parsed = m.content;
    if (typeof parsed === 'string') {
      const trimmed = parsed.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try { parsed = JSON.parse(trimmed); } catch (e) {}
      }
    }

    const cleanText = getCleanMessageDisplayText(m.content);
    if (!cleanText) return false;

    if (query && !cleanText.toLowerCase().includes(query.toLowerCase())) return false;
    
    if (filterType === 'all') return true;
    
    if (typeof parsed === 'object' && parsed !== null) {
      const type = parsed.type || 'text';
      if (filterType === 'image' && type === 'image') return true;
      if (filterType === 'video' && type === 'video') return true;
      if (filterType === 'audio' && type === 'audio') return true;
      if (filterType === 'file' && (type === 'file' || type === 'pdf')) return true;
      if (filterType === 'text' && (type === 'text' || (!type && parsed.text))) return true;
      return false;
    }
    return filterType === 'text';
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div style="text-align:center; color:var(--text-muted); font-size:0.8rem; padding:2rem;">Aucun résultat correspondant.</div>';
    return;
  }

  container.innerHTML = filtered.slice(0, 50).map(m => {
    const cleanText = getCleanMessageDisplayText(m.content);
    const dateStr = new Date(m.timestamp || m.created_at).toLocaleDateString();
    return `
      <div class="search-result-card" onclick="if(typeof closeModal==='function')closeModal('modal-salon-search'); scrollToMessage('${m.id}');">
        <div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-bottom:3px;">
          <span style="font-weight:700; color:var(--emerald-light);">${escapeHtml(m.sender_name || 'Membre')}</span>
          <span style="color:var(--text-muted);">${dateStr}</span>
        </div>
        <div style="font-size:0.84rem; color:var(--text-main); line-height:1.4;">${escapeHtml(cleanText)}</div>
      </div>
    `;
  }).join('');
}

function populateSalonMembersDropdown(selectId) {
  const select = document.getElementById(selectId);
  if (!select || !state.activeSalonMembers) return;
  const currentVal = select.value;
  select.innerHTML = '<option value="">Sélectionner un membre...</option>' + 
    state.activeSalonMembers.map(m => `<option value="${m.id}">${escapeHtml(m.display_name || m.username)}</option>`).join('');
  if (currentVal) select.value = currentVal;
}

function initSalonForms() {
  const formTask = document.getElementById('form-create-salon-task');
  if (formTask) {
    formTask.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.activeSalon) return;
      const title = document.getElementById('task-input-title').value;
      const assignedTo = document.getElementById('task-select-assigned').value;
      const dueDate = document.getElementById('task-input-due').value;

      try {
        const res = await authFetch(`/api/salons/${state.activeSalon.id}/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, assignedTo, dueDate })
        });
        const data = await res.json();
        if (data.tasks) {
          window.salonModulesState.tasks = data.tasks;
          renderKanbanBoard(data.tasks);
          document.getElementById('task-input-title').value = '';
          const dueInput = document.getElementById('task-input-due');
          if (dueInput) {
            dueInput.value = '';
            dueInput.removeAttribute('value');
            dueInput.classList.remove('has-value');
          }
        }
      } catch (err) {
        console.error('[-] Error creating task:', err);
      }
    });
  }

  const taskDueInput = document.getElementById('task-input-due');
  if (taskDueInput) {
    taskDueInput.addEventListener('change', () => {
      if (taskDueInput.value) {
        taskDueInput.setAttribute('value', taskDueInput.value);
      } else {
        taskDueInput.removeAttribute('value');
      }
    });
  }

  const formThread = document.getElementById('form-send-thread-reply');
  if (formThread) {
    formThread.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.activeSalon || !window.salonModulesState.activeThreadParentId) return;
      const input = document.getElementById('input-thread-reply');
      const content = input.value;
      if (!content.trim()) return;

      try {
        const res = await authFetch(`/api/salons/${state.activeSalon.id}/threads/${window.salonModulesState.activeThreadParentId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content })
        });
        const data = await res.json();
        if (data.messages) {
          renderThreadReplies(data.messages);
          input.value = '';
        }
      } catch (err) {
        console.error('[-] Error sending thread reply:', err);
      }
    });
  }

  const formDecision = document.getElementById('form-create-salon-decision');
  if (formDecision) {
    formDecision.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.activeSalon) return;
      const title = document.getElementById('decision-input-title').value;
      const description = document.getElementById('decision-input-desc').value;

      const selectedChips = document.querySelectorAll('#decision-members-chips .member-select-chip.selected');
      const responsibleId = Array.from(selectedChips).map(c => c.getAttribute('data-user-id')).join(',');

      try {
        const res = await authFetch(`/api/salons/${state.activeSalon.id}/decisions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, description, responsibleId })
        });
        const data = await res.json();
        if (data.error) {
          if (typeof showToast === 'function') showToast(data.error);
          else alert(data.error);
          return;
        }
        if (data.decisions) {
          window.salonModulesState.decisions = data.decisions;
          applyDecisionFilters();
          document.getElementById('decision-input-title').value = '';
          const descEl = document.getElementById('decision-input-desc');
          if (descEl) {
            descEl.value = '';
            descEl.style.height = 'auto';
          }
          document.querySelectorAll('#decision-members-chips .member-select-chip.selected').forEach(c => c.classList.remove('selected'));
          if (typeof showToast === 'function') showToast('Décision enregistrée avec succès');
        }
      } catch (err) {
        console.error('[-] Error creating decision:', err);
      }
    });
  }

  const filterMonth = document.getElementById('decision-filter-month');
  if (filterMonth) filterMonth.addEventListener('change', () => applyDecisionFilters());

  const filterYear = document.getElementById('decision-filter-year');
  if (filterYear) filterYear.addEventListener('change', () => applyDecisionFilters());

  // Caisse Target Edit Listeners
  const btnEditCaisse = document.getElementById('btn-edit-caisse-target');
  if (btnEditCaisse) {
    btnEditCaisse.addEventListener('click', () => {
      const box = document.getElementById('caisse-target-edit-box');
      if (!box) return;
      const isOpening = box.style.display === 'none';
      box.style.display = isOpening ? 'flex' : 'none';
      if (isOpening) {
        const input = document.getElementById('caisse-input-target-amount');
        if (input) {
          input.value = (window.salonModulesState.finances?.target_amount) || '';
          input.focus();
        }
      }
    });
  }

  const btnCancelCaisse = document.getElementById('btn-cancel-caisse-target');
  if (btnCancelCaisse) {
    btnCancelCaisse.addEventListener('click', () => {
      const box = document.getElementById('caisse-target-edit-box');
      if (box) box.style.display = 'none';
    });
  }

  const btnSaveCaisse = document.getElementById('btn-save-caisse-target');
  if (btnSaveCaisse) {
    btnSaveCaisse.addEventListener('click', async () => {
      if (!state.activeSalon) return;
      const input = document.getElementById('caisse-input-target-amount');
      const targetAmount = parseFloat(input?.value) || 0;

      try {
        const res = await authFetch(`/api/salons/${state.activeSalon.id}/finances/target`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetAmount })
        });
        const data = await res.json();
        if (data.error) {
          if (typeof showToast === 'function') showToast(data.error);
          else alert(data.error);
          return;
        }
        if (data.finances) {
          window.salonModulesState.finances = data.finances;
          renderCaisse(data.finances);
          const box = document.getElementById('caisse-target-edit-box');
          if (box) box.style.display = 'none';
          if (typeof showToast === 'function') showToast('Objectif financier mis à jour');
        }
      } catch (err) {
        console.error('[-] Error saving caisse target:', err);
      }
    });
  }

  const formTx = document.getElementById('form-create-salon-transaction');
  if (formTx) {
    formTx.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.activeSalon) return;
      const type = document.getElementById('tx-select-type').value;
      const amount = document.getElementById('tx-input-amount').value;
      const category = document.getElementById('tx-select-category').value;
      const memberSelect = document.getElementById('tx-select-member');
      const memberId = memberSelect ? memberSelect.value : '';
      const memberName = memberSelect && memberSelect.selectedOptions[0] && memberSelect.value ? memberSelect.selectedOptions[0].text : '';
      const note = document.getElementById('tx-input-note').value;

      try {
        const res = await authFetch(`/api/salons/${state.activeSalon.id}/finances/transactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, amount, category, memberId, memberName, note })
        });
        const data = await res.json();
        if (data.error) {
          if (typeof showToast === 'function') showToast(data.error);
          else alert(data.error);
          return;
        }
        if (data.finances) {
          window.salonModulesState.finances = data.finances;
          renderCaisse(data.finances);
          document.getElementById('tx-input-amount').value = '';
          document.getElementById('tx-input-note').value = '';
          if (memberSelect) memberSelect.value = '';
          if (typeof showToast === 'function') showToast('Transaction enregistrée avec succès');
        }
      } catch (err) {
        console.error('[-] Error creating transaction:', err);
      }
    });
  }

  const searchInput = document.getElementById('salon-search-keyword');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      renderSearchResults(e.target.value, window.salonModulesState.activeFilter);
    });
  }

  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active');
      window.salonModulesState.activeFilter = e.target.getAttribute('data-filter') || 'all';
      const query = document.getElementById('salon-search-keyword')?.value || '';
      renderSearchResults(query, window.salonModulesState.activeFilter);
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initSalonModulesBar();
  initSalonForms();
  initDirectForms();
});

window.openSalonTasksModal = openSalonTasksModal;
window.toggleSalonBroadcastMode = toggleSalonBroadcastMode;
window.openSalonSearchModal = openSalonSearchModal;
window.openSalonDecisionsModal = openSalonDecisionsModal;
window.openSalonCaisseModal = openSalonCaisseModal;
window.openSalonFilesDrawer = openSalonFilesDrawer;
window.openSalonInfoModal = openSalonInfoModal;
window.startSalonMeeting = startSalonMeeting;

// ==================== DIRECT 1-ON-1 COLLABORATIVE MODULES ====================

window.directModulesState = {
  contracts: [],
  deadlines: [],
  pins: [],
  payments: [],
  files: [],
  activeFilesFilter: 'all',
  filesSearchQuery: '',
  privacyShieldActive: false
};

// 1. Micro-Contrat
async function openDirectContractModal() {
  if (!state.activeContact) return;
  const modal = document.getElementById('modal-direct-contract');
  if (modal) modal.style.display = 'flex';

  try {
    const res = await authFetch(`/api/direct/contracts?contactId=${state.activeContact.id}`);
    if (res.ok) {
      const data = await res.json();
      window.directModulesState.contracts = data.contracts || [];
      renderDirectContracts(window.directModulesState.contracts);
    }
  } catch (err) {
    console.error('[-] Error fetching direct contracts:', err);
  }
}

function renderDirectContracts(contracts) {
  const container = document.getElementById('list-direct-contracts');
  if (!container) return;

  if (!contracts || contracts.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: #64748b; padding: 2rem 1rem; font-size: 0.85rem;">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 0.5rem; opacity: 0.5;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
        <p>Aucun micro-contrat actif avec ce contact.<br>Proposez un accord clair ci-dessus pour sceller vos engagements.</p>
      </div>
    `;
    return;
  }

  const myId = state.user ? state.user.id : '';
  container.innerHTML = contracts.map(c => {
    const isCreator = (c.created_by === myId);
    const amountStr = `${Number(c.amount || 0).toLocaleString('fr-FR')} ${escapeHtml(c.currency || 'FCFA')}`;
    const deadlineStr = c.deadline ? new Date(c.deadline).toLocaleDateString('fr-FR') : 'Non spécifiée';

    let badgeClass = 'badge-pending';
    let statusText = 'En attente';
    if (c.status === 'accepted') { badgeClass = 'badge-accepted'; statusText = 'Accepté & Scellé'; }
    else if (c.status === 'adjustment_requested') { badgeClass = 'badge-adjustment'; statusText = 'Ajustement demandé'; }
    else if (c.status === 'completed') { badgeClass = 'badge-completed'; statusText = 'Terminé'; }
    else if (c.status === 'cancelled') { badgeClass = 'badge-cancelled'; statusText = 'Annulé / Rejeté'; }

    let actionsHtml = '';
    if (['pending', 'adjustment_requested'].includes(c.status)) {
      if (!isCreator) {
        actionsHtml = `
          <div class="direct-contract-actions">
            <button type="button" class="btn-contract-action btn-contract-accept" onclick="window.handleContractAction('${c.id}', 'accept')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span>Accepter &amp; Sceller</span>
            </button>
            <button type="button" class="btn-contract-action btn-contract-adjust" onclick="window.handleContractAction('${c.id}', 'adjust')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              <span>Ajuster</span>
            </button>
            <button type="button" class="btn-contract-action btn-contract-reject" onclick="window.handleContractAction('${c.id}', 'reject')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              <span>Rejeter</span>
            </button>
          </div>
        `;
      } else {
        actionsHtml = `
          <div class="direct-contract-actions">
            <button type="button" class="btn-contract-action btn-contract-reject" onclick="window.handleContractAction('${c.id}', 'cancel')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              <span>Annuler la proposition</span>
            </button>
          </div>
        `;
      }
    } else if (c.status === 'accepted') {
      actionsHtml = `
        <div class="direct-contract-actions">
          <button type="button" class="btn-contract-action btn-contract-complete" onclick="window.handleContractAction('${c.id}', 'complete')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            <span>Marquer comme Terminé</span>
          </button>
          <button type="button" class="btn-contract-action btn-contract-reject" onclick="window.handleContractAction('${c.id}', 'cancel')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            <span>Annuler l'engagement</span>
          </button>
        </div>
      `;
    }

    return `
      <div class="direct-contract-card status-${c.status}">
        <div class="direct-contract-header">
          <span class="direct-contract-title">${escapeHtml(c.title)}</span>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="direct-contract-amount-badge">${amountStr}</span>
            <button type="button" class="btn-delete-deadline" onclick="window.deleteDirectContract('${c.id}')" title="Supprimer ce contrat">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>
        ${c.description ? `<div class="direct-contract-desc">${escapeHtml(c.description)}</div>` : ''}
        <div class="direct-contract-meta">
          <span>Date limite : <strong>${deadlineStr}</strong></span>
          <span class="direct-contract-badge ${badgeClass}">${statusText}</span>
        </div>
        ${actionsHtml}
      </div>
    `;
  }).join('');
}

async function deleteDirectContract(id) {
  if (!confirm('Voulez-vous supprimer définitivement ce micro-contrat ?')) return;
  if (!state.activeContact) return;
  try {
    const res = await authFetch(`/api/direct/contracts/${id}?contactId=${state.activeContact.id}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      const data = await res.json();
      window.directModulesState.contracts = data.contracts || [];
      renderDirectContracts(window.directModulesState.contracts);
      if (typeof showToast === 'function') showToast('Micro-contrat supprimé');
    }
  } catch (err) {
    console.error('[-] Error deleting contract:', err);
  }
}

async function handleContractAction(contractId, action) {
  if (!state.activeContact) return;
  let note = '';
  if (action === 'adjust') {
    note = prompt('Précisez les modifications souhaitées (ex: ajuster le tarif ou décaler la date) :');
    if (note === null) return;
  } else if (action === 'reject') {
    if (!confirm('Êtes-vous certain de vouloir rejeter cette proposition de micro-contrat ?')) return;
  } else if (action === 'cancel') {
    if (!confirm('Êtes-vous certain de vouloir annuler ce micro-contrat ?')) return;
  }

  try {
    const res = await authFetch(`/api/direct/contracts/${contractId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, note, contactId: state.activeContact.id })
    });
    if (res.ok) {
      const data = await res.json();
      window.directModulesState.contracts = data.contracts || [];
      renderDirectContracts(window.directModulesState.contracts);
      if (data.actionRecord && state.activeContact) {
        state.directMessages[state.activeContact.id] = state.directMessages[state.activeContact.id] || [];
        state.directMessages[state.activeContact.id].push(data.actionRecord);
        appendMessageToFeed(data.actionRecord, false, true);
      }
      if (typeof showToast === 'function') {
        if (action === 'accept') showToast('Micro-Contrat accepté & scellé avec succès !');
        else if (action === 'reject') showToast('Proposition de micro-contrat rejetée');
        else if (action === 'complete') showToast('Micro-Contrat marqué comme terminé');
        else if (action === 'cancel') showToast('Micro-Contrat annulé');
        else showToast('Statut du micro-contrat mis à jour');
      }
    }
  } catch (err) {
    console.error('[-] Error updating contract action:', err);
  }
}

// 2. Échéances & Agenda
async function openDirectDeadlinesModal() {
  if (!state.activeContact) return;
  const modal = document.getElementById('modal-direct-deadlines');
  if (modal) modal.style.display = 'flex';

  try {
    const res = await authFetch(`/api/direct/deadlines?contactId=${state.activeContact.id}`);
    if (res.ok) {
      const data = await res.json();
      window.directModulesState.deadlines = data.deadlines || [];
      renderDirectDeadlines(window.directModulesState.deadlines);
    }
  } catch (err) {
    console.error('[-] Error fetching direct deadlines:', err);
  }
}

function renderDirectDeadlines(deadlines) {
  const container = document.getElementById('list-direct-deadlines');
  if (!container) return;

  if (!deadlines || deadlines.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: #64748b; padding: 2rem 1rem; font-size: 0.85rem;">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 0.5rem; opacity: 0.5;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
        <p>Aucune échéance planifiée.<br>Ajoutez une date clé pour déclencher des rappels Push mutuels.</p>
      </div>
    `;
    return;
  }

  const typeLabels = {
    deadline: 'Livrable',
    meeting: 'Visio',
    call: 'Appel',
    payment: 'Paiement',
    encounter: 'Rencontre'
  };

  container.innerHTML = deadlines.map(d => {
    const isDone = (d.status === 'completed');
    const dateObj = new Date(d.due_date);
    const dateStr = !isNaN(dateObj.getTime()) ? `${dateObj.toLocaleDateString('fr-FR')} à ${dateObj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : d.due_date;
    const typeLbl = typeLabels[d.type] || 'Échéance';

    return `
      <div class="direct-deadline-card ${isDone ? 'completed' : ''}">
        <input type="checkbox" ${isDone ? 'checked' : ''} onchange="window.toggleDirectDeadline('${d.id}')" style="cursor: pointer; width: 18px; height: 18px; accent-color: #10b981; border: none !important;">
        <div class="direct-deadline-info">
          <span class="direct-deadline-title">${escapeHtml(d.title)}</span>
          <div class="direct-deadline-meta">
            <span class="deadline-type-badge type-${d.type}">${typeLbl}</span>
            <span>${dateStr}</span>
          </div>
        </div>
        <button type="button" class="btn-delete-deadline" onclick="window.deleteDirectDeadline('${d.id}')" title="Supprimer">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    `;
  }).join('');
}

async function toggleDirectDeadline(id) {
  if (!state.activeContact) return;
  try {
    const res = await authFetch(`/api/direct/deadlines/${id}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: state.activeContact.id })
    });
    if (res.ok) {
      const dl = window.directModulesState.deadlines.find(x => x.id === id);
      if (dl) dl.status = (dl.status === 'completed' ? 'pending' : 'completed');
      renderDirectDeadlines(window.directModulesState.deadlines);
    }
  } catch (err) {
    console.error('[-] Error toggling deadline:', err);
  }
}

async function deleteDirectDeadline(id) {
  if (!state.activeContact) return;
  try {
    const res = await authFetch(`/api/direct/deadlines/${id}?contactId=${state.activeContact.id}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      window.directModulesState.deadlines = window.directModulesState.deadlines.filter(x => x.id !== id);
      renderDirectDeadlines(window.directModulesState.deadlines);
      if (typeof showToast === 'function') showToast('Échéance supprimée');
    }
  } catch (err) {
    console.error('[-] Error deleting deadline:', err);
  }
}

// 3. Épingles & Masquage (Privacy Shield)
async function openDirectPrivacyModal() {
  if (!state.activeContact) return;
  const modal = document.getElementById('modal-direct-privacy');
  if (modal) modal.style.display = 'flex';

  const toggle = document.getElementById('toggle-privacy-blur');
  if (toggle) toggle.checked = window.directModulesState.privacyShieldActive;

  try {
    const res = await authFetch(`/api/direct/pins?contactId=${state.activeContact.id}`);
    if (res.ok) {
      const data = await res.json();
      window.directModulesState.pins = data.pins || [];
      renderDirectPins(window.directModulesState.pins);
    }
  } catch (err) {
    console.error('[-] Error fetching direct pins:', err);
  }
}

function togglePrivacyShield(isActive) {
  window.directModulesState.privacyShieldActive = Boolean(isActive);
  document.body.classList.toggle('privacy-blur-active', window.directModulesState.privacyShieldActive);
  if (typeof showToast === 'function') {
    showToast(window.directModulesState.privacyShieldActive ? 'Bouclier activé : données sensibles floutées' : 'Bouclier désactivé');
  }
}

function renderDirectPins(pins) {
  const container = document.getElementById('list-direct-pins');
  if (!container) return;

  if (!pins || pins.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: #64748b; padding: 1.5rem 1rem; font-size: 0.82rem;">
        <p>Aucune note confidentielle épinglée pour ce contact.<br>Enregistrez un RIB, une adresse ou un tarif ci-dessus.</p>
      </div>
    `;
    return;
  }

  const categoryLabels = {
    iban: 'RIB / IBAN',
    address: 'Adresse',
    tariff: 'Tarif',
    note: 'Note',
    password: 'Code / MDP'
  };

  container.innerHTML = pins.map(p => `
    <div class="direct-pin-card">
      <div class="direct-pin-header">
        <span class="direct-pin-title">${escapeHtml(p.title)}</span>
        <span class="direct-pin-category">${categoryLabels[p.category] || 'Mémo'}</span>
      </div>
      <div class="direct-pin-content">${escapeHtml(p.content)}</div>
      <div class="direct-pin-actions">
        <button type="button" class="btn-pin-action" onclick="window.insertPinToComposer('${escapeHtml(p.content).replace(/'/g, "\\'")}')" title="Insérer dans la zone de saisie">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
          <span>Insérer</span>
        </button>
        <button type="button" class="btn-pin-action" onclick="navigator.clipboard.writeText('${escapeHtml(p.content).replace(/'/g, "\\'")}'); if(typeof showToast === 'function') showToast('Copié dans le presse-papiers');">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          <span>Copier</span>
        </button>
        <button type="button" class="btn-pin-action delete" onclick="window.deleteDirectPin('${p.id}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          <span>Supprimer</span>
        </button>
      </div>
    </div>
  `).join('');
}

window.insertPinToComposer = function(content) {
  const input = document.getElementById('message-input');
  if (input) {
    input.value = (input.value ? input.value + '\n' : '') + content;
    input.focus();
    if (window.closeModal) window.closeModal('modal-direct-privacy');
    if (typeof showToast === 'function') showToast('Mémo inséré dans le message');
  }
};

async function deleteDirectPin(id) {
  try {
    const res = await authFetch(`/api/direct/pins/${id}`, { method: 'DELETE' });
    if (res.ok) {
      window.directModulesState.pins = window.directModulesState.pins.filter(x => x.id !== id);
      renderDirectPins(window.directModulesState.pins);
      if (typeof showToast === 'function') showToast('Épingle supprimée');
    }
  } catch (err) {
    console.error('[-] Error deleting pin:', err);
  }
}

// 4. Règlements & Quittances
async function openDirectPaymentsModal() {
  if (!state.activeContact) return;
  const modal = document.getElementById('modal-direct-payments');
  if (modal) modal.style.display = 'flex';

  try {
    const [payRes, ctrRes] = await Promise.all([
      authFetch(`/api/direct/payments?contactId=${state.activeContact.id}`),
      authFetch(`/api/direct/contracts?contactId=${state.activeContact.id}`)
    ]);

    if (payRes.ok) {
      const data = await payRes.json();
      window.directModulesState.payments = data.payments || [];
    }
    if (ctrRes.ok) {
      const ctrData = await ctrRes.json();
      window.directModulesState.contracts = ctrData.contracts || [];
    }

    renderDirectPayments(window.directModulesState.payments, window.directModulesState.contracts);
  } catch (err) {
    console.error('[-] Error fetching direct payments:', err);
  }
}

function renderDirectPayments(payments, contracts) {
  const container = document.getElementById('list-direct-payments');
  if (!container) return;

  // Compute financial stats
  let totalConcluded = 0;
  if (contracts && contracts.length > 0) {
    contracts.filter(c => c.status === 'accepted' || c.status === 'completed').forEach(c => {
      totalConcluded += Number(c.amount || 0);
    });
  }

  let totalPaid = 0;
  if (payments && payments.length > 0) {
    payments.filter(p => p.status === 'confirmed').forEach(p => {
      totalPaid += Number(p.amount || 0);
    });
  }

  const remaining = Math.max(0, totalConcluded - totalPaid);
  const pct = totalConcluded > 0 ? Math.min(100, Math.round((totalPaid / totalConcluded) * 100)) : (totalPaid > 0 ? 100 : 0);

  const elConcluded = document.getElementById('direct-stat-concluded');
  const elPaid = document.getElementById('direct-stat-paid');
  const elRem = document.getElementById('direct-stat-remaining');
  const elPct = document.getElementById('direct-progress-pct');
  const elFill = document.getElementById('direct-progress-fill');

  if (elConcluded) elConcluded.textContent = `${totalConcluded.toLocaleString('fr-FR')} FCFA`;
  if (elPaid) elPaid.textContent = `${totalPaid.toLocaleString('fr-FR')} FCFA`;
  if (elRem) elRem.textContent = `${remaining.toLocaleString('fr-FR')} FCFA`;
  if (elPct) elPct.textContent = `${pct}%`;
  if (elFill) elFill.style.width = `${pct}%`;

  if (!payments || payments.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: #64748b; padding: 1.5rem 1rem; font-size: 0.82rem;">
        <p>Aucun versement enregistré.<br>Déclarez un acompte ou solde ci-dessus pour le consigner.</p>
      </div>
    `;
    return;
  }

  const myId = state.user ? state.user.id : '';
  container.innerHTML = payments.map(p => {
    const isPayer = (p.paid_by === myId);
    const dateObj = new Date(p.created_at);
    const dateStr = !isNaN(dateObj.getTime()) ? dateObj.toLocaleDateString('fr-FR') : p.created_at;
    const isConfirmed = (p.status === 'confirmed');

    return `
      <div class="direct-payment-card">
        <div class="direct-payment-header">
          <span class="direct-payment-amount">+ ${Number(p.amount).toLocaleString('fr-FR')} ${escapeHtml(p.currency || 'FCFA')}</span>
          <span class="direct-contract-badge ${isConfirmed ? 'badge-accepted' : 'badge-pending'}">${isConfirmed ? 'Confirmé' : 'Déclaré'}</span>
        </div>
        <div class="direct-contract-desc">
          <strong>${escapeHtml(p.payment_method || 'Mobile Money')}</strong> ${p.reference ? `• Réf: ${escapeHtml(p.reference)}` : ''}
          ${p.note ? `<br>${escapeHtml(p.note)}` : ''}
        </div>
        <div class="direct-payment-meta">
          <span>${isPayer ? 'Versé par vous' : 'Versé par votre contact'} le ${dateStr}</span>
          ${(!isConfirmed && !isPayer) ? `
            <button type="button" class="btn-contract-action btn-contract-accept" style="padding: 2px 8px; font-size: 0.7rem;" onclick="window.confirmDirectPayment('${p.id}')">
              <span>Confirmer réception</span>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

async function confirmDirectPayment(id) {
  if (!state.activeContact) return;
  try {
    const res = await authFetch(`/api/direct/payments/${id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: state.activeContact.id })
    });
    if (res.ok) {
      const data = await res.json();
      window.directModulesState.payments = data.payments || [];
      renderDirectPayments(window.directModulesState.payments, window.directModulesState.contracts);
      if (typeof showToast === 'function') showToast('Réception du paiement confirmée');
    }
  } catch (err) {
    console.error('[-] Error confirming payment:', err);
  }
}

// 5. Coffre-fort Documents & Médias
async function openDirectFilesModal() {
  if (!state.activeContact) return;
  const modal = document.getElementById('modal-direct-files');
  if (modal) modal.style.display = 'flex';

  try {
    const res = await authFetch(`/api/direct/files?contactId=${state.activeContact.id}`);
    if (res.ok) {
      const data = await res.json();
      window.directModulesState.files = data.files || [];
      renderDirectFiles();
    }
  } catch (err) {
    console.error('[-] Error fetching direct files:', err);
  }
}

function setDirectFilesCategory(category, buttonEl) {
  window.directModulesState.activeFilesFilter = category;
  document.querySelectorAll('[data-direct-filter]').forEach(b => b.classList.remove('active'));
  if (buttonEl) buttonEl.classList.add('active');
  renderDirectFiles();
}

function filterDirectFilesList(query) {
  window.directModulesState.filesSearchQuery = (query || '').toLowerCase().trim();
  renderDirectFiles();
}

function formatFileSizeHuman(bytes) {
  if (!bytes || isNaN(bytes)) return '';
  const num = Number(bytes);
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} Ko`;
  return `${(num / (1024 * 1024)).toFixed(1)} Mo`;
}

function renderDirectFiles() {
  const container = document.getElementById('list-direct-files');
  if (!container) return;

  const files = window.directModulesState.files || [];
  const filter = window.directModulesState.activeFilesFilter || 'all';
  const query = window.directModulesState.filesSearchQuery || '';

  const filtered = files.filter(f => {
    const url = String(f.media_url || f.file_url || '');
    const mType = f.media_type || f.file_type || 'file';

    // Type filter
    if (filter === 'doc' && !['file', 'pdf', 'document', 'doc'].includes(mType) && !url.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|zip|rar|csv)$/i)) return false;
    if (filter === 'media' && !['image', 'video'].includes(mType) && !url.match(/\.(jpg|jpeg|png|webp|gif|svg|mp4|webm|mov)$/i)) return false;
    if (filter === 'audio' && !['audio', 'voice'].includes(mType) && !url.match(/\.(mp3|wav|ogg|m4a|weba)$/i)) return false;

    // Search query filter
    if (query) {
      const name = (f.file_name || f.text || url).toLowerCase();
      if (!name.includes(query)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; color: #64748b; padding: 2.5rem 1rem; font-size: 0.85rem;">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 0.75rem; opacity: 0.5;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
        <p>Aucun document ou média trouvé pour ce filtre.<br>Les photos, fichiers et audios partagés apparaîtront ici automatiquement.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(f => {
    const url = f.media_url || f.file_url || '';
    const isImg = (f.media_type === 'image') || url.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i);
    const isVideo = (f.media_type === 'video') || url.match(/\.(mp4|webm|mov)$/i);
    const isAudio = ['audio', 'voice'].includes(f.media_type) || url.match(/\.(mp3|wav|ogg|m4a|weba)$/i);
    const isPdf = url.match(/\.pdf$/i) || f.file_type === 'pdf';
    const dateObj = new Date(f.timestamp || f.created_at);
    const dateStr = !isNaN(dateObj.getTime()) ? dateObj.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '';
    const displayName = f.file_name || f.text || (url ? url.split('/').pop() : 'Fichier');
    const sizeStr = f.file_size ? ` • ${formatFileSizeHuman(f.file_size)}` : '';

    return `
      <a href="${escapeHtml(url)}" target="_blank" download class="direct-file-card">
        ${isImg ? `
          <img src="${escapeHtml(url)}" alt="" class="direct-file-preview-img" loading="lazy">
        ` : `
          <div class="direct-file-icon-box ${isPdf ? 'pdf-box' : (isVideo ? 'video-box' : (isAudio ? 'audio-box' : ''))}">
            ${isAudio ? `
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
            ` : isVideo ? `
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>
            ` : isPdf ? `
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #f43f5e;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
            ` : `
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
            `}
          </div>
        `}
        <span class="direct-file-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
        <span class="direct-file-date">${dateStr}${sizeStr}</span>
      </a>
    `;
  }).join('');
}

// Initialise Direct Form Submissions
function initDirectForms() {
  const formContract = document.getElementById('form-create-direct-contract');
  if (formContract) {
    formContract.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.activeContact) return;

      const title = document.getElementById('contract-input-title')?.value || '';
      const amount = document.getElementById('contract-input-amount')?.value || '0';
      const currency = document.getElementById('contract-select-currency')?.value || 'FCFA';
      const deadline = document.getElementById('contract-input-deadline')?.value || '';
      const desc = document.getElementById('contract-input-desc')?.value || '';

      try {
        const res = await authFetch('/api/direct/contracts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contactId: state.activeContact.id,
            title,
            amount,
            currency,
            deadline,
            description: desc
          })
        });
        if (res.ok) {
          const data = await res.json();
          window.directModulesState.contracts = data.contracts || [];
          renderDirectContracts(window.directModulesState.contracts);
          formContract.reset();
          if (window.closeModal) window.closeModal('modal-direct-contract');
          if (typeof showToast === 'function') showToast('Micro-Contrat proposé avec succès');
          if (data.contractRecord && state.activeContact) {
            state.directMessages[state.activeContact.id] = state.directMessages[state.activeContact.id] || [];
            state.directMessages[state.activeContact.id].push(data.contractRecord);
            appendMessageToFeed(data.contractRecord, false, true);
          }
        }
      } catch (err) {
        console.error('[-] Error creating contract:', err);
      }
    });
  }

  const formDeadline = document.getElementById('form-create-direct-deadline');
  if (formDeadline) {
    formDeadline.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.activeContact) return;

      const title = document.getElementById('deadline-input-title')?.value || '';
      const type = document.getElementById('deadline-select-type')?.value || 'deadline';
      const dueDate = document.getElementById('deadline-input-date')?.value || '';
      const desc = document.getElementById('deadline-input-desc')?.value || '';

      try {
        const res = await authFetch('/api/direct/deadlines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contactId: state.activeContact.id,
            title,
            type,
            dueDate,
            description: desc
          })
        });
        if (res.ok) {
          const data = await res.json();
          window.directModulesState.deadlines = data.deadlines || [];
          renderDirectDeadlines(window.directModulesState.deadlines);
          formDeadline.reset();
          if (window.closeModal) window.closeModal('modal-direct-deadlines');
          if (typeof showToast === 'function') showToast('Échéance planifiée avec rappel Push');
        }
      } catch (err) {
        console.error('[-] Error creating deadline:', err);
      }
    });
  }

  const formPin = document.getElementById('form-create-direct-pin');
  if (formPin) {
    formPin.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.activeContact) return;

      const category = document.getElementById('pin-select-category')?.value || 'note';
      const title = document.getElementById('pin-input-title')?.value || '';
      const content = document.getElementById('pin-input-content')?.value || '';

      try {
        const res = await authFetch('/api/direct/pins', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contactId: state.activeContact.id,
            category,
            title,
            content
          })
        });
        if (res.ok) {
          const data = await res.json();
          window.directModulesState.pins = data.pins || [];
          renderDirectPins(window.directModulesState.pins);
          formPin.reset();
          if (typeof showToast === 'function') showToast('Épingle privée enregistrée');
        }
      } catch (err) {
        console.error('[-] Error creating pin:', err);
      }
    });
  }

  const formPayment = document.getElementById('form-create-direct-payment');
  if (formPayment) {
    formPayment.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.activeContact) return;

      const amount = document.getElementById('payment-input-amount')?.value || '';
      const currency = document.getElementById('payment-select-currency')?.value || 'FCFA';
      const method = document.getElementById('payment-select-method')?.value || 'Mobile Money';
      const reference = document.getElementById('payment-input-reference')?.value || '';
      const note = document.getElementById('payment-input-note')?.value || '';

      try {
        const res = await authFetch('/api/direct/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contactId: state.activeContact.id,
            amount,
            currency,
            paymentMethod: method,
            reference,
            note
          })
        });
        if (res.ok) {
          const data = await res.json();
          window.directModulesState.payments = data.payments || [];
          renderDirectPayments(window.directModulesState.payments, window.directModulesState.contracts);
          formPayment.reset();
          if (window.closeModal) window.closeModal('modal-direct-payments');
          if (typeof showToast === 'function') showToast('Versement déclaré avec succès');
        }
      } catch (err) {
        console.error('[-] Error creating payment:', err);
      }
    });
  }
}

window.openDirectContractModal = openDirectContractModal;
window.handleContractAction = handleContractAction;
window.deleteDirectContract = deleteDirectContract;
window.openDirectDeadlinesModal = openDirectDeadlinesModal;
window.toggleDirectDeadline = toggleDirectDeadline;
window.deleteDirectDeadline = deleteDirectDeadline;
window.openDirectPrivacyModal = openDirectPrivacyModal;
window.togglePrivacyShield = togglePrivacyShield;
window.deleteDirectPin = deleteDirectPin;
window.openDirectPaymentsModal = openDirectPaymentsModal;
window.confirmDirectPayment = confirmDirectPayment;
window.openDirectFilesModal = openDirectFilesModal;
window.setDirectFilesCategory = setDirectFilesCategory;
window.filterDirectFilesList = filterDirectFilesList;



