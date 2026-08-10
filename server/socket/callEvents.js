const { sendCallNotification } = require('../config/firebase');
const User    = require('../models/User');
const CallLog = require('../models/CallLog');

let socketUsers = {};
let userSockets = {};
let activeCalls = {};

function registerMaps(su, us) {
  socketUsers = su;
  userSockets = us;
}

function handleUserDisconnect(io, userId) {
  for (const [callId, call] of Object.entries(activeCalls)) {
    if (call.callerId === userId || call.calleeId === userId) {
      const otherId = call.callerId === userId ? call.calleeId : call.callerId;
      const otherSocket = userSockets[otherId];

      if (call.startTime) {
        const duration = Math.floor((Date.now() - call.startTime) / 1000);
        CallLog.updateStatus(callId, 'answered', duration);
        if (otherSocket) io.to(otherSocket).emit('call-ended', { callId, duration });
      } else {
        CallLog.updateStatus(callId, 'missed');
        if (otherSocket) io.to(otherSocket).emit('call-cancelled', { callId });
      }
      delete activeCalls[callId];
    }
  }
}

function registerCallEvents(io, socket) {
  const myId = () => socketUsers[socket.id];

  socket.on('call-user', async ({ calleeId }) => {
    const callerId = myId();
    if (!callerId || !calleeId) return;

    const caller = await User.findById(callerId);
    const callee = await User.findById(calleeId);
    if (!caller || !callee)
      return socket.emit('call-error', { message: 'User not found' });

    // Busy check
    const callerBusy = Object.values(activeCalls).some(c => c.callerId === callerId || c.calleeId === callerId);
    const calleeBusy = Object.values(activeCalls).some(c => c.callerId === calleeId || c.calleeId === calleeId);
    if (callerBusy) return socket.emit('call-error', { message: 'You are already in a call' });
    if (calleeBusy) return socket.emit('call-error', { message: 'User is on another call' });

    const callId = await CallLog.create(callerId, calleeId);
    activeCalls[callId] = {
      callerId,
      calleeId,
      callerSocketId: socket.id,
      calleeSocketId: null,
      startTime: null,
    };

    socket.emit('call-ringing', {
      callId,
      callee: { id: callee.id, username: callee.username, avatar: callee.avatar },
    });

    const calleeSocketId = userSockets[calleeId];
    if (calleeSocketId) {
      io.to(calleeSocketId).emit('incoming-call', {
        callId,
        caller: { id: caller.id, username: caller.username, avatar: caller.avatar },
      });
    } else {
      const fcmToken = await User.getFcmToken(calleeId);
      await sendCallNotification({
        fcmToken,
        callerName:   caller.username,
        callerAvatar: caller.avatar,
        callId,
      });
    }

    // Auto-timeout 30s
    setTimeout(async () => {
      if (activeCalls[callId] && activeCalls[callId].startTime === null) {
        await CallLog.updateStatus(callId, 'missed');
        delete activeCalls[callId];
        socket.emit('call-missed', { callId });
        const cs = userSockets[calleeId];
        if (cs) io.to(cs).emit('call-cancelled', { callId });
      }
    }, 30000);
  });

  // ── ACCEPT ────────────────────────────────────────────
  socket.on('call-accepted', async ({ callId }) => {
    const call = activeCalls[callId];
    if (!call) return;

    call.startTime     = Date.now();
    call.calleeSocketId = socket.id;
    await CallLog.updateStatus(callId, 'answered');

    const callerSocketId = userSockets[call.callerId];

    // Tell caller: accepted — so caller stops ringing UI
    if (callerSocketId) {
      io.to(callerSocketId).emit('call-accepted', {
        callId,
        calleeId: call.calleeId,
      });
    }

    // Tell callee: ready to receive WebRTC offer
    socket.emit('call-ready', {
      callId,
      callerId: call.callerId,
    });
  });

  socket.on('call-declined', async ({ callId }) => {
    const call = activeCalls[callId];
    if (!call) return;
    await CallLog.updateStatus(callId, 'declined');
    delete activeCalls[callId];
    const callerSocket = userSockets[call.callerId];
    if (callerSocket) io.to(callerSocket).emit('call-declined', { callId });
  });

  socket.on('call-ended', async ({ callId }) => {
    const call = activeCalls[callId];
    if (!call) return;
    const duration = call.startTime
      ? Math.floor((Date.now() - call.startTime) / 1000) : 0;
    await CallLog.updateStatus(callId, 'answered', duration);
    delete activeCalls[callId];
    const myUserId    = socketUsers[socket.id];
    const otherId     = myUserId === call.callerId ? call.calleeId : call.callerId;
    const otherSocket = userSockets[otherId];
    if (otherSocket) io.to(otherSocket).emit('call-ended', { callId, duration });
  });

  socket.on('call-cancelled', async ({ callId }) => {
    const call = activeCalls[callId];
    if (!call) return;
    await CallLog.updateStatus(callId, 'missed');
    delete activeCalls[callId];
    const calleeSocket = userSockets[call.calleeId];
    if (calleeSocket) io.to(calleeSocket).emit('call-cancelled', { callId });
  });
}

module.exports = { registerCallEvents, registerMaps, handleUserDisconnect };