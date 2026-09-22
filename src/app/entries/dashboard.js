import { createAuthService } from '../auth-service.js';
import { createConnectionService } from '../connection-service.js';
import { publicConfig } from '../config.js';
import { createDashboardI18n } from '../dashboard-i18n.js';
import { createGroupService } from '../group-service.js';
import { createProfileService } from '../profile-service.js';
import { createTrainingService } from '../training-service.js';
import { createRodaClient } from '../supabase-client.js';
import {
  createE2EAuthService,
  createE2EConnectionService,
  createE2EGroupService,
  createE2EProfileService,
  createE2ETrainingService,
} from '../testing/fake-services.js';
import { createDashboardView } from '../ui/dashboard-view.js';
import { createConnectionView } from '../ui/connection-view.js';
import { createGroupView } from '../ui/group-view.js';
import { createProfileView } from '../ui/profile-view.js';
import { createTrainingCalendarView } from '../ui/training-calendar-view.js';
import { createCoachingTrainingView } from '../ui/coaching-training-view.js';

function currentRoute() {
  return `${location.pathname}${location.search}${location.hash}`;
}

function returnToSignIn() {
  location.replace(`/?next=${encodeURIComponent(currentRoute())}`);
}

function waitForRetry() {
  if (__RODA_E2E__) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, 200));
}

async function retryRead(read) {
  try {
    return await read();
  } catch (_firstError) {
    await waitForRetry();
    return read();
  }
}

async function loadStartupData(profileService, groupService) {
  const [profileResult, coachResult, membershipsResult] = await Promise.allSettled([
    retryRead(() => profileService.loadProfile()),
    retryRead(() => profileService.loadCoachProfile()),
    retryRead(() => groupService.listMyMemberships()),
  ]);

  if (profileResult.status === 'rejected') throw profileResult.reason;
  return {
    profile: profileResult.value,
    coachProfile: coachResult.status === 'fulfilled' ? coachResult.value : null,
    memberships: membershipsResult.status === 'fulfilled' ? membershipsResult.value : [],
    supplementalFailed: coachResult.status === 'rejected'
      || membershipsResult.status === 'rejected',
  };
}

async function main() {
  const entryParams = new URLSearchParams(location.search);
  const discoveryToken = entryParams.get('group_link');
  const memberInvitationToken = entryParams.get('member_invite');
  const loading = document.querySelector('#dashboardLoading');
  const startupError = document.querySelector('#dashboardStartupError');
  const startupMessage = document.querySelector('#dashboardStartupMessage');
  const retryDashboard = document.querySelector('#retryDashboard');
  const startupSignOut = document.querySelector('#startupSignOut');
  const warning = document.querySelector('#dashboardWarning');
  const retryGroups = document.querySelector('#retryGroups');
  const client = __RODA_E2E__ ? null : createRodaClient(publicConfig);
  const authService = __RODA_E2E__
    ? createE2EAuthService({ window })
    : createAuthService({ client, origin: location.origin, storage: localStorage });
  const profileService = __RODA_E2E__
    ? createE2EProfileService({ window })
    : createProfileService(client);
  const groupService = __RODA_E2E__
    ? createE2EGroupService({ window })
    : createGroupService(client);
  const connectionService = __RODA_E2E__
    ? createE2EConnectionService({ window })
    : createConnectionService(client);
  const trainingService = __RODA_E2E__
    ? createE2ETrainingService({ window })
    : createTrainingService(client);
  const i18n = createDashboardI18n({ document, storage: localStorage, navigator });
  const localeButton = document.querySelector('#dashboardLocale');
  let session;
  let profile;
  let dashboard;
  let profileController;
  let groupController;
  let connectionController;
  let trainingCalendarController;
  let coachingTrainingController;
  let connectionIdentity;
  let initializing = false;
  let initialized = false;

  function showLoading() {
    startupError.hidden = true;
    loading.hidden = false;
  }

  function showStartupError(error) {
    loading.hidden = true;
    startupMessage.textContent = error?.message
      || 'Your information is safe. Please try loading it again.';
    startupError.hidden = false;
  }

  function setSupplementalWarning(visible, busy = false) {
    warning.hidden = !visible;
    retryGroups.disabled = busy;
    retryGroups.textContent = busy ? 'Trying…' : 'Try groups again';
  }

  async function reloadSupplementalData() {
    setSupplementalWarning(true, true);
    const [coachResult, membershipsResult] = await Promise.allSettled([
      retryRead(() => profileService.loadCoachProfile()),
      retryRead(() => groupService.listMyMemberships()),
    ]);
    if (coachResult.status === 'fulfilled') {
      dashboard.replaceCoachProfile(coachResult.value);
      groupController.setIdentity({
        profileId: profile.id,
        isCoach: Boolean(coachResult.value),
      });
    }
    if (membershipsResult.status === 'fulfilled') {
      dashboard.replaceMemberships(membershipsResult.value);
    }
    setSupplementalWarning(
      coachResult.status === 'rejected' || membershipsResult.status === 'rejected',
    );
  }

  function createControllers(coachProfile) {
    dashboard = createDashboardView({
      document,
      storage: localStorage,
      profileService,
      onEditProfile: (nextProfile) => profileController.show({
        user: session.user,
        nextProfile,
      }),
      onSignOut: async () => {
        groupController.clearPrivate();
        connectionController.clear();
        trainingCalendarController.clear();
        coachingTrainingController.clear();
        dashboard.clear();
        await authService.signOut();
        returnToSignIn();
      },
      onGroupAction: (action) => {
        if (action === 'find-group') groupController.showDiscovery();
        if (action === 'create-group') groupController.openCreateGroup();
      },
      onContextChange: ({ mode, membership, activeTab }) => {
        if (mode === 'coaching' && activeTab === 'groups' && membership) {
          groupController.loadManagement(membership.group, membership);
        } else {
          groupController.hide();
        }
        if (mode === 'training' || (mode === 'coaching' && activeTab === 'students')) {
          if (profile.completed_at) connectionController.load();
        } else {
          connectionController.clear();
        }
        coachingTrainingController.setContext({
          mode,
          activeTab,
          groupId: membership?.group_id ?? null,
          isCoach: connectionIdentity.isCoach,
        });
        if (mode === 'coaching' && activeTab === 'schedule' && connectionIdentity.isCoach) {
          coachingTrainingController.load();
        }
        if (mode === 'training' && activeTab === 'calendar' && profile.completed_at) {
          trainingCalendarController.refresh();
        }
      },
      onCoachRegistration: () => {
        groupController.setIdentity({ profileId: profile.id, isCoach: true });
        connectionIdentity.isCoach = true;
        connectionController.load();
      },
    });
    groupController = createGroupView({
      document,
      groupService,
      identity: { profileId: profile.id, isCoach: Boolean(coachProfile) },
      onMembershipsChanged: async (preferredGroupId) => {
        const nextMemberships = await groupService.listMyMemberships();
        dashboard.replaceMemberships(nextMemberships, preferredGroupId);
        return nextMemberships;
      },
      onAccessRevoked: async (groupId) => dashboard.accessRevoked(groupId),
    });
    profileController = createProfileView({
      document,
      profileService,
      onSaved: async (nextProfile) => {
        profile = nextProfile;
        dashboard.updateProfile(nextProfile);
        await connectionController.load();
        await trainingCalendarController.refresh();
      },
    });
    connectionIdentity = { profileId: profile.id, isCoach: Boolean(coachProfile) };
    connectionController = createConnectionView({
      document,
      service: connectionService,
      i18n,
      identity: connectionIdentity,
      onAccessRevoked: async () => {},
    });
    trainingCalendarController = createTrainingCalendarView({
      document,
      service: trainingService,
      i18n,
      profile,
      timezone: profile.timezone_override
        || Intl.DateTimeFormat().resolvedOptions().timeZone
        || 'UTC',
    });
    coachingTrainingController = createCoachingTrainingView({
      document,
      trainingService,
      connectionService,
      groupService,
      i18n,
      profileId: profile.id,
      timezone: profile.timezone_override
        || Intl.DateTimeFormat().resolvedOptions().timeZone
        || 'UTC',
      onAccessRevoked: async (groupId) => {
        if (groupId) dashboard.accessRevoked(groupId);
      },
    });
  }

  async function initialize() {
    if (initializing || initialized) return;
    initializing = true;
    showLoading();
    try {
      session = await retryRead(() => authService.getSession());
      if (!session) {
        returnToSignIn();
        return;
      }
      const startup = await loadStartupData(profileService, groupService);
      profile = startup.profile;
      createControllers(startup.coachProfile);
      dashboard.load({
        session,
        profile,
        coachProfile: startup.coachProfile,
        memberships: startup.memberships,
      });
      localeButton.textContent = i18n.locale() === 'en' ? 'PT' : 'EN';
      setSupplementalWarning(startup.supplementalFailed);
      initialized = true;

      if (memberInvitationToken) {
        history.replaceState({}, '', '/dashboard');
        groupController.handleMemberInvitation(memberInvitationToken);
      }
      if (discoveryToken) {
        history.replaceState({}, '', '/dashboard');
        try {
          const group = await groupService.resolveDiscoveryToken(discoveryToken);
          groupController.renderDiscovery(group ? [group] : [], { title: 'Shared group' });
        } catch (error) {
          document.querySelector('#groupWorkspace').hidden = false;
          document.querySelector('#groupStatus').textContent = error?.message
            || 'This group link is unavailable.';
        }
      }
      if (!profile.completed_at) {
        profileController.show({
          user: session.user,
          nextProfile: profile,
          requiredCompletion: true,
        });
      }

      authService.onAuthStateChange((_event, nextSession) => {
        if (nextSession) return;
        groupController.clearPrivate();
        connectionController.clear();
        trainingCalendarController.clear();
        coachingTrainingController.clear();
        dashboard.clear();
        returnToSignIn();
      });
    } catch (error) {
      showStartupError(error);
    } finally {
      initializing = false;
    }
  }

  retryDashboard.addEventListener('click', initialize);
  retryGroups.addEventListener('click', reloadSupplementalData);
  startupSignOut.addEventListener('click', async () => {
    await authService.signOut();
    returnToSignIn();
  });
  localeButton.addEventListener('click', async () => {
    i18n.setLocale(i18n.locale() === 'en' ? 'pt' : 'en');
    localeButton.textContent = i18n.locale() === 'en' ? 'PT' : 'EN';
    if (profile?.completed_at) await connectionController.load();
    trainingCalendarController?.setLocale();
    coachingTrainingController?.load();
  });

  await initialize();
}

main();
