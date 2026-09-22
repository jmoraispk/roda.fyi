import { expect, test } from '@playwright/test';

async function seedStatistics(page) {
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
    const group = {
      id: 'group-1', name: 'Grupo Lua', timezone: 'Europe/Lisbon',
      owner_id: 'coach-1', is_discoverable: true, archived_at: null,
    };
    localStorage.setItem('roda.e2e.memberships', JSON.stringify([{
      group_id: 'group-1', profile_id: 'practitioner-1', access_level: 'member',
      state: 'active', joined_at: '2026-01-01T00:00:00Z', group,
    }]));
    localStorage.setItem('roda.e2e.groupState', JSON.stringify({
      groups: [group],
      memberships: [{
        group_id: 'group-1', profile_id: 'practitioner-1', access_level: 'member',
        state: 'active', joined_at: '2026-01-01T00:00:00Z', group,
      }],
      rosters: {
        'group-1': [
          { profile_id: 'student-2', display_name: 'Bia', access_level: 'member', leaderboard_visible: true },
          { profile_id: 'student-3', display_name: 'Caio', access_level: 'member', leaderboard_visible: true },
          { profile_id: 'student-4', display_name: 'Duda', access_level: 'member', leaderboard_visible: true },
          { profile_id: 'practitioner-1', display_name: 'Ana Silva', access_level: 'member', leaderboard_visible: true },
          { profile_id: 'student-private', display_name: 'Private Person', access_level: 'member', leaderboard_visible: false },
        ],
      },
    }));
    const definitions = [
      ['ana-1', 'practitioner-1', '2026-09-02', 45, 'alone'],
      ['ana-2', 'practitioner-1', '2026-09-09', 46, 'alone'],
      ['ana-3', 'practitioner-1', '2026-09-16', 60, 'group'],
      ['ana-4', 'practitioner-1', '2026-09-22', 60, 'group'],
      ['bia-1', 'student-2', '2026-09-04', 300, 'alone'],
      ['caio-1', 'student-3', '2026-09-05', 250, 'alone'],
      ['duda-1', 'student-4', '2026-09-06', 220, 'alone'],
      ['private-1', 'student-private', '2026-09-07', 400, 'alone'],
    ];
    localStorage.setItem('roda.e2e.trainingState', JSON.stringify({
      plans: [], schedules: [], assessments: [], feedback: [], counter: 30,
      occurrences: definitions.map(([id, , date, minutes, kind]) => ({
        id, kind, group_id: kind === 'group' ? 'group-1' : null,
        local_date: date, occurred_at: `${date}T18:00:00Z`,
        default_duration_minutes: minutes,
        rounds: id === 'ana-1' ? [{ movements: [{ movement_key: 'armada', movement_name_snapshot: 'Armada' }] }] : [],
      })),
      participations: definitions.map(([id, profileId, , minutes]) => ({
        id: `p-${id}`, occurrence_id: id, profile_id: profileId,
        actual_duration_minutes: minutes, confirmed_at: '2026-09-22T18:00:00Z',
      })),
    }));
  });
}

test.beforeEach(async ({ page }) => {
  await seedStatistics(page);
});

test('shows personal totals, all selectors, group ranking, pinning, and privacy', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('tab', { name: 'Statistics' }).click();

  const panel = page.getByRole('tabpanel', { name: 'Statistics' });
  await expect(panel).toContainText('3h 31m');
  await expect(panel).toContainText('4 trainings');
  await expect(panel.getByRole('button', { name: 'This week' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'This month' })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('button', { name: 'This year' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'All time' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Training time' })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('[data-podium-entry]')).toHaveCount(3);
  await expect(panel.locator('[data-current-member]')).toContainText('Ana Silva');
  await expect(panel.locator('[data-anonymous-note]')).toContainText('1');
  await expect(panel).not.toContainText('Private Person');

  for (const period of ['This week', 'This year', 'All time', 'This month']) {
    await panel.getByRole('button', { name: period }).click();
    await expect(panel.getByRole('button', { name: period })).toHaveAttribute('aria-pressed', 'true');
  }

  await panel.getByRole('button', { name: 'Number of trainings' }).click();
  await expect(panel.locator('[data-current-member]')).toContainText('4 trainings');
});

test('localizes statistics in Portuguese', async ({ page }) => {
  await page.goto('/dashboard');
  await page.locator('#dashboardLocale').click();
  await page.getByRole('tab', { name: 'Estatísticas' }).click();
  const panel = page.getByRole('tabpanel', { name: 'Estatísticas' });
  await expect(panel.getByRole('button', { name: 'Esta semana' })).toBeVisible();
  await expect(panel).toContainText('4 treinos');
  await expect(panel).toContainText('Classificação do grupo');
});

test('stacks the podium within a mobile viewport', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'mobile-only geometry assertion');
  await page.goto('/dashboard');
  await page.getByRole('tab', { name: 'Statistics' }).click();
  const entries = page.locator('[data-podium-entry]');
  await expect(entries).toHaveCount(3);
  const first = await entries.nth(0).boundingBox();
  const second = await entries.nth(1).boundingBox();
  expect(second.y).toBeGreaterThan(first.y + first.height - 1);
  expect(first.x + first.width).toBeLessThanOrEqual(page.viewportSize().width);
});
