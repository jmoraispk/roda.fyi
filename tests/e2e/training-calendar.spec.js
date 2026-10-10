import { expect, test } from '@playwright/test';

async function seedAccount(page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({
      user: { id: 'practitioner-1', email: 'ana@example.com' },
    }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify({
      id: 'practitioner-1', display_name: 'Ana Silva', avatar_path: null,
      timezone_override: 'Europe/Lisbon', leaderboard_visible: true,
      completed_at: '2026-09-11T20:00:00Z',
    }));
  });
}

async function fillAlone(page, { date = '2026-09-22', notes = 'Armada practice' } = {}) {
  await page.getByRole('button', { name: 'Record Alone training' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record Alone training' });
  await dialog.getByLabel('Training date').fill(date);
  await dialog.getByLabel('Duration in minutes').fill('45');
  await dialog.getByLabel('Personal notes').fill(notes);
  await dialog.getByLabel('Round 1 text').fill('10x armada, au');
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await seedAccount(page);
});

test('records Alone training and opens its calendar details', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('tab', { name: 'Calendar' })).toHaveAttribute('aria-selected', 'true');
  const dialog = await fillAlone(page);
  await dialog.getByRole('button', { name: 'Save training' }).click();
  await expect(dialog).toBeHidden();

  const day = page.getByRole('gridcell', { name: /September 22.*Alone/i });
  await expect(day).toBeVisible();
  await day.click();
  await expect(page.locator('#trainingDayDetail')).toContainText('45m');
  await expect(page.locator('#trainingDayDetail')).toContainText('Armada practice');
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('roda.e2e.trainingState'));
    return [state.occurrences.length, state.participations.length];
  })).toEqual([1, 1]);
});

test('preserves a failed form and retries without duplicate participation', async ({ page }) => {
  await page.goto('/dashboard');
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('roda.e2e.trainingState') ?? '{}');
    state.failNext = 'recordAloneTraining';
    localStorage.setItem('roda.e2e.trainingState', JSON.stringify(state));
  });
  const dialog = await fillAlone(page, { notes: 'Retry me' });
  await dialog.getByRole('button', { name: 'Save training' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Personal notes')).toHaveValue('Retry me');
  await dialog.getByRole('button', { name: 'Save training' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('roda.e2e.trainingState'));
    return [state.occurrences.length, state.participations.length];
  })).toEqual([1, 1]);
});

test('localizes the calendar action in Portuguese', async ({ page }) => {
  await page.goto('/dashboard');
  await page.locator('#dashboardLocale').click();
  await expect(page.getByRole('button', { name: 'Registar treino sozinho' })).toBeVisible();
  await expect(page.getByRole('grid', { name: 'Calendário de treinos' })).toBeVisible();
});

test('keeps the calendar inside a mobile viewport', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'mobile-only geometry assertion');
  await page.goto('/dashboard');
  const box = await page.getByRole('grid', { name: 'Training calendar' }).boundingBox();
  const viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
});

test('rates a round and a transition from the day detail', async ({ page }) => {
  await page.goto('/dashboard');
  const dialog = await fillAlone(page, { notes: 'Assessment day' });
  await dialog.getByRole('button', { name: 'Save training' }).click();
  await expect(dialog).toBeHidden();

  const detail = page.locator('#trainingDayDetail');
  await expect(detail.locator('.round-source')).toHaveText('10x armada, au');
  await detail.getByRole('radio', { name: 'Hard' }).first().check();
  await detail.getByRole('button', { name: 'Rate parts' }).click();
  await detail.getByRole('button', { name: 'Transition Armada → Aú' }).click();
  await detail.locator('[data-segment-editor]').getByRole('radio', { name: 'Hard' }).check();
  await detail.getByRole('button', { name: 'Save ratings' }).click();
  await expect(detail.getByText('Ratings saved.')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('roda.e2e.trainingState'));
    return Object.values(state.roundRatings).flatMap((byRound) => Object.values(byRound).flat())
      .map(({ segment_key: key, difficulty }) => `${key}:${difficulty}`).sort();
  })).toEqual(['r:hard', 't:1>2:hard']);
});

test('records a round typed with an unknown move and shows it as new', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Record Alone training' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record Alone training' });
  await dialog.getByLabel('Round 1 text').fill('armada, galopanti');
  await expect(dialog.locator('[data-chip="2"]')).toHaveAttribute('data-status', 'new');
  await dialog.getByLabel('Training date').fill('2026-09-23');
  await dialog.getByRole('button', { name: 'Save training' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('roda.e2e.trainingState'))
    .occurrences[0].rounds[0].movements.map(({ movement_key: key, catalogued }) => `${key}:${catalogued}`)))
    .toEqual(['armada:true', 'galopanti:false']);
});
