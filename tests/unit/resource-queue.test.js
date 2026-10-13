// tests/unit/resource-queue.test.js
import { describe, expect, it, vi } from 'vitest';

import { saveResourcesOrQueue } from '../../src/app/screens/resource-queue.js';

function memoryStorage() {
  const values = new Map();
  return { values, getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
}

describe('resource queue', () => {
  it('saves every resource when the network works', async () => {
    const storage = memoryStorage();
    const service = { addResource: vi.fn().mockResolvedValue({}) };
    const queued = await saveResourcesOrQueue({ storage, service, occurrenceId: 'o1', resources: [{ kind: 'video', title: '', url: 'https://x', body: null }] });
    expect(queued).toBe(0);
    expect(service.addResource).toHaveBeenCalledWith({ occurrenceId: 'o1', kind: 'video', title: '', url: 'https://x', body: null, clientKey: expect.any(String) });
    expect(storage.values.size).toBe(0);
  });

  it('queues the failed resource and everything after it', async () => {
    const storage = memoryStorage();
    const service = { addResource: vi.fn().mockResolvedValueOnce({}).mockRejectedValue(new Error('offline')) };
    const resources = [
      { kind: 'video', title: '', url: 'https://x', body: null },
      { kind: 'summary', title: '', url: null, body: '# A' },
      { kind: 'voice', title: '', url: null, body: 'B' },
    ];
    expect(await saveResourcesOrQueue({ storage, service, occurrenceId: 'o2', resources })).toBe(2);
    expect(JSON.parse(storage.values.get('roda.pendingResources:o2'))).toEqual([
      { occurrenceId: 'o2', ...resources[1], clientKey: expect.any(String) }, { occurrenceId: 'o2', ...resources[2], clientKey: expect.any(String) },
    ]);
  });

  it('keeps a resource key and gives a keyless resource one', async () => {
    const storage = memoryStorage();
    const service = { addResource: vi.fn().mockResolvedValue({}), createIdempotencyKey: vi.fn(() => 'made') };
    await saveResourcesOrQueue({ storage, service, occurrenceId: 'o3', resources: [
      { kind: 'video', title: '', url: 'https://x', body: null, clientKey: 'kept' },
      { kind: 'summary', title: '', url: null, body: '# A' },
    ] });
    expect(service.addResource.mock.calls.map(([input]) => input.clientKey)).toEqual(['kept', 'made']);
  });
});
