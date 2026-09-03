/**
 * DigiCom Service Worker - PWA Offline Support & Background Web Push Dispatcher
 */

const CACHE_NAME = 'digicom-pwa-v1224';
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
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== MEDIA_CACHE_NAME) {
            console.log('[SW] Purging stale cache key:', key);
            return caches.delete(key);
          }
        })
      );
      await self.clients.claim();
    })()
  );
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

// Range 206 helper for offline audio/video streaming playback
async function handleRangeMediaResponse(request, cachedResponse) {
  const rangeHeader = request.headers.get('range');
  if (!rangeHeader || !cachedResponse) return cachedResponse;

  try {
    const arrayBuffer = await cachedResponse.arrayBuffer();
    const bytes = rangeHeader.replace(/bytes=/, '').split('-');
    const total = arrayBuffer.byteLength;
    const start = parseInt(bytes[0], 10);
    const end = bytes[1] ? parseInt(bytes[1], 10) : total - 1;

    if (start >= total || end >= total) {
      return new Response('', {
        status: 416,
        statusText: 'Requested Range Not Satisfiable',
        headers: { 'Content-Range': `bytes */${total}` }
      });
    }

    const chunk = arrayBuffer.slice(start, end + 1);
    return new Response(chunk, {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Content-Type': cachedResponse.headers.get('Content-Type') || 'audio/webm',
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': String(chunk.byteLength),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  } catch (e) {
    return cachedResponse;
  }
}

// Fetch event listener with Smart Network-First for Navigation & Version-Exact Caching for Assets
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

  // 2. Network-First Strategy for Navigation & HTML Entry Points (Always fresh on F5/mobile refresh, offline fallback)
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put('/index.html', networkResponse.clone()).catch(() => {});
          }
          return networkResponse;
        } catch (err) {
          // Offline fallback
          const cache = await caches.open(CACHE_NAME);
          const cachedHTML = await cache.match('/index.html');
          if (cachedHTML) return cachedHTML;
          return new Response('Application hors-ligne', { status: 503, statusText: 'Offline' });
        }
      })()
    );
    return;
  }

  // 3. Version-Exact Stale-While-Revalidate for Static Assets (CSS, JS, Fonts, Images)
  event.respondWith(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        // Exact match respecting version queries (?v=...)
        const cachedResponse = await cache.match(event.request);

        // Fetch in parallel to keep cache fresh
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone()).catch(() => {});
            }
            return networkResponse;
          })
          .catch(() => null);

        // If exact version is in cache, return immediately (< 10ms)
        if (cachedResponse) {
          return cachedResponse;
        }

        // If not in cache (new version deployed), await network fetch
        const netResponse = await fetchPromise;
        if (netResponse && netResponse.status !== 0) return netResponse;

        return new Response('Ressource indisponible hors-ligne', { status: 503, statusText: 'Offline' });
      } catch (err) {
        console.warn('[SW] Fetch handler error:', err);
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
  const isAnnouncement = payloadData.type === 'admin_announcement';

  if (isCall) {
    notifTag = 'digicom-call-incoming';
  } else if (isAnnouncement) {
    notifTag = 'digicom-announcement-' + (payloadData.announcementId || Date.now());
  } else if (payloadData.salonId || data.salonId) {
    notifTag = 'salon-' + (payloadData.salonId || data.salonId);
  } else if (payloadData.contactId || payloadData.senderId || data.contactId) {
    notifTag = 'contact-' + (payloadData.contactId || payloadData.senderId || data.contactId);
  }

  const options = {
    body: data.body,
    icon: data.icon || '/img/icon-192.webp',
    badge: data.badge || '/img/badge-72.webp',
    vibrate: isCall ? [800, 400, 800, 400, 800, 400, 800, 400, 1000] : (isAnnouncement ? [400, 200, 400, 200, 500] : [250, 100, 250]),
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

  // Log incoming push notification to server
  try {
    fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: 'info',
        tag: 'SW_PUSH',
        message: `Push received: ${data.title || 'DigiCom'} -> ${data.body || ''}`,
        data: payloadData
      })
    }).catch(() => {});
  } catch (e) {}

  event.waitUntil(
    self.registration.showNotification(data.title || 'DigiCom', options)
  );
});

// Notification Click Handler (v1201 - Targeted foreground focus + Android openWindow fallback)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notifData = (event.notification && event.notification.data) || {};
  const action = event.action;
  let targetPath = notifData.url || '/';

  const msgParam = notifData.messageId ? `&msg=${encodeURIComponent(notifData.messageId)}` : '';

  if (notifData.url) {
    targetPath = notifData.url;
  } else if (notifData.type === 'call_incoming' || notifData.callerId) {
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
  }

  const targetUrl = new URL(targetPath, self.location.origin).href;

  // Log click event to server
  try {
    fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: 'info',
        tag: 'SW_CLICK',
        message: `Notification clicked: ${event.notification.title || ''} -> target: ${targetPath}`,
        data: notifData
      })
    }).catch(() => {});
  } catch (e) {}

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 1. Cherche si une fenêtre est DÉJÀ affichée à l'écran au premier plan
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && client.visibilityState === 'visible') {
          // L'app est déjà sous les yeux de l'utilisateur : on change de salon immédiatement
          client.postMessage({
            action: 'NAVIGATE_TO_SALON',
            type: 'NOTIFICATION_CLICK',
            salonId: notifData.salonId,
            contactId: notifData.contactId || notifData.senderId,
            senderId: notifData.senderId,
            messageId: notifData.messageId,
            channel: notifData.channel,
            url: targetUrl,
            data: notifData
          });
          return client.focus();
        }
      }

      // 2. Si l'app est en arrière-plan, minimisée ou fermée (ex: sur Facebook) :
      // On force l'ouverture via openWindow pour obliger Android à hisser l'écran
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
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
