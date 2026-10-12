// tests/e2e/app-training.spec.js
import { expect, test } from '@playwright/test';

test('a group class page plays its recording and shows time and attendees', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
  await page.goto('/app?demo=1#/training/demo-group-1');
  await expect(page.locator('.tag').first()).toContainText('⏱');
  await expect(page.locator('.tag', { hasText: 'attended' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Class recording/ })).toBeVisible();
});

test('an unavailable training explains itself', async ({ page }) => {
  await page.goto('/app?demo=1#/training/not-mine');
  await expect(page.getByText("This training isn't available.")).toBeVisible();
});
