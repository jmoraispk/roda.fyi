import { describe, expect, it } from 'vitest';

import { readPublicConfig } from '../../scripts/build.mjs';

describe('readPublicConfig', () => {
  it('rejects a build that omits either public Supabase value', () => {
    expect(() => readPublicConfig({})).toThrow('RODA_SUPABASE_URL');
    expect(() => readPublicConfig({
      RODA_SUPABASE_URL: 'https://example.supabase.co',
    })).toThrow('RODA_SUPABASE_PUBLISHABLE_KEY');
  });

  it('rejects malformed project URLs and non-publishable keys', () => {
    expect(() => readPublicConfig({
      RODA_SUPABASE_URL: 'not-a-url',
      RODA_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    })).toThrow('valid http(s) URL');

    expect(() => readPublicConfig({
      RODA_SUPABASE_URL: 'https://example.supabase.co',
      RODA_SUPABASE_PUBLISHABLE_KEY: 'service-role-secret',
    })).toThrow('sb_publishable_');
  });

  it('returns trimmed public configuration unchanged', () => {
    expect(readPublicConfig({
      RODA_SUPABASE_URL: '  http://127.0.0.1:54321  ',
      RODA_SUPABASE_PUBLISHABLE_KEY: '  sb_publishable_local_test  ',
    })).toEqual({
      supabaseUrl: 'http://127.0.0.1:54321',
      supabasePublishableKey: 'sb_publishable_local_test',
    });
  });
});
