// ── Settings Manager ──────────────────────────────────────
const THEMES = {
  'dark-blue':    { name: 'Dark Blue',    bg: '#080b14', bg2: '#0d1120', surface: '#161d2e', accent: '#4f7aff',  accent2: '#7c5cfc' },
  'forest':       { name: 'Forest',       bg: '#080e08', bg2: '#0d1a0d', surface: '#142014', accent: '#22c55e',  accent2: '#16a34a' },
  'purple-night': { name: 'Purple Night', bg: '#0d080e', bg2: '#180d1a', surface: '#220e24', accent: '#a855f7',  accent2: '#7c3aed' },
  'crimson':      { name: 'Crimson',      bg: '#0e0808', bg2: '#1a0d0d', surface: '#240e0e', accent: '#ef4444',  accent2: '#dc2626' },
  'ocean':        { name: 'Ocean',        bg: '#080e0e', bg2: '#0d1a1a', surface: '#0e2222', accent: '#06b6d4',  accent2: '#0891b2' },
  'light':        { name: 'Light',        bg: '#f0f4ff', bg2: '#e8edf8', surface: '#ffffff', accent: '#4f7aff',  accent2: '#7c5cfc' },
  'amber':        { name: 'Amber',        bg: '#0e0a04', bg2: '#1a1206', surface: '#241808', accent: '#f59e0b',  accent2: '#d97706' },
  'midnight':     { name: 'Midnight',     bg: '#080808', bg2: '#111111', surface: '#1a1a1a', accent: '#6366f1',  accent2: '#4f46e5' },
};

const RINGTONES = [
  { id: 'classic', name: 'Classic Ring', emoji: '🎵', file: '/audio/ringtone.mp3' },
  { id: 'guitar',  name: 'Guitar',       emoji: '🎸', file: '/audio/guitar.mp3'   },
  { id: 'piano',   name: 'Piano',        emoji: '🎹', file: '/audio/piano.mp3'    },
  { id: 'marimba', name: 'Marimba',      emoji: '🎶', file: '/audio/marimba.mp3'  },
  { id: 'digital', name: 'Digital',      emoji: '📳', file: '/audio/digital.mp3'  },
  { id: 'soft',    name: 'Soft Chime',   emoji: '🔔', file: '/audio/soft.mp3'     },
];

const ANIMATIONS = [
  { id: 'pulse',     name: 'Pulse Rings', emoji: '⭕', desc: 'Classic expanding rings' },
  { id: 'wave',      name: 'Wave',        emoji: '🌊', desc: 'Flowing wave effect'     },
  { id: 'bounce',    name: 'Bounce',      emoji: '⚡', desc: 'Energetic bounce'        },
  { id: 'glow',      name: 'Glow',        emoji: '✨', desc: 'Soft neon glow'          },
  { id: 'spiral',    name: 'Spiral',      emoji: '🌀', desc: 'Spinning spiral'         },
  { id: 'heartbeat', name: 'Heartbeat',   emoji: '💓', desc: 'Heartbeat pulse'         },
];

// ── Settings user state ───────────────────────────────────
let _settingsMe    = null;
let _settingsToken = null;

function setSettingsUser(me, token) {
  _settingsMe    = me;
  _settingsToken = token;
}

function openSettings() {
  if (!_settingsMe || !_settingsToken) {
    const { token, user } = AuthUI.getSession();
    _settingsMe    = user;
    _settingsToken = token;
  }
  renderSettingsScreen(_settingsMe, _settingsToken);
}

// ── Load / Save ───────────────────────────────────────────
function loadSettings() {
  try { return JSON.parse(localStorage.getItem('rp_settings') || '{}'); }
  catch { return {}; }
}

function saveSettings(s) {
  localStorage.setItem('rp_settings', JSON.stringify(s));
}

function getSetting(key, defaultVal) {
  return loadSettings()[key] ?? defaultVal;
}

function setSetting(key, value) {
  const s = loadSettings();
  s[key] = value;
  saveSettings(s);
}

// ── Apply theme ───────────────────────────────────────────
function applyTheme(themeId) {
  const theme = THEMES[themeId] || THEMES['dark-blue'];
  const root  = document.documentElement;
  root.style.setProperty('--bg',      theme.bg);
  root.style.setProperty('--bg2',     theme.bg2);
  root.style.setProperty('--surface', theme.surface);
  root.style.setProperty('--accent',  theme.accent);
  root.style.setProperty('--accent2', theme.accent2);
  if (themeId === 'light') {
    root.style.setProperty('--text',   '#1a1f36');
    root.style.setProperty('--text2',  '#5a6180');
    root.style.setProperty('--text3',  '#9aa0be');
    root.style.setProperty('--border', 'rgba(79,100,180,0.15)');
  } else {
    root.style.setProperty('--text',   '#e8eaf6');
    root.style.setProperty('--text2',  '#8892b0');
    root.style.setProperty('--text3',  '#4a5580');
    root.style.setProperty('--border', 'rgba(99,120,200,0.12)');
  }
  setSetting('theme', themeId);
}

function initSettings() {
  applyTheme(getSetting('theme', 'dark-blue'));
}

// ── Ringtone ──────────────────────────────────────────────
function getRingtoneFile() {
  const id = getSetting('ringtone', 'classic');
  const rt = RINGTONES.find(r => r.id === id);
  return rt?.file || '/audio/ringtone.mp3';
}

// ── Animation ─────────────────────────────────────────────
function getAnimationClass() {
  return 'anim-' + getSetting('animation', 'pulse');
}

// ── Favourites ────────────────────────────────────────────
function getFavourites() {
  return getSetting('favourites', []);
}

function toggleFavourite(userId) {
  const favs = getFavourites();
  const idx  = favs.indexOf(userId);
  if (idx >= 0) favs.splice(idx, 1);
  else          favs.push(userId);
  setSetting('favourites', favs);
  return favs.includes(userId);
}

function isFavourite(userId) {
  return getFavourites().includes(userId);
}

// ── Nicknames ─────────────────────────────────────────────
function getNicknames() {
  return getSetting('nicknames', {});
}

function setNickname(userId, name) {
  const n = getNicknames();
  if (name.trim()) n[userId] = name.trim();
  else delete n[userId];
  setSetting('nicknames', n);
}

function getNickname(userId, fallback) {
  return getNicknames()[userId] || fallback;
}

// ── Recording ─────────────────────────────────────────────
let _mediaRecorder  = null;
let _recordedChunks = [];
let _recordingStart = null;

function startRecording(stream) {
  if (!getSetting('recording', false)) return;
  if (!stream || !window.MediaRecorder) return;
  try {
    _recordedChunks = [];
    _mediaRecorder  = new MediaRecorder(stream);
    _mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) _recordedChunks.push(e.data);
    };
    _mediaRecorder.start(1000);
    _recordingStart = Date.now();
    console.log('[Recording] Started');
  } catch(e) {
    console.warn('[Recording] Failed:', e);
  }
}

function stopRecording(callerName) {
  if (!_mediaRecorder || _mediaRecorder.state === 'inactive') return;
  _mediaRecorder.onstop = () => {
    const blob = new Blob(_recordedChunks, { type: 'audio/webm' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `RingUp_${callerName}_${new Date().toISOString().slice(0,19)}.webm`;
    a.click();
    URL.revokeObjectURL(url);
    _recordedChunks = [];
  };
  _mediaRecorder.stop();
  _mediaRecorder = null;
}

// ── Edit username ─────────────────────────────────────────
function showEditUsername() {
  const { token, user } = AuthUI.getSession();
  if (!user) return;

  document.getElementById('edit-username-modal')?.remove();

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'edit-username-modal';
  modal.innerHTML = `
    <div class="modal-box">
      <div class="modal-handle"></div>
      <div class="modal-head">
        <span class="modal-title">✏️ Edit Username</span>
        <button class="icon-btn"
          onclick="document.getElementById('edit-username-modal').remove()">✕</button>
      </div>
      <div class="field" style="margin-top:16px">
        <label>New Username</label>
        <input type="text" id="new-username-inp"
               value="${esc(user.username)}"
               placeholder="letters, numbers, underscore only"
               maxlength="24"
               onkeydown="if(event.key==='Enter') Settings.submitUsername()"/>
      </div>
      <div class="auth-error" id="edit-user-err" style="display:none"></div>
      <button class="btn-primary full"
              onclick="Settings.submitUsername()">Save Username</button>
    </div>`;
  document.body.appendChild(modal);
  setTimeout(() => document.getElementById('new-username-inp')?.focus(), 100);
}

async function submitUsername() {
  const { token, user } = AuthUI.getSession();
  const inp = document.getElementById('new-username-inp');
  const err = document.getElementById('edit-user-err');
  const val = inp?.value.trim();

  if (!val || val.length < 3) {
    if (err) { err.textContent = 'Min 3 characters'; err.style.display = 'block'; }
    return;
  }
  if (!/^[a-zA-Z0-9_]+$/.test(val)) {
    if (err) { err.textContent = 'Only letters, numbers and underscore'; err.style.display = 'block'; }
    return;
  }

  const btn = document.querySelector('#edit-username-modal .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    const res  = await fetch('/api/auth/update-username', {
      method:  'PUT',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ username: val }),
    });
    const data = await res.json();

    if (data.error) {
      if (err) { err.textContent = data.error; err.style.display = 'block'; }
      if (btn) { btn.disabled = false; btn.textContent = 'Save Username'; }
      return;
    }

    const updated = { ...user, username: val };
    AuthUI.saveSession(token, updated);
    setSettingsUser(updated, token);
    document.getElementById('edit-username-modal')?.remove();
    App.showToast('✅ Username updated to ' + val);
    openSettings();

  } catch(e) {
    if (err) { err.textContent = 'Server error — try again'; err.style.display = 'block'; }
    if (btn) { btn.disabled = false; btn.textContent = 'Save Username'; }
  }
}

// ── Edit nickname ─────────────────────────────────────────
function showEditNickname(userId, currentName) {
  const existing = getNickname(userId, '');
  document.getElementById('edit-nick-modal')?.remove();

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'edit-nick-modal';
  modal.innerHTML = `
    <div class="modal-box">
      <div class="modal-handle"></div>
      <div class="modal-head">
        <span class="modal-title">✏️ Nickname for ${esc(currentName)}</span>
        <button class="icon-btn"
          onclick="document.getElementById('edit-nick-modal').remove()">✕</button>
      </div>
      <div class="field" style="margin-top:16px">
        <label>Nickname (leave blank to reset)</label>
        <input type="text" id="nick-inp"
               value="${esc(existing)}"
               placeholder="e.g. Best Friend"
               maxlength="24"/>
      </div>
      <button class="btn-primary full"
              onclick="Settings.saveNickname('${userId}','${esc(currentName)}')">
        Save
      </button>
    </div>`;
  document.body.appendChild(modal);
  setTimeout(() => document.getElementById('nick-inp')?.focus(), 100);
}

function saveNickname(userId, originalName) {
  const val = document.getElementById('nick-inp')?.value || '';
  setNickname(userId, val);
  document.getElementById('edit-nick-modal')?.remove();
  App.showToast(val ? '✅ Nickname: ' + val : '✅ Nickname cleared');
  if (window.FriendsUI) {
    FriendsUI.loadFriends().then(() => FriendsUI.renderFriendsScreen());
  }
}

// ── Render settings screen ────────────────────────────────
function renderSettingsScreen(me, token) {
  if (!me || !token) {
    const session = AuthUI.getSession();
    me    = session.user;
    token = session.token;
  }

  App.showScreen('screen-settings');
  const s = loadSettings();

  document.getElementById('screen-settings').innerHTML = `
    <div class="settings-wrap">
      <div class="settings-header">
        <button class="back-btn-s" onclick="App.showScreen('screen-home')">← Back</button>
        <div class="settings-title">Settings</div>
      </div>
      <div class="settings-body">

        <div class="s-section-label">Profile</div>
        <div class="s-card">
          <div class="s-profile-top">
            <div class="s-av-big">${me.avatar || '🦊'}</div>
            <div>
              <div class="s-profile-name">${esc(me.username)}</div>
              <div class="s-profile-sub">@${esc(me.username)}</div>
            </div>
          </div>
        </div>

        <div class="s-row-item" onclick="Settings.showEditUsername()">
          <div class="s-row-left">
            <div class="s-icon-box" style="background:rgba(79,122,255,.15)">✏️</div>
            <div>
              <div class="s-row-label">Edit Username</div>
              <div class="s-row-sub">${esc(me.username)}</div>
            </div>
          </div>
          <span class="s-chevron">›</span>
        </div>

        <div class="s-section-label">Appearance</div>
        <div class="s-row-item s-row-block">
          <div class="s-row-left">
            <div class="s-icon-box" style="background:rgba(0,229,255,.12)">🎨</div>
            <div>
              <div class="s-row-label">Theme</div>
              <div class="s-row-sub" id="theme-name-lbl">
                ${THEMES[s.theme||'dark-blue'].name}
              </div>
            </div>
          </div>
          <div class="theme-swatches">
            ${Object.entries(THEMES).map(([id, t]) => `
              <div class="theme-swatch ${(s.theme||'dark-blue')===id?'active':''}"
                   data-theme="${id}" title="${t.name}"
                   style="background:${t.bg};border:2px solid ${t.accent}"
                   onclick="Settings.pickTheme('${id}')"></div>
            `).join('')}
          </div>
        </div>

        <div class="s-section-label">Call Animation</div>
        <div class="anim-grid">
          ${ANIMATIONS.map(a => `
            <div class="anim-card ${(s.animation||'pulse')===a.id?'active':''}"
                 onclick="Settings.pickAnimation('${a.id}')">
              <div class="anim-emoji">${a.emoji}</div>
              <div class="anim-name">${a.name}</div>
            </div>
          `).join('')}
        </div>

        <div class="s-section-label">Ringtone</div>
        <div class="ringtone-list">
          ${RINGTONES.map(r => `
            <div class="rt-row ${(s.ringtone||'classic')===r.id?'active':''}"
                 onclick="Settings.pickRingtone('${r.id}','${r.file}')">
              <div class="rt-left">
                <span class="rt-emoji">${r.emoji}</span>
                <span class="rt-name">${r.name}</span>
              </div>
              <button class="rt-play-btn"
                onclick="event.stopPropagation();Settings.previewRingtone('${r.file}')">
                ▶
              </button>
            </div>
          `).join('')}
        </div>

        <div class="s-section-label">Features</div>

        <div class="s-row-item">
          <div class="s-row-left">
            <div class="s-icon-box" style="background:rgba(255,79,106,.12)">🎙️</div>
            <div>
              <div class="s-row-label">Call Recording</div>
              <div class="s-row-sub">Auto-save calls as audio</div>
            </div>
          </div>
          <div class="toggle-sw ${s.recording?'on':''}" id="tog-recording"
               onclick="Settings.toggleFeature('recording','tog-recording')"></div>
        </div>

        <div class="s-row-item">
          <div class="s-row-left">
            <div class="s-icon-box" style="background:rgba(255,209,102,.12)">👻</div>
            <div>
              <div class="s-row-label">Ghost Mode</div>
              <div class="s-row-sub">Appear offline to others</div>
            </div>
          </div>
          <div class="toggle-sw ${s.ghostMode?'on':''}" id="tog-ghost"
               onclick="Settings.toggleFeature('ghostMode','tog-ghost')"></div>
        </div>

        <div class="s-row-item">
          <div class="s-row-left">
            <div class="s-icon-box" style="background:rgba(0,224,150,.12)">🔔</div>
            <div>
              <div class="s-row-label">Notifications</div>
              <div class="s-row-sub">Browser push alerts</div>
            </div>
          </div>
          <div class="toggle-sw ${s.notifications!==false?'on':''}" id="tog-notif"
               onclick="Settings.toggleFeature('notifications','tog-notif')"></div>
        </div>

        <div class="s-section-label">Account</div>
        <div class="s-row-item" onclick="App.logout()">
          <div class="s-row-left">
            <div class="s-icon-box" style="background:rgba(255,79,106,.12)">🚪</div>
            <div>
              <div class="s-row-label" style="color:var(--red)">Logout</div>
            </div>
          </div>
          <span class="s-chevron">›</span>
        </div>

        <div style="height:40px"></div>
      </div>
    </div>`;
}

// ── Pick theme ────────────────────────────────────────────
function pickTheme(id) {
  applyTheme(id);
  document.querySelectorAll('.theme-swatch').forEach(s =>
    s.classList.toggle('active', s.dataset.theme === id)
  );
  const lbl = document.getElementById('theme-name-lbl');
  if (lbl) lbl.textContent = THEMES[id]?.name || id;
  App.showToast('🎨 Theme: ' + (THEMES[id]?.name || id));
}

// ── Pick animation ────────────────────────────────────────
function pickAnimation(id) {
  setSetting('animation', id);
  document.querySelectorAll('.anim-card').forEach(c => {
    const match = c.getAttribute('onclick')?.includes(`'${id}'`);
    c.classList.toggle('active', !!match);
  });
  App.showToast('✨ Animation: ' + (ANIMATIONS.find(a=>a.id===id)?.name || id));
}

// ── Pick ringtone ─────────────────────────────────────────
let _previewAudio = null;

function pickRingtone(id, file) {
  setSetting('ringtone', id);
  document.querySelectorAll('.rt-row').forEach(r => {
    const match = r.getAttribute('onclick')?.includes(`'${id}'`);
    r.classList.toggle('active', !!match);
  });
  previewRingtone(file);
  App.showToast('🎵 Ringtone: ' + (RINGTONES.find(r=>r.id===id)?.name || id));
}

function previewRingtone(file) {
  if (_previewAudio) { _previewAudio.pause(); _previewAudio = null; }
  try {
    _previewAudio = new Audio(file);
    _previewAudio.volume = 0.6;
    _previewAudio.play().catch(() => App.showToast('⚠️ Audio file not found'));
    setTimeout(() => {
      if (_previewAudio) { _previewAudio.pause(); _previewAudio = null; }
    }, 3000);
  } catch(e) {
    App.showToast('⚠️ Cannot preview audio');
  }
}

// ── Toggle feature ────────────────────────────────────────
function toggleFeature(key, togId) {
  const cur = getSetting(key, key === 'notifications');
  setSetting(key, !cur);
  document.getElementById(togId)?.classList.toggle('on', !cur);
  App.showToast(!cur ? '✅ ' + key + ' enabled' : '❌ ' + key + ' disabled');
}

// ── Helper ────────────────────────────────────────────────
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;');
}

// ── EXPORTS ───────────────────────────────────────────────
window.Settings = {
  renderSettingsScreen,
  openSettings,
  setSettingsUser,
  initSettings,
  pickTheme,
  pickAnimation,
  pickRingtone,
  previewRingtone,
  toggleFeature,
  showEditUsername,
  submitUsername,
  showEditNickname,
  saveNickname,
  getRingtoneFile,
  getAnimationClass,
  toggleFavourite,
  isFavourite,
  getFavourites,
  getNickname,
  startRecording,
  stopRecording,
  getSetting,
};
