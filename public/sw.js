/**
 * DigiCom Service Worker - PWA Offline Support & Background Web Push Dispatcher
 */

const CACHE_NAME = 'digicom-pwa-v1137';
const MEDIA_CACHE_NAME = 'digicom-media-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/css/style.min.css',
  '/fonts/plus-jakarta-sans-latin.woff2',
  '/socket.io/socket.io.js',
  '/js/qrcode.min.js',
  '/js/idb-store.min.js',
  '/js/push-client.min.js',
  '/js/webrtc-call.min.js',
  '/js/guided-tour.min.js',
  '/js/app.min.js',
  '/img/bubble.webp',
  '/img/chat.webp',
  '/img/bot.webp',
  '/img/icon-192.webp',
  '/img/icon-192.png',
  '/img/icon-512.webp',
  '/img/icon-512.png',
  '/img/apple-touch-icon.webp',
  '/img/apple-touch-icon.png',
  '/img/favicon.webp',
  '/img/favicon.png',
  '/img/badge-72.webp',
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
          if (key !== CACHE_NAME && key !== MEDIA_CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Helper: Trim media cache to max items
async function trimMediaCache(maxItems = 150) {
  try {
    const cache = await caches.open(MEDIA_CACHE_NAME);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      for (let i = 0; i < keys.length - maxItems; i++) {
        await cache.delete(keys[i]);
      }
    }
  } catch (e) {}
}

// Helper: Handle HTTP 206 Partial Content Range slicing for Audio/Video from Cache
async function handleRangeMediaResponse(request, cachedResponse) {
  const rangeHeader = request.headers.get('range');
  if (!rangeHeader || !cachedResponse) {
    return cachedResponse;
  }

  try {
    const arrayBuffer = await cachedResponse.arrayBuffer();
    const totalSize = arrayBuffer.byteLength;
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);

    if (!match) return cachedResponse;

    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;
    const safeEnd = Math.min(end, totalSize - 1);
    const chunk = arrayBuffer.slice(start, safeEnd + 1);

    const contentType = cachedResponse.headers.get('content-type') || 'audio/webm';
    return new Response(chunk, {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Content-Type': contentType,
        'Content-Range': `bytes ${start}-${safeEnd}/${totalSize}`,
        'Content-Length': String(chunk.byteLength),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  } catch (e) {
    return cachedResponse;
  }
}

// Fetch event listener with Cache-First for Uploads & Fast Network-First with AbortController for App Assets
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
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  // 1. Dedicated Cache-First Strategy for Media / Uploads (Images, Voice Notes, Files) with Range 206 Support
  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(MEDIA_CACHE_NAME);
        const cacheKey = new Request(url.origin + url.pathname);
        let cached = await cache.match(cacheKey);

        if (cached) {
          return handleRangeMediaResponse(event.request, cached.clone());
        }

        try {
          // Fetch full clean file from network without range to cache the whole asset
          const netRes = await fetch(cacheKey);
          if (netRes && (netRes.status === 200 || netRes.status === 304)) {
            await cache.put(cacheKey, netRes.clone());
            trimMediaCache(150);
            return handleRangeMediaResponse(event.request, netRes);
          }
          return netRes;
        } catch (err) {
          return new Response('Média indisponible hors-ligne', { status: 503, statusText: 'Offline Media' });
        }
      })()
    );
    return;
  }

  // 2. Fast Network-First Strategy with AbortController for App Assets
  event.respondWith(
    new Promise((resolve) => {
      let isResolved = false;
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;

      // 1. Attempt Network Fetch
      const fetchPromise = fetch(event.request, { signal: controller ? controller.signal : undefined })
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
              if (controller) controller.abort();
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

// Web Push Event Handler (With Active Tab Suppression)
self.addEventListener('push', (event) => {
  let data = {
    title: 'DigiCom',
    body: 'Nouveau message reçu.',
    icon: '/img/icon-192.webp',
    badge: '/img/badge-72.webp',
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
  const isCall = data.data && (data.data.type === 'call_incoming' || data.data.callerId);

  if (isCall) {
    notifTag = 'digicom-call-incoming';
  } else if (data.data && data.data.salonId) {
    notifTag = 'digicom-salon-' + data.data.salonId;
  } else if (data.data && data.data.senderId) {
    notifTag = 'digicom-contact-' + data.data.senderId;
  }

  const options = {
    body: data.body,
    icon: data.icon || '/img/icon-192.webp',
    badge: data.badge || '/img/badge-72.webp',
    vibrate: isCall ? [800, 400, 800, 400, 800, 400, 800, 400, 1000] : [200, 100, 200],
    data: data.data || { url: '/' },
    tag: notifTag,
    renotify: true,
    requireInteraction: isCall ? true : false,
    actions: isCall ? [
      { action: 'answer', title: 'Répondre' },
      { action: 'reject', title: 'Refuser' }
    ] : []
  };

  event.waitUntil(
    (async () => {
      // Check if user already has an active, focused DigiCom tab in foreground
      const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const isAppFocused = windowClients.some(client => client.focused && client.visibilityState === 'visible');

      // For standard text messages, skip notification if staring at foreground chat. For CALLS, always alert!
      if (isAppFocused && !isCall) {
        return;
      }

      return self.registration.showNotification(data.title, options);
    })()
  );
});

// Notification Click Handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notifData = (event.notification && event.notification.data) || {};
  const action = event.action;
  let targetUrl = self.location.origin;

  if (notifData.type === 'call_incoming' || notifData.callerId) {
    targetUrl = new URL(`/?openCall=true&callerId=${encodeURIComponent(notifData.callerId)}&callerName=${encodeURIComponent(notifData.callerName || '')}&callType=${encodeURIComponent(notifData.callType || 'audio')}&action=${encodeURIComponent(action || '')}`, self.location.origin).href;
  } else if (notifData.openRequests || notifData.type === 'contact_request') {
    targetUrl = new URL('/?openRequests=true', self.location.origin).href;
  } else if (notifData.salonId) {
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
            data: notifData,
            action: action
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
