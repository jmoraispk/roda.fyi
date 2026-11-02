// src/app/sw/service-worker.js
import { APP_SHELL, SHELL_PATH, cacheName, shouldCache, strategyFor } from './cache-policy.js';
import { appLink, notificationFromPush } from './push-policy.js';

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
        if (shouldCache(response)) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(SHELL_PATH, copy));
        }
        return response;
      })
      .catch(() => caches.match(SHELL_PATH)));
    return;
  }
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(request);
    const network = fetch(request).then((response) => {
      if (shouldCache(response)) cache.put(request, response.clone());
      return response;
    }).catch(() => cached);
    return cached ?? network;
  }));
});

self.addEventListener('push', (event) => {
  const { title, options } = notificationFromPush(event.data);
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = appLink(event.notification.data?.url);
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
    const open = windows.find((client) => new URL(client.url).pathname === SHELL_PATH);
    if (!open) {
      await self.clients.openWindow(target);
      return;
    }
    await open.focus();
    // If the browser refuses to move the open app, it is at least in front.
    await open.navigate(new URL(target, self.location.origin).href).catch(() => null);
  }));
});
