// tests/e2e/app-teaching.spec.js
import { expect, test } from '@playwright/test';

test('a coach writes and publishes a plan, then schedules it', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
  await page.goto('/app?demo=1#/me/teaching');
  await expect(page.locator('a[href="#/class/demo-schedule"]')).toBeVisible();
  await expect(page.locator('a[href="#/me/teaching/plans/demo-plan"]')).toContainText('Ginga and counter-flow');
  await page.getByRole('link', { name: /New plan/ }).click();
  await page.getByLabel('Plan title').fill('Armada ladder');
  await page.locator('textarea[data-round-text]').first().fill('10x (armada, au)');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL(/#\/me\/teaching\/plans\/plan-\d+$/);
  await page.getByRole('button', { name: 'Publish plan' }).click();
  await page.getByRole('button', { name: /Schedule this plan/ }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Date').fill('2026-10-24');
  await sheet.getByLabel('Start time').fill('19:00');
  await sheet.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(page).toHaveURL(/#\/class\/schedule-\d+$/);
  await expect(page.locator('h1.training-title')).toHaveText('Group · Roda da Lua');
});

test('on desktop a class opens beside Teaching', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'desktop side-by-side only');
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
  await page.goto('/app?demo=1#/me/teaching');
  await page.locator('a[href="#/class/demo-schedule"]').click();
  await expect(page.locator('#appDetail h1.training-title')).toHaveText('Group · Roda da Lua');
  await expect(page.locator('#appMain [data-teaching-home]')).toBeVisible();
});

test('a coach opens a student and leaves feedback on a training', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
  await page.goto('/app?demo=1#/me/teaching');
  await page.getByRole('link', { name: /Bia Santos/ }).click();
  await expect(page).toHaveURL(/#\/me\/teaching\/students\/student-bia$/);
  await page.locator('[data-occurrence]').first().click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Coach feedback').fill('Keep the base low.');
  await sheet.getByRole('button', { name: 'Add feedback' }).click();
  await expect(sheet.getByText('Feedback saved.')).toBeVisible();
});

test('on desktop, finishing a class beside Teaching keeps Teaching on the left', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'desktop side-by-side only');
  await page.clock.setFixedTime(new Date('2026-10-26T19:30:00Z'));
  await page.goto('/app?demo=1#/me/teaching');
  await expect(page.locator('#appMain [data-teaching-home]')).toBeVisible();
  await page.evaluate(() => { location.hash = '#/class/demo-schedule'; });
  await page.locator('#appDetail').getByRole('button', { name: 'Finish class' }).click();
  await expect(page).toHaveURL(/#\/training\//);
  await page.keyboard.press('Escape');
  await expect(page.locator('#appMain [data-teaching-home]')).toBeVisible();
  await expect(page.locator('#appDetail .training-title')).toBeVisible();
});
