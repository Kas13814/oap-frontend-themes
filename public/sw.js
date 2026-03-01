// sw.js (minimal Service Worker for OAP)
// NOTE: This SW intentionally does NOT cache navigations to avoid SPA rewrite/caching issues.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Pass-through fetch (no cache)
self.addEventListener('fetch', (event) => {
  return;
});
