// src/app/repertoire-import.js
const LOCAL_KEY = 'roda.seqs';
const DONE_PREFIX = 'roda.seqs.imported:';
const BATCH = 100;

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function localSequenceItems(storage) {
  let saved;
  try {
    saved = JSON.parse(storage.getItem(LOCAL_KEY) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((entry) => Array.isArray(entry) && entry.length)
    .map((entry) => entry.map((step) => String(step?.n ?? '').trim()).filter(Boolean).join(', '))
    .filter((text) => text && text.length <= 4000)
    .map((text) => ({ import_ref: `local:${fnv1a(text)}`, title: text.slice(0, 60), source_text: text, sequence: null }));
}

export async function importLocalRepertoire({ storage, repertoire, userId }) {
  const doneKey = `${DONE_PREFIX}${userId}`;
  if (storage.getItem(doneKey) === '1') return { imported: 0, skipped: true };
  const items = localSequenceItems(storage);
  let imported = 0;
  for (let index = 0; index < items.length; index += BATCH) {
    const result = await repertoire.importItems(items.slice(index, index + BATCH));
    imported += Number(result?.imported ?? 0);
  }
  storage.setItem(doneKey, '1');
  return { imported, skipped: false };
}
