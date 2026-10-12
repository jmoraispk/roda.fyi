// tests/unit/group-screen.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderGroup } from '../../src/app/screens/group.js';
import { closeSheet } from '../../src/app/shell/sheet.js';
import { appCtx } from './app-test-context.js';

function groupServices(overrides = {}) {
  return {
    listMyMemberships: vi.fn().mockResolvedValue([{
      group_id: 'g1', state: 'active', access_level: 'coach',
      group: { id: 'g1', name: 'Grupo Lua', owner_id: 'other', location: 'Lisbon', timezone: 'Europe/Lisbon', description: 'Tuesdays and Thursdays', is_discoverable: true, archived_at: null },
    }]),
    listRoster: vi.fn().mockResolvedValue([
      { profile_id: 'me', display_name: 'Ana Silva', access_level: 'coach', membership_state: 'active' },
      { profile_id: 'other', display_name: 'Mestre Sol', access_level: 'coach', membership_state: 'active' },
      { profile_id: 'bia', display_name: 'Bia Santos', access_level: 'member', membership_state: 'active' },
    ]),
    listJoinRequests: vi.fn().mockResolvedValue([
      { id: 'r1', display_name: 'Caio Lima', requested_access: 'member', state: 'pending' },
      { id: 'r2', display_name: 'Duda Reis', requested_access: 'coach', state: 'pending' },
    ]),
    listRelationships: vi.fn().mockResolvedValue([]),
    createInvitation: vi.fn().mockResolvedValue({ id: 'i1', token: 'invite-1' }),
    decideJoinRequest: vi.fn().mockResolvedValue({ status: 'approved' }),
    removeMember: vi.fn().mockResolvedValue({ status: 'removed' }),
    leaveGroup: vi.fn().mockResolvedValue({ status: 'left' }),
    ...overrides,
  };
}

const route = { name: 'group', params: { id: 'g1' }, query: {} };

describe('group page', () => {
  beforeEach(() => { closeSheet(); document.body.replaceChildren(); });

  it('lets a coach invite, answer requests, and remove members', async () => {
    const group = groupServices();
    document.body.replaceChildren(await renderGroup(appCtx({ services: { group } }), route));
    expect(document.querySelector('h1').textContent).toBe('Grupo Lua');
    expect(document.body.textContent).toContain('Coach · Lisbon · Europe/Lisbon');
    document.querySelector('input[name="inviteEmail"]').value = 'caio@example.com';
    document.querySelector('[data-action="create-invite"]').click();
    await vi.waitFor(() => expect(document.querySelector('input[aria-label="Invitation link"]').value).toMatch(/\/dashboard\?member_invite=invite-1$/));
    expect(group.createInvitation).toHaveBeenCalledWith('g1', 'caio@example.com');
    expect(document.querySelector('[data-join-request="r2"] [data-decision="approved"]')).toBeNull();
    document.querySelector('[data-join-request="r1"] [data-decision="approved"]').click();
    await vi.waitFor(() => expect(group.decideJoinRequest).toHaveBeenCalledWith('r1', 'approved'));
    await vi.waitFor(() => expect(group.listMyMemberships).toHaveBeenCalledTimes(2));
    expect(document.querySelector('[data-member="me"] [data-action="remove-member"]')).toBeNull();
    expect(document.querySelector('[data-member="other"] [data-action="remove-member"]')).toBeNull();
    const remove = document.querySelector('[data-member="bia"] [data-action="remove-member"]');
    remove.click();
    remove.click();
    await vi.waitFor(() => expect(group.removeMember).toHaveBeenCalledWith('g1', 'bia'));
  });

  it('lets a member leave after a second tap', async () => {
    const group = groupServices({
      listMyMemberships: vi.fn().mockResolvedValue([{
        group_id: 'g1', state: 'active', access_level: 'member', group: { id: 'g1', name: 'Grupo Lua', owner_id: 'other', archived_at: null },
      }]),
    });
    const ctx = appCtx({ services: { group } });
    document.body.replaceChildren(await renderGroup(ctx, route));
    expect(group.listRoster).not.toHaveBeenCalled();
    expect(document.querySelector('[data-action="create-invite"]')).toBeNull();
    const leave = document.querySelector('[data-action="leave-group"]');
    leave.click();
    leave.click();
    await vi.waitFor(() => expect(group.leaveGroup).toHaveBeenCalledWith('g1'));
    expect(ctx.navigate).toHaveBeenCalledWith('/me/groups');
  });

  it('explains a group I am not in', async () => {
    const group = groupServices({ listMyMemberships: vi.fn().mockResolvedValue([]) });
    const view = await renderGroup(appCtx({ services: { group } }), route);
    expect(view.textContent).toContain("This group isn't available.");
  });

  const owned = () => vi.fn().mockResolvedValue([{
    group_id: 'g1', state: 'active', access_level: 'coach',
    group: { id: 'g1', name: 'Grupo Lua', owner_id: 'me', timezone: 'Europe/Lisbon', is_discoverable: true, archived_at: null },
  }]);

  it('gives owners a discovery link, transfer, hierarchy answers, and archive', async () => {
    const group = groupServices({
      listMyMemberships: owned(),
      listRelationships: vi.fn().mockResolvedValue([
        { id: 'rel1', parent_group_id: 'p', child_group_id: 'g1', state: 'pending', sharing_level: 'named_progress', parent_name: 'Grupo Mãe', child_name: 'Grupo Lua' },
        { id: 'rel2', parent_group_id: 'g1', child_group_id: 'c', state: 'active', sharing_level: 'named_progress', parent_name: 'Grupo Lua', child_name: 'Roda Filha' },
        { id: 'rel3', parent_group_id: 'g1', child_group_id: 'd', state: 'revoked', sharing_level: 'named_progress', parent_name: 'Grupo Lua', child_name: 'Old' },
      ]),
      rotateDiscoveryLink: vi.fn().mockResolvedValue({ status: 'active', token: 'discovery-1' }),
      revokeDiscoveryLink: vi.fn().mockResolvedValue({ status: 'revoked' }),
      decideRelationship: vi.fn().mockResolvedValue({ status: 'active' }),
      transferOwnership: vi.fn().mockResolvedValue({ status: 'transferred' }),
      archiveGroup: vi.fn().mockResolvedValue({ status: 'archived' }),
    });
    const ctx = appCtx({ services: { group } });
    document.body.replaceChildren(await renderGroup(ctx, route));
    expect(document.querySelector('[data-action="leave-group"]')).toBeNull();
    expect(document.querySelector('[data-member="other"] [data-action="remove-member"]')).not.toBeNull();
    document.querySelector('[data-action="discovery-link"]').click();
    await vi.waitFor(() => expect(document.querySelector('input[aria-label="Discovery link"]').value).toMatch(/\/dashboard\?group_link=discovery-1$/));
    document.querySelector('[data-action="revoke-link"]').click();
    await vi.waitFor(() => expect(group.revokeDiscoveryLink).toHaveBeenCalledWith('g1'));
    expect(document.querySelector('[data-group-status]').textContent).toBe('Discovery link revoked.');
    expect([...document.querySelectorAll('[data-relationship]')].map((row) => row.dataset.relationship)).toEqual(['rel1', 'rel2']);
    expect(document.querySelector('[data-relationship="rel2"] [data-action="revoke-relation"]')).not.toBeNull();
    document.querySelector('[data-relationship="rel1"] [data-relation-decision="accepted"]').click();
    await vi.waitFor(() => expect(group.decideRelationship).toHaveBeenCalledWith('rel1', 'accepted'));
    await vi.waitFor(() => expect(group.listMyMemberships).toHaveBeenCalledTimes(2));
    document.querySelector('[data-action="transfer"]').click();
    const sheet = document.querySelector('[role="dialog"]');
    expect([...sheet.querySelectorAll('select[name="newOwner"] option')].map((option) => option.value)).toEqual(['other']);
    sheet.querySelector('form').requestSubmit();
    await vi.waitFor(() => expect(group.transferOwnership).toHaveBeenCalledWith('g1', 'other'));
    await vi.waitFor(() => expect(group.listMyMemberships).toHaveBeenCalledTimes(3));
    const archive = document.querySelector('[data-action="archive-group"]');
    archive.click();
    expect(group.archiveGroup).not.toHaveBeenCalled();
    archive.click();
    await vi.waitFor(() => expect(group.archiveGroup).toHaveBeenCalledWith('g1'));
    expect(ctx.navigate).toHaveBeenCalledWith('/me/groups');
  });

  it('invites a child group and saves what the parent sees', async () => {
    const group = groupServices({
      listMyMemberships: owned(),
      listRelationships: vi.fn().mockResolvedValue([
        { id: 'rel4', parent_group_id: 'p', child_group_id: 'g1', state: 'active', sharing_level: 'named_progress', parent_name: 'Grupo Mãe', child_name: 'Grupo Lua' },
      ]),
      searchGroups: vi.fn().mockResolvedValue([{ id: 'g1', name: 'Grupo Lua' }, { id: 'g7', name: 'Roda Sete' }]),
      inviteChildGroup: vi.fn().mockResolvedValue({ status: 'pending' }),
      setRelationshipSharing: vi.fn().mockResolvedValue({ status: 'updated' }),
    });
    document.body.replaceChildren(await renderGroup(appCtx({ services: { group } }), route));
    const sharing = document.querySelector('[data-relationship="rel4"] select[name="sharing"]');
    expect(sharing.value).toBe('named_progress');
    sharing.value = 'full_coaching';
    sharing.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(group.setRelationshipSharing).toHaveBeenCalledWith('rel4', 'full_coaching'));
    expect(document.querySelector('[data-group-status]').textContent).toBe('Sharing saved.');
    document.querySelector('[data-action="invite-child"]').click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"] select[name="childGroup"]')).not.toBeNull());
    expect([...document.querySelectorAll('[role="dialog"] select[name="childGroup"] option')].map((option) => option.value)).toEqual(['g7']);
    document.querySelector('[role="dialog"] form').requestSubmit();
    await vi.waitFor(() => expect(group.inviteChildGroup).toHaveBeenCalledWith('g1', 'g7'));
    expect(document.querySelector('[data-group-status]').textContent).toBe('Group invitation sent.');
  });
});
