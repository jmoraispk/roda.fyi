import {
  createDashboardState,
  dashboardView,
  reduceDashboardState,
} from '../dashboard-state.js';

const MODE_KEY = 'roda.dashboard.mode';
const GROUP_KEY = 'roda.dashboard.group';

export function createDashboardView({
  document,
  storage,
  profileService,
  i18n,
  onEditProfile,
  onSignOut,
  onGroupAction = () => {},
  onContextChange = () => {},
  onCoachRegistration = () => {},
}) {
  const app = document.querySelector('#dashboardApp');
  const loading = document.querySelector('#dashboardLoading');
  const profileName = document.querySelector('#profileName');
  const editProfile = document.querySelector('#editProfile');
  const signOut = document.querySelector('#signOut');
  const modeSwitch = document.querySelector('.mode-switch');
  const groupLabel = document.querySelector('#groupContextLabel');
  const groupSelect = document.querySelector('#groupContext');
  const groupActions = document.querySelector('#dashboardGroupActions');
  const status = document.querySelector('#dashboardStatus');
  const content = document.querySelector('#dashboardContent');
  const trainingWorkspace = document.querySelector('#trainingWorkspace');
  const trainingTabs = document.querySelector('#trainingTabs');
  const coachingWorkspace = document.querySelector('#coachingWorkspace');
  const coachingTabs = document.querySelector('#coachingTabs');
  let state = createDashboardState();
  let registering = false;

  function applyCopy() {
    document.querySelector('#dashboardLocale').setAttribute('aria-label', i18n.t('dashboard.changeLanguage'));
    editProfile.lastChild.textContent = ` · ${i18n.t('dashboard.profile')}`;
    signOut.textContent = i18n.t('dashboard.signOut');
    modeSwitch.setAttribute('aria-label', i18n.t('dashboard.mode'));
    modeSwitch.querySelector('[data-mode="training"]').textContent = i18n.t('dashboard.myTraining');
    modeSwitch.querySelector('[data-mode="coaching"]').textContent = i18n.t('dashboard.coaching');
    groupLabel.querySelector('span').textContent = i18n.t('dashboard.groupContext');
    groupActions.querySelector('[data-action="find-group"]').textContent = i18n.t('dashboard.findGroup');
    groupActions.querySelector('[data-action="create-group"]').textContent = i18n.t('dashboard.createGroup');
    document.querySelector('#trainingWorkspace > .dashboard-eyebrow').textContent = i18n.t('dashboard.practitionerMode');
    document.querySelector('#trainingWorkspace h1').textContent = i18n.t('dashboard.myTraining');
    document.querySelector('#trainingCalendarTab').textContent = i18n.t('dashboard.calendar');
    document.querySelector('#trainingUpcomingTab').textContent = i18n.t('dashboard.upcoming');
    document.querySelector('#trainingStatisticsTab').textContent = i18n.t('dashboard.statistics');
    trainingTabs.setAttribute('aria-label', i18n.t('dashboard.trainingSections'));
    document.querySelector('#trainingUpcomingPanel .calendar-empty').textContent = i18n.t('dashboard.upcomingEmpty');
    document.querySelector('#coachingWorkspace > .dashboard-eyebrow').textContent = i18n.t('dashboard.coachMode');
    document.querySelector('#coachingWorkspace > h1').textContent = i18n.t('dashboard.coaching');
    document.querySelector('#coachingScheduleTab').textContent = i18n.t('dashboard.schedule');
    document.querySelector('#coachingStudentsTab').textContent = i18n.t('dashboard.students');
    document.querySelector('#coachingGroupsTab').textContent = i18n.t('dashboard.groups');
    coachingTabs.setAttribute('aria-label', i18n.t('dashboard.coachingSections'));
    document.querySelector('#dashboardWarning span').textContent = i18n.t('dashboard.groupsWarning');
    document.querySelector('#retryGroups').textContent = i18n.t('dashboard.retryGroups');
  }

  function enableTabKeys(tablist) {
    tablist.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = [...tablist.querySelectorAll('[role="tab"]')];
      const current = tabs.indexOf(event.target.closest('[role="tab"]'));
      if (current < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? tabs.length - 1
          : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus();
      tabs[next].click();
    });
  }

  enableTabKeys(trainingTabs);
  enableTabKeys(coachingTabs);

  function addTextElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    content.append(element);
    return element;
  }

  function addAction(label, action, primary = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = primary ? 'primary-button' : 'secondary-button';
    button.dataset.action = action;
    button.textContent = label;
    const actions = content.querySelector('.dashboard-actions')
      ?? content.appendChild(Object.assign(document.createElement('div'), {
        className: 'dashboard-actions',
      }));
    actions.append(button);
  }

  function renderGroups(view) {
    groupSelect.replaceChildren();
    groupLabel.hidden = view.availableGroups.length === 0;
    for (const membership of view.availableGroups) {
      const option = document.createElement('option');
      option.value = membership.group_id;
      option.textContent = membership.group.name;
      option.selected = membership.group_id === view.activeGroupId;
      groupSelect.append(option);
    }
  }

  function render() {
    applyCopy();
    const view = dashboardView(state);
    profileName.textContent = view.profile?.display_name ?? '';
    for (const button of modeSwitch.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === view.mode));
    }
    renderGroups(view);
    groupActions.querySelector('[data-action="create-group"]').hidden = !view.coachProfile;
    content.replaceChildren();
    trainingWorkspace.hidden = view.mode !== 'training';
    coachingWorkspace.hidden = view.mode !== 'coaching' || view.needsCoachRegistration;
    content.hidden = view.mode === 'training'
      || (view.mode === 'coaching' && !view.needsCoachRegistration && view.activeTab !== 'groups');
    for (const button of trainingTabs.querySelectorAll('[data-dashboard-tab]')) {
      button.setAttribute('aria-selected', String(button.dataset.dashboardTab === view.activeTab));
    }
    for (const panel of trainingWorkspace.querySelectorAll('[role="tabpanel"]')) {
      panel.hidden = panel.id !== {
        calendar: 'trainingCalendarPanel',
        upcoming: 'trainingUpcomingPanel',
        statistics: 'trainingStatisticsPanel',
      }[view.activeTab];
    }
    for (const button of coachingTabs.querySelectorAll('[data-dashboard-tab]')) {
      button.setAttribute('aria-selected', String(button.dataset.dashboardTab === view.activeTab));
    }
    for (const panel of coachingWorkspace.querySelectorAll(':scope > [role="tabpanel"]')) {
      panel.hidden = panel.id !== {
        schedule: 'coachingSchedulePanel',
        students: 'coachingStudentsPanel',
        groups: 'coachingGroupsPanel',
      }[view.activeTab];
    }

    if (view.mode === 'training') {
      // Feature workspaces own practitioner-mode content.
    } else if (view.needsCoachRegistration) {
      addTextElement('div', 'dashboard-eyebrow', i18n.t('dashboard.coachMode'));
      addTextElement('h1', '', i18n.t('dashboard.coaching'));
      addTextElement('p', 'dashboard-lead', i18n.t('dashboard.registerIntro'));
      addAction(i18n.t('dashboard.registerCoach'), 'register-coach', true);
    }

    loading.hidden = true;
    app.hidden = false;
    onContextChange({
      mode: view.mode,
      activeGroupId: view.activeGroupId,
      membership: view.memberships.find((item) => item.group_id === view.activeGroupId) ?? null,
      activeTab: view.activeTab,
    });
  }

  modeSwitch.addEventListener('click', (event) => {
    const button = event.target.closest('[data-mode]');
    if (!button) return;
    state = reduceDashboardState(state, { type: 'MODE_CHOSEN', mode: button.dataset.mode });
    storage.setItem(MODE_KEY, state.mode);
    if (state.activeGroupId) storage.setItem(GROUP_KEY, state.activeGroupId);
    else storage.removeItem(GROUP_KEY);
    status.textContent = '';
    render();
  });

  groupSelect.addEventListener('change', () => {
    state = reduceDashboardState(state, { type: 'GROUP_CHOSEN', groupId: groupSelect.value });
    if (state.activeGroupId) storage.setItem(GROUP_KEY, state.activeGroupId);
    render();
  });

  trainingTabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-dashboard-tab]');
    if (!button) return;
    state = reduceDashboardState(state, {
      type: 'TAB_CHOSEN', mode: 'training', tab: button.dataset.dashboardTab,
    });
    render();
  });

  coachingTabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-dashboard-tab]');
    if (!button) return;
    state = reduceDashboardState(state, {
      type: 'TAB_CHOSEN', mode: 'coaching', tab: button.dataset.dashboardTab,
    });
    render();
  });

  content.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action !== 'register-coach') {
      onGroupAction(action);
      return;
    }
    if (registering) return;
    registering = true;
    status.textContent = i18n.t('dashboard.registering');
    try {
      await profileService.registerAsCoach();
      const coachProfile = await profileService.loadCoachProfile();
      state = reduceDashboardState(state, {
        type: 'PROFILE_LOADED',
        profile: state.profile,
        coachProfile,
      });
      onCoachRegistration(coachProfile);
      status.textContent = i18n.t('dashboard.coachingReady');
      render();
    } catch (error) {
      status.textContent = error?.message || i18n.t('dashboard.genericError');
    } finally {
      registering = false;
    }
  });

  groupActions.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action) onGroupAction(action);
  });

  editProfile.addEventListener('click', () => onEditProfile(state.profile));
  signOut.addEventListener('click', onSignOut);

  return {
    load({ session, profile, coachProfile, memberships }) {
      state = reduceDashboardState(createDashboardState(), { type: 'SESSION_LOADED', session });
      state = reduceDashboardState(state, { type: 'PROFILE_LOADED', profile, coachProfile });
      state = reduceDashboardState(state, {
        type: 'MEMBERSHIPS_LOADED',
        memberships,
        preferredMode: storage.getItem(MODE_KEY),
        preferredGroupId: storage.getItem(GROUP_KEY),
      });
      render();
    },

    updateProfile(profile) {
      state = reduceDashboardState(state, {
        type: 'PROFILE_LOADED',
        profile,
        coachProfile: state.coachProfile,
      });
      render();
    },

    replaceMemberships(memberships, preferredGroupId = null) {
      state = reduceDashboardState(state, {
        type: 'MEMBERSHIPS_LOADED',
        memberships,
        preferredMode: state.mode,
        preferredGroupId: preferredGroupId ?? state.activeGroupId,
      });
      if (state.activeGroupId) storage.setItem(GROUP_KEY, state.activeGroupId);
      else storage.removeItem(GROUP_KEY);
      render();
    },

    replaceCoachProfile(coachProfile) {
      state = reduceDashboardState(state, {
        type: 'PROFILE_LOADED',
        profile: state.profile,
        coachProfile,
      });
      render();
    },

    setLocale() {
      render();
    },

    accessRevoked(groupId) {
      state = reduceDashboardState(state, { type: 'ACCESS_REVOKED', groupId });
      if (state.activeGroupId) storage.setItem(GROUP_KEY, state.activeGroupId);
      else storage.removeItem(GROUP_KEY);
      render();
    },

    clear() {
      state = reduceDashboardState(state, { type: 'SESSION_EXPIRED' });
      storage.removeItem(MODE_KEY);
      storage.removeItem(GROUP_KEY);
      profileName.textContent = '';
      content.replaceChildren();
      trainingWorkspace.hidden = true;
      coachingWorkspace.hidden = true;
      app.hidden = true;
      loading.hidden = false;
    },
  };
}
