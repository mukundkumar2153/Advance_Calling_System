const { getDB }    = require('../config/db');
const { v4: uuid } = require('uuid');

const Friend = {
  async add(userId, friendId) {
    try {
      await getDB().prepare(
        `INSERT INTO friends (id,user_id,friend_id,status) VALUES (?,?,?,'pending')`
      ).run(uuid(), userId, friendId);
      return { success: true };
    } catch(e) {
      return { success: false, error: 'Request already exists' };
    }
  },

  async accept(userId, friendId) {
    const db = getDB();
    // 1. Update sender's request to accepted
    await db.prepare(
      `UPDATE friends SET status='accepted' WHERE user_id=? AND friend_id=?`
    ).run(friendId, userId);

    // 2. Ensure reciprocal friend row exists and is accepted
    const reciprocal = await db.prepare(
      `SELECT id FROM friends WHERE user_id=? AND friend_id=?`
    ).get(userId, friendId);

    if (reciprocal) {
      await db.prepare(
        `UPDATE friends SET status='accepted' WHERE user_id=? AND friend_id=?`
      ).run(userId, friendId);
    } else {
      await db.prepare(
        `INSERT INTO friends (id,user_id,friend_id,status) VALUES (?,?,?,'accepted')`
      ).run(uuid(), userId, friendId);
    }
  },

  async remove(userId, friendId) {
    await getDB().prepare(
      `DELETE FROM friends WHERE
       (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)`
    ).run(userId, friendId, friendId, userId);
  },

  async list(userId) {
    return getDB().prepare(`
      SELECT u.id, u.username, u.avatar, u.online, u.last_seen, f.status
      FROM friends f
      JOIN users u ON u.id = f.friend_id
      WHERE f.user_id=? AND f.status='accepted'
      ORDER BY u.online DESC, u.username ASC
    `).all(userId);
  },

  async pending(userId) {
    return getDB().prepare(`
      SELECT u.id, u.username, u.avatar, f.created_at
      FROM friends f
      JOIN users u ON u.id = f.user_id
      WHERE f.friend_id=? AND f.status='pending'
    `).all(userId);
  },

  async areFriends(a, b) {
    const row = await getDB().prepare(
      `SELECT 1 FROM friends WHERE user_id=? AND friend_id=? AND status='accepted'`
    ).get(a, b);
    return !!row;
  },
};

module.exports = Friend;