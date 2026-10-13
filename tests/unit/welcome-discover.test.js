// tests/unit/welcome-discover.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { discoverStep } from '../../src/app/screens/welcome-discover.js';

const LISBON = { city: 'Lisbon', region: 'Lisbon', country: 'Portugal', lat: 38.72, lng: -9.14 };

function ctx(updateMine = vi.fn().mockResolvedValue({ status: 'updated' })) {
  const values = new Map([['roda.dashboard.locale', 'en']]);
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  return {
    document,
    i18n: createDashboardI18n({ document, storage, navigator: { languages: ['en'] } }),
    profile: { id: 'p1', display_name: 'Ana Silva' },
    services: { discover: { updateMine }, geocoder: { searchCities: vi.fn().mockResolvedValue([LISBON]), reverse: vi.fn() } },
  };
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const choose = (view, value) => {
  const radio = view.querySelector(`input[value="${value}"]`);
  radio.checked = true;
  radio.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('welcome Discover step', () => {
  it('defaults who can find you from the chosen mode and follows a mode change', () => {
    const context = ctx();
    const state = { mode: 'teach' };
    expect(discoverStep.render(state, context).querySelector('input[value="everyone"]').checked).toBe(true);
    state.mode = 'train';
    expect(discoverStep.render(state, context).querySelector('input[value="nobody"]').checked).toBe(true);
  });

  it('saves the city with an unchosen visibility', async () => {
    const context = ctx();
    const state = { mode: 'both' };
    const view = discoverStep.render(state, context);
    document.body.replaceChildren(view);
    const input = view.querySelector('input[aria-label="Search a city"]');
    input.value = 'Lisbon';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flush();
    [...view.querySelectorAll('button')].find((button) => button.textContent === 'Lisbon, Portugal').click();
    await discoverStep.save(state, context);
    expect(context.services.discover.updateMine).toHaveBeenCalledWith({ visibility: null, place: LISBON, contacts: {} });
  });

  it('saves a chosen visibility without a city, and keeps it across re-renders', async () => {
    const context = ctx();
    const state = { mode: 'train' };
    choose(discoverStep.render(state, context), 'everyone');
    expect(discoverStep.render(state, context).querySelector('input[value="everyone"]').checked).toBe(true);
    await discoverStep.save(state, context);
    expect(context.services.discover.updateMine).toHaveBeenCalledWith({ visibility: 'everyone', place: null, contacts: {} });
  });

  it('saves nothing when nothing was chosen', async () => {
    const context = ctx();
    const state = { mode: 'train' };
    discoverStep.render(state, context);
    await discoverStep.save(state, context);
    expect(context.services.discover.updateMine).not.toHaveBeenCalled();
  });

  it('lets a failed save reach the welcome so the person stays on it', async () => {
    const context = ctx(vi.fn().mockRejectedValue(new Error('The network request failed. Please try again.')));
    const state = { mode: 'train' };
    choose(discoverStep.render(state, context), 'nobody');
    await expect(discoverStep.save(state, context)).rejects.toThrow('The network request failed. Please try again.');
  });
});
