// Bump this version string every time you deploy a new build
// The browser detects the change, installs the new SW, and clears old caches automatically
const CACHE_NAME = 'ctt-sales-log-v4';
const ASSETS = [
  'sales-log.html',
  'sales-log-manifest.json',
  'ctt-logo.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  // Take over immediately without waiting for old SW to finish
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  // Delete every old cache version
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Always go to network for API calls
  if (url.includes('upcitemdb.com') || url.includes('script.google.com') || url.includes('unpkg.com')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ code: 'OFFLINE', items: [] }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // For app assets: network first, fall back to cache
  // This means you always get the freshest version when online
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache the fresh response
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
