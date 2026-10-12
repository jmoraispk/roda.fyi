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
