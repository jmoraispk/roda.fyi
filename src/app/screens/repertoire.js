// src/app/screens/repertoire.js
import { importLocalRepertoire } from '../repertoire-import.js';
import { el, pageHeader } from '../shell/page.js';
import { createRepertoireView } from '../ui/repertoire-view.js';
import { loadDraft, saveDraft } from './log-draft.js';

export async function renderRepertoire(ctx) {
  const { document, i18n, services, profile } = ctx;
  const storage = ctx.window.localStorage;
  const panel = el(document, 'div', { className: 'repertoire-panel' });
  const view = createRepertoireView({
    document, i18n, repertoire: services.repertoire, panel,
    onLog: (item) => {
      const draft = loadDraft(storage, profile.id) ?? {};
      saveDraft(storage, profile.id, { ...draft, rounds: [...(draft.rounds ?? []), { sourceText: item.source_text }] });
      ctx.navigate('/log');
    },
  });
  try {
    await importLocalRepertoire({ storage, repertoire: services.repertoire, userId: profile.id });
  } catch {
    // The one-time browser import retries on the next visit.
  }
  await view.load();
  return el(document, 'section', { className: 'screen screen-repertoire' }, [
    pageHeader({ document, title: i18n.t('app.repertoire'), backLabel: i18n.t('app.back'), onBack: () => ctx.back('/me') }),
    panel,
  ]);
}
