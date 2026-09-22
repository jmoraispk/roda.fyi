import { expect, test } from '@playwright/test';

const student = {
  id: 'student-1',
  display_name: 'Student Ana',
  avatar_path: null,
  timezone_override: null,
  leaderboard_visible: true,
  completed_at: '2026-09-22T10:00:00Z',
};

const coach = {
  ...student,
  id: 'coach-1',
  display_name: 'Mestre Lua',
};

async function setIdentity(page, profile, { isCoach = false } = {}) {
  await page.evaluate(({ nextProfile, nextIsCoach }) => {
    localStorage.setItem('roda.e2e.session', JSON.stringify({
      user: { id: nextProfile.id, email: `${nextProfile.id}@example.test` },
    }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify(nextProfile));
    if (nextIsCoach) {
      localStorage.setItem('roda.e2e.coachProfile', JSON.stringify({
        profile_id: nextProfile.id,
        activated_at: '2026-09-22T10:00:00Z',
      }));
    } else {
      localStorage.removeItem('roda.e2e.coachProfile');
    }
  }, { nextProfile: profile, nextIsCoach: isCoach });
}

test('requests, accepts, and ends a direct coaching connection', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(({ nextStudent, nextCoach }) => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.connectionState', JSON.stringify({
      candidates: [
        { profile_id: nextCoach.id, display_name: nextCoach.display_name, candidate_role: 'coach' },
        { profile_id: nextStudent.id, display_name: nextStudent.display_name, candidate_role: 'student' },
      ],
      people: {
        [nextCoach.id]: nextCoach.display_name,
        [nextStudent.id]: nextStudent.display_name,
      },
      connections: [],
      counter: 0,
    }));
  }, { nextStudent: student, nextCoach: coach });
  await setIdentity(page, student);
  await page.goto('/dashboard');

  await page.getByRole('button', { name: 'Find a coach' }).click();
  await page.getByRole('searchbox', { name: 'Search coaches' }).fill('Lua');
  await page.getByRole('button', { name: 'Request Mestre Lua' }).click();
  await expect(page.getByText('Pending')).toBeVisible();

  await setIdentity(page, coach, { isCoach: true });
  await page.reload();
  await page.getByRole('button', { name: 'Accept Student Ana' }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();

  await setIdentity(page, student);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mestre Lua' })).toBeVisible();
  await page.getByRole('button', { name: 'End connection with Mestre Lua' }).click();
  await expect(page.getByText('This coaching connection has ended.').first()).toBeVisible();
});

test('renders the connection experience in Portuguese', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(({ nextStudent }) => {
    localStorage.clear();
    localStorage.setItem('roda.dashboard.locale', 'pt');
    localStorage.setItem('roda.e2e.session', JSON.stringify({
      user: { id: nextStudent.id, email: 'student@example.test' },
    }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify(nextStudent));
    localStorage.setItem('roda.e2e.connectionState', JSON.stringify({ connections: [] }));
  }, { nextStudent: student });
  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Treinadores e alunos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Encontrar treinador' })).toBeVisible();
});
