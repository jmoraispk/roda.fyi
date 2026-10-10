import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../src/app/errors.js';
import { createStatisticsService } from '../../src/app/statistics-service.js';
import { createE2EStatisticsService } from '../../src/app/testing/fake-services.js';

function client(responses = {}) {
  return {
    rpc: vi.fn(async (name) => responses[name] ?? { data: [], error: null }),
  };
}

describe('statistics service', () => {
  it('calls personal, group, and safe member RPCs with exact parameters', async () => {
    const api = client({
      get_personal_training_statistics: { data: { total_minutes: 211 }, error: null },
      get_group_training_leaderboard: { data: [{ profile_id: 'student-1' }], error: null },
      list_shared_group_members: { data: [{ profile_id: 'student-1' }], error: null },
    });
    const service = createStatisticsService(api);

    await expect(service.getPersonal({
      start: '2026-09-01', endExclusive: '2026-10-01', timezone: 'Europe/Lisbon',
    })).resolves.toEqual({ total_minutes: 211 });
    await expect(service.getGroup({
      groupId: 'group-1', start: '2026-09-01', endExclusive: '2026-10-01',
      metric: 'sessions',
    })).resolves.toEqual([{ profile_id: 'student-1' }]);
    await expect(service.searchMembers({
      groupId: 'group-1', search: ' ana ', limit: 10, offset: 20,
    })).resolves.toEqual([{ profile_id: 'student-1' }]);

    expect(api.rpc.mock.calls).toEqual([
      ['get_personal_training_statistics', {
        range_start: '2026-09-01', range_end_exclusive: '2026-10-01',
        timezone: 'Europe/Lisbon',
      }],
      ['get_group_training_leaderboard', {
        group_id: 'group-1', range_start: '2026-09-01',
        range_end_exclusive: '2026-10-01', metric: 'sessions',
      }],
      ['list_shared_group_members', {
        group_id: 'group-1', search_text: 'ana', result_limit: 10, result_offset: 20,
      }],
    ]);
  });

  it('defaults selectors and validates dates, timezone, and pagination', async () => {
    const api = client();
    const service = createStatisticsService(api);
    await service.getGroup({
      groupId: 'group-1', start: '2026-09-01', endExclusive: '2026-10-01', metric: 'combined',
    });
    expect(api.rpc).toHaveBeenLastCalledWith('get_group_training_leaderboard',
      expect.objectContaining({ metric: 'time' }));

    await expect(service.getPersonal({
      start: 'bad', endExclusive: '2026-10-01', timezone: 'UTC',
    })).rejects.toMatchObject({ kind: 'validation' });
    await expect(service.getPersonal({
      start: '2026-09-01', endExclusive: '2026-10-01', timezone: '',
    })).rejects.toMatchObject({ kind: 'validation' });
    await expect(service.searchMembers({
      groupId: 'group-1', search: '', limit: 101, offset: 0,
    })).rejects.toMatchObject({ kind: 'validation' });
  });

  it('maps database errors into application errors', async () => {
    const api = client({
      get_group_training_leaderboard: {
        data: null, error: { code: 'PT403', message: 'not_authorized' },
      },
    });
    const service = createStatisticsService(api);
    await expect(service.getGroup({
      groupId: 'group-1', start: '2026-09-01', endExclusive: '2026-10-01', metric: 'time',
    })).rejects.toBeInstanceOf(AppError);
  });

  it('lists hardest transitions from local round ratings', async () => {
    const values = new Map([
      ['roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1' } })],
      ['roda.e2e.trainingState', JSON.stringify({
        occurrences: [{ id: 'o1', kind: 'alone', local_date: '2026-10-02', rounds: [] }],
        participations: [{ id: 'p1', occurrence_id: 'o1', profile_id: 'practitioner-1', actual_duration_minutes: 30 }],
        roundRatings: { p1: { r1: [
          { segment_key: 't:1>2', segment_kind: 'transition', difficulty: 'hard', from_movement_key: 'armada', to_movement_key: 'au' },
          { segment_key: 'r', segment_kind: 'round', difficulty: 'hard' },
        ] } },
      })],
    ]);
    const window = { localStorage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) } };
    const result = await createE2EStatisticsService({ window }).getPersonal({
      start: '2026-10-01', endExclusive: '2026-11-01', timezone: 'UTC',
    });
    expect(result.hardest_transitions).toEqual([{
      from_movement_key: 'armada', to_movement_key: 'au', from_name: 'armada', to_name: 'au',
      hard_count: 1, rating_count: 1,
    }]);
  });
});
