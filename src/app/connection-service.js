import { toAppError } from './errors.js';

function clean(value) {
  return typeof value === 'string' ? value.trim() : value;
}

export function createConnectionService(client) {
  async function call(name, params = {}) {
    const result = await client.rpc(name, params);
    if (result.error) throw toAppError(result.error);
    return result.data;
  }

  return {
    searchCandidates(searchText = '', candidateRole = 'coach', resultLimit = 20) {
      return call('search_coaching_profiles', {
        search_text: clean(searchText),
        candidate_role: candidateRole,
        result_limit: resultLimit,
      });
    },
    listMine() {
      return call('list_my_coach_connections');
    },
    request(coachProfileId, studentProfileId) {
      return call('request_coach_connection', {
        coach_profile_id: coachProfileId,
        student_profile_id: studentProfileId,
      });
    },
    decide(connectionId, decision) {
      return call('decide_coach_connection', {
        connection_id: connectionId,
        decision,
      });
    },
    end(connectionId) {
      return call('end_coach_connection', { connection_id: connectionId });
    },
  };
}
