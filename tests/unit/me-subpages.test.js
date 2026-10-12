// tests/unit/me-subpages.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderCatalog } from '../../src/app/screens/catalog.js';
import { loadDraft } from '../../src/app/screens/log-draft.js';
import { renderProgress } from '../../src/app/screens/progress.js';
import { renderRepertoire } from '../../src/app/screens/repertoire.js';
import { appCtx } from './app-test-context.js';

describe('Me subpages', () => {
  beforeEach(() => { localStorage.clear(); document.body.replaceChildren(); });

  it('shows personal statistics and the ranking of the chosen group', async () => {
    const statistics = {
      getPersonal: vi.fn().mockResolvedValue({
        session_count: 3, total_minutes: 150, current_streak: 2, average_trainings_per_week: 1, average_hours_per_month: 2,
        favorite_movements: [], context_distribution: [], difficulty_trends: [], hardest_transitions: [],
      }),
      getGroup: vi.fn().mockResolvedValue([]),
      searchMembers: vi.fn(),
    };
    const group = {
      listMyMemberships: vi.fn().mockResolvedValue([
        { group_id: 'g1', state: 'active', group: { name: 'Grupo Lua', archived_at: null } },
        { group_id: 'g2', state: 'active', group: { name: 'Roda Sul', archived_at: null } },
      ]),
    };
    const view = await renderProgress(appCtx({ services: { statistics, group } }));
    document.body.replaceChildren(view);
    await vi.waitFor(() => expect(view.querySelectorAll('.statistics-card')).toHaveLength(5));
    expect(statistics.getGroup).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'g1' }));
    const picker = view.querySelector('select[name="rankingGroup"]');
    picker.value = 'g2';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(statistics.getGroup).toHaveBeenLastCalledWith(expect.objectContaining({ groupId: 'g2' })));
  });

  it('logs a saved sequence by adding it to the Log training draft', async () => {
    const repertoire = {
      list: vi.fn().mockResolvedValue([{ id: 's1', title: 'Flow', source_text: '10x (armada, au)' }]),
      importItems: vi.fn().mockResolvedValue({ imported: 0 }),
    };
    const ctx = appCtx({ services: { repertoire } });
    const view = await renderRepertoire(ctx);
    document.body.replaceChildren(view);
    view.querySelector('button[data-action="log"]').click();
    expect(loadDraft(localStorage, 'me').rounds).toEqual([{ sourceText: '10x (armada, au)' }]);
    expect(ctx.navigate).toHaveBeenCalledWith('/log');
  });

  it('lets curators handle uncatalogued words and refreshes recognition', async () => {
    const catalog = {
      listUncataloguedTerms: vi.fn().mockResolvedValue([{ term: 'armadinha', spelling: 'armadinha', people: 2, uses: 3, first_seen: null, last_seen: null, needs_video: false }]),
      ignoreTerm: vi.fn().mockResolvedValue({ status: 'saved' }),
    };
    const ctx = appCtx({ services: { catalog } });
    const view = await renderCatalog(ctx);
    document.body.replaceChildren(view);
    view.querySelector('[data-term="armadinha"] [data-action="ignore"]').click();
    await vi.waitFor(() => expect(catalog.ignoreTerm).toHaveBeenCalledWith('armadinha'));
    await vi.waitFor(() => expect(ctx.refreshTermMappings).toHaveBeenCalled());
  });
});
