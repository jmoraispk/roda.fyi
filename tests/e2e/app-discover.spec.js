// tests/e2e/app-discover.spec.js
import { expect, test } from '@playwright/test';

import { seedAccount } from './app-helpers.js';

let external = [];

test.beforeEach(async ({ page }) => {
  external = [];
  page.on('request', (request) => {
    if (/openstreetmap\.org/.test(request.url())) external.push(request.url());
  });
  await page.route(/openstreetmap\.org/, (route) => route.abort());
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00Z'));
  await seedAccount(page, { profile: { usage_mode: 'train' } });
});

test.afterEach(() => {
  expect(external).toEqual([]);
});

async function searchDiscover(page, text) {
  await page.getByRole('searchbox', { name: 'Search people, groups, or cities' }).fill(text);
  await expect(page.locator('.discover-results')).toBeVisible();
}

async function viewAs(page, profileId) {
  await page.evaluate((id) => {
    if (id) localStorage.setItem('roda.e2e.discoverViewer', id);
    else localStorage.removeItem('roda.e2e.discoverViewer');
  }, profileId);
}

async function saveVisibility(page, label) {
  await page.goto('/app#/me/settings');
  await page.getByRole('radio', { name: label }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
}

test('sets a city, finds herself, and disappears for others with Nobody', async ({ page }) => {
  await page.goto('/app#/me/settings');
  const city = page.getByRole('searchbox', { name: 'Search a city' });
  await city.fill('Lisbon');
  await city.press('Enter');
  await page.getByRole('button', { name: 'Lisbon, Portugal' }).click();
  await page.getByRole('radio', { name: 'Everyone' }).check();
  await page.getByLabel('Instagram handle').fill('@ana.silva');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  expect(await page.evaluate(() => window.__RODA_E2E_EVENTS__.filter(({ type }) => type === 'geocode-search').length)).toBe(1);

  await page.goto('/app#/discover');
  await searchDiscover(page, 'Lisbon');
  await page.locator('.discover-results .discover-row[data-kind="city"]').click();
  await expect(page.locator('.discover-pin', { hasText: 'Lisbon · 3' })).toBeVisible();
  await page.locator('.discover-row[data-profile-id="practitioner-1"]').click();
  await expect(page).toHaveURL(/#\/person\/practitioner-1$/);
  await expect(page.getByRole('heading', { name: 'Ana Silva' })).toBeVisible();
  await expect(page.getByRole('link', { name: '@ana.silva' })).toHaveAttribute('href', 'https://www.instagram.com/ana.silva/');
  await expect(page.getByText('Everyone can find your card.')).toBeVisible();

  await viewAs(page, 'discover-bia');
  await page.goto('/app#/discover');
  await searchDiscover(page, 'Ana');
  await expect(page.locator('.discover-results .discover-row[data-profile-id="practitioner-1"]')).toBeVisible();

  await viewAs(page, null);
  await saveVisibility(page, 'Nobody');

  await viewAs(page, 'discover-bia');
  await page.goto('/app#/discover');
  await searchDiscover(page, 'Lisbon');
  await page.locator('.discover-results .discover-row[data-kind="city"]').click();
  await expect(page.locator('.discover-pin', { hasText: 'Lisbon · 2' })).toBeVisible();
  await expect(page.locator('.discover-row[data-profile-id="practitioner-1"]')).toHaveCount(0);
  await searchDiscover(page, 'Ana');
  await expect(page.getByText('No people, groups, or cities match.')).toBeVisible();
  await page.goto('/app#/person/practitioner-1');
  await expect(page.getByText("This person isn't available.")).toBeVisible();
});

test('never shows people who stay hidden', async ({ page }) => {
  await page.goto('/app#/discover');
  await searchDiscover(page, 'Caio');
  await expect(page.getByText('No people, groups, or cities match.')).toBeVisible();
  await searchDiscover(page, 'Fechada');
  await expect(page.getByText('No people, groups, or cities match.')).toBeVisible();
});

test('opens a group card from search and asks to join', async ({ page }) => {
  await page.goto('/app#/discover');
  await searchDiscover(page, 'Grupo');
  await page.locator('.discover-results .discover-row[data-kind="group"]').click();
  await expect(page).toHaveURL(/#\/group\/discover-group-lua$/);
  await expect(page.getByRole('heading', { name: 'Grupo Lua' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mestre Lua' })).toHaveAttribute('href', '#/person/discover-lua');
  await page.getByRole('button', { name: 'Ask to join' }).click();
  await expect(page.getByText('Request sent. The group will reply.')).toBeVisible();
  const requests = await page.evaluate(() => window.__RODA_E2E_EVENTS__.filter(({ type }) => type === 'request-access'));
  expect(requests).toEqual([{ type: 'request-access', groupId: 'discover-group-lua', requestedAccess: 'member' }]);
});

test('keeps the typed city when city search is down', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('roda.e2e.failGeocoder', 'true'));
  await page.goto('/app#/me/settings');
  const city = page.getByRole('searchbox', { name: 'Search a city' });
  await city.fill('Lisbon');
  await city.press('Enter');
  await expect(page.getByText("City search isn't available right now. Try again in a moment.")).toBeVisible();
  await expect(city).toHaveValue('Lisbon');
});

test('a group owner puts the group on the map', async ({ page }) => {
  await page.evaluate(() => {
    const group = {
      id: 'group-1', slug: 'roda-da-lua', owner_id: 'practitioner-1', name: 'Roda da Lua', description: null,
      location: 'Lisbon', timezone: 'Europe/Lisbon', picture_path: null, is_discoverable: true, archived_at: null,
    };
    localStorage.setItem('roda.e2e.groupState', JSON.stringify({
      groups: [group],
      memberships: [{ group_id: 'group-1', profile_id: 'practitioner-1', access_level: 'coach', state: 'active', joined_at: '2026-09-11T20:00:00Z', group }],
      rosters: { 'group-1': [{ profile_id: 'practitioner-1', display_name: 'Ana Silva', access_level: 'coach', membership_state: 'active' }] },
    }));
  });
  await page.goto('/app#/group/group-1');
  const form = page.locator('.group-discover');
  const city = form.getByRole('searchbox', { name: 'Search a city' });
  await city.fill('Lisbon');
  await city.press('Enter');
  await form.getByRole('button', { name: 'Lisbon, Portugal' }).click();
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form.getByText('Saved.')).toBeVisible();
  await page.goto('/app#/discover');
  await expect(page.locator('.discover-pin', { hasText: 'Roda da Lua' })).toBeVisible();
});

test('fills the phone screen above the tab bar and credits OpenStreetMap', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'phone layout only');
  await page.goto('/app#/discover');
  const map = await page.locator('.discover-map').boundingBox();
  const nav = await page.getByRole('navigation', { name: 'Main navigation' }).boundingBox();
  expect(map.height).toBeGreaterThan(600);
  expect(map.y + map.height).toBeLessThanOrEqual(nav.y + 1);
  await expect(page.getByRole('link', { name: 'OpenStreetMap' })).toBeVisible();
  await expect(page.locator('.discover-summary')).toHaveText('3 people · 1 group');
  await page.locator('.discover-panel-handle').click();
  await expect(page.getByText(/Map images and city search come from OpenStreetMap/)).toBeVisible();
});

test('keeps the map beside an open card on desktop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'desktop layout only');
  await page.goto('/app#/discover');
  const panel = await page.locator('.discover-panel').boundingBox();
  const map = await page.locator('.discover-map').boundingBox();
  expect(panel.x + panel.width).toBeLessThanOrEqual(map.x + 1);
  await expect(page.getByRole('link', { name: 'OpenStreetMap' })).toBeVisible();
  await searchDiscover(page, 'Mestre');
  await page.locator('.discover-results .discover-row[data-kind="person"]').click();
  await expect(page.locator('#appDetail').getByRole('heading', { name: 'Mestre Lua' })).toBeVisible();
  await expect(page.locator('#appMain .discover-map')).toBeVisible();
});

test('pins repeat on every world copy shown on a very wide screen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'needs a wide desktop map');
  await page.setViewportSize({ width: 2800, height: 900 });
  await page.goto('/app?demo=1#/discover');
  await expect(page.locator('.discover-pin.city', { hasText: 'Lisbon' }).first()).toBeVisible();
  expect(await page.locator('.discover-pin.city', { hasText: 'Lisbon' }).count()).toBeGreaterThanOrEqual(2);
});
