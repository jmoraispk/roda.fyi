// tests/unit/access.test.js
import { describe, expect, it } from 'vitest';

import { isTeachingRoute, listsTeaching, modeOf, plusActions, redirectFor } from '../../src/app/shell/access.js';
import { parseRoute } from '../../src/app/shell/router.js';

const done = { id: 'me', completed_at: '2026-09-11T20:00:00Z' };

describe('access rules', () => {
  it('reads the mode with Train as the fallback', () => {
    expect(modeOf({ usage_mode: 'teach' })).toBe('teach');
    expect(modeOf({ usage_mode: 'coach' })).toBe('train');
    expect(modeOf({})).toBe('train');
    expect([listsTeaching('train'), listsTeaching('both'), listsTeaching('teach')]).toEqual([false, true, true]);
  });

  it('recognizes every Teaching route', () => {
    for (const hash of ['#/me/teaching', '#/me/teaching/plans/p', '#/me/teaching/students/s', '#/me/teaching/record']) {
      expect(isTeachingRoute(parseRoute(hash))).toBe(true);
    }
    expect(isTeachingRoute(parseRoute('#/me/groups'))).toBe(false);
  });

  it('sends unfinished profiles to the welcome and finished ones away from it', () => {
    expect(redirectFor(parseRoute('#/calendar'), { profile: { id: 'me' }, isCoach: false })).toBe('/welcome');
    expect(redirectFor(parseRoute('#/welcome'), { profile: { id: 'me' }, isCoach: false })).toBeNull();
    expect(redirectFor(parseRoute('#/welcome'), { profile: done, isCoach: false })).toBe('/');
    expect(redirectFor(parseRoute('#/calendar'), { profile: done, isCoach: false })).toBeNull();
  });

  it('opens Teaching in Both and Teach, and in Train only for coaches', () => {
    const route = parseRoute('#/me/teaching/plans/p1');
    expect(redirectFor(route, { profile: { ...done, usage_mode: 'train' }, isCoach: false })).toBe('/me');
    expect(redirectFor(route, { profile: { ...done, usage_mode: 'train' }, isCoach: true })).toBeNull();
    expect(redirectFor(route, { profile: { ...done, usage_mode: 'both' }, isCoach: false })).toBeNull();
    expect(redirectFor(route, { profile: { ...done, usage_mode: 'teach' }, isCoach: false })).toBeNull();
  });

  it('decides what + offers per mode', () => {
    expect(plusActions('train')).toEqual(['log']);
    expect(plusActions('both')).toEqual(['log', 'schedule', 'record']);
    expect(plusActions('teach')).toEqual(['schedule', 'record']);
  });
});
