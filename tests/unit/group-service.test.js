import { describe, expect, it } from 'vitest';

import { createGroupService } from '../../src/app/group-service.js';

function rpcClient(result = { data: { status: 'ok' }, error: null }) {
  const calls = [];
  return {
    calls,
    client: {
      rpc: async (name, params = {}) => {
        calls.push([name, params]);
        return result;
      },
    },
  };
}

function groupDataClient() {
  const calls = [];
  const data = {
    group_memberships: [{ group_id: 'group-1', access_level: 'member', state: 'active' }],
    group_join_requests: [{ id: 'request-1', state: 'pending' }],
  };
  const client = {
    from(table) {
      return {
        select(columns) {
          calls.push(['select', table, columns]);
          return {
            order: async (column, options) => {
              calls.push(['order', column, options]);
              return { data: data[table], error: null };
            },
          };
        },
      };
    },
    rpc: async (name, params = {}) => {
      calls.push(['rpc', name, params]);
      return { data: { status: 'updated' }, error: null };
    },
    storage: {
      from(bucket) {
        return {
          upload: async (path, file, options) => {
            calls.push(['upload', bucket, path, file, options]);
            return { data: { path }, error: null };
          },
        };
      },
    },
  };
  return { client, calls, data };
}

describe('createGroupService RPC contract', () => {
  it.each([
    ['searchGroups', ['  Bahia  ', 10, 30], 'search_groups', {
      search_text: 'Bahia', result_limit: 10, result_offset: 30,
    }],
    ['resolveDiscoveryToken', [' direct-token '], 'resolve_group_discovery_token', {
      token: 'direct-token',
    }],
    ['listRoster', ['group-1'], 'list_group_roster', { group_id: 'group-1' }],
    ['listJoinRequests', ['group-1'], 'list_group_join_requests', { group_id: 'group-1' }],
    ['listInvitations', ['group-1'], 'list_group_member_invitations', { group_id: 'group-1' }],
    ['listMyInvitations', [], 'list_my_member_invitations', {}],
    ['listRelationships', ['group-1'], 'list_group_relationships', { group_id: 'group-1' }],
    ['createGroup', [{
      name: '  Grupo Sol  ', description: '  Local class  ', location: '  Lisboa  ', discoverable: true,
    }], 'create_group', {
      name: 'Grupo Sol', description: 'Local class', location: 'Lisboa', is_discoverable: true,
    }],
    ['updateGroup', ['group-1', {
      name: 'Grupo Lua', description: '', location: '', discoverable: false,
    }], 'update_group', {
      group_id: 'group-1', name: 'Grupo Lua', description: null, location: null, is_discoverable: false,
    }],
    ['setGroupPicture', ['group-1', 'group-1/picture.webp'], 'set_group_picture', {
      group_id: 'group-1', picture_path: 'group-1/picture.webp',
    }],
    ['transferOwnership', ['group-1', 'coach-2'], 'transfer_group_ownership', {
      group_id: 'group-1', new_owner_id: 'coach-2',
    }],
    ['archiveGroup', ['group-1'], 'archive_group', { group_id: 'group-1' }],
    ['leaveGroup', ['group-1'], 'leave_group', { group_id: 'group-1' }],
    ['removeMember', ['group-1', 'student-1'], 'remove_group_member', {
      group_id: 'group-1', profile_id: 'student-1',
    }],
    ['requestAccess', ['group-1', 'coach', ' direct-token '], 'request_group_access', {
      group_id: 'group-1', requested_access: 'coach', discovery_token: 'direct-token',
    }],
    ['cancelJoinRequest', ['request-1'], 'cancel_group_join_request', { request_id: 'request-1' }],
    ['decideJoinRequest', ['request-1', 'approved'], 'decide_group_join_request', {
      request_id: 'request-1', decision: 'approved',
    }],
    ['createInvitation', ['group-1', ' Learner@Example.com '], 'create_member_invitation', {
      group_id: 'group-1', email: 'learner@example.com',
    }],
    ['acceptInvitation', [' invite-token '], 'accept_member_invitation', { token: 'invite-token' }],
    ['revokeInvitation', ['invite-1'], 'revoke_member_invitation', { invitation_id: 'invite-1' }],
    ['rotateDiscoveryLink', ['group-1'], 'rotate_group_discovery_link', { group_id: 'group-1' }],
    ['revokeDiscoveryLink', ['group-1'], 'revoke_group_discovery_link', { group_id: 'group-1' }],
    ['inviteChildGroup', ['parent-1', 'child-1'], 'invite_child_group', {
      parent_group_id: 'parent-1', child_group_id: 'child-1',
    }],
    ['decideRelationship', ['relationship-1', 'accepted'], 'decide_group_relationship', {
      relationship_id: 'relationship-1', decision: 'accepted',
    }],
    ['setRelationshipSharing', ['relationship-1', 'full_coaching'], 'set_group_relationship_sharing', {
      relationship_id: 'relationship-1', sharing_level: 'full_coaching',
    }],
    ['revokeRelationship', ['relationship-1'], 'revoke_group_relationship', {
      relationship_id: 'relationship-1',
    }],
  ])('%s sends the stable database contract', async (method, args, rpc, params) => {
    const { client, calls } = rpcClient();
    const service = createGroupService(client);

    await service[method](...args);

    expect(calls).toEqual([[rpc, params]]);
  });

  it('normalizes a database authorization failure', async () => {
    const { client } = rpcClient({
      data: null,
      error: { code: 'PT403', message: 'not_authorized' },
    });

    await expect(createGroupService(client).archiveGroup('group-1'))
      .rejects.toMatchObject({ kind: 'authorization', code: 'not_authorized' });
  });

  it('loads only the current user memberships with their group context', async () => {
    const { client, calls, data } = groupDataClient();
    const service = createGroupService(client);

    expect(await service.listMyMemberships()).toEqual(data.group_memberships);
    expect(calls).toEqual([
      ['select', 'group_memberships', 'group_id, profile_id, access_level, state, joined_at, ended_at, group:groups(id, slug, owner_id, name, picture_path, location, is_discoverable, archived_at)'],
      ['order', 'joined_at', { ascending: true }],
    ]);
  });

  it('loads the current user join-request history', async () => {
    const { client, calls, data } = groupDataClient();
    const service = createGroupService(client);

    expect(await service.listMyJoinRequests()).toEqual(data.group_join_requests);
    expect(calls).toEqual([
      ['select', 'group_join_requests', 'id, group_id, profile_id, requested_access, state, expires_at, decided_at, created_at, group:groups(id, slug, name, picture_path, location)'],
      ['order', 'created_at', { ascending: false }],
    ]);
  });

  it('uploads a new group image before assigning the path', async () => {
    const { client, calls } = groupDataClient();
    const service = createGroupService(client, { randomUUID: () => 'group-image-uuid' });
    const file = { name: 'group.webp', type: 'image/webp', size: 2048 };

    expect(await service.uploadGroupPicture('group-1', file)).toEqual({
      status: 'updated',
      path: 'group-1/group-image-uuid.webp',
    });
    expect(calls).toEqual([
      ['upload', 'group-pictures', 'group-1/group-image-uuid.webp', file, {
        cacheControl: '3600',
        contentType: 'image/webp',
        upsert: false,
      }],
      ['rpc', 'set_group_picture', {
        group_id: 'group-1',
        picture_path: 'group-1/group-image-uuid.webp',
      }],
    ]);
  });

  it('rejects an unsupported or oversized group image before upload', async () => {
    const { client, calls } = groupDataClient();
    const service = createGroupService(client, { randomUUID: () => 'group-image-uuid' });

    await expect(service.uploadGroupPicture('group-1', {
      name: 'group.gif', type: 'image/gif', size: 2048,
    })).rejects.toMatchObject({ code: 'invalid_picture_type' });
    await expect(service.uploadGroupPicture('group-1', {
      name: 'group.png', type: 'image/png', size: (5 * 1024 * 1024) + 1,
    })).rejects.toMatchObject({ code: 'picture_too_large' });
    expect(calls).toEqual([]);
  });
});
