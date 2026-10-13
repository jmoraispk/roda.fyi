// tests/unit/discover-screen.test.js
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { releaseDiscoverMap, renderDiscover, resetDiscoverMemory } from '../../src/app/screens/discover.js';

const LISBON = {
  kind: 'city', city: 'Lisbon', region: 'Lisbon', country: 'Portugal', lat: 38.72, lng: -9.14,
  person_count: 3, group_id: null, name: null, location: null,
};
const GROUP = {
  kind: 'group', city: 'Lisbon', region: 'Lisbon', country: 'Portugal', lat: 38.73, lng: -9.13,
  person_count: null, group_id: 'g1', name: 'Grupo Lua', location: 'Arroios',
};
const WORLD = { bounds: { minLat: -60, minLng: -540, maxLat: 80, maxLng: 540 }, view: { lat: 20, lng: 0, zoom: 2 } };
const NO_PLACE = { id: 'me', usage_mode: 'train', place_city: null };
const MY_LISBON = { ...NO_PLACE, place_city: 'Lisbon', place_region: 'Lisbon', place_country: 'Portugal', place_lat: 38.72, place_lng: -9.14 };

function setup({ mine = NO_PLACE, discover = {}, geocoder = {} } = {}) {
  const maps = [];
  const values = new Map([['roda.dashboard.locale', 'en']]);
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const ctx = {
    document, window,
    i18n: createDashboardI18n({ document, storage, navigator: { languages: ['en'] } }),
    profile: { id: 'me', display_name: 'Ana Silva' },
    navigate: vi.fn(),
    services: {
      discover: {
        loadMine: vi.fn().mockResolvedValue(mine),
        points: vi.fn().mockResolvedValue([LISBON, GROUP]),
        cityPeople: vi.fn().mockResolvedValue([
          { profile_id: 'me', display_name: 'Ana Silva', usage_mode: 'train' },
          { profile_id: 'p2', display_name: 'Mestre Lua', usage_mode: 'teach' },
        ]),
        search: vi.fn().mockResolvedValue([]),
        ...discover,
      },
      geocoder: { searchCities: vi.fn().mockResolvedValue([]), ...geocoder },
    },
    createMap: vi.fn((options) => {
      const map = { options, setPoints: vi.fn(), flyTo: vi.fn(), destroy: vi.fn() };
      maps.push(map);
      return map;
    }),
  };
  return { ctx, maps };
}

async function mount(ctx) {
  const view = await renderDiscover(ctx);
  document.body.replaceChildren(view);
  await vi.advanceTimersByTimeAsync(0);
  return view;
}

async function search(view, text) {
  const input = view.querySelector('input[type="search"]');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(300);
}

const rowKinds = (view) => [...view.querySelectorAll('.discover-panel-body .discover-row')].map((row) => row.dataset.kind);

beforeEach(() => {
  vi.useFakeTimers();
  resetDiscoverMemory();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('discover screen', () => {
  it('loads points for the normalized view and lists them', async () => {
    const { ctx, maps } = setup();
    const view = await mount(ctx);
    expect(maps).toHaveLength(1);
    expect(maps[0].options.view).toEqual({ lat: 20, lng: 0, zoom: 2 });
    maps[0].options.onMove(WORLD);
    await vi.advanceTimersByTimeAsync(250);
    expect(ctx.services.discover.points).toHaveBeenCalledWith({ minLat: -60, minLng: -180, maxLat: 80, maxLng: 180 });
    expect(maps[0].setPoints).toHaveBeenLastCalledWith([LISBON, GROUP]);
    expect(view.querySelector('.discover-summary').textContent).toBe('3 people · 1 group');
    expect(rowKinds(view)).toEqual(['city', 'group']);
    expect(view.textContent).toContain('Map images and city search come from OpenStreetMap.');
  });

  it('keeps only the newest view when responses arrive out of order', async () => {
    let releaseFirst;
    const points = vi.fn()
      .mockReturnValueOnce(new Promise((resolve) => { releaseFirst = resolve; }))
      .mockResolvedValueOnce([GROUP]);
    const { ctx, maps } = setup({ discover: { points } });
    await mount(ctx);
    maps[0].options.onMove(WORLD);
    await vi.advanceTimersByTimeAsync(250);
    maps[0].options.onMove({ ...WORLD, bounds: { minLat: 38, minLng: -10, maxLat: 39, maxLng: -9 } });
    await vi.advanceTimersByTimeAsync(250);
    releaseFirst([LISBON]);
    await vi.advanceTimersByTimeAsync(0);
    expect(maps[0].setPoints).toHaveBeenLastCalledWith([GROUP]);
    expect(maps[0].setPoints).not.toHaveBeenCalledWith([LISBON]);
  });

  it('collapses rapid moves into one request', async () => {
    const { ctx, maps } = setup();
    await mount(ctx);
    maps[0].options.onMove(WORLD);
    await vi.advanceTimersByTimeAsync(100);
    maps[0].options.onMove(WORLD);
    await vi.advanceTimersByTimeAsync(250);
    expect(ctx.services.discover.points).toHaveBeenCalledTimes(1);
  });

  it('lists a city’s people when its pin is chosen, then goes back', async () => {
    const { ctx, maps } = setup();
    const view = await mount(ctx);
    maps[0].options.onMove(WORLD);
    await vi.advanceTimersByTimeAsync(250);
    maps[0].options.onSelect(LISBON);
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.services.discover.cityPeople).toHaveBeenCalledWith({ city: 'Lisbon', region: 'Lisbon', country: 'Portugal' });
    expect(view.querySelector('.discover-panel-handle').getAttribute('aria-expanded')).toBe('true');
    const people = [...view.querySelectorAll('.discover-row[data-kind="person"] .discover-row-title')].map((node) => node.textContent);
    expect(people).toEqual(['Ana Silva (you)', 'Mestre Lua']);
    view.querySelector('.discover-row[data-profile-id="p2"]').click();
    expect(ctx.navigate).toHaveBeenCalledWith('/person/p2');
    [...view.querySelectorAll('button')].find((button) => button.textContent === '‹ Everything in view').click();
    expect(rowKinds(view)).toEqual(['city', 'group']);
  });

  it('opens group pins and group rows as group pages', async () => {
    const { ctx, maps } = setup();
    const view = await mount(ctx);
    maps[0].options.onSelect(GROUP);
    expect(ctx.navigate).toHaveBeenCalledWith('/group/g1');
    maps[0].options.onMove(WORLD);
    await vi.advanceTimersByTimeAsync(250);
    view.querySelector('.discover-row[data-kind="group"]').click();
    expect(ctx.navigate).toHaveBeenLastCalledWith('/group/g1');
  });

  it('remembers the map view when coming back', async () => {
    const first = setup();
    await mount(first.ctx);
    first.maps[0].options.onMove({ ...WORLD, view: { lat: 38.7, lng: -9.1, zoom: 11 } });
    const second = setup();
    await mount(second.ctx);
    expect(first.maps[0].destroy).toHaveBeenCalled();
    expect(second.maps[0].options.view).toEqual({ lat: 38.7, lng: -9.1, zoom: 11 });
  });

  it('centers on my city and hints when I have none', async () => {
    const withCity = setup({ mine: MY_LISBON });
    const view = await mount(withCity.ctx);
    expect(withCity.maps[0].options.view).toEqual({ lat: 38.72, lng: -9.14, zoom: 10 });
    expect(view.querySelector('.discover-add-city')).toBeNull();
    resetDiscoverMemory();
    const withoutCity = setup();
    const other = await mount(withoutCity.ctx);
    expect(other.querySelector('.discover-add-city a').getAttribute('href')).toBe('#/me/settings');
  });

  it('searches people, groups, and cities, and flies to a city', async () => {
    const { ctx, maps } = setup({ discover: { search: vi.fn().mockResolvedValue([
      { kind: 'city', profile_id: null, group_id: null, label: 'Lisbon', city: 'Lisbon', region: 'Lisbon', country: 'Portugal', lat: 38.72, lng: -9.14, person_count: 3 },
      { kind: 'person', profile_id: 'p2', group_id: null, label: 'Mestre Lua', city: 'Lisbon', region: 'Lisbon', country: 'Portugal', lat: 38.72, lng: -9.14, person_count: null },
      { kind: 'group', profile_id: null, group_id: 'g1', label: 'Grupo Lua', city: null, region: null, country: null, lat: null, lng: null, person_count: null },
    ]) } });
    const view = await mount(ctx);
    await search(view, 'l');
    expect(ctx.services.discover.search).not.toHaveBeenCalled();
    await search(view, 'lis');
    expect(ctx.services.discover.search).toHaveBeenCalledTimes(1);
    expect(ctx.services.discover.search).toHaveBeenCalledWith('lis', 20);
    expect([...view.querySelectorAll('.discover-results .discover-row')].map((row) => row.dataset.kind))
      .toEqual(['city', 'person', 'group', 'place']);
    view.querySelector('.discover-results .discover-row[data-kind="person"]').click();
    expect(ctx.navigate).toHaveBeenCalledWith('/person/p2');
    view.querySelector('.discover-results .discover-row[data-kind="city"]').click();
    expect(maps[0].flyTo).toHaveBeenCalledWith({ lat: 38.72, lng: -9.14, zoom: 11 });
    expect(ctx.services.discover.cityPeople).toHaveBeenCalled();
    expect(view.querySelector('.discover-results').hidden).toBe(true);
  });

  it('asks the geocoder only when "Find on the map" is tapped', async () => {
    const searchCities = vi.fn()
      .mockResolvedValueOnce([{ city: 'Salvador', region: 'Bahia', country: 'Brazil', lat: -12.97, lng: -38.5 }])
      .mockResolvedValueOnce([]);
    const { ctx, maps } = setup({ geocoder: { searchCities } });
    const view = await mount(ctx);
    await search(view, 'Salvador');
    expect(searchCities).not.toHaveBeenCalled();
    expect(view.textContent).toContain('No people, groups, or cities match.');
    view.querySelector('.discover-row[data-kind="place"]').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(searchCities).toHaveBeenCalledWith('Salvador');
    expect(maps[0].flyTo).toHaveBeenCalledWith({ lat: -12.97, lng: -38.5, zoom: 11 });
    await search(view, 'Xyzzy');
    view.querySelector('.discover-row[data-kind="place"]').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(view.textContent).toContain('No place found for “Xyzzy”.');
  });

  it('shows names from the server as text', async () => {
    const { ctx, maps } = setup({ discover: { points: vi.fn().mockResolvedValue([{ ...LISBON, city: '<img src=x onerror=alert(1)>' }]) } });
    const view = await mount(ctx);
    maps[0].options.onMove(WORLD);
    await vi.advanceTimersByTimeAsync(250);
    expect(view.querySelector('.discover-panel img')).toBeNull();
    expect(view.querySelector('.discover-row-title').textContent).toBe('<img src=x onerror=alert(1)> · 3');
  });

  it('offers a retry when points fail to load', async () => {
    const points = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([LISBON]);
    const { ctx, maps } = setup({ discover: { points } });
    const view = await mount(ctx);
    maps[0].options.onMove(WORLD);
    await vi.advanceTimersByTimeAsync(250);
    expect(view.textContent).toContain("We couldn't load the map. Try again.");
    [...view.querySelectorAll('button')].find((button) => button.textContent === 'Try again').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(rowKinds(view)).toEqual(['city']);
  });

  it('shows the last chosen city when city lists arrive out of order', async () => {
    let releaseLisbon;
    const cityPeople = vi.fn((place) => (place.city === 'Lisbon'
      ? new Promise((resolve) => { releaseLisbon = () => resolve([{ profile_id: 'p2', display_name: 'Mestre Lua', usage_mode: 'teach' }]); })
      : Promise.resolve([{ profile_id: 'p9', display_name: 'Rui Alves', usage_mode: 'both' }])));
    const { ctx, maps } = setup({ discover: { cityPeople } });
    const view = await mount(ctx);
    maps[0].options.onMove(WORLD);
    await vi.advanceTimersByTimeAsync(250);
    maps[0].options.onSelect(LISBON);
    maps[0].options.onSelect({ ...LISBON, city: 'Porto', region: 'Porto', lat: 41.15, lng: -8.61 });
    await vi.advanceTimersByTimeAsync(0);
    releaseLisbon();
    await vi.advanceTimersByTimeAsync(0);
    expect(view.querySelector('.discover-panel-body .section-label').textContent).toContain('Porto');
    const people = [...view.querySelectorAll('.discover-row[data-kind="person"] .discover-row-title')].map((node) => node.textContent);
    expect(people).toEqual(['Rui Alves']);
  });

  it('lets go of the map when Discover is left, and keeps the view for next time', async () => {
    const { ctx, maps } = setup();
    await mount(ctx);
    maps[0].options.onMove({ bounds: WORLD.bounds, view: { lat: 38.7, lng: -9.1, zoom: 9 } });
    releaseDiscoverMap();
    releaseDiscoverMap();
    expect(maps[0].destroy).toHaveBeenCalledTimes(1);
    await mount(ctx);
    expect(maps[1].options.view).toEqual({ lat: 38.7, lng: -9.1, zoom: 9 });
  });

  it('shows the list without a toggle on desktop', async () => {
    const { ctx } = setup();
    ctx.window = Object.assign(Object.create(window), { matchMedia: vi.fn(() => ({ matches: true, addEventListener() {} })) });
    const view = await mount(ctx);
    const handle = view.querySelector('.discover-panel-handle');
    expect(handle.disabled).toBe(true);
    expect(handle.hasAttribute('aria-expanded')).toBe(false);
    expect(view.querySelector('.discover-panel').classList.contains('expanded')).toBe(true);
  });

  it('keeps the desktop handle a plain label after a city is chosen', async () => {
    const { ctx, maps } = setup();
    ctx.window = Object.assign(Object.create(window), { matchMedia: vi.fn(() => ({ matches: true, addEventListener() {} })) });
    const view = await mount(ctx);
    maps[0].options.onMove(WORLD);
    await vi.advanceTimersByTimeAsync(250);
    maps[0].options.onSelect(LISBON);
    await vi.advanceTimersByTimeAsync(0);
    expect(view.querySelector('.discover-panel-handle').hasAttribute('aria-expanded')).toBe(false);
  });
});
