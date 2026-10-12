// tests/e2e/app-me-pages.spec.js
import { expect, test } from '@playwright/test';

import { seedAccount } from './app-helpers.js';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
});

test('Progress and Repertoire open from Me, and Catalog is for curators only', async ({ page }) => {
  await page.goto('/app?demo=1#/me/progress');
  await expect(page.locator('.statistics-card').first()).toBeVisible();
  await page.goto('/app?demo=1#/me/repertoire');
  await page.getByRole('button', { name: 'Log', exact: true }).first().click();
  await expect(page).toHaveURL(/#\/log$/);
  await expect(page.locator('textarea[data-round-text]').first()).toHaveValue('10x (armada, aú)');
  await page.goto('/app?demo=1#/me/catalog');
  await expect(page).toHaveURL(/#\/me$/);
});

test('curators open the Catalog from Me', async ({ page }) => {
  await seedAccount(page, { extra: { 'roda.e2e.catalogCurator': true } });
  await page.goto('/app#/me');
  await page.getByRole('link', { name: /Catalog/ }).click();
  await expect(page).toHaveURL(/#\/me\/catalog$/);
  await expect(page.locator('h1.page-title')).toHaveText('Catalog');
});
