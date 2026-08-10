const router = require('express').Router();
const User   = require('../models/User');
const authMW = require('../middleware/auth');

router.get('/search', authMW, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    res.json(await User.search(q, req.user.id));
  } catch(e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', authMW, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch(e) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;