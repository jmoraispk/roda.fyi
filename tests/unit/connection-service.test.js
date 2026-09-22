import { describe, expect, it } from 'vitest';

import { createConnectionService } from '../../src/app/connection-service.js';

function clientHarness(results = {}) {
  const calls = [];
  return {
    calls,
    client: {
      rpc: async (name, params = {}) => {
        calls.push([name, params]);
        return results[name] ?? { data: { status: 'ok' }, error: null };
      },
    },
  };
}

describe('connection service', () => {
  it('normalizes searches and returns only RPC data', async () => {
    const results = [{ profile_id: 'coach-1', display_name: 'Mestre Lua' }];
    const { client, calls } = clientHarness({
      search_coaching_profiles: { data: results, error: null },
    });
    const service = createConnectionService(client);

    expect(await service.searchCandidates('  Mestre Lua  ', 'coach')).toEqual(results);
    expect(calls[0]).toEqual(['search_coaching_profiles', {
      search_text: 'Mestre Lua', candidate_role: 'coach', result_limit: 20,
    }]);
  });

  it.each([
    ['listMine', [], 'list_my_coach_connections', {}],
    ['request', ['coach-1', 'student-1'], 'request_coach_connection', {
      coach_profile_id: 'coach-1', student_profile_id: 'student-1',
    }],
    ['decide', ['connection-1', 'accepted'], 'decide_coach_connection', {
      connection_id: 'connection-1', decision: 'accepted',
    }],
    ['end', ['connection-1'], 'end_coach_connection', {
      connection_id: 'connection-1',
    }],
  ])('%s uses the stable RPC contract', async (method, args, rpc, params) => {
    const { client, calls } = clientHarness();
    await createConnectionService(client)[method](...args);
    expect(calls).toEqual([[rpc, params]]);
  });

  it('normalizes Supabase authorization errors', async () => {
    const { client } = clientHarness({
      list_my_coach_connections: {
        data: null,
        error: { code: 'PT403', message: 'not_authorized' },
      },
    });
    await expect(createConnectionService(client).listMine())
      .rejects.toMatchObject({ kind: 'authorization', code: 'not_authorized' });
  });
});
