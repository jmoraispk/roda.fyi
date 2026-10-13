// tests/e2e/app-time-zones.spec.js
import { expect, test } from '@playwright/test';

test.use({ timezoneId: 'America/New_York' });

test('a Lisbon class shows my New York time first and its Lisbon time below', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
  // demo-group-1 happened on Oct 8 at 18:00 UTC, recorded in Europe/Lisbon.
  await page.goto('/app?demo=1#/training/demo-group-1');
  // \s also matches the narrow no-break space some browsers put before PM.
  await expect(page.locator('.training-meta')).toContainText(/Thu, Oct 8 · 02:00\sPM/);
  await expect(page.locator('.training-elsewhere')).toHaveText(/^07:00\sPM in Lisbon$/);
});
