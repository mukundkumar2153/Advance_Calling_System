// ── Conference UI ─────────────────────────────────────────
// WhatsApp-style group/conference calling
// Mesh topology: one RTCPeerConnection per participant

let _currentRoomId  = null;
let _confMembers    = {};   // Map<userId, { id, username, avatar, muted, connected }>
let _speakingTimers = {};
let _confCallTimer  = null;
let _confSeconds    = 0;
let _meUser         = null;

function initConference(meUser) {
  _meUser = meUser;
}

// ── Start a brand-new conference from home screen ─────────
async function startConference() {
  try {
    await WebRTC.startLocalAudio();
    SocketClient.getSocket()?.emit('create-conference');
    App.showToast('🔄 Starting group call…');
  } catch(e) {
    // Error toast shown by startLocalAudio
  }
}

// ── Called when server confirms conference created ────────
function onConfCreated({ roomId, host }) {
  _currentRoomId = roomId;
  WebRTC.currentRoomId = roomId;
  _confMembers = {};
  // Add host (self) to members
  if (_meUser) {
    _confMembers[_meUser.id] = { ..._meUser, muted: false, connected: true };
  } else if (host) {
    _confMembers[host.id] = { ...host, muted: false, connected: true };
  }
  renderConferenceScreen();
  startConfTimer();
  App.showToast('📞 Group call started — invite your contacts!');
}

// ── Upgrade an active 1-to-1 call to a conference ────────
async function startFromActiveCall() {
  try {
    await WebRTC.startLocalAudio();
    SocketClient.getSocket()?.emit('create-conference');
    App.showToast('🔄 Upgrading to group call…');
  } catch(e) {
    // Error handled in startLocalAudio
  }
}

// ── Invite a contact to the conference ────────────────────
function inviteToConference(userId, username, avatar) {
  if (!_currentRoomId) return;
  SocketClient.getSocket()?.emit('invite-to-conference', {
    roomId:    _currentRoomId,
    inviteeId: userId,
  });
  App.showToast(`📨 Invited ${username}…`);
  // Optimistically mark as "invited" in grid
  if (!_confMembers[userId]) {
    _confMembers[userId] = { id: userId, username, avatar: avatar || '👤', muted: false, connected: false, invited: true };
    updateConferenceGrid();
  }
}

// ── Show incoming conference invite banner ────────────────
function showConferenceInvite({ roomId, host, memberCount }) {
  // Remove any old invite
  document.getElementById('conf-invite-toast')?.remove();

  const el = document.createElement('div');
  el.id = 'conf-invite-toast';
  el.className = 'conf-invite-popup';
  el.innerHTML = `
    <div class="conf-invite-inner">
      <div class="conf-invite-avatar">${esc(host.avatar || '👤')}</div>
      <div class="conf-invite-info">
        <div class="conf-invite-name">${esc(host.username)}</div>
        <div class="conf-invite-sub">Group call · ${memberCount || 1} in call</div>
      </div>
      <div class="conf-invite-actions">
        <button class="conf-btn-decline" onclick="ConferenceUI.declineConference('${esc(roomId)}')">✕</button>
        <button class="conf-btn-accept"  onclick="ConferenceUI.joinConference('${esc(roomId)}')">📞</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  // Auto-dismiss after 30 seconds
  setTimeout(() => el.remove(), 30000);
}

// ── Join a conference room ────────────────────────────────
async function joinConference(roomId) {
  document.getElementById('conf-invite-toast')?.remove();
  try {
    // MUST get mic BEFORE joining so localStream is ready for peer connections
    await WebRTC.startLocalAudio();
    _currentRoomId = roomId;
    WebRTC.currentRoomId = roomId;
    SocketClient.getSocket()?.emit('join-conference', { roomId });
    App.showToast('📞 Joining group call…');
  } catch(e) {
    // Error shown by startLocalAudio
  }
}

// ── Server confirms we joined — build connections to existing members ──
async function onConfJoined({ roomId, existingMembers }) {
  _currentRoomId = roomId;
  WebRTC.currentRoomId = roomId;
  _confMembers = {};

  // Add self
  if (_meUser) {
    _confMembers[_meUser.id] = { ..._meUser, muted: false, connected: true };
  }

  // Add existing members
  for (const m of (existingMembers || [])) {
    _confMembers[m.id] = { ...m, muted: false, connected: false };
  }

  renderConferenceScreen();
  startConfTimer();
  App.showToast('✅ Joined group call');

  // Ensure mic is ready (should be from joinConference, but double-check)
  try {
    await WebRTC.startLocalAudio();
  } catch(e) {
    App.showToast('⚠️ Mic unavailable — others cannot hear you');
  }

  // Create peer connections to ALL existing members (we are the new joiner = initiator)
  for (const m of (existingMembers || [])) {
    try {
      console.log('[Conf] Creating connection to existing member:', m.id);
      await WebRTC.createConferencePeer(m.id, roomId, true /* we initiate */);
    } catch(e) {
      console.error('[Conf] Failed to connect to', m.id, ':', e);
    }
  }
}

// ── New peer joined — update grid (they will send us an offer) ──
function onConfPeerJoined({ roomId, user }) {
  if (roomId !== _currentRoomId) return;
  if (!_confMembers[user.id]) {
    _confMembers[user.id] = { ...user, muted: false, connected: false };
  }
  updateConferenceGrid();
  App.showToast(`👤 ${esc(user.username)} joined the call`);
}

// ── Called when WebRTC connection to a peer is established ──
function onPeerConnected(peerId) {
  if (_confMembers[peerId]) {
    _confMembers[peerId].connected = true;
    _confMembers[peerId].invited   = false;
    updateConferenceGrid();
  }
}

// ── Peer left the conference room ─────────────────────────
function onConfPeerLeft({ roomId, userId }) {
  if (roomId !== _currentRoomId) return;
  const m = _confMembers[userId];
  if (m) App.showToast(`👋 ${esc(m.username)} left the call`);
  delete _confMembers[userId];
  WebRTC.removeConferencePeer(userId);
  updateConferenceGrid();
}

// ── Host ended the conference ─────────────────────────────
function onConfEnded({ roomId }) {
  if (roomId !== _currentRoomId) return;
  _doEndConference(false);
  App.showToast('📵 Group call ended');
}

// ── Peer muted / unmuted ──────────────────────────────────
function onConfPeerMuted({ roomId, userId, muted }) {
  if (roomId !== _currentRoomId || !_confMembers[userId]) return;
  _confMembers[userId].muted = muted;
  const icon = document.querySelector(`#conf-card-${userId} .conf-peer-mute-icon`);
  if (icon) icon.textContent = muted ? '🔇' : '';
}

// ── Speaking detection ────────────────────────────────────
function onPeerAudioActive(peerId) {
  if (!_confMembers[peerId]) return;
  const card = document.getElementById(`conf-card-${peerId}`);
  if (card) {
    card.classList.add('speaking');
    clearTimeout(_speakingTimers[peerId]);
    _speakingTimers[peerId] = setTimeout(() => card?.classList.remove('speaking'), 2500);
  }
}

// ── Peer disconnected (WebRTC failed) ─────────────────────
function onPeerDisconnected(peerId) {
  if (_confMembers[peerId]) {
    _confMembers[peerId].connected = false;
    updateConferenceGrid();
  }
}

// ── Decline conference invite ─────────────────────────────
function declineConference(roomId) {
  document.getElementById('conf-invite-toast')?.remove();
  SocketClient.getSocket()?.emit('decline-conference', { roomId });
}

// ── Leave / End conference ────────────────────────────────
function endConference(notifyServer = true) {
  _doEndConference(notifyServer);
}

function _doEndConference(notifyServer) {
  if (notifyServer && _currentRoomId) {
    SocketClient.getSocket()?.emit('leave-conference', { roomId: _currentRoomId });
  }
  WebRTC.closeAllConferencePeers();
  WebRTC.stopLocalAudio();
  stopConfTimer();
  _confMembers   = {};
  _currentRoomId = null;
  WebRTC.currentRoomId = null;
  // Remove audio unlock button if present
  document.getElementById('audio-unlock-btn')?.remove();
  App.showScreen('screen-home');
}

// ── Conference mute toggle ────────────────────────────────
function toggleConfMute() {
  const muted = WebRTC.toggleMute();
  if (_meUser && _confMembers[_meUser.id]) {
    _confMembers[_meUser.id].muted = muted;
  }
  const btn = document.getElementById('conf-btn-mute');
  if (btn) {
    btn.textContent = muted ? '🔇' : '🎙️';
    btn.classList.toggle('ctrl-active', muted);
  }
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

// ── Invite picker — shows ALL friends (online + offline) ─
function showInvitePicker() {
  // FIX: Get ALL friends, not just online ones
  // Friends.getFriends() returns all, getOnlineFriends() returns only online
  const allFriends = window.FriendsUI?.getFriends?.() || [];

  if (allFriends.length === 0) {
    App.showToast('No contacts found — add friends first');
    return;
  }

  const modal = document.createElement('div');
  modal.id = 'conf-invite-modal';
  modal.className = 'conf-modal-overlay';

  const rows = allFriends.map(f => {
    const alreadyIn = !!_confMembers[f.id];
    const statusDot = f.online
      ? '<span class="conf-online-dot"></span>'
      : '<span class="conf-offline-dot"></span>';
    return `
      <div class="conf-modal-item ${alreadyIn ? 'already-in' : ''}">
        <span class="conf-modal-avatar">${esc(f.avatar || '👤')}</span>
        <div class="conf-modal-info">
          <span class="conf-modal-name">${esc(f.username)}</span>
          <span class="conf-modal-status">${statusDot}${f.online ? 'Online' : 'Offline'}</span>
        </div>
        <button class="conf-modal-invite-btn" ${alreadyIn ? 'disabled' : ''}
          onclick="ConferenceUI.inviteToConference('${esc(String(f.id))}','${esc(f.username)}','${esc(f.avatar||'👤')}');document.getElementById('conf-invite-modal').remove();">
          ${alreadyIn ? '✓ In call' : 'Invite'}
        </button>
      </div>`;
  }).join('');

  modal.innerHTML = `
    <div class="conf-modal" onclick="event.stopPropagation()">
      <div class="conf-modal-header">
        <span>Invite to Group Call</span>
        <button onclick="document.getElementById('conf-invite-modal').remove()">✕</button>
      </div>
      <div class="conf-modal-search">
        <input type="text" placeholder="Search contacts…" oninput="ConferenceUI._filterInviteModal(this.value)"
               id="conf-invite-search" class="conf-modal-search-input"/>
      </div>
      <div class="conf-modal-list" id="conf-modal-list-inner">${rows}</div>
    </div>`;

  // Close when clicking overlay
  modal.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);

  // Focus search input
  setTimeout(() => document.getElementById('conf-invite-search')?.focus(), 100);
}

// Filter contacts in invite modal
function _filterInviteModal(query) {
  const q = query.toLowerCase().trim();
  document.querySelectorAll('#conf-modal-list-inner .conf-modal-item').forEach(item => {
    const name = item.querySelector('.conf-modal-name')?.textContent?.toLowerCase() || '';
    item.style.display = (!q || name.includes(q)) ? '' : 'none';
  });
}

// ── Conference timer ──────────────────────────────────────
function startConfTimer() {
  stopConfTimer();
  _confSeconds   = 0;
  _confCallTimer = setInterval(() => {
    _confSeconds++;
    const m = String(Math.floor(_confSeconds / 60)).padStart(2, '0');
    const s = String(_confSeconds % 60).padStart(2, '0');
    const el = document.getElementById('conf-timer');
    if (el) el.textContent = `${m}:${s}`;
  }, 1000);
}

function stopConfTimer() {
  if (_confCallTimer) { clearInterval(_confCallTimer); _confCallTimer = null; }
}

// ── Render the conference screen ──────────────────────────
function renderConferenceScreen() {
  App.showScreen('screen-conference');
  const screen = document.getElementById('screen-conference');
  if (!screen) return;

  screen.innerHTML = `
    <div class="conf-screen-wrap">
      <div class="conf-header">
        <div class="conf-header-left">
          <span class="conf-title">Group Call</span>
          <span class="conf-member-count" id="conf-member-count"></span>
        </div>
        <span class="conf-timer" id="conf-timer">00:00</span>
      </div>

      <div class="conf-grid" id="conf-grid"></div>

      <div class="conf-audio-note" id="conf-audio-note" style="display:none">
        <button class="conf-audio-unlock-btn" onclick="WebRTC.unlockAllAudio();document.getElementById('conf-audio-note').style.display='none'">
          🔊 Tap here to hear audio
        </button>
      </div>

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

  // Show audio unlock note after 2s — in case autoplay was blocked
  setTimeout(() => {
    const note = document.getElementById('conf-audio-note');
    if (note) note.style.display = 'flex';
  }, 2000);
}

// ── Update conference participant grid ────────────────────
function updateConferenceGrid() {
  const grid = document.getElementById('conf-grid');
  if (!grid) return;

  const members = Object.values(_confMembers);

  // Update member count
  const countEl = document.getElementById('conf-member-count');
  if (countEl) countEl.textContent = `${members.length} people`;

  if (members.length === 0) {
    grid.innerHTML = '<div class="conf-empty">Waiting for others to join…</div>';
    return;
  }

  grid.innerHTML = members.map(m => {
    const isMe     = _meUser && m.id === _meUser.id;
    const status   = m.invited && !m.connected ? 'calling'
                   : m.connected              ? 'connected'
                   :                            'connecting';
    const statusLabel = m.invited && !m.connected ? '📲 Ringing…'
                      : m.connected               ? ''
                      :                             '⏳ Connecting…';
    return `
      <div class="conf-peer-card ${m.speaking ? 'speaking' : ''} ${status}" id="conf-card-${m.id}">
        <div class="conf-peer-ring">
          <div class="conf-peer-avatar">${esc(m.avatar || '👤')}</div>
        </div>
        <div class="conf-peer-name">${esc(m.username)}${isMe ? ' (You)' : ''}</div>
        <div class="conf-peer-status">${statusLabel}</div>
        <div class="conf-peer-mute-icon">${m.muted ? '🔇' : ''}</div>
      </div>`;
  }).join('');
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                        .replace(/'/g, '&#39;').replace(/"/g, '&quot;');
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
  _filterInviteModal,
  // WebRTC event callbacks
  onConfCreated,
  onConfJoined,
  onConfPeerJoined,
  onConfPeerLeft,
  onConfEnded,
  onConfPeerMuted,
  onPeerAudioActive,
  onPeerConnected,
  onPeerDisconnected,
};
