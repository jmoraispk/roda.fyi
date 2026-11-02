// tests/e2e/app-install.spec.js
import { expect, test } from '@playwright/test';

test.use({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
});

test('an iPhone visitor is shown how to add roda to the Home Screen, once', async ({ page }) => {
  await page.goto('/app?demo=1');
  // The setup checklist comes first and includes the home-screen step.
  const setup = page.getByRole('region', { name: 'Finish setting up' });
  await expect(setup).toBeVisible();
  await expect(setup.getByRole('link', { name: 'Put roda on your home screen' })).toHaveAttribute('href', '/install');
  await setup.getByRole('button', { name: 'Hide' }).click();
  await page.reload();
  // With the checklist hidden, the install card takes its place until Not now.
  const hint = page.getByRole('region', { name: 'Add roda to your Home Screen' });
  await expect(hint).toBeVisible();
  await expect(hint.getByRole('link', { name: 'Show me how' })).toHaveAttribute('href', '/install');
  await hint.getByRole('button', { name: 'Not now' }).click();
  await expect(hint).toBeHidden();
  await page.reload();
  await expect(page.locator('.week-day').first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Add roda to your Home Screen' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Finish setting up' })).toHaveCount(0);
});

test('the install page explains every phone and leads to the app', async ({ page }) => {
  await page.goto('/install');
  await expect(page.getByRole('heading', { name: 'Put roda on your phone' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'iPhone and iPad' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Android' })).toBeVisible();
  await page.getByRole('link', { name: 'Open roda' }).click();
  await expect(page).toHaveURL(/\/(app|\?next=)/);
});

test('the install, privacy, and support pages fit a narrow phone and link to each other', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  for (const name of ['install', 'privacy', 'support']) {
    await page.goto(`/${name}`);
    const nav = page.getByRole('navigation', { name: 'Site' });
    for (const label of ['Install', 'Privacy', 'Support']) await expect(nav.getByRole('link', { name: label })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('a new account sees what is left to set up, and each step opens where it is done', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1', email: 'ana@example.com' } }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify({ id: 'practitioner-1', display_name: 'Ana', completed_at: '2026-10-01T00:00:00Z', usage_mode: 'train' }));
  });
  await page.goto('/app');
  const setup = page.getByRole('region', { name: 'Finish setting up' });
  await expect(setup).toBeVisible();
  await expect(setup.getByRole('link', { name: 'Add your city' })).toHaveAttribute('href', '#/me/settings');
  await expect(setup.getByRole('link', { name: 'Join or create your group' })).toHaveAttribute('href', '#/me/groups');
  await setup.getByRole('link', { name: 'Log your first training' }).click();
  await expect(page).toHaveURL(/#\/log$/);
});
