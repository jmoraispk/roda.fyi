import { createAuthService } from '../auth-service.js';
import { publicConfig } from '../config.js';
import { createRodaClient } from '../supabase-client.js';
import { createE2EAuthService } from '../testing/fake-services.js';
import { createAuthDialog } from '../ui/auth-dialog.js';

function currentRoute(location) {
  return `${location.pathname}${location.search}${location.hash}`;
}

async function main() {
  const authService = __RODA_E2E__
    ? createE2EAuthService({ window })
    : createAuthService({
      client: createRodaClient(publicConfig),
      origin: location.origin,
      storage: localStorage,
    });

  const dialog = createAuthDialog({
    document,
    authService,
    returnRoute: () => currentRoute(location),
    navigate: (route) => location.assign(route),
  });

  dialog.setSession(await authService.getSession());
  authService.onAuthStateChange((_event, session) => dialog.setSession(session));
}

main();
