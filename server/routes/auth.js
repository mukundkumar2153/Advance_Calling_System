const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const User   = require('../models/User');
const authMW = require('../middleware/auth');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, password, avatar } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });
    if (username.length < 3)
      return res.status(400).json({ error: 'Username min 3 characters' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password min 6 characters' });

    const existing = await User.findByUsername(username);
    if (existing)
      return res.status(409).json({ error: 'Username already taken' });

    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hash, avatar });
    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );
    res.json({ token, user });
  } catch(e) {
    console.error('[Auth] Register error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });

    const user = await User.findByUsername(username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );
    const { password: _, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch(e) {
    console.error('[Auth] Login error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/fcm-token
router.post('/fcm-token', authMW, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) return res.status(400).json({ error: 'fcmToken required' });
    await User.saveFcmToken(req.user.id, fcmToken);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me
router.get('/me', authMW, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch(e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/auth/update-username
router.put('/update-username', authMW, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username || username.length < 3)
      return res.status(400).json({ error: 'Min 3 characters' });
    if (username.length > 24)
      return res.status(400).json({ error: 'Max 24 characters' });
    if (!/^[a-zA-Z0-9_]+$/.test(username))
      return res.status(400).json({ error: 'Only letters, numbers, underscore' });

    const existing = await User.findByUsername(username);
    if (existing && existing.id !== req.user.id)
      return res.status(409).json({ error: 'Username already taken' });

    const updated = await User.updateUsername(req.user.id, username);
    res.json({ success: true, user: updated });
  } catch(e) {
    console.error('[Auth] Update username error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;