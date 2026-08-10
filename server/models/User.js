const { getDB }    = require('../config/db');
const { v4: uuid } = require('uuid');

const User = {
  async create({ username, password, avatar }) {
    const id = uuid();
    await getDB().prepare(
      `INSERT INTO users (id, username, password, avatar) VALUES (?,?,?,?)`
    ).run(id, username, password, avatar || '🦊');
    return this.findById(id);
  },

  async findById(id) {
    return getDB().prepare(
      `SELECT id,username,avatar,online,last_seen,created_at FROM users WHERE id=?`
    ).get(id);
  },

  async findByUsername(username) {
    return getDB().prepare(
      `SELECT * FROM users WHERE username=?`
    ).get(username);
  },

  async search(query, excludeId) {
    return getDB().prepare(
      `SELECT id,username,avatar,online,last_seen FROM users
       WHERE LOWER(username) LIKE LOWER(?) AND id != ? LIMIT 20`
    ).all(`%${query}%`, excludeId);
  },

  async setOnline(id, online) {
    await getDB().prepare(
      `UPDATE users SET online=?, last_seen=EXTRACT(EPOCH FROM NOW()) WHERE id=?`
    ).run(online ? 1 : 0, id);
  },

  async saveFcmToken(id, token) {
    await getDB().prepare(
      `UPDATE users SET fcm_token=? WHERE id=?`
    ).run(token, id);
  },

  async getFcmToken(id) {
    const row = await getDB().prepare(
      `SELECT fcm_token FROM users WHERE id=?`
    ).get(id);
    return row?.fcm_token || null;
  },

  async updateUsername(id, username) {
    await getDB().prepare(
      `UPDATE users SET username=? WHERE id=?`
    ).run(username, id);
    return this.findById(id);
  },
};

module.exports = User;