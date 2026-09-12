// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import { AppError } from '../../src/app/errors.js';
import { createGroupView } from '../../src/app/ui/group-view.js';

function fixture() {
  document.body.innerHTML = `
    <p id="groupStatus" role="status"></p>
    <section id="groupDiscovery"></section>
    <section id="groupManagement"></section>
  `;
}

const group = {
  id: 'group-1',
  owner_id: 'owner-1',
  name: 'Grupo Lua',
  slug: 'grupo-lua',
  description: 'Tuesday training',
  location: 'Lisbon',
};

const roster = [
  { profile_id: 'student-1', display_name: 'Ana', access_level: 'member', membership_state: 'active' },
  { profile_id: 'coach-2', display_name: 'Professor Sol', access_level: 'coach', membership_state: 'active' },
];

const requests = [
  { id: 'request-member', display_name: 'Bia', requested_access: 'member', state: 'pending' },
  { id: 'request-coach', display_name: 'Instrutora Céu', requested_access: 'coach', state: 'pending' },
];

function service(overrides = {}) {
  return {
    searchGroups: async () => [group],
    requestAccess: async () => ({ status: 'pending' }),
    createInvitation: async () => ({ status: 'pending', token: 'invite-token' }),
    decideJoinRequest: async () => ({ status: 'approved' }),
    removeMember: async () => ({ status: 'removed' }),
    ...overrides,
  };
}

beforeEach(fixture);

describe('group discovery actions', () => {
  it('ignores stale search results when a newer query finishes first', async () => {
    let finishFirst;
    const firstSearch = new Promise((resolve) => { finishFirst = resolve; });
    const view = createGroupView({
      document,
      groupService: service({
        searchGroups: (query) => query === 'Lua'
          ? firstSearch
          : Promise.resolve([{ ...group, id: 'group-2', name: 'Grupo Sol' }]),
      }),
      identity: { profileId: 'student-1', isCoach: false },
    });
    const first = view.showDiscovery('Lua');
    await view.showDiscovery('Sol');
    finishFirst([group]);
    await first;

    expect(document.querySelector('#groupDiscovery').textContent).toContain('Grupo Sol');
    expect(document.querySelector('#groupDiscovery').textContent).not.toContain('Grupo Lua');
  });

  it('lets every signed-in practitioner search and request member access', () => {
    const view = createGroupView({
      document,
      groupService: service(),
      identity: { profileId: 'student-1', isCoach: false },
    });

    view.renderDiscovery([group]);

    expect(document.querySelector('input[type="search"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Grupo Lua');
    expect(document.querySelector('[data-action="request-member"]')).not.toBeNull();
    expect(document.querySelector('[data-action="request-coach"]')).toBeNull();
    expect(document.querySelector('[data-action="create-group"]')).toBeNull();
  });

  it('adds coach-access requests and group creation only for registered coaches', () => {
    const view = createGroupView({
      document,
      groupService: service(),
      identity: { profileId: 'coach-1', isCoach: true },
    });

    view.renderDiscovery([group]);

    expect(document.querySelector('[data-action="request-coach"]')).not.toBeNull();
    expect(document.querySelector('[data-action="create-group"]')).not.toBeNull();
  });
});

describe('group management actions', () => {
  it('ignores a stale management response after the user switches groups', async () => {
    let finishFirst;
    const firstRoster = new Promise((resolve) => { finishFirst = resolve; });
    const view = createGroupView({
      document,
      groupService: service({
        listRoster: (groupId) => groupId === 'group-1' ? firstRoster : Promise.resolve([]),
        listJoinRequests: async () => [],
        listRelationships: async () => [],
      }),
      identity: { profileId: 'coach-1', isCoach: true },
    });
    const first = view.loadManagement(group, { access_level: 'coach', state: 'active' });
    await view.loadManagement(
      { ...group, id: 'group-2', name: 'Grupo Sol' },
      { access_level: 'coach', state: 'active' },
    );
    finishFirst(roster);
    await first;

    expect(document.querySelector('#groupManagement').textContent).toContain('Grupo Sol');
    expect(document.querySelector('#groupManagement').textContent).not.toContain('Grupo Lua');
    expect(document.querySelector('#groupManagement').textContent).not.toContain('Ana');
  });

  it('shows a direct coach member-management actions but not owner actions', () => {
    const view = createGroupView({
      document,
      groupService: service(),
      identity: { profileId: 'coach-1', isCoach: true },
    });

    view.renderManagement({
      group,
      membership: { access_level: 'coach', state: 'active' },
      roster,
      requests,
      relationships: [],
    });

    expect(document.body.textContent).toContain('Invite a student');
    expect(document.querySelector('[data-request-id="request-member"][data-decision="approve"]')).not.toBeNull();
    expect(document.querySelector('[data-profile-id="student-1"][data-action="remove-member"]')).not.toBeNull();
    expect(document.querySelector('[data-request-id="request-coach"][data-decision="approve"]')).toBeNull();
    expect(document.querySelector('[data-action="transfer-ownership"]')).toBeNull();
    expect(document.querySelector('[data-action="archive-group"]')).toBeNull();
  });

  it('adds owner-only coach, transfer, archive, child, and sharing controls without leave', () => {
    const view = createGroupView({
      document,
      groupService: service(),
      identity: { profileId: 'owner-1', isCoach: true },
    });

    view.renderManagement({
      group,
      membership: { access_level: 'coach', state: 'active' },
      roster,
      requests,
      relationships: [{
        id: 'relationship-1', parent_group_id: 'parent-1', child_group_id: 'group-1',
        state: 'active', sharing_level: 'named_progress',
      }],
    });

    expect(document.querySelector('[data-request-id="request-coach"][data-decision="approve"]')).not.toBeNull();
    expect(document.querySelector('[data-profile-id="coach-2"][data-action="remove-member"]')).not.toBeNull();
    expect(document.querySelector('[data-action="transfer-ownership"]')).not.toBeNull();
    expect(document.querySelector('[data-action="archive-group"]')).not.toBeNull();
    expect(document.querySelector('[data-action="invite-child-group"]')).not.toBeNull();
    expect(document.querySelector('[data-action="relationship-settings"]')).not.toBeNull();
    expect(document.querySelector('[data-action="revoke-relationship"]')).not.toBeNull();
    expect(document.querySelector('[data-action="leave-group"]')).toBeNull();
  });

  it('does not let a parent owner change child sharing but can revoke the relationship', () => {
    const view = createGroupView({
      document,
      groupService: service(),
      identity: { profileId: 'owner-1', isCoach: true },
    });

    view.renderManagement({
      group,
      membership: { access_level: 'coach', state: 'active' },
      roster,
      requests: [],
      relationships: [{
        id: 'relationship-1', parent_group_id: 'group-1', child_group_id: 'child-1',
        state: 'active', sharing_level: 'full_coaching',
      }],
    });

    expect(document.querySelector('[data-action="relationship-settings"]')).toBeNull();
    expect(document.querySelector('[data-action="revoke-relationship"]')).not.toBeNull();
  });

  it('shows a safe service error instead of treating hidden controls as authorization', async () => {
    const view = createGroupView({
      document,
      groupService: service({
        createInvitation: async () => {
          throw new AppError('authorization', 'not_authorized');
        },
      }),
      identity: { profileId: 'coach-1', isCoach: true },
    });
    view.renderManagement({
      group,
      membership: { access_level: 'coach', state: 'active' },
      roster,
      requests,
      relationships: [],
    });

    document.querySelector('[data-action="invite-member"]').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.querySelector('#groupStatus').textContent)
      .toBe('You do not have permission to do that.');
  });

  it('removes roster, request, invitation, and relationship content after revocation', () => {
    const view = createGroupView({
      document,
      groupService: service(),
      identity: { profileId: 'owner-1', isCoach: true },
    });
    view.renderManagement({
      group,
      membership: { access_level: 'coach', state: 'active' },
      roster,
      requests,
      relationships: [{ id: 'relationship-1', sharing_level: 'full_coaching' }],
    });

    view.clearPrivate();

    expect(document.querySelector('#groupManagement').textContent).toBe('');
    expect(document.body.textContent).not.toContain('Ana');
    expect(document.body.textContent).not.toContain('Instrutora Céu');
  });
});
