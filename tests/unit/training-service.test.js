import { describe, expect, it } from 'vitest';

import { createTrainingService } from '../../src/app/training-service.js';
import { createE2ETrainingService } from '../../src/app/testing/fake-services.js';

const ROUND = Object.freeze({
  label: 'Round one',
  movements: [{ movement_key: 'armada', movement_name: 'Armada' }],
});

function harness(results = {}) {
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

describe('training service', () => {
  it('normalizes an Alone record and creates one stable request key', async () => {
    const { client, calls } = harness();
    const service = createTrainingService(client, { randomUUID: () => 'request-uuid' });

    await service.recordAloneTraining({
      localDate: '2026-09-22', timezone: 'Europe/Lisbon',
      durationMinutes: 45, notes: '  Armada practice  ', rounds: [ROUND],
    });

    expect(calls).toEqual([['record_alone_training', {
      local_date: '2026-09-22', timezone: 'Europe/Lisbon',
      duration_minutes: 45, personal_notes: 'Armada practice', rounds: [ROUND],
      idempotency_key: 'request-uuid', occurred_at: null,
    }]]);
  });

  it('reuses a caller-owned idempotency key on completion retry', async () => {
    const { client, calls } = harness();
    const service = createTrainingService(client, { randomUUID: () => 'unused' });
    const action = {
      scheduleId: 'schedule-1', durationMinutes: 60,
      attendees: [{ profileId: 'student-1', durationMinutes: 45 }],
      idempotencyKey: 'retry-key',
    };
    await service.completeGroupTraining(action);
    await service.completeGroupTraining(action);
    expect(calls).toEqual([
      ['complete_group_training', {
        schedule_id: 'schedule-1',
        attendees: [{ profile_id: 'student-1', duration_minutes: 45 }],
        duration_minutes: 60, idempotency_key: 'retry-key',
        rounds: null, occurred_at: null,
      }],
      ['complete_group_training', {
        schedule_id: 'schedule-1',
        attendees: [{ profile_id: 'student-1', duration_minutes: 45 }],
        duration_minutes: 60, idempotency_key: 'retry-key',
        rounds: null, occurred_at: null,
      }],
    ]);
  });

  it.each([
    ['createPlan', [{ title: ' ', durationMinutes: 60, rounds: [ROUND] }], 'invalid_plan_title'],
    ['createPlan', [{ title: 'Plan', durationMinutes: 60, rounds: [] }], 'invalid_rounds'],
    ['recordAloneTraining', [{ localDate: '2026-02-30', timezone: 'UTC', durationMinutes: 30, rounds: [ROUND] }], 'invalid_local_date'],
    ['recordAloneTraining', [{ localDate: '2026-09-22', timezone: 'UTC', durationMinutes: 0, rounds: [ROUND] }], 'invalid_duration'],
    ['saveAssessment', [{ participationId: 'p-1', movementId: 'm-1', difficulty: 'impossible' }], 'invalid_difficulty'],
  ])('%s validates before calling Supabase', async (method, args, code) => {
    const { client, calls } = harness();
    await expect(createTrainingService(client)[method](...args))
      .rejects.toMatchObject({ kind: 'validation', code });
    expect(calls).toEqual([]);
  });

  it('uses stable plan, schedule, calendar, notes, assessment, and feedback contracts', async () => {
    const { client, calls } = harness();
    const service = createTrainingService(client, { randomUUID: () => 'generated-key' });
    await service.createPlan({
      title: '  Plan  ', description: '  Desc  ', groupId: 'group-1',
      durationMinutes: 60, instructions: '  Slow  ', rounds: [ROUND],
    });
    await service.schedulePersonalClass({
      planVersionId: 'version-1', studentProfileId: 'student-1',
      groupId: null, connectionId: 'connection-1',
      startsAt: '2026-09-25T18:00:00Z', localDate: '2026-09-25',
      timezone: 'Europe/Lisbon', visibleInAdvance: false,
    });
    await service.listCalendar({ start: '2026-09-01', endExclusive: '2026-10-01' });
    await service.saveNotes({ participationId: 'p-1', notes: '  Smooth  ' });
    await service.saveAssessment({
      participationId: 'p-1', movementId: 'm-1', difficulty: 'easy', note: '  Better  ',
    });
    await service.addFeedback({
      participationId: 'p-1', groupId: 'group-1', body: '  Stable base  ',
    });
    expect(calls).toEqual([
      ['create_workout_plan', {
        title: 'Plan', description: 'Desc', source_group_id: 'group-1',
        expected_duration_minutes: 60, instructions: 'Slow', rounds: [ROUND],
      }],
      ['schedule_personal_class', {
        plan_version_id: 'version-1', student_profile_id: 'student-1',
        group_id: null, connection_id: 'connection-1',
        starts_at: '2026-09-25T18:00:00Z', local_date: '2026-09-25',
        timezone: 'Europe/Lisbon', visible_in_advance: false,
      }],
      ['list_training_calendar', {
        month_start: '2026-09-01', month_end: '2026-10-01', profile_id: null,
      }],
      ['save_training_notes', { participation_id: 'p-1', personal_notes: 'Smooth' }],
      ['save_training_assessment', {
        participation_id: 'p-1', occurrence_movement_id: 'm-1',
        difficulty: 'easy', note: 'Better',
      }],
      ['add_training_feedback', {
        participation_id: 'p-1', group_id: 'group-1',
        connection_id: null, body: 'Stable base',
      }],
    ]);
  });

  it('maps Supabase failures to application errors', async () => {
    const { client } = harness({
      list_training_calendar: {
        data: null, error: { code: 'PT403', message: 'not_authorized' },
      },
    });
    await expect(createTrainingService(client).listCalendar({
      start: '2026-09-01', endExclusive: '2026-10-01',
    })).rejects.toMatchObject({ kind: 'authorization', code: 'not_authorized' });
  });

  it('derives fake calendar summaries from persisted participation without duplicates', async () => {
    const values = new Map([
      ['roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1' } })],
    ]);
    const window = {
      __RODA_E2E_EVENTS__: [],
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
      },
    };
    const service = createE2ETrainingService({ window });
    const input = {
      localDate: '2026-09-22', timezone: 'Europe/Lisbon',
      durationMinutes: 45, notes: 'Armada practice', rounds: [ROUND],
      idempotencyKey: 'same-request',
    };
    const first = await service.recordAloneTraining(input);
    const retry = await service.recordAloneTraining(input);

    expect(retry.occurrence_id).toBe(first.occurrence_id);
    expect(await service.listCalendar({
      start: '2026-09-01', endExclusive: '2026-10-01',
    })).toHaveLength(1);
    const persisted = JSON.parse(values.get('roda.e2e.trainingState'));
    expect(persisted).toMatchObject({
      occurrences: [{ idempotency_key: 'same-request' }],
      participations: [{ actual_duration_minutes: 45 }],
    });
    expect(persisted).not.toHaveProperty('totals');
  });

  it('accepts text-only rounds and rejects rounds with neither text nor movements', async () => {
    const { client, calls } = harness();
    const service = createTrainingService(client, { randomUUID: () => 'k' });
    const textRound = { source_text: 'and, e', sequence: [], movements: [], ratings: [] };
    await service.recordAloneTraining({
      localDate: '2026-10-01', timezone: 'UTC', durationMinutes: 20, rounds: [textRound],
    });
    expect(calls[0][1].rounds).toEqual([textRound]);
    await expect(service.recordAloneTraining({
      localDate: '2026-10-01', timezone: 'UTC', durationMinutes: 20,
      rounds: [{ source_text: '  ', movements: [] }],
    })).rejects.toMatchObject({ code: 'invalid_rounds' });
  });

  it('saves round ratings through one RPC', async () => {
    const { client, calls } = harness();
    const ratings = [{ segment_key: 'r', segment_kind: 'round', difficulty: 'hard' }];
    await createTrainingService(client).saveRoundAssessments({
      participationId: 'p-1', roundId: 'round-1', ratings,
    });
    expect(calls).toEqual([['save_round_assessments', {
      participation_id: 'p-1', round_id: 'round-1', ratings,
    }]]);
  });

  it.each([
    [[{ segment_key: 'r', segment_kind: 'round', difficulty: 'brutal' }], 'invalid_difficulty'],
    [[{ segment_key: '', segment_kind: 'round', difficulty: 'easy' }], 'invalid_segment'],
  ])('validates ratings before saving', async (ratings, code) => {
    const { client, calls } = harness();
    await expect(createTrainingService(client).saveRoundAssessments({
      participationId: 'p-1', roundId: 'round-1', ratings,
    })).rejects.toMatchObject({ kind: 'validation', code });
    expect(calls).toEqual([]);
  });

  it('keeps round ratings in the local fake service', async () => {
    const storage = new Map();
    const window = {
      localStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
    };
    const service = createE2ETrainingService({ window });
    const result = await service.recordAloneTraining({
      localDate: '2026-10-01', timezone: 'UTC', durationMinutes: 30, idempotencyKey: 'k1',
      rounds: [{
        source_text: 'armada, au', sequence: [], movements: [],
        ratings: [{ segment_key: 'r', segment_kind: 'round', difficulty: 'okay' }],
      }],
    });
    let [day] = await service.getDay({ localDate: '2026-10-01' });
    expect(day.rounds[0]).toMatchObject({
      source_text: 'armada, au',
      ratings: [{ segment_key: 'r', segment_kind: 'round', difficulty: 'okay' }],
      planned: [],
    });
    await service.saveRoundAssessments({
      participationId: result.participation_id, roundId: day.rounds[0].id,
      ratings: [{ segment_key: 't:1>2', segment_kind: 'transition', difficulty: 'hard' }],
    });
    [day] = await service.getDay({ localDate: '2026-10-01' });
    expect(day.rounds[0].ratings.map(({ segment_key: key }) => key)).toEqual(['t:1>2']);
  });

  it('uses stable resource and past-class contracts', async () => {
    const { client, calls } = harness();
    const service = createTrainingService(client, { randomUUID: () => 'past-key' });
    await service.addResource({ occurrenceId: 'o-1', kind: 'video', title: ' Rec ', url: ' https://youtu.be/x ' });
    await service.addResource({ occurrenceId: 'o-1', kind: 'summary', body: '# Notes' });
    await service.updateResource({ resourceId: 'r-1', title: '', body: 'Updated', kind: 'voice' });
    await service.deleteResource('r-1');
    await service.listResourceKinds({ start: '2026-09-01', endExclusive: '2026-10-01' });
    await service.recordPastClass({
      kind: 'group', groupId: 'g-1', occurredAt: '2026-09-11T13:14:14Z', localDate: '2026-09-11',
      timezone: 'Europe/Lisbon', durationMinutes: 77,
      attendees: [{ profileId: 's-1', durationMinutes: 77 }], rounds: null,
    }, new Date('2026-10-10T00:00:00Z'));
    expect(calls).toEqual([
      ['add_training_resource', { occurrence_id: 'o-1', kind: 'video', title: 'Rec', url: 'https://youtu.be/x', body: null }],
      ['add_training_resource', { occurrence_id: 'o-1', kind: 'summary', title: null, url: null, body: '# Notes' }],
      ['update_training_resource', { resource_id: 'r-1', title: null, url: null, body: 'Updated' }],
      ['delete_training_resource', { resource_id: 'r-1' }],
      ['list_training_resource_kinds', { month_start: '2026-09-01', month_end: '2026-10-01', profile_id: null }],
      ['record_past_class', {
        kind: 'group', group_id: 'g-1', student_profile_id: null, connection_id: null,
        occurred_at: '2026-09-11T13:14:14Z', local_date: '2026-09-11', timezone: 'Europe/Lisbon',
        duration_minutes: 77, attendees: [{ profile_id: 's-1', duration_minutes: 77 }],
        rounds: null, idempotency_key: 'past-key',
      }],
    ]);
  });

  it.each([
    [{ occurrenceId: 'o', kind: 'photo', body: 'x' }, 'invalid_resource_kind'],
    [{ occurrenceId: 'o', kind: 'video', url: 'http://x.test' }, 'invalid_resource_url'],
    [{ occurrenceId: 'o', kind: 'video', url: `https://${'a'.repeat(2050)}` }, 'invalid_resource_url'],
    [{ occurrenceId: 'o', kind: 'summary', body: '   ' }, 'invalid_resource_body'],
    [{ occurrenceId: 'o', kind: 'voice', body: 'x'.repeat(262145) }, 'invalid_resource_body'],
    [{ occurrenceId: 'o', kind: 'voice', body: 'x', title: 't'.repeat(201) }, 'invalid_resource_title'],
  ])('validates resources %#', async (input, code) => {
    const { client, calls } = harness();
    await expect(createTrainingService(client).addResource(input)).rejects.toMatchObject({ code });
    expect(calls).toEqual([]);
  });

  it('rejects future past classes before calling Supabase', async () => {
    const { client, calls } = harness();
    await expect(createTrainingService(client).recordPastClass({
      kind: 'group', groupId: 'g', occurredAt: '2026-10-11T00:00:00Z', localDate: '2026-10-11',
      timezone: 'UTC', durationMinutes: 30, attendees: [{ profileId: 's', durationMinutes: 30 }],
    }, new Date('2026-10-10T00:00:00Z'))).rejects.toMatchObject({ code: 'past_class_in_future' });
    expect(calls).toEqual([]);
  });

  it('records past classes and keeps resources in the local fake service', async () => {
    const values = new Map([['roda.e2e.session', JSON.stringify({ user: { id: 'coach-1' } })]]);
    const window = { localStorage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) } };
    const service = createE2ETrainingService({ window });
    const result = await service.recordPastClass({
      kind: 'group', groupId: 'g-1', occurredAt: '2026-09-11T13:14:14Z', localDate: '2026-09-11',
      timezone: 'Europe/Lisbon', durationMinutes: 77, idempotencyKey: 'past-1',
      attendees: [{ profileId: 'student-1', durationMinutes: 77 }], rounds: [],
    });
    expect((await service.recordPastClass({
      kind: 'group', groupId: 'g-1', occurredAt: '2026-09-11T13:14:14Z', localDate: '2026-09-11',
      timezone: 'Europe/Lisbon', durationMinutes: 77, idempotencyKey: 'past-1', attendees: [],
    })).occurrence_id).toBe(result.occurrence_id);
    const added = await service.addResource({
      occurrenceId: result.occurrence_id, kind: 'video', url: 'https://youtu.be/x',
    });
    expect(await service.listResourceKinds({
      start: '2026-09-01', endExclusive: '2026-10-01', profileId: 'student-1',
    })).toEqual([{ occurrence_id: result.occurrence_id, kinds: ['video'] }]);
    await service.deleteResource(added.resource_id);
    expect(await service.listResourceKinds({
      start: '2026-09-01', endExclusive: '2026-10-01', profileId: 'student-1',
    })).toEqual([]);
  });
});
