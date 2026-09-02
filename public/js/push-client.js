/**
 * DigiCom Web Push Client Manager
 * Handles VAPID PushManager subscription & server sync
 */

class DigiPushClient {
  constructor() {
    this.swRegistration = null;
    this.isSubscribed = false;
  }

  static urlB64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/\-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async init() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('[-] Web Push is not supported by this browser.');
      return false;
    }

    try {
      this.swRegistration = await navigator.serviceWorker.register('/sw.js?v=1216');
      console.log('[+] Service Worker registered with scope:', this.swRegistration.scope);
      try { this.swRegistration.update(); } catch (e) {}

      const existingSubscription = await this.swRegistration.pushManager.getSubscription();
      this.isSubscribed = !(existingSubscription === null);

      if (this.isSubscribed) {
        console.log('[+] Existing Push subscription found.');
      }
      return true;
    } catch (err) {
      console.error('[-] Service Worker registration failed:', err);
      return false;
    }
  }

  async subscribeUser(userId = null) {
    if (!this.swRegistration) {
      const ok = await this.init();
      if (!ok) return false;
    }

    try {
      // 1. Request notification permission
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.warn('[-] Notification permission was not granted:', permission);
        alert("Chrome a suspendu ou bloqué les notifications pour ce site.\n\nPour les réactiver facilement :\n1. Cliquez sur le cadenas 🔒 (ou icône de réglages) à côté de l'URL dans Chrome.\n2. Allez dans 'Autorisations' -> 'Notifications'.\n3. Changez sur 'Autoriser' puis rafraîchissez la page.");
        return false;
      }

      // 2. Fetch VAPID public key
      const response = await fetch('/api/vapid-public-key');
      const data = await response.json();
      if (!data.publicKey) {
        throw new Error('VAPID public key not found');
      }

      const applicationServerKey = DigiPushClient.urlB64ToUint8Array(data.publicKey);

      // 3. Unsubscribe any existing stale subscription to force fresh key match
      const existing = await this.swRegistration.pushManager.getSubscription();
      if (existing) {
        try { await existing.unsubscribe(); } catch (e) {}
      }

      // 4. Subscribe with PushManager
      const subscription = await this.swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey
      });

      // 4. Send subscription to server
      const syncRes = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          userId: userId
        })
      });

      if (syncRes.ok) {
        this.isSubscribed = true;
        console.log('[+] Web Push subscription successfully activated on server!');
        return true;
      } else {
        throw new Error('Failed to save subscription on server');
      }
    } catch (err) {
      console.error('[-] Failed to subscribe to Web Push:', err);
      return false;
    }
  }

  async autoSync(userId = null) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      return false;
    }
    try {
      if (!this.swRegistration) {
        const ok = await this.init();
        if (!ok) return false;
      }

      const response = await fetch('/api/vapid-public-key');
      const data = await response.json();
      if (!data || !data.publicKey) return false;

      const applicationServerKey = DigiPushClient.urlB64ToUint8Array(data.publicKey);
      let subscription = await this.swRegistration.pushManager.getSubscription();

      if (subscription && subscription.options && subscription.options.applicationServerKey) {
        const existingKeyBytes = new Uint8Array(subscription.options.applicationServerKey);
        let matches = existingKeyBytes.length === applicationServerKey.length;
        if (matches) {
          for (let i = 0; i < existingKeyBytes.length; i++) {
            if (existingKeyBytes[i] !== applicationServerKey[i]) {
              matches = false;
              break;
            }
          }
        }
        if (!matches) {
          console.log('[*] VAPID key mismatch detected. Unsubscribing stale subscription...');
          try { await subscription.unsubscribe(); } catch (e) {}
          subscription = null;
        }
      }

      if (!subscription) {
        subscription = await this.swRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey
        });
      }

      if (subscription) {
        const syncRes = await fetch('/api/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription: subscription.toJSON(),
            userId: userId
          })
        });
        if (syncRes.ok) {
          this.isSubscribed = true;
          console.log('[+] Web Push subscription auto-synced seamlessly on startup!');
          const pushBtn = document.getElementById('btn-push-toggle');
          if (pushBtn) pushBtn.classList.add('active');
          return true;
        }
      }
    } catch (err) {
      console.warn('[-] Silent Web Push autoSync background warning:', err.message);
    }
    return false;
  }

  async unsubscribeUser() {
    try {
      if (!this.swRegistration && ('serviceWorker' in navigator)) {
        try {
          this.swRegistration = await navigator.serviceWorker.ready;
        } catch (e) {}
      }
      if (this.swRegistration && this.swRegistration.pushManager) {
        const subscription = await this.swRegistration.pushManager.getSubscription();
        if (subscription) {
          const endpoint = subscription.endpoint;
          await fetch('/api/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: endpoint })
          }).catch(() => {});
          await subscription.unsubscribe().catch(() => {});
        }
      }
      this.isSubscribed = false;
      console.log('[+] Web Push subscription unsubscribed clean.');
      return true;
    } catch (err) {
      console.warn('[-] Error during push unsubscribe:', err);
      return false;
    }
  }
}

window.DigiPushClient = DigiPushClient;
