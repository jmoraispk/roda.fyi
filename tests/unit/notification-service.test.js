// tests/unit/notification-service.test.js
import { describe, expect, it, vi } from 'vitest';

import {
  AFTER_CHOICES, BEFORE_CHOICES, DEFAULT_PREFERENCES, QUIET_HOURS, checkPreferences, createNotificationService,
} from '../../src/app/notification-service.js';

const DEVICE = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', p256dh: 'P'.repeat(87), auth: 'A'.repeat(22) };
const client = (data = { status: 'saved' }) => ({ rpc: vi.fn().mockResolvedValue({ data, error: null }) });

describe('notification service', () => {
  it('saves and deletes this device', async () => {
    const supabase = client();
    const service = createNotificationService(supabase);
    await service.saveSubscription({ ...DEVICE, locale: 'pt', timezone: 'Europe/Lisbon' });
    expect(supabase.rpc).toHaveBeenCalledWith('save_push_subscription', {
      endpoint: DEVICE.endpoint, p256dh: DEVICE.p256dh, auth_key: DEVICE.auth, locale: 'pt', timezone: 'Europe/Lisbon',
    });
    await service.deleteSubscription(DEVICE.endpoint);
    expect(supabase.rpc).toHaveBeenLastCalledWith('delete_push_subscription', { endpoint: DEVICE.endpoint });
  });

  it('reads and saves what to send', async () => {
    const supabase = client(DEFAULT_PREFERENCES);
    const service = createNotificationService(supabase);
    expect(await service.getPreferences()).toEqual(DEFAULT_PREFERENCES);
    expect(supabase.rpc).toHaveBeenCalledWith('get_notification_preferences', {});
    await service.updatePreferences({ ...DEFAULT_PREFERENCES, before_minutes: 30, quiet_start: null, quiet_end: null });
    expect(supabase.rpc).toHaveBeenLastCalledWith('update_notification_preferences', {
      setup: true, before_class: true, before_minutes: 30, after_class: true, after_minutes: 60, coach: true, quiet_start: null, quiet_end: null,
    });
  });

  it('refuses what the server would refuse, before asking it', async () => {
    const supabase = client();
    await expect(createNotificationService(supabase).updatePreferences({ ...DEFAULT_PREFERENCES, quiet_end: '22:00' }))
      .rejects.toMatchObject({ code: 'invalid_preferences' });
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(() => checkPreferences({ before_minutes: 45 })).toThrow();
    expect(() => checkPreferences({ quiet_start: '22:00', quiet_end: null })).toThrow();
    expect(checkPreferences({})).toEqual(DEFAULT_PREFERENCES);
    expect([BEFORE_CHOICES, AFTER_CHOICES, QUIET_HOURS.length, QUIET_HOURS[22]]).toEqual([[15, 30, 60, 120], [30, 60, 120], 24, '22:00']);
  });

  it('turns database errors into safe messages', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: 'P0001', message: 'invalid_subscription' } }) };
    await expect(createNotificationService(supabase).saveSubscription({ ...DEVICE, locale: 'en', timezone: null }))
      .rejects.toMatchObject({ code: 'invalid_subscription', message: 'This device could not be set up for notifications.' });
  });
});
