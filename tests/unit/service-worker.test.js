// tests/unit/service-worker.test.js
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SHELL_PATH } from '../../src/app/sw/cache-policy.js';
import { ORIGIN, dispatch, lifecycle, loadWorker as load, respond } from './helpers/worker-harness.js';

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

describe('service worker notifications', () => {
  const push = (message) => ({ data: { json: () => message } });

  it('shows each push as a notification that remembers its link', async () => {
    const worker = await loadWorker();
    await dispatch(worker.handlers, 'push', push({ title: 'Class in 1 hour', body: 'Group class · Grupo Lua at 7:00 PM', url: '/app#/class/s1', tag: 'd1' }));
    expect(worker.self.registration.showNotification).toHaveBeenCalledWith('Class in 1 hour', {
      body: 'Group class · Grupo Lua at 7:00 PM', icon: '/assets/icons/app-192.png', badge: '/assets/icons/app-192.png',
      tag: 'd1', data: { url: '/app#/class/s1' },
    });
  });

  it('still shows something for a push it cannot read', async () => {
    const worker = await loadWorker();
    await dispatch(worker.handlers, 'push', { data: { json: () => { throw new SyntaxError('bad'); } } });
    await dispatch(worker.handlers, 'push', { data: null });
    expect(worker.self.registration.showNotification).toHaveBeenCalledTimes(2);
    expect(worker.self.registration.showNotification).toHaveBeenLastCalledWith('roda', expect.objectContaining({ body: '', data: { url: '/app' } }));
  });

  it('never links outside the app', async () => {
    const worker = await loadWorker();
    await dispatch(worker.handlers, 'push', push({ title: 'x', url: 'https://attacker.example/app#/' }));
    await dispatch(worker.handlers, 'push', push({ title: 'x', url: 'javascript:alert(1)' }));
    expect(worker.self.registration.showNotification.mock.calls.map(([, options]) => options.data.url)).toEqual(['/app', '/app']);
  });

  it('a tap moves an open app to the right screen', async () => {
    const open = { url: `${ORIGIN}/app#/`, focus: vi.fn(async () => open), navigate: vi.fn(async () => open) };
    const worker = await loadWorker({ windowClients: [{ url: `${ORIGIN}/install`, focus: vi.fn() }, open] });
    const notification = { data: { url: '/app#/training/o1' }, close: vi.fn() };
    await dispatch(worker.handlers, 'notificationclick', { notification });
    expect(notification.close).toHaveBeenCalled();
    expect(open.focus).toHaveBeenCalled();
    expect(open.navigate).toHaveBeenCalledWith(`${ORIGIN}/app#/training/o1`);
    expect(worker.self.clients.openWindow).not.toHaveBeenCalled();
  });

  it('a tap opens the app when it is closed', async () => {
    const worker = await loadWorker();
    await dispatch(worker.handlers, 'notificationclick', { notification: { data: { url: '/app#/me/teaching' }, close: vi.fn() } });
    expect(worker.self.clients.openWindow).toHaveBeenCalledWith('/app#/me/teaching');
  });

  it('a tap on a notification with a strange link opens Today', async () => {
    const worker = await loadWorker();
    await dispatch(worker.handlers, 'notificationclick', { notification: { data: { url: '//attacker.example' }, close: vi.fn() } });
    expect(worker.self.clients.openWindow).toHaveBeenCalledWith('/app');
  });
});
