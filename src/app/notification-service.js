// src/app/notification-service.js
// This device and the account's notification choices (Rulings 13 and 16).
import { AppError, toAppError } from './errors.js';

export const BEFORE_CHOICES = Object.freeze([15, 30, 60, 120]);
export const AFTER_CHOICES = Object.freeze([30, 60, 120]);
export const QUIET_HOURS = Object.freeze(Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`));
export const DEFAULT_PREFERENCES = Object.freeze({
  setup: true, before_class: true, before_minutes: 60, after_class: true, after_minutes: 60, coach: true,
  quiet_start: '22:00', quiet_end: '08:00',
});

// The same rules as private.update_notification_preferences.
export function checkPreferences(input = {}) {
  const preferences = { ...DEFAULT_PREFERENCES, ...input };
  const switches = ['setup', 'before_class', 'after_class', 'coach'].every((name) => typeof preferences[name] === 'boolean');
  const quietOff = preferences.quiet_start === null && preferences.quiet_end === null;
  const quietOn = QUIET_HOURS.includes(preferences.quiet_start) && QUIET_HOURS.includes(preferences.quiet_end)
    && preferences.quiet_start !== preferences.quiet_end;
  if (!switches || !BEFORE_CHOICES.includes(preferences.before_minutes) || !AFTER_CHOICES.includes(preferences.after_minutes)
    || !(quietOff || quietOn)) {
    throw new AppError('validation', 'invalid_preferences');
  }
  return {
    setup: preferences.setup, before_class: preferences.before_class, before_minutes: preferences.before_minutes,
    after_class: preferences.after_class, after_minutes: preferences.after_minutes, coach: preferences.coach,
    quiet_start: preferences.quiet_start, quiet_end: preferences.quiet_end,
  };
}

export function createNotificationService(client) {
  async function call(name, params = {}) {
    const result = await client.rpc(name, params);
    if (result.error) throw toAppError(result.error);
    return result.data;
  }

  return {
    saveSubscription({ endpoint, p256dh, auth, locale, timezone = null }) {
      return call('save_push_subscription', { endpoint, p256dh, auth_key: auth, locale, timezone });
    },
    deleteSubscription(endpoint) {
      return call('delete_push_subscription', { endpoint });
    },
    getPreferences() {
      return call('get_notification_preferences');
    },
    async updatePreferences(preferences) {
      return call('update_notification_preferences', checkPreferences(preferences));
    },
  };
}
