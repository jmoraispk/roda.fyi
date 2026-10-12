// src/app/sw/service-worker.js
import { APP_SHELL, cacheName, strategyFor } from './cache-policy.js';

const CACHE = cacheName(__RODA_SW_VERSION__);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith('roda-app-') && key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const strategy = strategyFor({ url: request.url, method: request.method, mode: request.mode, origin: self.location.origin });
  if (strategy === 'bypass') return;
  if (strategy === 'network-first') {
    event.respondWith(fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put('/app', copy));
        return response;
      })
      .catch(() => caches.match('/app')));
    return;
  }
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(request);
    const network = fetch(request).then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    }).catch(() => cached);
    return cached ?? network;
  }));
});
