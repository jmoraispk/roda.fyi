// tests/unit/cache-policy.test.js
import { describe, expect, it } from 'vitest';

import { APP_SHELL, cacheName, strategyFor } from '../../src/app/sw/cache-policy.js';

const origin = 'https://roda.fyi';
const req = (path, extra = {}) => ({ url: new URL(path, origin).href, method: 'GET', mode: 'cors', origin, ...extra });

describe('cache policy', () => {
  it('precaches the app shell only', () => {
    expect(APP_SHELL).toEqual(expect.arrayContaining(['/app', '/assets/app.css', '/assets/generated/app.js', '/manifest.webmanifest']));
    expect(APP_SHELL.every((path) => path.startsWith('/'))).toBe(true);
  });

  it.each([
    [req('/app', { mode: 'navigate' }), 'network-first'],
    [req('/assets/app.css'), 'stale-while-revalidate'],
    [req('/assets/generated/app.js'), 'stale-while-revalidate'],
    [req('/assets/fonts/syne-800-latin.woff2'), 'stale-while-revalidate'],
    [{ ...req('/rest/v1/rpc/get_training'), url: 'https://cemtojrbroegisjpfxpz.supabase.co/rest/v1/rpc/get_training' }, 'bypass'],
    [req('/assets/app.css', { method: 'POST' }), 'bypass'],
    [req('/dashboard', { mode: 'navigate' }), 'bypass'],
    [req('/api/clip'), 'bypass'],
  ])('chooses %o → %s', (request, strategy) => {
    expect(strategyFor(request)).toBe(strategy);
  });

  it('names caches by version', () => {
    expect(cacheName('123')).toBe('roda-app-123');
  });
});
