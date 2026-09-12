import { createAuthService } from '../auth-service.js';
import { publicConfig } from '../config.js';
import { createGroupService } from '../group-service.js';
import { createProfileService } from '../profile-service.js';
import { createRodaClient } from '../supabase-client.js';
import {
  createE2EAuthService,
  createE2EGroupService,
  createE2EProfileService,
} from '../testing/fake-services.js';
import { createDashboardView } from '../ui/dashboard-view.js';
import { createGroupView } from '../ui/group-view.js';
import { createProfileView } from '../ui/profile-view.js';

function currentRoute() {
  return `${location.pathname}${location.search}${location.hash}`;
}

function returnToSignIn() {
  location.replace(`/?next=${encodeURIComponent(currentRoute())}`);
}

async function main() {
  const entryParams = new URLSearchParams(location.search);
  const discoveryToken = entryParams.get('group_link');
  const memberInvitationToken = entryParams.get('member_invite');
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

  const session = await authService.getSession();
  if (!session) {
    returnToSignIn();
    return;
  }

  const [profile, coachProfile, memberships] = await Promise.all([
    profileService.loadProfile(),
    profileService.loadCoachProfile(),
    groupService.listMyMemberships(),
  ]);

  let profileController;
  let groupController;
  const dashboard = createDashboardView({
    document,
    storage: localStorage,
    profileService,
    onEditProfile: (profile) => profileController.show({
      user: session.user,
      nextProfile: profile,
    }),
    onSignOut: async () => {
      groupController.clearPrivate();
      dashboard.clear();
      await authService.signOut();
      returnToSignIn();
    },
    onGroupAction: (action) => {
      if (action === 'find-group') groupController.showDiscovery();
      if (action === 'create-group') groupController.openCreateGroup();
    },
    onContextChange: ({ mode, membership }) => {
      if (mode === 'coaching' && membership) {
        groupController.loadManagement(membership.group, membership);
      } else {
        groupController.hide();
      }
    },
    onCoachRegistration: () => groupController.setIdentity({
      profileId: profile.id,
      isCoach: true,
    }),
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
    onSaved: async (profile) => dashboard.updateProfile(profile),
  });

  dashboard.load({ session, profile, coachProfile, memberships });
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
    dashboard.clear();
    returnToSignIn();
  });
}

main();
