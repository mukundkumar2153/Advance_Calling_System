const jwt  = require('jsonwebtoken');
const User = require('../models/User');
const { registerCallEvents, registerMaps, handleUserDisconnect } = require('./callEvents');

const socketUsers = {};
const userSockets = {};
registerMaps(socketUsers, userSockets);

function registerSignaling(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch(e) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const userId   = socket.user.id;
    const username = socket.user.username;

    const existingSocketId = userSockets[userId];
    if (existingSocketId && existingSocketId !== socket.id) {
      const old = io.sockets.sockets.get(existingSocketId);
      if (old) old.disconnect(true);
    }

    socketUsers[socket.id] = userId;
    userSockets[userId]    = socket.id;

    await User.setOnline(userId, true);
    io.emit('user-status', { userId, online: true });
    console.log(`[+] ${username} connected`);

    socket.on('ping-alive', async () => {
      await User.setOnline(userId, true);
      socket.emit('pong-alive');
    });

    socket.on('webrtc-offer', ({ callId, offer, targetId }) => {
      const t = userSockets[targetId];
      if (t) io.to(t).emit('webrtc-offer', { callId, offer, fromId: userId });
      else socket.emit('call-error', { message: 'Other person disconnected' });
    });

    socket.on('webrtc-answer', ({ callId, answer, targetId }) => {
      const t = userSockets[targetId];
      if (t) io.to(t).emit('webrtc-answer', { callId, answer, fromId: userId });
    });

    socket.on('webrtc-ice', ({ callId, candidate, targetId }) => {
      const t = userSockets[targetId];
      if (t) io.to(t).emit('webrtc-ice', { callId, candidate, fromId: userId });
    });

    socket.on('mute-toggle', ({ callId, muted, targetId }) => {
      const t = userSockets[targetId];
      if (t) io.to(t).emit('peer-muted', { muted });
    });

    // ── Conference WebRTC signaling relay ─────────────────
    // Each event forwards to specific target peer within conference room
    socket.on('conf-offer', ({ roomId, offer, targetId }) => {
      const t = userSockets[targetId];
      if (t) io.to(t).emit('conf-offer', { roomId, offer, fromId: userId });
    });

    socket.on('conf-answer', ({ roomId, answer, targetId }) => {
      const t = userSockets[targetId];
      if (t) io.to(t).emit('conf-answer', { roomId, answer, fromId: userId });
    });

    socket.on('conf-ice', ({ roomId, candidate, targetId }) => {
      const t = userSockets[targetId];
      if (t) io.to(t).emit('conf-ice', { roomId, candidate, fromId: userId });
    });

    socket.on('conf-mute', ({ roomId, muted }) => {
      // Broadcast mute state to all members in the room via conf-peer-muted
      // We don't have room lookup here, so broadcast to all connected — client filters by roomId
      socket.broadcast.emit('conf-peer-muted', { roomId, userId, muted });
    });

    registerCallEvents(io, socket);

    socket.on('disconnect', async (reason) => {
      handleUserDisconnect(io, userId);

      if (userSockets[userId] === socket.id) {
        setTimeout(async () => {
          if (userSockets[userId] === socket.id) {
            delete socketUsers[socket.id];
            delete userSockets[userId];
            await User.setOnline(userId, false);
            io.emit('user-status', { userId, online: false });
            console.log(`[-] ${username} offline`);
          }
        }, 8000);
      } else {
        delete socketUsers[socket.id];
      }
    });
  });
}

module.exports = { registerSignaling };