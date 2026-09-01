/**
 * DigiCom Service Worker - PWA Offline Support & Background Web Push Dispatcher
 */

const CACHE_NAME = 'digicom-pwa-v1192';
const MEDIA_CACHE_NAME = 'digicom-media-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/css/style.min.css',
  '/fonts/plus-jakarta-sans-latin.woff2',
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

  // Bypass socket.io WebSocket polling & scripts, plus API endpoints
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/socket.io/') ||
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
          if (netRes && netRes.status === 200) {
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

  // 2. Instant Cache-First (Stale-While-Revalidate) Strategy for App Shell Assets (< 1s Startup)
  event.respondWith(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(event.request, { ignoreSearch: true });

        // Background network update (Stale-While-Revalidate)
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone()).catch(() => {});
            }
            return networkResponse;
          })
          .catch(() => null);

        // If asset exists in cache, serve immediately for instant startup (< 10ms)
        if (cachedResponse) {
          return cachedResponse;
        }

        // If not in cache, await network fetch or navigation fallback
        const netResponse = await fetchPromise;
        if (netResponse && netResponse.status !== 0) return netResponse;

        if (event.request.mode === 'navigate') {
          const fallbackHTML = await cache.match('/index.html', { ignoreSearch: true });
          if (fallbackHTML) return fallbackHTML;
        }

        return new Response('Ressource indisponible hors-ligne', { status: 503, statusText: 'Offline' });
      } catch (err) {
        console.warn('[SW] Fetch handler error:', err);
        // Last resort: try network directly
        try {
          return await fetch(event.request);
        } catch (e) {
          return new Response('Ressource indisponible hors-ligne', { status: 503, statusText: 'Offline' });
        }
      }
    })()
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

  const payloadData = data.data || {};
  let notifTag = 'digicom-general';
  const isCall = payloadData.type === 'call_incoming' || payloadData.callerId;

  if (isCall) {
    notifTag = 'digicom-call-incoming';
  } else if (payloadData.salonId || data.salonId) {
    notifTag = 'salon-' + (payloadData.salonId || data.salonId);
  } else if (payloadData.contactId || payloadData.senderId || data.contactId) {
    notifTag = 'contact-' + (payloadData.contactId || payloadData.senderId || data.contactId);
  }

  const options = {
    body: data.body,
    icon: data.icon || '/img/icon-192.webp',
    badge: data.badge || '/img/badge-72.webp',
    vibrate: isCall ? [800, 400, 800, 400, 800, 400, 800, 400, 1000] : [200, 100, 200],
    data: {
      url: payloadData.url || data.url || '/',
      salonId: payloadData.salonId || data.salonId || null,
      contactId: payloadData.contactId || payloadData.senderId || data.contactId || null,
      messageId: payloadData.messageId || data.messageId || null,
      channel: payloadData.channel || data.channel || null,
      ...payloadData
    },
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

// Notification Click Handler (v1190 - Desktop postMessage + Mobile openWindow fallback)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notifData = (event.notification && event.notification.data) || {};
  const action = event.action;
  let targetPath = '/';

  const msgParam = notifData.messageId ? `&msg=${encodeURIComponent(notifData.messageId)}` : '';

  if (notifData.type === 'call_incoming' || notifData.callerId) {
    targetPath = `/?openCall=true&callerId=${encodeURIComponent(notifData.callerId)}&callerName=${encodeURIComponent(notifData.callerName || '')}&callType=${encodeURIComponent(notifData.callType || 'audio')}&action=${encodeURIComponent(action || '')}`;
  } else if (notifData.openRequests || notifData.type === 'contact_request') {
    targetPath = '/?openRequests=true';
  } else if (notifData.salonId) {
    targetPath = `/?salon=${encodeURIComponent(notifData.salonId)}${msgParam}`;
  } else if (notifData.senderId && (notifData.channel === 'support' || notifData.channel === 'sos')) {
    targetPath = `/?channel=support&sender=${encodeURIComponent(notifData.senderId)}${msgParam}`;
  } else if (notifData.senderId || notifData.contactId) {
    const cid = notifData.contactId || notifData.senderId;
    targetPath = `/?contact=${encodeURIComponent(cid)}${msgParam}`;
  } else if (notifData.url) {
    targetPath = notifData.url;
  }

  const fullTargetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      });

      // 1. Search for an existing open DigiCom window
      let matchingClient = null;
      for (const client of windowClients) {
        if (client.url && client.url.includes(self.location.origin)) {
          matchingClient = client;
          break;
        }
      }

      if (matchingClient) {
        let focusedClient = null;
        try {
          if ('focus' in matchingClient) {
            focusedClient = await matchingClient.focus();
          }
        } catch (err) {
          console.warn('[SW] client.focus failed (expected on Android Chrome):', err);
        }

        if (focusedClient) {
          // Desktop / PWA standalone: focus worked, route via postMessage (no reload needed)
          try {
            focusedClient.postMessage({
              action: 'NAVIGATE_TO_SALON',
              type: 'NOTIFICATION_CLICK',
              salonId: notifData.salonId,
              contactId: notifData.contactId || notifData.senderId,
              messageId: notifData.messageId,
              url: fullTargetUrl,
              data: notifData,
              targetUrl: fullTargetUrl
            });
          } catch (e) {}
          return;
        }

        // Mobile: focus() was blocked by Android → force foreground via openWindow with full URL.
        if (self.clients.openWindow) {
          return self.clients.openWindow(fullTargetUrl);
        }
        return;
      }

      // 2. No existing window: cold start with target URL (initApp reads params after contacts load).
      if (self.clients.openWindow) {
        return self.clients.openWindow(fullTargetUrl);
      }
    })()
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
