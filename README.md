# 📞 RingUp — Real Voice Calling App

WhatsApp-style voice calls with push notifications, friend lists, and PWA support.

## Features
- Register / Login with JWT auth
- Add friends, search users
- Call friends — they get a real push notification ring
- Accept / Decline incoming calls
- WebRTC P2P voice (STUN + TURN)
- Call history (answered / missed / declined)
- PWA — installable on Android & iOS

## Tech Stack (all free)
| Layer | Tech |
|---|---|
| Backend | Node.js + Express + Socket.IO |
| Database | SQLite (better-sqlite3) |
| Auth | JWT (bcrypt) |
| Push notifications | Firebase FCM |
| Voice | WebRTC |
| Frontend | Vanilla JS PWA |

## Local Setup
```bash
cd server
npm install
cp .env.example .env   # edit JWT_SECRET
node server.js
```
Open `http://localhost:3000` in two browser tabs.

## Deploy
- **Backend** → Render.com (free tier, persistent Node.js)
- **Frontend** → Vercel (static, free)
- Add `RINGUP_SERVER=https://your-render-url.onrender.com` in `client/js/socket.js`

## Firebase Push (optional)
1. Create Firebase project → Project Settings → Service Accounts
2. Download `firebase-service-account.json` → put in project root
3. Get your FCM Web Push key → add to `client/js/notifications.js`

## Folder Structure
```
ringup/
├── server/          # Node.js backend
│   ├── config/      # DB + Firebase init
│   ├── models/      # User, Friend, CallLog
│   ├── routes/      # REST API
│   ├── socket/      # WebRTC + call events
│   └── middleware/  # JWT auth
└── client/          # PWA frontend
    ├── js/          # App logic modules
    ├── css/         # Styles
    └── audio/       # Ringtone, dialing sounds
```