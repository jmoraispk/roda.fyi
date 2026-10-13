// tests/e2e/app-hardening.spec.js
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1', email: 'ana@example.com' } }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify({
      id: 'practitioner-1', display_name: 'Ana Silva', avatar_path: null,
      timezone_override: 'Europe/Lisbon', leaderboard_visible: true, completed_at: '2026-09-11T20:00:00Z',
    }));
  });
});

test('an impossible calendar month opens the current month', async ({ page }) => {
  await page.goto('/app#/calendar/2026-13');
  await expect(page.getByRole('heading', { name: 'October 2026' })).toBeVisible();
  await expect(page).toHaveURL(/#\/calendar$/);
});
