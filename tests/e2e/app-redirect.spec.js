// tests/e2e/app-redirect.spec.js
import { expect, test } from '@playwright/test';

import { seedAccount } from './app-helpers.js';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
});

test('an old /dashboard link opens the same screen in the app', async ({ page }) => {
  await page.goto('/dashboard?demo=1#/training/demo-group-1');
  await expect(page).toHaveURL(/\/app\?demo=1#\/training\/demo-group-1$/);
  await expect(page.locator('.tag').first()).toContainText('⏱');
});

test('/dashboard.html forwards too', async ({ page }) => {
  await page.goto('/dashboard.html?demo=1#/calendar');
  await expect(page).toHaveURL(/\/app\?demo=1#\/calendar$/);
  await expect(page.locator('.cal-day')).toHaveCount(35);
});

test('an old invitation link survives sign-in and opens in the app', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/dashboard?member_invite=member-valid');
  await expect(page).toHaveURL(/\?next=%2Fapp%3Fmember_invite%3Dmember-valid$/);
  await seedAccount(page, { extra: { 'roda.e2e.groupState': {
    groups: [{ id: 'group-lua', slug: 'grupo-lua', owner_id: 'owner-1', name: 'Grupo Lua', description: null, location: 'Lisbon', picture_path: null, is_discoverable: true, archived_at: null }],
    invitationTokens: { 'member-valid': { state: 'pending', group: { id: 'group-lua', name: 'Grupo Lua' } } },
  } } });
  await page.goto('/dashboard?member_invite=member-valid');
  await expect(page.getByRole('dialog', { name: 'Group invitation' })).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);
});
