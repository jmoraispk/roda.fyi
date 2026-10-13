import { expect, test } from '@playwright/test';

// Seeded fixtures describe September 2026; pin the browser clock so month-relative views match.
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-24T12:00:00Z'));
});

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

  const entry = page.getByRole('button', { name: 'Sign in' });
  await expect(entry).toHaveCount(1);
  await expect(page.getByRole('button', { name: /register|login/i })).toHaveCount(0);
  await entry.click();

  const dialog = page.getByRole('dialog', { name: 'Sign in' });
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
    { type: 'google', next: '/app' },
  ]);
  await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeDisabled();

  await expect(search).toHaveValue('bananeira');
  await expect(page.locator('article.card:visible')).toContainText('Bananeira');
});

test('offers passwordless email as the secondary sign-in method', async ({ page }) => {
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Email address').fill('student@example.com');
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();

  await expect(page.getByRole('status')).toContainText('Check your email');
  await expect.poll(() => page.evaluate(() => window.__RODA_E2E_EVENTS__)).toEqual([
    { type: 'email', email: 'student@example.com', next: '/app' },
  ]);
});

test('opens a seeded browser-only demo without an account', async ({ page }) => {
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Try demo' }).click();

  await expect(page).toHaveURL('/app?demo=1');
  await expect(page.getByRole('note')).toHaveText('Demo · browser only');
  await expect(page.locator('.week-day')).toHaveCount(7);
  await expect(page.locator('.recent-card').first()).toBeVisible();
});

test('shows Entrar only while Portuguese is selected', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

  await page.getByRole('button', { name: 'Português' }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('dialog', { name: 'Entrar' })).toBeVisible();

  await page.locator('#authClose').click();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('dialog', { name: 'Sign in' })).toBeVisible();
});

test('uses the same entry as a dashboard action for a signed-in account', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('roda.e2e.session', JSON.stringify({
    user: { id: 'practitioner-1', email: 'student@example.com' },
  })));
  await page.reload();

  const dashboard = page.getByRole('button', { name: 'Dashboard' });
  await expect(dashboard).toBeVisible();
  await dashboard.click();
  // No stored profile, so the welcome may open first.
  await expect(page).toHaveURL(/\/app(#\/[a-z/]*)?$/);
});

test('exchanges a callback once and returns to a safe local destination', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('roda.e2e.profile', JSON.stringify({
    id: 'practitioner-1', display_name: 'Ana Silva', avatar_path: null, usage_mode: 'train',
    timezone_override: null, leaderboard_visible: true, completed_at: '2026-09-11T20:00:00Z',
  })));
  await page.goto('/auth/callback?code=e2e-success&next=%2Fapp%3Fgroup_link%3Dsafe-token');

  await expect(page).toHaveURL(/\/app(#\/)?$/);
  await expect(page.getByRole('dialog', { name: 'Group link' })).toContainText('This group link is unavailable.');
  await expect.poll(() => page.evaluate(() => JSON.parse(
    localStorage.getItem('roda.e2e.session'),
  )?.user?.id)).toBe('practitioner-1');
});

test('scrubs callback data and exposes only safe retry routes on failure', async ({ page }) => {
  await page.goto('/auth/callback?code=e2e-failure&next=https://attacker.invalid&error=e2e');

  await expect(page).toHaveURL('/auth/callback');
  await expect(page.getByRole('alert')).toContainText('could not complete');
  await expect(page.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('link', { name: 'Open Roda' })).toHaveAttribute('href', '/app');
});

test('returns unauthenticated dashboard visits to the unified sign-in destination', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page).toHaveURL('/?next=%2Fapp');
  await expect(page.getByRole('dialog', { name: 'Sign in' })).toBeVisible();
});
