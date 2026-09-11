import { describe, expect, it } from 'vitest';

import { createRodaClient } from '../../src/app/supabase-client.js';

describe('createRodaClient', () => {
  it('creates one PKCE browser client without automatic URL token handling', () => {
    const calls = [];
    const sentinel = { auth: {} };
    const createClient = (...args) => {
      calls.push(args);
      return sentinel;
    };

    expect(createRodaClient({
      supabaseUrl: 'https://example.supabase.co',
      supabasePublishableKey: 'sb_publishable_browser_test',
    }, createClient)).toBe(sentinel);
    expect(calls).toEqual([[
      'https://example.supabase.co',
      'sb_publishable_browser_test',
      {
        auth: {
          flowType: 'pkce',
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: 'roda.auth.session',
        },
      },
    ]]);
  });
});
