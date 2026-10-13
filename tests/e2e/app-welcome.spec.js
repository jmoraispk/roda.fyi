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
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Where do you train?' })).toBeVisible();
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

test('the welcome shows no navigation on desktop either, so typed answers cannot be lost', async ({ page }) => {
  await seedAccount(page, { profile: { display_name: 'Capoeirista', completed_at: null } });
  await page.goto('/app');
  await expect(page).toHaveURL(/#\/welcome$/);
  await expect(page.locator('.app-nav')).toBeHidden();
  await page.getByLabel('Name', { exact: true }).fill('Ana Silva');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: 'Both' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Where do you train?' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('.app-nav')).toBeVisible();
});

test('a new person can add a city and be findable from the welcome', async ({ page }) => {
  await seedAccount(page, { profile: { display_name: 'Capoeirista', completed_at: null } });
  await page.goto('/app');
  await page.getByLabel('Name', { exact: true }).fill('Ana Silva');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: 'Teach' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  const city = page.getByRole('searchbox', { name: 'Search a city' });
  await city.fill('Lisbon');
  await city.press('Enter');
  await page.getByRole('button', { name: 'Lisbon, Portugal' }).click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page).toHaveURL(/#\/$/);
  const profile = await page.evaluate(() => JSON.parse(localStorage.getItem('roda.e2e.profile')));
  expect(profile).toMatchObject({ usage_mode: 'teach', place_city: 'Lisbon', discover_visibility: null });
});

test('the welcome title keeps its natural height', async ({ page }) => {
  await seedAccount(page, { profile: { display_name: 'Capoeirista', completed_at: null } });
  await page.goto('/app');
  const title = page.locator('.screen-welcome .page-title');
  await expect(title).toBeVisible();
  expect((await title.boundingBox()).height).toBeLessThan(70);
});
