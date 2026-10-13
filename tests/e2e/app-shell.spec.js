// tests/e2e/app-shell.spec.js
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

test('shows the navigation and moves between destinations', async ({ page }, testInfo) => {
  await page.goto('/app');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: 'Me' }).click();
  await expect(page).toHaveURL(/#\/me$/);
  await page.getByRole('link', { name: /Settings/ }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Português' }).click();
  await page.goto('/app#/me');
  const navPt = page.getByRole('navigation', { name: 'Navegação principal' });
  await expect(navPt.getByRole('link', { name: 'Hoje' })).toBeVisible();
  if (testInfo.project.name.includes('mobile')) {
    await expect(navPt.getByRole('button', { name: 'Criar' })).toBeVisible();
  } else {
    await expect(navPt.getByRole('button', { name: '+ Registar treino' })).toBeVisible();
  }
});

test('sends unknown routes to Today', async ({ page }) => {
  await page.goto('/app#/does-not-exist');
  await expect(page).toHaveURL(/#\/$/);
});

test('signed-out visitors go to sign-in and keep the route', async ({ page }) => {
  await page.evaluate(() => localStorage.removeItem('roda.e2e.session'));
  await page.goto('/app#/calendar');
  await expect(page).toHaveURL(/\/\?next=%2Fapp%23%2Fcalendar$/);
});

test('signs out from Settings', async ({ page }) => {
  await page.goto('/app#/me/settings');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => localStorage.getItem('roda.e2e.session'))).toBeNull();
});
