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

const trainingState = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('roda.e2e.trainingState')));

async function logRound(page, text) {
  await page.goto('/app#/log');
  const box = page.getByLabel('Write a round');
  await box.fill(text);
  await box.press('Enter');
}

test('a failed save keeps the composer and a retry records one training', async ({ page }) => {
  await seedAccount(page, { extra: { 'roda.e2e.trainingState': { failNext: 'recordAloneTraining' } } });
  await logRound(page, '10x armada, au');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.log-status')).toContainText('failed');
  await expect(page.locator('textarea[data-round-text]').first()).toHaveValue('10x armada, au');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/training\//);
  await expect.poll(async () => {
    const state = await trainingState(page);
    return [state.occurrences.length, state.participations.length];
  }).toEqual([1, 1]);
});

test('marks an unknown move as new and records it', async ({ page }) => {
  await seedAccount(page);
  await logRound(page, 'armada, galopanti');
  await expect(page.locator('[data-chip="2"]')).toHaveAttribute('data-status', 'new');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/training\//);
  await expect.poll(async () => (await trainingState(page)).occurrences[0].rounds[0].movements
    .map(({ movement_key: key, catalogued }) => `${key}:${catalogued}`)).toEqual(['armada:true', 'galopanti:false']);
});

test('rates a round and a transition from the training page', async ({ page }) => {
  await seedAccount(page);
  await logRound(page, '10x armada, au');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/training\//);
  await page.locator('[data-action="rate"]').click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('radio', { name: 'Hard' }).first().check();
  await sheet.getByRole('button', { name: 'Rate parts' }).click();
  await sheet.getByRole('button', { name: 'Transition Armada → Aú' }).click();
  await sheet.locator('[data-segment-editor]').getByRole('radio', { name: 'Hard' }).check();
  await sheet.getByRole('button', { name: 'Save ratings' }).click();
  await expect(sheet.getByText('Ratings saved.')).toBeVisible();
  await expect.poll(async () => Object.values((await trainingState(page)).roundRatings)
    .flatMap((byRound) => Object.values(byRound).flat())
    .map(({ segment_key: key, difficulty }) => `${key}:${difficulty}`).sort()).toEqual(['r:hard', 't:1>2:hard']);
});

test('adds a summary file from the training page', async ({ page }) => {
  await seedAccount(page);
  await logRound(page, 'ginga 10 min');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/training\//);
  await page.locator('[data-action="add"]').click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Resource type').selectOption('summary');
  await sheet.getByLabel('Text files (.txt, .md)').setInputFiles({
    name: 'class-notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Class notes\n- ginga'),
  });
  await sheet.getByRole('button', { name: 'Save resources' }).click();
  await expect(sheet.getByText('Resources saved.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /class-notes\.md/ })).toBeVisible();
});

test('imports browser sequences once and logs one from Repertoire', async ({ page }) => {
  await seedAccount(page, { extra: { 'roda.seqs': [[{ c: 'golpes', n: 'Armada' }, { c: 'floreios', n: 'Aú' }]] } });
  await page.goto('/app#/me/repertoire');
  await expect(page.locator('.repertoire-text')).toHaveText(['Armada, Aú']);
  await page.reload();
  await expect(page.locator('.repertoire-text')).toHaveCount(1);
  await page.getByRole('button', { name: 'Log', exact: true }).click();
  await expect(page).toHaveURL(/#\/log$/);
  await expect(page.locator('textarea[data-round-text]').first()).toHaveValue('Armada, Aú');
});

test('Calendar speaks Portuguese', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
  await page.goto('/app?demo=1#/me/settings');
  await page.getByRole('button', { name: 'Português' }).click();
  await page.goto('/app?demo=1#/calendar');
  await expect(page.getByRole('heading', { name: /outubro de 2026/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mês seguinte' })).toBeVisible();
  await expect(page.locator('.cal-legend')).toContainText('Sozinho');
});

test('Calendar fits a phone and sits beside the training on desktop', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
  await page.goto('/app?demo=1#/calendar');
  await expect(page.locator('.cal-day')).toHaveCount(35);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.locator('.cal-day:has(.cal-dot:not(.upcoming))').first().click();
  await page.getByRole('dialog').locator('.day-item').first().click();
  await expect(page).toHaveURL(/#\/training\//);
  if (testInfo.project.name.includes('mobile')) {
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden();
  } else {
    const month = await page.locator('#appMain .cal-grid').boundingBox();
    const detail = await page.locator('#appDetail').boundingBox();
    expect(detail.x).toBeGreaterThanOrEqual(month.x + month.width - 1);
  }
});

test('a failed startup offers Try again and then opens Today', async ({ page }) => {
  await seedAccount(page, { extra: { 'roda.e2e.failProfileLoads': 1 } });
  await page.goto('/app');
  await expect(page.getByText('The profile could not be loaded.')).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.week-day')).toHaveCount(7);
});
