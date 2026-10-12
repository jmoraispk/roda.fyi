// tests/e2e/app-class.spec.js
import { expect, test } from '@playwright/test';

test('a coach finishes a class from Today with tap-to-mark attendance', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-26T19:30:00Z'));
  await page.goto('/app?demo=1');
  await page.locator('.now-card').getByRole('button', { name: 'Finish class' }).click();
  await expect(page).toHaveURL(/#\/class\/demo-schedule$/);
  await expect(page.locator('.chapter')).toHaveCount(1);
  await expect(page.locator('.chapter')).toContainText('8x Armada');
  await expect(page.getByRole('checkbox')).toHaveCount(3);
  await page.getByRole('checkbox', { name: /Duda Reis/ }).click();
  await expect(page.getByText('👥 2 coming')).toBeVisible();
  await page.getByRole('button', { name: 'Finish class' }).click();
  await expect(page).toHaveURL(/#\/training\/[^?]+$/);
  await expect(page.getByRole('dialog', { name: 'Add resources' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.tag', { hasText: 'attended' })).toContainText('2 attended');
});

test('a class someone else arranged is not available', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
  await page.goto('/app?demo=1#/class/not-mine');
  await expect(page.getByText("This class isn't available.")).toBeVisible();
});
