// tests/e2e/past-class.spec.js
import { expect, test } from '@playwright/test';

const group = {
  id: 'group-lua', slug: 'grupo-lua', owner_id: 'practitioner-1', name: 'Grupo Lua',
  description: 'Evening training', location: 'Lisbon', timezone: 'Europe/Lisbon',
  picture_path: null, is_discoverable: true, archived_at: null,
};

test('a coach records a past group class with a video link', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((seededGroup) => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1', email: 'coach@example.com' } }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify({
      id: 'practitioner-1', display_name: 'Coach Lua', avatar_path: null,
      timezone_override: 'Europe/Lisbon', leaderboard_visible: true, completed_at: '2026-09-11T20:00:00Z',
    }));
    localStorage.setItem('roda.e2e.coachProfile', JSON.stringify({ profile_id: 'practitioner-1', activated_at: '2026-09-11T20:00:00Z' }));
    localStorage.setItem('roda.e2e.groupState', JSON.stringify({
      groups: [seededGroup],
      memberships: [{ group_id: seededGroup.id, profile_id: 'practitioner-1', access_level: 'coach', state: 'active', joined_at: '2026-09-01T20:00:00Z', group: seededGroup }],
      rosters: { [seededGroup.id]: [
        { profile_id: 'student-group', display_name: 'Group Bia', access_level: 'member', membership_state: 'active' },
      ] },
    }));
    localStorage.setItem('roda.e2e.connectionState', JSON.stringify({ people: {}, connections: [] }));
  }, group);
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Coaching' }).click();
  await page.getByRole('button', { name: 'Record a past class' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record a past class' });
  await dialog.getByLabel('Class date').fill('2026-09-11');
  await dialog.getByLabel('Start time').fill('14:14');
  await dialog.getByLabel('Duration in minutes').fill('77');
  await dialog.getByLabel('Round 1 text').fill('ginga, armada');
  await dialog.getByLabel('Video link').fill('https://www.youtube.com/watch?v=oMmctHNRyBg');
  await dialog.getByRole('button', { name: 'Save past class' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('roda.e2e.trainingState'));
    return {
      occurrences: state.occurrences.map(({ kind, local_date: date }) => `${kind}:${date}`),
      participants: state.participations.map(({ profile_id: id }) => id),
      resources: state.resources.map(({ kind, url }) => `${kind}:${url}`),
    };
  })).toEqual({
    occurrences: ['group:2026-09-11'],
    participants: ['student-group'],
    resources: ['video:https://www.youtube.com/watch?v=oMmctHNRyBg'],
  });
});
