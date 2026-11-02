// src/app/push-device.js
// The browser side of notifications: support, permission, and this device's
// push subscription (Ruling 14). Tests use a fake with the same shape.
export function base64UrlToBytes(text) {
  const base64 = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function pushSupport({ window, navigator }) {
  const userAgent = navigator?.userAgent ?? '';
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && (navigator?.maxTouchPoints ?? 0) > 1);
  const standalone = Boolean(window?.matchMedia?.('(display-mode: standalone)').matches || navigator?.standalone === true);
  if (ios && !standalone) return 'ios-browser';
  if (!navigator?.serviceWorker || !window?.PushManager || !window?.Notification) return 'unsupported';
  return 'supported';
}

function plain(subscription) {
  if (!subscription) return null;
  const { endpoint, keys = {} } = subscription.toJSON();
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

export function createPushDevice({ window, navigator, vapidPublicKey, readyTimeoutMs = 4000 }) {
  // A service worker that failed to install never becomes ready; give up rather
  // than leave Settings (and Sign out) waiting forever.
  const pushManager = async () => {
    let timer;
    const gaveUp = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('service_worker_unavailable')), readyTimeoutMs);
    });
    try {
      return (await Promise.race([navigator.serviceWorker.ready, gaveUp])).pushManager;
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    support: () => pushSupport({ window, navigator }),
    permission: () => window.Notification?.permission ?? 'default',
    requestPermission: () => window.Notification.requestPermission(),
    async subscription() {
      return plain(await (await pushManager()).getSubscription());
    },
    async subscribe() {
      return plain(await (await pushManager()).subscribe({
        userVisibleOnly: true, applicationServerKey: base64UrlToBytes(vapidPublicKey),
      }));
    },
    async unsubscribe() {
      const current = await (await pushManager()).getSubscription();
      if (!current) return null;
      await current.unsubscribe();
      return current.endpoint;
    },
  };
}
