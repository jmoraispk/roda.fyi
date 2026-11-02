import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PRODUCTION_VAPID_PUBLIC_KEY, TEST_VAPID_PUBLIC_KEY, buildBrowserBundles, readPublicConfig,
} from '../../scripts/build.mjs';

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
      RODA_VAPID_PUBLIC_KEY: `  ${TEST_VAPID_PUBLIC_KEY}  `,
    })).toEqual({
      supabaseUrl: 'http://127.0.0.1:54321',
      supabasePublishableKey: 'sb_publishable_local_test',
      vapidPublicKey: TEST_VAPID_PUBLIC_KEY,
    });
  });

  it('uses the committed notification public key unless one is given', () => {
    const base = { RODA_SUPABASE_URL: 'https://example.supabase.co', RODA_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
    expect(readPublicConfig(base).vapidPublicKey).toBe(PRODUCTION_VAPID_PUBLIC_KEY);
    expect(() => readPublicConfig({ ...base, RODA_VAPID_PUBLIC_KEY: 'not a key' }))
      .toThrow('RODA_VAPID_PUBLIC_KEY must be a base64url P-256 public key');
    // 65 bytes, but not an uncompressed point (first byte is not 0x04).
    expect(() => readPublicConfig({ ...base, RODA_VAPID_PUBLIC_KEY: Buffer.alloc(65, 1).toString('base64url') }))
      .toThrow('RODA_VAPID_PUBLIC_KEY must be a base64url P-256 public key');
  });

  it('ships valid uncompressed P-256 public keys', () => {
    for (const key of [PRODUCTION_VAPID_PUBLIC_KEY, TEST_VAPID_PUBLIC_KEY]) {
      const raw = Buffer.from(key, 'base64url');
      expect(raw).toHaveLength(65);
      expect(raw[0]).toBe(4);
    }
  });
});

describe('buildBrowserBundles', () => {
  it('isolates test artifacts and removes their source maps for deployment', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'roda-browser-build-'));

    const priorUrl = process.env.RODA_SUPABASE_URL;
    const priorKey = process.env.RODA_SUPABASE_PUBLISHABLE_KEY;
    try {
      await buildBrowserBundles({ test: true, outputDirectory });
      const leafletCss = await readFile(join(outputDirectory, 'leaflet.css'), 'utf8');
      expect(leafletCss).toContain('.leaflet-container');
      expect(leafletCss).not.toMatch(/url\(["']?images\//);
      await expect(access(join(outputDirectory, 'public-auth.js.map'))).resolves.toBeUndefined();

      process.env.RODA_SUPABASE_URL = 'https://example.supabase.co';
      process.env.RODA_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_build_test';
      await buildBrowserBundles({ outputDirectory });

      await expect(access(join(outputDirectory, 'public-auth.js.map'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      if (priorUrl === undefined) delete process.env.RODA_SUPABASE_URL;
      else process.env.RODA_SUPABASE_URL = priorUrl;
      if (priorKey === undefined) delete process.env.RODA_SUPABASE_PUBLISHABLE_KEY;
      else process.env.RODA_SUPABASE_PUBLISHABLE_KEY = priorKey;
      await rm(outputDirectory, { force: true, recursive: true });
    }
  });
});
