require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const path       = require('path');

async function main() {
  // 1. Init DB first — everything depends on it
  const { initDB }       = require('./config/db');
  const { initFCM } = require('./config/firebase');
  await initDB();
  initFCM();

  // 2. Load routes AFTER db is ready
  const authRoutes    = require('./routes/auth');
  const usersRoutes   = require('./routes/users');
  const friendsRoutes = require('./routes/friends');
  const { registerSignaling } = require('./socket/signaling');

  const app    = express();
  const server = http.createServer(app);
  const io     = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'client')));

  app.use('/api/auth',    authRoutes);
  app.use('/api/users',   usersRoutes);
  app.use('/api/friends', friendsRoutes);
  app.get('/api/ping', (_, res) => res.json({ ok: true }));
  app.get('*', (_, res) =>
    res.sendFile(path.join(__dirname, '..', 'client', 'index.html'))
  );

  registerSignaling(io);

  const PORT = process.env.PORT || 8888;
  server.listen(PORT, () =>
    console.log(`\n🚀 RingUp → http://localhost:${PORT}\n`)
  );
}

main().catch(e => { console.error('Startup error:', e); process.exit(1); });