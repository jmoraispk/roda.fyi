// tests/unit/local-data.test.js
import { describe, expect, it, vi } from 'vitest';

import { clearLegacyDashboardKeys, sendWaitingResources, waitingCount } from '../../src/app/local-data.js';

function memory(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

const item = (occurrenceId, clientKey) => ({ occurrenceId, kind: 'summary', title: '', url: null, body: '# Notes', clientKey });

describe('waiting resources', () => {
  it('counts every queued item and ignores drafts and broken values', () => {
    const storage = memory({
      'roda.pendingResources:o1': JSON.stringify([item('o1', 'a'), item('o1', 'b')]),
      'roda.pendingResources:o2': '{broken',
      'roda.logDraft:p1': JSON.stringify({ rounds: [{ sourceText: 'ginga' }] }),
    });
    expect(waitingCount(storage)).toBe(2);
  });

  it('sends everything waiting and empties the queues', async () => {
    const storage = memory({ 'roda.pendingResources:o1': JSON.stringify([item('o1', 'a'), item('o1', 'b')]) });
    const training = { addResource: vi.fn().mockResolvedValue({ status: 'saved' }), createIdempotencyKey: vi.fn() };
    expect(await sendWaitingResources(storage, training)).toBe(0);
    expect(training.addResource.mock.calls.map(([input]) => input.clientKey)).toEqual(['a', 'b']);
    expect(storage.getItem('roda.pendingResources:o1')).toBeNull();
  });

  it('keeps what could not be sent, in order', async () => {
    const storage = memory({ 'roda.pendingResources:o1': JSON.stringify([item('o1', 'a'), item('o1', 'b')]) });
    const training = { addResource: vi.fn().mockResolvedValueOnce({ status: 'saved' }).mockRejectedValue(new Error('offline')) };
    expect(await sendWaitingResources(storage, training)).toBe(1);
    expect(JSON.parse(storage.getItem('roda.pendingResources:o1'))).toEqual([item('o1', 'b')]);
  });

  it('gives an item queued before keys existed a key before sending it', async () => {
    const storage = memory({ 'roda.pendingResources:o1': JSON.stringify([item('o1', undefined)]) });
    const training = { addResource: vi.fn().mockRejectedValue(new Error('offline')), createIdempotencyKey: vi.fn(() => 'new-key') };
    await sendWaitingResources(storage, training);
    expect(training.addResource).toHaveBeenCalledWith(expect.objectContaining({ clientKey: 'new-key' }));
    expect(JSON.parse(storage.getItem('roda.pendingResources:o1'))[0].clientKey).toBe('new-key');
  });

  it('removes the old dashboard keys and survives blocked storage', async () => {
    const storage = memory({ 'roda.dashboard.mode': 'coaching', 'roda.dashboard.group': 'g1', 'roda.dashboard.locale': 'en' });
    clearLegacyDashboardKeys(storage);
    expect([...storage.values.keys()]).toEqual(['roda.dashboard.locale']);
    const blocked = { get length() { throw new Error('blocked'); }, getItem() { throw new Error('blocked'); } };
    expect(waitingCount(blocked)).toBe(0);
    expect(await sendWaitingResources(blocked, { addResource: vi.fn() })).toBe(0);
    expect(() => clearLegacyDashboardKeys(null)).not.toThrow();
  });
});
