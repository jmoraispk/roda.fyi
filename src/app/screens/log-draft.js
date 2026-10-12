// src/app/screens/log-draft.js
const key = (profileId) => `roda.logDraft:${profileId}`;

export function loadDraft(storage, profileId) {
  try {
    const value = JSON.parse(storage.getItem(key(profileId)) ?? 'null');
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export function saveDraft(storage, profileId, draft) {
  try {
    storage.setItem(key(profileId), JSON.stringify(draft));
  } catch {
    // Storage is a convenience; the composer keeps working without it.
  }
}

export function clearDraft(storage, profileId) {
  try {
    storage.removeItem(key(profileId));
  } catch {
    // Nothing to clear when storage is blocked.
  }
}
