// src/app/local-data.js
// Resources save as soon as they are submitted. When a save fails, the item
// waits in browser storage (roda.pendingResources:<occurrence>) until it can
// be sent. This module counts and sends those items so nothing waiting is
// ever dropped, for example when signing out.
const PENDING_PREFIX = 'roda.pendingResources:';
const LEGACY_KEYS = Object.freeze(['roda.dashboard.mode', 'roda.dashboard.group']);

function storedKeys(storage) {
  try {
    return Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(Boolean);
  } catch {
    return [];
  }
}

function readQueue(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeQueue(storage, key, queue) {
  try {
    if (queue.length) storage.setItem(key, JSON.stringify(queue));
    else storage.removeItem(key);
  } catch {
    // Blocked storage: nothing was stored there to begin with.
  }
}

export function waitingCount(storage) {
  return storedKeys(storage)
    .filter((key) => key.startsWith(PENDING_PREFIX))
    .reduce((total, key) => total + readQueue(storage, key).length, 0);
}

export async function sendWaitingResources(storage, training) {
  let remaining = 0;
  for (const key of storedKeys(storage).filter((name) => name.startsWith(PENDING_PREFIX))) {
    let queue = readQueue(storage, key).map((entry) => (
      entry?.clientKey ? entry : { ...entry, clientKey: training.createIdempotencyKey?.() ?? globalThis.crypto.randomUUID() }
    ));
    writeQueue(storage, key, queue);
    while (queue.length) {
      try {
        await training.addResource(queue[0]);
      } catch {
        break;
      }
      queue = queue.slice(1);
      writeQueue(storage, key, queue);
    }
    remaining += queue.length;
  }
  return remaining;
}

export function clearLegacyDashboardKeys(storage) {
  for (const key of LEGACY_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      // Nothing to clear.
    }
  }
}
