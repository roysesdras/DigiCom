/**
 * DigiCom Service Worker - PWA Offline Support & Background Web Push Dispatcher
 */

const CACHE_NAME = 'digicom-pwa-v1088';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/css/style.css',
  '/fonts/plus-jakarta-sans-latin.woff2',
  '/socket.io/socket.io.js',
  '/js/idb-store.js',
  '/js/app.js',
  '/js/push-client.js',
  '/img/bubble.jpeg',
  '/img/bot.png',
  '/img/icon-192.png',
  '/img/icon-512.png',
  '/img/apple-touch-icon.png',
  '/img/favicon.png',
  '/img/badge-72.png',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('[SW] Cache non-blocking warning:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event listener with 1.5s Fast Network-First & Instant Cache Fallback
self.addEventListener('fetch', (event) => {
  let url;
  try {
    url = new URL(event.request.url);
  } catch (e) {
    return;
  }

  // Bypass socket.io WebSocket polling & API endpoints, but ALLOW /socket.io/socket.io.js script caching
  const isSocketIoScript = url.pathname === '/socket.io/socket.io.js';
  const isSocketPolling = url.pathname.startsWith('/socket.io/') && !isSocketIoScript;

  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    isSocketPolling ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/uploads/')
  ) {
    return;
  }

  // Fast Network-First Strategy with 1500ms Timeout Fallback to Cache
  event.respondWith(
    new Promise((resolve) => {
      let isResolved = false;

      // 1. Attempt Network Fetch
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 304)) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          if (!isResolved) {
            isResolved = true;
            resolve(networkResponse);
          }
          return networkResponse;
        })
        .catch(() => null);

      // 2. 1500ms Timeout: Fallback to Cache if network is slow/metered
      const timeoutId = setTimeout(() => {
        if (!isResolved) {
          caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse && !isResolved) {
              isResolved = true;
              console.log('[SW] Network timeout (1.5s). Serving from Cache:', event.request.url);
              resolve(cachedResponse);
            }
          });
        }
      }, 1500);

      // 3. Fallback if network fails completely or offline
      fetchPromise.then((netResp) => {
        clearTimeout(timeoutId);
        if (!netResp && !isResolved) {
          caches.match(event.request).then((cachedResponse) => {
            if (!isResolved) {
              isResolved = true;
              if (cachedResponse) return resolve(cachedResponse);
              if (event.request.mode === 'navigate') {
                return resolve(caches.match('/index.html', { ignoreSearch: true }));
              }
              resolve(new Response('Ressource indisponible hors-ligne', { status: 503, statusText: 'Offline' }));
            }
          });
        }
      });
    })
  );
});

// Web Push Event Handler
self.addEventListener('push', (event) => {
  let data = {
    title: 'DigiCom',
    body: 'Nouveau message reçu.',
    icon: '/img/icon-192.png',
    badge: '/img/badge-72.png',
    data: { url: '/' }
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  let notifTag = 'digicom-general';
  if (data.data && data.data.salonId) {
    notifTag = 'digicom-salon-' + data.data.salonId;
  } else if (data.data && data.data.senderId) {
    notifTag = 'digicom-contact-' + data.data.senderId;
  }

  const options = {
    body: data.body,
    icon: data.icon || '/img/icon-192.png',
    badge: data.badge || '/img/badge-72.png',
    vibrate: [200, 100, 200],
    data: data.data || { url: '/' },
    tag: notifTag,
    renotify: true
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification Click Handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notifData = (event.notification && event.notification.data) || {};
  let targetUrl = self.location.origin;

  if (notifData.salonId) {
    targetUrl = new URL(`/?salon=${encodeURIComponent(notifData.salonId)}`, self.location.origin).href;
  } else if (notifData.senderId && (notifData.channel === 'support' || notifData.channel === 'sos')) {
    targetUrl = new URL(`/?channel=support&sender=${encodeURIComponent(notifData.senderId)}`, self.location.origin).href;
  } else if (notifData.senderId) {
    targetUrl = new URL(`/?contact=${encodeURIComponent(notifData.senderId)}`, self.location.origin).href;
  } else if (notifData.url) {
    targetUrl = new URL(notifData.url, self.location.origin).href;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({
            type: 'NOTIFICATION_CLICK',
            data: notifData
          });
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Background Sync Handler for Offline Messages
self.addEventListener('sync', (event) => {
  if (event.tag === 'digicom-outbox-sync') {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          client.postMessage({ type: 'FLUSH_OUTBOX' });
        }
      })
    );
  }
});
