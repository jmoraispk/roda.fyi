// tests/unit/helpers/worker-harness.js
// Runs a service-worker module in Node with fake caches, fetch, and self.
// `load` is a literal dynamic import from the test file, for example
// `() => import('../../src/app/sw/service-worker.js')`.
import { vi } from 'vitest';

export const ORIGIN = 'https://roda.fyi';

export async function loadWorker(load, { cacheKeys = [] } = {}) {
  vi.resetModules();
  const handlers = {};
  const stored = new Map();
  const keyOf = (key) => (typeof key === 'string' ? key : key.url);
  const cache = {
    put: vi.fn(async (key, response) => { stored.set(keyOf(key), response); }),
    match: vi.fn(async (key) => stored.get(keyOf(key))),
    addAll: vi.fn(async () => {}),
  };
  const cacheStorage = {
    open: vi.fn(async () => cache),
    match: vi.fn(async (key) => stored.get(keyOf(key))),
    keys: vi.fn(async () => cacheKeys),
    delete: vi.fn(async () => true),
  };
  const fetchMock = vi.fn();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, handler) => { handlers[type] = handler; },
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
    registration: { unregister: vi.fn(async () => true) },
  };
  vi.stubGlobal('__RODA_SW_VERSION__', 'test');
  vi.stubGlobal('caches', cacheStorage);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('self', self);
  await load();
  return { handlers, cache, cacheStorage, stored, fetchMock, self };
}

export async function respond(handlers, request) {
  let answer;
  handlers.fetch({ request, respondWith: (promise) => { answer = promise; } });
  return answer;
}

export async function lifecycle(handlers, type) {
  let done;
  handlers[type]({ waitUntil: (promise) => { done = promise; } });
  await done;
}
