const API = '/api/auth';

async function register({ username, password, avatar }) {
  const res = await fetch(`${API}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, avatar }),
  });
  return res.json();
}

async function login({ username, password }) {
  const res = await fetch(`${API}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return res.json();
}

function saveSession(token, user) {
  localStorage.setItem('rp_token', token);
  localStorage.setItem('rp_user', JSON.stringify(user));
}

function getSession() {
  const token = localStorage.getItem('rp_token');
  const user  = JSON.parse(localStorage.getItem('rp_user') || 'null');
  return { token, user };
}

function clearSession() {
  localStorage.removeItem('rp_token');
  localStorage.removeItem('rp_user');
}

function isLoggedIn() {
  const { token } = getSession();
  if (!token) return false;
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return false;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    return payload.exp * 1000 > Date.now();
  } catch { return false; }
}

// ── Auth UI ───────────────────────────────────────────────
function renderAuthScreen() {
  const screen = document.getElementById('screen-auth');
  screen.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-logo">
        <div class="auth-logo-icon">📞</div>
        <div class="auth-logo-text">RingUp</div>
        <div class="auth-logo-sub">Voice calls, anywhere</div>
      </div>
      <div class="auth-card">
        <div class="auth-tabs">
          <button class="auth-tab active" onclick="AuthUI.showLogin()">Login</button>
          <button class="auth-tab"        onclick="AuthUI.showRegister()">Register</button>
        </div>
        <div id="auth-form-area"></div>
      </div>
    </div>`;
  showLoginForm();
}

function showLoginForm() {
  document.querySelectorAll('.auth-tab').forEach((t,i) =>
    t.classList.toggle('active', i === 0)
  );
  document.getElementById('auth-form-area').innerHTML = `
    <div class="auth-error" id="auth-error" style="display:none"></div>
    <div class="field">
      <label>Username</label>
      <input type="text" id="inp-username" placeholder="your username"
             autocomplete="username"/>
    </div>
    <div class="field">
      <label>Password</label>
      <input type="password" id="inp-password" placeholder="••••••••"
             autocomplete="current-password"
             onkeydown="if(event.key==='Enter') AuthUI.submitLogin()"/>
    </div>
    <button class="btn-primary full" onclick="AuthUI.submitLogin()">Login</button>`;
}

function showRegisterForm() {
  document.querySelectorAll('.auth-tab').forEach((t,i) =>
    t.classList.toggle('active', i === 1)
  );
  const avatars = ['🦊','🐺','🐻','🐼','🦁','🐯','🐸','🦉','🦅','🐙','🦋','🌊','🌸','🌙','⭐','🔥'];
  document.getElementById('auth-form-area').innerHTML = `
    <div class="auth-error" id="auth-error" style="display:none"></div>
    <div class="field">
      <label>Pick your avatar</label>
      <div class="avatar-picker">
        ${avatars.map((a,i) =>
          `<span class="av-opt${i===0?' selected':''}" data-av="${a}"
                 onclick="AuthUI.pickAvatar(this)">${a}</span>`
        ).join('')}
      </div>
    </div>
    <div class="field">
      <label>Username</label>
      <input type="text" id="inp-username" placeholder="choose a username"
             autocomplete="username"/>
    </div>
    <div class="field">
      <label>Password</label>
      <input type="password" id="inp-password" placeholder="min 6 characters"
             autocomplete="new-password"
             onkeydown="if(event.key==='Enter') AuthUI.submitRegister()"/>
    </div>
    <button class="btn-primary full" onclick="AuthUI.submitRegister()">Create Account</button>`;
}

function pickAvatar(el) {
  document.querySelectorAll('.av-opt').forEach(x => x.classList.remove('selected'));
  el.classList.add('selected');
}

function showError(msg) {
  const el = document.getElementById('auth-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function setLoading(loading, label) {
  const btn = document.querySelector('#auth-form-area .btn-primary');
  if (btn) { btn.disabled = loading; btn.textContent = loading ? 'Please wait…' : label; }
}

async function submitLogin() {
  const username = document.getElementById('inp-username')?.value.trim();
  const password = document.getElementById('inp-password')?.value;
  if (!username || !password) return showError('Please fill all fields');
  setLoading(true, 'Login');
  try {
    const data = await login({ username, password });
    setLoading(false, 'Login');
    if (data.error) return showError(data.error);
    saveSession(data.token, data.user);
    window.App.afterLogin(data.token, data.user);
  } catch(e) {
    setLoading(false, 'Login');
    showError('Network error — please try again');
  }
}

async function submitRegister() {
  const username = document.getElementById('inp-username')?.value.trim();
  const password = document.getElementById('inp-password')?.value;
  const avatar   = document.querySelector('.av-opt.selected')?.dataset.av || '🦊';
  if (!username || !password) return showError('Please fill all fields');
  setLoading(true, 'Create Account');
  try {
    const data = await register({ username, password, avatar });
    setLoading(false, 'Create Account');
    if (data.error) return showError(data.error);
    saveSession(data.token, data.user);
    window.App.afterLogin(data.token, data.user);
  } catch(e) {
    setLoading(false, 'Create Account');
    showError('Network error — please try again');
  }
}

window.AuthUI = {
  renderAuthScreen,
  showLogin:      showLoginForm,
  showRegister:   showRegisterForm,
  pickAvatar,
  submitLogin,
  submitRegister,
  getSession,
  clearSession,
  isLoggedIn,
  saveSession,
};