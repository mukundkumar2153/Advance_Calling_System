const { Pool } = require('pg');

let pool = null;

async function initDB() {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
      require: true,
    },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  });

  // Test connection
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('[DB] Supabase PostgreSQL connected ✅');
  } catch(e) {
    console.error('[DB] Connection failed:', e.message);
    throw e;
  }

  await createTables();
  return pool;
}

async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      username   TEXT UNIQUE NOT NULL,
      password   TEXT NOT NULL,
      avatar     TEXT DEFAULT '🦊',
      fcm_token  TEXT,
      online     INTEGER DEFAULT 0,
      last_seen  BIGINT DEFAULT FLOOR(EXTRACT(EPOCH FROM NOW()))::BIGINT,
      created_at BIGINT DEFAULT FLOOR(EXTRACT(EPOCH FROM NOW()))::BIGINT
    );

    CREATE TABLE IF NOT EXISTS friends (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      friend_id  TEXT NOT NULL,
      status     TEXT DEFAULT 'pending',
      created_at BIGINT DEFAULT FLOOR(EXTRACT(EPOCH FROM NOW()))::BIGINT,
      UNIQUE(user_id, friend_id)
    );

    CREATE TABLE IF NOT EXISTS call_logs (
      id         TEXT PRIMARY KEY,
      caller_id  TEXT NOT NULL,
      callee_id  TEXT NOT NULL,
      status     TEXT DEFAULT 'missed',
      duration   INTEGER DEFAULT 0,
      created_at BIGINT DEFAULT FLOOR(EXTRACT(EPOCH FROM NOW()))::BIGINT
    );
  `);
  console.log('[DB] Tables verified ✅');
}

// ── Query helpers ─────────────────────────────────────────
// Converts $1 $2 style params — matches better-sqlite3 API shape

function prepare(sql) {
  // Convert SQLite ? placeholders to PostgreSQL $1 $2 $3
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);

  return {
    // Returns nothing (INSERT/UPDATE/DELETE)
    run: async (...params) => {
      const flat = params.flat();
      try {
        const result = await pool.query(pgSql, flat);
        return { changes: result.rowCount };
      } catch(e) {
        // Ignore unique constraint violations silently
        if (e.code === '23505') return { changes: 0 };
        throw e;
      }
    },

    // Returns single row
    get: async (...params) => {
      const flat = params.flat();
      const result = await pool.query(pgSql, flat);
      return result.rows[0] || undefined;
    },

    // Returns all rows
    all: async (...params) => {
      const flat = params.flat();
      const result = await pool.query(pgSql, flat);
      return result.rows;
    },
  };
}

// Direct query for complex SQL
async function query(sql, params = []) {
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  const result = await pool.query(pgSql, params);
  return result.rows;
}

function getDB() {
  if (!pool) throw new Error('[DB] Not initialised! Call initDB() first.');
  return { prepare, query };
}

module.exports = { initDB, getDB };