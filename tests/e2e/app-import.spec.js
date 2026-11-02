// tests/e2e/app-import.spec.js
import { expect, test } from '@playwright/test';

const FILE = JSON.stringify({
  trainings: [
    {
      id: 'zoom-20261013-130606', start: '2026-10-13T13:06:06Z', durationMinutes: 108, notes: 'Class with the professor.',
      rounds: ['Round 1 · 15 min: ginga', '10x (armada, aú)'],
      resources: [
        { kind: 'video', url: 'https://www.youtube.com/watch?v=REtWeTI2Ihw' },
        { kind: 'summary', body: '# Summary\n\nGinga and armada.' },
        { kind: 'voice', title: 'Transcript', body: 'We started with ginga.' },
      ],
    },
    { id: 'zoom-20261009-130527', start: '2026-10-09T13:05:27Z', durationMinutes: 86, rounds: ['ginga 20 min'], resources: [] },
  ],
});

const occurrences = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('roda.e2e.trainingState') ?? '{}').occurrences?.length ?? 0);
const resources = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('roda.e2e.trainingState') ?? '{}').resources?.length ?? 0);

test('past trainings import as my logs, and importing again adds nothing', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
  await page.goto('/app?demo=1#/me/settings');
  await page.getByRole('link', { name: 'Import past trainings' }).click();
  await expect(page).toHaveURL(/#\/me\/import$/);
  const before = await occurrences(page);
  const resourcesBefore = await resources(page);
  await page.getByLabel('Import file').fill(FILE);
  await expect(page.getByText('2 trainings ready to import')).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.locator('[data-import-row="zoom-20261009-130527"]')).toContainText('Imported');
  await expect(page.locator('[data-import-row="zoom-20261013-130606"]')).toContainText('Imported');
  expect(await occurrences(page)).toBe(before + 2);
  expect(await resources(page)).toBe(resourcesBefore + 3);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.locator('[data-import-row="zoom-20261013-130606"]')).toContainText('Imported');
  expect(await occurrences(page)).toBe(before + 2);
  expect(await resources(page)).toBe(resourcesBefore + 3);
  await page.goto('/app?demo=1#/calendar/2026-10-13');
  await expect(page.getByRole('dialog')).toContainText('1h 48m');
});
