// sw.js — TrackTheDrops Hunt Hub PWA

const VERSION = 'ttd-hunt-hub-v1';
const STATIC_CACHE = VERSION + '-static';
const RUNTIME_CACHE = VERSION + '-runtime';

// Core assets that should be available offline immediately
const CORE_ASSETS = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.webmanifest',
  // TrackTheDrops app
  './ttd/index.html',
  './ttd/style.css',
  './ttd/app.js'
];

// Install: pre-cache core shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => !key.startsWith(VERSION))
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: app shell offline, static cache-first, everything else network-first
self.addEventListener('fetch', event => {
  const req = event.request;

  // Only deal with GET; let POST (GAS API calls) go straight through
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Handle navigation requests: always serve index.html from cache if offline
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then(cached =>
        cached ||
        fetch(req).then(resp => {
          // Keep latest shell in static cache
          const copy = resp.clone();
          caches.open(STATIC_CACHE).then(cache => cache.put('./index.html', copy));
          return resp;
        }).catch(() => caches.match('./index.html'))
      )
    );
    return;
  }

  // Same-origin static assets: cache-first
  if (url.origin === self.location.origin) {
    // Normalize to ./path style for comparison with CORE_ASSETS
    const pathKey = url.pathname === '/' ? './' : '.' + url.pathname;
    if (CORE_ASSETS.includes(pathKey)) {
      event.respondWith(cacheFirst(req, STATIC_CACHE));
      return;
    }
  }

  // Everything else (e.g., map tiles, CDN libs): network-first with cache fallback
  event.respondWith(networkFirst(req, RUNTIME_CACHE));
});

// Cache-first strategy for static assets
function cacheFirst(request, cacheName) {
  return caches.open(cacheName).then(cache =>
    cache.match(request).then(hit => {
      if (hit) return hit;
      return fetch(request).then(resp => {
        if (resp && resp.ok) cache.put(request, resp.clone());
        return resp;
      });
    })
  );
}

// Network-first strategy for runtime stuff (e.g., map tiles you've already hit)
function networkFirst(request, cacheName) {
  return caches.open(cacheName).then(cache =>
    fetch(request).then(resp => {
      if (resp && resp.ok) cache.put(request, resp.clone());
      return resp;
    }).catch(() => cache.match(request))
  );
}
