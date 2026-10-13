// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { installMode, renderInstallHint } from '../../src/app/shell/install-hint.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

function memory() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), values };
}

describe('install hint', () => {
  beforeEach(() => { document.body.replaceChildren(); });

  it('explains Add to Home Screen on an iPhone and offers Install where the browser can', () => {
    expect(installMode({ userAgent: IPHONE })).toBe('ios');
    expect(installMode({ userAgent: ANDROID, canPrompt: true })).toBe('prompt');
    expect(installMode({ userAgent: ANDROID })).toBeNull();
    expect(installMode({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', touchPoints: 5 })).toBe('ios');
  });

  it('shows nothing once the app is installed', () => {
    expect(installMode({ userAgent: IPHONE, standalone: true })).toBeNull();
    expect(installMode({ userAgent: ANDROID, canPrompt: true, standalone: true })).toBeNull();
  });

  it('gives iPhone steps with a link to the guide, and remembers Not now', () => {
    const storage = memory();
    const hint = renderInstallHint({ document, i18n, storage, mode: 'ios' });
    document.body.append(hint);
    expect(hint.textContent).toContain('Add to Home Screen');
    expect(hint.querySelector('a[href="/install"]')).not.toBeNull();
    hint.querySelector('[data-action="install-later"]').click();
    expect(hint.isConnected).toBe(false);
    expect(storage.getItem('roda.installHint.dismissed')).toBe('1');
    expect(renderInstallHint({ document, i18n, storage, mode: 'ios' })).toBeNull();
  });

  it('opens the browser install prompt and goes away', async () => {
    const prompt = { prompt: vi.fn().mockResolvedValue(), userChoice: Promise.resolve({ outcome: 'accepted' }) };
    const hint = renderInstallHint({ document, i18n, storage: memory(), mode: 'prompt', installPrompt: prompt });
    document.body.append(hint);
    hint.querySelector('[data-action="install-app"]').click();
    await vi.waitFor(() => expect(hint.isConnected).toBe(false));
    expect(prompt.prompt).toHaveBeenCalledTimes(1);
  });

  it('shows nothing without a way to install', () => {
    expect(renderInstallHint({ document, i18n, storage: memory(), mode: null })).toBeNull();
  });
});
