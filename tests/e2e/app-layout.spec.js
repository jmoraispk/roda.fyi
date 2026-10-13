// tests/e2e/app-layout.spec.js
import { expect, test } from '@playwright/test';

async function bottomGap(page, selector) {
  return page.evaluate((sel) => {
    const box = document.querySelector(sel).getBoundingClientRect();
    return Math.round(window.innerHeight - box.bottom);
  }, selector);
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
});

test('the Log training dock sits at the bottom of the screen', async ({ page }) => {
  await page.goto('/app?demo=1#/log');
  await expect(page.locator('.log-dock')).toBeVisible();
  expect(await bottomGap(page, '.log-dock')).toBeLessThanOrEqual(1);
});

test('the training page action bar sits at the bottom of the screen', async ({ page }) => {
  await page.goto('/app?demo=1');
  await page.locator('.recent-card').first().click();
  await expect(page.locator('.training-bar')).toBeVisible();
  expect(await bottomGap(page, '.training-bar')).toBeLessThanOrEqual(1);
});

test('the page area shows no focus outline after navigating', async ({ page }) => {
  await page.goto('/app?demo=1');
  await expect(page.locator('.recent-card').first()).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#/calendar'; });
  await expect(page.locator('[data-screen="calendar"], .screen-calendar').first()).toBeVisible();
  const outline = await page.evaluate(() => {
    const main = document.getElementById('appMain');
    return { focused: document.activeElement === main, style: getComputedStyle(main).outlineStyle };
  });
  expect(outline).toEqual({ focused: true, style: 'none' });
});

test('Record a past class keeps its dock at the bottom and its date fields readable', async ({ page }) => {
  await page.goto('/app?demo=1#/me/teaching/record');
  await expect(page.locator('.screen-record .log-dock')).toBeVisible();
  expect(await bottomGap(page, '.screen-record .log-dock')).toBeLessThanOrEqual(1);
  const fits = await page.evaluate(() => [...document.querySelectorAll('.record-when input')]
    .every((input) => input.scrollWidth <= input.clientWidth + 1));
  expect(fits).toBe(true);
});

test('the coach class page keeps Cancel and Finish at the bottom', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-26T19:30:00Z'));
  await page.goto('/app?demo=1#/class/demo-schedule');
  await expect(page.locator('.screen-class .training-bar')).toBeVisible();
  expect(await bottomGap(page, '.screen-class .training-bar')).toBeLessThanOrEqual(1);
});

test('Progress shows its stat cards two per row on a phone', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'phone layout');
  await page.goto('/app?demo=1#/me/progress');
  const cards = page.locator('.screen-progress .statistics-card');
  await expect(cards.nth(1)).toBeVisible();
  const [a, b] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()];
  expect(Math.abs(a.y - b.y)).toBeLessThan(2);
});

test('a group pin and its city pin at the same place do not cover each other', async ({ page }) => {
  await page.goto('/app?demo=1#/discover');
  const city = page.locator('.discover-pin.city', { hasText: 'Lisbon' });
  const group = page.locator('.discover-pin.group', { hasText: 'Grupo Lua' });
  await expect(city).toBeVisible();
  await expect(group).toBeVisible();
  const [a, b] = [await city.boundingBox(), await group.boundingBox()];
  const overlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
    * Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  expect(overlap).toBe(0);
});
