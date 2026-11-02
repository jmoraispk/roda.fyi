// src/app/sw/push-policy.js
// What the service worker shows for a push, and where a tap may lead.
import { SHELL_PATH } from './cache-policy.js';

export const NOTIFICATION_ICON = '/assets/icons/app-192.png';
const APP_LINK = /^\/app(#\/[A-Za-z0-9/_-]*)?$/;

// Ruling 18: a notification only ever opens a screen of the app itself.
export function appLink(url) {
  return typeof url === 'string' && APP_LINK.test(url) ? url : SHELL_PATH;
}

function text(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

// iPhones stop delivering to a site whose pushes show nothing, so every push
// becomes a notification, even one that cannot be read.
export function notificationFromPush(data) {
  let message = {};
  try {
    message = data?.json() ?? {};
  } catch {
    message = {};
  }
  const tag = text(message.tag, 64);
  return {
    title: text(message.title, 120) || 'roda',
    options: {
      body: text(message.body, 240),
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_ICON,
      ...(tag ? { tag } : {}),
      data: { url: appLink(message.url) },
    },
  };
}
