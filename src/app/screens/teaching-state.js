// src/app/screens/teaching-state.js
export function coachGroups(memberships = []) {
  return memberships
    .filter((membership) => membership.state === 'active' && membership.access_level === 'coach'
      && membership.group && !membership.group.archived_at)
    .map((membership) => ({
      id: membership.group_id,
      name: membership.group.name,
      timezone: membership.group.timezone ?? null,
      ownerId: membership.group.owner_id ?? null,
    }));
}

// Ruling R21: active coaching connections (direct or through a group) plus the
// active members of groups I coach, never myself.
export function coachStudents({ profileId, connections = [], rosters = {} }) {
  const byId = new Map();
  const entry = (id, name) => byId.get(id) ?? { profileId: id, name, connectionId: null, groupId: null };
  for (const connection of connections) {
    if (connection.state !== 'active' || connection.coach_profile_id !== profileId) continue;
    if (connection.student_profile_id === profileId) continue;
    const student = entry(connection.student_profile_id, connection.student_display_name);
    if (connection.connection_kind === 'direct') student.connectionId ??= connection.connection_id;
    else student.groupId ??= connection.group_id ?? null;
    byId.set(student.profileId, student);
  }
  for (const [groupId, roster] of Object.entries(rosters)) {
    for (const member of roster ?? []) {
      if (member.access_level !== 'member' || (member.membership_state ?? 'active') !== 'active') continue;
      if (member.profile_id === profileId) continue;
      const student = entry(member.profile_id, member.display_name);
      student.groupId ??= groupId;
      byId.set(student.profileId, student);
    }
  }
  return [...byId.values()].sort((left, right) => String(left.name).localeCompare(String(right.name)));
}

export function studentContext(student) {
  return student?.connectionId
    ? { groupId: null, connectionId: student.connectionId }
    : { groupId: student?.groupId ?? null, connectionId: null };
}

export function pendingStudentRequests({ profileId, connections = [] }) {
  return connections.filter((connection) => connection.connection_kind === 'direct'
    && connection.state === 'pending' && connection.coach_profile_id === profileId
    && connection.initiated_by !== profileId);
}

export async function loadTeaching(ctx) {
  const { services, profile } = ctx;
  const [plans, connections, memberships] = await Promise.all([
    services.training.listPlans(null),
    services.connection.listMine(),
    services.group.listMyMemberships(),
  ]);
  const groups = coachGroups(memberships);
  const rosters = Object.fromEntries(await Promise.all(groups.map(async (group) => [
    group.id, await services.group.listRoster(group.id).catch(() => []),
  ])));
  return {
    plans, connections, memberships, groups, rosters,
    students: coachStudents({ profileId: profile.id, connections, rosters }),
  };
}
