let _ringtoneAudio  = null;
let _incomingCallId = null;
let _incomingCaller = null;

function showIncomingCall({ callId, caller }) {
  _incomingCallId = callId;
  _incomingCaller = caller;
  playRingtone();

  const animClass = Settings.getAnimationClass();
  App.showScreen('screen-incoming');
  document.getElementById('screen-incoming').innerHTML = `
    <div class="incoming-wrap ${animClass}">
      <div class="incoming-label">Incoming Call</div>
      <div class="pulse-ring">
        <div class="incoming-avatar">${caller.avatar}</div>
      </div>
      <div class="incoming-name">${esc(caller.username)}</div>
      <div class="incoming-sub">RingUp Voice Call</div>
      <div class="incoming-actions">
        <div class="inc-btn-wrap">
          <button class="inc-btn inc-decline" onclick="IncomingCall.decline()">📵</button>
          <span class="inc-btn-label">Decline</span>
        </div>
        <div class="inc-btn-wrap">
          <button class="inc-btn inc-accept" onclick="IncomingCall.accept()">📞</button>
          <span class="inc-btn-label">Accept</span>
        </div>
      </div>
    </div>`;
}

let _synthRingInterval = null;

function playRingtone() {
  stopRingtone();
  if ('vibrate' in navigator) {
    try { navigator.vibrate([300, 100, 300, 100, 500, 100, 300]); } catch(e) {}
  }
  const file = Settings.getRingtoneFile();
  try {
    _ringtoneAudio = new Audio(file);
    _ringtoneAudio.loop   = true;
    _ringtoneAudio.volume = 1.0;
    _ringtoneAudio.play().catch(() => {
      _ringtoneAudio = new Audio('/audio/ringtone.mp3');
      _ringtoneAudio.loop = true;
      _ringtoneAudio.play().catch(() => playSynthRingtone());
    });
  } catch(e) {
    playSynthRingtone();
  }
}

function playSynthRingtone() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    const ctx = new AC();
    const pulse = () => {
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime);
        osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.2);
        osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.4);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.5);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(); osc.stop(ctx.currentTime + 1.5);
      } catch(e) {}
    };
    pulse();
    _synthRingInterval = setInterval(pulse, 2000);
  } catch(e) {}
}

function stopRingtone() {
  if (_ringtoneAudio) {
    _ringtoneAudio.pause();
    _ringtoneAudio.currentTime = 0;
    _ringtoneAudio = null;
  }
  if (_synthRingInterval) {
    clearInterval(_synthRingInterval);
    _synthRingInterval = null;
  }
}

async function accept() {
  stopRingtone();
  const callId = _incomingCallId;
  const caller = _incomingCaller;
  if (!callId || !caller) return;
  CallHandler.showInProgressScreen(caller.username, caller.avatar, callId);
  SocketClient.getSocket()?.emit('call-accepted', { callId });
  _incomingCallId = null;
  _incomingCaller = null;
}

function decline() {
  stopRingtone();
  if (_incomingCallId)
    SocketClient.getSocket()?.emit('call-declined', { callId: _incomingCallId });
  _incomingCallId = null;
  _incomingCaller = null;
  App.showScreen('screen-home');
}

function cancelledByRemote() {
  stopRingtone();
  _incomingCallId = null;
  _incomingCaller = null;
  const screen = document.getElementById('screen-incoming');
  if (screen && !screen.classList.contains('hidden')) {
    App.showScreen('screen-home');
    App.showToast('📵 Call cancelled');
  }
}

function acceptFromNotification(callId, callerName, callerAvatar) {
  _incomingCallId = callId;
  _incomingCaller = { username: callerName, avatar: callerAvatar };
  accept();
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;');
}

window.IncomingCall = {
  showIncomingCall, accept, decline,
  cancelledByRemote, acceptFromNotification, stopRingtone,
};