/**
 * DigiCom WebRTC Real-Time Audio & Video Call Manager
 * Fully Sovereign & Resilient P2P Engine with ICE Candidate Queueing & Mobile Fallbacks
 */

(function () {
  'use strict';

  // STUN & TURN Relay servers for WebRTC NAT traversal across 4G/5G mobile networks
  const RTC_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.services.mozilla.com' },
      { urls: 'stun:global.stun.twilio.com:3478' },
      { urls: 'stun:openrelay.metered.ca:80' },
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelay',
        credential: 'openrelay'
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelay',
        credential: 'openrelay'
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelay',
        credential: 'openrelay'
      },
      {
        urls: 'turns:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelay',
        credential: 'openrelay'
      }
    ],
    iceCandidatePoolSize: 10,
    sdpSemantics: 'unified-plan'
  };

  let peerConnection = null;
  let localStream = null;
  let remoteStream = null;
  let currentCall = null; // { targetUserId, targetUserName, callType, isCaller, offer }
  let callTimerInterval = null;
  let callStartTime = null;
  let pendingIceCandidates = [];

  // Audio Context Ringtone Synthesizer
  let audioCtx = null;
  let ringtoneInterval = null;

  function playRingtone() {
    stopRingtone();
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      const playBeep = () => {
        if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, audioCtx.currentTime); // 440 Hz (A4)
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.2);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 1.2);
      };

      playBeep();
      ringtoneInterval = setInterval(playBeep, 2500);
    } catch (e) {
      console.warn('[-] Unable to play ringtone audio:', e);
    }
  }

  function stopRingtone() {
    if (ringtoneInterval) {
      clearInterval(ringtoneInterval);
      ringtoneInterval = null;
    }
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
  }

  // Bind WebRTC Socket Listeners
  window.bindSocketWebRTC = function (socket) {
    if (!socket) return;

    socket.off('call_incoming').on('call_incoming', handleIncomingCall);
    socket.off('call_accepted').on('call_accepted', handleCallAccepted);
    socket.off('call_rejected').on('call_rejected', handleCallRejected);
    socket.off('ice_candidate').on('ice_candidate', handleRemoteIceCandidate);
    socket.off('call_ended').on('call_ended', handleRemoteCallEnded);
    console.log('[+] WebRTC Socket Signaling Handlers Bound.');
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

  async function startCall(targetUser, callType) {
    if (currentCall) {
      alert('Un appel est déjà en cours.');
      return;
    }

    if (!window.socket || !window.socket.connected) {
      alert('Connexion au serveur en cours... Veuillez patienter un instant.');
      return;
    }

    const targetUserId = targetUser.id;
    const targetUserName = targetUser.display_name || targetUser.username;

    console.log(`[+] WebRTC: Initiating ${callType} call to user ${targetUserName} (${targetUserId})`);

    pendingIceCandidates = [];
    currentCall = {
      targetUserId,
      targetUserName,
      callType,
      isCaller: true
    };

    showIncomingCallUI(targetUserName, callType === 'video' ? 'Appel vidéo sortant...' : 'Appel audio sortant...', false);
    playRingtone();

    try {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: callType === 'video' ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false
        });
      } catch (eFallback) {
        console.warn('[-] WebRTC: Mobile audio constraint fallback to audio:true', eFallback);
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: callType === 'video' ? true : false
        });
      }

      peerConnection = createPeerConnection(targetUserId);

      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });

      // Prime remote audio and video playback within user gesture context
      const remoteAudio = document.getElementById('remote-audio');
      const remoteVideo = document.getElementById('remote-video');
      if (remoteAudio) {
        remoteAudio.volume = 1.0;
        remoteAudio.muted = false;
        remoteAudio.play().catch(() => {});
      }
      if (remoteVideo) {
        remoteVideo.play().catch(() => {});
      }

      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: callType === 'video'
      });
      await peerConnection.setLocalDescription(offer);

      window.socket.emit('call_user', {
        targetUserId,
        callType,
        offer
      });
    } catch (err) {
      console.error('[-] WebRTC getUserMedia Error:', err);
      alert('Impossible d\'accéder à votre micro/caméra : ' + err.message);
      cleanupCall();
    }
  }

  function handleIncomingCall(data) {
    console.log('[+] WebRTC: Incoming call from', data);
    if (currentCall) {
      window.socket.emit('call_rejected', { targetUserId: data.callerId, reason: 'Occupé' });
      return;
    }

    pendingIceCandidates = [];
    currentCall = {
      targetUserId: data.callerId,
      targetUserName: data.callerName || 'Correspondant',
      callType: data.callType || 'audio',
      isCaller: false,
      offer: data.offer
    };

    showIncomingCallUI(data.callerName || 'Correspondant', data.callType === 'video' ? 'Appel vidéo entrant...' : 'Appel audio entrant...', true);
    playRingtone();
  }

  async function acceptCall() {
    if (!currentCall || !currentCall.offer) return;
    stopRingtone();

    // Prime remote audio and video playback within callee user gesture click context
    const remoteAudio = document.getElementById('remote-audio');
    const remoteVideo = document.getElementById('remote-video');
    if (remoteAudio) {
      remoteAudio.volume = 1.0;
      remoteAudio.muted = false;
      remoteAudio.play().catch(() => {});
    }
    if (remoteVideo) {
      remoteVideo.play().catch(() => {});
    }

    try {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: currentCall.callType === 'video' ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false
        });
      } catch (eFallback) {
        console.warn('[-] WebRTC: Mobile audio constraint fallback to audio:true', eFallback);
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: currentCall.callType === 'video' ? true : false
        });
      }

      peerConnection = createPeerConnection(currentCall.targetUserId);

      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });

      await peerConnection.setRemoteDescription(new RTCSessionDescription(currentCall.offer));
      await drainPendingIceCandidates();

      const answer = await peerConnection.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: currentCall.callType === 'video'
      });
      await peerConnection.setLocalDescription(answer);

      window.socket.emit('call_accepted', {
        targetUserId: currentCall.targetUserId,
        answer
      });

      startActiveCallUI();
    } catch (err) {
      console.error('[-] WebRTC acceptCall Error:', err);
      alert('Impossible d\'accéder au matériel pour répondre : ' + err.message);
      rejectCall();
    }
  }

  async function handleCallAccepted(data) {
    if (!currentCall || !peerConnection) return;
    stopRingtone();

    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      await drainPendingIceCandidates();
      startActiveCallUI();
    } catch (err) {
      console.error('[-] Error handling call_accepted answer:', err);
      cleanupCall();
    }
  }

  function handleCallRejected(data) {
    stopRingtone();
    alert(`L'appel a été refusé : ${data.reason || 'Correspondant indisponible'}`);
    cleanupCall();
  }

  async function handleRemoteIceCandidate(data) {
    if (!data || !data.candidate) return;
    if (peerConnection && peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (err) {
        console.warn('[-] Error adding remote ICE candidate directly:', err);
      }
    } else {
      console.log('[+] Queueing ICE candidate because remote description is not set yet');
      pendingIceCandidates.push(data.candidate);
    }
  }

  async function drainPendingIceCandidates() {
    if (!peerConnection || pendingIceCandidates.length === 0) return;
    console.log(`[+] Draining ${pendingIceCandidates.length} pending ICE candidates...`);
    const candidates = [...pendingIceCandidates];
    pendingIceCandidates = [];
    for (const cand of candidates) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(cand));
      } catch (e) {
        console.warn('[-] Error adding queued ICE candidate:', e);
      }
    }
  }

  function handleRemoteCallEnded() {
    stopRingtone();
    cleanupCall();
  }

  function createPeerConnection(targetUserId) {
    const pc = new RTCPeerConnection(RTC_CONFIG);

    pc.oniceconnectionstatechange = () => {
      console.log('[+] WebRTC ICE Connection State:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        console.log('[+] WebRTC P2P Audio/Video Stream CONNECTED SUCCESSFULLY!');
      } else if (pc.iceConnectionState === 'failed') {
        console.warn('[-] WebRTC ICE Connection FAILED, attempting restartIce()...');
        if (typeof pc.restartIce === 'function') pc.restartIce();
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[+] WebRTC Peer Connection State:', pc.connectionState);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && window.socket) {
        window.socket.emit('ice_candidate', {
          targetUserId,
          candidate: event.candidate
        });
      }
    };

    pc.ontrack = (event) => {
      console.log('[+] WebRTC: Received remote track kind:', event.track.kind);
      const incomingStream = (event.streams && event.streams[0]) ? event.streams[0] : null;

      if (!remoteStream) {
        remoteStream = incomingStream || new MediaStream();
      } else if (incomingStream && remoteStream !== incomingStream) {
        event.streams[0].getTracks().forEach(t => {
          if (!remoteStream.getTracks().includes(t)) remoteStream.addTrack(t);
        });
      }

      if (!incomingStream) {
        remoteStream.addTrack(event.track);
      }

      const remoteVideo = document.getElementById('remote-video');
      const remoteAudio = document.getElementById('remote-audio');

      if (remoteVideo && remoteVideo.srcObject !== remoteStream) {
        remoteVideo.srcObject = remoteStream;
        remoteVideo.muted = true; // Mute remote video element so audio ONLY plays through dedicated remoteAudio (prevents double audio echo)
      }
      if (remoteVideo) {
        remoteVideo.muted = true;
        remoteVideo.play().catch(e => console.warn('remoteVideo play err:', e));
      }

      if (remoteAudio && remoteAudio.srcObject !== remoteStream) {
        remoteAudio.srcObject = remoteStream;
        remoteAudio.volume = 1.0;
        remoteAudio.muted = false;
      }
      if (remoteAudio) {
        const playRemoteAudio = () => {
          remoteAudio.volume = 1.0;
          remoteAudio.muted = false;
          remoteAudio.play().catch(e => {
            console.warn('[-] WebRTC remoteAudio playback waiting for mobile touch gesture:', e);
            const unlockTouch = () => {
              remoteAudio.play().catch(() => {});
            };
            window.addEventListener('touchstart', unlockTouch, { once: true });
            window.addEventListener('click', unlockTouch, { once: true });
          });
        };
        playRemoteAudio();
      }
    };

    return pc;
  }

  function rejectCall() {
    if (currentCall && window.socket) {
      window.socket.emit('call_rejected', {
        targetUserId: currentCall.targetUserId,
        reason: 'Appel refusé'
      });
    }
    stopRingtone();
    cleanupCall();
  }

  function endCall() {
    if (currentCall && window.socket) {
      window.socket.emit('call_ended', {
        targetUserId: currentCall.targetUserId
      });
    }
    stopRingtone();
    cleanupCall();
  }

  let isMicMuted = false;

  function toggleMic() {
    isMicMuted = !isMicMuted;

    // 1. Mute/unmute all local audio tracks
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMicMuted;
      });
    }

    // 2. Mute/unmute all WebRTC audio RTP senders
    if (peerConnection) {
      peerConnection.getSenders().forEach(sender => {
        if (sender.track && sender.track.kind === 'audio') {
          sender.track.enabled = !isMicMuted;
        }
      });
    }

    // 3. Update UI button state
    const btnMic = document.getElementById('btn-toggle-mic');
    if (btnMic) {
      if (isMicMuted) {
        btnMic.classList.add('active-off');
        btnMic.title = 'Microphone désactivé (cliquer pour activer)';
      } else {
        btnMic.classList.remove('active-off');
        btnMic.title = 'Microphone activé (cliquer pour couper)';
      }
    }
    console.log('[+] WebRTC Mic Mute State:', isMicMuted ? 'MUTED' : 'UNMUTED');
  }

  function toggleCam() {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        const btnCam = document.getElementById('btn-toggle-cam');
        if (btnCam) {
          if (videoTrack.enabled) {
            btnCam.classList.remove('active-off');
          } else {
            btnCam.classList.add('active-off');
          }
        }
      }
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

  function startActiveCallUI() {
    const incomingModal = document.getElementById('call-incoming-modal');
    const activeModal = document.getElementById('active-call-modal');
    const nameEl = document.getElementById('active-call-name');
    const avatarEl = document.getElementById('active-call-avatar');
    const videoGrid = document.getElementById('video-grid');
    const audioVisual = document.getElementById('audio-call-visual');
    const btnCam = document.getElementById('btn-toggle-cam');
    const localVideo = document.getElementById('local-video');

    if (incomingModal) incomingModal.style.display = 'none';
    if (activeModal) activeModal.style.display = 'flex';

    if (nameEl && currentCall) nameEl.textContent = currentCall.targetUserName;
    if (avatarEl && currentCall) avatarEl.textContent = (currentCall.targetUserName[0] || '?').toUpperCase();

    if (currentCall && currentCall.callType === 'video') {
      if (videoGrid) videoGrid.style.display = 'block';
      if (audioVisual) audioVisual.style.display = 'none';
      if (btnCam) btnCam.style.display = 'flex';
      if (localVideo && localStream) {
        localVideo.srcObject = localStream;
        localVideo.play().catch(() => {});
      }
    } else {
      if (videoGrid) videoGrid.style.display = 'none';
      if (audioVisual) audioVisual.style.display = 'flex';
      if (btnCam) btnCam.style.display = 'none';
    }

    startTimer();
  }

  function startTimer() {
    stopTimer();
    callStartTime = Date.now();
    const timerEl = document.getElementById('call-timer');
    callTimerInterval = setInterval(() => {
      if (!callStartTime || !timerEl) return;
      const elapsedSec = Math.floor((Date.now() - callStartTime) / 1000);
      const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
      const secs = String(elapsedSec % 60).padStart(2, '0');
      timerEl.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  function stopTimer() {
    if (callTimerInterval) {
      clearInterval(callTimerInterval);
      callTimerInterval = null;
    }
  }

  function cleanupCall() {
    stopTimer();
    stopRingtone();
    pendingIceCandidates = [];
    isMicMuted = false;

    const btnMic = document.getElementById('btn-toggle-mic');
    if (btnMic) {
      btnMic.classList.remove('active-off');
      btnMic.title = 'Microphone';
    }

    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }

    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }

    remoteStream = null;
    currentCall = null;

    const incomingModal = document.getElementById('call-incoming-modal');
    const activeModal = document.getElementById('active-call-modal');
    if (incomingModal) incomingModal.style.display = 'none';
    if (activeModal) activeModal.style.display = 'none';

    const localVideo = document.getElementById('local-video');
    const remoteVideo = document.getElementById('remote-video');
    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;
  }

  function setupUIListeners() {
    const btnAccept = document.getElementById('btn-accept-call');
    const btnReject = document.getElementById('btn-reject-call');
    const btnEnd = document.getElementById('btn-end-call');
    const btnMic = document.getElementById('btn-toggle-mic');
    const btnCam = document.getElementById('btn-toggle-cam');
    const btnStartAudio = document.getElementById('btn-start-audio-call');
    const btnStartVideo = document.getElementById('btn-start-video-call');

    if (btnAccept) btnAccept.onclick = acceptCall;
    if (btnReject) btnReject.onclick = rejectCall;
    if (btnEnd) btnEnd.onclick = endCall;
    if (btnMic) btnMic.onclick = toggleMic;
    if (btnCam) btnCam.onclick = toggleCam;
    if (btnStartAudio) btnStartAudio.onclick = window.startAudioCall;
    if (btnStartVideo) btnStartVideo.onclick = window.startVideoCall;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupUIListeners);
  } else {
    setupUIListeners();
  }

})();
