let _dialingAudio  = null;
let _callTimer     = null;
let _callSeconds   = 0;
let _currentCallId = null;
let _currentCallee = null;

async function startCall(calleeId, calleeName, calleeAvatar) {
  _currentCallee = { id: calleeId, name: calleeName, avatar: calleeAvatar };

  // Request mic BEFORE showing calling screen
  // This ensures permission dialog appears naturally
  try {
    await WebRTC.startLocalAudio();
    console.log('[Call] Mic ready');
  } catch(e) {
    App.showToast('❌ Cannot start call without microphone');
    return; // Don't proceed if no mic
  }

  showCallingScreen(calleeName, calleeAvatar);
  playDialingTone();
  SocketClient.getSocket()?.emit('call-user', { calleeId });
}

function showCallingScreen(name, avatar) {
  App.showScreen('screen-calling');
  document.getElementById('screen-calling').innerHTML = `
    <div class="call-screen-wrap">
      <div class="call-screen-status">Calling…</div>
      <div class="call-big-avatar">${avatar}</div>
      <div class="call-name">${esc(name)}</div>
      <div class="call-substatus" id="call-substatus">Ringing…</div>
      <div class="call-actions">
        <button class="call-end-btn" onclick="CallHandler.cancelCall()">📵</button>
      </div>
    </div>`;
}

function showInProgressScreen(name, avatar, callId) {
  _currentCallId = callId;
  _callSeconds   = 0;
  App.showScreen('screen-in-call');
  document.getElementById('screen-in-call').innerHTML = `
    <div class="call-screen-wrap">
      <div class="call-screen-status connected">In Call</div>
      <div class="call-big-avatar speaking-ring" id="call-avatar">${avatar}</div>
      <div class="call-name">${esc(name)}</div>
      <div class="call-substatus" id="call-timer">Connecting…</div>
      <div class="call-controls-row">
        <div class="ctrl-wrap">
          <button class="ctrl-circle" id="btn-mute"
                  onclick="CallHandler.toggleMute()">🎙️</button>
          <span class="ctrl-label">Mute</span>
        </div>
        <div class="ctrl-wrap">
          <button class="ctrl-circle ctrl-end"
                  onclick="CallHandler.endCall()">📵</button>
          <span class="ctrl-label">End</span>
        </div>
        <div class="ctrl-wrap">
          <button class="ctrl-circle" id="btn-speaker"
                  onclick="CallHandler.toggleSpeaker()">🔈</button>
          <span class="ctrl-label">Speaker</span>
        </div>
        <div class="ctrl-wrap">
          <button class="ctrl-circle" id="btn-conference"
                  onclick="window.ConferenceUI && ConferenceUI.startFromActiveCall()">👥</button>
          <span class="ctrl-label">Group</span>
        </div>
      </div>
    </div>`;
  startCallTimer();
}

function startCallTimer() {
  stopCallTimer();
  _callTimer = setInterval(() => {
    _callSeconds++;
    const m = String(Math.floor(_callSeconds / 60)).padStart(2,'0');
    const s = String(_callSeconds % 60).padStart(2,'0');
    const el = document.getElementById('call-timer');
    if (el) el.textContent = `${m}:${s}`;
  }, 1000);
}

function stopCallTimer() {
  if (_callTimer) { clearInterval(_callTimer); _callTimer = null; }
}

let _synthDialInterval = null;

function playDialingTone() {
  stopDialingTone();
  if ('vibrate' in navigator) {
    try { navigator.vibrate([100, 200, 100]); } catch(e) {}
  }
  try {
    _dialingAudio = new Audio('/audio/dialing.mp3');
    _dialingAudio.loop   = true;
    _dialingAudio.volume = 0.4;
    _dialingAudio.play().catch(() => playSynthDialTone());
  } catch(e) {
    playSynthDialTone();
  }
}

function playSynthDialTone() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    const ctx = new AC();
    const pulse = () => {
      try {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc1.frequency.value = 440;
        osc2.frequency.value = 480;
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.8);
        osc1.connect(gain); osc2.connect(gain); gain.connect(ctx.destination);
        osc1.start(); osc2.start();
        osc1.stop(ctx.currentTime + 1.8); osc2.stop(ctx.currentTime + 1.8);
      } catch(e) {}
    };
    pulse();
    _synthDialInterval = setInterval(pulse, 3000);
  } catch(e) {}
}

function stopDialingTone() {
  if (_dialingAudio) {
    _dialingAudio.pause();
    _dialingAudio.currentTime = 0;
    _dialingAudio = null;
  }
  if (_synthDialInterval) {
    clearInterval(_synthDialInterval);
    _synthDialInterval = null;
  }
}

function onCallRinging({ callId }) {
  _currentCallId = callId;
  const sub = document.getElementById('call-substatus');
  if (sub) sub.textContent = 'Ringing…';
}

// Caller side: callee accepted → now send WebRTC offer
function onCallAccepted({ callId, calleeId }) {
  stopDialingTone();
  _currentCallId = callId;
  const name   = _currentCallee?.name || _currentCallee?.username || 'Unknown';
  const avatar = _currentCallee?.avatar || '👤';

  // Immediately switch to in-call screen — stops ringing UI
  showInProgressScreen(name, avatar, callId);

  setTimeout(async () => {
    try {
      await WebRTC.makeOffer(calleeId, callId);
    } catch(e) {
      console.error('[Call] makeOffer failed:', e);
      App.showToast('❌ Failed to connect audio');
    }
  }, 500);
}

function onCallDeclined() {
  stopDialingTone();
  stopCallTimer();
  showCallResult('Call Declined', '❌');
}

function onCallMissed() {
  stopDialingTone();
  stopCallTimer();
  showCallResult('No Answer', '📵');
}

function onCallEnded({ duration }) {
  stopDialingTone();
  stopCallTimer();
  WebRTC.closePeerConnection();
  const dur = duration
    ? `${Math.floor(duration/60)}:${String(duration%60).padStart(2,'0')}` : '';
  showCallResult('Call Ended', '✅', dur);
}

function showCallResult(label, icon, sub = '') {
  App.showScreen('screen-calling');
  document.getElementById('screen-calling').innerHTML = `
    <div class="call-screen-wrap">
      <div class="call-result-icon">${icon}</div>
      <div class="call-name">${label}</div>
      ${sub ? `<div class="call-substatus">Duration: ${sub}</div>` : ''}
      <button class="btn-primary" style="margin-top:32px;width:160px"
              onclick="App.showScreen('screen-home')">Back</button>
    </div>`;
  setTimeout(() => App.showScreen('screen-home'), 4000);
}

function toggleMute() {
  const muted = WebRTC.toggleMute();
  const btn = document.getElementById('btn-mute');
  if (btn) {
    btn.textContent = muted ? '🔇' : '🎙️';
    btn.classList.toggle('ctrl-active', muted);
  }
  App.showToast(muted ? '🔇 Muted' : '🎙️ Unmuted');
}

async function toggleSpeaker() {
  const speakerOn = await WebRTC.toggleSpeaker();
  const btn = document.getElementById('btn-speaker');
  if (btn) {
    btn.textContent = speakerOn ? '🔊' : '🔈';
    btn.classList.toggle('ctrl-active', speakerOn);
  }
  App.showToast(speakerOn ? '🔊 Loudspeaker ON' : '🔈 Earpiece mode');
}

function cancelCall() {
  stopDialingTone();
  if (_currentCallId)
    SocketClient.getSocket()?.emit('call-cancelled', { callId: _currentCallId });
  _currentCallId = null;
  _currentCallee = null;
  App.showScreen('screen-home');
}

function endCall() {
  stopCallTimer();
  if (_currentCallId)
    SocketClient.getSocket()?.emit('call-ended', { callId: _currentCallId });
  WebRTC.closePeerConnection();
  _currentCallId = null;
  App.showScreen('screen-home');
}

function onPeerMuted({ muted }) {
  App.showToast(muted ? '🔇 Other person muted' : '🎙️ Other person unmuted');
}

function onCallConnected() {
  const timer = document.getElementById('call-timer');
  if (timer) timer.textContent = '00:00';
  _callSeconds = 0;
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;');
}

window.CallUI     = { onCallConnected, onCallEnded };
window.CallHandler = {
  startCall, showInProgressScreen,
  cancelCall, endCall,
  toggleMute, toggleSpeaker,
  onCallRinging, onCallAccepted,
  onCallDeclined, onCallMissed,
  onCallEnded, onPeerMuted,
};