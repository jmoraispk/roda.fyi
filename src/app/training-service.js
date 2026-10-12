import { AppError, toAppError } from './errors.js';

const DIFFICULTIES = new Set(['easy', 'okay', 'hard']);

function clean(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function optional(value) {
  const normalized = clean(value);
  return normalized || null;
}

function invalid(code, message) {
  throw new AppError('validation', code, message);
}

function validLocalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function requireLocalDate(value) {
  if (!validLocalDate(value)) invalid('invalid_local_date', 'Enter a valid calendar date.');
  return value;
}

function requireDuration(value) {
  if (!Number.isInteger(value) || value < 1 || value > 1440) {
    invalid('invalid_duration', 'Duration must be between 1 and 1440 minutes.');
  }
  return value;
}

function requireTitle(value) {
  const title = clean(value);
  if (!title) invalid('invalid_plan_title', 'Enter a plan title.');
  return title;
}

function roundHasContent(round) {
  const hasText = typeof round?.source_text === 'string' && round.source_text.trim() !== '';
  const hasMovements = Array.isArray(round?.movements) && round.movements.length > 0;
  return hasText || hasMovements;
}

function requireRounds(rounds) {
  if (!Array.isArray(rounds) || rounds.length === 0 || !rounds.every(roundHasContent)) {
    invalid('invalid_rounds', 'Add at least one round.');
  }
  return rounds;
}

function requireRatings(ratings) {
  if (!Array.isArray(ratings)) invalid('invalid_segment', 'Choose what to rate.');
  for (const rating of ratings) {
    if (typeof rating?.segment_key !== 'string' || !rating.segment_key.trim()) {
      invalid('invalid_segment', 'Choose what to rate.');
    }
    if (!DIFFICULTIES.has(rating.difficulty)) {
      invalid('invalid_difficulty', 'Choose Easy, Okay, or Hard.');
    }
  }
  return ratings;
}

function requireTimezone(value) {
  const timezone = clean(value);
  if (!timezone) invalid('invalid_timezone', 'Choose a timezone.');
  return timezone;
}

const RESOURCE_KINDS = new Set(['video', 'voice', 'summary']);

export function normalizeResource({ kind, title = null, url = null, body = null }) {
  if (!RESOURCE_KINDS.has(kind)) invalid('invalid_resource_kind', 'Choose video, voice, or summary.');
  const cleanTitle = optional(title);
  if (cleanTitle && cleanTitle.length > 200) invalid('invalid_resource_title', 'Use a title of 200 characters or fewer.');
  if (kind === 'video') {
    const cleanUrl = clean(url) ?? '';
    if (!cleanUrl.startsWith('https://') || cleanUrl.length > 2048) {
      invalid('invalid_resource_url', 'Paste a link that starts with https://.');
    }
    return { title: cleanTitle, url: cleanUrl, body: null };
  }
  const text = typeof body === 'string' ? body : '';
  if (!text.trim() || text.length > 262144) invalid('invalid_resource_body', 'Add text up to 256 KB.');
  return { title: cleanTitle, url: null, body: text };
}

export function createTrainingService(client, options = {}) {
  const randomUUID = options.randomUUID ?? (() => globalThis.crypto.randomUUID());

  async function call(name, params = {}) {
    const result = await client.rpc(name, params);
    if (result.error) throw toAppError(result.error);
    return result.data;
  }

  function planParams(plan) {
    return {
      title: requireTitle(plan.title),
      description: optional(plan.description),
      expected_duration_minutes: requireDuration(plan.durationMinutes),
      instructions: optional(plan.instructions),
      rounds: requireRounds(plan.rounds),
    };
  }

  return {
    createIdempotencyKey() {
      return randomUUID();
    },
    async createPlan(plan) {
      return call('create_workout_plan', {
        ...planParams(plan),
        source_group_id: plan.groupId ?? null,
      });
    },
    async savePlanDraft(plan) {
      return call('save_workout_plan_draft', {
        plan_id: plan.planId,
        ...planParams(plan),
        expected_updated_at: plan.expectedUpdatedAt,
      });
    },
    async publishPlan(planId) {
      return call('publish_workout_plan', { plan_id: planId });
    },
    async listPlans(groupId = null) {
      return call('list_workout_plans', { group_id: groupId });
    },
    async scheduleGroupTraining(input) {
      return call('schedule_group_training', {
        plan_version_id: input.planVersionId,
        group_id: input.groupId,
        starts_at: input.startsAt,
        local_date: requireLocalDate(input.localDate),
        timezone: requireTimezone(input.timezone),
        visible_in_advance: input.visibleInAdvance !== false,
      });
    },
    async schedulePersonalClass(input) {
      return call('schedule_personal_class', {
        plan_version_id: input.planVersionId,
        student_profile_id: input.studentProfileId,
        group_id: input.groupId ?? null,
        connection_id: input.connectionId ?? null,
        starts_at: input.startsAt,
        local_date: requireLocalDate(input.localDate),
        timezone: requireTimezone(input.timezone),
        visible_in_advance: input.visibleInAdvance !== false,
      });
    },
    async cancelScheduledTraining(scheduleId, reason = null) {
      return call('cancel_scheduled_training', {
        schedule_id: scheduleId, reason: optional(reason),
      });
    },
    async recordAloneTraining(input) {
      return call('record_alone_training', {
        local_date: requireLocalDate(input.localDate),
        timezone: requireTimezone(input.timezone),
        duration_minutes: requireDuration(input.durationMinutes),
        personal_notes: optional(input.notes),
        rounds: requireRounds(input.rounds),
        idempotency_key: input.idempotencyKey ?? randomUUID(),
        occurred_at: input.occurredAt ?? null,
      });
    },
    async completeGroupTraining(input) {
      requireDuration(input.durationMinutes);
      const attendees = (input.attendees ?? []).map((attendee) => ({
        profile_id: attendee.profileId,
        duration_minutes: requireDuration(attendee.durationMinutes),
      }));
      if (attendees.length === 0) invalid('invalid_attendee', 'Choose at least one attendee.');
      return call('complete_group_training', {
        schedule_id: input.scheduleId,
        attendees,
        duration_minutes: input.durationMinutes,
        idempotency_key: input.idempotencyKey ?? randomUUID(),
        rounds: input.rounds ?? null,
        occurred_at: input.occurredAt ?? null,
      });
    },
    async completePersonalClass(input) {
      return call('complete_personal_class', {
        schedule_id: input.scheduleId,
        duration_minutes: requireDuration(input.durationMinutes),
        idempotency_key: input.idempotencyKey ?? randomUUID(),
        rounds: input.rounds ?? null,
        occurred_at: input.occurredAt ?? null,
      });
    },
    async saveNotes(input) {
      return call('save_training_notes', {
        participation_id: input.participationId,
        personal_notes: optional(input.notes),
      });
    },
    async saveAssessment(input) {
      if (!DIFFICULTIES.has(input.difficulty)) {
        invalid('invalid_difficulty', 'Choose Easy, Okay, or Hard.');
      }
      return call('save_training_assessment', {
        participation_id: input.participationId,
        occurrence_movement_id: input.movementId,
        difficulty: input.difficulty,
        note: optional(input.note),
      });
    },
    async saveRoundAssessments(input) {
      return call('save_round_assessments', {
        participation_id: input.participationId,
        round_id: input.roundId,
        ratings: requireRatings(input.ratings),
      });
    },
    async addFeedback(input) {
      return call('add_training_feedback', {
        participation_id: input.participationId,
        group_id: input.groupId ?? null,
        connection_id: input.connectionId ?? null,
        body: clean(input.body),
      });
    },
    async addResource(input) {
      const resource = normalizeResource(input);
      return call('add_training_resource', { occurrence_id: input.occurrenceId, kind: input.kind, ...resource });
    },
    async updateResource(input) {
      const resource = normalizeResource(input);
      return call('update_training_resource', { resource_id: input.resourceId, ...resource });
    },
    async deleteResource(resourceId) {
      return call('delete_training_resource', { resource_id: resourceId });
    },
    async listResourceKinds(input) {
      return call('list_training_resource_kinds', {
        month_start: requireLocalDate(input.start),
        month_end: requireLocalDate(input.endExclusive),
        profile_id: input.profileId ?? null,
      });
    },
    async recordPastClass(input, now = new Date()) {
      if (!(new Date(input.occurredAt) <= now)) {
        invalid('past_class_in_future', 'Choose a time that has already passed.');
      }
      const attendees = (input.attendees ?? []).map((attendee) => ({
        profile_id: attendee.profileId,
        duration_minutes: requireDuration(attendee.durationMinutes),
      }));
      return call('record_past_class', {
        kind: input.kind,
        group_id: input.groupId ?? null,
        student_profile_id: input.studentProfileId ?? null,
        connection_id: input.connectionId ?? null,
        occurred_at: input.occurredAt,
        local_date: requireLocalDate(input.localDate),
        timezone: requireTimezone(input.timezone),
        duration_minutes: requireDuration(input.durationMinutes),
        attendees,
        rounds: input.rounds ?? null,
        idempotency_key: input.idempotencyKey ?? randomUUID(),
      });
    },
    async listRecentTrainings(limit = 10) {
      return call('list_recent_trainings', { result_limit: limit });
    },
    async getTraining(occurrenceId) {
      return call('get_training', { occurrence_id: occurrenceId });
    },
    async listCalendar(input) {
      return call('list_training_calendar', {
        month_start: requireLocalDate(input.start),
        month_end: requireLocalDate(input.endExclusive),
        profile_id: input.profileId ?? null,
      });
    },
    async listMyCalendar(input) {
      return call('list_my_calendar', {
        month_start: requireLocalDate(input.start),
        month_end: requireLocalDate(input.endExclusive),
      });
    },
    async getScheduledClass(scheduleId) {
      return call('get_scheduled_class', { schedule_id: scheduleId });
    },
    async getDay(input) {
      return call('get_training_day', {
        local_date: requireLocalDate(input.localDate),
        profile_id: input.profileId ?? null,
      });
    },
  };
}
