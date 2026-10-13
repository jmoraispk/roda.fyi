// tests/unit/me-screen.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { renderMe, renderSettings } from '../../src/app/screens/me.js';

function ctx(overrides = {}) {
  const values = new Map([['roda.dashboard.locale', 'en']]);
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  return {
    document, i18n: createDashboardI18n({ document, storage, navigator: { languages: ['en'] } }),
    profile: { id: 'p1', display_name: 'João Morais', usage_mode: 'both' },
    services: { catalog: { amICurator: vi.fn().mockResolvedValue(false) }, discover: { loadMine: vi.fn().mockResolvedValue({ id: 'p1', usage_mode: 'train', discover_visibility: null, place_city: null }) }, geocoder: { searchCities: vi.fn(), reverse: vi.fn() } },
    navigate: vi.fn(), back: vi.fn(),
    ...overrides,
  };
}

describe('me screen', () => {
  it('shows the profile and section rows', async () => {
    const view = await renderMe(ctx());
    expect(view.querySelector('.me-avatar').textContent).toBe('JM');
    expect(view.querySelector('.me-name').textContent).toBe('João Morais');
    expect([...view.querySelectorAll('.me-row')].map((row) => row.getAttribute('href'))).toEqual([
      '#/me/progress', '#/me/repertoire', '#/me/teaching', '#/me/groups', '#/me/settings',
    ]);
  });

  it('lists Catalog for curators', async () => {
    const view = await renderMe(ctx({ services: { catalog: { amICurator: vi.fn().mockResolvedValue(true) } } }));
    expect(view.querySelector('a[href="#/me/catalog"]')).not.toBeNull();
  });

  it('switches language and signs out from Settings', async () => {
    const onLocaleChange = vi.fn();
    const onSignOut = vi.fn();
    const context = ctx();
    const view = await renderSettings(context, { onLocaleChange, onSignOut });
    expect(view.querySelector('.discover-settings')).not.toBeNull();
    view.querySelector('button[data-locale="pt"]').click();
    expect(context.i18n.locale()).toBe('pt');
    expect(onLocaleChange).toHaveBeenCalled();
    view.querySelector('button[data-action="sign-out"]').click();
    expect(onSignOut).toHaveBeenCalled();
    expect(view.querySelector('a[href="/dashboard"]')).toBeNull();
  });

  it('saves the profile from Settings', async () => {
    const profile = {
      completeProfile: vi.fn().mockResolvedValue({ status: 'updated' }),
      uploadProfilePicture: vi.fn(),
      loadProfile: vi.fn().mockResolvedValue({ id: 'p1', display_name: 'Ana Morais', completed_at: 'x' }),
    };
    const onProfileSaved = vi.fn();
    const context = ctx({
      profile: { id: 'p1', display_name: 'João Morais', completed_at: 'x', timezone_override: 'Europe/Lisbon', leaderboard_visible: false },
      services: { catalog: { amICurator: vi.fn().mockResolvedValue(false) }, profile, discover: { loadMine: vi.fn().mockResolvedValue({ id: 'p1', usage_mode: 'train', discover_visibility: null, place_city: null }) }, geocoder: { searchCities: vi.fn(), reverse: vi.fn() } },
    });
    const view = await renderSettings(context, { onLocaleChange() {}, onSignOut() {}, onProfileSaved });
    expect(view.querySelector('input[name="timezone"]').value).toBe('Europe/Lisbon');
    expect(view.querySelector('input[name="leaderboardVisible"]').checked).toBe(false);
    view.querySelector('input[name="displayName"]').value = 'Ana Morais';
    view.querySelector('button[data-action="save-profile"]').click();
    await vi.waitFor(() => expect(onProfileSaved).toHaveBeenCalledWith(expect.objectContaining({ display_name: 'Ana Morais' })));
    expect(profile.completeProfile).toHaveBeenCalledWith({ displayName: 'Ana Morais', timezoneChoice: 'Europe/Lisbon', leaderboardVisible: false });
    expect(view.querySelector('[data-profile-status]').textContent).toBe('Profile saved.');
  });

  it('hides Teaching in Train and switches mode from the slider', async () => {
    const setUsageMode = vi.fn().mockResolvedValue({ status: 'updated' });
    const onModeChange = vi.fn();
    const context = ctx({
      profile: { id: 'p1', display_name: 'João Morais', usage_mode: 'train' },
      services: { catalog: { amICurator: vi.fn().mockResolvedValue(false) }, profile: { setUsageMode } },
      markCoach: vi.fn(),
    });
    const view = await renderMe(context, {}, { onModeChange });
    expect(view.querySelector('a.me-top').getAttribute('href')).toBe('#/me/settings');
    expect(view.querySelector('a[href="#/me/teaching"]')).toBeNull();
    view.querySelector('[data-mode="both"]').click();
    await vi.waitFor(() => expect(view.querySelector('a[href="#/me/teaching"]')).not.toBeNull());
    expect(setUsageMode).toHaveBeenCalledWith('both');
    expect(context.profile.usage_mode).toBe('both');
    expect(context.markCoach).toHaveBeenCalled();
    expect(onModeChange).toHaveBeenCalledWith('both');
  });

  it('snaps back and explains when the mode cannot be saved', async () => {
    const setUsageMode = vi.fn().mockRejectedValue(new Error('You are offline.'));
    const onModeChange = vi.fn();
    const context = ctx({
      profile: { id: 'p1', display_name: 'João Morais', usage_mode: 'both' },
      services: { catalog: { amICurator: vi.fn().mockResolvedValue(false) }, profile: { setUsageMode } },
      markCoach: vi.fn(),
    });
    const view = await renderMe(context, {}, { onModeChange });
    view.querySelector('[data-mode="train"]').click();
    await vi.waitFor(() => expect(view.querySelector('[role="status"]').textContent).toBe('You are offline.'));
    expect(view.querySelector('[data-mode="both"]').getAttribute('aria-checked')).toBe('true');
    expect(view.querySelector('a[href="#/me/teaching"]')).not.toBeNull();
    expect(context.profile.usage_mode).toBe('both');
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it('saves rapid mode changes in order and snaps back to the last saved mode', async () => {
    const calls = [];
    let releaseFirst;
    const setUsageMode = vi.fn((mode) => {
      calls.push(mode);
      if (mode === 'both') return new Promise((resolve) => { releaseFirst = () => resolve({ status: 'updated', usage_mode: 'both' }); });
      return Promise.reject(new Error('You are offline.'));
    });
    const context = ctx({
      profile: { id: 'p1', display_name: 'João Morais', usage_mode: 'train' },
      services: { catalog: { amICurator: vi.fn().mockResolvedValue(false) }, profile: { setUsageMode } },
      markCoach: vi.fn(),
    });
    const view = await renderMe(context, {}, { onModeChange: vi.fn() });
    view.querySelector('[data-mode="both"]').click();
    view.querySelector('[data-mode="teach"]').click();
    await vi.waitFor(() => expect(calls).toEqual(['both']));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toEqual(['both']);
    releaseFirst();
    await vi.waitFor(() => expect(view.querySelector('[role="status"]').textContent).toBe('You are offline.'));
    expect(calls).toEqual(['both', 'teach']);
    expect(view.querySelector('[data-mode="both"]').getAttribute('aria-checked')).toBe('true');
    expect(context.profile.usage_mode).toBe('both');
    expect(context.markCoach).toHaveBeenCalled();
  });
});
