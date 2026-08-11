let _token   = '';
let _me      = null;
let _friends = [];
let _filter  = 'all';
let _search  = '';
let _recognition = null;

function init(token, me) { _token = token; _me = me; }

async function apiFetch(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${_token}`,
      'Content-Type':  'application/json',
      ...(opts.headers || {}),
    },
  });
  return res.json();
}

async function loadFriends() {
  _friends = await apiFetch('/api/friends');
  return _friends;
}

async function loadPending() { return apiFetch('/api/friends/pending'); }
async function searchUsers(q) {
  if (q.length < 2) return [];
  return apiFetch(`/api/users/search?q=${encodeURIComponent(q)}`);
}
async function addFriend(friendId) {
  return apiFetch('/api/friends/add', { method:'POST', body:JSON.stringify({friendId}) });
}
async function acceptFriend(friendId) {
  return apiFetch('/api/friends/accept', { method:'PUT', body:JSON.stringify({friendId}) });
}
async function loadCallHistory() { return apiFetch('/api/friends/calls/history'); }

// ── Render home ───────────────────────────────────────────
function renderFriendsScreen() {
  const screen = document.getElementById('screen-home');
  const { token } = AuthUI.getSession();
  screen.innerHTML = `
    <div class="home-layout">
      <div class="topbar">
        <div class="topbar-left">
          <span class="my-avatar">${_me.avatar}</span>
          <div>
            <div class="my-name">${esc(_me.username)}</div>
            <div class="my-status">Online</div>
          </div>
        </div>
        <div class="topbar-right">
          <button class="icon-btn" onclick="FriendsUI.showPending()" title="Requests">🔔</button>
          <button class="icon-btn" onclick="Settings.openSettings()" title="Settings">⚙️</button>
        </div>
      </div>

      <!-- Search bar -->
      <div class="search-bar-wrap">
        <div class="search-input-wrap">
          <span class="search-icon">🔍</span>
          <input class="search-input" id="search-inp" placeholder="Search contacts…"
                 oninput="FriendsUI.onSearch(this.value)"
                 onkeydown="if(event.key==='Escape'){this.value='';FriendsUI.onSearch('')}"/>
          <button class="mic-btn" id="mic-btn" onclick="FriendsUI.toggleVoiceSearch()" title="Voice search">🎤</button>
        </div>
        <button class="filter-btn" onclick="FriendsUI.showAddFriend()" title="Add friend">➕</button>
      </div>

      <!-- Filter pills -->
      <div class="filter-pills">
        <button class="pill active" data-f="all"       onclick="FriendsUI.setFilter('all',this)">All</button>
        <button class="pill"        data-f="favourites" onclick="FriendsUI.setFilter('favourites',this)">⭐ Favourites</button>
        <button class="pill"        data-f="online"     onclick="FriendsUI.setFilter('online',this)">🟢 Online</button>
        <button class="pill"        data-f="offline"    onclick="FriendsUI.setFilter('offline',this)">⚫ Offline</button>
      </div>

      <div class="tab-row">
        <button class="htab active" id="htab-contacts" onclick="FriendsUI.switchTab('contacts',this)">Contacts</button>
        <button class="htab"        id="htab-recent"   onclick="FriendsUI.switchTab('recent',this)">Recent Calls</button>
      </div>
      
      <div id="friends-body" class="friends-body"></div>

      <!-- Mobile Bottom Navigation Bar -->
      <nav class="mobile-bottom-nav">
        <button class="bnav-item active" id="bnav-contacts" onclick="FriendsUI.switchMobileTab('contacts')">
          <span class="bnav-icon">👥</span>
          <span class="bnav-label">Contacts</span>
        </button>
        <button class="bnav-item" id="bnav-recent" onclick="FriendsUI.switchMobileTab('recent')">
          <span class="bnav-icon">📞</span>
          <span class="bnav-label">Recents</span>
        </button>
        <button class="bnav-item" id="bnav-favs" onclick="FriendsUI.switchMobileTab('favourites')">
          <span class="bnav-icon">⭐</span>
          <span class="bnav-label">Favorites</span>
        </button>
        <button class="bnav-item" id="bnav-group" onclick="window.ConferenceUI && ConferenceUI.startConference()">
          <span class="bnav-icon">👥</span>
          <span class="bnav-label">Group</span>
        </button>
        <button class="bnav-item" id="bnav-settings" onclick="Settings.openSettings()">
          <span class="bnav-icon">⚙️</span>
          <span class="bnav-label">Settings</span>
        </button>
      </nav>
    </div>`;
  switchTab('contacts', document.getElementById('htab-contacts'));
}

// ── Search ────────────────────────────────────────────────
function onSearch(val) {
  _search = val.toLowerCase().trim();
  renderContactsList(getFilteredFriends(), document.getElementById('friends-body'));
}

function setFilter(filter, el) {
  _filter = filter;
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  renderContactsList(getFilteredFriends(), document.getElementById('friends-body'));
}

function getFilteredFriends() {
  let list = [..._friends];
  const favs = Settings.getFavourites();

  // Search filter
  if (_search) {
    list = list.filter(f => {
      const nick = Settings.getNickname(f.id, '').toLowerCase();
      return f.username.toLowerCase().includes(_search) || nick.includes(_search);
    });
  }

  // Tab filter
  if (_filter === 'favourites') list = list.filter(f => favs.includes(f.id));
  else if (_filter === 'online')  list = list.filter(f => f.online);
  else if (_filter === 'offline') list = list.filter(f => !f.online);

  // Sort: favs first, then online, then alpha
  list.sort((a,b) => {
    const af = favs.includes(a.id) ? 0 : 1;
    const bf = favs.includes(b.id) ? 0 : 1;
    if (af !== bf) return af - bf;
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.username.localeCompare(b.username);
  });

  return list;
}

// ── Voice search ──────────────────────────────────────────
function toggleVoiceSearch() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    App.showToast('⚠️ Voice search not supported in this browser');
    return;
  }
  const btn = document.getElementById('mic-btn');
  const inp = document.getElementById('search-inp');

  if (_recognition) {
    _recognition.stop();
    _recognition = null;
    btn?.classList.remove('listening');
    return;
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  _recognition = new SR();
  _recognition.lang = 'en-IN';
  _recognition.continuous = false;
  _recognition.interimResults = true;

  _recognition.onstart = () => {
    btn?.classList.add('listening');
    App.showToast('🎤 Listening…');
  };

  _recognition.onresult = e => {
    const transcript = e.results[0][0].transcript;
    if (inp) { inp.value = transcript; onSearch(transcript); }
  };

  _recognition.onend = () => {
    btn?.classList.remove('listening');
    _recognition = null;
  };

  _recognition.onerror = () => {
    btn?.classList.remove('listening');
    _recognition = null;
    App.showToast('⚠️ Voice search error');
  };

  _recognition.start();
}

// ── Tab switch ────────────────────────────────────────────
async function switchTab(tab, el) {
  document.querySelectorAll('.htab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  
  // Sync bottom nav active state
  document.querySelectorAll('.bnav-item').forEach(b => b.classList.remove('active'));
  if (tab === 'contacts') document.getElementById('bnav-contacts')?.classList.add('active');
  if (tab === 'recent') document.getElementById('bnav-recent')?.classList.add('active');

  const body = document.getElementById('friends-body');
  body.innerHTML = `<div class="loading-spin">Loading…</div>`;
  if (tab === 'contacts') {
    await loadFriends();
    renderContactsList(getFilteredFriends(), body);
  } else {
    const history = await loadCallHistory();
    renderCallHistory(history, body);
  }
}

function switchMobileTab(tab) {
  document.querySelectorAll('.bnav-item').forEach(b => b.classList.remove('active'));
  if (tab === 'contacts') {
    document.getElementById('bnav-contacts')?.classList.add('active');
    const htab = document.getElementById('htab-contacts');
    setFilter('all', document.querySelector('.pill[data-f="all"]'));
    switchTab('contacts', htab);
  } else if (tab === 'recent') {
    document.getElementById('bnav-recent')?.classList.add('active');
    const htab = document.getElementById('htab-recent');
    switchTab('recent', htab);
  } else if (tab === 'favourites') {
    document.getElementById('bnav-favs')?.classList.add('active');
    const pill = document.querySelector('.pill[data-f="favourites"]');
    if (pill) setFilter('favourites', pill);
    const htab = document.getElementById('htab-contacts');
    switchTab('contacts', htab);
  }
}

// ── Render contacts ───────────────────────────────────────
function renderContactsList(list, container) {
  if (!list.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">👥</div>
        <p>${_search ? 'No contacts match "'+esc(_search)+'"' : 'No contacts yet'}</p>
        ${!_search ? `<button class="btn-primary" style="margin-top:16px" onclick="FriendsUI.showAddFriend()">Find People</button>` : ''}
      </div>`; return;
  }

  const favs    = Settings.getFavourites();
  const favList = list.filter(f => favs.includes(f.id));
  const rest    = list.filter(f => !favs.includes(f.id));

  let html = '';

  if (favList.length && _filter !== 'online' && _filter !== 'offline') {
    html += `<div class="contacts-section-title">⭐ Favourites</div>`;
    html += favList.map(f => contactRowHTML(f, true)).join('');
    if (rest.length) html += `<div class="contacts-section-title">All Contacts</div>`;
  }
  html += rest.map(f => contactRowHTML(f, false)).join('');

  container.innerHTML = html;
}

function contactRowHTML(f, isFav) {
  const nick   = Settings.getNickname(f.id, f.username);
  const favs   = Settings.getFavourites();
  const active = favs.includes(f.id);
  return `
    <div class="contact-row" id="contact-${f.id}"
         oncontextmenu="event.preventDefault();FriendsUI.showContextMenu(event,'${f.id}','${esc(f.username)}')">
      <div class="contact-avatar-wrap">
        <span class="contact-avatar">${f.avatar}</span>
        <span class="status-dot ${f.online?'online':'offline'}"></span>
      </div>
      <div class="contact-info">
        <div class="contact-name">${esc(nick)}</div>
        <div class="contact-status">${f.online?'🟢 Online':'⚫ Offline'}</div>
      </div>
      <span class="fav-star ${active?'active':''}"
            onclick="FriendsUI.toggleFav('${f.id}',this)">⭐</span>
      <button class="call-btn"
        onclick="CallHandler.startCall('${f.id}','${esc(nick)}','${f.avatar}')"
        title="Call ${esc(nick)}">📞</button>
    </div>`;
}

// ── Favourites ────────────────────────────────────────────
function toggleFav(userId, starEl) {
  const isNowFav = Settings.toggleFavourite(userId);
  starEl.classList.toggle('active', isNowFav);
  App.showToast(isNowFav ? '⭐ Added to favourites' : '✨ Removed from favourites');
  renderContactsList(getFilteredFriends(), document.getElementById('friends-body'));
}

// ── Context menu (right click / long press) ───────────────
function showContextMenu(event, userId, username) {
  document.getElementById('ctx-menu')?.remove();
  const nick = Settings.getNickname(userId, username);
  const isFav = Settings.isFavourite(userId);
  const menu = document.createElement('div');
  menu.className = 'ctx-menu'; menu.id = 'ctx-menu';
  menu.style.cssText = `top:${Math.min(event.clientY, window.innerHeight-200)}px;left:${Math.min(event.clientX, window.innerWidth-200)}px`;
  menu.innerHTML = `
    <div class="ctx-item" onclick="Settings.showEditNickname('${userId}','${esc(username)}');document.getElementById('ctx-menu')?.remove()">
      ✏️ Edit Nickname
    </div>
    <div class="ctx-item" onclick="FriendsUI.toggleFavCtx('${userId}');document.getElementById('ctx-menu')?.remove()">
      ${isFav?'💔 Remove Favourite':'⭐ Add to Favourites'}
    </div>
    <div class="ctx-item" onclick="CallHandler.startCall('${userId}','${esc(nick)}','');document.getElementById('ctx-menu')?.remove()">
      📞 Call
    </div>
    <div class="ctx-item danger" onclick="FriendsUI.confirmRemove('${userId}','${esc(username)}');document.getElementById('ctx-menu')?.remove()">
      🗑️ Remove Friend
    </div>`;
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => document.getElementById('ctx-menu')?.remove(), {once:true}), 100);
}

function toggleFavCtx(userId) {
  Settings.toggleFavourite(userId);
  renderContactsList(getFilteredFriends(), document.getElementById('friends-body'));
}

function confirmRemove(userId, username) {
  if (!confirm(`Remove ${username} from contacts?`)) return;
  apiFetch(`/api/friends/${userId}`, { method:'DELETE' }).then(() => {
    loadFriends().then(() => renderContactsList(getFilteredFriends(), document.getElementById('friends-body')));
    App.showToast('✅ Contact removed');
  });
}

// ── Call history ──────────────────────────────────────────
function renderCallHistory(history, container) {
  if (!history.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>No recent calls</p></div>`;
    return;
  }
  container.innerHTML = history.map(c => {
    const isMe  = c.caller_id === _me.id;
    const other = isMe
      ? { id: c.callee_id, name: c.callee_name, avatar: c.callee_avatar }
      : { id: c.caller_id, name: c.caller_name, avatar: c.caller_avatar };
    const nick = Settings.getNickname(other.id, other.name);
    const icon = c.status==='answered' ? (isMe?'📤':'📥') : '📵';
    const dur  = c.duration
      ? `${Math.floor(c.duration/60)}:${String(c.duration%60).padStart(2,'0')}` : '';
    const date = new Date(c.created_at*1000).toLocaleString([],
      {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    return `
      <div class="history-row">
        <span class="contact-avatar">${other.avatar}</span>
        <div class="contact-info">
          <div class="contact-name">${esc(nick)}</div>
          <div class="contact-status">${icon} ${c.status}${dur?' · '+dur:''} · ${date}</div>
        </div>
        <button class="call-btn"
          onclick="CallHandler.startCall('${other.id}','${esc(nick)}','${other.avatar}')"
          title="Call back">📞</button>
      </div>`; }).join('');
}

// ── Add friend modal ──────────────────────────────────────
function showAddFriend() {
  document.getElementById('add-friend-modal')?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay'; modal.id = 'add-friend-modal';
  modal.innerHTML = `
    <div class="modal-box">
      <div class="modal-handle"></div>
      <div class="modal-head">
        <span class="modal-title">Find People</span>
        <button class="icon-btn" onclick="document.getElementById('add-friend-modal').remove()">✕</button>
      </div>
      <div class="field" style="margin:12px 0 8px">
        <input type="text" id="add-search-inp" placeholder="Search by username…"
               oninput="FriendsUI.doSearch(this.value)" autofocus/>
      </div>
      <div id="add-search-results"></div>
    </div>`;
  document.body.appendChild(modal);
}

async function doSearch(q) {
  const res = document.getElementById('add-search-results');
  if (!res) return;
  if (q.length < 2) { res.innerHTML=''; return; }
  res.innerHTML = `<div class="loading-spin">Searching…</div>`;
  const users = await searchUsers(q);
  if (!users.length) { res.innerHTML=`<div class="empty-state" style="padding:16px">No users found</div>`; return; }
  res.innerHTML = users.map(u => `
    <div class="contact-row">
      <span class="contact-avatar">${u.avatar}</span>
      <div class="contact-info">
        <div class="contact-name">${esc(u.username)}</div>
        <div class="contact-status">${u.online?'🟢 Online':'⚫ Offline'}</div>
      </div>
      <button class="btn-sm" onclick="FriendsUI.sendRequest('${u.id}',this)">Add</button>
    </div>`).join('');
}

async function sendRequest(friendId, btn) {
  btn.disabled = true;
  btn.textContent = 'Sending…';
  const r = await addFriend(friendId);
  if (r.error === 'Request already exists') {
    btn.textContent = '✓ Already sent';
    btn.style.background = 'rgba(255,209,102,0.2)';
    btn.style.color = '#ffd166';
  } else if (r.error) {
    btn.textContent = '✗ ' + r.error;
    btn.disabled = false;
  } else {
    btn.textContent = '✓ Sent!';
    btn.style.background = 'rgba(0,224,150,0.2)';
    btn.style.color = '#00e096';
  }
}

async function showPending() {
  const list  = await loadPending();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay'; modal.id = 'pending-modal';
  modal.innerHTML = `
    <div class="modal-box">
      <div class="modal-handle"></div>
      <div class="modal-head">
        <span class="modal-title">Friend Requests</span>
        <button class="icon-btn" onclick="document.getElementById('pending-modal').remove()">✕</button>
      </div>
      <div style="margin-top:12px">
        ${!list.length
          ? `<div class="empty-state" style="padding:16px">No pending requests</div>`
          : list.map(u => `
              <div class="contact-row">
                <span class="contact-avatar">${u.avatar}</span>
                <div class="contact-info"><div class="contact-name">${esc(u.username)}</div></div>
                <button class="btn-sm btn-green"
                        onclick="FriendsUI.acceptRequest('${u.id}',this)">Accept</button>
              </div>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(modal);
}

async function acceptRequest(friendId, btn) {
  btn.disabled=true; btn.textContent='Accepting…';
  await acceptFriend(friendId);
  btn.textContent='✓ Added';
  await loadFriends();
}

function updateOnlineStatus(userId, online) {
  // Fix: ensure _friends is always an array before mapping
  if (!Array.isArray(_friends)) _friends = [];
  
  _friends = _friends.map(f => f.id === userId ? {...f, online} : f);
  const dot  = document.querySelector(`#contact-${userId} .status-dot`);
  const stat = document.querySelector(`#contact-${userId} .contact-status`);
  if (dot)  dot.className    = `status-dot ${online ? 'online' : 'offline'}`;
  if (stat) stat.textContent = online ? '🟢 Online' : '⚫ Offline';
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;');
}

// Helper for conference invite picker — returns online friends
function getOnlineFriends() {
  return _friends.filter(f => f.online);
}

window.FriendsUI = {
  init, renderFriendsScreen, switchTab, switchMobileTab,
  onSearch, setFilter, toggleVoiceSearch,
  showAddFriend, doSearch, sendRequest,
  showPending, acceptRequest,
  updateOnlineStatus, loadFriends,
  toggleFav, toggleFavCtx,
  showContextMenu, confirmRemove,
  getOnlineFriends,
};
