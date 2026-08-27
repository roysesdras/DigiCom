const webpush = require('web-push');
const path = require('path');
const fs = require('fs');
const db = require('./database');

const keysFile = path.join(__dirname, 'data', 'vapid.json');

let vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY,
  subject: process.env.VAPID_SUBJECT || 'mailto:admin@digiroys.com'
};

function initVapid() {
  if (!vapidKeys.publicKey || !vapidKeys.privateKey) {
    if (fs.existsSync(keysFile)) {
      try {
        const saved = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
        vapidKeys.publicKey = saved.publicKey;
        vapidKeys.privateKey = saved.privateKey;
        vapidKeys.subject = saved.subject || vapidKeys.subject;
        console.log('[+] Loaded existing VAPID keys from data/vapid.json');
      } catch (err) {
        console.error('[-] Error reading vapid.json, generating new keys:', err.message);
        generateAndSaveVapidKeys();
      }
    } else {
      console.log('[*] No VAPID keys provided in environment, generating automatic pair...');
      generateAndSaveVapidKeys();
    }
  }

  webpush.setVapidDetails(
    vapidKeys.subject,
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );
  console.log('[+] Web Push service configured with public key:', vapidKeys.publicKey.substring(0, 15) + '...');
}

function generateAndSaveVapidKeys() {
  const generated = webpush.generateVAPIDKeys();
  vapidKeys.publicKey = generated.publicKey;
  vapidKeys.privateKey = generated.privateKey;

  const dataDir = path.dirname(keysFile);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(keysFile, JSON.stringify(vapidKeys, null, 2), 'utf8');
  console.log('[+] Generated and saved new VAPID keys to:', keysFile);
  return vapidKeys;
}

function getPublicKey() {
  return vapidKeys.publicKey;
}

async function sendNotificationToSubscription(subscription, payload) {
  try {
    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth
      }
    };

    const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
    await webpush.sendNotification(pushSubscription, payloadString, {
      TTL: 86400,
      urgency: 'high'
    });
    return true;
  } catch (err) {
    console.error(`[-] Push error for endpoint ${subscription.endpoint.substring(0, 30)}...:`, err.statusCode || err.message);
    if (err.statusCode === 410 || err.statusCode === 404) {
      console.log('[*] Subscription expired or gone, removing from DB.');
      await db.deleteSubscriptionByEndpoint(subscription.endpoint);
    }
    return false;
  }
}

async function sendNotificationToUser(userId, payload) {
  const subscriptions = await db.getSubscriptionsByUserId(userId);
  if (!subscriptions || subscriptions.length === 0) {
    return { success: false, sentCount: 0, reason: 'No subscriptions found' };
  }

  const results = await Promise.all(
    subscriptions.map(sub => sendNotificationToSubscription(sub, payload))
  );
  const sentCount = results.filter(Boolean).length;
  return { success: true, sentCount, total: subscriptions.length };
}

async function sendNotificationToAdmin(payload) {
  const adminSubscriptions = await db.getAdminSubscriptions();
  if (!adminSubscriptions || adminSubscriptions.length === 0) {
    return { success: false, sentCount: 0, reason: 'No admin subscriptions found' };
  }

  const results = await Promise.all(
    adminSubscriptions.map(sub => sendNotificationToSubscription(sub, payload))
  );
  const sentCount = results.filter(Boolean).length;
  return { success: true, sentCount, total: adminSubscriptions.length };
}

initVapid();

module.exports = {
  getPublicKey,
  generateAndSaveVapidKeys,
  sendNotificationToSubscription,
  sendNotificationToUser,
  sendNotificationToAdmin
};
