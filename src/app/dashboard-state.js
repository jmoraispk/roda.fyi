export function createDashboardState() {
  return {
    mode: 'training',
    session: null,
    profile: null,
    coachProfile: null,
    memberships: [],
    activeGroupId: null,
    activeTabByMode: { training: 'calendar', coaching: 'schedule' },
    privateView: null,
  };
}

function activeMemberships(state) {
  return state.memberships.filter((membership) => (
    membership.state === 'active' && !membership.group?.archived_at
  ));
}

function availableGroups(state, mode = state.mode) {
  const active = activeMemberships(state);
  if (mode !== 'coaching') return active;
  if (!state.coachProfile) return [];
  return active.filter((membership) => membership.access_level === 'coach');
}

function validMode(mode) {
  return mode === 'coaching' ? 'coaching' : 'training';
}

function chooseGroup(state, mode, preferredGroupId) {
  const available = availableGroups(state, mode);
  return available.some((item) => item.group_id === preferredGroupId)
    ? preferredGroupId
    : available[0]?.group_id ?? null;
}

export function reduceDashboardState(state, event) {
  switch (event.type) {
    case 'SESSION_LOADED':
      return { ...state, session: event.session };
    case 'SESSION_EXPIRED':
      return createDashboardState();
    case 'PROFILE_LOADED':
      return {
        ...state,
        profile: event.profile,
        coachProfile: event.coachProfile ?? null,
      };
    case 'MEMBERSHIPS_LOADED': {
      const mode = validMode(event.preferredMode ?? state.mode);
      const next = { ...state, memberships: [...event.memberships], mode };
      return {
        ...next,
        activeGroupId: chooseGroup(next, mode, event.preferredGroupId),
        privateView: null,
      };
    }
    case 'MODE_CHOSEN': {
      const mode = validMode(event.mode);
      return {
        ...state,
        mode,
        activeGroupId: chooseGroup(state, mode, state.activeGroupId),
        privateView: null,
      };
    }
    case 'TAB_CHOSEN': {
      const allowed = event.mode === 'coaching'
        ? ['schedule', 'students', 'groups']
        : ['calendar', 'upcoming', 'statistics'];
      if (event.mode !== state.mode || !allowed.includes(event.tab)) return state;
      return {
        ...state,
        activeTabByMode: { ...state.activeTabByMode, [state.mode]: event.tab },
        privateView: null,
      };
    }
    case 'GROUP_CHOSEN':
      return availableGroups(state).some((item) => item.group_id === event.groupId)
        ? { ...state, activeGroupId: event.groupId, privateView: null }
        : state;
    case 'PRIVATE_VIEW_LOADED':
      return event.groupId === state.activeGroupId
        ? { ...state, privateView: event.value }
        : state;
    case 'ACCESS_REVOKED': {
      const next = {
        ...state,
        memberships: state.memberships.filter(
          (membership) => membership.group_id !== event.groupId,
        ),
        privateView: state.activeGroupId === event.groupId ? null : state.privateView,
      };
      return {
        ...next,
        activeGroupId: chooseGroup(next, next.mode, next.activeGroupId),
      };
    }
    default:
      return state;
  }
}

export function dashboardView(state) {
  return {
    ...state,
    availableGroups: availableGroups(state),
    needsCoachRegistration: state.mode === 'coaching' && !state.coachProfile,
    canRecordPersonalTraining: Boolean(state.profile),
    activeTab: state.activeTabByMode[state.mode],
  };
}
