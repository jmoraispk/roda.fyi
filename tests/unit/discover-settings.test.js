// tests/unit/discover-settings.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { renderDiscoverSettings } from '../../src/app/screens/discover-settings.js';

const LISBON = { city: 'Lisbon', region: 'Lisbon', country: 'Portugal', lat: 38.72, lng: -9.14 };
const EMPTY = {
  id: 'p1', usage_mode: 'train', discover_visibility: null, place_city: null, place_region: null, place_country: null,
  place_lat: null, place_lng: null, contact_instagram: null, contact_website: null, contact_whatsapp: null, contact_email: null,
};

function ctx({ mine = EMPTY, discover = {}, geocoder = {} } = {}) {
  const values = new Map([['roda.dashboard.locale', 'en']]);
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const sheets = [];
  const maps = [];
  return {
    document, sheets, maps,
    i18n: createDashboardI18n({ document, storage, navigator: { languages: ['en'] } }),
    profile: { id: 'p1', display_name: 'Ana Silva' },
    services: {
      discover: { loadMine: vi.fn().mockResolvedValue(mine), updateMine: vi.fn().mockResolvedValue({ status: 'updated' }), ...discover },
      geocoder: { searchCities: vi.fn().mockResolvedValue([LISBON]), reverse: vi.fn().mockResolvedValue(LISBON), ...geocoder },
    },
    openSheet: vi.fn((options) => {
      const sheet = { ...options, close: vi.fn(() => options.onClose?.()) };
      sheets.push(sheet);
      return sheet;
    }),
    createMap: vi.fn((options) => {
      const map = { options, setPoints: vi.fn(), flyTo: vi.fn(), destroy: vi.fn() };
      maps.push(map);
      return map;
    }),
  };
}

async function mount(context) {
  const view = await renderDiscoverSettings(context);
  document.body.replaceChildren(view);
  return view;
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const press = (node, key) => node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

async function chooseLisbon(view) {
  const input = view.querySelector('input[aria-label="Search a city"]');
  input.value = 'Lisbon';
  press(input, 'Enter');
  await flush();
  [...view.querySelectorAll('.discover-city-results button')].find((button) => button.textContent === 'Lisbon, Portugal').click();
}

describe('Discover settings', () => {
  it('shows the mode default when nothing was chosen', async () => {
    const view = await mount(ctx());
    expect(view.querySelector('.discover-city-current').textContent).toBe('No city yet.');
    expect(view.querySelector('input[value="nobody"]').checked).toBe(true);
    expect(view.textContent).toContain("You haven't chosen yet, so this follows your mode.");
    expect(view.textContent).toContain('Map images and city search come from OpenStreetMap.');
  });

  it('shows a Teach person as findable by everyone', async () => {
    const view = await mount(ctx({ mine: { ...EMPTY, usage_mode: 'teach' } }));
    expect(view.querySelector('input[value="everyone"]').checked).toBe(true);
  });

  it('asks the geocoder only when Search is pressed, once per press', async () => {
    const context = ctx();
    const view = await mount(context);
    const input = view.querySelector('input[aria-label="Search a city"]');
    input.value = 'Lisbon';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(context.services.geocoder.searchCities).not.toHaveBeenCalled();
    press(input, 'Enter');
    view.querySelector('.discover-city-search button').click();
    await flush();
    expect(context.services.geocoder.searchCities).toHaveBeenCalledTimes(1);
    expect(context.services.geocoder.searchCities).toHaveBeenCalledWith('Lisbon');
    [...view.querySelectorAll('.discover-city-results button')].find((button) => button.textContent === 'Lisbon, Portugal').click();
    expect(view.querySelector('.discover-city-current').textContent).toBe('Lisbon, Portugal');
  });

  it('keeps the typed city when city search is unavailable', async () => {
    const view = await mount(ctx({ geocoder: { searchCities: vi.fn().mockRejectedValue(new Error('down')) } }));
    const input = view.querySelector('input[aria-label="Search a city"]');
    input.value = 'Lisbon';
    press(input, 'Enter');
    await flush();
    expect(view.textContent).toContain("City search isn't available right now. Try again in a moment.");
    expect(input.value).toBe('Lisbon');
    expect(view.querySelector('.discover-city-search button').disabled).toBe(false);
  });

  it('blocks invalid contacts before saving', async () => {
    const context = ctx();
    const view = await mount(context);
    view.querySelector('input[name="website"]').value = 'http://ana.example';
    view.querySelector('input[name="email"]').value = 'ana@example';
    view.querySelector('button[data-action="save-discover"]').click();
    await flush();
    expect(context.services.discover.updateMine).not.toHaveBeenCalled();
    expect(view.textContent).toContain('Use a full address starting with https://.');
    expect(view.textContent).toContain('Enter a valid email address.');
    expect(document.activeElement).toBe(view.querySelector('input[name="website"]'));
  });

  it('saves the place, contacts, and an unchosen visibility as null', async () => {
    const context = ctx();
    const view = await mount(context);
    await chooseLisbon(view);
    view.querySelector('input[name="instagram"]').value = '@ana.silva';
    view.querySelector('button[data-action="save-discover"]').click();
    await flush();
    expect(context.services.discover.updateMine).toHaveBeenLastCalledWith({
      visibility: null, place: LISBON, contacts: { instagram: 'ana.silva', website: null, whatsapp: null, email: null },
    });
    expect(view.textContent).toContain('Saved.');
    const nobody = view.querySelector('input[value="nobody"]');
    nobody.checked = true;
    nobody.dispatchEvent(new Event('change', { bubbles: true }));
    view.querySelector('button[data-action="save-discover"]').click();
    await flush();
    expect(context.services.discover.updateMine.mock.lastCall[0].visibility).toBe('nobody');
  });

  it('shows a server rejection next to its field', async () => {
    const rejection = Object.assign(new Error('Something went wrong.'), { kind: 'validation', code: 'invalid_whatsapp' });
    const view = await mount(ctx({ discover: { updateMine: vi.fn().mockRejectedValue(rejection) } }));
    view.querySelector('input[name="whatsapp"]').value = '+351 912 345 678';
    view.querySelector('button[data-action="save-discover"]').click();
    await flush();
    expect(view.querySelector('input[name="whatsapp"]').getAttribute('aria-invalid')).toBe('true');
    expect(view.textContent).toContain('Use 6 to 20 digits, optionally starting with +.');
  });

  it('picks a city by tapping the map', async () => {
    const context = ctx();
    const view = await mount(context);
    view.querySelector('button[data-action="pick-on-map"]').click();
    expect(context.maps[0].options.view).toEqual({ lat: 20, lng: 0, zoom: 2 });
    await context.maps[0].options.onTap({ lat: 38.7123, lng: -9.1398 });
    expect(context.services.geocoder.reverse).toHaveBeenCalledWith({ lat: 38.7123, lng: -9.1398 });
    expect(context.sheets[0].close).toHaveBeenCalled();
    expect(context.maps[0].destroy).toHaveBeenCalled();
    expect(view.querySelector('.discover-city-current').textContent).toBe('Lisbon, Portugal');
  });
});
