// tests/e2e/app-welcome.spec.js
import { expect, test } from '@playwright/test';

import { seedAccount } from './app-helpers.js';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
});

test('a new person sets name and mode, then lands on Today', async ({ page }) => {
  await seedAccount(page, { profile: { display_name: 'Capoeirista', completed_at: null } });
  await page.goto('/app');
  await expect(page).toHaveURL(/#\/welcome$/);
  await page.getByLabel('Name', { exact: true }).fill('Ana Silva');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: 'Both' }).click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('.week-day')).toHaveCount(7);
  const stored = await page.evaluate(() => ({
    profile: JSON.parse(localStorage.getItem('roda.e2e.profile')),
    coach: JSON.parse(localStorage.getItem('roda.e2e.coachProfile')),
  }));
  expect(stored.profile).toMatchObject({ display_name: 'Ana Silva', usage_mode: 'both', completed_at: expect.any(String) });
  expect(stored.coach).not.toBeNull();
});

test('Settings saves a new name', async ({ page }) => {
  await seedAccount(page);
  await page.goto('/app#/me/settings');
  await page.getByLabel('Name', { exact: true }).fill('Ana Morais');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();
  await page.goto('/app#/me');
  await expect(page.locator('.me-name')).toHaveText('Ana Morais');
});

test('the first welcome step has no Back button and the actions rest at the bottom', async ({ page }) => {
  await seedAccount(page, { profile: { display_name: 'Capoeirista', completed_at: null } });
  await page.goto('/app');
  await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back' })).toBeHidden();
  const gap = await page.evaluate(() => Math.round(window.innerHeight - document.querySelector('.welcome-actions').getBoundingClientRect().bottom));
  expect(gap).toBeLessThanOrEqual(24);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
});
