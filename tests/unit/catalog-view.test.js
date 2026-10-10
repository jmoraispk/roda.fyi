// tests/unit/catalog-view.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { createCatalogView } from '../../src/app/ui/catalog-view.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

function catalog() {
  return {
    listUncataloguedTerms: vi.fn().mockResolvedValue([{
      term: 'galopanti', spelling: 'Galopanti', people: 2, uses: 3,
      first_seen: '2026-09-11T10:00:00Z', last_seen: '2026-10-02T10:00:00Z', needs_video: false,
    }]),
    mapTerm: vi.fn().mockResolvedValue({ status: 'saved', relinked: 3 }),
    mergeTerm: vi.fn().mockResolvedValue({ status: 'saved', relinked: 3 }),
    ignoreTerm: vi.fn().mockResolvedValue({ status: 'saved' }),
    setNeedsVideo: vi.fn().mockResolvedValue({ status: 'saved' }),
  };
}

describe('catalog view', () => {
  beforeEach(() => { document.body.innerHTML = '<section id="trainingCatalogPanel"></section>'; });

  it('shows aggregates only and maps, merges, ignores, and tags terms', async () => {
    const service = catalog();
    const onMappingsChanged = vi.fn();
    const view = createCatalogView({ document, i18n, catalog: service, onMappingsChanged });
    await view.load();
    const row = document.querySelector('[data-term="galopanti"]');
    expect(row.textContent).toContain('Galopanti');
    expect(row.querySelector('[data-people]').textContent).toBe('2');
    expect(row.querySelector('[data-uses]').textContent).toBe('3');

    row.querySelector('select[aria-label="Map galopanti to move"]').value = 'galopante';
    row.querySelector('button[data-action="map"]').click();
    await vi.waitFor(() => expect(service.mapTerm).toHaveBeenCalledWith('galopanti', 'galopante'));
    await vi.waitFor(() => expect(onMappingsChanged).toHaveBeenCalled());

    const fresh = () => document.querySelector('[data-term="galopanti"]');
    fresh().querySelector('input[aria-label="Merge galopanti into"]').value = 'Galopante Alto';
    fresh().querySelector('button[data-action="merge"]').click();
    await vi.waitFor(() => expect(service.mergeTerm).toHaveBeenCalledWith('galopanti', 'galopante-alto'));
    fresh().querySelector('button[data-action="ignore"]').click();
    await vi.waitFor(() => expect(service.ignoreTerm).toHaveBeenCalledWith('galopanti'));
    fresh().querySelector('input[data-action="needs-video"]').click();
    await vi.waitFor(() => expect(service.setNeedsVideo).toHaveBeenCalledWith('galopanti', true));
  });

  it('explains an empty list', async () => {
    const service = catalog();
    service.listUncataloguedTerms.mockResolvedValue([]);
    await createCatalogView({ document, i18n, catalog: service, onMappingsChanged() {} }).load();
    expect(document.querySelector('#trainingCatalogPanel').textContent).toContain('Every written move matches the catalog.');
  });
});
