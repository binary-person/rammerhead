// a site's service worker: answers ping with what it sees as its own scope
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
    if (new URL(e.request.url).pathname.endsWith('/ping')) e.respondWith(new Response('from-sw ' + self.registration.scope));
});
