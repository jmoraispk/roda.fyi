// tests/unit/start-time.test.js
import { describe, expect, it } from 'vitest';

import { defaultStartTime, localClock, startInstant } from '../../src/app/screens/start-time.js';

describe('start time', () => {
  it('defaults to now minus the duration, rounded down, never before midnight', () => {
    expect(localClock(new Date('2026-10-11T12:07:00Z'), 'UTC')).toBe('12:07');
    expect(defaultStartTime({ now: new Date('2026-10-11T12:07:00Z'), timezone: 'Europe/Lisbon', durationMinutes: 45 })).toBe('12:20');
    expect(defaultStartTime({ now: new Date('2026-10-11T23:20:00Z'), timezone: 'Europe/Lisbon', durationMinutes: 60 })).toBe('00:00');
  });

  it('turns a date and time into an instant and refuses future or impossible times', () => {
    const now = new Date('2026-10-11T12:00:00Z');
    expect(startInstant({ localDate: '2026-10-10', startTime: '19:00', timezone: 'Europe/Lisbon', now }))
      .toEqual({ occurredAt: '2026-10-10T18:00:00.000Z' });
    expect(startInstant({ localDate: '2026-10-11', startTime: '13:30', timezone: 'Europe/Lisbon', now }))
      .toEqual({ error: 'log.futureStart' });
    expect(startInstant({ localDate: '2026-03-29', startTime: '01:30', timezone: 'Europe/Lisbon', now }))
      .toEqual({ error: 'coach.nonexistentTime' });
    expect(startInstant({ localDate: '2026-10-10', startTime: '', timezone: 'UTC', now }))
      .toEqual({ error: 'coach.invalidDateTime' });
  });
});
