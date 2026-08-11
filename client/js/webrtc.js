// ── ICE Config — fetched from server (includes TURN for long-distance calls) ──
let _iceServers = null;
async function getIceServers() {
  if (_iceServers) return _iceServers;
  try {
    const res = await fetch('/api/ice-servers');
    const data = await res.json();
    _iceServers = data;
    console.log('[WebRTC] ICE servers loaded:', _iceServers.iceServers.length, 'servers');
    return _iceServers;
  } catch(e) {
    console.warn('[WebRTC] Could not load ICE servers, using fallback');
    _iceServers = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        {
          urls: [
            'turn:openrelay.metered.ca:80',
            'turn:openrelay.metered.ca:443',
            'turn:openrelay.metered.ca:443?transport=tcp',
          ],
          username:   'openrelayproject',
          credential: 'openrelayproject',
        },
      ],
    };
    return _iceServers;
  }
}

// ── State ─────────────────────────────────────────────────
let localStream       = null;
let isMuted           = false;
let callStartTime     = null;

// ── 1-to-1 call state ────────────────────────────────────
let pc                = null;   // single RTCPeerConnection for 1-to-1
let currentCallId     = null;
let currentTarget     = null;
let pendingCandidates = [];

// ── Conference (mesh) state ───────────────────────────────
// Map<userId, { pc: RTCPeerConnection, pending: RTCIceCandidate[] }>
const peerConnections = new Map();
let currentRoomId     = null;

// ── Get microphone ────────────────────────────────────────
async function startLocalAudio() {
  if (localStream && localStream.active) {
    console.log('[WebRTC] Reusing existing stream');
    return localStream;
  }

  // Unlock AudioContext on mobile (must be called from user gesture context)
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) { const ctx = new AC(); await ctx.resume(); ctx.close(); }
  } catch(e) {}

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

    localStream.getAudioTracks().forEach(t => {
      t.enabled = !isMuted;
      console.log('[WebRTC] Got audio track:', t.label, 'enabled:', t.enabled);
    });

    return localStream;

  } catch(e) {
    console.error('[WebRTC] Microphone error:', e.name, e.message);

    if (e.name === 'NotAllowedError') {
      App.showToast('❌ Mic blocked — Open browser Settings → Allow microphone');
    } else if (e.name === 'NotFoundError') {
      App.showToast('❌ No microphone found on this device');
    } else if (e.name === 'NotReadableError') {
      App.showToast('❌ Mic in use by another app — close it and retry');
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

// ── Create audio element for remote peer ─────────────────
function createRemoteAudio(peerId) {
  const id = `remote-audio-${peerId}`;
  let audio = document.getElementById(id);
  if (!audio) {
    audio = document.createElement('audio');
    audio.id         = id;
    audio.autoplay   = true;
    audio.setAttribute('playsinline', '');
    // Default: use earpiece on mobile; toggleSpeaker() switches to loudspeaker
    document.body.appendChild(audio);
    console.log('[WebRTC] Created audio element for peer:', peerId);
  }
  return audio;
}

// ── Set audio output device (loudspeaker vs earpiece) ────
async function setAudioOutput(elementId, useSpeaker) {
  const audio = document.getElementById(elementId);
  if (!audio) return;
  try {
    if (typeof audio.setSinkId === 'function') {
      // setSinkId('') = default (earpiece on mobile), 'default' = loudspeaker
      const sinkId = useSpeaker ? 'default' : '';
      await audio.setSinkId(sinkId);
      console.log('[WebRTC] Audio output set to:', useSpeaker ? 'speaker' : 'earpiece');
    } else {
      // Fallback: no setSinkId support — just show toast
      console.warn('[WebRTC] setSinkId not supported on this browser');
    }
  } catch(e) {
    console.warn('[WebRTC] setSinkId error:', e.message);
  }
}

// ── 1-to-1: Create peer connection ────────────────────────
async function createPeerConnection(targetId, callId) {
  if (pc) {
    console.warn('[WebRTC] Closing existing peer connection');
    pc.close();
    pc = null;
  }

  currentTarget     = targetId;
  currentCallId     = callId;
  pendingCandidates = [];

  const iceConfig = await getIceServers();
  pc = new RTCPeerConnection(iceConfig);
  console.log('[WebRTC] Created peer connection with', iceConfig.iceServers.length, 'ICE servers');

  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
      console.log('[WebRTC] Added local track:', track.kind);
    });
  } else {
    console.error('[WebRTC] NO LOCAL STREAM when creating peer connection!');
  }

  pc.ontrack = (e) => {
    console.log('[WebRTC] Received remote track:', e.track.kind);
    const audio = createRemoteAudio('1to1');
    if (e.streams && e.streams[0]) {
      audio.srcObject = e.streams[0];
    } else {
      audio.srcObject = new MediaStream([e.track]);
    }
    audio.play().catch(err => {
      console.warn('[WebRTC] Auto-play blocked:', err);
      App.showToast('🔊 Tap anywhere to hear audio');
      document.addEventListener('click', () => audio.play(), { once: true });
    });
  };

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
    if (e.errorCode !== 701) // 701 = STUN gather error, normal when STUN unreachable
      console.warn('[WebRTC] ICE error:', e.errorCode, e.errorText);
  };

  pc.onconnectionstatechange = () => {
    console.log('[WebRTC] Connection state:', pc.connectionState);
    if (pc.connectionState === 'connected') {
      callStartTime = Date.now();
      window.CallUI?.onCallConnected();
      App.showToast('✅ Call connected');
      if (localStream && Settings.getSetting('recording', false)) {
        Settings.startRecording(localStream);
      }
    }
    if (pc.connectionState === 'failed') {
      App.showToast('❌ Call connection failed — check network and retry');
      window.CallUI?.onCallEnded();
    }
    if (['disconnected', 'closed'].includes(pc.connectionState)) {
      window.CallUI?.onCallEnded();
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log('[WebRTC] ICE state:', pc.iceConnectionState);
    if (pc.iceConnectionState === 'failed') {
      console.warn('[WebRTC] ICE failed — TURN relay may be needed');
    }
  };

  return pc;
}

// ── 1-to-1: Make offer ────────────────────────────────────
async function makeOffer(targetId, callId) {
  console.log('[WebRTC] Making offer to', targetId);
  try {
    await startLocalAudio();
    await createPeerConnection(targetId, callId);

    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    });
    await pc.setLocalDescription(offer);
    console.log('[WebRTC] Set local description (offer)');

    SocketClient.getSocket()?.emit('webrtc-offer', { callId, offer, targetId });
    console.log('[WebRTC] Offer sent to', targetId);
  } catch(e) {
    console.error('[WebRTC] makeOffer failed:', e);
    App.showToast('❌ Failed to start call: ' + e.message);
    throw e;
  }
}

// ── 1-to-1: Handle offer, send answer ────────────────────
async function handleOffer({ callId, offer, fromId }) {
  console.log('[WebRTC] Handling offer from', fromId);
  try {
    await startLocalAudio();
    await createPeerConnection(fromId, callId);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    console.log('[WebRTC] Set remote description (offer)');
    await flushPendingIceCandidates();

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    console.log('[WebRTC] Set local description (answer)');

    SocketClient.getSocket()?.emit('webrtc-answer', { callId, answer, targetId: fromId });
    console.log('[WebRTC] Answer sent to', fromId);
  } catch(e) {
    console.error('[WebRTC] handleOffer failed:', e);
    App.showToast('❌ Failed to answer call: ' + e.message);
    throw e;
  }
}

// ── 1-to-1: Handle answer ─────────────────────────────────
async function handleAnswer({ answer, fromId }) {
  console.log('[WebRTC] Handling answer from', fromId);
  if (!pc) { console.error('[WebRTC] No peer connection when handling answer!'); return; }
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    await flushPendingIceCandidates();
  } catch(e) {
    console.error('[WebRTC] handleAnswer failed:', e);
  }
}

// ── 1-to-1: ICE candidate ─────────────────────────────────
async function handleIce({ candidate, fromId }) {
  if (!candidate) return;
  if (pc && pc.remoteDescription && pc.remoteDescription.type) {
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
    catch(e) { console.warn('[WebRTC] handleIce failed:', e.message); }
  } else {
    console.log('[WebRTC] Queuing ICE candidate');
    pendingCandidates.push(candidate);
  }
}

async function flushPendingIceCandidates() {
  if (!pc || !pc.remoteDescription) return;
  while (pendingCandidates.length > 0) {
    const cand = pendingCandidates.shift();
    try { await pc.addIceCandidate(new RTCIceCandidate(cand)); }
    catch(e) { console.warn('[WebRTC] Failed to add queued ICE candidate:', e.message); }
  }
}

// ── CONFERENCE: Create peer connection to one member ──────
async function createConferencePeer(peerId, roomId, isInitiator) {
  if (peerConnections.has(peerId)) {
    console.warn('[Conf] Peer connection already exists for', peerId);
    return peerConnections.get(peerId).pc;
  }

  const iceConfig = await getIceServers();
  const confPc = new RTCPeerConnection(iceConfig);
  const pending = [];
  peerConnections.set(peerId, { pc: confPc, pending });

  // Add local stream
  if (localStream) {
    localStream.getTracks().forEach(track => confPc.addTrack(track, localStream));
  }

  // Remote audio per peer
  confPc.ontrack = (e) => {
    console.log('[Conf] Got remote track from', peerId);
    const audio = createRemoteAudio(`conf-${peerId}`);
    audio.srcObject = e.streams[0] || new MediaStream([e.track]);
    audio.play().catch(() => {
      document.addEventListener('click', () => audio.play(), { once: true });
    });
    // Notify conference UI
    window.ConferenceUI?.onPeerAudioActive(peerId);
  };

  confPc.onicecandidate = (e) => {
    if (e.candidate) {
      SocketClient.getSocket()?.emit('conf-ice', {
        roomId,
        candidate: e.candidate,
        targetId: peerId,
      });
    }
  };

  confPc.onconnectionstatechange = () => {
    console.log(`[Conf] Peer ${peerId} connection state:`, confPc.connectionState);
    if (confPc.connectionState === 'failed') {
      window.ConferenceUI?.onPeerDisconnected(peerId);
      removeConferencePeer(peerId);
    }
  };

  // Initiator sends the offer to the new peer
  if (isInitiator) {
    const offer = await confPc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
    await confPc.setLocalDescription(offer);
    SocketClient.getSocket()?.emit('conf-offer', { roomId, offer, targetId: peerId });
    console.log('[Conf] Offer sent to', peerId);
  }

  return confPc;
}

// ── CONFERENCE: Handle incoming offer from peer ───────────
async function handleConfOffer({ roomId, offer, fromId }) {
  console.log('[Conf] Handling offer from', fromId);
  await startLocalAudio();
  const confPc = await createConferencePeer(fromId, roomId, false);
  await confPc.setRemoteDescription(new RTCSessionDescription(offer));

  // Flush pending ICE candidates
  const entry = peerConnections.get(fromId);
  if (entry) {
    while (entry.pending.length > 0) {
      const c = entry.pending.shift();
      try { await confPc.addIceCandidate(new RTCIceCandidate(c)); } catch(e) {}
    }
  }

  const answer = await confPc.createAnswer();
  await confPc.setLocalDescription(answer);
  SocketClient.getSocket()?.emit('conf-answer', { roomId, answer, targetId: fromId });
  console.log('[Conf] Answer sent to', fromId);
}

// ── CONFERENCE: Handle answer ─────────────────────────────
async function handleConfAnswer({ roomId, answer, fromId }) {
  const entry = peerConnections.get(fromId);
  if (!entry) return;
  await entry.pc.setRemoteDescription(new RTCSessionDescription(answer));
  // Flush pending
  while (entry.pending.length > 0) {
    const c = entry.pending.shift();
    try { await entry.pc.addIceCandidate(new RTCIceCandidate(c)); } catch(e) {}
  }
}

// ── CONFERENCE: Handle ICE candidate ─────────────────────
async function handleConfIce({ roomId, candidate, fromId }) {
  if (!candidate) return;
  const entry = peerConnections.get(fromId);
  if (!entry) return;
  if (entry.pc.remoteDescription && entry.pc.remoteDescription.type) {
    try { await entry.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(e) {}
  } else {
    entry.pending.push(candidate);
  }
}

// ── CONFERENCE: Remove one peer connection ────────────────
function removeConferencePeer(peerId) {
  const entry = peerConnections.get(peerId);
  if (entry) {
    entry.pc.close();
    peerConnections.delete(peerId);
  }
  // Remove audio element
  const audio = document.getElementById(`remote-audio-conf-${peerId}`);
  if (audio) { audio.srcObject = null; audio.remove(); }
}

// ── CONFERENCE: Close all peer connections ────────────────
function closeAllConferencePeers() {
  for (const [peerId] of peerConnections) {
    removeConferencePeer(peerId);
  }
  peerConnections.clear();
  currentRoomId = null;
}

// ── Mute toggle ───────────────────────────────────────────
function toggleMute() {
  isMuted = !isMuted;
  if (localStream) {
    localStream.getAudioTracks().forEach(t => {
      t.enabled = !isMuted;
    });
  }
  // Notify in 1-to-1 call
  if (currentCallId) {
    SocketClient.getSocket()?.emit('mute-toggle', {
      callId:   currentCallId,
      muted:    isMuted,
      targetId: currentTarget,
    });
  }
  // Notify in conference
  if (currentRoomId) {
    SocketClient.getSocket()?.emit('conf-mute', { roomId: currentRoomId, muted: isMuted });
  }
  return isMuted;
}

// ── Speaker toggle ────────────────────────────────────────
let _speakerOn = false;
async function toggleSpeaker() {
  _speakerOn = !_speakerOn;
  // Toggle all active remote audio elements
  const audioEls = document.querySelectorAll('audio[id^="remote-audio"]');
  for (const audio of audioEls) {
    await setAudioOutput(audio.id, _speakerOn);
    // Fallback: also set volume/muted for browsers without setSinkId
    audio.muted = false;
  }
  return _speakerOn;
}

// ── Duration ──────────────────────────────────────────────
function getCallDuration() {
  return callStartTime ? Math.floor((Date.now() - callStartTime) / 1000) : 0;
}

// ── 1-to-1 Cleanup ───────────────────────────────────────
function closePeerConnection() {
  console.log('[WebRTC] Closing peer connection');

  if (Settings.getSetting('recording', false)) {
    const { user } = AuthUI.getSession();
    Settings.stopRecording(user?.username || 'call');
  }

  if (pc) { pc.close(); pc = null; }

  stopLocalAudio();

  callStartTime     = null;
  isMuted           = false;
  _speakerOn        = false;
  currentCallId     = null;
  currentTarget     = null;
  pendingCandidates = [];

  // Remove 1-to-1 audio element
  const audio = document.getElementById('remote-audio-1to1');
  if (audio) { audio.srcObject = null; audio.remove(); }

  console.log('[WebRTC] Cleanup complete');
}

window.WebRTC = {
  // 1-to-1
  makeOffer,
  handleOffer,
  handleAnswer,
  handleIce,
  closePeerConnection,
  // Conference
  createConferencePeer,
  handleConfOffer,
  handleConfAnswer,
  handleConfIce,
  removeConferencePeer,
  closeAllConferencePeers,
  // Shared
  startLocalAudio,
  stopLocalAudio,
  toggleMute,
  toggleSpeaker,
  getCallDuration,
  // State getters
  get currentRoomId() { return currentRoomId; },
  set currentRoomId(v) { currentRoomId = v; },
  get peerConnections() { return peerConnections; },
};