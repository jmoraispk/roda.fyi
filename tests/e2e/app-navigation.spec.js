import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
});

test('sheets close when the route changes', async ({ page }) => {
  await page.goto('/app?demo=1#/calendar');
  await page.locator('.cal-day:has(.cal-dot:not(.upcoming))').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => { location.hash = '#/'; });
  await expect(page.locator('.week-day').first()).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('after saving on desktop, the composer is replaced by the last screen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'desktop side-by-side only');
  await page.goto('/app?demo=1#/log');
  const box = page.getByLabel('Write a round');
  await box.fill('ginga 10 min');
  await box.press('Enter');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/training\//);
  await expect(page.locator('#appMain').getByLabel('Write a round')).toHaveCount(0);
  await expect(page.locator('#appMain .week-day').first()).toBeVisible();
});

test('a session that ends while the app is open goes to sign-in', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1', email: 'ana@example.com' } }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify({
      id: 'practitioner-1', display_name: 'Ana Silva', avatar_path: null,
      timezone_override: 'Europe/Lisbon', leaderboard_visible: true, completed_at: '2026-09-11T20:00:00Z',
    }));
  });
  await page.goto('/app#/calendar');
  await expect(page.locator('.cal-day').first()).toBeVisible();
  await page.evaluate(() => window.__RODA_E2E_EXPIRE__());
  await expect(page).toHaveURL(/\/\?next=%2Fapp%23%2Fcalendar$/);
});

test('Back on a deep link stays in the app', async ({ page }) => {
  await page.goto('/app?demo=1#/training/not-mine');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/\/app\?demo=1#\/$/);
});
