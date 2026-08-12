# 📞 Advance Calling System (RingUp)

A full-featured, WhatsApp-style real-time voice and multi-user group conference calling web application powered by **WebRTC**, **Socket.IO**, **Node.js**, and **Vanilla JS PWA**.

---

## 🌟 Key Features

- 👤 **Authentication & User Management**: Secure registration & login with JWT & bcrypt password hashing.
- 📞 **1-to-1 WebRTC Voice Calls**: P2P high-quality audio calling with custom ringtones, call timers, and status tracking.
- 👥 **Multi-User Group Conference Calls**: WhatsApp-style group calling supporting multi-peer mesh WebRTC topology, participant grids, and real-time speaking indicators.
- 🌐 **Long Distance NAT Traversal**: Integrated Google STUN & OpenRelay/ExpressTURN TURN servers for reliable long-distance calls across cellular and restricted firewalls.
- 📱 **Mobile-First Responsive UI**: Sleek mobile design with dynamic bottom navigation, audio output routing (Speaker / Earpiece), and touch controls.
- 🔊 **Audio Autoplay & Mic Fallbacks**: Smart AudioContext unlocking for mobile browsers and automatic mic format fallbacks.
- 🔔 **Push Notifications & Ringing**: Service worker push notifications and incoming call ring alerts.
- 🎨 **Themes & Customization**: Support for multiple themes (Dark, Light, Cyberpunk), friend nicknames, favorite contacts, and call recording options.
- 🔍 **Voice & Text Contact Search**: Instant contact filtering and voice-assisted search.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Node.js, Express, Socket.IO |
| **Database** | SQLite (`better-sqlite3`) |
| **Authentication** | JWT (JSON Web Tokens), `bcryptjs` |
| **WebRTC & Signaling** | WebRTC (Mesh Topology for Group Calls), Custom Socket.IO Signaling, STUN & TURN Relays |
| **Push Notifications** | Firebase Admin SDK (FCM) & Service Worker |
| **Frontend** | Vanilla JavaScript (ES6 Modules), HTML5, Modern CSS Variables & Animations (PWA) |

---

## 📁 Project Structure

```
Advance_Calling_System/
├── server/
│   ├── config/              # Database initialization & Firebase configuration
│   ├── middleware/          # JWT Authentication middleware
│   ├── models/              # User, Friend, and CallLog models
│   ├── routes/              # Express API endpoints (/api/auth, /api/friends, etc.)
│   ├── socket/              # Socket.IO handlers (1:1 calling, signaling, group conferences)
│   └── server.js            # Main backend server entry point
├── client/
│   ├── css/                 # Modern styling (main.css, incoming-call.css, settings.css)
│   ├── js/                  # Client logic (app.js, webrtc.js, conference.js, friends.js, call.js, etc.)
│   ├── audio/               # Custom ringtones & call sound effects
│   ├── sw.js                # Service Worker for PWA & Push Notifications
│   └── index.html           # Single Page Application container
├── firebase-service-account.json # Firebase Admin credentials (optional)
└── README.md
```

---

## 🚀 Quick Start & Local Setup

### 1. Prerequisites
- Node.js (v16 or higher)
- npm

### 2. Installation
Clone the repository and install server dependencies:

```bash
git clone https://github.com/mukundkumar2153/Advance_Calling_System.git
cd Advance_Calling_System/server
npm install
```

### 3. Environment Setup
Create a `.env` file inside the `server/` directory:

```env
PORT=3000
JWT_SECRET=your_jwt_secret_key_here
JWT_EXPIRES_IN=7d
```

### 4. Running the Application
Start the backend server:

```bash
node server.js
```

Open your browser and navigate to `http://localhost:3000`. You can open multiple browser tabs or devices on the same network to test 1-to-1 and group conference calls!

---

## 🔗 Project Links

- 🌐 **Live Application**: [https://advance-calling-system.vercel.app/](https://advance-calling-system.vercel.app/)
