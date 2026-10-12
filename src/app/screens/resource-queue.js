// src/app/screens/resource-queue.js
// Saves resources one by one after a training is recorded. Whatever fails
// waits in the training page's "waiting to sync" queue instead of vanishing.
export async function saveResourcesOrQueue({ storage, service, occurrenceId, resources }) {
  const pending = resources.map((resource) => ({ occurrenceId, ...resource }));
  while (pending.length) {
    try {
      await service.addResource(pending[0]);
      pending.shift();
    } catch {
      try {
        storage.setItem(`roda.pendingResources:${occurrenceId}`, JSON.stringify(pending));
      } catch {
        // The training page shows nothing to retry when storage is blocked.
      }
      return pending.length;
    }
  }
  return 0;
}
