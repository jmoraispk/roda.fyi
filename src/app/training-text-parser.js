// src/app/training-text-parser.js
import { matchTable, normalizeTerm, slugify } from './movement-catalog.js';

export { slugify as slugifyTerm };

const ROUND_HEADING = /^\s*(?:(?:round|rodada)\s*\d+|r\s*\d+\s*:|\d+\.)\s*[:.)-]?\s*/i;
const WORD_SEPARATORS = /\b(?:and then|e depois|then|depois)\b/gi;
const FILLER = /^(?:and|e|then|worked on|trabalhei|treino de|treino)\b\s*/;
const SIDES = new Map([
  ['left', 'left'], ['esquerda', 'left'], ['right', 'right'], ['direita', 'right'],
  ['both', 'both'], ['ambos', 'both'], ['ambas', 'both'],
]);
const DURATION = /^(.*?)\s*(\d{1,4})\s*(min|mins|minutes|minutos|m|s|sec|secs|seconds|segundos)$/;
const MAX_COUNT = 9999;

export function splitRounds(text) {
  const rounds = [];
  let current = [];
  const flush = () => {
    const joined = current.join('\n').trim();
    if (joined) rounds.push(joined);
    current = [];
  };
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.trim()) { flush(); continue; }
    if (ROUND_HEADING.test(line)) {
      flush();
      current.push(line.replace(ROUND_HEADING, ''));
      continue;
    }
    current.push(line);
  }
  flush();
  return rounds;
}

function count(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= MAX_COUNT ? number : null;
}

function mappingIndex(termMappings) {
  return new Map(termMappings.map((mapping) => [normalizeTerm(mapping.term), mapping]));
}

function findMatch(normalized) {
  for (const row of matchTable()) {
    if (normalized === row.normalized
      || normalized === `${row.normalized}s` || normalized === `${row.normalized}es`) {
      return { row, rest: '' };
    }
  }
  for (const row of matchTable()) {
    if (normalized.startsWith(`${row.normalized} `)) {
      return { row, rest: normalized.slice(row.normalized.length + 1) };
    }
  }
  return null;
}

function resolveName(text, mappings) {
  const normalized = normalizeTerm(text);
  const mapping = mappings.get(normalized);
  if (mapping?.action === 'ignore') return null;
  if (mapping?.action === 'alias' && mapping.target_slug) {
    const row = matchTable().find(({ slug }) => slug === mapping.target_slug);
    return { slug: mapping.target_slug, name: row?.name ?? text.trim(), catalogued: true, rest: '' };
  }
  if (mapping?.action === 'merge' && mapping.target_term) {
    const merged = findMatch(normalizeTerm(mapping.target_term));
    if (merged && !merged.rest) {
      return { slug: merged.row.slug, name: merged.row.name, catalogued: true, rest: '' };
    }
    return { slug: slugify(mapping.target_term), name: text.trim(), catalogued: false, rest: '' };
  }
  const match = findMatch(normalized);
  if (match) return { slug: match.row.slug, name: match.row.name, catalogued: true, rest: match.rest };
  return { slug: slugify(text), name: text.trim(), catalogued: false, rest: '' };
}

function stripFiller(text) {
  let current = normalizeTerm(text);
  let raw = text.trim();
  for (;;) {
    const match = FILLER.exec(current);
    if (!match) return { normalized: current, raw };
    current = current.slice(match[0].length);
    raw = raw.split(/\s+/).slice(match[0].trim().split(/\s+/).length).join(' ');
  }
}

function moveStep(piece, note, mappings) {
  let { normalized, raw } = stripFiller(piece);
  if (!normalized) return null;
  let reps = null;
  let durationSeconds = null;
  let match = /^(\d+)\s*x\s*(.+)$/.exec(normalized) || /^(\d+)\s+(.+)$/.exec(normalized);
  if (match) { reps = count(match[1]); normalized = match[2]; raw = raw.replace(/^\s*\d+\s*x?\s*/i, ''); }
  match = /^(.+?)\s*x\s*(\d+)$/.exec(normalized);
  if (!reps && match) { reps = count(match[2]); normalized = match[1]; raw = raw.replace(/\s*x\s*\d+\s*$/i, ''); }
  match = DURATION.exec(normalized);
  if (match && match[1]) {
    const amount = count(match[2]);
    durationSeconds = amount && (match[3].startsWith('m') ? amount * 60 : amount);
    normalized = match[1];
    raw = raw.replace(/\s*\d+\s*[a-z]+\s*$/i, '');
  }
  if (!normalized) return null;
  const resolved = resolveName(raw || normalized, mappings);
  if (!resolved) return null;
  const noteText = [resolved.rest, note].filter(Boolean).join(' ').trim() || null;
  return {
    type: 'move', path: '', slug: resolved.slug, name: resolved.name, text: piece.trim(),
    catalogued: resolved.catalogued, reps, durationSeconds, note: noteText,
    side: SIDES.get(normalizeTerm(note ?? '')) ?? null,
  };
}

function assignPaths(steps, prefix = '') {
  steps.forEach((step, index) => {
    step.path = prefix ? `${prefix}.${index + 1}` : String(index + 1);
    if (step.type === 'group') assignPaths(step.steps, step.path);
  });
  return steps;
}

export function parseRound(text, { termMappings = [] } = {}) {
  const mappings = mappingIndex(termMappings);
  const source = String(text ?? '')
    .replace(/\s*(?:->|→)\s*/g, ',')
    .replace(WORD_SEPARATORS, ',')
    .replace(/\r?\n/g, ',');
  const warnings = [];
  let index = 0;

  function readNote() {
    let depth = 1;
    let note = '';
    while (index < source.length) {
      const char = source[index++];
      if (char === '(') depth += 1;
      if (char === ')') { depth -= 1; if (depth === 0) return note.trim(); }
      note += char;
    }
    warnings.push({ code: 'unbalanced_parentheses' });
    return note.trim();
  }

  function readSequence(depth) {
    const steps = [];
    let piece = '';
    let note = null;
    let group = null;
    const finish = () => {
      if (group) {
        if (group.steps.length) steps.push(group);
      } else {
        const step = moveStep(piece, note, mappings);
        if (step) steps.push(step);
      }
      piece = '';
      note = null;
      group = null;
    };
    while (index < source.length) {
      const char = source[index++];
      if (char === ',') { finish(); continue; }
      if (char === ')') {
        if (depth > 0) { finish(); return { steps, closed: true }; }
        warnings.push({ code: 'unbalanced_parentheses' });
        continue;
      }
      if (char === '(') {
        const repeatMatch = /^\s*(\d+)\s*x\s*$/i.exec(piece);
        if (!piece.trim() || repeatMatch) {
          const inner = readSequence(depth + 1);
          if (!inner.closed) warnings.push({ code: 'unbalanced_parentheses' });
          group = {
            type: 'group', path: '', repeat: repeatMatch ? count(repeatMatch[1]) ?? 1 : 1,
            steps: inner.steps,
          };
          piece = '';
        } else {
          note = readNote();
        }
        continue;
      }
      if (group && char.trim()) {
        finish();
      }
      piece += char;
    }
    finish();
    return { steps, closed: false };
  }

  const { steps } = readSequence(0);
  const unique = warnings.length ? [{ code: 'unbalanced_parentheses' }] : [];
  return { steps: assignPaths(steps), warnings: unique };
}
