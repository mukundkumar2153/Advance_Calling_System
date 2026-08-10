let _socket = null;

function getSocket() {
  return _socket;
}

function initSocket(token) {
  if (_socket) _socket.disconnect();

  const SERVER = window.RINGUP_SERVER || window.location.origin;

  _socket = io(SERVER, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
  });

  _socket.on('connect',       () => console.log('[Socket] Connected:', _socket.id));
  _socket.on('disconnect',    () => console.log('[Socket] Disconnected'));
  _socket.on('connect_error', e  => console.warn('[Socket] Error:', e.message));

  return _socket;
}

function disconnectSocket() {
  if (_socket) { _socket.disconnect(); _socket = null; }
}

window.SocketClient = { getSocket, initSocket, disconnectSocket };