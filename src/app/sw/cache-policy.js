// src/app/sw/cache-policy.js
// The page the worker keeps for offline use.
export const SHELL_PATH = '/app';

// Only a good, direct answer may become something served offline later.
export function shouldCache(response) {
  return Boolean(response?.ok) && !response.redirected;
}

export const APP_SHELL = Object.freeze([
  SHELL_PATH,
  '/assets/app.css',
  '/assets/training-forms.css',
  '/assets/training-statistics.css',
  '/assets/generated/app.js',
  '/assets/generated/leaflet.css',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/assets/fonts/syne-800-latin.woff2',
  '/assets/fonts/hanken-grotesk-400-latin.woff2',
  '/assets/fonts/hanken-grotesk-600-latin.woff2',
  '/assets/fonts/space-mono-700-latin.woff2',
]);

export function cacheName(version) {
  return `roda-app-${version}`;
}

export function strategyFor({ url, method, mode, origin }) {
  if (method !== 'GET') return 'bypass';
  const target = new URL(url);
  if (target.origin !== origin) return 'bypass';
  if (mode === 'navigate') return target.pathname === SHELL_PATH ? 'network-first' : 'bypass';
  if (target.pathname.startsWith('/assets/') || target.pathname === '/manifest.webmanifest'
    || target.pathname === '/favicon.svg') {
    return 'stale-while-revalidate';
  }
  return 'bypass';
}
