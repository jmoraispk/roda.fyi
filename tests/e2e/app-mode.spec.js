// tests/e2e/app-mode.spec.js
import { expect, test } from '@playwright/test';

import { openCreate, seedAccount } from './app-helpers.js';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
});

test('the mode changes + and Teaching in Me without removing coaching', async ({ page }, testInfo) => {
  await seedAccount(page);
  await page.goto('/app');
  await openCreate(page, testInfo);
  await expect(page).toHaveURL(/#\/log$/);
  await page.goto('/app#/me');
  await expect(page.getByRole('link', { name: /Teaching/ })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Both' }).click();
  await expect(page.getByRole('link', { name: /Teaching/ })).toBeVisible();
  await openCreate(page, testInfo);
  await expect(page.getByRole('dialog').locator('[data-plus]'))
    .toHaveText(['📝 Log my training', '📅 Schedule a class', '🧾 Record a past class']);
  await page.keyboard.press('Escape');
  await page.getByRole('radio', { name: 'Teach' }).click();
  await openCreate(page, testInfo);
  await expect(page.getByRole('dialog').locator('[data-plus]')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.getByRole('radio', { name: 'Train' }).click();
  await expect(page.getByRole('link', { name: /Teaching/ })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('roda.e2e.coachProfile')))).not.toBeNull();
  await page.goto('/app#/me/teaching');
  await expect(page).toHaveURL(/#\/me\/teaching$/);
});

test('a coach records a past class from +', async ({ page }, testInfo) => {
  await page.goto('/app?demo=1');
  await openCreate(page, testInfo);
  await page.getByRole('dialog').getByRole('button', { name: /Record a past class/ }).click();
  await expect(page).toHaveURL(/#\/me\/teaching\/record$/);
  await expect(page.locator('input[name="attendee"]')).toHaveCount(4); // three members, then "You" (unchecked while others are listed)
  await page.locator('input[name="attendee"]').nth(2).uncheck();
  const box = page.getByLabel('Write a round');
  await box.fill('ginga 10 min');
  await box.press('Enter');
  await page.getByRole('button', { name: 'Save class' }).click();
  await expect(page).toHaveURL(/#\/training\//);
  await expect(page.locator('.tag', { hasText: 'attended' })).toContainText('2 attended');
});
