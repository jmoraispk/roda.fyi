// tests/unit/calendar-screen.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { renderCalendar } from '../../src/app/screens/calendar.js';
import { openSheet } from '../../src/app/shell/sheet.js';

function ctx(training) {
  return {
    document, i18n: createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } }),
    profile: { id: 'me' }, timezone: 'UTC', services: { training }, navigate: vi.fn(),
    today: () => '2026-10-11', openSheet: (options) => openSheet({ document, ...options }),
  };
}

const items = [
  { item_id: 'o1', item_type: 'completed', status: 'completed', kind: 'group', local_date: '2026-10-09', starts_at: '2026-10-09T19:00:00Z',
    duration_minutes: 86, group_name: 'Grupo Lua', role: 'participant', resource_kinds: ['summary', 'video'] },
  { item_id: 'o2', item_type: 'completed', status: 'completed', kind: 'alone', local_date: '2026-10-09', starts_at: '2026-10-09T07:30:00Z',
    duration_minutes: 45, role: 'participant', resource_kinds: [] },
  { item_id: 's1', item_type: 'scheduled', status: 'scheduled', kind: 'group', local_date: '2026-10-15', starts_at: '2026-10-15T19:00:00Z',
    duration_minutes: 60, coach_profile_id: 'other', role: 'participant', resource_kinds: [] },
  { item_id: 's2', item_type: 'scheduled', status: 'scheduled', kind: 'personal_class', local_date: '2026-10-16', starts_at: '2026-10-16T19:00:00Z',
    duration_minutes: 60, coach_profile_id: 'me', role: 'coach', student_name: 'Bia Santos', resource_kinds: [] },
];

describe('calendar screen', () => {
  it('shows the full month with typed dots and opens a day sheet', async () => {
    const training = { listMyCalendar: vi.fn().mockResolvedValue(items) };
    const context = ctx(training);
    const view = await renderCalendar(context, { name: 'calendar', params: { month: null, day: null } });
    document.body.replaceChildren(view);
    expect(view.querySelector('h1').textContent).toBe('October 2026');
    expect(view.querySelectorAll('.cal-day')).toHaveLength(35);
    expect(view.querySelectorAll('[data-date="2026-10-09"] .cal-dot')).toHaveLength(2);
    expect(view.querySelector('[data-date="2026-10-15"] .cal-dot.upcoming')).not.toBeNull();
    expect(view.querySelector('[data-date="2026-10-11"]').getAttribute('aria-current')).toBe('date');
    view.querySelector('[data-date="2026-10-09"]').click();
    const sheet = document.querySelector('[role="dialog"]');
    expect(sheet.getAttribute('aria-label')).toContain('October 9');
    expect(sheet.querySelectorAll('.day-item')).toHaveLength(2);
    expect(sheet.querySelectorAll('.day-item')[1].querySelector('.resource-icons').textContent).toBe('🎥📄');
    sheet.querySelector('.day-item').click();
    expect(context.navigate).toHaveBeenCalledWith('/training/o2');
  });

  it('opens the requested day and moves between months', async () => {
    const training = { listMyCalendar: vi.fn().mockResolvedValue(items) };
    const context = ctx(training);
    const view = await renderCalendar(context, { name: 'calendar', params: { month: '2026-10', day: '09' } });
    document.body.replaceChildren(view);
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    view.querySelector('button[aria-label="Next month"]').click();
    expect(context.navigate).toHaveBeenCalledWith('/calendar/2026-11');
  });

  it('opens the class page for a class I teach', async () => {
    const context = ctx({ listMyCalendar: vi.fn().mockResolvedValue(items) });
    const view = await renderCalendar(context, { name: 'calendar', params: { month: null, day: null } });
    document.body.replaceChildren(view);
    view.querySelector('[data-date="2026-10-16"]').click();
    expect(document.querySelector('[role="dialog"] .day-item strong').textContent).toBe('Personal class · with Bia Santos');
    document.querySelector('[role="dialog"] .day-item').click();
    expect(context.navigate).toHaveBeenCalledWith('/class/s2');
  });
});
