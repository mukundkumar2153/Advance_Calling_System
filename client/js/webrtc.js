// ── ICE Config — fetched from server (TURN + STUN for NAT traversal) ──────────
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
    console.warn('[WebRTC] Could not load ICE servers, using fallback STUN+TURN');
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
        {
          urls: 'turn:relay1.expressturn.com:3478',
          username:   'efYSB0SXK0GLCMUDOL',
          credential: 'eSbxQkSUwdv2THBT',
        },
      ],
    };
    return _iceServers;
  }
}

// ── Shared State ──────────────────────────────────────────
let localStream       = null;
let isMuted           = false;
let _speakerOn        = false;
let callStartTime     = null;

// ── 1-to-1 call state ────────────────────────────────────
let pc                = null;
let currentCallId     = null;
let currentTarget     = null;
let pendingCandidates = [];   // for 1-to-1

// ── Conference mesh state ─────────────────────────────────
// Map<userId, { pc: RTCPeerConnection, pending: RTCIceCandidate[] }>
const peerConnections = new Map();
let currentRoomId     = null;

// BUG FIX: ICE candidates that arrive BEFORE the peer connection is created
// were silently dropped. This map queues them so they are applied once PC is ready.
const preQueuedConfCandidates = new Map(); // Map<peerId, RTCIceCandidate[]>

// ── Get microphone ────────────────────────────────────────
async function startLocalAudio() {
  // Reuse active stream
  if (localStream && localStream.active && localStream.getAudioTracks().length > 0) {
    console.log('[WebRTC] Reusing existing local stream');
    return localStream;
  }

  // If old stream is inactive, clean it up
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  // Unlock AudioContext on mobile — must be within user gesture context
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      const ctx = new AC();
      if (ctx.state === 'suspended') await ctx.resume();
      ctx.close();
    }
  } catch(e) {}

  try {
    // Try high-quality first
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl:  true,
        sampleRate:       48000,
      },
      video: false,
    });
  } catch(firstErr) {
    console.warn('[WebRTC] High-quality getUserMedia failed, trying basic:', firstErr.name);
    try {
      // Fallback: basic audio constraints (more compatible with older devices)
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch(e) {
      console.error('[WebRTC] Microphone error:', e.name, e.message);
      _showMicError(e);
      throw e;
    }
  }

  // Apply mute state to new tracks
  localStream.getAudioTracks().forEach(t => {
    t.enabled = !isMuted;
    console.log('[WebRTC] Got audio track:', t.label, '| enabled:', t.enabled);
  });

  return localStream;
}

function _showMicError(e) {
  let msg;
  if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
    msg = '🎤 Mic blocked! Open browser Settings → Site Settings → Allow Microphone';
  } else if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
    msg = '🎤 No microphone found on this device';
  } else if (e.name === 'NotReadableError' || e.name === 'TrackStartError') {
    msg = '🎤 Mic is busy (used by another app) — close it and retry';
  } else if (e.name === 'OverconstrainedError') {
    msg = '🎤 Mic does not support required audio format';
  } else {
    msg = '🎤 Mic error: ' + (e.message || e.name);
  }
  App.showToast(msg, 6000);
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

// ── Audio element manager ─────────────────────────────────
// Creates (or reuses) an <audio> element per peer, handles autoplay reliably
function createRemoteAudio(peerId) {
  const elemId = `remote-audio-${peerId}`;
  let audio = document.getElementById(elemId);
  if (!audio) {
    audio = document.createElement('audio');
    audio.id         = elemId;
    audio.autoplay   = true;
    audio.controls   = false;
    audio.setAttribute('playsinline', '');       // iOS Safari
    audio.setAttribute('webkit-playsinline', '');// Old iOS
    document.body.appendChild(audio);
    console.log('[WebRTC] Created audio element:', elemId);
  }
  return audio;
}

function _attachStreamToAudio(audio, stream) {
  audio.srcObject = stream;
  // Try to play, show unlock button if blocked
  const playPromise = audio.play();
  if (playPromise !== undefined) {
    playPromise.catch(err => {
      console.warn('[WebRTC] Audio autoplay blocked:', err.name, '— showing unlock UI');
      _showAudioUnlockButton();
    });
  }
}

// Show a floating "tap to hear" button if autoplay is blocked
function _showAudioUnlockButton() {
  if (document.getElementById('audio-unlock-btn')) return; // Already shown
  const btn = document.createElement('button');
  btn.id = 'audio-unlock-btn';
  btn.className = 'audio-unlock-btn';
  btn.innerHTML = '🔊 Tap to hear audio';
  btn.onclick = () => {
    // Play all blocked audio elements
    document.querySelectorAll('audio[id^="remote-audio"]').forEach(a => {
      a.muted = false;
      a.play().catch(() => {});
    });
    btn.remove();
  };
  document.body.appendChild(btn);
}

// ── 1-to-1: Create peer connection ───────────────────────
async function createPeerConnection(targetId, callId) {
  if (pc) {
    console.warn('[WebRTC] Closing existing 1-to-1 peer connection');
    pc.close();
    pc = null;
  }

  currentTarget     = targetId;
  currentCallId     = callId;
  pendingCandidates = [];

  const iceConfig = await getIceServers();
  pc = new RTCPeerConnection(iceConfig);
  console.log('[WebRTC] Created 1-to-1 PC with', iceConfig.iceServers.length, 'ICE servers');

  // Add local tracks — CRITICAL: localStream must be set before calling this
  if (localStream && localStream.active) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
      console.log('[WebRTC] Added local track:', track.kind);
    });
  } else {
    console.error('[WebRTC] WARNING: localStream is null/inactive when creating PC!');
  }

  pc.ontrack = (e) => {
    console.log('[WebRTC] Received 1-to-1 remote track:', e.track.kind);
    const audio = createRemoteAudio('1to1');
    const stream = e.streams?.[0] || new MediaStream([e.track]);
    _attachStreamToAudio(audio, stream);
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      SocketClient.getSocket()?.emit('webrtc-ice', { callId, candidate: e.candidate, targetId });
    }
  };

  pc.onicecandidateerror = (e) => {
    if (e.errorCode !== 701) // 701 = normal STUN gather error
      console.warn('[WebRTC] ICE error:', e.errorCode, e.errorText);
  };

  pc.onconnectionstatechange = () => {
    console.log('[WebRTC] 1-to-1 connection state:', pc?.connectionState);
    if (!pc) return;
    if (pc.connectionState === 'connected') {
      callStartTime = Date.now();
      window.CallUI?.onCallConnected();
      App.showToast('✅ Call connected');
      if (localStream && Settings.getSetting?.('recording', false)) {
        Settings.startRecording?.(localStream);
      }
    }
    if (pc.connectionState === 'failed') {
      App.showToast('❌ Call connection failed — check your network');
      window.CallUI?.onCallEnded();
    }
    if (['disconnected', 'closed'].includes(pc.connectionState)) {
      window.CallUI?.onCallEnded();
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log('[WebRTC] 1-to-1 ICE state:', pc?.iceConnectionState);
  };

  return pc;
}

// ── 1-to-1: Make offer ────────────────────────────────────
async function makeOffer(targetId, callId) {
  console.log('[WebRTC] Making offer to', targetId);
  try {
    // MUST get mic first, THEN create PC (so tracks are ready)
    await startLocalAudio();
    await createPeerConnection(targetId, callId);

    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
    await pc.setLocalDescription(offer);
    console.log('[WebRTC] Offer created and set as local description');

    SocketClient.getSocket()?.emit('webrtc-offer', { callId, offer, targetId });
    console.log('[WebRTC] Offer sent to', targetId);
  } catch(e) {
    console.error('[WebRTC] makeOffer failed:', e);
    App.showToast('❌ Failed to start call: ' + e.message);
    throw e;
  }
}

// ── 1-to-1: Handle incoming offer ────────────────────────
async function handleOffer({ callId, offer, fromId }) {
  console.log('[WebRTC] Handling offer from', fromId);
  try {
    await startLocalAudio(); // Get mic FIRST
    await createPeerConnection(fromId, callId);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    console.log('[WebRTC] Remote description (offer) set');
    await _flush1to1Pending();

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
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
  if (!pc) { console.error('[WebRTC] No 1-to-1 PC when handling answer!'); return; }
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    console.log('[WebRTC] Remote description (answer) set');
    await _flush1to1Pending();
  } catch(e) { console.error('[WebRTC] handleAnswer failed:', e); }
}

// ── 1-to-1: Handle ICE candidate ─────────────────────────
async function handleIce({ candidate }) {
  if (!candidate) return;
  if (pc && pc.remoteDescription?.type) {
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
    catch(e) { console.warn('[WebRTC] addIceCandidate failed:', e.message); }
  } else {
    pendingCandidates.push(candidate);
  }
}

async function _flush1to1Pending() {
  if (!pc || !pc.remoteDescription) return;
  while (pendingCandidates.length > 0) {
    const cand = pendingCandidates.shift();
    try { await pc.addIceCandidate(new RTCIceCandidate(cand)); }
    catch(e) { console.warn('[WebRTC] flush 1-to-1 candidate failed:', e.message); }
  }
}

// ── CONFERENCE: Create or get peer connection ─────────────
async function createConferencePeer(peerId, roomId, isInitiator) {
  // If connection already exists and is healthy, don't recreate
  const existing = peerConnections.get(peerId);
  if (existing && existing.pc.connectionState !== 'closed' &&
      existing.pc.connectionState !== 'failed') {
    console.warn('[Conf] Peer connection already exists for', peerId, '— reusing');
    return existing.pc;
  }

  // Close stale connection if any
  if (existing) { existing.pc.close(); peerConnections.delete(peerId); }

  const iceConfig = await getIceServers();
  const confPc = new RTCPeerConnection(iceConfig);
  const pending = [];
  peerConnections.set(peerId, { pc: confPc, pending });
  console.log('[Conf] Created peer connection to', peerId, 'initiator:', isInitiator);

  // CRITICAL: localStream MUST be set before this point
  // Caller (handleConfOffer / onConfJoined) must call startLocalAudio() first
  if (localStream && localStream.active) {
    localStream.getTracks().forEach(track => {
      confPc.addTrack(track, localStream);
      console.log('[Conf] Added local track to peer', peerId, ':', track.kind);
    });
  } else {
    console.error('[Conf] WARNING: localStream null when creating conf peer to', peerId);
  }

  // Remote audio — each peer gets its own <audio> element
  confPc.ontrack = (e) => {
    console.log('[Conf] Got remote track from', peerId, ':', e.track.kind);
    const audio = createRemoteAudio(`conf-${peerId}`);
    const stream = e.streams?.[0] || new MediaStream([e.track]);
    _attachStreamToAudio(audio, stream);
    window.ConferenceUI?.onPeerAudioActive?.(peerId);
  };

  confPc.onicecandidate = (e) => {
    if (e.candidate) {
      SocketClient.getSocket()?.emit('conf-ice', {
        roomId, candidate: e.candidate, targetId: peerId,
      });
    }
  };

  confPc.onicecandidateerror = (e) => {
    if (e.errorCode !== 701)
      console.warn('[Conf] ICE error to', peerId, ':', e.errorCode, e.errorText);
  };

  confPc.onconnectionstatechange = () => {
    const state = confPc.connectionState;
    console.log(`[Conf] Peer ${peerId} connection state: ${state}`);
    if (state === 'connected') {
      console.log('[Conf] ✅ Audio connected to', peerId);
      window.ConferenceUI?.onPeerConnected?.(peerId);
    }
    if (state === 'failed') {
      console.warn('[Conf] ❌ Connection failed to', peerId);
      window.ConferenceUI?.onPeerDisconnected?.(peerId);
      removeConferencePeer(peerId);
    }
  };

  confPc.oniceconnectionstatechange = () => {
    console.log(`[Conf] ICE state to ${peerId}: ${confPc.iceConnectionState}`);
  };

  // BUG FIX: Apply any ICE candidates that arrived BEFORE this PC was created
  const preQueued = preQueuedConfCandidates.get(peerId);
  if (preQueued && preQueued.length > 0) {
    console.log(`[Conf] Flushing ${preQueued.length} pre-queued ICE candidates for`, peerId);
    // Push to pending — they will be applied after setRemoteDescription
    pending.push(...preQueued);
    preQueuedConfCandidates.delete(peerId);
  }

  // If we are initiator, send the offer now
  if (isInitiator) {
    try {
      const offer = await confPc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
      await confPc.setLocalDescription(offer);
      SocketClient.getSocket()?.emit('conf-offer', { roomId, offer, targetId: peerId });
      console.log('[Conf] Offer sent to', peerId);
    } catch(err) {
      console.error('[Conf] Failed to create/send offer to', peerId, ':', err);
    }
  }

  return confPc;
}

// ── CONFERENCE: Handle incoming offer ────────────────────
async function handleConfOffer({ roomId, offer, fromId }) {
  console.log('[Conf] Handling offer from', fromId);
  try {
    // MUST get local audio BEFORE creating peer connection
    await startLocalAudio();

    const confPc = await createConferencePeer(fromId, roomId, false /* not initiator */);
    await confPc.setRemoteDescription(new RTCSessionDescription(offer));
    console.log('[Conf] Remote description (offer) set for', fromId);

    // Flush pending ICE candidates now that remote description is set
    await _flushConfPending(fromId, confPc);

    const answer = await confPc.createAnswer();
    await confPc.setLocalDescription(answer);
    SocketClient.getSocket()?.emit('conf-answer', { roomId, answer, targetId: fromId });
    console.log('[Conf] Answer sent to', fromId);
  } catch(e) {
    console.error('[Conf] handleConfOffer failed:', e);
    App.showToast('⚠️ Conference connection issue with ' + fromId);
  }
}

// ── CONFERENCE: Handle answer ─────────────────────────────
async function handleConfAnswer({ roomId, answer, fromId }) {
  const entry = peerConnections.get(fromId);
  if (!entry) {
    console.warn('[Conf] Got answer from', fromId, 'but no peer connection!');
    return;
  }
  try {
    await entry.pc.setRemoteDescription(new RTCSessionDescription(answer));
    console.log('[Conf] Remote description (answer) set for', fromId);
    await _flushConfPending(fromId, entry.pc);
  } catch(e) {
    console.error('[Conf] handleConfAnswer failed for', fromId, ':', e);
  }
}

// ── CONFERENCE: Handle ICE candidate ─────────────────────
// BUG FIX: Previously candidates arriving before PC was created were dropped.
// Now they are queued in preQueuedConfCandidates until PC is ready.
async function handleConfIce({ candidate, fromId }) {
  if (!candidate) return;
  const entry = peerConnections.get(fromId);

  if (!entry) {
    // PC not created yet — queue the candidate
    if (!preQueuedConfCandidates.has(fromId)) preQueuedConfCandidates.set(fromId, []);
    preQueuedConfCandidates.get(fromId).push(candidate);
    console.log('[Conf] Pre-queued ICE candidate for', fromId, '(PC not ready yet)');
    return;
  }

  if (entry.pc.remoteDescription?.type) {
    try { await entry.pc.addIceCandidate(new RTCIceCandidate(candidate)); }
    catch(e) { console.warn('[Conf] addIceCandidate failed for', fromId, ':', e.message); }
  } else {
    entry.pending.push(candidate);
    console.log('[Conf] Queued ICE candidate for', fromId, '(no remote desc yet)');
  }
}

// ── CONFERENCE: Flush pending ICE candidates ──────────────
async function _flushConfPending(peerId, confPc) {
  const entry = peerConnections.get(peerId);
  if (!entry || !confPc.remoteDescription) return;
  while (entry.pending.length > 0) {
    const cand = entry.pending.shift();
    try { await confPc.addIceCandidate(new RTCIceCandidate(cand)); }
    catch(e) { console.warn('[Conf] flush candidate failed for', peerId, ':', e.message); }
  }
}

// ── CONFERENCE: Remove one peer's connection ──────────────
function removeConferencePeer(peerId) {
  const entry = peerConnections.get(peerId);
  if (entry) {
    try { entry.pc.close(); } catch(e) {}
    peerConnections.delete(peerId);
  }
  preQueuedConfCandidates.delete(peerId);
  // Remove audio element for this peer
  const audio = document.getElementById(`remote-audio-conf-${peerId}`);
  if (audio) { audio.srcObject = null; audio.remove(); }
  console.log('[Conf] Removed peer', peerId);
}

// ── CONFERENCE: Close all conference connections ──────────
function closeAllConferencePeers() {
  for (const [peerId] of peerConnections) {
    removeConferencePeer(peerId);
  }
  peerConnections.clear();
  preQueuedConfCandidates.clear();
  currentRoomId = null;
  console.log('[Conf] All peers closed');
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
  // 1-to-1 notify
  if (currentCallId) {
    SocketClient.getSocket()?.emit('mute-toggle', {
      callId: currentCallId, muted: isMuted, targetId: currentTarget,
    });
  }
  // Conference notify
  if (currentRoomId) {
    SocketClient.getSocket()?.emit('conf-mute', { roomId: currentRoomId, muted: isMuted });
  }
  return isMuted;
}

// ── Speaker toggle (loudspeaker vs earpiece) ──────────────
async function toggleSpeaker() {
  _speakerOn = !_speakerOn;
  const audioEls = document.querySelectorAll('audio[id^="remote-audio"]');
  for (const audio of audioEls) {
    // setSinkId: '' = earpiece/default, 'default' = loudspeaker
    if (typeof audio.setSinkId === 'function') {
      try {
        await audio.setSinkId(_speakerOn ? 'default' : '');
      } catch(e) {
        console.warn('[WebRTC] setSinkId error:', e.message);
      }
    }
    // Ensure audio is playing and not muted
    audio.muted = false;
    audio.play().catch(() => {});
  }
  console.log('[WebRTC] Speaker:', _speakerOn ? 'LOUDSPEAKER' : 'EARPIECE');
  return _speakerOn;
}

// ── Unlock all audio (call after user gesture) ───────────
function unlockAllAudio() {
  const btn = document.getElementById('audio-unlock-btn');
  if (btn) btn.remove();
  document.querySelectorAll('audio[id^="remote-audio"]').forEach(a => {
    a.muted = false;
    a.play().catch(() => {});
  });
}

// ── Get call duration ─────────────────────────────────────
function getCallDuration() {
  return callStartTime ? Math.floor((Date.now() - callStartTime) / 1000) : 0;
}

// ── 1-to-1 cleanup ────────────────────────────────────────
function closePeerConnection() {
  console.log('[WebRTC] Closing 1-to-1 peer connection');

  try {
    if (Settings.getSetting?.('recording', false)) {
      const { user } = AuthUI.getSession?.() || {};
      Settings.stopRecording?.(user?.username || 'call');
    }
  } catch(e) {}

  if (pc) { try { pc.close(); } catch(e) {} pc = null; }

  stopLocalAudio();

  callStartTime     = null;
  isMuted           = false;
  _speakerOn        = false;
  currentCallId     = null;
  currentTarget     = null;
  pendingCandidates = [];

  const audio = document.getElementById('remote-audio-1to1');
  if (audio) { audio.srcObject = null; audio.remove(); }

  console.log('[WebRTC] 1-to-1 cleanup complete');
}

// ── Export ────────────────────────────────────────────────
window.WebRTC = {
  // 1-to-1
  makeOffer,
  handleOffer,
  handleAnswer,
  handleIce,
  closePeerConnection,
  // Conference mesh
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
  unlockAllAudio,
  getCallDuration,
  // State getters/setters
  get currentRoomId()  { return currentRoomId; },
  set currentRoomId(v) { currentRoomId = v; },
  get peerConnections() { return peerConnections; },
  get isMuted() { return isMuted; },
};