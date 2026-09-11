import { createAuthService } from '../auth-service.js';
import { publicConfig } from '../config.js';
import { createRodaClient } from '../supabase-client.js';
import { createE2EAuthService } from '../testing/fake-services.js';

async function main() {
  const sensitiveSearch = location.search;
  history.replaceState(null, '', '/auth/callback');

  const authService = __RODA_E2E__
    ? createE2EAuthService({ window })
    : createAuthService({
      client: createRodaClient(publicConfig),
      origin: location.origin,
      storage: localStorage,
    });

  try {
    const { returnRoute } = await authService.finishCallback(sensitiveSearch);
    location.replace(returnRoute);
  } catch {
    document.querySelector('#callbackStatus').hidden = true;
    document.querySelector('#callbackError').hidden = false;
  }
}

main();
