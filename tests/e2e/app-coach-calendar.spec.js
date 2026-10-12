// tests/e2e/app-coach-calendar.spec.js
import { expect, test } from '@playwright/test';

import { seedAccount } from './app-helpers.js';

const trainingState = {
  plans: [{
    plan_id: 'plan-1', version_id: 'version-1', title: 'Armada ladder', state: 'published', expected_duration_minutes: 60,
    rounds: [{ source_text: 'ginga 10 min', movements: [] }], updated_at: '2026-10-01T12:00:00Z',
  }],
  schedules: [{
    id: 'schedule-bia', kind: 'personal_class', state: 'scheduled', plan_version_id: 'version-1', group_id: null,
    student_profile_id: 'student-bia', connection_id: 'connection-bia', arranged_by: 'practitioner-1',
    starts_at: '2026-10-14T18:00:00Z', local_date: '2026-10-14', timezone: 'Europe/Lisbon',
    duration_minutes: 60, visible_in_advance: true,
  }],
  occurrences: [], participations: [], counter: 10,
};

test.beforeEach(async ({ page }) => {
  await seedAccount(page, {
    profile: { usage_mode: 'both' },
    coachProfile: { profile_id: 'practitioner-1' },
    extra: {
      'roda.e2e.trainingState': trainingState,
      'roda.e2e.connectionState': { people: { 'student-bia': 'Bia Santos' }, connections: [] },
    },
  });
});

test('Calendar shows a personal class the coach arranged and opens its class page', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
  await page.goto('/app#/calendar/2026-10');
  await page.locator('[data-date="2026-10-14"]').click();
  await page.getByRole('dialog').locator('.day-item').click();
  await expect(page).toHaveURL(/#\/class\/schedule-bia$/);
});

test('Today offers to finish a personal class that just ended', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-14T19:30:00Z'));
  await page.goto('/app');
  await expect(page.locator('.now-card')).toContainText('Your class just ended');
  await page.locator('.now-card').getByRole('button', { name: 'Finish class' }).click();
  await expect(page).toHaveURL(/#\/class\/schedule-bia$/);
});
