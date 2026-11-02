// tests/unit/push-device.test.js
import { describe, expect, it, vi } from 'vitest';

import { base64UrlToBytes, createPushDevice, pushSupport } from '../../src/app/push-device.js';

const KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

const pushSubscription = (endpoint) => ({
  endpoint,
  toJSON: () => ({ endpoint, keys: { p256dh: 'P'.repeat(87), auth: 'A'.repeat(22) } }),
  unsubscribe: vi.fn(async () => true),
});

function browser({ userAgent = ANDROID, standalone = false, push = true, permission = 'default', current = null } = {}) {
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => pushSubscription('https://fcm.googleapis.com/fcm/send/new')),
  };
  const window = {
    matchMedia: () => ({ matches: standalone }),
    ...(push ? { PushManager: function PushManager() {}, Notification: { permission, requestPermission: vi.fn(async () => 'granted') } } : {}),
  };
  const navigator = { userAgent, maxTouchPoints: 5, ...(push ? { serviceWorker: { ready: Promise.resolve({ pushManager }) } } : {}) };
  return { window, navigator, pushManager };
}

describe('push device', () => {
  it('tells an iPhone in Safari to use the Home Screen app first', () => {
    expect(pushSupport(browser({ userAgent: IPHONE, push: false }))).toBe('ios-browser');
    expect(pushSupport(browser({ userAgent: IPHONE, standalone: true }))).toBe('supported');
    expect(pushSupport(browser({ push: false }))).toBe('unsupported');
    expect(pushSupport(browser())).toBe('supported');
  });

  it('decodes the public key the browser needs', () => {
    const bytes = base64UrlToBytes(KEY);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
  });

  it('asks the browser for permission', async () => {
    const env = browser({ permission: 'denied' });
    const device = createPushDevice({ ...env, vapidPublicKey: KEY });
    expect(device.permission()).toBe('denied');
    expect(await device.requestPermission()).toBe('granted');
  });

  it('subscribes with the public key and returns plain keys', async () => {
    const env = browser();
    const device = createPushDevice({ ...env, vapidPublicKey: KEY });
    expect(await device.subscription()).toBeNull();
    expect(await device.subscribe()).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/new', p256dh: 'P'.repeat(87), auth: 'A'.repeat(22) });
    const [options] = env.pushManager.subscribe.mock.calls[0];
    expect(options.userVisibleOnly).toBe(true);
    expect([...options.applicationServerKey]).toEqual([...base64UrlToBytes(KEY)]);
  });

  it('unsubscribes and returns the endpoint it removed', async () => {
    const current = pushSubscription('https://web.push.apple.com/old');
    const device = createPushDevice({ ...browser({ current }), vapidPublicKey: KEY });
    expect(await device.unsubscribe()).toBe('https://web.push.apple.com/old');
    expect(current.unsubscribe).toHaveBeenCalled();
    expect(await createPushDevice({ ...browser(), vapidPublicKey: KEY }).unsubscribe()).toBeNull();
  });
});
