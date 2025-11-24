const VERSION = 'huntglobal-v1';
const STATIC_CACHE = VERSION + '-static';
const RUNTIME_CACHE = VERSION + '-runtime';

const CORE_ASSETS = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.webmanifest',
  './ttd/index.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => !key.startsWith(VERSION)).map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then(cached =>
        cached ||
        fetch(req).then(resp => {
          const copy = resp.clone();
          caches.open(STATIC_CACHE).then(cache => cache.put('./index.html', copy));
          return resp;
        }).catch(() => caches.match('./index.html'))
      )
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  event.respondWith(networkFirst(req, RUNTIME_CACHE));
});

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

function networkFirst(request, cacheName) {
  return caches.open(cacheName).then(cache =>
    fetch(request).then(resp => {
      if (resp && resp.ok) cache.put(request, resp.clone());
      return resp;
    }).catch(() => cache.match(request))
  );
}
