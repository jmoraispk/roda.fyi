import { describe, expect, it } from 'vitest';

import {
  calendarGrid,
  createCalendarState,
  localDateFromInstant,
  mondayWeekBounds,
  monthBounds,
  reduceCalendarState,
  shiftMonth,
} from '../../src/app/training-calendar-state.js';

describe('training calendar state', () => {
  it('builds Monday-first six-week grids, including leap day', () => {
    const march = calendarGrid('2026-03', { weekStartsOn: 1 });
    expect(march).toHaveLength(42);
    expect(march[0]).toMatchObject({ date: '2026-02-23', inMonth: false });
    expect(march[41]).toMatchObject({ date: '2026-04-05', inMonth: false });
    expect(calendarGrid('2028-02').some(({ date }) => date === '2028-02-29')).toBe(true);
  });

  it('returns explicit month and Monday-week boundaries', () => {
    expect(monthBounds('2026-12')).toEqual({
      start: '2026-12-01', endExclusive: '2027-01-01',
    });
    expect(mondayWeekBounds('2026-03-09', 'America/Los_Angeles')).toEqual({
      start: '2026-03-09', endExclusive: '2026-03-16',
    });
    expect(mondayWeekBounds('2026-03-08', 'America/Los_Angeles')).toEqual({
      start: '2026-03-02', endExclusive: '2026-03-09',
    });
  });

  it('converts instants at DST boundaries using the requested zone', () => {
    expect(localDateFromInstant('2026-11-01T08:30:00Z', 'America/Los_Angeles'))
      .toBe('2026-11-01');
    expect(localDateFromInstant('2026-03-08T07:30:00Z', 'America/Los_Angeles'))
      .toBe('2026-03-07');
  });

  it('shifts months across year boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('retains a selected day and suppresses stale month responses', () => {
    let state = createCalendarState({
      visibleMonth: '2026-09', selectedDate: '2026-09-22',
    });
    state = reduceCalendarState(state, {
      type: 'MONTH_LOAD_STARTED', visibleMonth: '2026-10', token: 2,
    });
    const stale = reduceCalendarState(state, {
      type: 'MONTH_LOAD_SUCCEEDED', token: 1,
      items: [{ local_date: '2026-09-22', kind: 'alone' }],
    });
    expect(stale).toBe(state);
    state = reduceCalendarState(state, {
      type: 'MONTH_LOAD_SUCCEEDED', token: 2,
      items: [{ local_date: '2026-10-03', kind: 'group' }],
    });
    expect(state).toMatchObject({
      visibleMonth: '2026-10', selectedDate: '2026-09-22', error: null,
    });
    expect(state.summaryByDate.get('2026-10-03')).toHaveLength(1);
  });

  it('clears private details while preserving the persisted visible month', () => {
    const state = reduceCalendarState({
      ...createCalendarState({ visibleMonth: '2026-09' }),
      selectedDate: '2026-09-22', dayDetail: [{ id: 'private' }],
    }, { type: 'CLEAR_PRIVATE' });
    expect(state).toMatchObject({
      visibleMonth: '2026-09', selectedDate: null, dayDetail: null,
    });
  });
});
