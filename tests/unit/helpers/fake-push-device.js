// tests/unit/helpers/fake-push-device.js
// A PushDevice (src/app/push-device.js) whose browser answers are scripted.
import { vi } from 'vitest';

export const SUBSCRIPTION = Object.freeze({
  endpoint: 'https://fcm.googleapis.com/fcm/send/unit-device', p256dh: 'P'.repeat(87), auth: 'A'.repeat(22),
});

export function fakeDevice({ support = 'supported', permission = 'default', answer = 'granted', subscribed = false } = {}) {
  const state = { permission, subscribed };
  return {
    state,
    support: () => support,
    permission: () => state.permission,
    requestPermission: vi.fn(async () => {
      state.permission = answer;
      return answer;
    }),
    subscription: vi.fn(async () => (state.subscribed ? { ...SUBSCRIPTION } : null)),
    subscribe: vi.fn(async () => {
      state.subscribed = true;
      return { ...SUBSCRIPTION };
    }),
    unsubscribe: vi.fn(async () => {
      const was = state.subscribed;
      state.subscribed = false;
      return was ? SUBSCRIPTION.endpoint : null;
    }),
  };
}
