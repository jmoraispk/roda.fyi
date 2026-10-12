// tests/unit/teaching-state.test.js
import { describe, expect, it, vi } from 'vitest';

import {
  coachGroups, coachStudents, loadTeaching, pendingStudentRequests, studentContext,
} from '../../src/app/screens/teaching-state.js';

const connections = [
  { connection_id: 'c1', connection_kind: 'direct', state: 'active', coach_profile_id: 'me', student_profile_id: 'bia', student_display_name: 'Bia Santos' },
  { connection_id: null, connection_kind: 'group', state: 'active', coach_profile_id: 'me', student_profile_id: 'bia', student_display_name: 'Bia Santos', group_id: 'g1' },
  { connection_id: 'c2', connection_kind: 'direct', state: 'pending', coach_profile_id: 'me', student_profile_id: 'eva', student_display_name: 'Eva Costa', initiated_by: 'eva' },
  { connection_id: 'c3', connection_kind: 'direct', state: 'active', coach_profile_id: 'mestre', student_profile_id: 'me', student_display_name: 'Ana' },
];
const rosters = {
  g1: [
    { profile_id: 'me', display_name: 'Ana', access_level: 'coach', membership_state: 'active' },
    { profile_id: 'caio', display_name: 'Caio Lima', access_level: 'member', membership_state: 'active' },
    { profile_id: 'duda', display_name: 'Duda Reis', access_level: 'member', membership_state: 'removed' },
  ],
};

describe('teaching state', () => {
  it('merges connections and coached rosters into one student list', () => {
    expect(coachStudents({ profileId: 'me', connections, rosters })).toEqual([
      { profileId: 'bia', name: 'Bia Santos', connectionId: 'c1', groupId: 'g1' },
      { profileId: 'caio', name: 'Caio Lima', connectionId: null, groupId: 'g1' },
    ]);
  });

  it('uses the direct connection for personal classes when there is one', () => {
    expect(studentContext({ connectionId: 'c1', groupId: 'g1' })).toEqual({ groupId: null, connectionId: 'c1' });
    expect(studentContext({ connectionId: null, groupId: 'g1' })).toEqual({ groupId: 'g1', connectionId: null });
  });

  it('lists coached groups and pending student requests', () => {
    const memberships = [
      { group_id: 'g1', state: 'active', access_level: 'coach', group: { name: 'Grupo Lua', timezone: 'Europe/Lisbon', owner_id: 'me', archived_at: null } },
      { group_id: 'g2', state: 'active', access_level: 'member', group: { name: 'Other', archived_at: null } },
      { group_id: 'g3', state: 'left', access_level: 'coach', group: { name: 'Old', archived_at: null } },
      { group_id: 'g4', state: 'active', access_level: 'coach', group: { name: 'Archived', archived_at: '2026-01-01T00:00:00Z' } },
    ];
    expect(coachGroups(memberships)).toEqual([{ id: 'g1', name: 'Grupo Lua', timezone: 'Europe/Lisbon', ownerId: 'me' }]);
    expect(pendingStudentRequests({ profileId: 'me', connections }).map(({ connection_id: id }) => id)).toEqual(['c2']);
  });

  it('loads everything a coach needs at once', async () => {
    const services = {
      training: { listPlans: vi.fn().mockResolvedValue([{ plan_id: 'p1' }]) },
      connection: { listMine: vi.fn().mockResolvedValue(connections) },
      group: {
        listMyMemberships: vi.fn().mockResolvedValue([{ group_id: 'g1', state: 'active', access_level: 'coach', group: { name: 'Grupo Lua' } }]),
        listRoster: vi.fn().mockResolvedValue(rosters.g1),
      },
    };
    const teaching = await loadTeaching({ services, profile: { id: 'me' } });
    expect(services.training.listPlans).toHaveBeenCalledWith(null);
    expect(services.group.listRoster).toHaveBeenCalledWith('g1');
    expect(teaching.groups.map(({ id }) => id)).toEqual(['g1']);
    expect(teaching.students.map(({ profileId }) => profileId)).toEqual(['bia', 'caio']);
    expect(teaching.plans).toEqual([{ plan_id: 'p1' }]);
  });
});
