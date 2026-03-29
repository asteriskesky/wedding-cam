const CACHE_NAME = 'zr-wedding-v3';
const CACHE_ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/manifest.json',
    '/assets/zr_logo.svg',
    '/assets/zr_text.svg',
    '/assets/wedding-background.jpeg',
    'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,600&family=Inter:wght@300;400;500;600&display=swap'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(CACHE_ASSETS))
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
    // Network first for API calls, cache-first for assets
    const url = new URL(event.request.url);
    if (url.hostname.includes('cloudinary') || url.hostname.includes('firebase')) {
        return; // always network for uploads
    }
    event.respondWith(
        caches.match(event.request).then(cached =>
            cached || fetch(event.request).then(resp => {
                if (resp.ok && event.request.method === 'GET') {
                    const clone = resp.clone();
                    caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
                }
                return resp;
            })
        )
    );
});
