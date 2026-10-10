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
      activeTabByMode: { training: 'calendar', coaching: 'schedule' },
    });
  });

  it('persists one selected tab per binary mode', () => {
    let state = createDashboardState();
    state = reduceDashboardState(state, {
      type: 'TAB_CHOSEN', mode: 'training', tab: 'statistics',
    });
    state = reduceDashboardState(state, { type: 'MODE_CHOSEN', mode: 'coaching' });
    state = reduceDashboardState(state, {
      type: 'TAB_CHOSEN', mode: 'coaching', tab: 'students',
    });
    state = reduceDashboardState(state, { type: 'MODE_CHOSEN', mode: 'training' });
    expect(dashboardView(state).activeTab).toBe('statistics');
    expect(state.activeTabByMode).toEqual({ training: 'statistics', coaching: 'students' });
  });

  it('ignores the removed Upcoming training tab', () => {
    const state = reduceDashboardState(createDashboardState(), {
      type: 'TAB_CHOSEN', mode: 'training', tab: 'upcoming',
    });

    expect(state.activeTabByMode.training).toBe('calendar');
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

  it('accepts repertoire and catalog tabs in My Training', () => {
    let state = createDashboardState();
    state = reduceDashboardState(state, { type: 'TAB_CHOSEN', mode: 'training', tab: 'repertoire' });
    expect(dashboardView(state).activeTab).toBe('repertoire');
    state = reduceDashboardState(state, { type: 'TAB_CHOSEN', mode: 'training', tab: 'catalog' });
    expect(dashboardView(state).activeTab).toBe('catalog');
  });
});
