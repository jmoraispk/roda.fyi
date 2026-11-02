// tests/e2e/app-notifications.spec.js
import { expect, test } from '@playwright/test';

import { seedAccount } from './app-helpers.js';

const events = (page) => page.evaluate(() => window.__RODA_E2E_EVENTS__ ?? []);
const stored = (page, key) => page.evaluate((name) => JSON.parse(localStorage.getItem(name) ?? 'null'), key);
const section = (page) => page.getByRole('region', { name: 'Notifications' });
const ALLOWS = { support: 'supported', permission: 'default', answer: 'granted' };

test('turning notifications on and off for this device saves and removes it', async ({ page }) => {
  // Headless Chromium reports notifications as denied even after grantPermissions,
  // so the fake device scripts the prompt: not asked yet, then Allow.
  await seedAccount(page, { extra: { 'roda.e2e.push': ALLOWS } });
  await page.goto('/app#/me/settings');
  await section(page).getByRole('button', { name: 'Turn on notifications' }).click();
  await expect(section(page).getByText('On for this device', { exact: true })).toBeVisible();
  expect(await events(page)).toContainEqual({ type: 'push-permission', answer: 'granted' });
  expect(await events(page)).toContainEqual(expect.objectContaining({ type: 'push-subscribe', locale: 'en', timezone: 'Europe/Lisbon' }));
  await page.reload();
  await expect(section(page).getByText('On for this device', { exact: true })).toBeVisible();
  await section(page).getByRole('button', { name: 'Turn off' }).click();
  await expect(section(page).getByRole('button', { name: 'Turn on notifications' })).toBeVisible();
  expect((await stored(page, 'roda.e2e.notificationState')).subscriptions).toEqual([]);
});

for (const [label, push, words] of [
  ['notifications are blocked', { support: 'supported', permission: 'denied' }, 'Blocked in the browser'],
  ['an iPhone runs roda in Safari', { support: 'ios-browser' }, 'Add roda to your Home Screen first'],
  ['the browser has no notifications', { support: 'unsupported' }, 'Not supported in this browser'],
]) {
  test(`Settings explains what to do when ${label}`, async ({ page }) => {
    await seedAccount(page, { extra: { 'roda.e2e.push': push } });
    await page.goto('/app#/me/settings');
    await expect(section(page).getByText(words, { exact: true })).toBeVisible();
    await expect(section(page).getByRole('button', { name: 'Turn on notifications' })).toHaveCount(0);
    if (push.support === 'ios-browser') {
      await expect(section(page).getByRole('link', { name: 'Show me how' })).toHaveAttribute('href', '/install');
    }
  });
}

test('what to send is saved to the account and comes back', async ({ page }) => {
  await seedAccount(page, { coachProfile: { profile_id: 'practitioner-1' } });
  await page.goto('/app#/me/settings');
  const notifications = section(page);
  await notifications.getByLabel('After a class', { exact: true }).uncheck();
  await notifications.getByLabel('How long before a class').selectOption('30');
  await notifications.getByLabel('Quiet from').selectOption('23:00');
  await notifications.getByLabel('Quiet until').selectOption('07:00');
  await notifications.getByLabel('Coach requests').uncheck();
  await notifications.getByRole('button', { name: 'Save notification settings' }).click();
  await expect(notifications.getByText('Saved.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(notifications.getByLabel('After a class', { exact: true })).not.toBeChecked();
  await expect(notifications.getByLabel('How long before a class')).toHaveValue('30');
  await expect(notifications.getByLabel('Quiet from')).toHaveValue('23:00');
  await expect(notifications.getByLabel('Quiet until')).toHaveValue('07:00');
  await expect(notifications.getByLabel('Coach requests')).not.toBeChecked();
});

test('Coach requests are offered only to people who coach', async ({ page }) => {
  await seedAccount(page);
  await page.goto('/app#/me/settings');
  await expect(section(page).getByLabel('Before a class', { exact: true })).toBeChecked();
  await expect(section(page).getByLabel('Coach requests')).toHaveCount(0);
});

test('signing out turns this device off, so the next person on the phone gets nothing', async ({ page }) => {
  // Headless Chromium reports notifications as denied even after grantPermissions,
  // so the fake device scripts the prompt: not asked yet, then Allow.
  await seedAccount(page, { extra: { 'roda.e2e.push': ALLOWS } });
  await page.goto('/app#/me/settings');
  await section(page).getByRole('button', { name: 'Turn on notifications' }).click();
  await expect(section(page).getByText('On for this device', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect((await stored(page, 'roda.e2e.push')).subscribed).toBe(false);
  expect((await stored(page, 'roda.e2e.notificationState')).subscriptions).toEqual([]);
});
