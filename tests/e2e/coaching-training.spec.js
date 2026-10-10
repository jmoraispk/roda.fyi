import { expect, test } from '@playwright/test';

// Seeded fixtures describe September 2026; pin the browser clock so month-relative views match.
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-24T12:00:00Z'));
});

const group = {
  id: 'group-lua', slug: 'grupo-lua', owner_id: 'practitioner-1', name: 'Grupo Lua',
  description: 'Evening training', location: 'Lisbon', timezone: 'Europe/Lisbon',
  picture_path: null, is_discoverable: true, archived_at: null,
};

async function seedCoach(page) {
  await page.goto('/');
  await page.evaluate(({ seededGroup }) => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({
      user: { id: 'practitioner-1', email: 'coach@example.com' },
    }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify({
      id: 'practitioner-1', display_name: 'Coach Lua', avatar_path: null,
      timezone_override: 'Europe/Lisbon', leaderboard_visible: true,
      completed_at: '2026-09-11T20:00:00Z',
    }));
    localStorage.setItem('roda.e2e.coachProfile', JSON.stringify({
      profile_id: 'practitioner-1', activated_at: '2026-09-11T20:00:00Z',
    }));
    localStorage.setItem('roda.e2e.groupState', JSON.stringify({
      groups: [seededGroup],
      memberships: [{
        group_id: seededGroup.id, profile_id: 'practitioner-1', access_level: 'coach',
        state: 'active', joined_at: '2026-09-01T20:00:00Z', group: seededGroup,
      }],
      rosters: { [seededGroup.id]: [
        { profile_id: 'student-group', display_name: 'Group Bia', access_level: 'member', membership_state: 'active' },
        { profile_id: 'student-late', display_name: 'Late Caio', access_level: 'member', membership_state: 'active' },
        { profile_id: 'student-absent', display_name: 'Absent Duda', access_level: 'member', membership_state: 'active' },
      ] },
    }));
    localStorage.setItem('roda.e2e.connectionState', JSON.stringify({
      people: { 'student-direct': 'Direct Ana', 'student-group': 'Group Bia' },
      connections: [{
        connection_id: 'connection-1', connection_kind: 'direct', state: 'active',
        coach_profile_id: 'practitioner-1', coach_display_name: 'Coach Lua',
        student_profile_id: 'student-direct', student_display_name: 'Direct Ana',
        initiated_by: 'student-direct',
      }, {
        connection_id: null, connection_kind: 'group', state: 'active',
        coach_profile_id: 'practitioner-1', coach_display_name: 'Coach Lua',
        student_profile_id: 'student-group', student_display_name: 'Group Bia',
        group_id: seededGroup.id, group_name: seededGroup.name,
      }],
    }));
  }, { seededGroup: group });
}

async function createAndPublishPlan(page) {
  await page.getByRole('button', { name: 'Coaching' }).click();
  await expect(page.getByRole('tab', { name: 'Schedule' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Create workout plan' }).click();
  const dialog = page.getByRole('dialog', { name: 'Workout plan' });
  await dialog.getByLabel('Plan title').fill('Armada ladder');
  await dialog.getByLabel('Expected duration in minutes').fill('50');
  await dialog.getByRole('button', { name: 'Add round' }).click();
  await dialog.getByLabel('Round 1 text').fill('8x armada');
  await dialog.getByRole('button', { name: 'Save draft' }).click();
  await expect(dialog.getByRole('button', { name: 'Publish plan' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Publish plan' }).click();
  await expect(dialog.getByText('Published plan')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close workout plan' }).click();
}

test.beforeEach(async ({ page }) => {
  await seedCoach(page);
  await page.goto('/dashboard');
});

test('creates and publishes a plan, then schedules a hidden group training', async ({ page }) => {
  await createAndPublishPlan(page);
  const card = page.locator('[data-plan-id]').filter({ hasText: 'Armada ladder' });
  await card.getByRole('button', { name: 'Schedule group training' }).click();
  const schedule = page.getByRole('dialog', { name: 'Schedule training' });
  await schedule.getByLabel('Training date').fill('2026-09-25');
  await schedule.getByLabel('Start time').fill('18:30');
  await schedule.getByLabel('Show plan details before training').uncheck();
  await schedule.getByRole('button', { name: 'Schedule training' }).click();
  await expect(schedule).toBeHidden();

  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('roda.e2e.trainingState'));
    return state.schedules[0];
  })).toMatchObject({
    kind: 'group', group_id: 'group-lua', local_date: '2026-09-25',
    visible_in_advance: false, state: 'scheduled',
  });

  await page.evaluate(() => {
    localStorage.setItem('roda.e2e.session', JSON.stringify({
      user: { id: 'student-group', email: 'bia@example.com' },
    }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify({
      id: 'student-group', display_name: 'Group Bia', avatar_path: null,
      timezone_override: 'Europe/Lisbon', leaderboard_visible: true,
      completed_at: '2026-09-11T20:00:00Z',
    }));
    localStorage.removeItem('roda.e2e.coachProfile');
    localStorage.removeItem('roda.dashboard.mode');
  });
  await page.goto('/dashboard');
  await expect(page.getByRole('gridcell', { name: /September 25.*Group/i })).toBeVisible();
  await expect(page.getByText('Armada ladder')).toHaveCount(0);
});

test('schedules direct and group-derived personal classes with the right authorization context', async ({ page }) => {
  await createAndPublishPlan(page);
  const card = page.locator('[data-plan-id]').filter({ hasText: 'Armada ladder' });

  await card.getByRole('button', { name: /Schedule personal class · Direct Ana/ }).click();
  let schedule = page.getByRole('dialog', { name: 'Schedule training' });
  await schedule.getByLabel('Training date').fill('2026-09-26');
  await schedule.getByLabel('Start time').fill('10:00');
  await schedule.getByRole('button', { name: 'Schedule training' }).click();

  await card.getByRole('button', { name: /Schedule personal class · Group Bia/ }).click();
  schedule = page.getByRole('dialog', { name: 'Schedule training' });
  await schedule.getByLabel('Training date').fill('2026-09-27');
  await schedule.getByLabel('Start time').fill('11:00');
  await schedule.getByRole('button', { name: 'Schedule training' }).click();

  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('roda.e2e.trainingState'));
    return state.schedules.map(({ student_profile_id, connection_id, group_id }) => ({
      student_profile_id, connection_id, group_id,
    }));
  })).toEqual([{
    student_profile_id: 'student-direct', connection_id: 'connection-1', group_id: null,
  }, {
    student_profile_id: 'student-group', connection_id: null, group_id: 'group-lua',
  }]);
});

test('does not expose coach scheduling controls to an unregistered practitioner', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.removeItem('roda.e2e.coachProfile');
    localStorage.removeItem('roda.dashboard.mode');
  });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Coaching' }).click();
  await expect(page.getByRole('button', { name: 'Register as a coach' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create workout plan' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Schedule group training' })).toHaveCount(0);
});

test('confirms only attendees, preserves a late-arrival duration, and retries without duplicates', async ({ page }) => {
  await createAndPublishPlan(page);
  const card = page.locator('[data-plan-id]').filter({ hasText: 'Armada ladder' });
  await card.getByRole('button', { name: 'Schedule group training' }).click();
  const schedule = page.getByRole('dialog', { name: 'Schedule training' });
  await schedule.getByLabel('Training date').fill('2026-09-25');
  await schedule.getByLabel('Start time').fill('18:30');
  await schedule.getByRole('button', { name: 'Schedule training' }).click();
  await expect(schedule).toBeHidden();

  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('roda.e2e.trainingState'));
    return [state.occurrences.length, state.participations.length];
  })).toEqual([0, 0]);

  await page.getByRole('button', { name: 'Confirm training' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Confirm training' });
  await confirmation.getByRole('checkbox', { name: 'Absent Duda' }).uncheck();
  await confirmation.getByLabel('Late Caio duration').fill('35');
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('roda.e2e.trainingState'));
    state.failNext = 'completeGroupTraining';
    localStorage.setItem('roda.e2e.trainingState', JSON.stringify(state));
  });
  await confirmation.getByRole('button', { name: 'Confirm and count training' }).click();
  await expect(confirmation).toContainText('failed');
  await confirmation.getByRole('button', { name: 'Confirm and count training' }).click();
  await expect(confirmation).toBeHidden();

  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('roda.e2e.trainingState'));
    return {
      occurrences: state.occurrences.length,
      participants: state.participations
        .map(({ profile_id, actual_duration_minutes }) => [profile_id, actual_duration_minutes])
        .sort(),
      schedule: state.schedules[0].state,
    };
  })).toEqual({
    occurrences: 1,
    participants: [['student-group', 50], ['student-late', 35]],
    schedule: 'completed',
  });
});

test('adds feedback in an authorized context and clears student detail after revocation', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('roda.e2e.trainingState', JSON.stringify({
      counter: 20, plans: [], schedules: [], assessments: [], failNext: null,
      revokeReadsFor: [],
      occurrences: [{
        id: 'occurrence-1', kind: 'group', group_id: 'group-lua',
        recorded_by: 'practitioner-1', occurred_at: '2026-09-22T18:00:00Z',
        local_date: '2026-09-22', timezone: 'Europe/Lisbon',
        default_duration_minutes: 60, idempotency_key: 'seed-1', rounds: [],
      }],
      participations: [{
        id: 'participation-1', occurrence_id: 'occurrence-1',
        profile_id: 'student-group', actual_duration_minutes: 60,
        personal_notes: 'student-only note', confirmed_at: '2026-09-22T18:00:00Z',
      }],
      feedback: [{
        id: 'unrelated-feedback', participation_id: 'participation-1',
        coach_profile_id: 'other-coach', coach_name: 'Unrelated coach',
        group_id: 'other-group', connection_id: null,
        body: 'This must stay hidden.', created_at: '2026-09-22T18:05:00Z',
      }],
    }));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Coaching' }).click();
  await page.getByRole('tab', { name: 'Students' }).click();
  await page.getByRole('button', { name: "View Group Bia's training" }).click();
  await page.getByRole('button', { name: 'Open training details' }).click();
  await expect(page.locator('#coachingStudentsPanel')).not.toContainText('Unrelated coach');
  await expect(page.locator('#coachingStudentsPanel')).not.toContainText('student-only note');

  await page.getByLabel('Coach feedback').fill('Keep the base lower.');
  await page.getByRole('button', { name: 'Add feedback' }).click();
  await expect(page.locator('#coachingStudentsPanel')).toContainText('Keep the base lower.');

  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('roda.e2e.trainingState'));
    state.revokeReadsFor = ['practitioner-1'];
    localStorage.setItem('roda.e2e.trainingState', JSON.stringify(state));
  });
  await page.getByRole('button', { name: 'Back to training history' }).click();
  await expect(page.locator('#coachingStudentsPanel')).toHaveText('');
});
