// tests/unit/notifications.test.js
import { describe, expect, it, vi } from 'vitest';

import {
  deviceState, forgetDevice, notificationLink, refreshSubscription, turnOff, turnOn,
} from '../../src/app/notifications.js';
import { SUBSCRIPTION, fakeDevice } from './helpers/fake-push-device.js';

const service = (overrides = {}) => ({
  saveSubscription: vi.fn().mockResolvedValue({ status: 'saved' }),
  deleteSubscription: vi.fn().mockResolvedValue({ status: 'deleted' }),
  ...overrides,
});
const link = (device, notifications = service()) => ({ device, service: notifications, locale: 'pt', timezone: 'America/New_York' });

describe('notifications on this device', () => {
  it('names the state of this device', async () => {
    expect(await deviceState(null)).toBe('demo');
    expect(await deviceState(fakeDevice({ support: 'unsupported' }))).toBe('unsupported');
    expect(await deviceState(fakeDevice({ support: 'ios-browser' }))).toBe('ios-browser');
    expect(await deviceState(fakeDevice({ permission: 'denied' }))).toBe('blocked');
    expect(await deviceState(fakeDevice())).toBe('off');
    expect(await deviceState(fakeDevice({ permission: 'granted' }))).toBe('off');
    expect(await deviceState(fakeDevice({ permission: 'granted', subscribed: true }))).toBe('on');
  });

  it('asks the browser, subscribes, and saves the device with its language and zone', async () => {
    const device = fakeDevice();
    const notifications = service();
    expect(await turnOn(link(device, notifications))).toBe('on');
    expect(device.requestPermission).toHaveBeenCalledTimes(1);
    expect(notifications.saveSubscription).toHaveBeenCalledWith({ ...SUBSCRIPTION, locale: 'pt', timezone: 'America/New_York' });
  });

  it('does not ask twice, and reuses a subscription the browser already has', async () => {
    const device = fakeDevice({ permission: 'granted', subscribed: true });
    expect(await turnOn(link(device))).toBe('on');
    expect(device.requestPermission).not.toHaveBeenCalled();
    expect(device.subscribe).not.toHaveBeenCalled();
  });

  it('stops when the person says no or closes the prompt', async () => {
    const notifications = service();
    const denied = fakeDevice({ answer: 'denied' });
    expect(await turnOn(link(denied, notifications))).toBe('blocked');
    expect(await turnOn(link(fakeDevice({ answer: 'default' }), notifications))).toBe('off');
    expect(denied.subscribe).not.toHaveBeenCalled();
    expect(notifications.saveSubscription).not.toHaveBeenCalled();
  });

  it('never leaves the device half on when saving fails', async () => {
    const device = fakeDevice();
    const notifications = service({ saveSubscription: vi.fn().mockRejectedValue(new Error('offline')) });
    await expect(turnOn(link(device, notifications))).rejects.toThrow('offline');
    expect(device.unsubscribe).toHaveBeenCalled();
    expect(await deviceState(device)).toBe('off');
  });

  it('turns off in the browser first, then removes the device from the account', async () => {
    const device = fakeDevice({ permission: 'granted', subscribed: true });
    const notifications = service({ deleteSubscription: vi.fn().mockRejectedValue(new Error('offline')) });
    expect(await turnOff(link(device, notifications))).toBe('off');
    expect(notifications.deleteSubscription).toHaveBeenCalledWith(SUBSCRIPTION.endpoint);
    expect(await deviceState(device)).toBe('off');
  });

  it('saves the language and zone again only when the device is on', async () => {
    const notifications = service();
    expect(await refreshSubscription(link(null, notifications))).toBe(false);
    expect(await refreshSubscription(link(fakeDevice(), notifications))).toBe(false);
    expect(await refreshSubscription(link(fakeDevice({ permission: 'granted', subscribed: true }), notifications))).toBe(true);
    expect(notifications.saveSubscription).toHaveBeenCalledTimes(1);
    expect(notifications.saveSubscription).toHaveBeenCalledWith({ ...SUBSCRIPTION, locale: 'pt', timezone: 'America/New_York' });
  });

  it('forgets this device on sign-out without waiting for a slow network', async () => {
    const device = fakeDevice({ permission: 'granted', subscribed: true });
    const notifications = service({ deleteSubscription: vi.fn(() => new Promise(() => {})) });
    expect(await forgetDevice(link(device, notifications), { timeoutMs: 20 })).toBe(false);
    expect(device.unsubscribe).toHaveBeenCalled();
    expect(await deviceState(device)).toBe('off');
    expect(await forgetDevice(link(null, notifications))).toBe(false);
    expect(await forgetDevice(link(fakeDevice({ permission: 'granted', subscribed: true })))).toBe(true);
  });

  it('builds its link from the app context', () => {
    const device = fakeDevice();
    const notifications = service();
    expect(notificationLink({ pushDevice: device, services: { notifications }, i18n: { locale: () => 'en' }, timezone: 'Europe/Lisbon' }))
      .toEqual({ device, service: notifications, locale: 'en', timezone: 'Europe/Lisbon' });
    expect(notificationLink({ services: {}, i18n: { locale: () => 'en' }, timezone: 'UTC' }).device).toBeNull();
  });
});
