import { describe, expect, it } from 'vitest';

import {
  createDashboardState,
  dashboardView,
  reduceDashboardState,
} from '../../src/app/dashboard-state.js';

const memberships = [
  {
    group_id: 'student-group',
    access_level: 'member',
    state: 'active',
    group: { id: 'student-group', name: 'Student Group', archived_at: null },
  },
  {
    group_id: 'coach-group',
    access_level: 'coach',
    state: 'active',
    group: { id: 'coach-group', name: 'Coach Group', archived_at: null },
  },
  {
    group_id: 'old-group',
    access_level: 'coach',
    state: 'removed',
    group: { id: 'old-group', name: 'Old Group', archived_at: null },
  },
];

describe('dashboard state', () => {
  it('starts every account in My Training mode', () => {
    expect(createDashboardState()).toMatchObject({
      mode: 'training',
      session: null,
      activeGroupId: null,
    });
  });

  it('shows coach registration in Coaching mode without changing identity', () => {
    let state = createDashboardState();
    state = reduceDashboardState(state, {
      type: 'PROFILE_LOADED',
      profile: { id: 'user-1', display_name: 'Lua' },
      coachProfile: null,
    });
    state = reduceDashboardState(state, { type: 'MODE_CHOSEN', mode: 'coaching' });

    expect(dashboardView(state)).toMatchObject({
      mode: 'coaching',
      needsCoachRegistration: true,
      canRecordPersonalTraining: true,
      availableGroups: [],
    });
  });

  it('restores only a group valid for the remembered mode', () => {
    let state = createDashboardState();
    state = reduceDashboardState(state, {
      type: 'PROFILE_LOADED',
      profile: { id: 'user-1' },
      coachProfile: { profile_id: 'user-1' },
    });
    state = reduceDashboardState(state, {
      type: 'MEMBERSHIPS_LOADED',
      memberships,
      preferredMode: 'coaching',
      preferredGroupId: 'student-group',
    });

    expect(state.mode).toBe('coaching');
    expect(state.activeGroupId).toBe('coach-group');
    expect(dashboardView(state).availableGroups.map((item) => item.group_id))
      .toEqual(['coach-group']);
  });

  it('keeps coaches in My Training with every active practitioner group', () => {
    let state = createDashboardState();
    state = reduceDashboardState(state, {
      type: 'PROFILE_LOADED',
      profile: { id: 'user-1' },
      coachProfile: { profile_id: 'user-1' },
    });
    state = reduceDashboardState(state, {
      type: 'MEMBERSHIPS_LOADED',
      memberships,
      preferredMode: 'training',
      preferredGroupId: 'student-group',
    });

    expect(dashboardView(state)).toMatchObject({
      mode: 'training',
      canRecordPersonalTraining: true,
      needsCoachRegistration: false,
    });
    expect(dashboardView(state).availableGroups.map((item) => item.group_id))
      .toEqual(['student-group', 'coach-group']);
  });

  it('clears a member-only context when switching to Coaching', () => {
    let state = createDashboardState();
    state = reduceDashboardState(state, {
      type: 'PROFILE_LOADED',
      profile: { id: 'user-1' },
      coachProfile: { profile_id: 'user-1' },
    });
    state = reduceDashboardState(state, {
      type: 'MEMBERSHIPS_LOADED',
      memberships,
      preferredMode: 'training',
      preferredGroupId: 'student-group',
    });
    state = reduceDashboardState(state, { type: 'MODE_CHOSEN', mode: 'coaching' });

    expect(state.activeGroupId).toBe('coach-group');
  });

  it('removes revoked access and clears private group content immediately', () => {
    let state = createDashboardState();
    state = reduceDashboardState(state, {
      type: 'PROFILE_LOADED',
      profile: { id: 'user-1' },
      coachProfile: { profile_id: 'user-1' },
    });
    state = reduceDashboardState(state, {
      type: 'MEMBERSHIPS_LOADED',
      memberships,
      preferredMode: 'coaching',
      preferredGroupId: 'coach-group',
    });
    state = reduceDashboardState(state, {
      type: 'PRIVATE_VIEW_LOADED',
      groupId: 'coach-group',
      value: { roster: [{ id: 'student-1' }] },
    });
    state = reduceDashboardState(state, {
      type: 'ACCESS_REVOKED',
      groupId: 'coach-group',
    });

    expect(state.activeGroupId).toBeNull();
    expect(state.privateView).toBeNull();
    expect(dashboardView(state).availableGroups).toEqual([]);
  });

  it('drops all private state when the session expires', () => {
    let state = {
      ...createDashboardState(),
      session: { user: { id: 'user-1' } },
      profile: { id: 'user-1' },
      coachProfile: { profile_id: 'user-1' },
      memberships,
      activeGroupId: 'coach-group',
      privateView: { roster: [{ id: 'student-1' }] },
    };

    state = reduceDashboardState(state, { type: 'SESSION_EXPIRED' });

    expect(state).toEqual(createDashboardState());
  });
});
