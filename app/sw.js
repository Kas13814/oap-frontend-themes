/* OAP Service Worker (secure + stable)
   - Network-first for navigations (HTML)
   - Cache-first for safe static assets
   - Never cache API/Supabase/authenticated requests
*/

const VERSION = 'oap-sw-v1';
const STATIC_CACHE = `${VERSION}-static`;

const PRECACHE = [
  '/app/index.html',
  '/manifest.webmanifest'
];

function isApiOrPrivateRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  // Supabase / API (do not cache)
  if (url.hostname.includes('supabase.co')) return true;
  if (path.startsWith('/rest/v1') || path.startsWith('/auth/v1') || path.startsWith('/functions/v1')) return true;

  // Any request carrying credentials/auth headers should not be cached
  if (request.headers.get('authorization')) return true;
  if (request.credentials && request.credentials !== 'omit') return true;

  return false;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(PRECACHE);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (k !== STATIC_CACHE) return caches.delete(k);
    }));
    self.clients.claim();
  })());
});

async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    return fresh;
  } catch (_) {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    return cached || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const fresh = await fetch(request);
  // only cache successful, same-origin assets
  try {
    const url = new URL(request.url);
    if (fresh.ok && url.origin === self.location.origin) {
      await cache.put(request, fresh.clone());
    }
  } catch (_) {}
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== 'GET') return;

  // Never cache private/API requests
  if (isApiOrPrivateRequest(req)) {
    return; // let browser handle normally
  }

  // Navigations (HTML): network-first
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
    return;
  }

  // Static assets: cache-first
  const dest = req.destination;
  if (dest === 'script' || dest === 'style' || dest === 'image' || dest === 'font') {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Default: network
  event.respondWith(fetch(req));
});
