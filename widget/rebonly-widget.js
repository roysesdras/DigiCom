/**
 * RebOnly SOS Support Floating Widget (Upgraded v2.0)
 * Standalone embeddable script with elastic textarea, voice notes, file attachments & read receipts.
 */

(function () {
  function getPersistentGuestId() {
    try {
      let id = localStorage.getItem('rebonly_guest_id');
      if (!id) {
        id = 'student_' + Math.random().toString(36).substring(2, 8);
        localStorage.setItem('rebonly_guest_id', id);
      }
      return id;
    } catch (e) {
      return 'student_' + Math.random().toString(36).substring(2, 8);
    }
  }

  const defaultTrainerId = getPersistentGuestId();
  let defaultTitle = (document.title || 'Support Client').replace(/Campus/gi, 'Academy');

  const isSelf = typeof window !== 'undefined' && (window.location.hostname === 'chat.digiroys.com' || window.location.hostname === 'localhost');
  const defaultServerUrl = isSelf ? window.location.origin : 'https://chat.digiroys.com';

  const config = Object.assign(
    {
      serverUrl: defaultServerUrl,
      trainerName: 'Visiteur',
      trainerId: defaultTrainerId,
      courseTitle: defaultTitle,
      primaryColor: '#6366f1',
      sosColor: '#f43f5e',
      position: 'bottom-right' // 'bottom-right' | 'bottom-left'
    },
    window.RebOnlyConfig || window.DigiComWidgetConfig || {}
  );

  if (config.courseTitle && typeof config.courseTitle === 'string') {
    config.courseTitle = config.courseTitle.replace(/Campus/gi, 'Academy');
  }

  let socket = null;
  let isOpen = false;
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingTimer = null;
  let recordingSeconds = 0;

  // Generate styles
  const styles = `
    #rebonly-widget-root * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    #rebonly-floating-btn {
      position: fixed;
      bottom: 20px;
      ${config.position === 'bottom-left' ? 'left: 20px;' : 'right: 20px;'}
      width: 60px;
      height: 60px;
      background: transparent !important;
      border: none !important;
      outline: none !important;
      box-shadow: none !important;
      border-radius: 0 !important;
      padding: 0 !important;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer !important;
      z-index: 99999999 !important;
      pointer-events: auto !important;
      transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
      -webkit-appearance: none;
      appearance: none;
    }
    #rebonly-floating-btn img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
      filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.35));
      transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.2s ease;
      pointer-events: none;
      user-select: none;
    }
    #rebonly-floating-btn:hover img {
      transform: scale(1.1);
      filter: drop-shadow(0 6px 16px rgba(0, 0, 0, 0.5));
    }
    #rebonly-floating-btn:active img {
      transform: scale(0.94);
    }

    #rebonly-floating-badge {
      position: absolute;
      top: -2px;
      right: -2px;
      background: #f43f5e;
      color: #ffffff;
      font-size: 10px;
      font-weight: 700;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: none;
      align-items: center;
      justify-content: center;
      border: 2px solid #0f172a;
      box-shadow: 0 0 8px rgba(244, 63, 94, 0.7);
      z-index: 999999999 !important;
      animation: rebonlyBadgePop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    @keyframes rebonlyBadgePop {
      0% { transform: scale(0); }
      100% { transform: scale(1); }
    }

    .rebonly-pulse img {
      animation: rebonlyPulseImg 1.6s infinite ease-in-out !important;
    }
    @keyframes rebonlyPulseImg {
      0% { transform: scale(1); filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.35)); }
      50% { transform: scale(1.12); filter: drop-shadow(0 0 14px rgba(16, 185, 129, 0.6)); }
      100% { transform: scale(1); filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.35)); }
    }

    #rebonly-toast-tooltip {
      position: fixed;
      bottom: 80px;
      ${config.position === 'bottom-left' ? 'left: 20px;' : 'right: 20px;'}
      z-index: 99999999 !important;
      background: #0f172a;
      border: 1px solid rgba(244, 63, 94, 0.4);
      color: #e2e8f0;
      padding: 8px 12px;
      border-radius: 10px;
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.5);
      font-size: 11.5px;
      max-width: 250px;
      cursor: pointer;
      display: none;
      pointer-events: auto !important;
      animation: rebonlyToastSlide 0.3s ease-out;
    }
    @keyframes rebonlyToastSlide {
      from { transform: translateY(8px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    #rebonly-chat-window {
      position: fixed;
      bottom: 80px;
      ${config.position === 'bottom-left' ? 'left: 20px;' : 'right: 20px;'}
      width: 330px;
      max-width: calc(100vw - 32px);
      height: 460px;
      max-height: calc(100vh - 100px);
      background: #0f172a;
      color: #f8fafc;
      border-radius: 16px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.65);
      border: none;
      display: none;
      flex-direction: column;
      overflow: hidden;
      z-index: 99999999 !important;
      pointer-events: auto !important;
      animation: rebonlyFadeIn 0.25s ease;
    }
    @keyframes rebonlyFadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (max-width: 480px) {
      #rebonly-chat-window {
        width: calc(100vw - 24px);
        height: calc(100vh - 88px);
        bottom: 74px;
        right: 12px !important;
        left: 12px !important;
        max-width: none;
        border-radius: 14px;
        border: none;
      }
    }

    .rebonly-header {
      background: linear-gradient(135deg, #1e293b, #0f172a);
      padding: 11px 14px;
      border: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .rebonly-header-title {
      font-weight: 600;
      font-size: 13.5px;
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .rebonly-status-tag {
      font-size: 9.5px;
      background: rgba(16, 185, 129, 0.2);
      color: #10b981;
      padding: 2px 7px;
      border-radius: 8px;
      border: none;
    }
    .rebonly-close-btn {
      background: none;
      border: none;
      color: #94a3b8;
      font-size: 16px;
      cursor: pointer;
      padding: 3px;
    }
    .rebonly-close-btn:hover { color: #fff; }

    .rebonly-meta-bar {
      background: rgba(244, 63, 94, 0.08);
      border: none;
      padding: 6px 12px;
      font-size: 11px;
      color: #fda4af;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .rebonly-feed {
      flex: 1;
      padding: 10px 12px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: #090d16;
      border: none;
    }

    .rebonly-bubble-row {
      display: flex;
      flex-direction: column;
      max-width: 86%;
      border: none;
    }
    .rebonly-bubble-row.other { align-self: flex-start; }
    .rebonly-bubble-row.me { align-self: flex-end; }

    .rebonly-bubble {
      padding: 8px 11px;
      border-radius: 12px;
      font-size: 12.5px;
      line-height: 1.4;
      word-break: break-word;
      border: none;
    }
    .rebonly-bubble-row.other .rebonly-bubble {
      background: #1e293b;
      color: #f1f5f9;
      border-bottom-left-radius: 2px;
      border: none;
    }
    .rebonly-bubble-row.me .rebonly-bubble {
      background: #005c4b;
      color: #fff;
      border-bottom-right-radius: 2px;
      border: none;
    }

    .rebonly-msg-meta {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 4px;
      font-size: 9.5px;
      color: rgba(255, 255, 255, 0.5);
      margin-top: 2px;
      padding: 0 4px;
      border: none;
    }
    .rebonly-read-receipt {
      font-size: 10px;
    }
    .rebonly-read-receipt.read {
      color: #38bdf8;
    }

    /* Elastic Textarea & Action Bar */
    .rebonly-input-bar {
      padding: 8px 10px;
      background: #1e293b;
      border: none;
      display: flex;
      align-items: flex-end;
      gap: 5px;
      position: relative;
    }
    .rebonly-textarea {
      flex: 1;
      background: #0f172a;
      border: none;
      border-radius: 14px;
      color: #fff;
      padding: 8px 10px;
      font-size: 12.5px;
      outline: none;
      resize: none;
      height: 34px;
      max-height: 110px;
      line-height: 1.35;
      box-shadow: none;
    }
    .rebonly-textarea:focus {
      border: none;
      outline: none;
      box-shadow: none;
    }
    .rebonly-action-btn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.06);
      border: none;
      color: #94a3b8;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      flex-shrink: 0;
      transition: all 0.2s;
    }
    .rebonly-action-btn:hover {
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
      border: none;
    }
    .rebonly-send-btn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: ${config.sosColor};
      border: none;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      flex-shrink: 0;
    }

    /* Voice Recording Banner */
    .rebonly-voice-banner {
      display: none;
      flex: 1;
      align-items: center;
      justify-content: space-between;
      background: #331018;
      border: none;
      border-radius: 14px;
      padding: 5px 10px;
      color: #f43f5e;
      font-size: 11.5px;
      font-weight: 600;
    }
    .rebonly-rec-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #f43f5e;
      display: inline-block;
      animation: rebonlyBlink 1s infinite;
      margin-right: 5px;
      border: none;
    }
    @keyframes rebonlyBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

    .rebonly-media-img {
      max-width: 100%;
      border-radius: 8px;
      margin-top: 4px;
      cursor: pointer;
      border: none;
    }
    .rebonly-file-card {
      display: flex;
      align-items: center;
      gap: 7px;
      background: rgba(255,255,255,0.08);
      padding: 6px 9px;
      border-radius: 8px;
      margin-top: 4px;
      color: #fff;
      text-decoration: none;
      font-size: 11.5px;
      border: none;
    }
    .rebonly-audio-player {
      width: 100%;
      max-width: 200px;
      height: 32px;
      margin-top: 4px;
      border: none;
    }
  `;

  function init() {
    if (!document.body) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
      } else {
        setTimeout(init, 50);
      }
      return;
    }
    if (document.getElementById('rebonly-widget-root')) return;

    // Inject style
    const styleEl = document.createElement('style');
    styleEl.textContent = styles;
    document.head.appendChild(styleEl);

    // Create Container
    const root = document.createElement('div');
    root.id = 'rebonly-widget-root';
    root.innerHTML = `
      <div id="rebonly-floating-wrap" style="position: fixed; bottom: 20px; ${config.position === 'bottom-left' ? 'left: 20px;' : 'right: 20px;'} z-index: 99999999; display: inline-block;">
        <button id="rebonly-floating-btn" title="Besoin d'aide ? Support DigiCom" aria-label="Support DigiCom">
          <img src="${config.serverUrl}/img/bot.png" alt="DigiCom" width="60" height="60" loading="eager">
        </button>
        <span id="rebonly-floating-badge">0</span>
      </div>

      <div id="rebonly-toast-tooltip">
        <div style="font-weight: 700; font-size: 11.5px; color: #38bdf8; margin-bottom: 2px;">Support DigiCom</div>
        <div id="rebonly-toast-body" style="font-size: 11px; color: #cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Nouveau message du support...</div>
      </div>
      <div id="rebonly-chat-window">
        <div class="rebonly-header">
          <div class="rebonly-header-title">
            <div style="display:flex;align-items:center;gap:5px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"></polygon><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg><span>SOS Support Direct</span></div>
            <span class="rebonly-status-tag">En ligne</span>
          </div>
          <button class="rebonly-close-btn" id="rebonly-close">✕</button>
        </div>
        <div class="rebonly-meta-bar" style="display:flex;align-items:center;gap:5px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"></path><path d="M6 12v5c3 3 9 3 12 0v-5"></path></svg>
          <span><strong>${escapeText(config.courseTitle)}</strong></span>
        </div>
        <div class="rebonly-feed" id="rebonly-feed">
          <div class="rebonly-bubble-row other">
            <div class="rebonly-bubble">Bonjour ${escapeText(config.trainerName)}. En quoi pouvons-nous vous aider ? Écrivez votre message ou envoyez une note vocale. Le support vous répond en direct sous 15 secondes, ou accédez directement à <a href="https://chat.digiroys.com/?invite=roys" target="_blank" style="color: #38bdf8; font-weight: 600; text-decoration: underline;">chat.digiroys.com</a>.</div>
          </div>
        </div>

        <div class="rebonly-typing-bar" id="rebonly-typing-bar" style="display: none; padding: 4px 12px; font-size: 10.5px; color: #10b981; font-style: italic; background: rgba(16, 185, 129, 0.08); border: none;">Support DigiCom est en train d'écrire...</div>

        <form class="rebonly-input-bar" id="rebonly-form">
          <input type="file" id="rebonly-file-input" accept="image/*,application/pdf" style="display: none;">
          <button type="button" class="rebonly-action-btn" id="rebonly-attach-btn" title="Joindre une photo ou un PDF"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg></button>
          <button type="button" class="rebonly-action-btn" id="rebonly-mic-btn" title="Enregistrer une note vocale"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg></button>
          
          <div class="rebonly-voice-banner" id="rebonly-voice-banner">
            <span><span class="rebonly-rec-dot"></span><span id="rebonly-rec-timer">00:00</span></span>
            <div style="display: flex; gap: 5px; align-items: center;">
              <button type="button" id="rebonly-cancel-rec" style="background: none; border: none; color: #94a3b8; cursor: pointer; display: flex; align-items: center;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
              <button type="button" id="rebonly-send-rec" style="background: #10b981; border: none; color: #fff; border-radius: 8px; padding: 2px 8px; cursor: pointer; font-size: 11.5px;">Envoyer</button>
            </div>
          </div>

          <textarea class="rebonly-textarea" id="rebonly-input" placeholder="Message d'urgence..." rows="1" autocomplete="off"></textarea>
          <button type="submit" class="rebonly-send-btn" id="rebonly-submit-btn"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg></button>
        </form>
      </div>
    `;
    document.body.appendChild(root);

    const btn = document.getElementById('rebonly-floating-btn');
    const win = document.getElementById('rebonly-chat-window');
    const closeBtn = document.getElementById('rebonly-close');
    const form = document.getElementById('rebonly-form');
    const textarea = document.getElementById('rebonly-input');
    const attachBtn = document.getElementById('rebonly-attach-btn');
    const fileInput = document.getElementById('rebonly-file-input');
    const micBtn = document.getElementById('rebonly-mic-btn');
    const voiceBanner = document.getElementById('rebonly-voice-banner');
    const cancelRecBtn = document.getElementById('rebonly-cancel-rec');
    const sendRecBtn = document.getElementById('rebonly-send-rec');
    const recTimer = document.getElementById('rebonly-rec-timer');
    const toastTooltip = document.getElementById('rebonly-toast-tooltip');

    let unreadWidgetCount = 0;

    function openChatWindow() {
      win.style.display = 'flex';
      btn.classList.remove('rebonly-pulse');
      const badge = document.getElementById('rebonly-floating-badge');
      if (badge) {
        badge.style.display = 'none';
        badge.textContent = '0';
      }
      if (toastTooltip) toastTooltip.style.display = 'none';
      unreadWidgetCount = 0;
      textarea.focus();
      const feed = document.getElementById('rebonly-feed');
      if (feed) feed.scrollTop = feed.scrollHeight;
    }

    btn.addEventListener('click', () => {
      if (win.style.display === 'flex') {
        win.style.display = 'none';
      } else {
        openChatWindow();
      }
    });

    if (toastTooltip) {
      toastTooltip.addEventListener('click', () => {
        openChatWindow();
      });
    }

    let lastTypingEmit = 0;

    // Elastic auto-expanding textarea & typing emit
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';

      const now = Date.now();
      if (now - lastTypingEmit > 1500) {
        lastTypingEmit = now;
        if (socket) {
          socket.emit('typing', {
            channel: 'support',
            senderId: config.trainerId,
            senderName: config.trainerName
          });
        }
      }
    });

    function submitCurrentText() {
      const text = textarea.value.trim();
      if (!text) return;
      textarea.value = '';
      textarea.style.height = '34px';
      sendSOS(text);
    }

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        submitCurrentText();
        return false;
      }
    });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      isOpen = !isOpen;
      win.style.display = isOpen ? 'flex' : 'none';
      if (isOpen) {
        try {
          ensureSocketConnected();
        } catch (err) {
          console.warn('[RebOnly Widget] Connection warning:', err);
        }
        try {
          textarea.focus();
        } catch (err) { }
      }
    });

    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      isOpen = false;
      win.style.display = 'none';
    });

    // File Upload Handler
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      fileInput.value = '';

      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch(config.serverUrl + '/api/upload', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (data.success && data.url) {
          const isImg = file.type.startsWith('image/');
          const isPdf = file.type === 'application/pdf';
          const msgPayload = {
            type: isImg ? 'image' : (isPdf ? 'pdf' : 'file'),
            url: data.url,
            fileName: data.fileName,
            text: isImg ? '📷 Photo jointe' : (isPdf ? `📄 ${data.fileName}` : `📎 ${data.fileName}`)
          };
          sendSOS(JSON.stringify(msgPayload));
        }
      } catch (err) {
        console.error('[RebOnly Widget] File upload failed:', err);
      }
    });

    // Voice Recorder Handler
    micBtn.addEventListener('click', async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.start();
        recordingSeconds = 0;
        recTimer.textContent = '00:00';

        recordingTimer = setInterval(() => {
          recordingSeconds++;
          const mins = String(Math.floor(recordingSeconds / 60)).padStart(2, '0');
          const secs = String(recordingSeconds % 60).padStart(2, '0');
          recTimer.textContent = `${mins}:${secs}`;
        }, 1000);

        voiceBanner.style.display = 'flex';
        textarea.style.display = 'none';
        attachBtn.style.display = 'none';
        micBtn.style.display = 'none';
      } catch (err) {
        alert('Veuillez autoriser le microphone pour enregistrer une note vocale.');
      }
    });

    function resetVoiceUI() {
      if (recordingTimer) clearInterval(recordingTimer);
      voiceBanner.style.display = 'none';
      textarea.style.display = 'block';
      attachBtn.style.display = 'flex';
      micBtn.style.display = 'flex';
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
      }
    }

    cancelRecBtn.addEventListener('click', () => {
      resetVoiceUI();
    });

    sendRecBtn.addEventListener('click', () => {
      if (!mediaRecorder || sendRecBtn.disabled) return;
      sendRecBtn.disabled = true;
      cancelRecBtn.disabled = true;
      sendRecBtn.innerHTML = `
        <svg style="animation: spin 0.8s linear infinite;" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line>
          <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
          <line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line>
        </svg>
      `;
      recTimer.textContent = 'Envoi...';

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('file', audioBlob, `voice_${Date.now()}.webm`);

        try {
          const res = await fetch(config.serverUrl + '/api/upload', {
            method: 'POST',
            body: formData
          });
          const data = await res.json();
          if (data.success && data.url) {
            const msgPayload = {
              type: 'audio',
              url: data.url,
              text: '🎤 Note vocale'
            };
            sendSOS(JSON.stringify(msgPayload));
          }
        } catch (err) {
          console.error('[RebOnly Widget] Audio upload failed:', err);
        }
        sendRecBtn.disabled = false;
        cancelRecBtn.disabled = false;
        sendRecBtn.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        `;
        resetVoiceUI();
      };
      mediaRecorder.stop();
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      submitCurrentText();
      return false;
    });
  }

  function ensureSocketConnected() {
    if (socket) return;

    function connect() {
      socket = window.io(config.serverUrl, {
        reconnection: true,
        query: { userId: config.trainerId }
      });

      socket.on('connect', () => {
        socket.emit('authenticate', {
          id: config.trainerId,
          username: config.trainerName,
          role: 'trainer'
        });
        socket.emit('join_support', { senderId: config.trainerId });

        // Load widget chat history for persistent student ID
        fetch(config.serverUrl + '/api/history/support?senderId=' + encodeURIComponent(config.trainerId))
          .then(res => res.json())
          .then(data => {
            if (data.messages && data.messages.length > 0) {
              const feed = document.getElementById('rebonly-feed');
              if (feed) {
                feed.innerHTML = ''; // Clear default greeting
                data.messages.forEach(m => {
                  const isMe = m.senderId === config.trainerId || m.sender_id === config.trainerId;
                  appendMessage(m.content, isMe ? 'me' : 'other', m.is_read || m.isRead, m.id);
                });
              }
            }
          }).catch(err => { });
      });

      socket.on('support_message', (msg) => {
        const msgSender = msg.senderId || msg.sender_id;
        const msgReceiver = msg.receiverId || msg.receiver_id;

        // Strict Privacy Check: Formateur only sees messages meant for them!
        const isForMe = (msgSender === config.trainerId || msgReceiver === config.trainerId);
        if (!isForMe) {
          return;
        }

        const isFromOther = msgSender !== config.trainerId;
        if (isFromOther) {
          appendMessage(msg.content, 'other', msg.is_read || msg.isRead, msg.id);
          playNotificationSound();

          const winEl = document.getElementById('rebonly-chat-window');
          if (winEl && winEl.style.display !== 'flex') {
            unreadWidgetCount++;
            const badge = document.getElementById('rebonly-floating-badge');
            const floatBtn = document.getElementById('rebonly-floating-btn');
            const toast = document.getElementById('rebonly-toast-tooltip');
            const toastBody = document.getElementById('rebonly-toast-body');

            if (badge) {
              badge.textContent = unreadWidgetCount > 99 ? '99+' : unreadWidgetCount;
              badge.style.display = 'flex';
            }
            if (floatBtn) {
              floatBtn.classList.add('rebonly-pulse');
            }
            if (toast && toastBody) {
              let textSnippet = typeof msg.content === 'object' ? (msg.content.text || 'Nouveau fichier') : msg.content;
              if (typeof textSnippet === 'string' && (textSnippet.startsWith('{') || textSnippet.startsWith('&quot;{'))) {
                try {
                  const inner = JSON.parse(textSnippet.replace(/&quot;/g, '"'));
                  textSnippet = inner.text || 'Nouveau message';
                } catch (e) { }
              }
              toastBody.textContent = textSnippet;
              toast.style.display = 'block';
              clearTimeout(window.rebonlyToastTimeout);
              window.rebonlyToastTimeout = setTimeout(() => {
                toast.style.display = 'none';
              }, 6000);
            }
          }
        }
      });

      // Listen for Read Receipt from Admin
      socket.on('support_read_receipt', () => {
        const wrappers = document.querySelectorAll('.rebonly-read-receipt-wrapper');
        wrappers.forEach(el => {
          el.innerHTML = `<svg class="rebonly-read-icon read" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
        });
      });

      // Listen for Typing indicator from Admin
      socket.on('typing', (data) => {
        const bar = document.getElementById('rebonly-typing-bar');
        if (bar) {
          bar.style.display = 'block';
          bar.textContent = `${data.senderName || 'Le support'} est en train d'écrire...`;
          clearTimeout(window.rebonlyTypingTimeout);
          window.rebonlyTypingTimeout = setTimeout(() => {
            bar.style.display = 'none';
          }, 2500);
        }
      });
    }

    if (typeof window.io === 'undefined') {
      const script = document.createElement('script');
      script.src = config.serverUrl + '/socket.io/socket.io.js';
      script.onload = connect;
      document.head.appendChild(script);
    } else {
      connect();
    }
  }

  function sendSOS(text) {
    ensureSocketConnected();

    const msgId = 'sos_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const payload = {
      id: msgId,
      senderId: config.trainerId,
      senderName: config.trainerName,
      content: text,
      contextData: {
        trainerId: config.trainerId,
        trainerName: config.trainerName,
        courseTitle: config.courseTitle,
        pageUrl: window.location.href
      }
    };

    if (socket) {
      socket.emit('trainer_message', payload);
    }

    appendMessage(text, 'me', 0, msgId);
  }

  function appendMessage(rawContent, type, isRead = 0, msgId = null) {
    const feed = document.getElementById('rebonly-feed');
    if (!feed) return;

    const row = document.createElement('div');
    row.className = `rebonly-bubble-row ${type}`;

    const bubble = document.createElement('div');
    bubble.className = 'rebonly-bubble';

    let mediaHtml = '';
    let parsedText = rawContent;

    try {
      if (typeof rawContent === 'string' && (rawContent.startsWith('{') || rawContent.startsWith('&quot;{'))) {
        const data = JSON.parse(rawContent.replace(/&quot;/g, '"'));
        if (data.type === 'image' && data.url) {
          const fullUrl = data.url.startsWith('http') ? data.url : config.serverUrl + data.url;
          mediaHtml = `<img src="${fullUrl}" class="rebonly-media-img" onclick="window.open('${fullUrl}', '_blank')" />`;
          parsedText = data.text || '';
        } else if (data.type === 'pdf' && data.url) {
          const fullUrl = data.url.startsWith('http') ? data.url : config.serverUrl + data.url;
          mediaHtml = `<a href="${fullUrl}" target="_blank" class="rebonly-file-card">📄 ${escapeText(data.fileName || 'Document PDF')} ↗</a>`;
          parsedText = '';
        } else if (data.type === 'audio' && data.url) {
          const fullUrl = data.url.startsWith('http') ? data.url : config.serverUrl + data.url;
          mediaHtml = `<audio src="${fullUrl}" controls class="rebonly-audio-player"></audio>`;
          parsedText = '';
        } else if (data.text) {
          parsedText = data.text;
        }
      }
    } catch (e) { }

    bubble.innerHTML = (parsedText ? escapeText(parsedText) : '') + mediaHtml;
    row.appendChild(bubble);

    // Metadata line (Time + Read receipt status for sent messages)
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const meta = document.createElement('div');
    meta.className = 'rebonly-msg-meta';

    const checkSvg = `<svg class="rebonly-read-receipt" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    const eyeSvg = `<svg class="rebonly-read-receipt read" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;

    let statusIcon = `<span class="rebonly-read-receipt-wrapper">${isRead ? eyeSvg : checkSvg}</span>`;
    meta.innerHTML = `<span>${timeStr}</span> ${type === 'me' ? statusIcon : ''}`;
    row.appendChild(meta);

    feed.appendChild(row);
    feed.scrollTop = feed.scrollHeight;
  }

  function playNotificationSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch (e) { }
  }

  function escapeText(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  if (document.body) {
    init();
  } else if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 0);
  } else {
    document.addEventListener('DOMContentLoaded', init);
    window.addEventListener('load', init);
  }
})();
