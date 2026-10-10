// tests/unit/repertoire-service.test.js
import { describe, expect, it } from 'vitest';

import { createRepertoireService } from '../../src/app/repertoire-service.js';
import { createE2ERepertoireService } from '../../src/app/testing/fake-services.js';

function harness() {
  const calls = [];
  return {
    calls,
    client: { rpc: async (name, params = {}) => { calls.push([name, params]); return { data: [], error: null }; } },
  };
}

function memoryWindow() {
  const values = new Map([['roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1' } })]]);
  return { localStorage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) } };
}

describe('repertoire service', () => {
  it('uses stable RPC contracts and derives a default title', async () => {
    const { client, calls } = harness();
    const service = createRepertoireService(client);
    await service.list();
    await service.save({ title: '  ', sourceText: '  armada, au  ', sequence: [] });
    await service.save({ id: 's-1', title: 'Flow', sourceText: 'au', sequence: [] });
    await service.remove('s-1');
    await service.importItems([{ import_ref: 'local:1', title: 'A', source_text: 'au', sequence: [] }]);
    expect(calls).toEqual([
      ['list_practice_sequences', {}],
      ['save_practice_sequence', { sequence_id: null, title: 'armada, au', source_text: 'armada, au', sequence: [] }],
      ['save_practice_sequence', { sequence_id: 's-1', title: 'Flow', source_text: 'au', sequence: [] }],
      ['delete_practice_sequence', { sequence_id: 's-1' }],
      ['import_practice_sequences', { items: [{ import_ref: 'local:1', title: 'A', source_text: 'au', sequence: [] }] }],
    ]);
  });

  it.each([
    [{ sourceText: '   ' }, 'invalid_sequence_text'],
    [{ sourceText: 'x'.repeat(4001) }, 'invalid_sequence_text'],
    [{ sourceText: 'au', title: 't'.repeat(121) }, 'invalid_sequence_title'],
  ])('validates %o', async (input, code) => {
    const { client, calls } = harness();
    await expect(createRepertoireService(client).save(input)).rejects.toMatchObject({ code });
    expect(calls).toEqual([]);
  });

  it('stores, imports once, and deletes in the local fake', async () => {
    const service = createE2ERepertoireService({ window: memoryWindow() });
    await service.save({ sourceText: 'armada, au', sequence: [] });
    expect((await service.importItems([
      { import_ref: 'local:1', title: 'A', source_text: 'ginga', sequence: [] },
      { import_ref: 'local:1', title: 'A', source_text: 'ginga', sequence: [] },
    ])).imported).toBe(1);
    expect((await service.importItems([
      { import_ref: 'local:1', title: 'A', source_text: 'ginga', sequence: [] },
    ])).imported).toBe(0);
    const items = await service.list();
    expect(items.map(({ source_text: text }) => text).sort()).toEqual(['armada, au', 'ginga']);
    await service.remove(items[0].id);
    expect(await service.list()).toHaveLength(1);
  });
});
