// tests/e2e/catalog-curation.spec.js
import { expect, test } from '@playwright/test';

async function seed(page, curator) {
  await page.goto('/');
  await page.evaluate((isCurator) => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1', email: 'ana@example.com' } }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify({
      id: 'practitioner-1', display_name: 'Ana Silva', avatar_path: null,
      timezone_override: 'Europe/Lisbon', leaderboard_visible: true, completed_at: '2026-09-11T20:00:00Z',
    }));
    if (isCurator) localStorage.setItem('roda.e2e.catalogCurator', 'true');
  }, curator);
}

async function recordGalopanti(page) {
  await page.getByRole('button', { name: 'Record Alone training' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record Alone training' });
  await dialog.getByLabel('Training date').fill('2026-10-02');
  await dialog.getByLabel('Round 1 text').fill('galopanti, armada');
  await dialog.getByRole('button', { name: 'Save training' }).click();
  await expect(dialog).toBeHidden();
}

test('hides the Catalog tab from non-curators', async ({ page }) => {
  await seed(page, false);
  await page.goto('/dashboard');
  await expect(page.getByRole('tab', { name: 'Calendar' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Catalog' })).toBeHidden();
});

test('a curator maps a term and the parser recognizes it next time', async ({ page }) => {
  await seed(page, true);
  await page.goto('/dashboard');
  await recordGalopanti(page);
  await page.getByRole('tab', { name: 'Catalog' }).click();
  const row = page.locator('[data-term="galopanti"]');
  await expect(row.locator('[data-people]')).toHaveText('1');
  await row.getByLabel('Map galopanti to move').selectOption('galopante');
  await row.getByRole('button', { name: 'Map' }).click();
  await expect(page.getByText('Every written move matches the catalog.')).toBeVisible();

  await page.getByRole('tab', { name: 'Calendar' }).click();
  await page.getByRole('button', { name: 'Record Alone training' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record Alone training' });
  await dialog.getByLabel('Round 1 text').fill('galopanti');
  await expect(dialog.locator('[data-chip="1"]')).toHaveAttribute('data-status', 'known');
});
