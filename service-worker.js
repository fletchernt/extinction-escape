/* Service worker for Extinction Escape PWA
 * Caches core assets for offline use.
 */

// Bump the cache name whenever the application version changes to force
// the browser to fetch a fresh copy of the assets.  This version corresponds
// to the v0.7.0 release.
const CACHE_NAME = 'extinction-escape-cache-v7';
const URLS_TO_CACHE = [
  './',
  'index.html',
  'script.js',
  'style.css',
  'manifest.json',
  'assets/header.png',
  'assets/icon-192.png',
  'assets/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(URLS_TO_CACHE);
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});