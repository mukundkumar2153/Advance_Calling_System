const router  = require('express').Router();
const Friend  = require('../models/Friend');
const CallLog = require('../models/CallLog');
const authMW  = require('../middleware/auth');

router.get('/', authMW, async (req, res) => {
  try { res.json(await Friend.list(req.user.id)); }
  catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/pending', authMW, async (req, res) => {
  try { res.json(await Friend.pending(req.user.id)); }
  catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/add', authMW, async (req, res) => {
  try {
    const { friendId } = req.body;
    if (!friendId) return res.status(400).json({ error: 'friendId required' });
    if (friendId === req.user.id)
      return res.status(400).json({ error: 'Cannot add yourself' });
    const result = await Friend.add(req.user.id, friendId);
    if (!result.success) return res.status(409).json({ error: result.error });
    res.json({ success: true });
  } catch(e) {
    console.error('[Friends] Add error:', e.message);
    res.status(500).json({ error: e.message });
  }
});
router.put('/accept', authMW, async (req, res) => {
  try {
    const { friendId } = req.body;
    if (!friendId) return res.status(400).json({ error: 'friendId required' });
    await Friend.accept(req.user.id, friendId);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:friendId', authMW, async (req, res) => {
  try {
    await Friend.remove(req.user.id, req.params.friendId);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/calls/history', authMW, async (req, res) => {
  try { res.json(await CallLog.history(req.user.id)); }
  catch(e) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;