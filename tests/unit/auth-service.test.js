import { describe, expect, it } from 'vitest';

import { createAuthService } from '../../src/app/auth-service.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function authClient(overrides = {}) {
  const calls = [];
  const auth = {
    signInWithOAuth: async (request) => {
      calls.push(['oauth', request]);
      return { data: { provider: request.provider }, error: null };
    },
    signInWithOtp: async (request) => {
      calls.push(['otp', request]);
      return { data: { sent: true }, error: null };
    },
    exchangeCodeForSession: async (code) => {
      calls.push(['exchange', code]);
      return { data: { session: { user: { id: 'user-1' } } }, error: null };
    },
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: (listener) => ({
      data: { subscription: { unsubscribe() {} } },
      listener,
    }),
    signOut: async () => {
      calls.push(['signOut']);
      return { error: null };
    },
    ...overrides,
  };
  return { client: { auth }, calls };
}

describe('createAuthService', () => {
  it('starts Google OAuth with a safe callback and remembers the destination', async () => {
    const { client, calls } = authClient();
    const storage = memoryStorage();
    const service = createAuthService({
      client,
      origin: 'https://roda.fyi',
      storage,
    });

    await service.signInWithGoogle('/dashboard?group_link=group-token');

    expect(calls).toEqual([['oauth', {
      provider: 'google',
      options: {
        redirectTo: 'https://roda.fyi/auth/callback?next=%2Fdashboard%3Fgroup_link%3Dgroup-token',
      },
    }]]);
    expect(storage.getItem('roda.auth.returnRoute'))
      .toBe('/dashboard?group_link=group-token');
  });

  it('sends a passwordless email link through the same callback', async () => {
    const { client, calls } = authClient();
    const service = createAuthService({
      client,
      origin: 'https://roda.fyi',
      storage: memoryStorage(),
    });

    await service.sendEmailLink('  learner@example.com  ', '/dashboard');

    expect(calls).toEqual([['otp', {
      email: 'learner@example.com',
      options: {
        emailRedirectTo: 'https://roda.fyi/auth/callback?next=%2Fdashboard',
        shouldCreateUser: true,
      },
    }]]);
  });

  it.each(['', 'not-an-email', '@example.com'])('rejects invalid email %s', async (email) => {
    const { client } = authClient();
    const service = createAuthService({
      client,
      origin: 'https://roda.fyi',
      storage: memoryStorage(),
    });

    await expect(service.sendEmailLink(email, '/dashboard')).rejects.toMatchObject({
      kind: 'validation',
      code: 'invalid_email',
    });
  });

  it('exchanges a callback code and restores an email invitation route', async () => {
    const { client, calls } = authClient();
    const storage = memoryStorage();
    const service = createAuthService({
      client,
      origin: 'https://roda.fyi',
      storage,
    });

    const result = await service.finishCallback(
      '?code=pkce-code&next=%2Fdashboard%3Fmember_invite%3Dinvite-token',
    );

    expect(result.returnRoute).toBe('/dashboard?member_invite=invite-token');
    expect(result.session.user.id).toBe('user-1');
    expect(calls).toEqual([['exchange', 'pkce-code']]);
  });

  it('keeps the remembered route when exchange fails so sign-in can be retried', async () => {
    const { client } = authClient({
      exchangeCodeForSession: async () => ({
        data: { session: null },
        error: { code: 'otp_expired', message: 'otp_expired' },
      }),
    });
    const storage = memoryStorage({
      'roda.auth.returnRoute': '/dashboard?member_invite=invite-token',
    });
    const service = createAuthService({
      client,
      origin: 'https://roda.fyi',
      storage,
    });

    await expect(service.finishCallback('?code=expired-code')).rejects.toMatchObject({
      kind: 'expired',
      code: 'otp_expired',
    });
    expect(storage.getItem('roda.auth.returnRoute'))
      .toBe('/dashboard?member_invite=invite-token');
  });

  it('clears remembered private navigation when signing out', async () => {
    const { client, calls } = authClient();
    const storage = memoryStorage({
      'roda.auth.returnRoute': '/dashboard?group_link=secret-link',
      'roda.dashboard.mode': 'coaching',
      'roda.dashboard.group': 'group-1',
    });
    const service = createAuthService({
      client,
      origin: 'https://roda.fyi',
      storage,
    });

    await service.signOut();

    expect(calls).toEqual([['signOut']]);
    expect(storage.getItem('roda.auth.returnRoute')).toBeNull();
    expect(storage.getItem('roda.dashboard.mode')).toBeNull();
    expect(storage.getItem('roda.dashboard.group')).toBeNull();
  });
});
