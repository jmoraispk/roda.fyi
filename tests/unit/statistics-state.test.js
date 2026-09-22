import { describe, expect, it } from 'vitest';

import {
  formatDuration,
  formatRankValue,
  normalizeMetric,
  normalizePeriod,
  statisticsRange,
} from '../../src/app/statistics-state.js';

describe('statistics state', () => {
  it('calculates Monday-based week, month, year, and all-time ranges', () => {
    expect(statisticsRange('week', '2026-09-22', 'Europe/Lisbon')).toEqual({
      start: '2026-09-21', endExclusive: '2026-09-28',
    });
    expect(statisticsRange('month', '2026-09-22', 'Europe/Lisbon')).toEqual({
      start: '2026-09-01', endExclusive: '2026-10-01',
    });
    expect(statisticsRange('year', '2026-09-22', 'Europe/Lisbon')).toEqual({
      start: '2026-01-01', endExclusive: '2027-01-01',
    });
    expect(statisticsRange('all', '2026-09-22', 'Europe/Lisbon')).toEqual({
      start: '1900-01-01', endExclusive: '2026-09-23',
    });
  });

  it('uses a supplied instant in the requested timezone', () => {
    expect(statisticsRange('week', new Date('2026-09-21T00:30:00Z'), 'America/Los_Angeles'))
      .toEqual({ start: '2026-09-14', endExclusive: '2026-09-21' });
  });

  it('defaults invalid selectors without exposing the deferred combined metric', () => {
    expect(normalizePeriod('quarter')).toBe('month');
    expect(normalizeMetric('combined')).toBe('time');
    expect(normalizePeriod('week')).toBe('week');
    expect(normalizeMetric('sessions')).toBe('sessions');
  });

  it('formats durations and selected ranking metrics', () => {
    expect(formatDuration(211)).toBe('3h 31m');
    expect(formatDuration(180)).toBe('3h');
    expect(formatDuration(0)).toBe('0m');
    expect(formatRankValue({ metric: 'time', totalMinutes: 211, sessionCount: 4 }, 'en'))
      .toBe('3h 31m');
    expect(formatRankValue({ metric: 'sessions', totalMinutes: 211, sessionCount: 4 }, 'en'))
      .toBe('4 trainings');
    expect(formatRankValue({ metric: 'sessions', totalMinutes: 45, sessionCount: 1 }, 'pt'))
      .toBe('1 treino');
  });
});
