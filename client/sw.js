const CACHE  = 'ringup-v1';
const ASSETS = [
  '/', '/index.html',
  '/css/main.css', '/css/incoming-call.css',
  '/js/app.js', '/js/auth.js', '/js/friends.js',
  '/js/call.js', '/js/incoming.js', '/js/webrtc.js',
  '/js/socket.js', '/js/notifications.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/')) return;
  e.respondWith(
    caches.match(e.request)
      .then(r => r || fetch(e.request))
      .catch(() => caches.match('/index.html'))
  );
});

// ── FCM Push Notification ─────────────────────────────
self.addEventListener('push', e => {
  const data     = e.data?.json() || {};
  const title    = data.notification?.title || 'Incoming Call';
  const body     = data.notification?.body  || 'Someone is calling you';
  const callData = data.data || {};

  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:             '/icons/icon-192.png',
      badge:            '/icons/icon-192.png',
      tag:              'incoming-call',
      renotify:         true,
      requireInteraction: true,
      vibrate:          [300, 100, 300, 100, 300],
      data:             callData,
      actions: [
        { action: 'accept',  title: '✅ Accept'  },
        { action: 'decline', title: '❌ Decline' },
      ],
    })
  );
});

// ── Notification button clicked ───────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const { action } = e;
  const callData   = e.notification.data || {};
  const url = `/?callId=${callData.callId}&action=${action}&caller=${encodeURIComponent(callData.callerName || '')}&avatar=${encodeURIComponent(callData.callerAvatar || '👤')}`;

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) {
        existing.focus();
        existing.postMessage({ type: 'notification-action', action, callData });
      } else {
        clients.openWindow(url);
      }
    })
  );
});
```

---

## File 8/10 — `server/.env`
```
PORT=3000
JWT_SECRET=ringup_change_this_secret_in_production_xyz789
JWT_EXPIRES_IN=7d
```

---

## File 9/10 — `.gitignore`
```
# Dependencies
node_modules/

# Environment secrets
.env
firebase-service-account.json

# Database file
*.db
*.db-shm
*.db-wal

# OS files
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*