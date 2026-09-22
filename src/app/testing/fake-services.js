import { consumeReturnRoute } from '../return-route.js';
import { resolveTimezoneOverride } from '../profile-service.js';
import { AppError } from '../errors.js';

const SESSION_KEY = 'roda.e2e.session';

function consumeLoadFailure(storage, key, message) {
  const remaining = Number(storage.getItem(key) ?? 0);
  if (remaining <= 0) return;
  storage.setItem(key, String(remaining - 1));
  throw new AppError('network', 'network_failure', message, { retryable: true });
}

function readSession(storage) {
  try {
    return JSON.parse(storage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

export function createE2EAuthService({ window }) {
  const { localStorage: storage } = window;
  window.__RODA_E2E_EVENTS__ = [];

  const record = (event) => window.__RODA_E2E_EVENTS__.push(event);

  return {
    async signInWithGoogle(next) {
      record({ type: 'google', next });
    },

    async sendEmailLink(email, next) {
      record({ type: 'email', email, next });
    },

    async finishCallback(search) {
      const params = new URLSearchParams(search);
      if (params.get('error') === 'e2e' || params.get('code') !== 'e2e-success') {
        throw new Error('We could not complete your sign-in. Please try again.');
      }

      const session = {
        user: { id: 'practitioner-1', email: 'student@example.com' },
      };
      storage.setItem(SESSION_KEY, JSON.stringify(session));
      return {
        session,
        returnRoute: consumeReturnRoute({ search, storage }),
      };
    },

    async getSession() {
      return readSession(storage);
    },

    onAuthStateChange(listener) {
      window.__RODA_E2E_EXPIRE__ = () => {
        storage.removeItem(SESSION_KEY);
        listener('SIGNED_OUT', null);
      };
      return { unsubscribe() {} };
    },

    async signOut() {
      record({ type: 'sign-out' });
      storage.removeItem(SESSION_KEY);
      storage.removeItem('roda.dashboard.mode');
      storage.removeItem('roda.dashboard.group');
    },
  };
}

export function createE2EProfileService({ window }) {
  const { localStorage: storage } = window;
  const record = (event) => window.__RODA_E2E_EVENTS__.push(event);

  return {
    async loadProfile() {
      consumeLoadFailure(
        storage,
        'roda.e2e.failProfileLoads',
        'The profile could not be loaded.',
      );
      const saved = JSON.parse(storage.getItem('roda.e2e.profile'));
      if (saved) return saved;
      const profile = {
        id: 'practitioner-1',
        display_name: 'Capoeirista',
        avatar_path: null,
        timezone_override: null,
        leaderboard_visible: true,
        completed_at: null,
      };
      storage.setItem('roda.e2e.profile', JSON.stringify(profile));
      return profile;
    },

    async loadCoachProfile() {
      consumeLoadFailure(
        storage,
        'roda.e2e.failCoachLoads',
        'Coaching details could not be loaded.',
      );
      return JSON.parse(storage.getItem('roda.e2e.coachProfile'));
    },

    async completeProfile({ displayName, timezoneChoice, leaderboardVisible }) {
      const timezone = resolveTimezoneOverride(timezoneChoice);
      const current = JSON.parse(storage.getItem('roda.e2e.profile'));
      const profile = {
        ...current,
        display_name: displayName.trim(),
        timezone_override: timezone,
        leaderboard_visible: Boolean(leaderboardVisible),
        completed_at: '2026-09-11T20:00:00Z',
      };
      record({
        type: 'complete-profile',
        displayName: displayName.trim(),
        timezoneChoice,
        leaderboardVisible: Boolean(leaderboardVisible),
      });
      storage.setItem('roda.e2e.profile', JSON.stringify(profile));
      return { status: 'updated', profile_id: profile.id };
    },

    async uploadProfilePicture(profileId, file) {
      record({ type: 'profile-picture', profileId, name: file.name, fileType: file.type });
      return { status: 'updated', path: `${profileId}/e2e.${file.type.split('/')[1]}` };
    },

    async registerAsCoach() {
      const coachProfile = {
        profile_id: 'practitioner-1',
        activated_at: '2026-09-11T20:00:00Z',
      };
      record({ type: 'register-coach' });
      storage.setItem('roda.e2e.coachProfile', JSON.stringify(coachProfile));
      return { status: 'active', profile_id: coachProfile.profile_id };
    },
  };
}

export function createE2EGroupService({ window }) {
  const { localStorage: storage } = window;

  function readState() {
    const state = JSON.parse(storage.getItem('roda.e2e.groupState') ?? '{}');
    return {
      groups: [],
      memberships: JSON.parse(storage.getItem('roda.e2e.memberships') ?? '[]'),
      rosters: {},
      joinRequests: {},
      invitations: {},
      relationships: {},
      discoveryTokens: {},
      invitationTokens: {},
      revokedGroupIds: [],
      discoveryCounter: 0,
      ...state,
    };
  }

  function writeState(state) {
    storage.setItem('roda.e2e.groupState', JSON.stringify(state));
  }

  function record(event) {
    window.__RODA_E2E_EVENTS__?.push(event);
  }

  return {
    async listMyMemberships() {
      consumeLoadFailure(
        storage,
        'roda.e2e.failMembershipLoads',
        'Group memberships could not be loaded.',
      );
      return readState().memberships;
    },

    async searchGroups(searchText = '') {
      const query = searchText.trim().toLocaleLowerCase();
      return readState().groups.filter((group) => group.is_discoverable && (
        !query || `${group.name} ${group.location ?? ''}`.toLocaleLowerCase().includes(query)
      ));
    },

    async resolveDiscoveryToken(token) {
      const state = readState();
      const groupId = state.discoveryTokens[token];
      return state.groups.find((group) => group.id === groupId) ?? null;
    },

    async requestAccess(groupId, requestedAccess) {
      const state = readState();
      const request = {
        id: `request-${Object.values(state.joinRequests).flat().length + 1}`,
        group_id: groupId,
        profile_id: 'practitioner-1',
        display_name: 'Ana Silva',
        requested_access: requestedAccess,
        state: 'pending',
      };
      state.joinRequests[groupId] = [...(state.joinRequests[groupId] ?? []), request];
      writeState(state);
      record({ type: 'request-access', groupId, requestedAccess });
      return { status: 'pending', request_id: request.id };
    },

    async createGroup({ name, description, location, discoverable, timezone }) {
      const state = readState();
      const id = `group-${state.groups.length + 1}`;
      const group = {
        id,
        slug: name.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
        owner_id: 'practitioner-1',
        name: name.trim(),
        description: description?.trim() || null,
        location: location?.trim() || null,
        timezone: timezone?.trim() || 'UTC',
        picture_path: null,
        is_discoverable: Boolean(discoverable),
        archived_at: null,
      };
      state.groups.push(group);
      state.memberships.push({
        group_id: id,
        profile_id: 'practitioner-1',
        access_level: 'coach',
        state: 'active',
        joined_at: '2026-09-11T20:00:00Z',
        group,
      });
      state.rosters[id] = [{
        profile_id: 'practitioner-1',
        display_name: 'Ana Silva',
        access_level: 'coach',
        membership_state: 'active',
      }];
      writeState(state);
      record({ type: 'create-group', group });
      return { status: 'created', group_id: id };
    },

    async updateGroup(groupId, { name, description, location, discoverable, timezone }) {
      const state = readState();
      const values = {
        name: name.trim(),
        description: description?.trim() || null,
        location: location?.trim() || null,
        timezone: timezone?.trim() || 'UTC',
        is_discoverable: Boolean(discoverable),
      };
      const group = state.groups.find((item) => item.id === groupId);
      if (group) Object.assign(group, values);
      const membership = state.memberships.find((item) => item.group_id === groupId);
      if (membership?.group) Object.assign(membership.group, values);
      writeState(state);
      return { status: 'updated', group_id: groupId };
    },

    async setGroupTimezone(groupId, timezone) {
      const state = readState();
      const group = state.groups.find((item) => item.id === groupId);
      if (group) group.timezone = timezone.trim();
      const membership = state.memberships.find((item) => item.group_id === groupId);
      if (membership?.group) membership.group.timezone = timezone.trim();
      writeState(state);
      return { status: 'updated', group_id: groupId };
    },

    async listRoster(groupId) {
      const state = readState();
      if (state.revokedGroupIds.includes(groupId)) {
        state.memberships = state.memberships.filter((item) => item.group_id !== groupId);
        writeState(state);
        throw new AppError('authorization', 'not_authorized');
      }
      return state.rosters[groupId] ?? [];
    },

    async listJoinRequests(groupId) {
      return readState().joinRequests[groupId] ?? [];
    },

    async listInvitations(groupId) {
      return readState().invitations[groupId] ?? [];
    },

    async listRelationships(groupId) {
      return readState().relationships[groupId] ?? [];
    },

    async decideJoinRequest(requestId, decision) {
      const state = readState();
      for (const [groupId, requests] of Object.entries(state.joinRequests)) {
        const request = requests.find((item) => item.id === requestId);
        if (!request) continue;
        request.state = decision === 'approved' ? 'approved' : 'declined';
        if (decision === 'approved') {
          state.rosters[groupId] = [...(state.rosters[groupId] ?? []), {
            profile_id: request.profile_id,
            display_name: request.display_name,
            access_level: request.requested_access,
            membership_state: 'active',
          }];
        }
        writeState(state);
        return { status: request.state };
      }
      throw new Error('That request is no longer available.');
    },

    async removeMember(groupId, profileId) {
      const state = readState();
      state.rosters[groupId] = (state.rosters[groupId] ?? [])
        .filter((item) => item.profile_id !== profileId);
      writeState(state);
      return { status: 'removed' };
    },

    async createInvitation(groupId, email = null) {
      const state = readState();
      const invitation = {
        id: 'invitation-1',
        group_id: groupId,
        token: 'invite-1',
        email: email?.trim().toLocaleLowerCase() || null,
        state: 'pending',
        expires_at: '2026-09-18T20:00:00Z',
      };
      state.invitations[groupId] = [...(state.invitations[groupId] ?? []), invitation];
      writeState(state);
      return invitation;
    },

    async acceptInvitation(token) {
      const state = readState();
      const invitation = state.invitationTokens[token];
      if (!invitation) return { status: 'revoked' };
      if (invitation.state === 'accepted') return { status: 'accepted', already_used: true };
      if (invitation.state !== 'pending') return { status: invitation.state };
      invitation.state = 'accepted';
      const group = invitation.group;
      if (!state.memberships.some((item) => item.group_id === group.id)) {
        state.memberships.push({
          group_id: group.id,
          profile_id: 'practitioner-1',
          access_level: 'member',
          state: 'active',
          joined_at: '2026-09-11T20:00:00Z',
          group,
        });
      }
      writeState(state);
      return { status: 'accepted', group_id: group.id };
    },

    async setRelationshipSharing(relationshipId, sharingLevel) {
      const state = readState();
      for (const relationships of Object.values(state.relationships)) {
        const relationship = relationships.find((item) => item.id === relationshipId);
        if (relationship) relationship.sharing_level = sharingLevel;
      }
      writeState(state);
      return { status: 'updated', sharing_level: sharingLevel };
    },

    async rotateDiscoveryLink(groupId) {
      const state = readState();
      state.discoveryCounter += 1;
      const token = `discovery-${state.discoveryCounter}`;
      state.discoveryTokens[token] = groupId;
      writeState(state);
      return { status: 'active', group_id: groupId, token };
    },

    async revokeDiscoveryLink(groupId) {
      const state = readState();
      for (const [token, linkedGroupId] of Object.entries(state.discoveryTokens)) {
        if (linkedGroupId === groupId) delete state.discoveryTokens[token];
      }
      writeState(state);
      return { status: 'revoked', group_id: groupId };
    },

    async transferOwnership(groupId, newOwnerId) {
      const state = readState();
      const group = state.groups.find((item) => item.id === groupId);
      if (group) group.owner_id = newOwnerId;
      const membership = state.memberships.find((item) => item.group_id === groupId);
      if (membership?.group) membership.group.owner_id = newOwnerId;
      writeState(state);
      return { status: 'transferred', group_id: groupId, owner_id: newOwnerId };
    },

    async archiveGroup(groupId) {
      const state = readState();
      const group = state.groups.find((item) => item.id === groupId);
      if (group) group.archived_at = '2026-09-11T21:00:00Z';
      const membership = state.memberships.find((item) => item.group_id === groupId);
      if (membership?.group) membership.group.archived_at = '2026-09-11T21:00:00Z';
      writeState(state);
      return { status: 'archived', group_id: groupId };
    },

    async inviteChildGroup(parentGroupId, childGroupId) {
      const state = readState();
      if (state.relationshipInviteError) throw new Error(state.relationshipInviteError);
      record({ type: 'invite-child-group', parentGroupId, childGroupId });
      return { status: 'pending', relationship_id: 'relationship-new' };
    },

    async decideRelationship(relationshipId, decision) {
      const state = readState();
      for (const relationships of Object.values(state.relationships)) {
        const relationship = relationships.find((item) => item.id === relationshipId);
        if (relationship) relationship.state = decision === 'accepted' ? 'active' : 'declined';
      }
      writeState(state);
      return { status: decision === 'accepted' ? 'active' : 'declined' };
    },

    async revokeRelationship(relationshipId) {
      const state = readState();
      for (const relationships of Object.values(state.relationships)) {
        const relationship = relationships.find((item) => item.id === relationshipId);
        if (relationship) relationship.state = 'revoked';
      }
      writeState(state);
      return { status: 'revoked' };
    },
  };
}

export function createE2EConnectionService({ window }) {
  const { localStorage: storage } = window;

  function readState() {
    return {
      candidates: [],
      connections: [],
      counter: 0,
      ...(JSON.parse(storage.getItem('roda.e2e.connectionState') ?? '{}')),
    };
  }

  function writeState(state) {
    storage.setItem('roda.e2e.connectionState', JSON.stringify(state));
  }

  function actorId() {
    return readSession(storage)?.user?.id ?? 'practitioner-1';
  }

  function record(event) {
    window.__RODA_E2E_EVENTS__?.push(event);
  }

  return {
    async searchCandidates(searchText = '', candidateRole = 'coach', resultLimit = 20) {
      const query = searchText.trim().toLocaleLowerCase();
      return readState().candidates
        .filter((candidate) => candidate.candidate_role === candidateRole)
        .filter((candidate) => !query || candidate.display_name.toLocaleLowerCase().includes(query))
        .slice(0, resultLimit);
    },

    async listMine() {
      const state = readState();
      if (state.revokeReadsFor?.includes(actorId())) {
        throw new AppError('authorization', 'not_authorized');
      }
      return state.connections.filter((connection) => (
        connection.coach_profile_id === actorId()
        || connection.student_profile_id === actorId()
      ));
    },

    async request(coachProfileId, studentProfileId) {
      const state = readState();
      const existing = state.connections.find((connection) => (
        connection.coach_profile_id === coachProfileId
        && connection.student_profile_id === studentProfileId
        && ['pending', 'active'].includes(connection.state)
      ));
      if (existing) return { status: existing.state, connection_id: existing.connection_id };
      state.counter += 1;
      const coach = state.candidates.find((candidate) => candidate.profile_id === coachProfileId);
      const student = state.candidates.find((candidate) => candidate.profile_id === studentProfileId);
      const connection = {
        connection_id: `connection-${state.counter}`,
        connection_kind: 'direct',
        coach_profile_id: coachProfileId,
        coach_display_name: coach?.display_name ?? state.people?.[coachProfileId] ?? 'Coach',
        coach_avatar_path: coach?.avatar_path ?? null,
        student_profile_id: studentProfileId,
        student_display_name: student?.display_name ?? state.people?.[studentProfileId] ?? 'Student',
        student_avatar_path: student?.avatar_path ?? null,
        state: 'pending',
        initiated_by: actorId(),
        created_at: '2026-09-22T12:00:00Z',
      };
      state.connections.push(connection);
      writeState(state);
      record({ type: 'request-coach-connection', coachProfileId, studentProfileId });
      return { status: 'pending', connection_id: connection.connection_id };
    },

    async decide(connectionId, decision) {
      const state = readState();
      const connection = state.connections.find((item) => item.connection_id === connectionId);
      if (!connection) throw new Error('That coaching request is no longer available.');
      connection.state = decision === 'accepted' ? 'active' : 'declined';
      writeState(state);
      record({ type: 'decide-coach-connection', connectionId, decision });
      return { status: connection.state, connection_id: connectionId };
    },

    async end(connectionId) {
      const state = readState();
      const connection = state.connections.find((item) => item.connection_id === connectionId);
      if (!connection) throw new Error('That coaching connection is no longer available.');
      connection.state = 'ended';
      writeState(state);
      record({ type: 'end-coach-connection', connectionId });
      return { status: 'ended', connection_id: connectionId };
    },
  };
}

export function createE2ETrainingService({ window }) {
  const { localStorage: storage } = window;
  const stateKey = 'roda.e2e.trainingState';

  function readState() {
    return {
      plans: [],
      schedules: [],
      occurrences: [],
      participations: [],
      assessments: [],
      feedback: [],
      counter: 0,
      failNext: null,
      revokeReadsFor: [],
      ...JSON.parse(storage.getItem(stateKey) ?? '{}'),
    };
  }

  function writeState(state) {
    storage.setItem(stateKey, JSON.stringify(state));
  }

  function actorId() {
    return readSession(storage)?.user?.id ?? 'practitioner-1';
  }

  function record(event) {
    window.__RODA_E2E_EVENTS__?.push(event);
  }

  function nextId(state, prefix) {
    state.counter += 1;
    return `${prefix}-${state.counter}`;
  }

  function guard(state, operation, { read = false } = {}) {
    if (state.failNext === operation) {
      state.failNext = null;
      writeState(state);
      throw new AppError('network', 'network_failure', 'The training request failed.', {
        retryable: true,
      });
    }
    if (read && state.revokeReadsFor?.includes(actorId())) {
      throw new AppError('authorization', 'not_authorized');
    }
  }

  function isCoach() {
    return Boolean(JSON.parse(storage.getItem('roda.e2e.coachProfile') ?? 'null'));
  }

  function groupRoster(groupId) {
    const groupState = JSON.parse(storage.getItem('roda.e2e.groupState') ?? '{}');
    return groupState.rosters?.[groupId] ?? [];
  }

  function completion(state, occurrence) {
    return {
      status: 'completed',
      occurrence_id: occurrence.id,
      participation_ids: state.participations
        .filter(({ occurrence_id: occurrenceId }) => occurrenceId === occurrence.id)
        .map(({ id }) => id),
    };
  }

  function roundsFor(plan, override) {
    return structuredClone(override ?? plan?.rounds ?? []);
  }

  return {
    createIdempotencyKey() {
      const state = readState();
      return nextId(state, 'request');
    },

    async createPlan(input) {
      const state = readState();
      guard(state, 'createPlan');
      if (!isCoach()) throw new AppError('authorization', 'not_authorized');
      const plan = {
        plan_id: nextId(state, 'plan'),
        version_id: nextId(state, 'version'),
        version_number: 1,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        source_group_id: input.groupId ?? null,
        state: 'draft',
        expected_duration_minutes: input.durationMinutes,
        instructions: input.instructions?.trim() || null,
        published_at: null,
        updated_at: '2026-09-22T18:00:00Z',
        rounds: structuredClone(input.rounds),
      };
      state.plans.push(plan);
      writeState(state);
      record({ type: 'create-workout-plan', planId: plan.plan_id });
      return {
        status: 'created', plan_id: plan.plan_id,
        version_id: plan.version_id, updated_at: plan.updated_at,
      };
    },

    async savePlanDraft(input) {
      const state = readState();
      guard(state, 'savePlanDraft');
      const plan = state.plans.find(({ plan_id: id }) => id === input.planId);
      if (!plan || plan.expected_updated_at !== undefined
        && input.expectedUpdatedAt !== plan.updated_at) {
        throw new AppError('validation', 'edit_conflict');
      }
      Object.assign(plan, {
        title: input.title.trim(),
        description: input.description?.trim() || null,
        expected_duration_minutes: input.durationMinutes,
        instructions: input.instructions?.trim() || null,
        rounds: structuredClone(input.rounds),
        state: 'draft',
        updated_at: '2026-09-22T18:01:00Z',
      });
      writeState(state);
      return {
        status: 'saved', plan_id: plan.plan_id,
        version_id: plan.version_id, updated_at: plan.updated_at,
      };
    },

    async publishPlan(planId) {
      const state = readState();
      guard(state, 'publishPlan');
      const plan = state.plans.find(({ plan_id: id }) => id === planId);
      if (!plan || !isCoach()) throw new AppError('authorization', 'not_authorized');
      plan.state = 'published';
      plan.published_at = '2026-09-22T18:02:00Z';
      writeState(state);
      return { status: 'published', plan_id: planId, version_id: plan.version_id };
    },

    async listPlans(groupId = null) {
      const state = readState();
      guard(state, 'listPlans', { read: true });
      return state.plans.filter((plan) => !groupId || plan.source_group_id === groupId);
    },

    async scheduleGroupTraining(input) {
      const state = readState();
      guard(state, 'scheduleGroupTraining');
      if (!isCoach()) throw new AppError('authorization', 'not_authorized');
      const plan = state.plans.find(({ version_id: id }) => id === input.planVersionId);
      if (!plan || plan.state !== 'published') {
        throw new AppError('validation', 'plan_not_published');
      }
      const schedule = {
        id: nextId(state, 'schedule'), kind: 'group', state: 'scheduled',
        plan_version_id: input.planVersionId, group_id: input.groupId,
        student_profile_id: null, connection_id: null,
        arranged_by: actorId(), starts_at: input.startsAt,
        local_date: input.localDate, timezone: input.timezone,
        duration_minutes: plan.expected_duration_minutes,
        visible_in_advance: input.visibleInAdvance !== false,
      };
      state.schedules.push(schedule);
      writeState(state);
      return { status: 'scheduled', schedule_id: schedule.id };
    },

    async schedulePersonalClass(input) {
      const state = readState();
      guard(state, 'schedulePersonalClass');
      if (!isCoach()) throw new AppError('authorization', 'not_authorized');
      const plan = state.plans.find(({ version_id: id }) => id === input.planVersionId);
      if (!plan || plan.state !== 'published') {
        throw new AppError('validation', 'plan_not_published');
      }
      const schedule = {
        id: nextId(state, 'schedule'), kind: 'personal_class', state: 'scheduled',
        plan_version_id: input.planVersionId, group_id: input.groupId ?? null,
        student_profile_id: input.studentProfileId,
        connection_id: input.connectionId ?? null,
        arranged_by: actorId(), starts_at: input.startsAt,
        local_date: input.localDate, timezone: input.timezone,
        duration_minutes: plan.expected_duration_minutes,
        visible_in_advance: input.visibleInAdvance !== false,
      };
      state.schedules.push(schedule);
      writeState(state);
      return { status: 'scheduled', schedule_id: schedule.id };
    },

    async cancelScheduledTraining(scheduleId, reason = null) {
      const state = readState();
      guard(state, 'cancelScheduledTraining');
      const schedule = state.schedules.find(({ id }) => id === scheduleId);
      if (!schedule || schedule.arranged_by !== actorId()) {
        throw new AppError('authorization', 'not_authorized');
      }
      schedule.state = 'cancelled';
      schedule.cancellation_reason = reason?.trim() || null;
      writeState(state);
      return { status: 'cancelled', schedule_id: scheduleId };
    },

    async recordAloneTraining(input) {
      const state = readState();
      guard(state, 'recordAloneTraining');
      const existing = state.occurrences.find(({ idempotency_key: key }) => (
        key === input.idempotencyKey
      ));
      if (existing) return completion(state, existing);
      const occurrence = {
        id: nextId(state, 'occurrence'), kind: 'alone', group_id: null,
        recorded_by: actorId(), occurred_at: input.occurredAt ?? `${input.localDate}T12:00:00Z`,
        local_date: input.localDate, timezone: input.timezone,
        default_duration_minutes: input.durationMinutes,
        idempotency_key: input.idempotencyKey,
        rounds: structuredClone(input.rounds),
      };
      const participation = {
        id: nextId(state, 'participation'), occurrence_id: occurrence.id,
        profile_id: actorId(), actual_duration_minutes: input.durationMinutes,
        personal_notes: input.notes?.trim() || null,
        confirmed_at: occurrence.occurred_at,
      };
      state.occurrences.push(occurrence);
      state.participations.push(participation);
      writeState(state);
      record({ type: 'record-alone-training', occurrenceId: occurrence.id });
      return { ...completion(state, occurrence), participation_id: participation.id };
    },

    async completeGroupTraining(input) {
      const state = readState();
      guard(state, 'completeGroupTraining');
      const existing = state.occurrences.find(({ idempotency_key: key }) => (
        key === input.idempotencyKey
      ));
      if (existing) return completion(state, existing);
      const schedule = state.schedules.find(({ id }) => id === input.scheduleId);
      if (!schedule || schedule.arranged_by !== actorId()) {
        throw new AppError('authorization', 'not_authorized');
      }
      if (schedule.state === 'cancelled') throw new AppError('validation', 'cancelled_training');
      const rosterIds = new Set(groupRoster(schedule.group_id).map(({ profile_id: id }) => id));
      if (input.attendees.some(({ profileId }) => !rosterIds.has(profileId))) {
        throw new AppError('validation', 'invalid_attendee');
      }
      const plan = state.plans.find(({ version_id: id }) => id === schedule.plan_version_id);
      const occurrence = {
        id: nextId(state, 'occurrence'), schedule_id: schedule.id,
        kind: 'group', group_id: schedule.group_id, recorded_by: actorId(),
        occurred_at: input.occurredAt ?? schedule.starts_at,
        local_date: schedule.local_date, timezone: schedule.timezone,
        default_duration_minutes: input.durationMinutes,
        idempotency_key: input.idempotencyKey,
        rounds: roundsFor(plan, input.rounds),
      };
      state.occurrences.push(occurrence);
      input.attendees.forEach((attendee) => state.participations.push({
        id: nextId(state, 'participation'), occurrence_id: occurrence.id,
        profile_id: attendee.profileId,
        actual_duration_minutes: attendee.durationMinutes,
        personal_notes: null, confirmed_at: occurrence.occurred_at,
      }));
      schedule.state = 'completed';
      writeState(state);
      return completion(state, occurrence);
    },

    async completePersonalClass(input) {
      const state = readState();
      guard(state, 'completePersonalClass');
      const existing = state.occurrences.find(({ idempotency_key: key }) => (
        key === input.idempotencyKey
      ));
      if (existing) return completion(state, existing);
      const schedule = state.schedules.find(({ id }) => id === input.scheduleId);
      if (!schedule || schedule.arranged_by !== actorId()) {
        throw new AppError('authorization', 'not_authorized');
      }
      const plan = state.plans.find(({ version_id: id }) => id === schedule.plan_version_id);
      const occurrence = {
        id: nextId(state, 'occurrence'), schedule_id: schedule.id,
        kind: 'personal_class', group_id: schedule.group_id,
        recorded_by: actorId(), occurred_at: input.occurredAt ?? schedule.starts_at,
        local_date: schedule.local_date, timezone: schedule.timezone,
        default_duration_minutes: input.durationMinutes,
        idempotency_key: input.idempotencyKey,
        rounds: roundsFor(plan, input.rounds),
      };
      state.occurrences.push(occurrence);
      state.participations.push({
        id: nextId(state, 'participation'), occurrence_id: occurrence.id,
        profile_id: schedule.student_profile_id,
        actual_duration_minutes: input.durationMinutes,
        personal_notes: null, confirmed_at: occurrence.occurred_at,
      });
      schedule.state = 'completed';
      writeState(state);
      return completion(state, occurrence);
    },

    async saveNotes(input) {
      const state = readState();
      guard(state, 'saveNotes');
      const participation = state.participations.find(({ id }) => id === input.participationId);
      if (!participation || participation.profile_id !== actorId()) {
        throw new AppError('authorization', 'not_authorized');
      }
      participation.personal_notes = input.notes?.trim() || null;
      writeState(state);
      return { status: 'saved', participation_id: participation.id };
    },

    async saveAssessment(input) {
      const state = readState();
      guard(state, 'saveAssessment');
      const participation = state.participations.find(({ id }) => id === input.participationId);
      if (!participation || participation.profile_id !== actorId()) {
        throw new AppError('authorization', 'not_authorized');
      }
      const existing = state.assessments.find((assessment) => (
        assessment.participation_id === input.participationId
        && assessment.movement_id === input.movementId
      ));
      const assessment = existing ?? {
        id: nextId(state, 'assessment'),
        participation_id: input.participationId,
        movement_id: input.movementId,
      };
      Object.assign(assessment, { difficulty: input.difficulty, note: input.note?.trim() || null });
      if (!existing) state.assessments.push(assessment);
      writeState(state);
      return { status: 'saved', assessment_id: assessment.id };
    },

    async addFeedback(input) {
      const state = readState();
      guard(state, 'addFeedback');
      if (!isCoach()) throw new AppError('authorization', 'not_authorized');
      const feedback = {
        id: nextId(state, 'feedback'), participation_id: input.participationId,
        coach_profile_id: actorId(), group_id: input.groupId ?? null,
        connection_id: input.connectionId ?? null,
        body: input.body.trim(), created_at: '2026-09-22T18:10:00Z',
      };
      state.feedback.push(feedback);
      writeState(state);
      return { status: 'saved', feedback_id: feedback.id };
    },

    async listCalendar(input) {
      const state = readState();
      guard(state, 'listCalendar', { read: true });
      const profileId = input.profileId ?? actorId();
      const completed = state.participations
        .filter(({ profile_id: id }) => id === profileId)
        .map((participation) => {
          const occurrence = state.occurrences.find(({ id }) => id === participation.occurrence_id);
          return {
            item_id: occurrence.id, item_type: 'completed',
            local_date: occurrence.local_date, kind: occurrence.kind,
            status: 'completed', starts_at: occurrence.occurred_at,
            duration_minutes: participation.actual_duration_minutes,
            group_id: occurrence.group_id,
          };
        });
      const upcoming = state.schedules
        .filter(({ state: status }) => status === 'scheduled')
        .filter((schedule) => schedule.student_profile_id === profileId
          || (schedule.kind === 'group' && groupRoster(schedule.group_id)
            .some(({ profile_id: id }) => id === profileId)))
        .map((schedule) => ({
          item_id: schedule.id, item_type: 'scheduled',
          local_date: schedule.local_date, kind: schedule.kind,
          status: schedule.state, starts_at: schedule.starts_at,
          duration_minutes: schedule.duration_minutes,
          group_id: schedule.group_id,
          visible_in_advance: schedule.visible_in_advance,
        }));
      return [...completed, ...upcoming]
        .filter(({ local_date: date }) => date >= input.start && date < input.endExclusive)
        .sort((left, right) => left.starts_at.localeCompare(right.starts_at));
    },

    async getDay(input) {
      const state = readState();
      guard(state, 'getDay', { read: true });
      const profileId = input.profileId ?? actorId();
      return state.participations
        .filter(({ profile_id: id }) => id === profileId)
        .map((participation) => ({
          participation,
          occurrence: state.occurrences.find(({ id }) => id === participation.occurrence_id),
        }))
        .filter(({ occurrence }) => occurrence.local_date === input.localDate)
        .map(({ occurrence, participation }) => ({
          id: occurrence.id, item_type: 'completed', kind: occurrence.kind,
          status: 'completed', starts_at: occurrence.occurred_at,
          duration_minutes: participation.actual_duration_minutes,
          participation_id: participation.id,
          personal_notes: participation.personal_notes,
          rounds: structuredClone(occurrence.rounds),
          assessments: state.assessments.filter(({ participation_id: id }) => id === participation.id),
          feedback: state.feedback.filter(({ participation_id: id }) => id === participation.id),
        }));
    },
  };
}
