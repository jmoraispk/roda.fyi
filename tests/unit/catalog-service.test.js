// tests/unit/catalog-service.test.js
import { describe, expect, it } from 'vitest';

import { createCatalogService } from '../../src/app/catalog-service.js';
import { createE2ECatalogService } from '../../src/app/testing/fake-services.js';

function harness() {
  const calls = [];
  const query = {
    select: (columns) => { calls.push(['select', columns]); return Promise.resolve({ data: [{ term: 'x' }], error: null }); },
  };
  return {
    calls,
    client: {
      from: (table) => { calls.push(['from', table]); return query; },
      rpc: async (name, params = {}) => { calls.push([name, params]); return { data: { status: 'saved' }, error: null }; },
    },
  };
}

function memoryWindow(entries = {}) {
  const values = new Map(Object.entries(entries));
  return { localStorage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) } };
}

describe('catalog service', () => {
  it('reads mappings from the table and curates through RPCs', async () => {
    const { client, calls } = harness();
    const service = createCatalogService(client);
    expect(await service.listTermMappings()).toEqual([{ term: 'x' }]);
    await service.amICurator();
    await service.listUncataloguedTerms();
    await service.mapTerm('galopanti', 'galopante');
    await service.mergeTerm('galopanti', 'galopante-x');
    await service.ignoreTerm('stretching');
    await service.setNeedsVideo('godeme', true);
    expect(calls).toEqual([
      ['from', 'catalog_term_mappings'],
      ['select', 'term, action, target_slug, target_term, needs_video'],
      ['am_i_catalog_curator', {}],
      ['list_uncatalogued_terms', {}],
      ['map_catalog_term', { term: 'galopanti', target_slug: 'galopante' }],
      ['merge_catalog_term', { term: 'galopanti', target_term: 'galopante-x' }],
      ['ignore_catalog_term', { term: 'stretching' }],
      ['set_catalog_term_needs_video', { term: 'godeme', needs_video: true }],
    ]);
  });

  it('rejects non-slug terms before calling Supabase', async () => {
    const { client, calls } = harness();
    await expect(createCatalogService(client).mapTerm('Galopanti!', 'galopante'))
      .rejects.toMatchObject({ code: 'invalid_term' });
    expect(calls).toEqual([]);
  });

  it('derives terms and applies mappings in the local fake', async () => {
    const trainingState = {
      occurrences: [{ id: 'o1', rounds: [{ movements: [
        { movement_key: 'galopanti', movement_name: 'Galopanti', catalogued: false },
        { movement_key: 'armada', movement_name: 'Armada', catalogued: true },
      ] }] }],
      participations: [{ id: 'p1', occurrence_id: 'o1', profile_id: 'practitioner-1' }],
    };
    const window = memoryWindow({
      'roda.e2e.catalogCurator': 'true',
      'roda.e2e.trainingState': JSON.stringify(trainingState),
    });
    const service = createE2ECatalogService({ window });
    expect(await service.amICurator()).toBe(true);
    expect(await service.listUncataloguedTerms()).toMatchObject([
      { term: 'galopanti', spelling: 'Galopanti', people: 1, uses: 1, needs_video: false },
    ]);
    await service.mapTerm('galopanti', 'galopante');
    expect(await service.listUncataloguedTerms()).toEqual([]);
    expect(await service.listTermMappings()).toMatchObject([
      { term: 'galopanti', action: 'alias', target_slug: 'galopante' },
    ]);
  });
});
