// tests/unit/log-draft.test.js
import { describe, expect, it } from 'vitest';

import { clearDraft, loadDraft, saveDraft } from '../../src/app/screens/log-draft.js';

function storage() {
  const values = new Map();
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k), values };
}

describe('log draft', () => {
  it('saves, loads, and clears per profile', () => {
    const local = storage();
    const draft = { localDate: '2026-10-11', durationMinutes: 45, rounds: [{ sourceText: 'ginga', ratings: [] }], notes: '', resources: [], idempotencyKey: 'k' };
    saveDraft(local, 'p1', draft);
    expect(loadDraft(local, 'p1')).toEqual(draft);
    expect(loadDraft(local, 'p2')).toBeNull();
    clearDraft(local, 'p1');
    expect(loadDraft(local, 'p1')).toBeNull();
  });

  it('ignores broken or blocked storage', () => {
    const broken = { getItem: () => '{nope', setItem() { throw new Error('quota'); }, removeItem() { throw new Error('blocked'); } };
    expect(loadDraft(broken, 'p1')).toBeNull();
    expect(() => saveDraft(broken, 'p1', {})).not.toThrow();
    expect(() => clearDraft(broken, 'p1')).not.toThrow();
  });
});
