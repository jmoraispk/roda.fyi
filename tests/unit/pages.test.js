// tests/unit/pages.test.js
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('app pages', () => {
  it('serves the app at /app', async () => {
    const html = await readFile('app.html', 'utf8');
    expect(html).toContain('<script type="module" src="/assets/generated/app.js"></script>');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
  });

  it('turns /dashboard into a forward that keeps the query and the hash', async () => {
    const html = await readFile('dashboard.html', 'utf8');
    expect(html).toContain("location.replace('/app' + location.search + location.hash)");
    expect(html).toContain('<meta http-equiv="refresh" content="0; url=/app">');
    expect(html).not.toContain('type="module"');
    expect(html).not.toContain('<dialog');
  });

  it('sends a failed sign-in back to the app, not the old dashboard', async () => {
    const html = await readFile('auth/callback.html', 'utf8');
    expect(html).toContain('<a href="/app">Open Roda</a>');
    expect(html).not.toContain('href="/dashboard"');
  });
});
