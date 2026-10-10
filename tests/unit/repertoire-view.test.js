// tests/unit/repertoire-view.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { createRepertoireView } from '../../src/app/ui/repertoire-view.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

describe('repertoire view', () => {
  beforeEach(() => { document.body.innerHTML = '<section id="trainingRepertoirePanel"></section>'; });

  it('lists, logs, renames, and deletes sequences', async () => {
    const repertoire = {
      list: vi.fn().mockResolvedValue([{ id: 's1', title: 'Flow', source_text: 'armada, <b>au</b>' }]),
      save: vi.fn().mockResolvedValue({ status: 'saved' }),
      remove: vi.fn().mockResolvedValue({ status: 'deleted' }),
    };
    const onLog = vi.fn();
    const view = createRepertoireView({ document, i18n, repertoire, onLog });
    await view.load();
    const panel = document.querySelector('#trainingRepertoirePanel');
    expect(panel.querySelector('.repertoire-text').textContent).toBe('armada, <b>au</b>');
    expect(panel.querySelector('b')).toBeNull();
    panel.querySelector('button[data-action="log"]').click();
    expect(onLog).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
    panel.querySelector('button[data-action="rename"]').click();
    panel.querySelector('input[name="title"]').value = 'Renamed';
    panel.querySelector('form[data-rename]').requestSubmit();
    await vi.waitFor(() => expect(repertoire.save).toHaveBeenCalledWith({
      id: 's1', title: 'Renamed', sourceText: 'armada, <b>au</b>', sequence: null,
    }));
    const remove = panel.querySelector('button[data-action="delete"]');
    remove.click();
    expect(repertoire.remove).not.toHaveBeenCalled();
    expect(panel.querySelector('button[data-action="delete"]').textContent).toBe('Confirm delete');
    panel.querySelector('button[data-action="delete"]').click();
    await vi.waitFor(() => expect(repertoire.remove).toHaveBeenCalledWith('s1'));
  });

  it('explains how to add the first sequence', async () => {
    const view = createRepertoireView({ document, i18n, repertoire: { list: vi.fn().mockResolvedValue([]) }, onLog() {} });
    await view.load();
    expect(document.querySelector('#trainingRepertoirePanel').textContent)
      .toContain('Save a round as a sequence');
  });
});
