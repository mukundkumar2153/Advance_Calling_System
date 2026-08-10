const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ],
};

let pc                 = null;
let localStream        = null;
let currentCallId      = null;
let currentTarget      = null;
let callStartTime      = null;
let isMuted            = false;
let pendingCandidates  = [];

// ── Get microphone ────────────────────────────────────────
async function startLocalAudio() {
  // If already have stream, return it
  if (localStream && localStream.active) {
    console.log('[WebRTC] Reusing existing stream');
    return localStream;
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl:  true,
        sampleRate:       48000,
      },
      video: false,
    });

    // Apply mute state
    localStream.getAudioTracks().forEach(t => {
      t.enabled = !isMuted;
      console.log('[WebRTC] Got audio track:', t.label, 'enabled:', t.enabled);
    });

    return localStream;

  } catch(e) {
    console.error('[WebRTC] Microphone error:', e.name, e.message);

    if (e.name === 'NotAllowedError') {
      App.showToast('❌ Microphone permission denied — please allow mic access');
    } else if (e.name === 'NotFoundError') {
      App.showToast('❌ No microphone found');
    } else {
      App.showToast('❌ Microphone error: ' + e.message);
    }
    throw e;
  }
}

function stopLocalAudio() {
  if (localStream) {
    localStream.getTracks().forEach(t => {
      t.stop();
      console.log('[WebRTC] Stopped track:', t.label);
    });
    localStream = null;
  }
}

// ── Create peer connection ────────────────────────────────
function createPeerConnection(targetId, callId) {
  // Close existing if any
  if (pc) {
    console.warn('[WebRTC] Closing existing peer connection');
    pc.close();
    pc = null;
  }

  currentTarget = targetId;
  currentCallId = callId;

  pc = new RTCPeerConnection(ICE_SERVERS);
  console.log('[WebRTC] Created peer connection');

  // ── Add local audio tracks FIRST before anything else ──
  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
      console.log('[WebRTC] Added local track:', track.kind, track.label);
    });
  } else {
    console.error('[WebRTC] NO LOCAL STREAM when creating peer connection!');
  }

  // ── Handle remote audio ───────────────────────────────
  pc.ontrack = (e) => {
    console.log('[WebRTC] Received remote track:', e.track.kind);

    let audio = document.getElementById('remote-audio');
    if (!audio) {
      audio = document.createElement('audio');
      audio.id       = 'remote-audio';
      audio.autoplay = true;
      audio.setAttribute('playsinline', '');
      document.body.appendChild(audio);
      console.log('[WebRTC] Created remote audio element');
    }

    if (e.streams && e.streams[0]) {
      audio.srcObject = e.streams[0];
    } else {
      // Fallback: create stream from track
      const stream = new MediaStream([e.track]);
      audio.srcObject = stream;
    }

    // Force play (some browsers need this)
    audio.play().catch(err => {
      console.warn('[WebRTC] Auto-play blocked:', err);
      // Show a "tap to hear" button
      App.showToast('🔊 Tap anywhere to hear audio');
      document.addEventListener('click', () => audio.play(), { once: true });
    });
  };

  // ── ICE candidates ────────────────────────────────────
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      SocketClient.getSocket()?.emit('webrtc-ice', {
        callId,
        candidate: e.candidate,
        targetId,
      });
    }
  };

  pc.onicecandidateerror = (e) => {
    console.warn('[WebRTC] ICE error:', e.errorText);
  };

  // ── Connection state ──────────────────────────────────
  pc.onconnectionstatechange = () => {
    console.log('[WebRTC] Connection state:', pc.connectionState);
    if (pc.connectionState === 'connected') {
      callStartTime = Date.now();
      window.CallUI?.onCallConnected();
      App.showToast('✅ Call connected');

      // Start recording if enabled
      if (localStream && Settings.getSetting('recording', false)) {
        Settings.startRecording(localStream);
      }
    }
    if (pc.connectionState === 'failed') {
      App.showToast('❌ Call connection failed — try again');
      window.CallUI?.onCallEnded();
    }
    if (['disconnected', 'closed'].includes(pc.connectionState)) {
      window.CallUI?.onCallEnded();
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log('[WebRTC] ICE state:', pc.iceConnectionState);
  };

  return pc;
}

// ── CALLER: make offer ────────────────────────────────────
async function makeOffer(targetId, callId) {
  console.log('[WebRTC] Making offer to', targetId);

  try {
    // Step 1: Get microphone FIRST
    await startLocalAudio();
    console.log('[WebRTC] Got local audio, creating peer connection');

    // Step 2: Create peer connection WITH audio tracks
    createPeerConnection(targetId, callId);

    // Step 3: Create offer
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    });

    // Step 4: Set local description
    await pc.setLocalDescription(offer);
    console.log('[WebRTC] Set local description (offer)');

    // Step 5: Send offer to callee
    SocketClient.getSocket()?.emit('webrtc-offer', {
      callId,
      offer,
      targetId,
    });

    console.log('[WebRTC] Offer sent to', targetId);

  } catch(e) {
    console.error('[WebRTC] makeOffer failed:', e);
    App.showToast('❌ Failed to start call: ' + e.message);
    throw e;
  }
}

// ── CALLEE: handle offer, send answer ────────────────────
async function handleOffer({ callId, offer, fromId }) {
  console.log('[WebRTC] Handling offer from', fromId);

  try {
    // Step 1: Get microphone FIRST
    await startLocalAudio();
    console.log('[WebRTC] Got local audio for answer');

    // Step 2: Create peer connection WITH audio tracks
    createPeerConnection(fromId, callId);

    // Step 3: Set remote description (the offer)
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    console.log('[WebRTC] Set remote description (offer)');
    await flushPendingIceCandidates();

    // Step 4: Create answer
    const answer = await pc.createAnswer();

    // Step 5: Set local description (the answer)
    await pc.setLocalDescription(answer);
    console.log('[WebRTC] Set local description (answer)');

    // Step 6: Send answer back to caller
    SocketClient.getSocket()?.emit('webrtc-answer', {
      callId,
      answer,
      targetId: fromId,
    });

    console.log('[WebRTC] Answer sent to', fromId);

  } catch(e) {
    console.error('[WebRTC] handleOffer failed:', e);
    App.showToast('❌ Failed to answer call: ' + e.message);
    throw e;
  }
}

// ── CALLER: handle answer ─────────────────────────────────
async function handleAnswer({ answer, fromId }) {
  console.log('[WebRTC] Handling answer from', fromId);
  if (!pc) {
    console.error('[WebRTC] No peer connection when handling answer!');
    return;
  }
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    console.log('[WebRTC] Set remote description (answer)');
    await flushPendingIceCandidates();
  } catch(e) {
    console.error('[WebRTC] handleAnswer failed:', e);
  }
}

// ── ICE candidate ─────────────────────────────────────────
async function handleIce({ candidate, fromId }) {
  if (!candidate) return;
  if (pc && pc.remoteDescription && pc.remoteDescription.type) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch(e) {
      console.warn('[WebRTC] handleIce failed:', e.message);
    }
  } else {
    console.log('[WebRTC] Queuing ICE candidate until remote description set');
    pendingCandidates.push(candidate);
  }
}

async function flushPendingIceCandidates() {
  if (!pc || !pc.remoteDescription) return;
  while (pendingCandidates.length > 0) {
    const cand = pendingCandidates.shift();
    try {
      await pc.addIceCandidate(new RTCIceCandidate(cand));
      console.log('[WebRTC] Added queued ICE candidate');
    } catch(e) {
      console.warn('[WebRTC] Failed to add queued ICE candidate:', e.message);
    }
  }
}

// ── Mute toggle ───────────────────────────────────────────
function toggleMute() {
  isMuted = !isMuted;
  if (localStream) {
    localStream.getAudioTracks().forEach(t => {
      t.enabled = !isMuted;
      console.log('[WebRTC] Track', t.label, 'enabled:', t.enabled);
    });
  }
  SocketClient.getSocket()?.emit('mute-toggle', {
    callId:   currentCallId,
    muted:    isMuted,
    targetId: currentTarget,
  });
  return isMuted;
}

// ── Duration ──────────────────────────────────────────────
function getCallDuration() {
  return callStartTime
    ? Math.floor((Date.now() - callStartTime) / 1000) : 0;
}

// ── Cleanup ───────────────────────────────────────────────
function closePeerConnection() {
  console.log('[WebRTC] Closing peer connection');

  // Stop recording
  if (Settings.getSetting('recording', false)) {
    const { token, user } = AuthUI.getSession();
    Settings.stopRecording(user?.username || 'call');
  }

  if (pc) {
    pc.close();
    pc = null;
  }

  stopLocalAudio();

  callStartTime     = null;
  isMuted           = false;
  currentCallId     = null;
  currentTarget     = null;
  pendingCandidates = [];

  const audio = document.getElementById('remote-audio');
  if (audio) {
    audio.srcObject = null;
    audio.remove();
  }

  console.log('[WebRTC] Cleanup complete');
}

window.WebRTC = {
  makeOffer,
  handleOffer,
  handleAnswer,
  handleIce,
  toggleMute,
  closePeerConnection,
  getCallDuration,
  startLocalAudio,
};