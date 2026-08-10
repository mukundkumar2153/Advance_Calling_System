const { getDB }    = require('../config/db');
const { v4: uuid } = require('uuid');

const CallLog = {
  async create(callerId, calleeId) {
    const id = uuid();
    await getDB().prepare(
      `INSERT INTO call_logs (id,caller_id,callee_id,status) VALUES (?,?,?,'calling')`
    ).run(id, callerId, calleeId);
    return id;
  },

  async updateStatus(id, status, duration = 0) {
    await getDB().prepare(
      `UPDATE call_logs SET status=?, duration=? WHERE id=?`
    ).run(status, duration, id);
  },

  async history(userId) {
    return getDB().prepare(`
      SELECT cl.*,
        cu.username AS caller_name, cu.avatar AS caller_avatar,
        ce.username AS callee_name, ce.avatar AS callee_avatar
      FROM call_logs cl
      JOIN users cu ON cu.id = cl.caller_id
      JOIN users ce ON ce.id = cl.callee_id
      WHERE cl.caller_id=? OR cl.callee_id=?
      ORDER BY cl.created_at DESC LIMIT 50
    `).all(userId, userId);
  },
};

module.exports = CallLog;