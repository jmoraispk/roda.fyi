// src/app/movement-catalog.js
import { MOVEMENT_CATALOG } from './generated/movement-catalog.data.js';

export const CATEGORY_ORDER = Object.freeze([
  'essentials', 'golpes', 'esquivas', 'floreios', 'quedas', 'arm-strikes',
]);

const BY_SLUG = new Map(MOVEMENT_CATALOG.map((entry) => [entry.slug, Object.freeze(entry)]));

export function slugify(value) {
  return String(value).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function normalizeTerm(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[-_]+/g, ' ').replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

export function listCategories() {
  return [...CATEGORY_ORDER];
}

export function listMoves({ category = null } = {}) {
  return MOVEMENT_CATALOG.filter((entry) => !category || entry.category === category);
}

export function getMove(slug) {
  return BY_SLUG.get(slug) ?? null;
}

let cachedTable = null;

export function matchTable() {
  if (cachedTable) return cachedTable;
  const seen = new Set();
  const rows = [];
  const add = (text, entry) => {
    const normalized = normalizeTerm(text);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    rows.push({ normalized, slug: entry.slug, name: entry.name });
  };
  for (const entry of MOVEMENT_CATALOG) add(entry.name, entry);
  for (const entry of MOVEMENT_CATALOG) for (const alias of entry.aliases) add(alias, entry);
  cachedTable = Object.freeze(rows.sort((a, b) => b.normalized.length - a.normalized.length));
  return cachedTable;
}
