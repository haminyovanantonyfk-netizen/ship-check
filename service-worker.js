'use strict';
/* ShipCheck service worker — caches the app shell only.
   API calls (GitHub, npm, OSV, DNS) always go to the network: results must be live. */
const CACHE = 'shipcheck-v1';
const SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; /* live APIs: network only */
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
