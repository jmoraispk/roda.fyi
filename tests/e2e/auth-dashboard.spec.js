import { expect, test } from '@playwright/test';

const completeProfile = {
  id: 'practitioner-1',
  display_name: 'Ana Silva',
  avatar_path: null,
  timezone_override: null,
  leaderboard_visible: true,
  completed_at: '2026-09-11T20:00:00Z',
};

async function seedAccount(page, { profile = completeProfile, coach = false } = {}) {
  await page.evaluate(({ nextProfile, isCoach }) => {
    localStorage.setItem('roda.e2e.session', JSON.stringify({
      user: {
        id: 'practitioner-1',
        email: 'ana@example.com',
        user_metadata: {
          full_name: 'Ana Silva',
          avatar_url: 'https://images.example/ana.jpg',
        },
      },
    }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify(nextProfile));
    if (isCoach) {
      localStorage.setItem('roda.e2e.coachProfile', JSON.stringify({
        profile_id: 'practitioner-1',
        activated_at: '2026-09-11T20:00:00Z',
      }));
    }
  }, { nextProfile: profile, isCoach: coach });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('keeps the movement library usable around one Google-first sign-in dialog', async ({ page }) => {
  const search = page.getByRole('searchbox', { name: 'Search moves' });
  await search.fill('bananeira');
  await expect(page.locator('article.card:visible')).toHaveCount(1);
  await expect(page.locator('article.card:visible')).toContainText('Bananeira');

  const entry = page.getByRole('button', { name: 'ENTRAR' });
  await expect(entry).toHaveCount(1);
  await expect(page.getByRole('button', { name: /register|login/i })).toHaveCount(0);
  await entry.click();

  const dialog = page.getByRole('dialog', { name: 'Entrar' });
  await expect(dialog).toBeVisible();
  const google = page.getByRole('button', { name: /Continue with Google.*Recommended/i });
  await expect(google).toBeFocused();
  await expect(google).toHaveClass(/auth-google/);

  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

  await google.click();
  await expect.poll(() => page.evaluate(() => window.__RODA_E2E_EVENTS__)).toEqual([
    { type: 'google', next: '/dashboard' },
  ]);
  await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeDisabled();

  await expect(search).toHaveValue('bananeira');
  await expect(page.locator('article.card:visible')).toContainText('Bananeira');
});

test('offers passwordless email as the secondary sign-in method', async ({ page }) => {
  await page.getByRole('button', { name: 'ENTRAR' }).click();
  await page.getByLabel('Email address').fill('student@example.com');
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();

  await expect(page.getByRole('status')).toContainText('Check your email');
  await expect.poll(() => page.evaluate(() => window.__RODA_E2E_EVENTS__)).toEqual([
    { type: 'email', email: 'student@example.com', next: '/dashboard' },
  ]);
});

test('uses the same entry as a dashboard action for a signed-in account', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('roda.e2e.session', JSON.stringify({
    user: { id: 'practitioner-1', email: 'student@example.com' },
  })));
  await page.reload();

  const dashboard = page.getByRole('button', { name: 'Dashboard' });
  await expect(dashboard).toBeVisible();
  await dashboard.click();
  await expect(page).toHaveURL('/dashboard');
});

test('exchanges a callback once and returns to a safe local destination', async ({ page }) => {
  await page.goto('/auth/callback?code=e2e-success&next=%2Fdashboard%3Fgroup_link%3Dsafe-token');

  await expect(page).toHaveURL('/dashboard');
  await expect(page.getByRole('heading', { name: 'Shared group' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(
    localStorage.getItem('roda.e2e.session'),
  )?.user?.id)).toBe('practitioner-1');
  await expect(page.getByRole('dialog', { name: 'Complete your profile' })).toBeVisible();
});

test('scrubs callback data and exposes only safe retry routes on failure', async ({ page }) => {
  await page.goto('/auth/callback?code=e2e-failure&next=https://attacker.invalid&error=e2e');

  await expect(page).toHaveURL('/auth/callback');
  await expect(page.getByRole('alert')).toContainText('could not complete');
  await expect(page.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute('href', '/dashboard');
});

test('returns unauthenticated dashboard visits to the unified sign-in destination', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page).toHaveURL('/?next=%2Fdashboard');
  await expect(page.getByRole('dialog', { name: 'Entrar' })).toBeVisible();
});

test('completes the practitioner profile with an optional automatic timezone', async ({ page }) => {
  await seedAccount(page, {
    profile: { ...completeProfile, display_name: 'Capoeirista', completed_at: null },
  });
  await page.goto('/dashboard');

  const dialog = page.getByRole('dialog', { name: 'Complete your profile' });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Display name')).toHaveValue('Ana Silva');
  await expect(page.getByLabel('Profile picture (optional)')).not.toHaveAttribute('required', '');
  await expect(page.getByText(/^Automatic \(.+\)$/)).toBeVisible();
  await expect(page.getByLabel('Use automatic timezone')).toBeChecked();

  await page.getByLabel('Use automatic timezone').uncheck();
  await page.getByLabel('Timezone override').fill('Mars/Olympus_Mons');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(dialog.getByRole('status')).toContainText('valid timezone');
  await expect(page.evaluate(() => window.__RODA_E2E_EVENTS__)).resolves.toEqual([]);

  await page.getByLabel('Timezone override').fill('Europe/Lisbon');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'My Training' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__RODA_E2E_EVENTS__)).toContainEqual({
    type: 'complete-profile',
    displayName: 'Ana Silva',
    timezoneChoice: 'Europe/Lisbon',
    leaderboardVisible: true,
  });
});

test('uses a binary mode switch and extends a practitioner through coach registration', async ({ page }) => {
  await seedAccount(page);
  await page.goto('/dashboard');

  const mode = page.getByRole('group', { name: 'Dashboard mode' });
  await expect(mode.getByRole('button', { name: 'My Training' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('tablist', { name: 'Dashboard mode' })).toHaveCount(0);
  await expect(page.getByText('Training history and plans are coming next.')).toBeVisible();

  await mode.getByRole('button', { name: 'Coaching' }).click();
  await expect(page.getByRole('button', { name: 'Register as a coach' })).toBeVisible();
  await page.getByRole('button', { name: 'Register as a coach' }).click();

  await expect(page.getByRole('button', { name: 'Create a group' })).toBeVisible();
  await expect(mode.getByRole('button', { name: 'My Training' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__RODA_E2E_EVENTS__)).toContainEqual({
    type: 'register-coach',
  });
});

test('keeps a coach in My Training by default and clears private UI on expiry', async ({ page }) => {
  await seedAccount(page, { coach: true });
  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'My Training' })).toBeVisible();
  await page.getByRole('button', { name: 'Coaching' }).click();
  await expect(page.getByRole('heading', { name: 'Coaching' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create a group' })).toBeVisible();

  await page.evaluate(() => window.__RODA_E2E_EXPIRE__());
  await expect(page).toHaveURL('/?next=%2Fdashboard');
  await expect(page.getByRole('heading', { name: 'Coaching' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Entrar' })).toBeVisible();
});

test('signs out from the dashboard and removes persisted private state', async ({ page }) => {
  await seedAccount(page, { coach: true });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Coaching' }).click();

  await page.getByRole('button', { name: 'Sign out' }).click();

  await expect(page).toHaveURL('/?next=%2Fdashboard');
  await expect(page.evaluate(() => ({
    session: localStorage.getItem('roda.e2e.session'),
    mode: localStorage.getItem('roda.dashboard.mode'),
    group: localStorage.getItem('roda.dashboard.group'),
  }))).resolves.toEqual({ session: null, mode: null, group: null });
});
