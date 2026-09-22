import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../src/app/errors.js';
import { createStatisticsService } from '../../src/app/statistics-service.js';

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
});
