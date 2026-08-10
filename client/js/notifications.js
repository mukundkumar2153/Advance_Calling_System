async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    console.log('[SW] Registered');
    return reg;
  } catch(e) {
    console.warn('[SW] Registration failed:', e);
    return null;
  }
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

async function sendFcmTokenToServer(token, fcmToken) {
  try {
    await fetch('/api/auth/fcm-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ fcmToken }),
    });
  } catch(e) {
    console.warn('[FCM] Failed to save token:', e);
  }
}

function showLocalNotification(title, body, data = {}) {
  if (Notification.permission !== 'granted') return;
  const n = new Notification(title, {
    body,
    icon:               '/icons/icon-192.png',
    badge:              '/icons/icon-192.png',
    tag:                'incoming-call',
    requireInteraction: true,
    data,
  });
  n.onclick = () => { window.focus(); n.close(); };
}

navigator.serviceWorker?.addEventListener('message', e => {
  if (e.data?.type === 'notification-action') {
    const { action, callData } = e.data;
    if (action === 'accept')  window.IncomingCall?.acceptFromNotification(callData.callId, callData.callerName, callData.callerAvatar);
    if (action === 'decline') window.IncomingCall?.decline();
  }
});

window.Notifications = {
  registerServiceWorker,
  requestNotificationPermission,
  sendFcmTokenToServer,
  showLocalNotification,
};