// tests/e2e/app-switch-over.spec.js
import { expect, test } from '@playwright/test';

import { seedAccount } from './app-helpers.js';

const lua = {
  id: 'group-lua', slug: 'grupo-lua', owner_id: 'owner-1', name: 'Grupo Lua', description: 'Tuesday training',
  location: 'Lisbon', picture_path: null, is_discoverable: true, archived_at: null,
};
const mata = { ...lua, id: 'group-mata', slug: 'grupo-mata', owner_id: 'owner-2', name: 'Grupo Mata', description: 'Saturday roda', location: 'Porto', is_discoverable: false };

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
});

test('keeps a member invitation through sign-in and explains used links', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/app?member_invite=member-valid');
  await expect(page).toHaveURL(/\?next=%2Fapp%3Fmember_invite%3Dmember-valid$/);

  await seedAccount(page, { extra: { 'roda.e2e.groupState': {
    groups: [lua],
    invitationTokens: {
      'member-valid': { state: 'pending', group: lua },
      'member-expired': { state: 'expired', group: lua },
      'member-revoked': { state: 'revoked', group: lua },
      'member-used': { state: 'accepted', group: lua },
    },
  } } });
  await page.goto('/app?member_invite=member-valid');
  const invitation = page.getByRole('dialog', { name: 'Group invitation' });
  await expect(invitation).toContainText('You were invited to join a group');
  expect(new URL(page.url()).search).toBe('');
  await invitation.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(invitation).toContainText('Invitation accepted. You are now a group member.');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('roda.e2e.groupState'))
    .memberships.map(({ group_id: id }) => id))).toEqual(['group-lua']);

  for (const [token, message] of [['member-expired', 'expired'], ['member-revoked', 'revoked'], ['member-used', 'already been used']]) {
    await page.goto(`/app?member_invite=${token}`);
    const again = page.getByRole('dialog', { name: 'Group invitation' });
    await again.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(again).toContainText(message);
    expect(new URL(page.url()).search).toBe('');
  }
});

test('opens an unlisted group link and requests access', async ({ page }) => {
  await seedAccount(page, { extra: { 'roda.e2e.groupState': { groups: [lua, mata], discoveryTokens: { 'unlisted-secret': 'group-mata' } } } });
  await page.goto('/app?group_link=unlisted-secret');
  const card = page.getByRole('dialog', { name: 'Grupo Mata' });
  await expect(card).toContainText('Porto');
  expect(new URL(page.url()).search).toBe('');
  await card.getByRole('button', { name: 'Request member access' }).click();
  await expect(card).toContainText('Your member access request is pending.');
  await expect.poll(() => page.evaluate(() => window.__RODA_E2E_EVENTS__))
    .toContainEqual({ type: 'request-access', groupId: 'group-mata', requestedAccess: 'member' });

  await page.goto('/app?group_link=nope');
  await expect(page.getByRole('dialog', { name: 'Group link' })).toContainText('This group link is unavailable.');
});

test('saves a round as a sequence from Log training', async ({ page }) => {
  await seedAccount(page);
  await page.goto('/app#/log');
  const box = page.getByLabel('Write a round');
  await box.fill('10x (ginga, armada)');
  await box.press('Enter');
  await page.getByRole('button', { name: 'Save as sequence' }).click();
  await expect(page.getByText('Saved to your repertoire.')).toBeVisible();
  await page.getByRole('button', { name: '📚 Saved' }).click();
  await expect(page.getByRole('dialog')).toContainText('10x (ginga, armada)');
});

test('the demo says it stays in this browser', async ({ page }) => {
  await page.goto('/app?demo=1');
  await expect(page.getByRole('note')).toHaveText('Demo · browser only');
});

test('Settings no longer points at the classic dashboard', async ({ page }) => {
  await seedAccount(page);
  await page.goto('/app#/me/settings');
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await expect(page.locator('a[href="/dashboard"]')).toHaveCount(0);
});
