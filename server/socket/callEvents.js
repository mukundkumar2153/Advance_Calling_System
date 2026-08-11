const { sendCallNotification } = require('../config/firebase');
const User    = require('../models/User');
const CallLog = require('../models/CallLog');
const { v4: uuidv4 } = require('uuid');

let socketUsers = {};
let userSockets = {};
let activeCalls = {};

// ── Conference Rooms ─────────────────────────────────────
// Map<roomId, { hostId, members: Set<userId>, invites: Set<userId>, createdAt }>
const conferenceRooms = {};

function registerMaps(su, us) {
  socketUsers = su;
  userSockets = us;
}

function handleUserDisconnect(io, userId) {
  // Cleanup 1-to-1 calls
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

  // Cleanup conference rooms
  for (const [roomId, room] of Object.entries(conferenceRooms)) {
    if (room.members.has(userId)) {
      room.members.delete(userId);
      // Notify remaining members
      for (const memberId of room.members) {
        const ms = userSockets[memberId];
        if (ms) io.to(ms).emit('conf-peer-left', { roomId, userId });
      }
      // If room empty or host left, destroy room
      if (room.members.size === 0 || room.hostId === userId) {
        for (const memberId of room.members) {
          const ms = userSockets[memberId];
          if (ms) io.to(ms).emit('conf-ended', { roomId });
        }
        delete conferenceRooms[roomId];
      }
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

  // ── CONFERENCE EVENTS ──────────────────────────────────

  // Host creates a new conference room
  socket.on('create-conference', async () => {
    const hostId = myId();
    if (!hostId) return;
    const host = await User.findById(hostId);
    if (!host) return;
    const roomId = uuidv4();
    conferenceRooms[roomId] = {
      hostId,
      members: new Set([hostId]),
      invites: new Set(),
      createdAt: Date.now(),
    };
    socket.emit('conf-created', {
      roomId,
      host: { id: host.id, username: host.username, avatar: host.avatar },
    });
    console.log(`[Conf] Room ${roomId} created by ${host.username}`);
  });

  // Host invites a user to the conference
  socket.on('invite-to-conference', async ({ roomId, inviteeId }) => {
    const hostId = myId();
    const room = conferenceRooms[roomId];
    if (!room || room.hostId !== hostId) return;
    const host    = await User.findById(hostId);
    const invitee = await User.findById(inviteeId);
    if (!host || !invitee) return;
    if (room.members.has(inviteeId)) {
      return socket.emit('call-error', { message: `${invitee.username} is already in the call` });
    }
    room.invites.add(inviteeId);
    const inviteeSocket = userSockets[inviteeId];
    if (inviteeSocket) {
      io.to(inviteeSocket).emit('conf-invite', {
        roomId,
        host: { id: host.id, username: host.username, avatar: host.avatar },
        memberCount: room.members.size,
      });
    } else {
      // FCM push for offline users
      const fcmToken = await User.getFcmToken(inviteeId);
      if (fcmToken) {
        await sendCallNotification({
          fcmToken,
          callerName:   host.username,
          callerAvatar: host.avatar,
          callId:       roomId,
        });
      }
    }
  });

  // A user joins the conference room
  socket.on('join-conference', async ({ roomId }) => {
    const userId = myId();
    const room = conferenceRooms[roomId];
    if (!room) return socket.emit('call-error', { message: 'Conference room not found' });
    const user = await User.findById(userId);
    if (!user) return;
    room.members.add(userId);
    room.invites.delete(userId);
    // Tell new member the existing members list
    const existingMembers = [];
    for (const memberId of room.members) {
      if (memberId !== userId) {
        const m = await User.findById(memberId);
        if (m) existingMembers.push({ id: m.id, username: m.username, avatar: m.avatar });
      }
    }
    socket.emit('conf-joined', { roomId, existingMembers });
    // Tell existing members someone joined
    for (const memberId of room.members) {
      if (memberId !== userId) {
        const ms = userSockets[memberId];
        if (ms) io.to(ms).emit('conf-peer-joined', {
          roomId,
          user: { id: user.id, username: user.username, avatar: user.avatar },
        });
      }
    }
    console.log(`[Conf] ${user.username} joined room ${roomId} (${room.members.size} members)`);
  });

  // A user voluntarily leaves the conference
  socket.on('leave-conference', ({ roomId }) => {
    const userId = myId();
    const room = conferenceRooms[roomId];
    if (!room) return;
    room.members.delete(userId);
    for (const memberId of room.members) {
      const ms = userSockets[memberId];
      if (ms) io.to(ms).emit('conf-peer-left', { roomId, userId });
    }
    // If host left or room empty, end the conference
    if (room.hostId === userId || room.members.size === 0) {
      for (const memberId of room.members) {
        const ms = userSockets[memberId];
        if (ms) io.to(ms).emit('conf-ended', { roomId });
      }
      delete conferenceRooms[roomId];
      console.log(`[Conf] Room ${roomId} ended`);
    }
    socket.emit('conf-left', { roomId });
  });

  // Decline conference invite
  socket.on('decline-conference', ({ roomId }) => {
    const room = conferenceRooms[roomId];
    if (!room) return;
    room.invites.delete(myId());
    const hostSocket = userSockets[room.hostId];
    if (hostSocket) io.to(hostSocket).emit('conf-invite-declined', { roomId, userId: myId() });
  });
}

module.exports = { registerCallEvents, registerMaps, handleUserDisconnect, conferenceRooms };