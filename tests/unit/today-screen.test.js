// tests/unit/today-screen.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { renderToday } from '../../src/app/screens/today.js';

function ctx(training) {
  return {
    document, i18n: createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } }),
    profile: { id: 'me', display_name: 'Ana Silva' }, timezone: 'UTC',
    services: { training }, navigate: vi.fn(), today: () => '2026-10-11', now: () => new Date('2026-10-11T12:00:00Z'),
  };
}

describe('today screen', () => {
  it('renders the week strip, the next card, and recent trainings', async () => {
    const training = {
      listMyCalendar: vi.fn().mockResolvedValue([
        { item_id: 'o9', item_type: 'completed', status: 'completed', kind: 'alone', local_date: '2026-10-09', starts_at: '2026-10-09T07:00:00Z', duration_minutes: 45 },
        { item_id: 's1', item_type: 'scheduled', status: 'scheduled', kind: 'group', local_date: '2026-10-11', starts_at: '2026-10-11T19:00:00Z', duration_minutes: 60, group_name: 'Grupo Lua', coach_profile_id: 'me', plan_title: 'Armada ladder' },
      ]),
      listRecentTrainings: vi.fn().mockResolvedValue([{
        occurrence_id: 'o9', kind: 'alone', local_date: '2026-10-09', occurred_at: '2026-10-09T07:00:00Z',
        duration_minutes: 45, role: 'participant', first_round_text: `${'armada, '.repeat(30)}au`, felt: 'okay',
        has_rating: true, resource_kinds: ['video'], attendee_count: 1,
      }]),
    };
    const context = ctx(training);
    const view = await renderToday(context);
    expect(training.listMyCalendar).toHaveBeenCalledWith({ start: '2026-10-05', endExclusive: '2026-10-13' });
    expect(view.querySelectorAll('.week-day')).toHaveLength(7);
    expect(view.querySelector('.week-day[aria-current="date"]').textContent).toContain('11');
    expect(view.querySelector('[data-day="2026-10-09"] .week-dot')).not.toBeNull();
    const card = view.querySelector('.now-card');
    expect(card.textContent).toContain('Grupo Lua');
    expect(card.textContent).toContain('You teach');
    const recent = view.querySelector('.recent-card');
    expect(recent.querySelector('.recent-text').textContent.length).toBeLessThanOrEqual(120);
    expect(recent.querySelector('.resource-icons').textContent).toBe('🎥');
    expect(recent.querySelector('.felt').textContent).toBe('felt Okay');
    recent.click();
    expect(context.navigate).toHaveBeenCalledWith('/training/o9');
    view.querySelector('[data-day="2026-10-09"]').click();
    expect(context.navigate).toHaveBeenCalledWith('/calendar/2026-10-09');
  });

  it('explains the empty state', async () => {
    const view = await renderToday(ctx({ listMyCalendar: vi.fn().mockResolvedValue([]), listRecentTrainings: vi.fn().mockResolvedValue([]) }));
    expect(view.textContent).toContain('Nothing logged yet. Tap + to log your first training.');
    expect(view.querySelector('.now-card')).toBeNull();
  });

  it('shows a retry when loading fails', async () => {
    const training = { listMyCalendar: vi.fn().mockRejectedValue(new Error('offline')), listRecentTrainings: vi.fn().mockResolvedValue([]) };
    const view = await renderToday(ctx(training));
    expect(view.textContent).toContain('offline');
    expect(view.querySelector('button[data-action="retry"]')).not.toBeNull();
  });
});
