/**
 * DigiCom Sovereign Calling Engine - Powered by Self-Hosted Jitsi Meet (meet.digiroys.com)
 */

(function () {
  'use strict';

  const JITSI_DOMAIN = 'meet.digiroys.com';

  let jitsiApi = null;
  let currentCall = null; // { targetUserId, targetUserName, callType, roomName, isCaller }
  let callTimeoutTimer = null;

  // Audio Context Ringtone Synthesizer (Telecom Dual-Tone 440Hz + 480Hz Cadence)
  let audioCtx = null;
  let ringtoneInterval = null;

  function playRingtone() {
    stopRingtone();
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([1000, 500, 1000, 500, 1000]);
      }
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      const playDualToneRing = () => {
        if (!audioCtx) return;
        try {
          const now = audioCtx.currentTime;

          const osc1 = audioCtx.createOscillator();
          const osc2 = audioCtx.createOscillator();
          const gain = audioCtx.createGain();

          osc1.type = 'sine';
          osc2.type = 'sine';
          osc1.frequency.setValueAtTime(440, now);
          osc2.frequency.setValueAtTime(480, now);

          gain.gain.setValueAtTime(0, now);
          gain.gain.linearRampToValueAtTime(0.14, now + 0.04);
          gain.gain.setValueAtTime(0.14, now + 0.75);
          gain.gain.linearRampToValueAtTime(0, now + 0.82);

          gain.gain.setValueAtTime(0, now + 1.0);
          gain.gain.linearRampToValueAtTime(0.14, now + 1.04);
          gain.gain.setValueAtTime(0.14, now + 1.75);
          gain.gain.linearRampToValueAtTime(0, now + 1.82);

          osc1.connect(gain);
          osc2.connect(gain);
          gain.connect(audioCtx.destination);

          osc1.start(now);
          osc2.start(now);
          osc1.stop(now + 2.0);
          osc2.stop(now + 2.0);
        } catch (e) {}
      };

      playDualToneRing();
      ringtoneInterval = setInterval(playDualToneRing, 3500);
    } catch (e) {
      console.warn('[-] Unable to play ringtone audio:', e);
    }
  }

  function stopRingtone() {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(0);
    }
    if (ringtoneInterval) {
      clearInterval(ringtoneInterval);
      ringtoneInterval = null;
    }
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
  }

  window.triggerIncomingCallUI = function(data) {
    if (!data || !data.callerId) return;
    if (currentCall) return;

    handleIncomingCall({
      callerId: data.callerId,
      callerName: data.callerName || 'Correspondant',
      callType: data.callType || 'audio',
      roomName: data.roomName || null
    });

    if (data.autoAnswer) {
      setTimeout(() => {
        acceptCall();
      }, 300);
    } else if (data.autoReject) {
      setTimeout(() => {
        rejectCall();
      }, 100);
    }
  };

  // Bind WebRTC Socket Listeners
  window.bindSocketWebRTC = function (socket) {
    if (!socket) return;

    socket.off('call_incoming').on('call_incoming', handleIncomingCall);
    socket.off('call_accepted').on('call_accepted', handleCallAccepted);
    socket.off('call_rejected').on('call_rejected', handleCallRejected);
    socket.off('call_ended').on('call_ended', handleRemoteCallEnded);
    console.log('[+] Jitsi Sovereign Call Socket Signaling Handlers Bound.');
  };

  window.startAudioCall = function () {
    const contact = (window.state && window.state.activeContact) || (window.getActiveContact && window.getActiveContact());
    if (contact) {
      startCall(contact, 'audio');
    } else {
      alert('Veuillez sélectionner un contact pour passer un appel.');
    }
  };

  window.startVideoCall = function () {
    const contact = (window.state && window.state.activeContact) || (window.getActiveContact && window.getActiveContact());
    if (contact) {
      startCall(contact, 'video');
    } else {
      alert('Veuillez sélectionner un contact pour passer un appel vidéo.');
    }
  };

  function generateRoomName(user1Id, user2Id) {
    const sorted = [String(user1Id), String(user2Id)].sort();
    return 'DigiCom_' + sorted.join('_');
  }

  async function startCall(targetUser, callType) {
    if (currentCall) {
      alert('Un appel est déjà en cours.');
      return;
    }

    if (!window.socket || !window.socket.connected) {
      alert('Connexion au serveur en cours... Veuillez patienter un instant.');
      return;
    }

    const myId = (window.state && window.state.user) ? window.state.user.id : 'anon';
    const targetUserId = targetUser.id;
    const targetUserName = targetUser.display_name || targetUser.username;
    const roomName = generateRoomName(myId, targetUserId);

    console.log(`[+] Initiating ${callType} call to ${targetUserName} (${targetUserId}) on room ${roomName}`);

    currentCall = {
      targetUserId,
      targetUserName,
      callType,
      roomName,
      isCaller: true
    };

    showIncomingCallUI(targetUserName, callType === 'video' ? 'Appel vidéo sortant...' : 'Appel audio sortant...', false);
    playRingtone();

    window.socket.emit('call_user', {
      targetUserId,
      callType,
      roomName
    });

    if (callTimeoutTimer) clearTimeout(callTimeoutTimer);
    callTimeoutTimer = setTimeout(() => {
      if (currentCall && currentCall.isCaller) {
        console.log('[*] Call timed out after 30s with no answer');
        window.socket.emit('call_rejected', {
          targetUserId: currentCall.targetUserId,
          reason: 'Pas de réponse',
          isMissed: true,
          callType: currentCall.callType
        });
        alert('Le correspondant ne répond pas.');
        cleanupCall();
      }
    }, 30000);
  }

  function handleIncomingCall(data) {
    console.log('[+] Incoming call from', data);
    if (currentCall) {
      window.socket.emit('call_rejected', { targetUserId: data.callerId, reason: 'Occupé' });
      return;
    }

    const myId = (window.state && window.state.user) ? window.state.user.id : 'anon';
    const roomName = data.roomName || generateRoomName(data.callerId, myId);

    currentCall = {
      targetUserId: data.callerId,
      targetUserName: data.callerName || 'Correspondant',
      callType: data.callType || 'audio',
      roomName: roomName,
      isCaller: false
    };

    showIncomingCallUI(data.callerName || 'Correspondant', data.callType === 'video' ? 'Appel vidéo entrant...' : 'Appel audio entrant...', true);
    playRingtone();
  }

  async function acceptCall() {
    if (!currentCall) return;
    if (callTimeoutTimer) clearTimeout(callTimeoutTimer);
    stopRingtone();

    window.socket.emit('call_accepted', {
      targetUserId: currentCall.targetUserId,
      roomName: currentCall.roomName
    });

    startJitsiCall(currentCall.roomName, currentCall.callType);
  }

  function handleCallAccepted(data) {
    if (!currentCall) return;
    if (callTimeoutTimer) clearTimeout(callTimeoutTimer);
    stopRingtone();

    const roomName = data.roomName || currentCall.roomName;
    startJitsiCall(roomName, currentCall.callType);
  }

  function handleCallRejected(data) {
    if (callTimeoutTimer) clearTimeout(callTimeoutTimer);
    stopRingtone();
    alert(`L'appel a été refusé : ${data.reason || 'Correspondant indisponible'}`);
    cleanupCall();
  }

  function handleRemoteCallEnded() {
    if (callTimeoutTimer) clearTimeout(callTimeoutTimer);
    stopRingtone();
    cleanupCall();
  }

  function rejectCall() {
    if (currentCall && window.socket) {
      window.socket.emit('call_rejected', {
        targetUserId: currentCall.targetUserId,
        reason: 'Refusé'
      });
    }
    cleanupCall();
  }

  function endCall() {
    if (currentCall && window.socket) {
      window.socket.emit('call_ended', {
        targetUserId: currentCall.targetUserId
      });
    }
    cleanupCall();
  }

  function startJitsiCall(roomName, callType) {
    const incomingModal = document.getElementById('call-incoming-modal');
    const activeModal = document.getElementById('active-call-modal');
    const container = document.getElementById('jitsi-container');

    if (incomingModal) incomingModal.style.display = 'none';
    if (activeModal) activeModal.style.display = 'flex';

    if (!container) return;
    container.innerHTML = '';

    if (typeof JitsiMeetExternalAPI === 'undefined') {
      console.error('[-] JitsiMeetExternalAPI script not loaded');
      alert('Module Jitsi Meet indisponible sur le serveur.');
      cleanupCall();
      return;
    }

    const myDisplayName = (window.state && window.state.user) 
      ? (window.state.user.display_name || window.state.user.username) 
      : 'Membre DigiCom';

    const options = {
      roomName: roomName,
      width: '100%',
      height: '100%',
      parentNode: container,
      userInfo: {
        displayName: myDisplayName
      },
      configOverwrite: {
        startWithAudioMuted: false,
        startWithVideoMuted: callType !== 'video',
        prejoinPageEnabled: false,
        disableThirdPartyRequests: true,
        enableWelcomePage: false,
        enableClosePage: false
      },
      interfaceConfigOverwrite: {
        TOOLBAR_BUTTONS: [
          'microphone', 'camera', 'desktop', 'fullscreen',
          'hangup', 'tileview', 'chat'
        ],
        SHOW_JITSI_WATERMARK: false,
        SHOW_WATERMARK_FOR_GUESTS: false,
        MOBILE_APP_PROMO: false
      }
    };

    try {
      jitsiApi = new JitsiMeetExternalAPI(JITSI_DOMAIN, options);

      jitsiApi.addEventListener('videoConferenceLeft', () => {
        console.log('[+] User left Jitsi conference');
        endCall();
      });

      jitsiApi.addEventListener('readyToClose', () => {
        console.log('[+] Jitsi conference readyToClose');
        endCall();
      });
    } catch (err) {
      console.error('[-] Error launching Jitsi call:', err);
      alert('Erreur au lancement de la visioconférence Jitsi.');
      cleanupCall();
    }
  }

  function showIncomingCallUI(userName, statusText, isIncoming) {
    const modal = document.getElementById('call-incoming-modal');
    const nameEl = document.getElementById('incoming-call-name');
    const typeEl = document.getElementById('incoming-call-type');
    const avatarEl = document.getElementById('incoming-call-avatar');
    const acceptBtn = document.getElementById('btn-accept-call');

    if (nameEl) nameEl.textContent = userName;
    if (typeEl) typeEl.textContent = statusText;
    if (avatarEl) avatarEl.textContent = (userName[0] || '?').toUpperCase();
    if (acceptBtn) acceptBtn.style.display = isIncoming ? 'flex' : 'none';

    if (modal) modal.style.display = 'flex';
  }

  function cleanupCall() {
    if (callTimeoutTimer) {
      clearTimeout(callTimeoutTimer);
      callTimeoutTimer = null;
    }
    stopRingtone();

    if (jitsiApi) {
      try {
        jitsiApi.dispose();
      } catch (e) {}
      jitsiApi = null;
    }

    const container = document.getElementById('jitsi-container');
    if (container) container.innerHTML = '';

    currentCall = null;

    const incomingModal = document.getElementById('call-incoming-modal');
    const activeModal = document.getElementById('active-call-modal');
    if (incomingModal) incomingModal.style.display = 'none';
    if (activeModal) activeModal.style.display = 'none';
  }

  function bindFastTap(element, callback) {
    if (!element) return;
    let handled = false;

    const trigger = (e) => {
      if (handled) return;
      handled = true;
      if (e && typeof e.preventDefault === 'function') {
        try { e.preventDefault(); } catch(err) {}
      }
      callback(e);
      setTimeout(() => { handled = false; }, 400);
    };

    element.onclick = trigger;
    element.ontouchend = trigger;
  }

  function setupUIListeners() {
    const btnAccept = document.getElementById('btn-accept-call');
    const btnReject = document.getElementById('btn-reject-call');
    const btnEnd = document.getElementById('btn-end-call');
    const btnStartAudio = document.getElementById('btn-start-audio-call');
    const btnStartVideo = document.getElementById('btn-start-video-call');

    bindFastTap(btnAccept, acceptCall);
    bindFastTap(btnReject, rejectCall);
    bindFastTap(btnEnd, endCall);
    if (btnStartAudio) btnStartAudio.onclick = window.startAudioCall;
    if (btnStartVideo) btnStartVideo.onclick = window.startVideoCall;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupUIListeners);
  } else {
    setupUIListeners();
  }

})();
