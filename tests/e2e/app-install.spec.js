// tests/e2e/app-install.spec.js
import { expect, test } from '@playwright/test';

test.use({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
});

test('an iPhone visitor is shown how to add roda to the Home Screen, once', async ({ page }) => {
  await page.goto('/app?demo=1');
  const hint = page.getByRole('region', { name: 'Add roda to your Home Screen' });
  await expect(hint).toBeVisible();
  await expect(hint.getByRole('link', { name: 'Show me how' })).toHaveAttribute('href', '/install');
  await hint.getByRole('button', { name: 'Not now' }).click();
  await expect(hint).toBeHidden();
  await page.reload();
  await expect(page.locator('.week-day').first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Add roda to your Home Screen' })).toHaveCount(0);
});

test('the install page explains every phone and leads to the app', async ({ page }) => {
  await page.goto('/install');
  await expect(page.getByRole('heading', { name: 'Put roda on your phone' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'iPhone and iPad' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Android' })).toBeVisible();
  await page.getByRole('link', { name: 'Open roda' }).click();
  await expect(page).toHaveURL(/\/(app|\?next=)/);
});
