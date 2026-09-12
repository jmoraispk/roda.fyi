import { createAuthService } from '../auth-service.js';
import { publicConfig } from '../config.js';
import { createRodaClient } from '../supabase-client.js';
import { createE2EAuthService } from '../testing/fake-services.js';
import { createAuthDialog } from '../ui/auth-dialog.js';
import { sanitizeReturnRoute } from '../return-route.js';

function currentRoute(location) {
  return `${location.pathname}${location.search}${location.hash}`;
}

function intendedRoute(location) {
  const next = new URLSearchParams(location.search).get('next');
  return next === null ? currentRoute(location) : sanitizeReturnRoute(next);
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
    returnRoute: () => intendedRoute(location),
    navigate: (route) => location.assign(route),
  });

  const session = await authService.getSession();
  dialog.setSession(session);
  authService.onAuthStateChange((_event, session) => dialog.setSession(session));
  if (!session && new URLSearchParams(location.search).has('next')) dialog.open();
}

main();
