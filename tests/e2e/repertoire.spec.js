// tests/e2e/repertoire.spec.js
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1', email: 'ana@example.com' } }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify({
      id: 'practitioner-1', display_name: 'Ana Silva', avatar_path: null,
      timezone_override: 'Europe/Lisbon', leaderboard_visible: true, completed_at: '2026-09-11T20:00:00Z',
    }));
    localStorage.setItem('roda.seqs', JSON.stringify([[{ c: 'golpes', n: 'Armada' }, { c: 'floreios', n: 'Aú' }]]));
  });
});

test('imports browser sequences once and logs one as training', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('tab', { name: 'Repertoire' }).click();
  await expect(page.locator('#trainingRepertoirePanel .repertoire-text')).toHaveText(['Armada, Aú']);
  await page.reload();
  await page.getByRole('tab', { name: 'Repertoire' }).click();
  await expect(page.locator('#trainingRepertoirePanel .repertoire-text')).toHaveCount(1);

  await page.getByRole('button', { name: 'Log' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record Alone training' });
  await expect(dialog.getByLabel('Round 1 text')).toHaveValue('Armada, Aú');
  await dialog.getByLabel('Training date').fill('2026-09-24');
  await dialog.getByRole('button', { name: 'Save training' }).click();
  await expect(dialog).toBeHidden();
});

test('saves a round as a sequence from Record training', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Record Alone training' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record Alone training' });
  await dialog.getByLabel('Round 1 text').fill('10x (ginga, armada)');
  await dialog.getByRole('button', { name: 'Save as sequence' }).click();
  await expect(dialog.getByText('Saved to your repertoire.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close Alone training' }).click();
  await page.getByRole('tab', { name: 'Repertoire' }).click();
  await expect(page.locator('#trainingRepertoirePanel .repertoire-text')).toContainText(['10x (ginga, armada)']);
});
