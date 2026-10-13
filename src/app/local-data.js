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

// A save the account will never accept (no permission any more, a canceled
// training, a key already used elsewhere) is kept on the device, marked stuck,
// and no longer counts as waiting, so it can never block signing out.
const NEVER_SENDABLE = new Set(['authorization', 'validation', 'expired']);

// Items record the profile that queued them; older items without one belong to
// whoever is signed in. Another account's items are never sent or counted.
function sendable(entry, profileId) {
  return !entry?.stuck && (!profileId || !entry?.profileId || entry.profileId === profileId);
}

export function waitingCount(storage, profileId = null) {
  return storedKeys(storage)
    .filter((key) => key.startsWith(PENDING_PREFIX))
    .reduce((total, key) => total + readQueue(storage, key).filter((entry) => sendable(entry, profileId)).length, 0);
}

export async function sendWaitingResources(storage, training, profileId = null) {
  let remaining = 0;
  for (const key of storedKeys(storage).filter((name) => name.startsWith(PENDING_PREFIX))) {
    const queue = readQueue(storage, key).map((entry) => (
      entry?.clientKey ? entry : { ...entry, clientKey: training.createIdempotencyKey?.() ?? globalThis.crypto.randomUUID() }
    ));
    writeQueue(storage, key, queue);
    let offline = false;
    for (let index = 0; index < queue.length && !offline;) {
      const entry = queue[index];
      if (!sendable(entry, profileId)) {
        index += 1;
        continue;
      }
      try {
        await training.addResource(entry);
        queue.splice(index, 1);
      } catch (error) {
        if (NEVER_SENDABLE.has(error?.kind)) {
          queue[index] = { ...entry, stuck: true };
          index += 1;
        } else {
          offline = true;
        }
      }
      writeQueue(storage, key, queue);
    }
    remaining += queue.filter((entry) => sendable(entry, profileId)).length;
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
