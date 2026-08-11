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

  // ICE servers endpoint — returns TURN + STUN for NAT traversal (long-distance calling)
  app.get('/api/ice-servers', (_, res) => {
    res.json({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // Free public TURN servers — relay traffic when STUN fails (different networks/mobile data)
        {
          urls: [
            'turn:openrelay.metered.ca:80',
            'turn:openrelay.metered.ca:443',
            'turn:openrelay.metered.ca:443?transport=tcp',
          ],
          username:   'openrelayproject',
          credential: 'openrelayproject',
        },
        {
          urls: 'turn:relay1.expressturn.com:3478',
          username:   'efYSB0SXK0GLCMUDOL',
          credential: 'eSbxQkSUwdv2THBT',
        },
      ],
    });
  });

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