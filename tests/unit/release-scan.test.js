// tests/unit/release-scan.test.js
// Runs the secret scan from docs/security-checklist.md against a production
// build, so the documented command and the shipped bundles cannot drift apart.
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildBrowserBundles } from '../../scripts/build.mjs';

async function documentedPattern() {
  const checklist = await readFile('docs/security-checklist.md', 'utf8');
  const match = /rg -n "([^"]+)" assets\/generated/.exec(checklist);
  return new RegExp(match[1]);
}

describe('release secret scan', () => {
  it('finds nothing in a production build', async () => {
    const pattern = await documentedPattern();
    const out = await mkdtemp(join(tmpdir(), 'roda-release-scan-'));
    const prior = { url: process.env.RODA_SUPABASE_URL, key: process.env.RODA_SUPABASE_PUBLISHABLE_KEY };
    process.env.RODA_SUPABASE_URL = 'https://example.supabase.co';
    process.env.RODA_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_release_scan';
    try {
      await buildBrowserBundles({ outputDirectory: out });
      const hits = [];
      for (const name of await readdir(out)) {
        if (pattern.test(await readFile(join(out, name), 'utf8'))) hits.push(name);
      }
      expect(hits).toEqual([]);
    } finally {
      if (prior.url === undefined) delete process.env.RODA_SUPABASE_URL;
      else process.env.RODA_SUPABASE_URL = prior.url;
      if (prior.key === undefined) delete process.env.RODA_SUPABASE_PUBLISHABLE_KEY;
      else process.env.RODA_SUPABASE_PUBLISHABLE_KEY = prior.key;
      await rm(out, { force: true, recursive: true });
    }
  }, 60000);
});
