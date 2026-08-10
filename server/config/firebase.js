const admin = require('firebase-admin');
const path  = require('path');
const fs    = require('fs');

let messaging = null;

function initFCM() {
  try {
    const serviceAccount = require(path.join(__dirname, '../../firebase-service-account.json'));

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });

    messaging = admin.messaging();
    console.log('[FCM] Firebase connected ✅');

  } catch (err) {
    console.log('[FCM] No service account file — push notifications disabled');
  }
}

async function sendCallNotification({ fcmToken, callerName, callerAvatar, callId }) {
  if (!messaging || !fcmToken) return false;
  try {
    await messaging.send({
      token: fcmToken,
      notification: {
        title: `📞 ${callerName} is calling`,
        body:  'Tap to answer',
      },
      data: {
        type:         'incoming_call',
        callId:       String(callId),
        callerName:   String(callerName),
        callerAvatar: String(callerAvatar),
      },
      android: { priority: 'high' },
      apns:    { payload: { aps: { contentAvailable: true, sound: 'default' } } },
    });
    return true;
  } catch(e) {
    console.warn('[FCM] Send failed:', e.message);
    return false;
  }
}

module.exports = { initFCM, sendCallNotification };