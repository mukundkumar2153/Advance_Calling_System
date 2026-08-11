// ── Conference UI ─────────────────────────────────────────
// WhatsApp-style group/conference calling
// Uses WebRTC mesh topology: one RTCPeerConnection per participant

let _currentRoomId    = null;
let _confMembers      = {};  // Map<userId, { username, avatar, muted, speaking }>
let _speakingTimers   = {};
let _confCallTimer    = null;
let _confSeconds      = 0;
let _meUser           = null;

function initConference(meUser) {
  _meUser = meUser;
}

// ── Start a brand-new conference (from home screen) ───────
async function startConference() {
  try {
    await WebRTC.startLocalAudio();
    SocketClient.getSocket()?.emit('create-conference');
  } catch(e) {
    App.showToast('❌ Cannot start conference without microphone');
  }
}

// ── Called when server confirms conference created ────────
function onConfCreated({ roomId, host }) {
  _currentRoomId = roomId;
  WebRTC.currentRoomId = roomId;
  _confMembers = {};
  if (host && _meUser) {
    _confMembers[host.id] = { ...host, muted: false, speaking: false };
  }
  renderConferenceScreen();
  App.showToast('📞 Conference started — invite your friends!');
  startConfTimer();
}

// ── Upgrade active 1-to-1 call to a conference ───────────
async function startFromActiveCall() {
  try {
    await WebRTC.startLocalAudio();
    SocketClient.getSocket()?.emit('create-conference');
    App.showToast('🔄 Upgrading to group call…');
  } catch(e) {
    App.showToast('❌ Cannot start group call: ' + e.message);
  }
}

// ── Invite a contact to the conference ────────────────────
function inviteToConference(userId, username, avatar) {
  if (!_currentRoomId) return;
  SocketClient.getSocket()?.emit('invite-to-conference', {
    roomId: _currentRoomId,
    inviteeId: userId,
  });
  App.showToast(`📨 Invited ${username} to join…`);
}

// ── Show incoming conference invite ───────────────────────
function showConferenceInvite({ roomId, host, memberCount }) {
  const el = document.createElement('div');
  el.id = 'conf-invite-toast';
  el.className = 'conf-invite-popup';
  el.innerHTML = `
    <div class="conf-invite-inner">
      <div class="conf-invite-avatar">${host.avatar || '👤'}</div>
      <div class="conf-invite-info">
        <div class="conf-invite-name">${esc(host.username)}</div>
        <div class="conf-invite-sub">Group call · ${memberCount} people</div>
      </div>
      <div class="conf-invite-actions">
        <button class="conf-btn-decline" onclick="ConferenceUI.declineConference('${roomId}')">✕</button>
        <button class="conf-btn-accept"  onclick="ConferenceUI.joinConference('${roomId}')">📞</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  // Auto dismiss after 30s
  setTimeout(() => el.remove(), 30000);
}

// ── Join a conference room ────────────────────────────────
async function joinConference(roomId) {
  // Remove invite popup
  document.getElementById('conf-invite-toast')?.remove();
  try {
    await WebRTC.startLocalAudio();
    SocketClient.getSocket()?.emit('join-conference', { roomId });
  } catch(e) {
    App.showToast('❌ Cannot join conference without microphone');
  }
}

// ── Server tells us we successfully joined ────────────────
async function onConfJoined({ roomId, existingMembers }) {
  _currentRoomId = roomId;
  WebRTC.currentRoomId = roomId;
  _confMembers = {};

  // Add self
  if (_meUser) {
    _confMembers[_meUser.id] = { ..._meUser, muted: false, speaking: false };
  }

  // Add existing members
  for (const m of existingMembers) {
    _confMembers[m.id] = { ...m, muted: false, speaking: false };
  }

  renderConferenceScreen();
  startConfTimer();
  App.showToast('✅ Joined group call');

  // Create WebRTC connections to all existing members (we are the new joiner)
  for (const m of existingMembers) {
    try {
      await WebRTC.createConferencePeer(m.id, roomId, true);
    } catch(e) {
      console.error('[Conf] Failed to create peer to', m.id, e);
    }
  }
}

// ── New peer joined the room ──────────────────────────────
function onConfPeerJoined({ roomId, user }) {
  if (roomId !== _currentRoomId) return;
  _confMembers[user.id] = { ...user, muted: false, speaking: false };
  updateConferenceGrid();
  App.showToast(`👤 ${user.username} joined`);
}

// ── Peer left the room ────────────────────────────────────
function onConfPeerLeft({ roomId, userId }) {
  if (roomId !== _currentRoomId) return;
  const m = _confMembers[userId];
  if (m) App.showToast(`👋 ${m.username} left`);
  delete _confMembers[userId];
  WebRTC.removeConferencePeer(userId);
  updateConferenceGrid();
}

// ── Conference ended by host ──────────────────────────────
function onConfEnded({ roomId }) {
  if (roomId !== _currentRoomId) return;
  endConference(false);
  App.showToast('📵 Group call ended');
}

// ── Peer muted/unmuted ────────────────────────────────────
function onConfPeerMuted({ roomId, userId, muted }) {
  if (roomId !== _currentRoomId || !_confMembers[userId]) return;
  _confMembers[userId].muted = muted;
  const card = document.getElementById(`conf-card-${userId}`);
  if (card) {
    const icon = card.querySelector('.conf-peer-mute-icon');
    if (icon) icon.textContent = muted ? '🔇' : '';
  }
}

// ── Peer audio active (speaking detection) ───────────────
function onPeerAudioActive(peerId) {
  if (!_confMembers[peerId]) return;
  const card = document.getElementById(`conf-card-${peerId}`);
  if (card) {
    card.classList.add('speaking');
    clearTimeout(_speakingTimers[peerId]);
    _speakingTimers[peerId] = setTimeout(() => card.classList.remove('speaking'), 2000);
  }
}

// ── Decline conference invite ─────────────────────────────
function declineConference(roomId) {
  document.getElementById('conf-invite-toast')?.remove();
  SocketClient.getSocket()?.emit('decline-conference', { roomId });
}

// ── Leave/End conference ──────────────────────────────────
function endConference(notifyServer = true) {
  if (notifyServer && _currentRoomId) {
    SocketClient.getSocket()?.emit('leave-conference', { roomId: _currentRoomId });
  }
  WebRTC.closeAllConferencePeers();
  WebRTC.stopLocalAudio();
  stopConfTimer();
  _confMembers = {};
  _currentRoomId = null;
  WebRTC.currentRoomId = null;
  App.showScreen('screen-home');
}

// ── Conference mute toggle ────────────────────────────────
function toggleConfMute() {
  const muted = WebRTC.toggleMute();
  if (_meUser && _confMembers[_meUser.id]) {
    _confMembers[_meUser.id].muted = muted;
  }
  const btn = document.getElementById('conf-btn-mute');
  if (btn) btn.textContent = muted ? '🔇' : '🎙️';
  App.showToast(muted ? '🔇 Muted' : '🎙️ Unmuted');
}

// ── Conference speaker toggle ─────────────────────────────
async function toggleConfSpeaker() {
  const speakerOn = await WebRTC.toggleSpeaker();
  const btn = document.getElementById('conf-btn-speaker');
  if (btn) {
    btn.textContent = speakerOn ? '🔊' : '🔈';
    btn.classList.toggle('ctrl-active', speakerOn);
  }
  App.showToast(speakerOn ? '🔊 Loudspeaker ON' : '🔈 Earpiece mode');
}

// ── Show invite friend picker ─────────────────────────────
function showInvitePicker() {
  // Get friends list from FriendsUI
  const friends = window.FriendsUI?.getOnlineFriends?.() || [];
  if (friends.length === 0) {
    App.showToast('No online friends to invite');
    return;
  }
  const modal = document.createElement('div');
  modal.id = 'conf-invite-modal';
  modal.className = 'conf-modal-overlay';
  modal.innerHTML = `
    <div class="conf-modal">
      <div class="conf-modal-header">
        <span>Invite to Group Call</span>
        <button onclick="document.getElementById('conf-invite-modal').remove()">✕</button>
      </div>
      <div class="conf-modal-list">
        ${friends.map(f => {
          const alreadyIn = !!_confMembers[f.id];
          return `<div class="conf-modal-item ${alreadyIn ? 'already-in' : ''}">
            <span class="conf-modal-avatar">${f.avatar || '👤'}</span>
            <span class="conf-modal-name">${esc(f.username)}</span>
            <button class="conf-modal-invite-btn" ${alreadyIn ? 'disabled' : ''}
              onclick="ConferenceUI.inviteToConference('${f.id}','${esc(f.username)}','${esc(f.avatar||'👤')}');document.getElementById('conf-invite-modal').remove();">
              ${alreadyIn ? 'In call' : 'Invite'}
            </button>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  document.body.appendChild(modal);
}

// ── Conference timer ──────────────────────────────────────
function startConfTimer() {
  stopConfTimer();
  _confSeconds = 0;
  _confCallTimer = setInterval(() => {
    _confSeconds++;
    const m = String(Math.floor(_confSeconds / 60)).padStart(2,'0');
    const s = String(_confSeconds % 60).padStart(2,'0');
    const el = document.getElementById('conf-timer');
    if (el) el.textContent = `${m}:${s}`;
  }, 1000);
}

function stopConfTimer() {
  if (_confCallTimer) { clearInterval(_confCallTimer); _confCallTimer = null; }
}

// ── Render conference screen ──────────────────────────────
function renderConferenceScreen() {
  App.showScreen('screen-conference');
  const screen = document.getElementById('screen-conference');
  if (!screen) return;
  screen.innerHTML = `
    <div class="conf-screen-wrap">
      <div class="conf-header">
        <span class="conf-title">Group Call</span>
        <span class="conf-timer" id="conf-timer">00:00</span>
      </div>
      <div class="conf-grid" id="conf-grid"></div>
      <div class="conf-controls">
        <div class="ctrl-wrap">
          <button class="ctrl-circle" id="conf-btn-mute" onclick="ConferenceUI.toggleConfMute()">🎙️</button>
          <span class="ctrl-label">Mute</span>
        </div>
        <div class="ctrl-wrap">
          <button class="ctrl-circle ctrl-add" onclick="ConferenceUI.showInvitePicker()">➕</button>
          <span class="ctrl-label">Add</span>
        </div>
        <div class="ctrl-wrap">
          <button class="ctrl-circle ctrl-end" onclick="ConferenceUI.endConference(true)">📵</button>
          <span class="ctrl-label">End</span>
        </div>
        <div class="ctrl-wrap">
          <button class="ctrl-circle" id="conf-btn-speaker" onclick="ConferenceUI.toggleConfSpeaker()">🔈</button>
          <span class="ctrl-label">Speaker</span>
        </div>
      </div>
    </div>`;
  updateConferenceGrid();
}

// ── Update participant grid ───────────────────────────────
function updateConferenceGrid() {
  const grid = document.getElementById('conf-grid');
  if (!grid) return;
  const members = Object.values(_confMembers);
  grid.innerHTML = members.map(m => `
    <div class="conf-peer-card ${m.speaking ? 'speaking' : ''}" id="conf-card-${m.id}">
      <div class="conf-peer-ring">
        <div class="conf-peer-avatar">${m.avatar || '👤'}</div>
      </div>
      <div class="conf-peer-name">${esc(m.username)}</div>
      <div class="conf-peer-mute-icon">${m.muted ? '🔇' : ''}</div>
    </div>
  `).join('');
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;');
}

window.ConferenceUI = {
  initConference,
  startConference,
  startFromActiveCall,
  inviteToConference,
  showConferenceInvite,
  joinConference,
  declineConference,
  endConference,
  toggleConfMute,
  toggleConfSpeaker,
  showInvitePicker,
  updateConferenceGrid,
  // Socket event handlers
  onConfCreated,
  onConfJoined,
  onConfPeerJoined,
  onConfPeerLeft,
  onConfEnded,
  onConfPeerMuted,
  onPeerAudioActive,
};
