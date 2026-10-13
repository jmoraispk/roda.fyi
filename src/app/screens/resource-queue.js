// src/app/screens/resource-queue.js
// Saves resources one by one after a training is recorded. Whatever fails
// waits in the training page's "waiting to sync" queue instead of vanishing.
export async function saveResourcesOrQueue({ storage, service, occurrenceId, resources, profileId = null }) {
  const newKey = () => service.createIdempotencyKey?.() ?? globalThis.crypto.randomUUID();
  const pending = resources.map((resource) => ({ occurrenceId, ...resource, clientKey: resource.clientKey ?? newKey() }));
  while (pending.length) {
    try {
      await service.addResource(pending[0]);
      pending.shift();
    } catch {
      try {
        // The queued copy remembers whose it is, so another account never sends it.
        const queued = profileId ? pending.map((item) => ({ ...item, profileId })) : pending;
        storage.setItem(`roda.pendingResources:${occurrenceId}`, JSON.stringify(queued));
      } catch {
        // The training page shows nothing to retry when storage is blocked.
      }
      return pending.length;
    }
  }
  return 0;
}
