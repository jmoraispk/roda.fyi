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
import { createProfileView } from '../ui/profile-view.js';

function currentRoute() {
  return `${location.pathname}${location.search}${location.hash}`;
}

function returnToSignIn() {
  location.replace(`/?next=${encodeURIComponent(currentRoute())}`);
}

async function main() {
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

  let profileController;
  const dashboard = createDashboardView({
    document,
    storage: localStorage,
    profileService,
    onEditProfile: (profile) => profileController.show({
      user: session.user,
      nextProfile: profile,
    }),
    onSignOut: async () => {
      dashboard.clear();
      await authService.signOut();
      returnToSignIn();
    },
  });
  profileController = createProfileView({
    document,
    profileService,
    onSaved: async (profile) => dashboard.updateProfile(profile),
  });

  const [profile, coachProfile, memberships] = await Promise.all([
    profileService.loadProfile(),
    profileService.loadCoachProfile(),
    groupService.listMyMemberships(),
  ]);
  dashboard.load({ session, profile, coachProfile, memberships });
  if (!profile.completed_at) {
    profileController.show({
      user: session.user,
      nextProfile: profile,
      requiredCompletion: true,
    });
  }

  authService.onAuthStateChange((_event, nextSession) => {
    if (nextSession) return;
    dashboard.clear();
    returnToSignIn();
  });
}

main();
