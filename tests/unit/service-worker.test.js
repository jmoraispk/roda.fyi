// tests/unit/service-worker.test.js
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SHELL_PATH } from '../../src/app/sw/cache-policy.js';
import { ORIGIN, lifecycle, loadWorker as load, respond } from './helpers/worker-harness.js';

const loadWorker = (options) => load(() => import('../../src/app/sw/service-worker.js'), options);
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const navigation = (path) => ({ url: `${ORIGIN}${path}`, method: 'GET', mode: 'navigate' });

afterEach(() => { vi.unstubAllGlobals(); });

describe('service worker', () => {
  it('starts and claims its pages', async () => {
    const worker = await loadWorker();
    await lifecycle(worker.handlers, 'activate');
    expect(worker.self.clients.claim).toHaveBeenCalled();
  });

  it('keeps a good app page for offline use', async () => {
    const worker = await loadWorker();
    worker.fetchMock.mockResolvedValue(new Response('<html>ok</html>', { status: 200 }));
    const response = await respond(worker.handlers, navigation(SHELL_PATH));
    expect(response.status).toBe(200);
    await settle();
    expect(worker.cache.put).toHaveBeenCalledWith(SHELL_PATH, expect.anything());
  });

  it.each([
    ['a server error', () => new Response('down', { status: 503 })],
    ['a missing page', () => new Response('gone', { status: 404 })],
    ['a redirected page', () => ({ ok: true, status: 200, redirected: true, clone() { return this; } })],
  ])('never keeps %s as the app page', async (_label, makeResponse) => {
    const worker = await loadWorker();
    worker.fetchMock.mockResolvedValue(makeResponse());
    await respond(worker.handlers, navigation(SHELL_PATH));
    await settle();
    expect(worker.cache.put).not.toHaveBeenCalled();
  });

  it('serves the kept app page when the network is down', async () => {
    const worker = await loadWorker();
    worker.stored.set(SHELL_PATH, new Response('<html>kept</html>', { status: 200 }));
    worker.fetchMock.mockRejectedValue(new TypeError('offline'));
    const response = await respond(worker.handlers, navigation(SHELL_PATH));
    expect(await response.text()).toBe('<html>kept</html>');
  });

  it('never keeps a failed file', async () => {
    const worker = await loadWorker();
    worker.fetchMock.mockResolvedValue(new Response('missing', { status: 404 }));
    await respond(worker.handlers, { url: `${ORIGIN}/assets/app.css`, method: 'GET', mode: 'cors' });
    await settle();
    expect(worker.cache.put).not.toHaveBeenCalled();
  });

  it('leaves data requests to the network', async () => {
    const worker = await loadWorker();
    expect(await respond(worker.handlers, { url: 'https://example.supabase.co/rest/v1/rpc/get_training', method: 'POST', mode: 'cors' })).toBeUndefined();
  });
});
