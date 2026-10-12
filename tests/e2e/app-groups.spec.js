// tests/e2e/app-groups.spec.js
import { expect, test } from '@playwright/test';

import { seedAccount } from './app-helpers.js';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
});

test('a coach creates a group and opens it', async ({ page }) => {
  await seedAccount(page, { profile: { usage_mode: 'both' }, coachProfile: { profile_id: 'practitioner-1' } });
  await page.goto('/app#/me/groups');
  await page.getByRole('button', { name: /Create a group/ }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Name', { exact: true }).fill('Roda Norte');
  await sheet.getByRole('button', { name: 'Create group' }).click();
  await expect(page).toHaveURL(/#\/group\/group-1$/);
});

test('a student asks a coach to coach them', async ({ page }) => {
  await seedAccount(page, {
    extra: {
      'roda.e2e.connectionState': {
        candidates: [{ profile_id: 'coach-lua', display_name: 'Professora Lua', candidate_role: 'coach' }], connections: [],
      },
    },
  });
  await page.goto('/app#/me/groups');
  await page.getByRole('button', { name: 'Find a coach' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Request Professora Lua' }).click();
  await expect(page.getByRole('dialog').getByText('Request sent to Professora Lua.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-coach="coach-lua"]')).toContainText('Pending');
});

test('a coach invites a student from the group page', async ({ page }) => {
  await page.goto('/app?demo=1#/me/groups');
  await page.getByRole('link', { name: /Roda da Lua/ }).click();
  await expect(page).toHaveURL(/#\/group\/demo-group$/);
  await page.getByRole('button', { name: 'Create invitation link' }).click();
  await expect(page.getByLabel('Invitation link')).toHaveValue(/\/dashboard\?member_invite=invite-1$/);
  await expect(page.locator('[data-member="student-bia"]')).toBeVisible();
});

test('an owner creates a discovery link for the group', async ({ page }) => {
  await page.goto('/app?demo=1#/group/demo-group');
  await page.getByRole('button', { name: 'Create discovery link' }).click();
  await expect(page.getByLabel('Discovery link')).toHaveValue(/\/dashboard\?group_link=discovery-1$/);
  await page.getByRole('button', { name: 'Revoke link' }).click();
  await expect(page.getByText('Discovery link revoked.')).toBeVisible();
});
