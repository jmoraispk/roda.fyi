// src/app/screens/start-time.js
import { scheduledInstant } from '../time-zones.js';

export function localClock(date, timezone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
}

// Ruling R11: "I just finished" — now minus the duration, rounded down to
// five minutes, and never before midnight of today.
export function defaultStartTime({ now, timezone, durationMinutes }) {
  const [hours, minutes] = localClock(now, timezone).split(':').map(Number);
  const start = Math.max(0, hours * 60 + minutes - (Number(durationMinutes) || 0));
  const rounded = start - (start % 5);
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
}

export function startInstant({ localDate, startTime, timezone, now }) {
  let occurredAt;
  try {
    occurredAt = scheduledInstant(localDate, startTime, timezone);
  } catch (error) {
    return { error: String(error?.message).includes('does not exist') ? 'coach.nonexistentTime' : 'coach.invalidDateTime' };
  }
  if (new Date(occurredAt) > now) return { error: 'log.futureStart' };
  return { occurredAt };
}
