import { describe, expect, it } from 'vitest';

import {
  consumeReturnRoute,
  rememberReturnRoute,
  sanitizeReturnRoute,
} from '../../src/app/return-route.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

describe('sanitizeReturnRoute', () => {
  it('preserves a local dashboard invitation route', () => {
    expect(sanitizeReturnRoute('/dashboard?member_invite=abc123#request'))
      .toBe('/dashboard?member_invite=abc123#request');
  });

  it.each([
    'https://evil.example/dashboard',
    '//evil.example/dashboard',
    'javascript:alert(1)',
    '\\evil.example',
    'dashboard',
    '',
    null,
  ])('rejects unsafe return route %s', (candidate) => {
    expect(sanitizeReturnRoute(candidate)).toBe('/app');
  });
});

describe('rememberReturnRoute', () => {
  it('stores only a sanitized local route', () => {
    const storage = memoryStorage();

    rememberReturnRoute(storage, 'https://evil.example');

    expect(storage.getItem('roda.auth.returnRoute')).toBe('/app');
  });
});

describe('consumeReturnRoute', () => {
  it('prefers a safe callback query and removes the remembered route', () => {
    const storage = memoryStorage({
      'roda.auth.returnRoute': '/dashboard?group_link=remembered',
    });

    expect(consumeReturnRoute({
      search: '?code=pkce-code&next=%2Fdashboard%3Fmember_invite%3Dfrom-email',
      storage,
    })).toBe('/dashboard?member_invite=from-email');
    expect(storage.getItem('roda.auth.returnRoute')).toBeNull();
  });

  it('uses a remembered invitation when the callback has no safe next value', () => {
    const storage = memoryStorage({
      'roda.auth.returnRoute': '/dashboard?group_link=group-token',
    });

    expect(consumeReturnRoute({
      search: '?next=https%3A%2F%2Fevil.example',
      storage,
    })).toBe('/dashboard?group_link=group-token');
  });

  it('keeps an old dashboard link so it can forward to the app', () => {
    expect(sanitizeReturnRoute('/dashboard?member_invite=abc')).toBe('/dashboard?member_invite=abc');
  });
});
