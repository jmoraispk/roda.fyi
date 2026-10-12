// tests/unit/today-state.test.js
import { describe, expect, it } from 'vitest';

import { clipText, nowNextCard, weekDays } from '../../src/app/screens/today-state.js';

const now = new Date('2026-10-11T18:00:00Z');

describe('today state', () => {
  it('lists the Monday-first week containing today', () => {
    expect(weekDays('2026-10-11').map(({ date }) => date)).toEqual([
      '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11',
    ]);
    expect(weekDays('2026-10-11').find(({ isToday }) => isToday).day).toBe(11);
    expect(weekDays('2026-10-05')[0].date).toBe('2026-10-05');
  });

  it('clips long text to one line', () => {
    expect(clipText('a'.repeat(200))).toHaveLength(120);
    expect(clipText('a'.repeat(200)).endsWith('…')).toBe(true);
    expect(clipText('short')).toBe('short');
    expect(clipText(null)).toBe('');
  });

  it('asks a coach to finish a class that ended within 12 hours', () => {
    const item = { item_id: 's1', item_type: 'scheduled', status: 'scheduled', coach_profile_id: 'me',
      starts_at: '2026-10-11T15:00:00Z', duration_minutes: 60, local_date: '2026-10-11' };
    expect(nowNextCard({ calendarItems: [item], recent: [], profileId: 'me', now })).toEqual({ type: 'finish', item });
    const old = { ...item, starts_at: '2026-10-10T04:00:00Z' };
    expect(nowNextCard({ calendarItems: [old], recent: [], profileId: 'me', now })).toBeNull();
  });

  it('asks how a recent class went when it is not rated', () => {
    const training = { occurrence_id: 'o1', role: 'participant', kind: 'group', occurred_at: '2026-10-11T10:00:00Z', has_rating: false };
    expect(nowNextCard({ calendarItems: [], recent: [training], profileId: 'me', now })).toEqual({ type: 'rate', training });
    expect(nowNextCard({ calendarItems: [], recent: [{ ...training, has_rating: true }], profileId: 'me', now })).toBeNull();
    expect(nowNextCard({ calendarItems: [], recent: [{ ...training, kind: 'alone' }], profileId: 'me', now })).toBeNull();
  });

  it('shows the next class today or tomorrow', () => {
    const later = { item_id: 's2', item_type: 'scheduled', status: 'scheduled', coach_profile_id: 'other',
      starts_at: '2026-10-12T17:00:00Z', duration_minutes: 60, local_date: '2026-10-12' };
    const sooner = { ...later, item_id: 's3', starts_at: '2026-10-11T19:00:00Z', local_date: '2026-10-11', coach_profile_id: 'me' };
    const farAway = { ...later, item_id: 's4', starts_at: '2026-10-20T17:00:00Z', local_date: '2026-10-20' };
    expect(nowNextCard({ calendarItems: [later, sooner, farAway], recent: [], profileId: 'me', now }))
      .toEqual({ type: 'next', item: sooner, teaching: true });
    expect(nowNextCard({ calendarItems: [farAway], recent: [], profileId: 'me', now })).toBeNull();
  });

  it('uses the person own date, not the UTC date', () => {
    const late = new Date('2026-10-12T00:30:00Z');
    const tonight = { item_id: 's5', item_type: 'scheduled', status: 'scheduled', coach_profile_id: 'x',
      starts_at: '2026-10-12T00:45:00Z', duration_minutes: 60, local_date: '2026-10-11' };
    const twoDaysOut = { ...tonight, item_id: 's6', starts_at: '2026-10-13T22:00:00Z', local_date: '2026-10-13' };
    expect(nowNextCard({ calendarItems: [tonight], recent: [], profileId: 'me', now: late, todayIso: '2026-10-11' }))
      .toMatchObject({ type: 'next', item: tonight });
    expect(nowNextCard({ calendarItems: [twoDaysOut], recent: [], profileId: 'me', now: late, todayIso: '2026-10-11' }))
      .toBeNull();
  });
});
