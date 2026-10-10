// tests/e2e/training-resources.spec.js
import { expect, test } from '@playwright/test';

test('adds a video link and a summary file to Alone training', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1', email: 'ana@example.com' } }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify({
      id: 'practitioner-1', display_name: 'Ana Silva', avatar_path: null,
      timezone_override: 'Europe/Lisbon', leaderboard_visible: true, completed_at: '2026-09-11T20:00:00Z',
    }));
  });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Record Alone training' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record Alone training' });
  await dialog.getByLabel('Training date').fill('2026-09-22');
  await dialog.getByLabel('Round 1 text').fill('ginga 10 min');
  await dialog.getByRole('button', { name: 'Save training' }).click();
  await expect(dialog).toBeHidden();

  const detail = page.locator('#trainingDayDetail');
  await detail.getByRole('button', { name: 'Add resources' }).click();
  await detail.getByLabel('Resource type').selectOption('video');
  await detail.getByLabel('Title').fill('Zoom recording');
  await detail.getByLabel('Link', { exact: true }).fill('https://www.youtube.com/watch?v=oMmctHNRyBg');
  await detail.getByLabel('Text files (.txt, .md)').setInputFiles({
    name: 'summary.md', mimeType: 'text/markdown', buffer: Buffer.from('# Class 1\n\n- ginga\n- armada'),
  });
  await detail.getByRole('button', { name: 'Save resources' }).click();
  await expect(detail.getByRole('link', { name: '🎥 Zoom recording' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=oMmctHNRyBg');
  await detail.getByText('📄 summary.md').click();
  await expect(detail.locator('.resource-markdown h1')).toHaveText('Class 1');
  await expect(page.getByRole('gridcell', { name: /September 22.*Video, Summary/ })).toBeVisible();
});
