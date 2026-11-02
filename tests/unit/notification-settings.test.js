// tests/unit/notification-settings.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PREFERENCES } from '../../src/app/notification-service.js';
import { hourLabel, minutesLabel, renderNotificationSettings } from '../../src/app/screens/notification-settings.js';
import { appCtx } from './app-test-context.js';
import { fakeDevice } from './helpers/fake-push-device.js';

function notificationService(overrides = {}) {
  return {
    getPreferences: vi.fn().mockResolvedValue({ ...DEFAULT_PREFERENCES }),
    updatePreferences: vi.fn(async (preferences) => preferences),
    saveSubscription: vi.fn().mockResolvedValue({ status: 'saved' }),
    deleteSubscription: vi.fn().mockResolvedValue({ status: 'deleted' }),
    ...overrides,
  };
}

async function render({ device = fakeDevice(), service = {}, ctx = {} } = {}) {
  const context = appCtx({ services: { notifications: notificationService(service) }, pushDevice: device, ...ctx });
  const view = await renderNotificationSettings(context);
  // jsdom fires change events only for connected elements.
  document.body.replaceChildren(view);
  return { ctx: context, view };
}

describe('notification settings', () => {
  it.each([
    [null, 'Notifications are off in the demo.'],
    [fakeDevice({ support: 'unsupported' }), 'Not supported in this browser'],
    [fakeDevice({ support: 'ios-browser' }), 'Add roda to your Home Screen first'],
    [fakeDevice({ permission: 'denied' }), 'Blocked in the browser'],
    [fakeDevice({ permission: 'granted', subscribed: true }), 'On for this device'],
  ])('describes this device (%#)', async (device, words) => {
    const { view } = await render({ device });
    expect(view.getAttribute('aria-label')).toBe('Notifications');
    expect(view.querySelector('.notification-state').textContent).toBe(words);
    expect(view.querySelector('[data-action="turn-on-notifications"]')).toBeNull();
  });

  it('explains how to fix the blocked and iPhone cases', async () => {
    const blocked = (await render({ device: fakeDevice({ permission: 'denied' }) })).view;
    expect(blocked.querySelector('.notification-device').textContent).toContain('Allow them in your browser');
    const iphone = (await render({ device: fakeDevice({ support: 'ios-browser' }) })).view;
    expect(iphone.querySelector('.notification-device a').getAttribute('href')).toBe('/install');
  });

  it('turns this device on and off', async () => {
    const { ctx, view } = await render();
    view.querySelector('[data-action="turn-on-notifications"]').click();
    await vi.waitFor(() => expect(view.querySelector('.notification-state')?.textContent).toBe('On for this device'));
    expect(ctx.services.notifications.saveSubscription).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en', timezone: 'Europe/Lisbon' }));
    view.querySelector('[data-action="turn-off-notifications"]').click();
    await vi.waitFor(() => expect(view.querySelector('[data-action="turn-on-notifications"]')).not.toBeNull());
    expect(ctx.services.notifications.deleteSubscription).toHaveBeenCalled();
  });

  it('shows why turning on failed and offers it again', async () => {
    const { view } = await render({ service: { saveSubscription: vi.fn().mockRejectedValue(new Error('The network request failed. Please try again.')) } });
    view.querySelector('[data-action="turn-on-notifications"]').click();
    await vi.waitFor(() => expect(view.querySelector('.notification-device [role="status"]').textContent)
      .toBe('The network request failed. Please try again.'));
    expect(view.querySelector('[data-action="turn-on-notifications"]')).not.toBeNull();
  });

  it('shows the saved choices and hides Coach requests from people who do not coach', async () => {
    const { view } = await render({ service: { getPreferences: vi.fn().mockResolvedValue({ ...DEFAULT_PREFERENCES, before_minutes: 30, quiet_start: null, quiet_end: null }) } });
    expect(view.querySelector('select[name="before_minutes"]').value).toBe('30');
    expect([...view.querySelectorAll('select[name="before_minutes"] option')].map((option) => option.textContent))
      .toEqual(['15 min', '30 min', '1 hour', '2 hours']);
    expect(view.querySelector('input[name="quiet"]').checked).toBe(false);
    expect(view.querySelector('select[name="quiet_start"]').disabled).toBe(true);
    expect(view.querySelector('input[name="coach"]')).toBeNull();
  });

  it('saves what to send for the whole account', async () => {
    const { ctx, view } = await render({ ctx: { isCoach: () => true } });
    view.querySelector('input[name="after_class"]').click();
    view.querySelector('select[name="before_minutes"]').value = '15';
    view.querySelector('select[name="quiet_start"]').value = '23:00';
    view.querySelector('select[name="quiet_end"]').value = '07:00';
    view.querySelector('input[name="coach"]').click();
    view.querySelector('[data-action="save-notifications"]').click();
    await vi.waitFor(() => expect(view.querySelector('[data-notification-status]').textContent).toBe('Saved.'));
    expect(ctx.services.notifications.updatePreferences).toHaveBeenCalledWith({
      setup: true, before_class: true, before_minutes: 15, after_class: false, after_minutes: 60, coach: false,
      quiet_start: '23:00', quiet_end: '07:00',
    });
    expect(view.querySelector('select[name="after_minutes"]').disabled).toBe(true);
  });

  it('turns quiet hours off, and keeps the coach choice of people who do not coach', async () => {
    const { ctx, view } = await render({ service: { getPreferences: vi.fn().mockResolvedValue({ ...DEFAULT_PREFERENCES, coach: false }) } });
    view.querySelector('input[name="quiet"]').click();
    view.querySelector('[data-action="save-notifications"]').click();
    await vi.waitFor(() => expect(ctx.services.notifications.updatePreferences).toHaveBeenCalled());
    expect(ctx.services.notifications.updatePreferences.mock.calls[0][0]).toMatchObject({ coach: false, quiet_start: null, quiet_end: null });
  });

  it('says when the choices cannot be loaded', async () => {
    const { view } = await render({ service: { getPreferences: vi.fn().mockRejectedValue(new Error('The network request failed. Please try again.')) } });
    expect(view.textContent).toContain('The network request failed. Please try again.');
    expect(view.querySelector('[data-action="save-notifications"]')).toBeNull();
  });

  it('shows nothing without the notification service', async () => {
    expect(await renderNotificationSettings(appCtx())).toBeNull();
  });

  it('labels the choices in both languages', () => {
    const { i18n } = appCtx();
    expect([minutesLabel(i18n, 30), minutesLabel(i18n, 60), minutesLabel(i18n, 120)]).toEqual(['30 min', '1 hour', '2 hours']);
    expect(hourLabel(i18n, '22:00')).toBe('10:00 PM');
    i18n.setLocale('pt');
    expect(minutesLabel(i18n, 60)).toBe('1 hora');
    expect(hourLabel(i18n, '22:00')).toBe('22:00');
  });
});
