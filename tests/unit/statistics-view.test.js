// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../src/app/errors.js';
import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { createStatisticsView } from '../../src/app/ui/statistics-view.js';

function fixture() {
  document.body.innerHTML = '<section id="trainingStatisticsPanel"></section>';
}

function i18n(locale = 'en') {
  return createDashboardI18n({
    document,
    storage: { getItem: () => locale, setItem: vi.fn() },
    navigator: { languages: [locale] },
  });
}

function personal() {
  return {
    session_count: 4,
    total_minutes: 211,
    current_streak: 3,
    average_trainings_per_week: 2.5,
    average_hours_per_month: 3.52,
    context_distribution: [
      { kind: 'alone', session_count: 2, total_minutes: 91 },
      { kind: 'group', session_count: 2, total_minutes: 120 },
    ],
    favorite_movements: [{ movement_key: 'armada', movement_name: 'Armada', session_count: 3 }],
    difficulty_trends: [{ movement_key: 'armada', movement_name: 'Armada', improving: true }],
    personal_notes: 'Never expose this accidental field',
  };
}

function leaderboard() {
  return [
    { profile_id: 'student-2', display_name: 'Bia', rank_position: 1, total_minutes: 300, session_count: 5, anonymous_member_count: 1 },
    { profile_id: 'student-3', display_name: 'Caio', rank_position: 2, total_minutes: 250, session_count: 4, anonymous_member_count: 1 },
    { profile_id: 'student-4', display_name: 'Duda', rank_position: 3, total_minutes: 220, session_count: 4, anonymous_member_count: 1 },
    { profile_id: 'practitioner-1', display_name: 'Ana Silva', rank_position: 4, total_minutes: 211, session_count: 4, anonymous_member_count: 1 },
  ];
}

function service(overrides = {}) {
  return {
    getPersonal: vi.fn().mockResolvedValue(personal()),
    getGroup: vi.fn().mockResolvedValue(leaderboard()),
    searchMembers: vi.fn().mockResolvedValue([
      { profile_id: 'student-2', display_name: 'Bia', avatar_path: 'bia.webp', graduation: null, personal_notes: 'secret' },
    ]),
    ...overrides,
  };
}

function view(api = service(), locale = 'en', onAccessRevoked = vi.fn()) {
  return createStatisticsView({
    document,
    service: api,
    i18n: i18n(locale),
    profile: { id: 'practitioner-1' },
    timezone: 'Europe/Lisbon',
    today: '2026-09-22',
    onAccessRevoked,
  });
}

describe('statistics view', () => {
  beforeEach(fixture);

  it('renders personal cards and accessible period and metric selectors', async () => {
    const api = service();
    const controller = view(api);
    await controller.loadPersonal();

    expect(document.querySelector('#trainingStatisticsPanel').textContent).toContain('3h 31m');
    expect(document.querySelector('#trainingStatisticsPanel').textContent).toContain('4 trainings');
    expect(document.querySelector('#trainingStatisticsPanel').textContent).toContain('Armada');
    expect(document.querySelector('#trainingStatisticsPanel').textContent).not.toContain('Never expose');
    expect(document.querySelector('[data-period="month"]').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-metric="time"]').getAttribute('aria-pressed')).toBe('true');

    document.querySelector('[data-period="week"]').click();
    await vi.waitFor(() => expect(api.getPersonal).toHaveBeenLastCalledWith({
      start: '2026-09-21', endExclusive: '2026-09-28', timezone: 'Europe/Lisbon',
    }));
    expect(document.querySelector('[data-period="week"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('renders a podium, complete ranking, pinned current member, and privacy note', async () => {
    const controller = view();
    await controller.setGroup('group-1');

    expect([...document.querySelectorAll('[data-podium-entry]')].map((node) => node.textContent))
      .toEqual(expect.arrayContaining([expect.stringContaining('Bia'), expect.stringContaining('Caio'), expect.stringContaining('Duda')]));
    expect(document.querySelectorAll('[data-ranking-entry]')).toHaveLength(4);
    expect(document.querySelector('[data-current-member]').textContent).toContain('Ana Silva');
    expect(document.querySelector('[data-current-member]').textContent).toContain('4');
    expect(document.querySelector('[data-anonymous-note]').textContent).toContain('1');
  });

  it('switches the group ranking between time and number of trainings', async () => {
    const api = service();
    const controller = view(api);
    await controller.setGroup('group-1');
    document.querySelector('[data-metric="sessions"]').click();

    await vi.waitFor(() => expect(api.getGroup).toHaveBeenLastCalledWith(expect.objectContaining({
      groupId: 'group-1', metric: 'sessions',
    })));
    expect(document.querySelector('[data-current-member]').textContent).toContain('4 trainings');
  });

  it('searches safe member projections without rendering extra private fields', async () => {
    const api = service();
    const controller = view(api);
    await controller.setGroup('group-1');
    const search = document.querySelector('[data-member-search]');
    search.querySelector('input').value = 'bia';
    search.requestSubmit();
    await vi.waitFor(() => expect(api.searchMembers).toHaveBeenCalledWith({
      groupId: 'group-1', search: 'bia', limit: 20, offset: 0,
    }));
    expect(document.querySelector('[data-member-results]').textContent).toContain('Bia');
    expect(document.querySelector('[data-member-results]').textContent).not.toContain('secret');
  });

  it('suppresses stale group responses after the selected group changes', async () => {
    let resolveFirst;
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    const api = service({
      getGroup: vi.fn(({ groupId }) => groupId === 'group-1'
        ? first
        : Promise.resolve([{ ...leaderboard()[0], display_name: 'New group member' }])),
    });
    const controller = view(api);
    const pending = controller.setGroup('group-1');
    await controller.setGroup('group-2');
    resolveFirst([{ ...leaderboard()[0], display_name: 'Old group member' }]);
    await pending;

    expect(document.querySelector('#trainingStatisticsPanel').textContent).toContain('New group member');
    expect(document.querySelector('#trainingStatisticsPanel').textContent).not.toContain('Old group member');
  });

  it('clears group details when access is revoked and localizes Portuguese copy', async () => {
    const onAccessRevoked = vi.fn();
    const api = service({
      getGroup: vi.fn().mockRejectedValue(new AppError('authorization', 'not_authorized')),
    });
    const controller = view(api, 'pt', onAccessRevoked);
    await controller.loadPersonal();
    await controller.setGroup('group-1');

    expect(onAccessRevoked).toHaveBeenCalledWith('group-1');
    expect(document.querySelector('#trainingStatisticsPanel').textContent).toContain('Esta semana');
    expect(document.querySelector('#trainingStatisticsPanel').textContent).toContain('4 treinos');
    expect(document.querySelector('[data-group-statistics]').textContent).not.toContain('Ana Silva');
  });

  it('shows useful empty and retryable error states', async () => {
    const api = service({
      getPersonal: vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce({
        ...personal(), session_count: 0, total_minutes: 0,
        context_distribution: [], favorite_movements: [], difficulty_trends: [],
      }),
    });
    const controller = view(api);
    await controller.loadPersonal();
    expect(document.querySelector('[data-personal-status]').textContent).toContain('try again');
    document.querySelector('[data-retry-personal]').click();
    await vi.waitFor(() => expect(api.getPersonal).toHaveBeenCalledTimes(2));
    expect(document.querySelector('[data-personal-statistics]').textContent).toContain('No training');
  });
});
