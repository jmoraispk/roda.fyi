// tests/e2e/app-access.spec.js
import { expect, test } from '@playwright/test';

import { seedAccount } from './app-helpers.js';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
});

test('Teaching sends Train people without coaching back to Me', async ({ page }) => {
  await seedAccount(page);
  await page.goto('/app#/me/teaching');
  await expect(page).toHaveURL(/#\/me$/);
  await page.goto('/app#/me/teaching/plans/new');
  await expect(page).toHaveURL(/#\/me$/);
});

test('Teaching stays reachable in Train for people who coach', async ({ page }) => {
  await seedAccount(page, { coachProfile: { profile_id: 'practitioner-1' } });
  await page.goto('/app#/me/teaching');
  await expect(page).toHaveURL(/#\/me\/teaching$/);
});

test('finished profiles never see the welcome, unfinished ones always do', async ({ page }) => {
  await seedAccount(page);
  await page.goto('/app#/welcome');
  await expect(page).toHaveURL(/#\/$/);
  await seedAccount(page, { profile: { completed_at: null } });
  await page.goto('/app#/calendar');
  await expect(page).toHaveURL(/#\/welcome$/);
});
