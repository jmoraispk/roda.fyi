// tests/e2e/app-today.spec.js
import { expect, test } from '@playwright/test';

test('Today shows the demo week, recent trainings, and opens one', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
  await page.goto('/app?demo=1');
  await expect(page.locator('.week-day')).toHaveCount(7);
  const first = page.locator('.recent-card').first();
  await expect(first).toBeVisible();
  const box = await first.boundingBox();
  expect(box.width).toBeLessThanOrEqual(page.viewportSize().width);
  await first.click();
  await expect(page).toHaveURL(/#\/training\//);
});
