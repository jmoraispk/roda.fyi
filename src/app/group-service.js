import { AppError, toAppError } from './errors.js';

function clean(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function optional(value) {
  const normalized = clean(value);
  return normalized || null;
}

const MEMBERSHIP_COLUMNS = 'group_id, profile_id, access_level, state, joined_at, ended_at, group:groups(id, slug, owner_id, name, picture_path, location, timezone, is_discoverable, archived_at)';
const REQUEST_COLUMNS = 'id, group_id, profile_id, requested_access, state, expires_at, decided_at, created_at, group:groups(id, slug, name, picture_path, location)';
const PICTURE_EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});
const MAX_PICTURE_BYTES = 5 * 1024 * 1024;

export function createGroupService(client, options = {}) {
  const randomUUID = options.randomUUID ?? (() => globalThis.crypto.randomUUID());

  async function call(name, params = {}) {
    const result = await client.rpc(name, params);
    if (result.error) throw toAppError(result.error);
    return result.data;
  }

  return {
    async listMyMemberships() {
      const result = await client
        .from('group_memberships')
        .select(MEMBERSHIP_COLUMNS)
        .order('joined_at', { ascending: true });
      if (result.error) throw toAppError(result.error);
      return result.data;
    },
    async listMyJoinRequests() {
      const result = await client
        .from('group_join_requests')
        .select(REQUEST_COLUMNS)
        .order('created_at', { ascending: false });
      if (result.error) throw toAppError(result.error);
      return result.data;
    },
    async uploadGroupPicture(groupId, file) {
      const extension = PICTURE_EXTENSIONS[file?.type];
      if (!extension) {
        throw new AppError(
          'validation',
          'invalid_picture_type',
          'Choose a JPEG, PNG, or WebP image.',
        );
      }
      if (file.size > MAX_PICTURE_BYTES) {
        throw new AppError(
          'validation',
          'picture_too_large',
          'Choose an image no larger than 5 MB.',
        );
      }

      const path = `${groupId}/${randomUUID()}.${extension}`;
      const upload = await client.storage.from('group-pictures').upload(path, file, {
        cacheControl: '3600',
        contentType: file.type,
        upsert: false,
      });
      if (upload.error) throw toAppError(upload.error);
      const assignment = await call('set_group_picture', {
        group_id: groupId,
        picture_path: path,
      });
      return { ...assignment, path };
    },
    searchGroups(searchText = '', resultLimit = 20, resultOffset = 0) {
      return call('search_groups', {
        search_text: clean(searchText),
        result_limit: resultLimit,
        result_offset: resultOffset,
      });
    },
    // The database returns a table: one row for a valid token, none otherwise.
    async resolveDiscoveryToken(token) {
      const rows = await call('resolve_group_discovery_token', { token: clean(token) });
      return Array.isArray(rows) ? rows[0] ?? null : rows ?? null;
    },
    listRoster(groupId) {
      return call('list_group_roster', { group_id: groupId });
    },
    listJoinRequests(groupId) {
      return call('list_group_join_requests', { group_id: groupId });
    },
    listInvitations(groupId) {
      return call('list_group_member_invitations', { group_id: groupId });
    },
    listMyInvitations() {
      return call('list_my_member_invitations');
    },
    listRelationships(groupId) {
      return call('list_group_relationships', { group_id: groupId });
    },
    createGroup({ name, description, location, discoverable, timezone }) {
      return call('create_group', {
        name: clean(name),
        description: optional(description),
        location: optional(location),
        is_discoverable: Boolean(discoverable),
        timezone: clean(timezone) || 'UTC',
      });
    },
    updateGroup(groupId, { name, description, location, discoverable, timezone }) {
      return call('update_group', {
        group_id: groupId,
        name: clean(name),
        description: optional(description),
        location: optional(location),
        is_discoverable: Boolean(discoverable),
        timezone: clean(timezone) || 'UTC',
      });
    },
    setGroupTimezone(groupId, timezone) {
      return call('set_group_timezone', {
        group_id: groupId,
        timezone: clean(timezone),
      });
    },
    setGroupPicture(groupId, picturePath) {
      return call('set_group_picture', {
        group_id: groupId,
        picture_path: clean(picturePath),
      });
    },
    transferOwnership(groupId, newOwnerId) {
      return call('transfer_group_ownership', {
        group_id: groupId,
        new_owner_id: newOwnerId,
      });
    },
    archiveGroup(groupId) {
      return call('archive_group', { group_id: groupId });
    },
    leaveGroup(groupId) {
      return call('leave_group', { group_id: groupId });
    },
    removeMember(groupId, profileId) {
      return call('remove_group_member', {
        group_id: groupId,
        profile_id: profileId,
      });
    },
    requestAccess(groupId, requestedAccess, discoveryToken = null) {
      return call('request_group_access', {
        group_id: groupId,
        requested_access: requestedAccess,
        discovery_token: optional(discoveryToken),
      });
    },
    cancelJoinRequest(requestId) {
      return call('cancel_group_join_request', { request_id: requestId });
    },
    decideJoinRequest(requestId, decision) {
      return call('decide_group_join_request', {
        request_id: requestId,
        decision,
      });
    },
    createInvitation(groupId, email = null) {
      return call('create_member_invitation', {
        group_id: groupId,
        email: optional(email)?.toLowerCase() ?? null,
      });
    },
    acceptInvitation(token) {
      return call('accept_member_invitation', { token: clean(token) });
    },
    revokeInvitation(invitationId) {
      return call('revoke_member_invitation', { invitation_id: invitationId });
    },
    rotateDiscoveryLink(groupId) {
      return call('rotate_group_discovery_link', { group_id: groupId });
    },
    revokeDiscoveryLink(groupId) {
      return call('revoke_group_discovery_link', { group_id: groupId });
    },
    inviteChildGroup(parentGroupId, childGroupId) {
      return call('invite_child_group', {
        parent_group_id: parentGroupId,
        child_group_id: childGroupId,
      });
    },
    decideRelationship(relationshipId, decision) {
      return call('decide_group_relationship', {
        relationship_id: relationshipId,
        decision,
      });
    },
    setRelationshipSharing(relationshipId, sharingLevel) {
      return call('set_group_relationship_sharing', {
        relationship_id: relationshipId,
        sharing_level: sharingLevel,
      });
    },
    revokeRelationship(relationshipId) {
      return call('revoke_group_relationship', { relationship_id: relationshipId });
    },
  };
}
