import { expect, test } from '@playwright/test';

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
    { type: 'google', next: '/' },
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
    { type: 'email', email: 'student@example.com', next: '/' },
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

  await expect(page).toHaveURL('/dashboard?group_link=safe-token');
  await expect.poll(() => page.evaluate(() => JSON.parse(
    localStorage.getItem('roda.e2e.session'),
  )?.user?.id)).toBe('practitioner-1');
});

test('scrubs callback data and exposes only safe retry routes on failure', async ({ page }) => {
  await page.goto('/auth/callback?code=e2e-failure&next=https://attacker.invalid&error=e2e');

  await expect(page).toHaveURL('/auth/callback');
  await expect(page.getByRole('alert')).toContainText('could not complete');
  await expect(page.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute('href', '/dashboard');
});
