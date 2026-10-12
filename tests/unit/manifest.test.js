// tests/unit/manifest.test.js
import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('web app manifest', () => {
  it('describes an installable standalone app', async () => {
    const manifest = JSON.parse(await readFile('manifest.webmanifest', 'utf8'));
    expect(manifest).toMatchObject({
      name: 'Roda', short_name: 'Roda', start_url: '/app', scope: '/app', display: 'standalone',
      background_color: '#17120d', theme_color: '#17120d',
    });
    const sizes = manifest.icons.map(({ sizes: value }) => value);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    for (const icon of manifest.icons) expect((await stat(icon.src.slice(1))).size).toBeGreaterThan(500);
  });
});
