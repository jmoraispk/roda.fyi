// tests/e2e/app-hardening.spec.js
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1', email: 'ana@example.com' } }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify({
      id: 'practitioner-1', display_name: 'Ana Silva', avatar_path: null,
      timezone_override: 'Europe/Lisbon', leaderboard_visible: true, completed_at: '2026-09-11T20:00:00Z',
    }));
  });
});

test('an impossible calendar month opens the current month', async ({ page }) => {
  await page.goto('/app#/calendar/2026-13');
  await expect(page.getByRole('heading', { name: 'October 2026' })).toBeVisible();
  await expect(page).toHaveURL(/#\/calendar$/);
});

const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

test('very long words wrap instead of widening the page', async ({ page }) => {
  const word = 'a'.repeat(160);
  await page.goto('/app#/log');
  const box = page.getByLabel('Write a round');
  await box.fill(`ginga ${word}`);
  await box.press('Enter');
  await expect(page.locator('textarea[data-round-text]')).toHaveCount(1);
  expect(await sideways(page)).toBe(false);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/training\//);
  await expect(page.locator('.chapter')).toHaveCount(1);
  expect(await sideways(page)).toBe(false);
  await page.goto('/app#/');
  await expect(page.locator('.recent-card').first()).toBeVisible();
  expect(await sideways(page)).toBe(false);
});

test('saving again after a reload adds each resource once', async ({ page }) => {
  await page.goto('/app#/log');
  const box = page.getByLabel('Write a round');
  await box.fill('ginga 10 min');
  await box.press('Enter');
  await page.getByRole('button', { name: '🎥 Link' }).click();
  await page.getByRole('dialog').getByLabel('Link').fill('https://youtu.be/VAI3JUKTwz0');
  await page.getByRole('dialog').getByRole('button', { name: 'Add' }).click();
  // The draft as it is right before Save: what a reload mid-save finds again.
  const draft = await page.evaluate(() => localStorage.getItem('roda.logDraft:practitioner-1'));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/training\//);
  const first = page.url();
  await page.evaluate((saved) => localStorage.setItem('roda.logDraft:practitioner-1', saved), draft);
  await page.goto('/app#/log');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(first);
  await expect(page.locator('.resource-buttons button')).toHaveCount(1);
});
