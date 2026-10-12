// tests/e2e/app-log.spec.js
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

test('logs a training from the chat box and opens it', async ({ page }, testInfo) => {
  await page.goto('/app');
  if (testInfo.project.name.includes('mobile')) await page.getByRole('button', { name: 'Create' }).click();
  else await page.getByRole('button', { name: '+ Log training' }).click();
  const box = page.getByLabel('Write a round');
  await box.fill('ginga 10 min');
  await box.press('Enter');
  await box.fill('10x (armada, au)');
  await box.press('Enter');
  await expect(page.locator('textarea[data-round-text]')).toHaveCount(2);
  await page.locator('[data-round-difficulty]').nth(1).getByRole('radio', { name: 'Hard' }).check();
  await page.getByRole('button', { name: '🎥 Link' }).click();
  await page.getByRole('dialog').getByLabel('Link').fill('https://youtu.be/VAI3JUKTwz0');
  await page.getByRole('dialog').getByRole('button', { name: 'Add' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/training\//);
  await expect(page.locator('.training-video iframe')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/VAI3JUKTwz0');
  await expect(page.locator('.chapter')).toHaveCount(2);
  await expect(page.locator('.chapter').nth(1)).toContainText('felt Hard');
  await page.goto('/app#/');
  await expect(page.locator('.recent-card').first()).toContainText('🎥');
});

test('keeps a draft across reloads', async ({ page }) => {
  await page.goto('/app#/log');
  const box = page.getByLabel('Write a round');
  await box.fill('ginga 10 min');
  await box.press('Enter');
  await page.reload();
  await expect(page.locator('textarea[data-round-text]').first()).toHaveValue('ginga 10 min');
});

test('a back-dated log keeps the start time it was given', async ({ page }) => {
  await page.goto('/app#/log');
  await page.getByRole('button', { name: 'Yesterday' }).click();
  await page.getByLabel('Start time').fill('07:30');
  const box = page.getByLabel('Write a round');
  await box.fill('ginga 10 min');
  await box.press('Enter');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/training\//);
  await expect(page.locator('.training-meta')).toContainText('07:30');
});
