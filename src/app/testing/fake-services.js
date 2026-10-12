import { consumeReturnRoute } from '../return-route.js';
import { requireUsageMode, resolveTimezoneOverride } from '../profile-service.js';
import { AppError } from '../errors.js';
import { normalizeSequenceInput } from '../repertoire-service.js';
import { requireTerm } from '../catalog-service.js';
import { normalizeResource } from '../training-service.js';

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
      if (saved) return { usage_mode: 'train', ...saved };
      const profile = {
        id: 'practitioner-1',
        display_name: 'Capoeirista',
        avatar_path: null,
        timezone_override: null,
        leaderboard_visible: true,
        usage_mode: 'train',
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

    async setUsageMode(mode) {
      requireUsageMode(mode);
      const current = JSON.parse(storage.getItem('roda.e2e.profile') ?? '{}');
      storage.setItem('roda.e2e.profile', JSON.stringify({ ...current, usage_mode: mode }));
      let created = false;
      if (mode !== 'train' && !JSON.parse(storage.getItem('roda.e2e.coachProfile') ?? 'null')) {
        storage.setItem('roda.e2e.coachProfile', JSON.stringify({
          profile_id: current.id ?? 'practitioner-1', activated_at: '2026-10-12T12:00:00Z',
        }));
        created = true;
      }
      record({ type: 'set-usage-mode', mode });
      return { status: 'updated', usage_mode: mode, coach_profile_created: created };
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
      roundRatings: {},
      resources: [],
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

  function dayRounds(state, occurrence, participation) {
    const schedule = state.schedules.find(({ id }) => id === occurrence.schedule_id);
    const plan = state.plans.find(({ version_id: versionId }) => versionId === schedule?.plan_version_id);
    return structuredClone(occurrence.rounds ?? []).map((round, roundIndex) => {
      const roundId = round.id ?? `${occurrence.id}-round-${roundIndex + 1}`;
      return {
        ...round,
        id: roundId,
        source_text: round.source_text ?? null,
        sequence: round.sequence ?? null,
        ratings: participation ? state.roundRatings?.[participation.id]?.[roundId] ?? [] : [],
        planned: structuredClone(plan?.rounds?.[roundIndex]?.ratings ?? []),
        movements: (round.movements ?? []).map((movement, movementIndex) => {
          const movementId = movement.id
            ?? `${occurrence.id}-movement-${roundIndex + 1}-${movementIndex + 1}`;
          const assessment = participation && state.assessments.find((entry) => (
            entry.participation_id === participation.id && entry.movement_id === movementId
          ));
          return { ...movement, id: movementId, assessment: assessment ?? null };
        }),
      };
    });
  }

  function groupName(groupId) {
    const groups = JSON.parse(storage.getItem('roda.e2e.groupState') ?? '{}').groups ?? [];
    return groups.find(({ id }) => id === groupId)?.name ?? null;
  }

  function coachName(profileId) {
    const profile = JSON.parse(storage.getItem('roda.e2e.profile') ?? '{}');
    return profile.id === profileId ? profile.display_name ?? null : 'Coach';
  }

  function roundsFor(plan, override) {
    return structuredClone(override ?? plan?.rounds ?? []);
  }

  return {
    createIdempotencyKey() {
      const state = readState();
      const key = nextId(state, 'request');
      writeState(state);
      return key;
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
      occurrence.rounds = occurrence.rounds.map((round, index) => ({
        ...round, id: round.id ?? `${occurrence.id}-round-${index + 1}`,
      }));
      state.roundRatings[participation.id] = Object.fromEntries(
        occurrence.rounds.map((round, index) => [
          round.id, structuredClone(input.rounds[index]?.ratings ?? []),
        ]),
      );
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

    async addResource(input) {
      const state = readState();
      guard(state, 'addResource');
      const resource = normalizeResource(input);
      const occurrence = state.occurrences.find(({ id }) => id === input.occurrenceId);
      if (!occurrence || occurrence.recorded_by !== actorId()) throw new AppError('authorization', 'not_authorized');
      const id = nextId(state, 'resource');
      state.resources.push({ id, occurrence_id: occurrence.id, kind: input.kind, added_by: actorId(), ...resource });
      writeState(state);
      record({ type: 'add-resource', kind: input.kind });
      return { status: 'saved', resource_id: id };
    },
    async updateResource(input) {
      const state = readState();
      const resource = state.resources.find(({ id }) => id === input.resourceId);
      if (!resource || resource.added_by !== actorId()) throw new AppError('authorization', 'not_authorized');
      Object.assign(resource, normalizeResource({ ...input, kind: resource.kind }));
      writeState(state);
      return { status: 'saved', resource_id: resource.id };
    },
    async deleteResource(resourceId) {
      const state = readState();
      const resource = state.resources.find(({ id }) => id === resourceId);
      if (!resource || resource.added_by !== actorId()) throw new AppError('authorization', 'not_authorized');
      state.resources = state.resources.filter(({ id }) => id !== resourceId);
      writeState(state);
      return { status: 'deleted', resource_id: resourceId };
    },
    async listResourceKinds(input) {
      const state = readState();
      const profileId = input.profileId ?? actorId();
      const occurrenceIds = new Set(state.participations
        .filter(({ profile_id: id }) => id === profileId).map(({ occurrence_id: id }) => id));
      const byOccurrence = new Map();
      for (const resource of state.resources) {
        const occurrence = state.occurrences.find(({ id }) => id === resource.occurrence_id);
        if (!occurrenceIds.has(resource.occurrence_id)) continue;
        if (occurrence.local_date < input.start || occurrence.local_date >= input.endExclusive) continue;
        const kinds = byOccurrence.get(resource.occurrence_id) ?? new Set();
        kinds.add(resource.kind);
        byOccurrence.set(resource.occurrence_id, kinds);
      }
      return [...byOccurrence].map(([occurrenceId, kinds]) => ({
        occurrence_id: occurrenceId, kinds: [...kinds].sort(),
      }));
    },
    async recordPastClass(input) {
      const state = readState();
      guard(state, 'recordPastClass');
      const existing = state.occurrences.find(({ idempotency_key: key }) => key === input.idempotencyKey);
      if (existing) return completion(state, existing);
      if (new Date(input.occurredAt) > new Date()) {
        throw new AppError('validation', 'past_class_in_future');
      }
      const occurrence = {
        id: nextId(state, 'occurrence'), kind: input.kind, group_id: input.groupId ?? null,
        schedule_id: null, recorded_by: actorId(), occurred_at: input.occurredAt,
        local_date: input.localDate, timezone: input.timezone,
        default_duration_minutes: input.durationMinutes, idempotency_key: input.idempotencyKey,
        rounds: structuredClone(input.rounds ?? []),
      };
      state.occurrences.push(occurrence);
      const attendees = input.kind === 'group'
        ? input.attendees
        : [{ profileId: input.studentProfileId, durationMinutes: input.durationMinutes }];
      for (const attendee of attendees) {
        state.participations.push({
          id: nextId(state, 'participation'), occurrence_id: occurrence.id,
          profile_id: attendee.profileId, actual_duration_minutes: attendee.durationMinutes,
          personal_notes: null, confirmed_at: input.occurredAt,
        });
      }
      writeState(state);
      record({ type: 'record-past-class', occurrenceId: occurrence.id });
      return completion(state, occurrence);
    },

    async listRecentTrainings(limit = 10) {
      const state = readState();
      guard(state, 'listRecentTrainings', { read: true });
      const me = actorId();
      return state.occurrences
        .map((occurrence) => {
          const attendees = state.participations.filter(({ occurrence_id: id }) => id === occurrence.id);
          const mine = attendees.find(({ profile_id: id }) => id === me);
          if (!attendees.length || (!mine && occurrence.recorded_by !== me)) return null;
          const rounds = dayRounds(state, occurrence, mine);
          const first = rounds[0];
          return {
            occurrence_id: occurrence.id, kind: occurrence.kind, local_date: occurrence.local_date,
            occurred_at: occurrence.occurred_at,
            duration_minutes: mine?.actual_duration_minutes ?? occurrence.default_duration_minutes,
            group_name: groupName(occurrence.group_id), coach_name: coachName(occurrence.recorded_by),
            attendee_count: attendees.length, role: mine ? 'participant' : 'coach',
            first_round_text: first
              ? first.source_text ?? (first.movements ?? []).map((movement) => movement.movement_name).join(', ')
              : null,
            round_count: rounds.length,
            felt: rounds.flatMap(({ ratings }) => ratings).find(({ segment_key: key }) => key === 'r')?.difficulty ?? null,
            has_rating: rounds.some(({ ratings }) => ratings.length > 0),
            resource_kinds: [...new Set(state.resources
              .filter(({ occurrence_id: id }) => id === occurrence.id).map(({ kind }) => kind))].sort(),
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
        .slice(0, Math.min(Math.max(limit, 1), 50));
    },

    async getTraining(occurrenceId) {
      const state = readState();
      guard(state, 'getTraining', { read: true });
      const me = actorId();
      const occurrence = state.occurrences.find(({ id }) => id === occurrenceId);
      const attendees = state.participations.filter(({ occurrence_id: id }) => id === occurrenceId);
      const mine = attendees.find(({ profile_id: id }) => id === me);
      if (!occurrence || (!mine && occurrence.recorded_by !== me)) {
        throw new AppError('authorization', 'not_authorized');
      }
      return {
        occurrence_id: occurrence.id, kind: occurrence.kind, local_date: occurrence.local_date,
        timezone: occurrence.timezone, occurred_at: occurrence.occurred_at,
        duration_minutes: mine?.actual_duration_minutes ?? occurrence.default_duration_minutes,
        group_id: occurrence.group_id, group_name: groupName(occurrence.group_id),
        student_name: null, coach_profile_id: occurrence.recorded_by,
        coach_name: coachName(occurrence.recorded_by), attendee_count: attendees.length,
        role: mine ? 'participant' : 'coach',
        participation: mine ? {
          id: mine.id, personal_notes: mine.personal_notes ?? null,
          duration_minutes: mine.actual_duration_minutes,
        } : null,
        rounds: dayRounds(state, occurrence, mine),
        feedback: mine ? state.feedback.filter(({ participation_id: id }) => id === mine.id) : [],
        resources: state.resources
          .filter(({ occurrence_id: id }) => id === occurrence.id)
          .map((resource) => ({ ...resource, can_edit: resource.added_by === me })),
        can_add_resources: occurrence.recorded_by === me,
      };
    },

    async saveRoundAssessments(input) {
      const state = readState();
      guard(state, 'saveRoundAssessments');
      const participation = state.participations.find(({ id }) => id === input.participationId);
      if (!participation || participation.profile_id !== actorId()) {
        throw new AppError('authorization', 'not_authorized');
      }
      state.roundRatings[participation.id] ??= {};
      state.roundRatings[participation.id][input.roundId] = structuredClone(input.ratings);
      writeState(state);
      record({ type: 'save-round-assessments', roundId: input.roundId });
      return { status: 'saved', round_id: input.roundId };
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
            coach_profile_id: occurrence.recorded_by,
            group_name: groupName(occurrence.group_id),
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
          coach_profile_id: schedule.arranged_by,
          group_name: groupName(schedule.group_id),
        }));
      return [...completed, ...upcoming]
        .filter(({ local_date: date }) => date >= input.start && date < input.endExclusive)
        .sort((left, right) => left.starts_at.localeCompare(right.starts_at));
    },

    async getDay(input) {
      const state = readState();
      guard(state, 'getDay', { read: true });
      const profileId = input.profileId ?? actorId();
      const connectionState = JSON.parse(storage.getItem('roda.e2e.connectionState') ?? '{}');
      const groupState = JSON.parse(storage.getItem('roda.e2e.groupState') ?? '{}');
      const contextsFor = (occurrence) => {
        if (profileId === actorId()) return [];
        const contexts = [];
        const direct = (connectionState.connections ?? []).find((connection) => (
          connection.state === 'active'
          && connection.connection_kind === 'direct'
          && connection.connection_id
          && connection.coach_profile_id === actorId()
          && connection.student_profile_id === profileId
        ));
        if (direct) contexts.push({
          kind: 'connection', id: direct.connection_id, label: 'Direct coaching',
        });
        const membership = (groupState.memberships ?? []).find((entry) => (
          entry.group_id === occurrence.group_id
          && entry.profile_id === actorId()
          && entry.access_level === 'coach'
          && entry.state === 'active'
        ));
        if (membership) contexts.push({
          kind: 'group', id: occurrence.group_id,
          label: (groupState.groups ?? []).find(({ id }) => id === occurrence.group_id)?.name
            ?? 'Group coaching',
        });
        return contexts;
      };
      return state.participations
        .filter(({ profile_id: id }) => id === profileId)
        .map((participation) => ({
          participation,
          occurrence: state.occurrences.find(({ id }) => id === participation.occurrence_id),
        }))
        .filter(({ occurrence }) => occurrence.local_date === input.localDate)
        .map(({ occurrence, participation }) => {
          const feedbackContexts = contextsFor(occurrence);
          const allowedIds = new Set(feedbackContexts.map(({ id }) => id));
          const rounds = dayRounds(state, occurrence, participation);
          return {
            id: occurrence.id, item_type: 'completed', kind: occurrence.kind,
            occurrence_id: occurrence.id,
            resources: state.resources
              .filter(({ occurrence_id: id }) => id === occurrence.id)
              .map((resource) => ({ ...resource, can_edit: resource.added_by === actorId() })),
            can_add_resources: occurrence.recorded_by === actorId(),
            status: 'completed', starts_at: occurrence.occurred_at,
            duration_minutes: participation.actual_duration_minutes,
            group_id: occurrence.group_id,
            participation_id: participation.id,
            personal_notes: profileId === actorId() ? participation.personal_notes : null,
            rounds,
            feedback_contexts: feedbackContexts,
            feedback: state.feedback
              .filter(({ participation_id: id }) => id === participation.id)
              .filter((entry) => profileId === actorId()
                || allowedIds.has(entry.group_id ?? entry.connection_id))
              .map((entry) => ({
                ...entry,
                coach_name: entry.coach_name
                  ?? JSON.parse(storage.getItem('roda.e2e.profile') ?? '{}').display_name
                  ?? 'Coach',
              })),
          };
        });
    },
  };
}

export function createE2EStatisticsService({ window }) {
  const { localStorage: storage } = window;

  function trainingState() {
    return {
      occurrences: [], participations: [], assessments: [],
      ...JSON.parse(storage.getItem('roda.e2e.trainingState') ?? '{}'),
    };
  }

  function groupState() {
    return {
      memberships: [], rosters: {},
      ...JSON.parse(storage.getItem('roda.e2e.groupState') ?? '{}'),
    };
  }

  function actorId() {
    return readSession(storage)?.user?.id ?? 'practitioner-1';
  }

  function profileFor(profileId, roster = []) {
    if (profileId === actorId()) {
      const profile = JSON.parse(storage.getItem('roda.e2e.profile') ?? '{}');
      return {
        profile_id: profileId,
        display_name: profile.display_name ?? 'Capoeirista',
        avatar_path: profile.avatar_path ?? null,
        leaderboard_visible: profile.leaderboard_visible !== false,
        graduation: profile.graduation ?? null,
      };
    }
    const entry = roster.find(({ profile_id: id }) => id === profileId) ?? {};
    return {
      profile_id: profileId,
      display_name: entry.display_name ?? 'Group member',
      avatar_path: entry.avatar_path ?? null,
      leaderboard_visible: entry.leaderboard_visible !== false,
      graduation: entry.graduation ?? null,
    };
  }

  function inRange(date, start, endExclusive) {
    return date >= start && date < endExclusive;
  }

  function activityFor(profileId, start, endExclusive) {
    const state = trainingState();
    return state.participations.flatMap((participation) => {
      if (participation.profile_id !== profileId) return [];
      const occurrence = state.occurrences.find(({ id }) => id === participation.occurrence_id);
      if (!occurrence || !inRange(occurrence.local_date, start, endExclusive)) return [];
      return [{ participation, occurrence }];
    });
  }

  return {
    async getPersonal({ start, endExclusive, timezone }) {
      const activity = activityFor(actorId(), start, endExclusive);
      const totalMinutes = activity.reduce((sum, { participation }) => (
        sum + Number(participation.actual_duration_minutes ?? 0)
      ), 0);
      const days = [...new Set(activity.map(({ occurrence }) => occurrence.local_date))].sort();
      let currentStreak = 0;
      for (let index = days.length - 1; index >= 0; index -= 1) {
        if (index === days.length - 1) currentStreak = 1;
        else {
          const later = new Date(`${days[index + 1]}T00:00:00Z`);
          const earlier = new Date(`${days[index]}T00:00:00Z`);
          if ((later - earlier) / 86400000 !== 1) break;
          currentStreak += 1;
        }
      }
      const contexts = new Map();
      const movements = new Map();
      activity.forEach(({ participation, occurrence }) => {
        const context = contexts.get(occurrence.kind) ?? { kind: occurrence.kind, session_count: 0, total_minutes: 0 };
        context.session_count += 1;
        context.total_minutes += Number(participation.actual_duration_minutes ?? 0);
        contexts.set(occurrence.kind, context);
        (occurrence.rounds ?? []).flatMap(({ movements: items = [] }) => items).forEach((movement) => {
          const key = movement.movement_key ?? movement.movementKey;
          const current = movements.get(key) ?? {
            movement_key: key,
            movement_name: movement.movement_name_snapshot ?? movement.movementName ?? key,
            session_count: 0,
          };
          current.session_count += 1;
          movements.set(key, current);
        });
      });
      const highest = Math.max(0, ...[...movements.values()].map(({ session_count: count }) => count));
      const rangeDays = Math.max(1, (new Date(`${endExclusive}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000);
      const roundRatings = trainingState().roundRatings ?? {};
      const pairs = new Map();
      for (const { participation } of activity) {
        for (const rating of Object.values(roundRatings[participation.id] ?? {}).flat()) {
          if (!['transition', 'loop'].includes(rating.segment_kind)
            || !rating.from_movement_key || !rating.to_movement_key) continue;
          const pairKey = `${rating.from_movement_key}>${rating.to_movement_key}`;
          const entry = pairs.get(pairKey) ?? {
            from_movement_key: rating.from_movement_key, to_movement_key: rating.to_movement_key,
            from_name: rating.from_movement_key, to_name: rating.to_movement_key,
            hard_count: 0, rating_count: 0,
          };
          entry.rating_count += 1;
          if (rating.difficulty === 'hard') entry.hard_count += 1;
          pairs.set(pairKey, entry);
        }
      }
      const hardestTransitions = [...pairs.values()].filter(({ hard_count: count }) => count > 0)
        .sort((a, b) => b.hard_count - a.hard_count || b.rating_count - a.rating_count
          || a.from_movement_key.localeCompare(b.from_movement_key))
        .slice(0, 5);
      return {
        range_start: start, range_end_exclusive: endExclusive, timezone,
        session_count: activity.length, total_minutes: totalMinutes, current_streak: currentStreak,
        average_trainings_per_week: Number((activity.length / Math.max(1, rangeDays / 7)).toFixed(2)),
        average_hours_per_month: Number(((totalMinutes / 60) / Math.max(1, rangeDays / 30.4375)).toFixed(2)),
        context_distribution: [...contexts.values()],
        favorite_movements: [...movements.values()].filter(({ session_count: count }) => count === highest && highest),
        difficulty_trends: [],
        hardest_transitions: hardestTransitions,
      };
    },

    async getGroup({ groupId, start, endExclusive, metric }) {
      const groups = groupState();
      const roster = (groups.rosters[groupId] ?? []).filter((member) => (
        member.membership_state !== 'ended' && member.state !== 'ended'
        && (member.access_level ?? 'member') === 'member'
      ));
      const members = roster.map((member) => profileFor(member.profile_id, roster));
      const rows = members.map((member) => {
        const activity = activityFor(member.profile_id, start, endExclusive);
        const totalMinutes = activity.reduce((sum, { participation }) => (
          sum + Number(participation.actual_duration_minutes ?? 0)
        ), 0);
        return {
          ...member,
          total_minutes: totalMinutes,
          session_count: activity.length,
          selected_value: metric === 'sessions' ? activity.length : totalMinutes,
        };
      });
      const anonymous = rows.filter(({ leaderboard_visible: visible }) => !visible);
      const named = rows.filter(({ leaderboard_visible: visible }) => visible)
        .sort((left, right) => right.selected_value - left.selected_value
          || left.display_name.localeCompare(right.display_name));
      let lastValue;
      let rank = 0;
      named.forEach((row, index) => {
        if (row.selected_value !== lastValue) rank = index + 1;
        row.rank_position = rank;
        lastValue = row.selected_value;
      });
      const aggregates = {
        anonymous_member_count: anonymous.length,
        anonymous_minutes: anonymous.reduce((sum, row) => sum + row.total_minutes, 0),
        anonymous_sessions: anonymous.reduce((sum, row) => sum + row.session_count, 0),
      };
      return (named.length ? named : [{
        profile_id: null, display_name: null, avatar_path: null,
        rank_position: null, total_minutes: 0, session_count: 0, selected_value: null,
      }]).map((row) => ({ ...row, ...aggregates }));
    },

    async searchMembers({ groupId, search = '', limit = 20, offset = 0 }) {
      const roster = groupState().rosters[groupId] ?? [];
      const query = search.trim().toLocaleLowerCase();
      return roster
        .filter((member) => (member.access_level ?? 'member') === 'member')
        .map((member) => profileFor(member.profile_id, roster))
        .filter(({ display_name: name }) => !query || name.toLocaleLowerCase().includes(query))
        .sort((left, right) => left.display_name.localeCompare(right.display_name))
        .slice(offset, offset + limit)
        .map(({ profile_id, display_name, avatar_path, graduation }) => ({
          profile_id, display_name, avatar_path, graduation,
        }));
    },
  };
}

export function createE2ERepertoireService({ window }) {
  const { localStorage: storage } = window;
  const key = 'roda.e2e.repertoireState';
  const read = () => ({ items: [], counter: 0, ...JSON.parse(storage.getItem(key) ?? '{}') });
  const write = (state) => storage.setItem(key, JSON.stringify(state));
  const owner = () => readSession(storage)?.user?.id ?? 'practitioner-1';
  return {
    async list() {
      return read().items.filter(({ profile_id: id }) => id === owner())
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map(({ profile_id: _owner, import_ref: _ref, ...item }) => item);
    },
    async save({ id = null, title, sourceText, sequence = null }) {
      const normalized = normalizeSequenceInput({ title, sourceText });
      const state = read();
      let item = id ? state.items.find((entry) => entry.id === id && entry.profile_id === owner()) : null;
      if (id && !item) throw new AppError('authorization', 'not_authorized');
      state.counter += 1;
      const now = new Date(Date.UTC(2026, 9, 10, 12, 0, state.counter)).toISOString();
      if (!item) {
        item = { id: `sequence-${state.counter}`, profile_id: owner(), import_ref: null };
        state.items.push(item);
      }
      Object.assign(item, { title: normalized.title, source_text: normalized.text, sequence, updated_at: now });
      write(state);
      return { status: 'saved', sequence_id: item.id };
    },
    async remove(id) {
      const state = read();
      const before = state.items.length;
      state.items = state.items.filter((entry) => !(entry.id === id && entry.profile_id === owner()));
      if (state.items.length === before) throw new AppError('authorization', 'not_authorized');
      write(state);
      return { status: 'deleted', sequence_id: id };
    },
    async importItems(items) {
      const state = read();
      let imported = 0;
      for (const entry of items) {
        if (state.items.some((item) => item.profile_id === owner() && item.import_ref === entry.import_ref)) continue;
        state.counter += 1;
        state.items.push({
          id: `sequence-${state.counter}`, profile_id: owner(), import_ref: entry.import_ref,
          title: entry.title || entry.source_text.slice(0, 60), source_text: entry.source_text,
          sequence: entry.sequence ?? null,
          updated_at: new Date(Date.UTC(2026, 9, 10, 12, 0, state.counter)).toISOString(),
        });
        imported += 1;
      }
      write(state);
      return { status: 'imported', imported };
    },
  };
}

export function createE2ECatalogService({ window }) {
  const { localStorage: storage } = window;
  const key = 'roda.e2e.catalogState';
  const read = () => ({ mappings: [], ...JSON.parse(storage.getItem(key) ?? '{}') });
  const write = (state) => storage.setItem(key, JSON.stringify(state));
  const curator = () => storage.getItem('roda.e2e.catalogCurator') === 'true';
  const requireCurator = () => {
    if (!curator()) throw new AppError('authorization', 'not_authorized');
  };
  const training = () => JSON.parse(storage.getItem('roda.e2e.trainingState') ?? '{}');
  const writeTraining = (state) => storage.setItem('roda.e2e.trainingState', JSON.stringify(state));
  const upsert = (term, values) => {
    const state = read();
    const existing = state.mappings.find((mapping) => mapping.term === term);
    if (existing) Object.assign(existing, values);
    else state.mappings.push({ term, action: null, target_slug: null, target_term: null, needs_video: false, ...values });
    write(state);
  };
  const relink = (term, targetKey, catalogued) => {
    const state = training();
    let relinked = 0;
    for (const occurrence of state.occurrences ?? []) {
      for (const round of occurrence.rounds ?? []) {
        for (const movement of round.movements ?? []) {
          if (movement.movement_key === term && movement.catalogued === false) {
            movement.movement_key = targetKey;
            movement.catalogued = catalogued;
            relinked += 1;
          }
        }
      }
    }
    writeTraining(state);
    return relinked;
  };
  return {
    async listTermMappings() {
      return read().mappings;
    },
    async amICurator() {
      return curator();
    },
    async listUncataloguedTerms() {
      requireCurator();
      const handled = new Set(read().mappings.filter(({ action }) => action).map(({ term }) => term));
      const flagged = new Set(read().mappings.filter(({ needs_video: flag }) => flag).map(({ term }) => term));
      const state = training();
      const byTerm = new Map();
      for (const participation of state.participations ?? []) {
        const occurrence = (state.occurrences ?? []).find(({ id }) => id === participation.occurrence_id);
        for (const round of occurrence?.rounds ?? []) {
          for (const movement of round.movements ?? []) {
            if (movement.catalogued !== false || handled.has(movement.movement_key)) continue;
            if (movement.movement_key.length > 40 || movement.movement_key.split('-').length > 4) continue;
            const entry = byTerm.get(movement.movement_key) ?? {
              term: movement.movement_key, spelling: movement.movement_name, people: new Set(), uses: 0,
              first_seen: occurrence.occurred_at ?? null, last_seen: occurrence.occurred_at ?? null,
              needs_video: flagged.has(movement.movement_key),
            };
            entry.people.add(participation.profile_id);
            entry.uses += 1;
            byTerm.set(movement.movement_key, entry);
          }
        }
      }
      return [...byTerm.values()]
        .map((entry) => ({ ...entry, people: entry.people.size }))
        .sort((a, b) => b.people - a.people || b.uses - a.uses || a.term.localeCompare(b.term));
    },
    async mapTerm(term, targetSlug) {
      requireCurator();
      requireTerm(term); requireTerm(targetSlug);
      upsert(term, { action: 'alias', target_slug: targetSlug, target_term: null });
      return { status: 'saved', relinked: relink(term, targetSlug, true) };
    },
    async mergeTerm(term, targetTerm) {
      requireCurator();
      requireTerm(term); requireTerm(targetTerm);
      upsert(term, { action: 'merge', target_slug: null, target_term: targetTerm });
      return { status: 'saved', relinked: relink(term, targetTerm, false) };
    },
    async ignoreTerm(term) {
      requireCurator();
      upsert(requireTerm(term), { action: 'ignore', target_slug: null, target_term: null });
      return { status: 'saved' };
    },
    async setNeedsVideo(term, needsVideo) {
      requireCurator();
      upsert(requireTerm(term), { needs_video: Boolean(needsVideo) });
      return { status: 'saved' };
    },
  };
}
