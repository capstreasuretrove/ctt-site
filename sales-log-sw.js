const CACHE_NAME = 'ctt-sales-log-v1';
const ASSETS = [
  'sales-log.html',
  'sales-log-manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // For UPC API and Apps Script calls, always try network first
  const url = event.request.url;
  if (url.includes('upcitemdb.com') || url.includes('script.google.com')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ code: 'OFFLINE', items: [] }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // For app assets, try cache first, fallback to network
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
