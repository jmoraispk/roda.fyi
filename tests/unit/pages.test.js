// tests/unit/pages.test.js
import { readdir, readFile, stat } from 'node:fs/promises';

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

  it('links stylesheets that exist and leaves none unused', async () => {
    const linked = new Set();
    for (const page of ['index.html', 'app.html', 'dashboard.html', 'studio.html', 'auth/callback.html']) {
      const html = await readFile(page, 'utf8');
      for (const match of html.matchAll(/<link rel="stylesheet" href="\/?(assets\/[^"]+\.css)"/g)) linked.add(match[1]);
    }
    for (const path of linked) await expect(stat(path)).resolves.toBeTruthy();
    const topLevel = (await readdir('assets')).filter((name) => name.endsWith('.css')).map((name) => `assets/${name}`);
    expect(topLevel.filter((path) => !linked.has(path))).toEqual([]);
  });

  it('has a shareable install page with steps for iPhone and Android', async () => {
    const html = await readFile('install.html', 'utf8');
    expect(html).toContain('Add to Home Screen');
    expect(html).toContain('Open as Web App');
    expect(html).toContain('Install app');
    expect(html).toContain('href="/app"');
    expect(html).not.toMatch(/<script/);
  });
});
