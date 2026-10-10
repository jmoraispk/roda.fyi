// tests/unit/repertoire-import.test.js
import { describe, expect, it, vi } from 'vitest';

import { importLocalRepertoire, localSequenceItems } from '../../src/app/repertoire-import.js';

function storage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), values };
}

const saved = JSON.stringify([
  [{ c: 'golpes', n: 'Armada' }, { c: 'floreios', n: 'Aú' }],
  [{ c: 'golpes', n: 'Armada' }, { c: 'floreios', n: 'Aú' }],
  [{ c: 'esquivas', n: 'Negativa' }],
]);

describe('repertoire import', () => {
  it('converts browser sequences to notation text with stable references', () => {
    const items = localSequenceItems(storage({ 'roda.seqs': saved }));
    expect(items.map(({ source_text: text }) => text)).toEqual(['Armada, Aú', 'Armada, Aú', 'Negativa']);
    expect(items[0].import_ref).toMatch(/^local:[0-9a-f]{8}$/);
    expect(items[0].import_ref).toBe(items[1].import_ref);
    expect(localSequenceItems(storage({ 'roda.seqs': 'not json' }))).toEqual([]);
  });

  it('imports once per user and retries after a failure', async () => {
    const local = storage({ 'roda.seqs': saved });
    const repertoire = { importItems: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ imported: 2 }) };
    await expect(importLocalRepertoire({ storage: local, repertoire, userId: 'u1' })).rejects.toThrow('offline');
    expect(local.values.get('roda.seqs.imported:u1')).toBeUndefined();
    expect(await importLocalRepertoire({ storage: local, repertoire, userId: 'u1' })).toEqual({ imported: 2, skipped: false });
    expect(await importLocalRepertoire({ storage: local, repertoire, userId: 'u1' })).toEqual({ imported: 0, skipped: true });
    expect(repertoire.importItems).toHaveBeenCalledTimes(2);
    expect(local.values.get('roda.seqs')).toBe(saved);
  });

  it('marks users with nothing to import as done', async () => {
    const local = storage();
    const repertoire = { importItems: vi.fn() };
    expect(await importLocalRepertoire({ storage: local, repertoire, userId: 'u2' })).toEqual({ imported: 0, skipped: false });
    expect(repertoire.importItems).not.toHaveBeenCalled();
  });
});
