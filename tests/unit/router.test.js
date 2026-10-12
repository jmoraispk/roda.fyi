// tests/unit/router.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createRouter, isDetail, parseRoute, tabFor } from '../../src/app/shell/router.js';

describe('router', () => {
  it.each([
    ['', 'today', {}],
    ['#/', 'today', {}],
    ['#/calendar', 'calendar', { month: null, day: null }],
    ['#/calendar/2026-10', 'calendar', { month: '2026-10', day: null }],
    ['#/calendar/2026-10-09', 'calendar', { month: '2026-10', day: '09' }],
    ['#/log', 'log', {}],
    ['#/training/abc-123', 'training', { id: 'abc-123' }],
    ['#/class/s1', 'class', { id: 's1' }],
    ['#/discover', 'discover', {}],
    ['#/person/p1', 'person', { id: 'p1' }],
    ['#/group/g1', 'group', { id: 'g1' }],
    ['#/me', 'me', {}],
    ['#/me/settings', 'me-section', { section: 'settings' }],
    ['#/me/teaching/plans/x', 'teaching-plan', { id: 'x' }],
    ['#/me/teaching/students/y', 'teaching-student', { id: 'y' }],
    ['#/welcome', 'welcome', {}],
    ['#/training/abc?from=today', 'training', { id: 'abc' }],
  ])('parses %s', (hash, name, params) => {
    expect(parseRoute(hash)).toMatchObject({ name, params });
  });

  it('sends unknown routes to Today', () => {
    expect(parseRoute('#/nope/../x')).toMatchObject({ name: 'today', redirected: true });
    expect(parseRoute('#/training/')).toMatchObject({ name: 'today', redirected: true });
  });

  it('maps routes to tabs and detail pages', () => {
    expect(tabFor(parseRoute('#/'))).toBe('today');
    expect(tabFor(parseRoute('#/person/p'))).toBe('discover');
    expect(tabFor(parseRoute('#/me/settings'))).toBe('me');
    expect(tabFor(parseRoute('#/training/t'))).toBeNull();
    expect(isDetail(parseRoute('#/training/t'))).toBe(true);
    expect(isDetail(parseRoute('#/calendar'))).toBe(false);
  });

  it('notifies on start and hash changes and rewrites unknown hashes', async () => {
    window.location.hash = '#/nope';
    const onRoute = vi.fn();
    const router = createRouter({ window, onRoute });
    router.start();
    expect(onRoute).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'today' }));
    expect(window.location.hash).toBe('#/');
    router.navigate('/calendar');
    await vi.waitFor(() => expect(onRoute).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'calendar' })));
    const before = onRoute.mock.calls.length;
    router.navigate('/calendar');
    expect(onRoute).toHaveBeenCalledTimes(before + 1);
    router.stop();
  });

  it('goes back inside the app only, otherwise to the fallback', async () => {
    window.location.hash = '#/';
    await new Promise((resolve) => setTimeout(resolve, 0));
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const router = createRouter({ window, onRoute: () => {} });
    router.start();
    router.back('/me');
    expect(back).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/me');
    router.navigate('/calendar');
    router.back('/me');
    expect(back).toHaveBeenCalledTimes(1);
    router.stop();
    back.mockRestore();
  });

  it('parses the query and the record route', () => {
    expect(parseRoute('#/training/abc?add=1')).toMatchObject({ name: 'training', params: { id: 'abc' }, query: { add: '1' } });
    expect(parseRoute('#/me/teaching/record')).toMatchObject({ name: 'teaching-record', query: {} });
    expect(tabFor(parseRoute('#/me/teaching/record'))).toBe('me');
    expect(isDetail(parseRoute('#/me/teaching/record'))).toBe(true);
    expect(isDetail(parseRoute('#/welcome'))).toBe(true);
  });

  it('replaces the current entry without adding history', () => {
    window.location.hash = '#/me/teaching';
    const onRoute = vi.fn();
    const router = createRouter({ window, onRoute });
    const before = window.history.length;
    router.replace('/me');
    expect(window.location.hash).toBe('#/me');
    expect(window.history.length).toBe(before);
    expect(onRoute).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'me' }));
  });
});
