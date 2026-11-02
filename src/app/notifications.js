// src/app/notifications.js
// Turning phone notifications on and off for this device. The browser parts
// come from a device seam (Ruling 14); the account parts go through the
// notification service.
export function notificationLink(ctx) {
  return {
    device: ctx.pushDevice ?? null,
    service: ctx.services.notifications,
    locale: ctx.i18n.locale(),
    timezone: ctx.timezone,
  };
}

// Ruling 15.
export async function deviceState(device) {
  if (!device) return 'demo';
  const support = device.support();
  if (support !== 'supported') return support;
  const permission = device.permission();
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'off';
  return (await device.subscription()) ? 'on' : 'off';
}

export async function turnOn({ device, service, locale, timezone }) {
  const permission = device.permission() === 'granted' ? 'granted' : await device.requestPermission();
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'off';
  const subscription = (await device.subscription()) ?? await device.subscribe();
  try {
    await service.saveSubscription({ ...subscription, locale, timezone });
  } catch (error) {
    // Never half on: a subscription the account does not know about is removed.
    await device.unsubscribe().catch(() => null);
    throw error;
  }
  return 'on';
}

// The browser forgets first, so even offline this device stops receiving.
export async function turnOff({ device, service }) {
  const endpoint = await device.unsubscribe();
  if (endpoint) await service.deleteSubscription(endpoint).catch(() => null);
  return 'off';
}

// Ruling 7: the server learns this device's current language and zone.
export async function refreshSubscription({ device, service, locale, timezone }) {
  if (!device || device.support() !== 'supported' || device.permission() !== 'granted') return false;
  const subscription = await device.subscription();
  if (!subscription) return false;
  await service.saveSubscription({ ...subscription, locale, timezone });
  return true;
}

// Ruling 13: sign-out turns this device off, but never waits long for it.
export function forgetDevice(link, { timeoutMs = 3000 } = {}) {
  if (!link.device || link.device.support() !== 'supported') return Promise.resolve(false);
  let timer;
  const gaveUp = new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
  const done = turnOff(link).then(() => true, () => false);
  return Promise.race([done, gaveUp]).finally(() => clearTimeout(timer));
}
