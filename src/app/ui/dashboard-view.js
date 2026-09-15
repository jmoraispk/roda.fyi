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
  const status = document.querySelector('#dashboardStatus');
  const content = document.querySelector('#dashboardContent');
  let state = createDashboardState();
  let registering = false;

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
    const view = dashboardView(state);
    profileName.textContent = view.profile?.display_name ?? '';
    for (const button of modeSwitch.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === view.mode));
    }
    renderGroups(view);
    content.replaceChildren();

    if (view.mode === 'training') {
      addTextElement('div', 'dashboard-eyebrow', 'Practitioner mode');
      addTextElement('h1', '', 'My Training');
      addTextElement('p', 'dashboard-lead', 'Training history and plans are coming next. For now, join a group so your coaching relationships are ready.');
      addAction('Find a group', 'find-group');
    } else if (view.needsCoachRegistration) {
      addTextElement('div', 'dashboard-eyebrow', 'Coaching mode');
      addTextElement('h1', '', 'Coaching');
      addTextElement('p', 'dashboard-lead', 'Register coaching on this same practitioner profile to create groups and request coach access.');
      addAction('Register as a coach', 'register-coach', true);
    } else {
      addTextElement('div', 'dashboard-eyebrow', 'Coaching mode');
      addTextElement('h1', '', 'Coaching');
      addTextElement('p', 'dashboard-lead', 'Create or choose a group to manage its members. Workout planning will arrive in a later delivery.');
      addAction('Create a group', 'create-group', true);
      addAction('Find a group', 'find-group');
    }

    loading.hidden = true;
    app.hidden = false;
    onContextChange({
      mode: view.mode,
      activeGroupId: view.activeGroupId,
      membership: view.memberships.find((item) => item.group_id === view.activeGroupId) ?? null,
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

  content.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action !== 'register-coach') {
      onGroupAction(action);
      return;
    }
    if (registering) return;
    registering = true;
    status.textContent = 'Registering coaching on your profile…';
    try {
      await profileService.registerAsCoach();
      const coachProfile = await profileService.loadCoachProfile();
      state = reduceDashboardState(state, {
        type: 'PROFILE_LOADED',
        profile: state.profile,
        coachProfile,
      });
      onCoachRegistration(coachProfile);
      status.textContent = 'Coaching is ready.';
      render();
    } catch (error) {
      status.textContent = error?.message || 'Something went wrong. Please try again.';
    } finally {
      registering = false;
    }
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
      app.hidden = true;
      loading.hidden = false;
    },
  };
}
