import { AppError, toAppError } from './errors.js';
import { normalizeMetric } from './statistics-state.js';

function invalid(code, message) {
  throw new AppError('validation', code, message);
}

function requireDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) invalid('invalid_date_range', 'Enter a valid statistics date range.');
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) {
    invalid('invalid_date_range', 'Enter a valid statistics date range.');
  }
  return value;
}

function requireRange(start, endExclusive) {
  const normalizedStart = requireDate(start);
  const normalizedEnd = requireDate(endExclusive);
  if (normalizedStart >= normalizedEnd) {
    invalid('invalid_date_range', 'Enter a valid statistics date range.');
  }
  return { start: normalizedStart, endExclusive: normalizedEnd };
}

function requireText(value, code, message) {
  const text = String(value ?? '').trim();
  if (!text) invalid(code, message);
  return text;
}

export function createStatisticsService(client) {
  async function call(name, params) {
    const result = await client.rpc(name, params);
    if (result.error) throw toAppError(result.error);
    return result.data;
  }

  return {
    async getPersonal({ start, endExclusive, timezone }) {
      const range = requireRange(start, endExclusive);
      return call('get_personal_training_statistics', {
        range_start: range.start,
        range_end_exclusive: range.endExclusive,
        timezone: requireText(timezone, 'invalid_timezone', 'Choose a valid timezone.'),
      });
    },
    async getGroup({ groupId, start, endExclusive, metric }) {
      const range = requireRange(start, endExclusive);
      return call('get_group_training_leaderboard', {
        group_id: requireText(groupId, 'invalid_group', 'Choose a group.'),
        range_start: range.start,
        range_end_exclusive: range.endExclusive,
        metric: normalizeMetric(metric),
      });
    },
    async searchMembers({ groupId, search = '', limit = 20, offset = 0 }) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100
        || !Number.isInteger(offset) || offset < 0) {
        invalid('invalid_pagination', 'Choose a valid member result page.');
      }
      return call('list_shared_group_members', {
        group_id: requireText(groupId, 'invalid_group', 'Choose a group.'),
        search_text: String(search ?? '').trim(),
        result_limit: limit,
        result_offset: offset,
      });
    },
  };
}
