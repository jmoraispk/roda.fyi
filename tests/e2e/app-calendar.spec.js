// tests/e2e/app-calendar.spec.js
import { expect, test } from '@playwright/test';

test('Calendar shows the full month and opens a day', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
  await page.goto('/app?demo=1#/calendar');
  await expect(page.getByRole('heading', { name: 'October 2026' })).toBeVisible();
  await expect(page.locator('.cal-day')).toHaveCount(35);
  const day = page.locator('.cal-day:has(.cal-dot:not(.upcoming))').first();
  await day.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.locator('.day-item').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.getByRole('heading', { name: 'November 2026' })).toBeVisible();
});
