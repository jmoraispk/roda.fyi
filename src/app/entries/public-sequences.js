// src/app/entries/public-sequences.js
import { createAuthService } from '../auth-service.js';
import { publicConfig } from '../config.js';
import { importLocalRepertoire } from '../repertoire-import.js';
import { createRepertoireService } from '../repertoire-service.js';
import { createRodaClient } from '../supabase-client.js';
import { createE2EAuthService, createE2ERepertoireService } from '../testing/fake-services.js';

function main() {
  const client = __RODA_E2E__ ? null : createRodaClient(publicConfig);
  const authService = __RODA_E2E__
    ? createE2EAuthService({ window })
    : createAuthService({ client, origin: location.origin, storage: localStorage });
  const repertoire = __RODA_E2E__
    ? createE2ERepertoireService({ window })
    : createRepertoireService(client);
  let session = null;

  window.rodaRepertoire = {
    isSignedIn: () => Boolean(session),
    list: () => repertoire.list(),
    save: (sourceText) => repertoire.save({ title: '', sourceText, sequence: null }),
    remove: (id) => repertoire.remove(id),
  };

  async function applySession(nextSession) {
    session = nextSession;
    if (session) {
      try {
        await importLocalRepertoire({ storage: localStorage, repertoire, userId: session.user.id });
      } catch {
        // The browser copy stays; the import retries on the next visit.
      }
    }
    window.dispatchEvent(new Event('roda:repertoire-ready'));
  }

  authService.getSession().then(applySession).catch(() => applySession(null));
  authService.onAuthStateChange((_event, nextSession) => { applySession(nextSession); });
}

main();
