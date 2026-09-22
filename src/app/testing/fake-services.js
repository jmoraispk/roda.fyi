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
