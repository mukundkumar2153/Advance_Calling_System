window.addEventListener('error', e => console.error('App error:', e.message));
window.addEventListener('unhandledrejection', e => console.error('Promise error:', e.reason));

let APP_TOKEN = null;
let APP_ME    = null;

async function init() {
  // Apply theme first
  Settings.initSettings();

  await Notifications.registerServiceWorker();

  const params = new URLSearchParams(window.location.search);
  const callId  = params.get('callId');
  const action  = params.get('action');
  const caller  = params.get('caller');
  const avatar  = params.get('avatar');

  if (callId && action) {
    history.replaceState({}, '', '/');
    if (action === 'accept' && caller) {
      window._pendingNotifCall = { callId, callerName: caller, callerAvatar: avatar || '👤' };
    }
  }

  if (AuthUI.isLoggedIn()) {
    const { token, user } = AuthUI.getSession();
    await afterLogin(token, user);
  } else {
    showScreen('screen-auth');
    AuthUI.renderAuthScreen();
  }
}

async function afterLogin(token, user) {
  APP_TOKEN = token;
  APP_ME    = user;

  await Notifications.requestNotificationPermission();
  FriendsUI.init(token, user);
  Settings.setSettingsUser(user, token);
  SocketClient.initSocket(token);
  bindSocketEvents();

  if (window.ConferenceUI) ConferenceUI.initConference(user);

  showScreen('screen-home');
  FriendsUI.renderFriendsScreen();

  if (window._pendingNotifCall) {
    const { callId, callerName, callerAvatar } = window._pendingNotifCall;
    delete window._pendingNotifCall;
    setTimeout(() => IncomingCall.acceptFromNotification(callId, callerName, callerAvatar), 800);
  }
}

function bindSocketEvents() {
  const socket = SocketClient.getSocket();

  socket.on('incoming-call', ({ callId, caller }) => {
    IncomingCall.showIncomingCall({ callId, caller });
    Notifications.showLocalNotification(
      `📞 ${caller.username} is calling`, 'Tap to answer',
      { callId, callerName: caller.username, callerAvatar: caller.avatar }
    );
  });

  socket.on('call-ringing',   data => CallHandler.onCallRinging(data));
  socket.on('call-accepted',  data => CallHandler.onCallAccepted(data));
  socket.on('call-declined',  data => CallHandler.onCallDeclined(data));
  socket.on('call-missed',    data => CallHandler.onCallMissed(data));
  socket.on('call-cancelled', data => IncomingCall.cancelledByRemote(data));
  socket.on('call-ended',     data => CallHandler.onCallEnded(data));

  socket.on('call-ready', ({ callId, callerId }) => {
    console.log('[App] call-ready — waiting for WebRTC offer');
  });

  socket.on('webrtc-offer', async data => {
    try { await WebRTC.handleOffer(data); } catch(e) { console.error('[App] handleOffer:', e); }
  });
  socket.on('webrtc-answer', async data => {
    try { await WebRTC.handleAnswer(data); } catch(e) { console.error('[App] handleAnswer:', e); }
  });
  socket.on('webrtc-ice', async data => {
    try { await WebRTC.handleIce(data); } catch(e) {}
  });

  socket.on('peer-muted',    data => CallHandler.onPeerMuted(data));
  socket.on('pong-alive',    () => console.log('[Socket] alive'));
  socket.on('disconnect',    () => App.showToast('⚠️ Connection lost — reconnecting…'));
  socket.on('reconnect',     () => App.showToast('✅ Reconnected!'));
  socket.on('user-status', ({ userId, online }) => FriendsUI.updateOnlineStatus(userId, online));

  // ── Conference events ───────────────────────────────
  if (window.ConferenceUI) {
    socket.on('conf-created',       data => ConferenceUI.onConfCreated(data));
    socket.on('conf-joined',        data => ConferenceUI.onConfJoined(data));
    socket.on('conf-peer-joined',   data => ConferenceUI.onConfPeerJoined(data));
    socket.on('conf-peer-left',     data => ConferenceUI.onConfPeerLeft(data));
    socket.on('conf-ended',         data => ConferenceUI.onConfEnded(data));
    socket.on('conf-peer-muted',    data => ConferenceUI.onConfPeerMuted(data));
    socket.on('conf-invite',        data => ConferenceUI.showConferenceInvite(data));
    // Conference WebRTC signaling
    socket.on('conf-offer',  async data => { try { await WebRTC.handleConfOffer(data); } catch(e) { console.error('[Conf] handleConfOffer:', e); } });
    socket.on('conf-answer', async data => { try { await WebRTC.handleConfAnswer(data); } catch(e) { console.error('[Conf] handleConfAnswer:', e); } });
    socket.on('conf-ice',    async data => { try { await WebRTC.handleConfIce(data); } catch(e) {} });
  }
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  const target = document.getElementById(id);
  if (target) target.classList.remove('hidden');
}

function showToast(msg, duration = 3000) {
  let t = document.getElementById('app-toast');
  if (!t) { t = document.createElement('div'); t.id = 'app-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

function logout() {
  SocketClient.disconnectSocket();
  AuthUI.clearSession();
  showScreen('screen-auth');
  AuthUI.renderAuthScreen();
  APP_TOKEN = null;
  APP_ME    = null;
}

window.App = { init, afterLogin, showScreen, showToast, logout };
