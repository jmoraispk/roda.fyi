# Training Input, Movement Catalog, and Class Resources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace dropdown-based training composition with text-first round cards backed by one movement catalog, add per-round and per-segment difficulty, an account repertoire, curator-managed uncatalogued terms, text class resources, and recording past classes.

**Architecture:** Pure browser modules (`movement-catalog`, `training-text-parser`, `training-sequence`) turn round text into a step tree, segment list, and the existing movement rows. Forward-only Supabase migrations extend the round/movement tables, add segment-rating, repertoire, curation, and resource tables behind private security-definer functions exposed through thin `public` SQL wrappers. Dashboard views compose a shared `round-editor` UI component; the public Sequences page reuses the catalog and repertoire through a new bundle.

**Tech Stack:** Vanilla ES modules bundled by esbuild, Vitest + jsdom, Playwright against localStorage fake services, Supabase Postgres with pgTAP.

**Spec:** `docs/superpowers/specs/2026-10-10-training-input-catalog-design.md`

## Global Constraints

- Do not modify `tools/`, `assets/figure3d.js`, or `assets/moves3d/`.
- `index.html` changes stay inside `<section id="sequencesView">` and the Sequences script block (`/* build-your-own */` through the end of `wireSequences`), plus one `<script type="module">` tag for the new bundle next to the existing `public-auth.js` tag.
- Every new table has RLS enabled; clients get `select` only where the spec allows; every mutation goes through a `private.*` security-definer function with `set search_path = ''` and fully qualified names, called by a `public.*` `language sql` wrapper passing `auth.uid()`.
- Never edit deployed migrations; add new files under `supabase/migrations/2026101000NN_*.sql`.
- English copy uses American spelling; every new `en` key in `src/app/dashboard-i18n.js` has a `pt` key (existing parity test enforces this).
- Difficulty scale: `easy`, `okay`, `hard` (existing enum `public.movement_difficulty`).
- Round text ≤ 4,000 characters; resource body ≤ 262,144 characters; resource URL `https://` only, ≤ 2,048 characters.
- `npm run test:unit`, `npm run test:e2e`, and `npm run test:db` must pass at the end of every task that touches their area.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Text with no recognizable step** (only filler such as "and", or only punctuation) — the round still saves with its text and zero movement rows; publishing a plan whose rounds have no movement rows still fails with `empty_plan`. Pinned in Task 2 (parser returns no steps) and Task 4 (DB test).
2. **Editing text after rating parts** — ratings for segment keys that no longer exist are dropped, never saved against the wrong segment. Pinned in Task 11.
3. **Re-running the browser repertoire import** after a partial failure — inserts each sequence exactly once. Pinned in Task 6 (DB uniqueness) and Task 14 (import retries).
4. **Hostile summary markdown** (`<script>`, `javascript:` links, raw HTML) — rendered inert. Pinned in Task 17.
5. **Curator relink of a completed, immutable occurrence** — succeeds only through the curator function; ordinary updates to completed rows still fail. Pinned in Task 7.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `scripts/build-movement-catalog.mjs` | Generate catalog data from `assets/moves.data.js` + `assets/moves.extended.js` |
| `src/app/generated/movement-catalog.data.js` | Committed generated catalog entries |
| `src/app/movement-catalog.js` | Catalog queries and match table |
| `src/app/training-text-parser.js` | `splitRounds`, `parseRound`, `slugifyTerm`, `normalizeTerm` |
| `src/app/training-sequence.js` | Segments, movement rows, exclusions, sequence→text |
| `src/app/repertoire-service.js` | Supabase repertoire RPCs |
| `src/app/repertoire-import.js` | One-time localStorage import |
| `src/app/catalog-service.js` | Term mappings + curator RPCs |
| `src/app/markdown-lite.js` | Restricted markdown → DOM |
| `src/app/ui/move-figure.js` | Stick-figure SVG markup |
| `src/app/ui/move-picker.js` | Category chips + tile grid |
| `src/app/ui/round-editor.js` | Round cards: text, chips, difficulty, picker, repertoire, strip |
| `src/app/ui/round-detail.js` | Read-only round rendering + practitioner rating form in day detail |
| `src/app/ui/repertoire-view.js` | My Training Repertoire tab |
| `src/app/ui/catalog-view.js` | Curator Catalog tab |
| `src/app/ui/resource-view.js` | Resource icons, list, and Add resources form |
| `src/app/ui/past-class-view.js` | Coaching "Record a past class" dialog |
| `src/app/entries/public-sequences.js` | Public Sequences account bridge |
| `supabase/migrations/202610100001_training_text_rounds.sql` | Round text, sequence, segment tables, RPCs |
| `supabase/migrations/202610100002_practice_sequences.sql` | Repertoire |
| `supabase/migrations/202610100003_catalog_curation.sql` | Curators, term mappings, relink |
| `supabase/migrations/202610100004_training_resources.sql` | Resources + past classes |
| `supabase/migrations/202610100005_segment_statistics.sql` | Statistics from segment ratings |
| `supabase/tests/0010_training_text_rounds.test.sql` … `0014_segment_statistics.test.sql` | DB tests |

Modified: `src/app/training-service.js`, `src/app/testing/fake-services.js`, `src/app/dashboard-i18n.js`, `src/app/dashboard-state.js`, `src/app/ui/dashboard-view.js`, `src/app/ui/training-calendar-view.js`, `src/app/ui/coaching-training-view.js`, `src/app/ui/statistics-view.js`, `src/app/training-plan-state.js`, `src/app/entries/dashboard.js`, `src/app/demo-data.js`, `scripts/build.mjs`, `dashboard.html`, `index.html` (Sequences only), `assets/training-forms.css`, `package.json`.

---

### Task 1: Movement catalog

**Files:**
- Create: `scripts/build-movement-catalog.mjs`, `src/app/generated/movement-catalog.data.js` (generated), `src/app/movement-catalog.js`
- Modify: `package.json` (add `"build:catalog": "node scripts/build-movement-catalog.mjs"`)
- Test: `tests/unit/movement-catalog.test.js`

**Interfaces:**
- Produces:
  - `buildCatalogEntries({ movesSource: string, extendedSource: string }) → Entry[]` (from the script, exported for tests)
  - `renderCatalogModule(entries) → string`
  - `Entry = { slug, name, aliases: string[], category, pose: object|null, highlight: string|null }`
  - `CATEGORY_ORDER = ['essentials','golpes','esquivas','floreios','quedas','arm-strikes']`
  - `listCategories() → string[]`, `listMoves({ category } = {}) → Entry[]`, `getMove(slug) → Entry|null`, `matchTable() → Array<{ normalized, slug, name }>` sorted by `normalized.length` desc
  - `slugify(name) → string` (same rule as `index.html`)

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/movement-catalog.test.js
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
  buildCatalogEntries, renderCatalogModule,
} from '../../scripts/build-movement-catalog.mjs';
import {
  getMove, listCategories, listMoves, matchTable, slugify,
} from '../../src/app/movement-catalog.js';

async function sources() {
  return {
    movesSource: await readFile('assets/moves.data.js', 'utf8'),
    extendedSource: await readFile('assets/moves.extended.js', 'utf8'),
  };
}

describe('movement catalog', () => {
  it('keeps the committed generated module in sync with its sources', async () => {
    const expected = renderCatalogModule(buildCatalogEntries(await sources()));
    const committed = await readFile('src/app/generated/movement-catalog.data.js', 'utf8');
    expect(committed).toBe(expected);
  });

  it('uses the capture pipeline slugs for every figure-bearing move', async () => {
    const captured = JSON.parse(await readFile('tools/mocap/sources.json', 'utf8'))
      .moves.map(({ slug }) => slug).sort();
    const figured = listMoves().filter(({ pose }) => pose).map(({ slug }) => slug).sort();
    expect(figured).toEqual(captured);
  });

  it('adds essentials and arm strikes without figures', () => {
    expect(getMove('ginga')).toMatchObject({ name: 'Ginga', category: 'essentials', pose: null });
    expect(listMoves({ category: 'arm-strikes' }).map(({ slug }) => slug))
      .toEqual(['galopante', 'godeme', 'elbow-strike', 'escala']);
    expect(listCategories()).toEqual([
      'essentials', 'golpes', 'esquivas', 'floreios', 'quedas', 'arm-strikes',
    ]);
  });

  it('slugifies like the public site', () => {
    expect(slugify('Bênção')).toBe('bencao');
    expect(slugify('Aú')).toBe('au');
    expect(slugify('Meia-lua de compasso')).toBe('meia-lua-de-compasso');
  });

  it('builds a longest-first match table where names beat aliases', () => {
    const table = matchTable();
    const lengths = table.map(({ normalized }) => normalized.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
    expect(table.find(({ normalized }) => normalized === 'au').slug).toBe('au');
    expect(table.find(({ normalized }) => normalized === 'meia lua de compasso').slug)
      .toBe('meia-lua-de-compasso');
    expect(new Set(table.map(({ normalized }) => normalized)).size).toBe(table.length);
  });

  it('returns null for unknown slugs', () => {
    expect(getMove('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/movement-catalog.test.js`
Expected: FAIL — cannot resolve `scripts/build-movement-catalog.mjs`.

- [ ] **Step 3: Write the generator**

```js
// scripts/build-movement-catalog.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const OUTPUT = 'src/app/generated/movement-catalog.data.js';

const EXTRA_ENTRIES = Object.freeze([
  { slug: 'ginga', name: 'Ginga', category: 'essentials' },
  { slug: 'galopante', name: 'Galopante', category: 'arm-strikes' },
  { slug: 'godeme', name: 'Godeme', category: 'arm-strikes' },
  { slug: 'elbow-strike', name: 'Elbow strike', category: 'arm-strikes' },
  { slug: 'escala', name: 'Escala', category: 'arm-strikes' },
]);

export function slugify(value) {
  return String(value).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function evaluate(source, exportName) {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(`${source}\n;globalThis.__export = ${exportName};`, context);
  return context.__export;
}

export function buildCatalogEntries({ movesSource, extendedSource }) {
  const categories = evaluate(movesSource, 'window.RODA_MOVES');
  const extended = evaluate(extendedSource, 'MOVES_EXT');
  const aliasesFor = (slug) => [...(extended[slug]?.aliases ?? [])];
  const entries = [];
  for (const category of categories) {
    for (const move of category.moves) {
      const slug = slugify(move.n);
      entries.push({
        slug,
        name: move.n,
        aliases: aliasesFor(slug),
        category: category.id,
        pose: move.p ?? null,
        highlight: move.hi ?? null,
      });
    }
  }
  for (const extra of EXTRA_ENTRIES) {
    entries.push({ ...extra, aliases: aliasesFor(extra.slug), pose: null, highlight: null });
  }
  return entries;
}

export function renderCatalogModule(entries) {
  return [
    '// AUTO-GENERATED by scripts/build-movement-catalog.mjs — do not edit by hand.',
    '// Source: assets/moves.data.js and assets/moves.extended.js.',
    `export const MOVEMENT_CATALOG = ${JSON.stringify(entries, null, 2)};`,
    '',
  ].join('\n');
}

async function main() {
  const entries = buildCatalogEntries({
    movesSource: await readFile('assets/moves.data.js', 'utf8'),
    extendedSource: await readFile('assets/moves.extended.js', 'utf8'),
  });
  await mkdir('src/app/generated', { recursive: true });
  await writeFile(OUTPUT, renderCatalogModule(entries));
  console.log(`Wrote ${entries.length} movements to ${OUTPUT}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
```

- [ ] **Step 4: Generate the data module**

Run: `npm pkg set scripts.build:catalog="node scripts/build-movement-catalog.mjs" && npm run build:catalog`
Expected: `Wrote 57 movements to src/app/generated/movement-catalog.data.js`

- [ ] **Step 5: Write the catalog module**

```js
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/movement-catalog.test.js`
Expected: PASS (6 tests). If the parity test fails because a catalog name slugifies differently from `sources.json`, stop and report the mismatching slugs — do not edit `tools/`.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-movement-catalog.mjs src/app/generated src/app/movement-catalog.js tests/unit/movement-catalog.test.js package.json
git commit -m "feat: add shared movement catalog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Round text parser

**Files:**
- Create: `src/app/training-text-parser.js`
- Test: `tests/unit/training-text-parser.test.js`

**Interfaces:**
- Consumes: `matchTable()`, `normalizeTerm()`, `slugify()` from Task 1.
- Produces:
  - `splitRounds(text: string) → string[]`
  - `slugifyTerm(text) → string` (alias of `slugify`)
  - `parseRound(text, { termMappings = [] } = {}) → { steps: Step[], warnings: Array<{ code }> }`
  - `MoveStep = { type: 'move', path: string, slug, name, text, catalogued: boolean, reps: number|null, durationSeconds: number|null, note: string|null, side: 'left'|'right'|'both'|null }`
  - `GroupStep = { type: 'group', path: string, repeat: number, steps: Step[] }`
  - `TermMapping = { term: string, action: 'alias'|'merge'|'ignore'|null, target_slug: string|null, target_term: string|null }`
  - Warning codes: `unbalanced_parentheses`.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/training-text-parser.test.js
import { describe, expect, it } from 'vitest';

import { parseRound, splitRounds } from '../../src/app/training-text-parser.js';

const names = (steps) => steps.map((step) => (
  step.type === 'group' ? { group: step.repeat, steps: names(step.steps) } : step.slug
));

describe('splitRounds', () => {
  it('splits on blank lines and round headings', () => {
    expect(splitRounds('ginga 10 min\n\narmada, au')).toEqual(['ginga 10 min', 'armada, au']);
    expect(splitRounds('Round 1: ginga\nRound 2: armada\nR3: au\nRodada 4 queixada\n5. martelo'))
      .toEqual(['ginga', 'armada', 'au', 'queixada', 'martelo']);
  });

  it('keeps a single round and ignores empty input', () => {
    expect(splitRounds('10x armada\nthen au')).toEqual(['10x armada\nthen au']);
    expect(splitRounds('   \n\n ')).toEqual([]);
  });
});

describe('parseRound', () => {
  it('reads separators as order', () => {
    const { steps } = parseRound('armada, meia lua de compasso → aú -> ginga then negativa e depois role');
    expect(names(steps)).toEqual([
      'armada', 'meia-lua-de-compasso', 'au', 'ginga', 'negativa', 'role',
    ]);
    expect(steps.map(({ path }) => path)).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('prefers the longest catalog name and ignores accents and hyphens', () => {
    expect(parseRound('Meia-Lua de Compasso').steps[0].slug).toBe('meia-lua-de-compasso');
    expect(parseRound('MEIA LUA DE FRENTE').steps[0].slug).toBe('meia-lua-de-frente');
    expect(parseRound('Au').steps[0]).toMatchObject({ slug: 'au', catalogued: true, name: 'Aú' });
  });

  it('reads repetitions, plurals, durations, and notes', () => {
    const [a, b, c, d, e] = parseRound(
      '10x armada, au x5, 3 armadas, ginga 10 min, queixada (left)',
    ).steps;
    expect(a).toMatchObject({ slug: 'armada', reps: 10 });
    expect(b).toMatchObject({ slug: 'au', reps: 5 });
    expect(c).toMatchObject({ slug: 'armada', reps: 3 });
    expect(d).toMatchObject({ slug: 'ginga', durationSeconds: 600 });
    expect(e).toMatchObject({ slug: 'queixada', note: 'left', side: 'left' });
  });

  it('parses nested repeat groups', () => {
    const { steps, warnings } = parseRound('10x (armada, meia lua de compasso, aú, 3x ginga), 2x (au, (role, negativa))');
    expect(warnings).toEqual([]);
    expect(names(steps)).toEqual([
      { group: 10, steps: ['armada', 'meia-lua-de-compasso', 'au', 'ginga'] },
      { group: 2, steps: ['au', { group: 1, steps: ['role', 'negativa'] }] },
    ]);
    expect(steps[0].steps[3]).toMatchObject({ path: '1.4', reps: 3 });
    expect(steps[1].steps[1].steps[1].path).toBe('2.2.2');
  });

  it('keeps unknown words in place as uncatalogued steps', () => {
    const { steps } = parseRound('armada, galopanti, worked on au');
    expect(steps[1]).toMatchObject({
      type: 'move', slug: 'galopanti', name: 'galopanti', catalogued: false,
    });
    expect(steps[2].slug).toBe('au');
  });

  it('drops filler-only pieces and survives empty or punctuation-only text', () => {
    expect(parseRound('and, e, ,').steps).toEqual([]);
    expect(parseRound('').steps).toEqual([]);
    expect(parseRound('→ → ,,').steps).toEqual([]);
  });

  it('warns on unbalanced parentheses but still parses', () => {
    const open = parseRound('3x (armada, au');
    expect(open.warnings).toEqual([{ code: 'unbalanced_parentheses' }]);
    expect(names(open.steps)).toEqual([{ group: 3, steps: ['armada', 'au'] }]);
    const close = parseRound('armada), au');
    expect(close.warnings).toEqual([{ code: 'unbalanced_parentheses' }]);
    expect(names(close.steps)).toEqual(['armada', 'au']);
  });

  it('applies curator term mappings', () => {
    const termMappings = [
      { term: 'meia lua', action: 'alias', target_slug: 'meia-lua-de-frente', target_term: null },
      { term: 'galopanti', action: 'merge', target_slug: null, target_term: 'galopante' },
      { term: 'stretch', action: 'ignore', target_slug: null, target_term: null },
    ];
    const { steps } = parseRound('meia lua, galopanti, stretch, armada', { termMappings });
    expect(steps.map(({ slug, catalogued }) => [slug, catalogued])).toEqual([
      ['meia-lua-de-frente', true], ['galopante', true], ['armada', true],
    ]);
  });

  it('never throws on arbitrary text', () => {
    for (const text of ['((((', '))))', '10x', 'x10', '(', '0x armada', '999999999999x au']) {
      expect(() => parseRound(text)).not.toThrow();
    }
  });
});
```

Note on the merge case: `galopante` is in the catalog (Task 1), so a merge to a catalog name resolves as catalogued. Merging to an unknown term keeps `catalogued: false`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/training-text-parser.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/training-text-parser.test.js`
Expected: PASS (11 tests). Fix the implementation, not the expectations, if any fail.

- [ ] **Step 5: Commit**

```bash
git add src/app/training-text-parser.js tests/unit/training-text-parser.test.js
git commit -m "feat: parse free-text training rounds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Sequence segments and movement rows

**Files:**
- Create: `src/app/training-sequence.js`
- Test: `tests/unit/training-sequence.test.js`

**Interfaces:**
- Consumes: `Step` types from Task 2.
- Produces:
  - `withoutExcluded(steps, excludedPaths: Set<string>) → Step[]` (drops excluded move steps and empty groups; keeps original paths)
  - `buildSegments(steps) → Segment[]` where `Segment = { key, kind: 'setup'|'move'|'transition'|'loop', label, from: string|null, to: string|null, slug: string|null }`
  - `toMovementRows(steps) → Array<{ movement_key, movement_name, catalogued, segment_key, side, repetitions, duration_seconds, instructions }>`
  - `sequenceToText(steps) → string` (canonical notation, used for legacy rounds and the public page)
  - `ROUND_SEGMENT = { key: 'r', kind: 'round' }`
  - Segment keys: setup `s`; move `m:<path>`; transition `t:<fromPath>><toPath>`; loop `l:<groupPath>`.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/training-sequence.test.js
import { describe, expect, it } from 'vitest';

import { parseRound } from '../../src/app/training-text-parser.js';
import {
  buildSegments, sequenceToText, toMovementRows, withoutExcluded,
} from '../../src/app/training-sequence.js';

const steps = (text) => parseRound(text).steps;

describe('training sequence', () => {
  it('builds setup, moves, transitions, and loops in order', () => {
    const segments = buildSegments(steps('ginga, 2x (armada, au), negativa'));
    expect(segments.map(({ key }) => key)).toEqual([
      's', 'm:1', 't:1>2.1', 'm:2.1', 't:2.1>2.2', 'm:2.2', 'l:2', 't:2.2>3', 'm:3',
    ]);
    expect(segments[2]).toMatchObject({ kind: 'transition', from: 'ginga', to: 'armada' });
    expect(segments[6]).toMatchObject({ kind: 'loop', from: 'au', to: 'armada' });
    expect(segments[0]).toMatchObject({ kind: 'setup', from: null, to: 'ginga' });
  });

  it('omits the loop for single-pass groups and returns nothing for empty rounds', () => {
    expect(buildSegments(steps('(armada, au)')).map(({ key }) => key))
      .toEqual(['s', 'm:1.1', 't:1.1>1.2', 'm:1.2']);
    expect(buildSegments([])).toEqual([]);
  });

  it('flattens moves into ordered movement rows with segment keys', () => {
    expect(toMovementRows(steps('10x armada, 3x (au, galopanti (left))'))).toEqual([
      {
        movement_key: 'armada', movement_name: 'Armada', catalogued: true, segment_key: 'm:1',
        side: null, repetitions: 10, duration_seconds: null, instructions: null,
      },
      {
        movement_key: 'au', movement_name: 'Aú', catalogued: true, segment_key: 'm:2.1',
        side: null, repetitions: null, duration_seconds: null, instructions: null,
      },
      {
        movement_key: 'galopanti', movement_name: 'galopanti', catalogued: false,
        segment_key: 'm:2.2', side: 'left', repetitions: null, duration_seconds: null,
        instructions: 'left',
      },
    ]);
  });

  it('removes excluded steps while keeping the remaining paths stable', () => {
    const kept = withoutExcluded(steps('armada, stretching, au'), new Set(['2']));
    expect(kept.map(({ path }) => path)).toEqual(['1', '3']);
    expect(buildSegments(kept).map(({ key }) => key)).toEqual(['s', 'm:1', 't:1>3', 'm:3']);
  });

  it('writes canonical notation', () => {
    expect(sequenceToText(steps('10x (armada, au, 3x ginga), negativa 30s')))
      .toBe('10x (Armada, Aú, 3x Ginga), Negativa 30s');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/training-sequence.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// src/app/training-sequence.js
export const ROUND_SEGMENT = Object.freeze({ key: 'r', kind: 'round' });

export function withoutExcluded(steps, excludedPaths = new Set()) {
  const result = [];
  for (const step of steps) {
    if (step.type === 'group') {
      const inner = withoutExcluded(step.steps, excludedPaths);
      if (inner.length) result.push({ ...step, steps: inner });
    } else if (!excludedPaths.has(step.path)) {
      result.push(step);
    }
  }
  return result;
}

function leaves(steps) {
  return steps.flatMap((step) => (step.type === 'group' ? leaves(step.steps) : [step]));
}

function moveLabel(step) {
  return step.reps ? `${step.name} ×${step.reps}` : step.name;
}

export function buildSegments(steps) {
  const segments = [];
  let previous = null;
  function visit(list) {
    for (const step of list) {
      if (step.type === 'group') {
        visit(step.steps);
        const inner = leaves(step.steps);
        if (step.repeat > 1 && inner.length) {
          const first = inner[0];
          const last = inner[inner.length - 1];
          segments.push({
            key: `l:${step.path}`, kind: 'loop', label: `↺ ×${step.repeat}`,
            from: last.slug, to: first.slug, slug: null,
          });
        }
        continue;
      }
      if (!previous) {
        segments.push({ key: 's', kind: 'setup', label: 'setup', from: null, to: step.slug, slug: null });
      } else {
        segments.push({
          key: `t:${previous.path}>${step.path}`, kind: 'transition', label: '→',
          from: previous.slug, to: step.slug, slug: null,
        });
      }
      segments.push({
        key: `m:${step.path}`, kind: 'move', label: moveLabel(step),
        from: null, to: null, slug: step.slug,
      });
      previous = step;
    }
  }
  visit(steps);
  return segments;
}

export function toMovementRows(steps) {
  return leaves(steps).map((step) => ({
    movement_key: step.slug,
    movement_name: step.name,
    catalogued: step.catalogued,
    segment_key: `m:${step.path}`,
    side: step.side,
    repetitions: step.reps,
    duration_seconds: step.durationSeconds,
    instructions: step.note,
  }));
}

function durationText(seconds) {
  return seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds}s`;
}

export function sequenceToText(steps) {
  return steps.map((step) => {
    if (step.type === 'group') return `${step.repeat}x (${sequenceToText(step.steps)})`;
    const parts = [step.reps ? `${step.reps}x ${step.name}` : step.name];
    if (step.durationSeconds) parts.push(durationText(step.durationSeconds));
    if (step.note) parts.push(`(${step.note})`);
    return parts.join(' ');
  }).join(', ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/training-sequence.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/training-sequence.js tests/unit/training-sequence.test.js
git commit -m "feat: derive segments and movement rows from round sequences

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Database — round text, segment ratings, and accent-safe keys

**Files:**
- Create: `supabase/migrations/202610100001_training_text_rounds.sql`
- Test: `supabase/tests/0010_training_text_rounds.test.sql`

**Interfaces:**
- Consumes: existing `private.insert_plan_rounds`, `private.insert_occurrence_rounds`, `private.copy_plan_to_occurrence`, `private.plan_rounds_json`, `private.occurrence_rounds_json`, `private.record_alone_training` (replaced with identical signatures).
- Produces:
  - Round payload accepted by every round-taking RPC (`create_workout_plan`, `save_workout_plan_draft`, `record_alone_training`, `complete_*`):
    ```json
    { "label": null, "source_text": "10x (armada, au)", "sequence": [/* Step tree */],
      "movements": [{ "movement_key": "armada", "movement_name": "Armada", "catalogued": true,
                      "segment_key": "m:1.1", "side": null, "repetitions": null,
                      "duration_seconds": null, "instructions": null }],
      "ratings": [{ "segment_key": "r", "segment_kind": "round", "difficulty": "hard",
                    "note": null, "from_movement_key": null, "to_movement_key": null }] }
    ```
    `ratings` become plan expectations for plans and practitioner assessments for `record_alone_training`; they are ignored by `complete_*`.
  - Round JSON returned by `list_workout_plans` and `get_training_day` gains `source_text`, `sequence`, `ratings` (expectations for plans; the caller's participation assessments for days), and for days `planned` (expectations of the scheduled plan round at the same position). Movements gain `catalogued` and `segment_key`.
  - `public.save_round_assessments(participation_id uuid, round_id uuid, ratings jsonb) → jsonb { status: 'saved' }` — replaces all ratings of that participation for that round.
  - Enum `public.training_segment_kind` = `round | setup | move | transition | loop`.

- [ ] **Step 1: Write the failing database test**

```sql
-- supabase/tests/0010_training_text_rounds.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_column('public', 'workout_plan_rounds', 'source_text', 'plan rounds keep text');
select has_column('public', 'training_occurrence_rounds', 'sequence', 'occurrence rounds keep parsed sequence');
select has_column('public', 'training_occurrence_movements', 'catalogued', 'movements flag catalog matches');
select has_table('public', 'workout_plan_segment_expectations', 'plan expectations exist');
select has_table('public', 'training_segment_assessments', 'segment assessments exist');
select has_function('public', 'save_round_assessments', array['uuid', 'uuid', 'jsonb']);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.training_segment_assessments'::regclass),
  'segment assessments have RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.workout_plan_segment_expectations'::regclass),
  'plan expectations have RLS'
);

select tests.create_user('10000000-0000-0000-0000-000000001001', 'coach10@example.test', 'Mestre Dez');
select tests.create_user('10000000-0000-0000-0000-000000001002', 'student10@example.test', 'Ana Dez');
select tests.create_user('10000000-0000-0000-0000-000000001003', 'outsider10@example.test', 'Caio Dez');
insert into public.coach_profiles (profile_id) values ('10000000-0000-0000-0000-000000001001');

-- Coach creates a text plan with an uncatalogued move and expectations.
reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001001');
select public.create_workout_plan(
  'Text plan', null, null, 45, null,
  '[{"source_text":"3x (armada, galopanti)","sequence":[{"type":"group","path":"1","repeat":3,"steps":[]}],
     "movements":[
       {"movement_key":"Aú","movement_name":"Aú","catalogued":true,"segment_key":"m:1.1"},
       {"movement_key":"galopanti","movement_name":"galopanti","catalogued":false,"segment_key":"m:1.2"}],
     "ratings":[
       {"segment_key":"r","segment_kind":"round","difficulty":"hard"},
       {"segment_key":"t:1.1>1.2","segment_kind":"transition","difficulty":"hard",
        "from_movement_key":"au","to_movement_key":"galopanti","note":"spin late"}]}]'::jsonb
) ->> 'plan_id' as text_plan_id \gset
select is(
  (select movement_key from public.workout_plan_movements where segment_key = 'm:1.1'),
  'au', 'accented keys are normalized without losing letters'
);
select is(
  (select catalogued from public.workout_plan_movements where segment_key = 'm:1.2'),
  false, 'uncatalogued flag is stored'
);
select is(
  (select rounds -> 0 ->> 'source_text' from public.list_workout_plans(null) where plan_id = :'text_plan_id'),
  '3x (armada, galopanti)', 'plan listing returns round text'
);
select is(
  (select jsonb_array_length(rounds -> 0 -> 'ratings') from public.list_workout_plans(null) where plan_id = :'text_plan_id'),
  2, 'plan listing returns expectations'
);
select lives_ok(
  format($$select public.publish_workout_plan(%L)$$, :'text_plan_id'),
  'a text plan with movements publishes'
);
reset role;
select throws_ok(
  $$insert into public.workout_plan_segment_expectations (plan_round_id, segment_key, segment_kind, difficulty)
    select id, 's', 'setup', 'easy' from public.workout_plan_rounds
     where source_text = '3x (armada, galopanti)'$$,
  'P0001', 'published_plan_immutable', 'expectations freeze with the published version'
);

-- A plan whose only round is text with no moves cannot publish.
reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001001');
select public.create_workout_plan(
  'Stretch only', null, null, 20, null,
  '[{"source_text":"and, e","sequence":[],"movements":[]}]'::jsonb
) ->> 'plan_id' as empty_plan_id \gset
select throws_ok(
  format($$select public.publish_workout_plan(%L)$$, :'empty_plan_id'),
  'P0001', 'empty_plan', 'text without moves saves as draft but cannot publish'
);

-- Practitioner records Alone training with round and segment ratings.
reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001002');
select public.record_alone_training(
  '2026-10-01', 'Europe/Lisbon', 40, null,
  '[{"source_text":"armada, au","sequence":[],
     "movements":[{"movement_key":"armada","movement_name":"Armada","segment_key":"m:1"},
                  {"movement_key":"au","movement_name":"Aú","segment_key":"m:2"}],
     "ratings":[{"segment_key":"r","segment_kind":"round","difficulty":"okay"},
                {"segment_key":"m:2","segment_kind":"move","difficulty":"hard","note":"wobbly"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000001001', '2026-10-01T10:00:00Z'
) ->> 'participation_id' as participation_id \gset
select is(
  (select count(*)::integer from public.training_segment_assessments where participation_id = :'participation_id'),
  2, 'record_alone_training stores round ratings'
);
select is(
  (select public.get_training_day('2026-10-01', null) -> 0 -> 'rounds' -> 0 ->> 'source_text'),
  'armada, au', 'day detail returns round text'
);
select is(
  (select jsonb_array_length(public.get_training_day('2026-10-01', null) -> 0 -> 'rounds' -> 0 -> 'ratings')),
  2, 'day detail returns the caller ratings'
);
select (select id from public.training_occurrence_rounds round
         where round.occurrence_id = (select occurrence_id from public.training_participations where id = :'participation_id')) as round_id \gset
select is(
  public.save_round_assessments(
    :'participation_id', :'round_id',
    '[{"segment_key":"t:1>2","segment_kind":"transition","difficulty":"hard","from_movement_key":"armada","to_movement_key":"au"}]'::jsonb
  ) ->> 'status',
  'saved', 'the practitioner replaces round ratings'
);
select is(
  (select array_agg(segment_key order by segment_key) from public.training_segment_assessments where participation_id = :'participation_id'),
  array['t:1>2']::text[], 'save_round_assessments replaces the previous set'
);
select throws_ok(
  format($$select public.save_round_assessments(%L, %L, '[{"segment_key":"x:1","segment_kind":"move","difficulty":"hard"}]'::jsonb)$$,
    :'participation_id', :'round_id'),
  '23514', null, 'malformed segment keys are rejected'
);
select throws_ok(
  format($$insert into public.training_segment_assessments (participation_id, occurrence_round_id, segment_key, segment_kind, difficulty)
           values (%L, %L, 'r', 'round', 'easy')$$, :'participation_id', :'round_id'),
  '42501', null, 'clients cannot write assessments directly'
);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001003');
select throws_ok(
  format($$select public.save_round_assessments(%L, %L, '[]'::jsonb)$$, :'participation_id', :'round_id'),
  'PT403', 'not_authorized', 'another person cannot rate this training'
);
select is(
  (select count(*)::integer from public.training_segment_assessments),
  0, 'unrelated users cannot read assessments'
);

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run supabase:reset && npx supabase test db supabase/tests/0010_training_text_rounds.test.sql`
Expected: FAIL — `has_column` and `has_table` assertions fail.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/202610100001_training_text_rounds.sql
create extension if not exists unaccent with schema extensions;

create type public.training_segment_kind as enum ('round', 'setup', 'move', 'transition', 'loop');

alter table public.workout_plan_rounds
  add column source_text text,
  add column sequence jsonb,
  add constraint workout_plan_rounds_source_text_check
    check (source_text is null or char_length(source_text) <= 4000),
  add constraint workout_plan_rounds_sequence_check
    check (sequence is null or jsonb_typeof(sequence) = 'array');
alter table public.training_occurrence_rounds
  add column source_text text,
  add column sequence jsonb,
  add constraint training_occurrence_rounds_source_text_check
    check (source_text is null or char_length(source_text) <= 4000),
  add constraint training_occurrence_rounds_sequence_check
    check (sequence is null or jsonb_typeof(sequence) = 'array');

alter table public.workout_plan_movements
  add column catalogued boolean not null default true,
  add column segment_key text,
  add constraint workout_plan_movements_segment_key_check
    check (segment_key is null or segment_key ~ '^m:[0-9]+(\.[0-9]+)*$');
alter table public.training_occurrence_movements
  add column catalogued boolean not null default true,
  add column segment_key text,
  add constraint training_occurrence_movements_segment_key_check
    check (segment_key is null or segment_key ~ '^m:[0-9]+(\.[0-9]+)*$');

create or replace function private.normalize_training_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.movement_key := trim(both '-' from regexp_replace(
    lower(extensions.unaccent(
      'extensions.unaccent'::regdictionary, btrim(coalesce(new.movement_key, ''))
    )),
    '[^a-z0-9]+', '-', 'g'
  ));
  new.movement_name_snapshot := btrim(coalesce(new.movement_name_snapshot, ''));
  if new.movement_key = '' or new.movement_name_snapshot = '' then
    raise exception using errcode = 'P0001', message = 'invalid_movement';
  end if;
  return new;
end;
$$;

create table public.workout_plan_segment_expectations (
  id uuid primary key default extensions.gen_random_uuid(),
  plan_round_id uuid not null references public.workout_plan_rounds(id) on delete cascade,
  segment_key text not null,
  segment_kind public.training_segment_kind not null,
  difficulty public.movement_difficulty not null,
  note text,
  from_movement_key text,
  to_movement_key text,
  created_at timestamptz not null default now(),
  constraint workout_plan_segment_expectations_unique unique (plan_round_id, segment_key),
  constraint workout_plan_segment_expectations_key_check check (
    (segment_kind = 'round' and segment_key = 'r')
    or (segment_kind = 'setup' and segment_key = 's')
    or (segment_kind = 'move' and segment_key ~ '^m:[0-9]+(\.[0-9]+)*$')
    or (segment_kind = 'transition' and segment_key ~ '^t:[0-9]+(\.[0-9]+)*>[0-9]+(\.[0-9]+)*$')
    or (segment_kind = 'loop' and segment_key ~ '^l:[0-9]+(\.[0-9]+)*$')
  ),
  constraint workout_plan_segment_expectations_note_check
    check (note is null or char_length(note) <= 2000),
  constraint workout_plan_segment_expectations_moves_check check (
    (from_movement_key is null or from_movement_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
    and (to_movement_key is null or to_movement_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
  )
);

create table public.training_segment_assessments (
  id uuid primary key default extensions.gen_random_uuid(),
  participation_id uuid not null references public.training_participations(id) on delete cascade,
  occurrence_round_id uuid not null references public.training_occurrence_rounds(id) on delete cascade,
  segment_key text not null,
  segment_kind public.training_segment_kind not null,
  difficulty public.movement_difficulty not null,
  note text,
  from_movement_key text,
  to_movement_key text,
  created_at timestamptz not null default now(),
  constraint training_segment_assessments_unique
    unique (participation_id, occurrence_round_id, segment_key),
  constraint training_segment_assessments_key_check check (
    (segment_kind = 'round' and segment_key = 'r')
    or (segment_kind = 'setup' and segment_key = 's')
    or (segment_kind = 'move' and segment_key ~ '^m:[0-9]+(\.[0-9]+)*$')
    or (segment_kind = 'transition' and segment_key ~ '^t:[0-9]+(\.[0-9]+)*>[0-9]+(\.[0-9]+)*$')
    or (segment_kind = 'loop' and segment_key ~ '^l:[0-9]+(\.[0-9]+)*$')
  ),
  constraint training_segment_assessments_note_check
    check (note is null or char_length(note) <= 2000),
  constraint training_segment_assessments_moves_check check (
    (from_movement_key is null or from_movement_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
    and (to_movement_key is null or to_movement_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
  )
);
create index training_segment_assessments_round_idx
  on public.training_segment_assessments (occurrence_round_id);

create function private.protect_published_plan_expectation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_round_id uuid;
begin
  target_round_id := case when tg_op = 'DELETE' then old.plan_round_id else new.plan_round_id end;
  if exists (
    select 1
      from public.workout_plan_rounds round
      join public.workout_plan_versions version on version.id = round.plan_version_id
     where round.id = target_round_id and version.published_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'published_plan_immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger workout_plan_segment_expectations_protect_published
before insert or update or delete on public.workout_plan_segment_expectations
for each row execute function private.protect_published_plan_expectation();

alter table public.workout_plan_segment_expectations enable row level security;
alter table public.training_segment_assessments enable row level security;

create policy workout_plan_segment_expectations_select_authorized
on public.workout_plan_segment_expectations for select to authenticated
using (exists (
  select 1
    from public.workout_plan_rounds round
    join public.workout_plan_versions version on version.id = round.plan_version_id
    join public.workout_plans plan on plan.id = version.plan_id
   where round.id = workout_plan_segment_expectations.plan_round_id
     and (plan.creator_profile_id = auth.uid()
       or (plan.source_group_id is not null and private.is_group_coach(plan.source_group_id, auth.uid())))
));

create policy training_segment_assessments_select_authorized
on public.training_segment_assessments for select to authenticated
using (exists (
  select 1 from public.training_participations participation
   where participation.id = training_segment_assessments.participation_id
     and private.can_read_training(auth.uid(), participation.profile_id)
));

revoke all on table public.workout_plan_segment_expectations, public.training_segment_assessments
from public, anon, authenticated;
grant select on table public.workout_plan_segment_expectations, public.training_segment_assessments
to authenticated;

create function private.ratings_rows(ratings jsonb)
returns table (
  segment_key text, segment_kind public.training_segment_kind,
  difficulty public.movement_difficulty, note text,
  from_movement_key text, to_movement_key text
)
language sql
stable
set search_path = ''
as $$
  select item ->> 'segment_key',
         (item ->> 'segment_kind')::public.training_segment_kind,
         (item ->> 'difficulty')::public.movement_difficulty,
         nullif(btrim(coalesce(item ->> 'note', '')), ''),
         nullif(item ->> 'from_movement_key', ''),
         nullif(item ->> 'to_movement_key', '')
    from jsonb_array_elements(
      case when jsonb_typeof(ratings) = 'array' then ratings else '[]'::jsonb end
    ) item;
$$;

create or replace function private.insert_plan_rounds(target_version_id uuid, round_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  round_item jsonb;
  round_position bigint;
  created_round_id uuid;
  movement_item jsonb;
  movement_position bigint;
begin
  if round_payload is null then
    round_payload := '[]'::jsonb;
  end if;
  if jsonb_typeof(round_payload) <> 'array' then
    raise exception using errcode = 'P0001', message = 'invalid_rounds';
  end if;

  for round_item, round_position in
    select value, ordinality from jsonb_array_elements(round_payload) with ordinality
  loop
    if jsonb_typeof(coalesce(round_item -> 'movements', '[]'::jsonb)) <> 'array' then
      raise exception using errcode = 'P0001', message = 'invalid_rounds';
    end if;
    insert into public.workout_plan_rounds (
      plan_version_id, position, label, repetitions, duration_seconds,
      rest_seconds, instructions, source_text, sequence
    ) values (
      target_version_id, round_position,
      nullif(btrim(round_item ->> 'label'), ''),
      nullif(round_item ->> 'repetitions', '')::integer,
      nullif(round_item ->> 'duration_seconds', '')::integer,
      nullif(round_item ->> 'rest_seconds', '')::integer,
      nullif(btrim(round_item ->> 'instructions'), ''),
      nullif(btrim(round_item ->> 'source_text'), ''),
      case when jsonb_typeof(round_item -> 'sequence') = 'array' then round_item -> 'sequence' end
    ) returning id into created_round_id;

    for movement_item, movement_position in
      select value, ordinality
        from jsonb_array_elements(coalesce(round_item -> 'movements', '[]'::jsonb))
             with ordinality
    loop
      insert into public.workout_plan_movements (
        plan_round_id, position, movement_key, movement_name_snapshot,
        side, repetitions, duration_seconds, instructions, catalogued, segment_key
      ) values (
        created_round_id, movement_position,
        movement_item ->> 'movement_key',
        coalesce(movement_item ->> 'movement_name', movement_item ->> 'movement_name_snapshot'),
        nullif(btrim(movement_item ->> 'side'), ''),
        nullif(movement_item ->> 'repetitions', '')::integer,
        nullif(movement_item ->> 'duration_seconds', '')::integer,
        nullif(btrim(movement_item ->> 'instructions'), ''),
        coalesce((movement_item ->> 'catalogued')::boolean, true),
        nullif(movement_item ->> 'segment_key', '')
      );
    end loop;

    insert into public.workout_plan_segment_expectations (
      plan_round_id, segment_key, segment_kind, difficulty, note,
      from_movement_key, to_movement_key
    )
    select created_round_id, rating.segment_key, rating.segment_kind, rating.difficulty,
           rating.note, rating.from_movement_key, rating.to_movement_key
      from private.ratings_rows(round_item -> 'ratings') rating;
  end loop;
end;
$$;

create or replace function private.insert_occurrence_rounds(target_occurrence_id uuid, round_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  round_item jsonb;
  round_position bigint;
  created_round_id uuid;
  movement_item jsonb;
  movement_position bigint;
begin
  if round_payload is null then
    round_payload := '[]'::jsonb;
  end if;
  if jsonb_typeof(round_payload) <> 'array' then
    raise exception using errcode = 'P0001', message = 'invalid_rounds';
  end if;

  for round_item, round_position in
    select value, ordinality from jsonb_array_elements(round_payload) with ordinality
  loop
    if jsonb_typeof(coalesce(round_item -> 'movements', '[]'::jsonb)) <> 'array' then
      raise exception using errcode = 'P0001', message = 'invalid_rounds';
    end if;
    insert into public.training_occurrence_rounds (
      occurrence_id, position, label, repetitions, duration_seconds,
      rest_seconds, instructions, source_text, sequence
    ) values (
      target_occurrence_id, round_position,
      nullif(btrim(round_item ->> 'label'), ''),
      nullif(round_item ->> 'repetitions', '')::integer,
      nullif(round_item ->> 'duration_seconds', '')::integer,
      nullif(round_item ->> 'rest_seconds', '')::integer,
      nullif(btrim(round_item ->> 'instructions'), ''),
      nullif(btrim(round_item ->> 'source_text'), ''),
      case when jsonb_typeof(round_item -> 'sequence') = 'array' then round_item -> 'sequence' end
    ) returning id into created_round_id;

    for movement_item, movement_position in
      select value, ordinality
        from jsonb_array_elements(coalesce(round_item -> 'movements', '[]'::jsonb))
             with ordinality
    loop
      insert into public.training_occurrence_movements (
        occurrence_round_id, position, movement_key, movement_name_snapshot,
        side, repetitions, duration_seconds, instructions, catalogued, segment_key
      ) values (
        created_round_id, movement_position,
        movement_item ->> 'movement_key',
        coalesce(movement_item ->> 'movement_name', movement_item ->> 'movement_name_snapshot'),
        nullif(btrim(movement_item ->> 'side'), ''),
        nullif(movement_item ->> 'repetitions', '')::integer,
        nullif(movement_item ->> 'duration_seconds', '')::integer,
        nullif(btrim(movement_item ->> 'instructions'), ''),
        coalesce((movement_item ->> 'catalogued')::boolean, true),
        nullif(movement_item ->> 'segment_key', '')
      );
    end loop;
  end loop;
end;
$$;

create function private.insert_round_assessments(
  target_participation_id uuid,
  target_occurrence_id uuid,
  round_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  round_item jsonb;
  round_position bigint;
begin
  if round_payload is null or jsonb_typeof(round_payload) <> 'array' then
    return;
  end if;
  for round_item, round_position in
    select value, ordinality from jsonb_array_elements(round_payload) with ordinality
  loop
    insert into public.training_segment_assessments (
      participation_id, occurrence_round_id, segment_key, segment_kind,
      difficulty, note, from_movement_key, to_movement_key
    )
    select target_participation_id, round.id, rating.segment_key, rating.segment_kind,
           rating.difficulty, rating.note, rating.from_movement_key, rating.to_movement_key
      from public.training_occurrence_rounds round
      cross join private.ratings_rows(round_item -> 'ratings') rating
     where round.occurrence_id = target_occurrence_id
       and round.position = round_position;
  end loop;
end;
$$;

create or replace function private.copy_plan_to_occurrence(
  target_version_id uuid,
  target_occurrence_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_round public.workout_plan_rounds;
  created_round_id uuid;
begin
  for source_round in
    select * from public.workout_plan_rounds
     where plan_version_id = target_version_id order by position
  loop
    insert into public.training_occurrence_rounds (
      occurrence_id, position, label, repetitions, duration_seconds,
      rest_seconds, instructions, source_text, sequence
    ) values (
      target_occurrence_id, source_round.position, source_round.label,
      source_round.repetitions, source_round.duration_seconds,
      source_round.rest_seconds, source_round.instructions,
      source_round.source_text, source_round.sequence
    ) returning id into created_round_id;

    insert into public.training_occurrence_movements (
      occurrence_round_id, position, movement_key, movement_name_snapshot,
      side, repetitions, duration_seconds, instructions, catalogued, segment_key
    )
    select created_round_id, movement.position, movement.movement_key,
           movement.movement_name_snapshot, movement.side, movement.repetitions,
           movement.duration_seconds, movement.instructions,
           movement.catalogued, movement.segment_key
      from public.workout_plan_movements movement
     where movement.plan_round_id = source_round.id
     order by movement.position;
  end loop;
end;
$$;

create function private.ratings_json(ratings_source text, target_round_id uuid, target_participation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'segment_key', rating.segment_key, 'segment_kind', rating.segment_kind::text,
    'difficulty', rating.difficulty::text, 'note', rating.note,
    'from_movement_key', rating.from_movement_key, 'to_movement_key', rating.to_movement_key
  ) order by rating.segment_key), '[]'::jsonb)
  from (
    select expectation.segment_key, expectation.segment_kind, expectation.difficulty,
           expectation.note, expectation.from_movement_key, expectation.to_movement_key
      from public.workout_plan_segment_expectations expectation
     where ratings_source = 'plan' and expectation.plan_round_id = target_round_id
    union all
    select assessment.segment_key, assessment.segment_kind, assessment.difficulty,
           assessment.note, assessment.from_movement_key, assessment.to_movement_key
      from public.training_segment_assessments assessment
     where ratings_source = 'occurrence'
       and assessment.occurrence_round_id = target_round_id
       and assessment.participation_id = target_participation_id
  ) rating;
$$;

create or replace function private.plan_rounds_json(target_version_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', round.id, 'position', round.position, 'label', round.label,
      'repetitions', round.repetitions, 'duration_seconds', round.duration_seconds,
      'rest_seconds', round.rest_seconds, 'instructions', round.instructions,
      'source_text', round.source_text, 'sequence', round.sequence,
      'ratings', private.ratings_json('plan', round.id, null),
      'movements', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', movement.id, 'position', movement.position,
          'movement_key', movement.movement_key,
          'movement_name', movement.movement_name_snapshot,
          'catalogued', movement.catalogued, 'segment_key', movement.segment_key,
          'side', movement.side, 'repetitions', movement.repetitions,
          'duration_seconds', movement.duration_seconds,
          'instructions', movement.instructions
        ) order by movement.position)
        from public.workout_plan_movements movement
        where movement.plan_round_id = round.id
      ), '[]'::jsonb)
    ) order by round.position
  ), '[]'::jsonb)
  from public.workout_plan_rounds round
  where round.plan_version_id = target_version_id;
$$;

create or replace function private.occurrence_rounds_json(
  actor_id uuid,
  target_occurrence_id uuid,
  target_participation_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', round.id, 'position', round.position, 'label', round.label,
    'repetitions', round.repetitions, 'duration_seconds', round.duration_seconds,
    'rest_seconds', round.rest_seconds, 'instructions', round.instructions,
    'source_text', round.source_text, 'sequence', round.sequence,
    'ratings', private.ratings_json('occurrence', round.id, target_participation_id),
    'planned', coalesce((
      select private.ratings_json('plan', plan_round.id, null)
        from public.training_occurrences occurrence
        join public.scheduled_trainings schedule on schedule.id = occurrence.schedule_id
        join public.workout_plan_rounds plan_round
          on plan_round.plan_version_id = schedule.plan_version_id
         and plan_round.position = round.position
       where occurrence.id = round.occurrence_id
    ), '[]'::jsonb),
    'movements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', movement.id, 'position', movement.position,
        'movement_key', movement.movement_key,
        'movement_name', movement.movement_name_snapshot,
        'catalogued', movement.catalogued, 'segment_key', movement.segment_key,
        'side', movement.side, 'repetitions', movement.repetitions,
        'duration_seconds', movement.duration_seconds,
        'instructions', movement.instructions,
        'assessment', case when assessment.id is null then null else jsonb_build_object(
          'difficulty', assessment.difficulty::text, 'note', assessment.note
        ) end
      ) order by movement.position)
      from public.training_occurrence_movements movement
      left join public.training_movement_assessments assessment
        on assessment.occurrence_movement_id = movement.id
       and assessment.participation_id = target_participation_id
      where movement.occurrence_round_id = round.id
    ), '[]'::jsonb)
  ) order by round.position), '[]'::jsonb)
  from public.training_occurrence_rounds round
  where round.occurrence_id = target_occurrence_id;
$$;

create or replace function private.record_alone_training(
  actor_id uuid,
  target_local_date date,
  target_timezone text,
  target_duration_minutes integer,
  target_personal_notes text,
  target_rounds jsonb,
  target_idempotency_key uuid,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare existing_occurrence public.training_occurrences;
declare created_occurrence public.training_occurrences;
declare created_participation public.training_participations;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  select * into existing_occurrence from public.training_occurrences occurrence
   where occurrence.idempotency_key = target_idempotency_key;
  if found then
    select * into created_participation from public.training_participations participation
     where participation.occurrence_id = existing_occurrence.id
       and participation.profile_id = actor_id;
    if found and existing_occurrence.kind = 'alone' then
      return jsonb_build_object(
        'status', 'completed', 'occurrence_id', existing_occurrence.id,
        'participation_id', created_participation.id,
        'participation_ids', jsonb_build_array(created_participation.id)
      );
    end if;
    raise exception using errcode = 'P0001', message = 'duplicate_completion';
  end if;

  insert into public.training_occurrences (
    kind, recorded_by, occurred_at, local_date, timezone,
    default_duration_minutes, idempotency_key
  ) values (
    'alone', actor_id, coalesce(target_occurred_at, now()), target_local_date,
    target_timezone, target_duration_minutes, target_idempotency_key
  ) returning * into created_occurrence;
  perform private.insert_occurrence_rounds(created_occurrence.id, target_rounds);
  insert into public.training_participations (
    occurrence_id, profile_id, actual_duration_minutes, personal_notes,
    confirmed_at, confirmed_by
  ) values (
    created_occurrence.id, actor_id, target_duration_minutes,
    nullif(btrim(coalesce(target_personal_notes, '')), ''),
    coalesce(target_occurred_at, now()), actor_id
  ) returning * into created_participation;
  perform private.insert_round_assessments(
    created_participation.id, created_occurrence.id, target_rounds
  );
  return jsonb_build_object(
    'status', 'completed', 'occurrence_id', created_occurrence.id,
    'participation_id', created_participation.id,
    'participation_ids', jsonb_build_array(created_participation.id)
  );
end;
$$;

create function private.save_round_assessments(
  actor_id uuid,
  target_participation_id uuid,
  target_round_id uuid,
  ratings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if actor_id is null or not exists (
    select 1
      from public.training_participations participation
      join public.training_occurrence_rounds round
        on round.occurrence_id = participation.occurrence_id
     where participation.id = target_participation_id
       and participation.profile_id = actor_id
       and round.id = target_round_id
  ) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  delete from public.training_segment_assessments
   where participation_id = target_participation_id
     and occurrence_round_id = target_round_id;
  insert into public.training_segment_assessments (
    participation_id, occurrence_round_id, segment_key, segment_kind,
    difficulty, note, from_movement_key, to_movement_key
  )
  select target_participation_id, target_round_id, rating.segment_key, rating.segment_kind,
         rating.difficulty, rating.note, rating.from_movement_key, rating.to_movement_key
    from private.ratings_rows(ratings) rating;
  return jsonb_build_object('status', 'saved', 'round_id', target_round_id);
end;
$$;

create function public.save_round_assessments(
  participation_id uuid,
  round_id uuid,
  ratings jsonb
)
returns jsonb
language sql
set search_path = ''
as $$
  select private.save_round_assessments(auth.uid(), participation_id, round_id, ratings);
$$;

revoke execute on function private.protect_published_plan_expectation() from public, anon, authenticated;
revoke execute on function private.ratings_rows(jsonb) from public, anon, authenticated;
revoke execute on function private.insert_round_assessments(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function private.ratings_json(text, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.save_round_assessments(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function private.save_round_assessments(uuid, uuid, uuid, jsonb) to authenticated;
revoke execute on function public.save_round_assessments(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_round_assessments(uuid, uuid, jsonb) to authenticated;
```

- [ ] **Step 4: Run all database tests**

Run: `npm run supabase:reset && npm run test:db`
Expected: PASS for `0010_training_text_rounds.test.sql` and every existing test file. The existing assertion in `0008_training_lifecycle.test.sql` that `' Armada '` normalizes to `armada` must still pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202610100001_training_text_rounds.sql supabase/tests/0010_training_text_rounds.test.sql
git commit -m "feat(db): store round text, sequences, and segment ratings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Training service — text rounds and round ratings

**Files:**
- Modify: `src/app/training-service.js`, `src/app/testing/fake-services.js` (`createE2ETrainingService`)
- Test: `tests/unit/training-service.test.js`

**Interfaces:**
- Consumes: payload and RPC from Task 4.
- Produces:
  - `requireRounds(rounds)` now accepts a round when it has non-empty `source_text` **or** at least one movement; error code stays `invalid_rounds`.
  - `trainingService.saveRoundAssessments({ participationId, roundId, ratings }) → Promise<{ status }>`; validates each rating's `difficulty` (`invalid_difficulty`) and that `segment_key` is a non-empty string (`invalid_segment`).
  - Fake service mirrors both: stores `source_text`, `sequence`, `ratings` on occurrence rounds; `getDay` returns `ratings` (by participation) and `planned` (from the schedule's plan round at the same index); `saveRoundAssessments` replaces `state.roundRatings[participationId][roundId]`; `recordAloneTraining` seeds `state.roundRatings` from each round's `ratings`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/training-service.test.js`:

```js
  it('accepts text-only rounds and rejects rounds with neither text nor movements', async () => {
    const { client, calls } = harness();
    const service = createTrainingService(client, { randomUUID: () => 'k' });
    const textRound = { source_text: 'and, e', sequence: [], movements: [], ratings: [] };
    await service.recordAloneTraining({
      localDate: '2026-10-01', timezone: 'UTC', durationMinutes: 20, rounds: [textRound],
    });
    expect(calls[0][1].rounds).toEqual([textRound]);
    await expect(service.recordAloneTraining({
      localDate: '2026-10-01', timezone: 'UTC', durationMinutes: 20,
      rounds: [{ source_text: '  ', movements: [] }],
    })).rejects.toMatchObject({ code: 'invalid_rounds' });
  });

  it('saves round ratings through one RPC', async () => {
    const { client, calls } = harness();
    const ratings = [{ segment_key: 'r', segment_kind: 'round', difficulty: 'hard' }];
    await createTrainingService(client).saveRoundAssessments({
      participationId: 'p-1', roundId: 'round-1', ratings,
    });
    expect(calls).toEqual([['save_round_assessments', {
      participation_id: 'p-1', round_id: 'round-1', ratings,
    }]]);
  });

  it.each([
    [[{ segment_key: 'r', segment_kind: 'round', difficulty: 'brutal' }], 'invalid_difficulty'],
    [[{ segment_key: '', segment_kind: 'round', difficulty: 'easy' }], 'invalid_segment'],
  ])('validates ratings before saving', async (ratings, code) => {
    const { client, calls } = harness();
    await expect(createTrainingService(client).saveRoundAssessments({
      participationId: 'p-1', roundId: 'round-1', ratings,
    })).rejects.toMatchObject({ kind: 'validation', code });
    expect(calls).toEqual([]);
  });

  it('keeps round ratings in the local fake service', async () => {
    const storage = new Map();
    const window = {
      localStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
    };
    const service = createE2ETrainingService({ window });
    const result = await service.recordAloneTraining({
      localDate: '2026-10-01', timezone: 'UTC', durationMinutes: 30, idempotencyKey: 'k1',
      rounds: [{
        source_text: 'armada, au', sequence: [], movements: [],
        ratings: [{ segment_key: 'r', segment_kind: 'round', difficulty: 'okay' }],
      }],
    });
    let [day] = await service.getDay({ localDate: '2026-10-01' });
    expect(day.rounds[0]).toMatchObject({
      source_text: 'armada, au',
      ratings: [{ segment_key: 'r', segment_kind: 'round', difficulty: 'okay' }],
      planned: [],
    });
    await service.saveRoundAssessments({
      participationId: result.participation_id, roundId: day.rounds[0].id,
      ratings: [{ segment_key: 't:1>2', segment_kind: 'transition', difficulty: 'hard' }],
    });
    [day] = await service.getDay({ localDate: '2026-10-01' });
    expect(day.rounds[0].ratings.map(({ segment_key: key }) => key)).toEqual(['t:1>2']);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/training-service.test.js`
Expected: FAIL — `saveRoundAssessments is not a function`; text-only round rejected.

- [ ] **Step 3: Implement in `src/app/training-service.js`**

Replace `requireRounds` and add the method:

```js
function roundHasContent(round) {
  const hasText = typeof round?.source_text === 'string' && round.source_text.trim() !== '';
  const hasMovements = Array.isArray(round?.movements) && round.movements.length > 0;
  return hasText || hasMovements;
}

function requireRounds(rounds) {
  if (!Array.isArray(rounds) || rounds.length === 0 || !rounds.every(roundHasContent)) {
    invalid('invalid_rounds', 'Add at least one round.');
  }
  return rounds;
}

function requireRatings(ratings) {
  if (!Array.isArray(ratings)) invalid('invalid_segment', 'Choose what to rate.');
  for (const rating of ratings) {
    if (typeof rating?.segment_key !== 'string' || !rating.segment_key.trim()) {
      invalid('invalid_segment', 'Choose what to rate.');
    }
    if (!DIFFICULTIES.has(rating.difficulty)) {
      invalid('invalid_difficulty', 'Choose Easy, Okay, or Hard.');
    }
  }
  return ratings;
}
```

Inside the returned object, after `saveAssessment`:

```js
    async saveRoundAssessments(input) {
      return call('save_round_assessments', {
        participation_id: input.participationId,
        round_id: input.roundId,
        ratings: requireRatings(input.ratings),
      });
    },
```

- [ ] **Step 4: Implement in the fake service**

In `createE2ETrainingService` `readState()` defaults add `roundRatings: {}`. In `recordAloneTraining`, after creating `participation`, before `writeState`:

```js
      occurrence.rounds = occurrence.rounds.map((round, index) => ({
        ...round, id: round.id ?? `${occurrence.id}-round-${index + 1}`,
      }));
      state.roundRatings[participation.id] = Object.fromEntries(
        occurrence.rounds.map((round, index) => [
          round.id, structuredClone(input.rounds[index]?.ratings ?? []),
        ]),
      );
```

Add the method:

```js
    async saveRoundAssessments(input) {
      const state = readState();
      guard(state, 'saveRoundAssessments');
      const participation = state.participations.find(({ id }) => id === input.participationId);
      if (!participation || participation.profile_id !== actorId()) {
        throw new AppError('authorization', 'not_authorized');
      }
      state.roundRatings[participation.id] ??= {};
      state.roundRatings[participation.id][input.roundId] = structuredClone(input.ratings);
      writeState(state);
      record({ type: 'save-round-assessments', roundId: input.roundId });
      return { status: 'saved', round_id: input.roundId };
    },
```

In `getDay`, inside the `rounds` mapping, after computing `id`, add `ratings` and `planned`:

```js
          // Use the field names the fake already stores on schedules and plans
          // (for example `plan_version_id` vs `planVersionId`); adjust both lookups to match.
          const schedule = state.schedules.find(({ id }) => id === occurrence.schedule_id);
          const plan = state.plans.find(({ version_id: versionId }) => versionId === schedule?.plan_version_id);
          const rounds = structuredClone(occurrence.rounds).map((round, roundIndex) => {
            const roundId = round.id ?? `${occurrence.id}-round-${roundIndex + 1}`;
            return {
              ...round,
              id: roundId,
              source_text: round.source_text ?? null,
              sequence: round.sequence ?? null,
              ratings: state.roundRatings[participation.id]?.[roundId] ?? [],
              planned: structuredClone(plan?.rounds?.[roundIndex]?.ratings ?? []),
              movements: (round.movements ?? []).map((movement, movementIndex) => {
                const movementId = movement.id
                  ?? `${occurrence.id}-movement-${roundIndex + 1}-${movementIndex + 1}`;
                const assessment = state.assessments.find((entry) => (
                  entry.participation_id === participation.id
                  && entry.movement_id === movementId
                ));
                return { ...movement, id: movementId, assessment: assessment ?? null };
              }),
            };
          });
```

If the fake occurrence objects do not already store `schedule_id`, add `schedule_id: input.scheduleId` where `completeGroupTraining` and `completePersonalClass` build the occurrence.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/training-service.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/training-service.js src/app/testing/fake-services.js tests/unit/training-service.test.js
git commit -m "feat: accept text rounds and save round ratings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Repertoire — table, RPCs, and service

**Files:**
- Create: `supabase/migrations/202610100002_practice_sequences.sql`, `supabase/tests/0011_practice_sequences.test.sql`, `src/app/repertoire-service.js`
- Modify: `src/app/testing/fake-services.js` (add `createE2ERepertoireService`)
- Test: `tests/unit/repertoire-service.test.js`

**Interfaces:**
- Produces (SQL): `public.list_practice_sequences() → table(id uuid, title text, source_text text, sequence jsonb, updated_at timestamptz)`; `public.save_practice_sequence(sequence_id uuid, title text, source_text text, sequence jsonb) → jsonb { status, sequence_id }` (null id = create); `public.delete_practice_sequence(sequence_id uuid) → jsonb { status }`; `public.import_practice_sequences(items jsonb) → jsonb { status, imported }` where items are `[{ import_ref, title, source_text, sequence }]`, at most 100 per call.
- Produces (JS): `createRepertoireService(client)` and `createE2ERepertoireService({ window })`, both with
  `list() → Promise<Array<{ id, title, source_text, sequence, updated_at }>>`,
  `save({ id = null, title, sourceText, sequence }) → Promise<{ status, sequence_id }>`,
  `remove(id) → Promise<{ status }>`,
  `importItems(items) → Promise<{ status, imported }>`.
  Validation codes: `invalid_sequence_text` (empty or > 4,000), `invalid_sequence_title` (> 120 after trim). An empty title becomes the first 60 characters of the text.

- [ ] **Step 1: Write the failing database test**

```sql
-- supabase/tests/0011_practice_sequences.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_table('public', 'practice_sequences', 'repertoire table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.practice_sequences'::regclass),
  'repertoire has RLS');

select tests.create_user('10000000-0000-0000-0000-000000001101', 'owner11@example.test', 'Ana Onze');
select tests.create_user('10000000-0000-0000-0000-000000001102', 'other11@example.test', 'Bia Onze');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001101');
select public.save_practice_sequence(null, 'Armada flow', 'armada, au', '[]'::jsonb) ->> 'sequence_id' as sequence_id \gset
select is((select count(*)::integer from public.list_practice_sequences()), 1, 'owner lists own sequence');
select is(
  public.save_practice_sequence(:'sequence_id', 'Renamed', 'armada, au, ginga', '[]'::jsonb) ->> 'status',
  'saved', 'owner updates own sequence'
);
select is(
  public.import_practice_sequences('[
    {"import_ref":"local:abc","title":"From browser","source_text":"ginga, negativa","sequence":[]},
    {"import_ref":"local:abc","title":"Duplicate","source_text":"ginga, negativa","sequence":[]},
    {"import_ref":"local:def","title":"Second","source_text":"au","sequence":[]}
  ]'::jsonb) ->> 'imported',
  '2', 'import skips duplicate references inside one batch'
);
select is(
  public.import_practice_sequences('[{"import_ref":"local:abc","title":"Again","source_text":"ginga","sequence":[]}]'::jsonb) ->> 'imported',
  '0', 're-import of the same reference inserts nothing'
);
select throws_ok(
  $$select public.save_practice_sequence(null, 'Empty', '   ', '[]'::jsonb)$$,
  'P0001', 'invalid_sequence_text', 'empty text is rejected'
);
select throws_ok(
  $$insert into public.practice_sequences (profile_id, title, source_text)
    values ('10000000-0000-0000-0000-000000001101', 't', 'x')$$,
  '42501', null, 'clients cannot insert directly'
);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001102');
select is((select count(*)::integer from public.list_practice_sequences()), 0, 'other users see none');
select is((select count(*)::integer from public.practice_sequences), 0, 'RLS hides other repertoires');
select throws_ok(
  format($$select public.save_practice_sequence(%L, 'Hijack', 'au', '[]'::jsonb)$$, :'sequence_id'),
  'PT403', 'not_authorized', 'other users cannot update'
);
select throws_ok(
  format($$select public.delete_practice_sequence(%L)$$, :'sequence_id'),
  'PT403', 'not_authorized', 'other users cannot delete'
);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001101');
select is(public.delete_practice_sequence(:'sequence_id') ->> 'status', 'deleted', 'owner deletes');

reset role;
select tests.set_actor(null, 'anon');
select throws_ok($$select * from public.list_practice_sequences()$$, '42501', null, 'anonymous callers are refused');

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx supabase test db supabase/tests/0011_practice_sequences.test.sql`
Expected: FAIL — table does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/202610100002_practice_sequences.sql
create table public.practice_sequences (
  id uuid primary key default extensions.gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  source_text text not null,
  sequence jsonb,
  import_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint practice_sequences_title_check check (char_length(btrim(title)) between 1 and 120),
  constraint practice_sequences_text_check check (char_length(btrim(source_text)) between 1 and 4000),
  constraint practice_sequences_sequence_check check (sequence is null or jsonb_typeof(sequence) = 'array'),
  constraint practice_sequences_import_ref_check check (import_ref is null or char_length(import_ref) <= 200)
);
create unique index practice_sequences_import_ref_unique
  on public.practice_sequences (profile_id, import_ref) where import_ref is not null;
create index practice_sequences_profile_idx on public.practice_sequences (profile_id, updated_at desc);

create trigger practice_sequences_set_updated_at
before update on public.practice_sequences
for each row execute function private.set_updated_at();

alter table public.practice_sequences enable row level security;
create policy practice_sequences_select_own
on public.practice_sequences for select to authenticated
using (profile_id = auth.uid());
revoke all on table public.practice_sequences from public, anon, authenticated;
grant select on table public.practice_sequences to authenticated;

create function private.practice_sequence_title(new_title text, new_source_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(btrim(coalesce(new_title, '')), ''), left(btrim(new_source_text), 60));
$$;

create function private.save_practice_sequence(
  actor_id uuid, target_sequence_id uuid, new_title text, new_source_text text, new_sequence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare saved_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if char_length(btrim(coalesce(new_source_text, ''))) not between 1 and 4000 then
    raise exception using errcode = 'P0001', message = 'invalid_sequence_text';
  end if;
  if target_sequence_id is null then
    insert into public.practice_sequences (profile_id, title, source_text, sequence)
    values (
      actor_id, private.practice_sequence_title(new_title, new_source_text),
      btrim(new_source_text),
      case when jsonb_typeof(new_sequence) = 'array' then new_sequence end
    ) returning id into saved_id;
  else
    update public.practice_sequences
       set title = private.practice_sequence_title(new_title, new_source_text),
           source_text = btrim(new_source_text),
           sequence = case when jsonb_typeof(new_sequence) = 'array' then new_sequence end
     where id = target_sequence_id and profile_id = actor_id
     returning id into saved_id;
    if saved_id is null then
      raise exception using errcode = 'PT403', message = 'not_authorized';
    end if;
  end if;
  return jsonb_build_object('status', 'saved', 'sequence_id', saved_id);
end;
$$;

create function private.delete_practice_sequence(actor_id uuid, target_sequence_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.practice_sequences
   where id = target_sequence_id and profile_id = actor_id;
  if not found then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  return jsonb_build_object('status', 'deleted', 'sequence_id', target_sequence_id);
end;
$$;

create function private.import_practice_sequences(actor_id uuid, items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare inserted integer;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 100 then
    raise exception using errcode = 'P0001', message = 'invalid_import';
  end if;
  with candidates as (
    select distinct on (item ->> 'import_ref')
           item ->> 'import_ref' import_ref,
           private.practice_sequence_title(item ->> 'title', item ->> 'source_text') title,
           btrim(item ->> 'source_text') source_text,
           case when jsonb_typeof(item -> 'sequence') = 'array' then item -> 'sequence' end sequence
      from jsonb_array_elements(items) with ordinality as entries(item, position)
     where nullif(btrim(coalesce(item ->> 'import_ref', '')), '') is not null
       and char_length(btrim(coalesce(item ->> 'source_text', ''))) between 1 and 4000
     order by item ->> 'import_ref', position
  ), created as (
    insert into public.practice_sequences (profile_id, title, source_text, sequence, import_ref)
    select actor_id, title, source_text, sequence, import_ref from candidates
    on conflict (profile_id, import_ref) where import_ref is not null do nothing
    returning 1
  )
  select count(*)::integer into inserted from created;
  return jsonb_build_object('status', 'imported', 'imported', inserted);
end;
$$;

create function private.list_practice_sequences(actor_id uuid)
returns table (id uuid, title text, source_text text, sequence jsonb, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  return query
  select item.id, item.title, item.source_text, item.sequence, item.updated_at
    from public.practice_sequences item
   where item.profile_id = actor_id
   order by item.updated_at desc, item.id;
end;
$$;

create function public.save_practice_sequence(
  sequence_id uuid, title text, source_text text, sequence jsonb default null
)
returns jsonb language sql set search_path = ''
as $$ select private.save_practice_sequence(auth.uid(), sequence_id, title, source_text, sequence); $$;

create function public.delete_practice_sequence(sequence_id uuid)
returns jsonb language sql set search_path = ''
as $$ select private.delete_practice_sequence(auth.uid(), sequence_id); $$;

create function public.import_practice_sequences(items jsonb)
returns jsonb language sql set search_path = ''
as $$ select private.import_practice_sequences(auth.uid(), items); $$;

create function public.list_practice_sequences()
returns table (id uuid, title text, source_text text, sequence jsonb, updated_at timestamptz)
language sql stable set search_path = ''
as $$ select * from private.list_practice_sequences(auth.uid()); $$;

revoke execute on function private.practice_sequence_title(text, text) from public, anon, authenticated;
revoke execute on function private.save_practice_sequence(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function private.delete_practice_sequence(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.import_practice_sequences(uuid, jsonb) from public, anon, authenticated;
revoke execute on function private.list_practice_sequences(uuid) from public, anon, authenticated;
grant execute on function private.save_practice_sequence(uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function private.delete_practice_sequence(uuid, uuid) to authenticated;
grant execute on function private.import_practice_sequences(uuid, jsonb) to authenticated;
grant execute on function private.list_practice_sequences(uuid) to authenticated;
revoke execute on function public.save_practice_sequence(uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.delete_practice_sequence(uuid) from public, anon, authenticated;
revoke execute on function public.import_practice_sequences(jsonb) from public, anon, authenticated;
revoke execute on function public.list_practice_sequences() from public, anon, authenticated;
grant execute on function public.save_practice_sequence(uuid, text, text, jsonb) to authenticated;
grant execute on function public.delete_practice_sequence(uuid) to authenticated;
grant execute on function public.import_practice_sequences(jsonb) to authenticated;
grant execute on function public.list_practice_sequences() to authenticated;
```

- [ ] **Step 4: Run database tests**

Run: `npm run supabase:reset && npm run test:db`
Expected: PASS.

- [ ] **Step 5: Write the failing service test**

```js
// tests/unit/repertoire-service.test.js
import { describe, expect, it } from 'vitest';

import { createRepertoireService } from '../../src/app/repertoire-service.js';
import { createE2ERepertoireService } from '../../src/app/testing/fake-services.js';

function harness() {
  const calls = [];
  return {
    calls,
    client: { rpc: async (name, params = {}) => { calls.push([name, params]); return { data: [], error: null }; } },
  };
}

function memoryWindow() {
  const values = new Map([['roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1' } })]]);
  return { localStorage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) } };
}

describe('repertoire service', () => {
  it('uses stable RPC contracts and derives a default title', async () => {
    const { client, calls } = harness();
    const service = createRepertoireService(client);
    await service.list();
    await service.save({ title: '  ', sourceText: '  armada, au  ', sequence: [] });
    await service.save({ id: 's-1', title: 'Flow', sourceText: 'au', sequence: [] });
    await service.remove('s-1');
    await service.importItems([{ import_ref: 'local:1', title: 'A', source_text: 'au', sequence: [] }]);
    expect(calls).toEqual([
      ['list_practice_sequences', {}],
      ['save_practice_sequence', { sequence_id: null, title: 'armada, au', source_text: 'armada, au', sequence: [] }],
      ['save_practice_sequence', { sequence_id: 's-1', title: 'Flow', source_text: 'au', sequence: [] }],
      ['delete_practice_sequence', { sequence_id: 's-1' }],
      ['import_practice_sequences', { items: [{ import_ref: 'local:1', title: 'A', source_text: 'au', sequence: [] }] }],
    ]);
  });

  it.each([
    [{ sourceText: '   ' }, 'invalid_sequence_text'],
    [{ sourceText: 'x'.repeat(4001) }, 'invalid_sequence_text'],
    [{ sourceText: 'au', title: 't'.repeat(121) }, 'invalid_sequence_title'],
  ])('validates %o', async (input, code) => {
    const { client, calls } = harness();
    await expect(createRepertoireService(client).save(input)).rejects.toMatchObject({ code });
    expect(calls).toEqual([]);
  });

  it('stores, imports once, and deletes in the local fake', async () => {
    const service = createE2ERepertoireService({ window: memoryWindow() });
    await service.save({ sourceText: 'armada, au', sequence: [] });
    expect((await service.importItems([
      { import_ref: 'local:1', title: 'A', source_text: 'ginga', sequence: [] },
      { import_ref: 'local:1', title: 'A', source_text: 'ginga', sequence: [] },
    ])).imported).toBe(1);
    expect((await service.importItems([
      { import_ref: 'local:1', title: 'A', source_text: 'ginga', sequence: [] },
    ])).imported).toBe(0);
    const items = await service.list();
    expect(items.map(({ source_text: text }) => text).sort()).toEqual(['armada, au', 'ginga']);
    await service.remove(items[0].id);
    expect(await service.list()).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Implement the service**

```js
// src/app/repertoire-service.js
import { AppError, toAppError } from './errors.js';

function invalid(code, message) {
  throw new AppError('validation', code, message);
}

export function normalizeSequenceInput({ title = '', sourceText = '' }) {
  const text = String(sourceText ?? '').trim();
  if (!text || text.length > 4000) invalid('invalid_sequence_text', 'Write the sequence first.');
  const cleanTitle = String(title ?? '').trim() || text.slice(0, 60);
  if (cleanTitle.length > 120) invalid('invalid_sequence_title', 'Use a title of 120 characters or fewer.');
  return { title: cleanTitle, text };
}

export function createRepertoireService(client) {
  async function call(name, params = {}) {
    const result = await client.rpc(name, params);
    if (result.error) throw toAppError(result.error);
    return result.data;
  }
  return {
    async list() {
      return call('list_practice_sequences');
    },
    async save({ id = null, title, sourceText, sequence = null }) {
      const normalized = normalizeSequenceInput({ title, sourceText });
      return call('save_practice_sequence', {
        sequence_id: id, title: normalized.title, source_text: normalized.text, sequence,
      });
    },
    async remove(id) {
      return call('delete_practice_sequence', { sequence_id: id });
    },
    async importItems(items) {
      return call('import_practice_sequences', { items });
    },
  };
}
```

Add to `src/app/testing/fake-services.js`:

```js
export function createE2ERepertoireService({ window }) {
  const { localStorage: storage } = window;
  const key = 'roda.e2e.repertoireState';
  const read = () => ({ items: [], counter: 0, ...JSON.parse(storage.getItem(key) ?? '{}') });
  const write = (state) => storage.setItem(key, JSON.stringify(state));
  const owner = () => readSession(storage)?.user?.id ?? 'practitioner-1';
  return {
    async list() {
      return read().items.filter(({ profile_id: id }) => id === owner())
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map(({ profile_id: _owner, import_ref: _ref, ...item }) => item);
    },
    async save({ id = null, title, sourceText, sequence = null }) {
      const normalized = normalizeSequenceInput({ title, sourceText });
      const state = read();
      let item = id ? state.items.find((entry) => entry.id === id && entry.profile_id === owner()) : null;
      if (id && !item) throw new AppError('authorization', 'not_authorized');
      state.counter += 1;
      const now = new Date(Date.UTC(2026, 9, 10, 12, 0, state.counter)).toISOString();
      if (!item) {
        item = { id: `sequence-${state.counter}`, profile_id: owner(), import_ref: null };
        state.items.push(item);
      }
      Object.assign(item, { title: normalized.title, source_text: normalized.text, sequence, updated_at: now });
      write(state);
      return { status: 'saved', sequence_id: item.id };
    },
    async remove(id) {
      const state = read();
      const before = state.items.length;
      state.items = state.items.filter((entry) => !(entry.id === id && entry.profile_id === owner()));
      if (state.items.length === before) throw new AppError('authorization', 'not_authorized');
      write(state);
      return { status: 'deleted', sequence_id: id };
    },
    async importItems(items) {
      const state = read();
      let imported = 0;
      for (const entry of items) {
        if (state.items.some((item) => item.profile_id === owner() && item.import_ref === entry.import_ref)) continue;
        state.counter += 1;
        state.items.push({
          id: `sequence-${state.counter}`, profile_id: owner(), import_ref: entry.import_ref,
          title: entry.title || entry.source_text.slice(0, 60), source_text: entry.source_text,
          sequence: entry.sequence ?? null,
          updated_at: new Date(Date.UTC(2026, 9, 10, 12, 0, state.counter)).toISOString(),
        });
        imported += 1;
      }
      write(state);
      return { status: 'imported', imported };
    },
  };
}
```

Add `import { normalizeSequenceInput } from '../repertoire-service.js';` at the top of `fake-services.js`. The fake bumps `counter` on every save so the newest sequence always sorts first.

- [ ] **Step 7: Run tests**

Run: `npx vitest run tests/unit/repertoire-service.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/202610100002_practice_sequences.sql supabase/tests/0011_practice_sequences.test.sql src/app/repertoire-service.js src/app/testing/fake-services.js tests/unit/repertoire-service.test.js
git commit -m "feat: store practice sequences in the account

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Catalog curation — curator role, term mappings, relinking

**Files:**
- Create: `supabase/migrations/202610100003_catalog_curation.sql`, `supabase/tests/0012_catalog_curation.test.sql`, `src/app/catalog-service.js`
- Modify: `src/app/testing/fake-services.js` (add `createE2ECatalogService`)
- Test: `tests/unit/catalog-service.test.js`

**Interfaces:**
- Produces (SQL):
  - `public.catalog_term_mappings` readable by `anon` and `authenticated`: `term, action, target_slug, target_term, needs_video, updated_at`.
  - `public.am_i_catalog_curator() → boolean`.
  - `public.list_uncatalogued_terms() → table(term text, spelling text, people bigint, uses bigint, first_seen timestamptz, last_seen timestamptz, needs_video boolean)` (curators only).
  - `public.map_catalog_term(term text, target_slug text) → jsonb { status, relinked }`.
  - `public.merge_catalog_term(term text, target_term text) → jsonb { status, relinked }`.
  - `public.ignore_catalog_term(term text) → jsonb { status }`.
  - `public.set_catalog_term_needs_video(term text, needs_video boolean) → jsonb { status }`.
  - Terms and slugs must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`; otherwise `invalid_term`.
- Produces (JS): `createCatalogService(client)` / `createE2ECatalogService({ window })` with `listTermMappings()`, `amICurator()`, `listUncataloguedTerms()`, `mapTerm(term, targetSlug)`, `mergeTerm(term, targetTerm)`, `ignoreTerm(term)`, `setNeedsVideo(term, needsVideo)`. The fake reads curator status from localStorage `roda.e2e.catalogCurator === 'true'` and derives terms from `roda.e2e.trainingState` occurrence rounds whose movements have `catalogued === false`.

- [ ] **Step 1: Write the failing database test**

```sql
-- supabase/tests/0012_catalog_curation.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select ok((select relrowsecurity from pg_class where oid = 'public.catalog_curators'::regclass), 'curators have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.catalog_term_mappings'::regclass), 'mappings have RLS');

select tests.create_user('10000000-0000-0000-0000-000000001201', 'curator12@example.test', 'Cura Doze');
select tests.create_user('10000000-0000-0000-0000-000000001202', 'ana12@example.test', 'Ana Doze');
select tests.create_user('10000000-0000-0000-0000-000000001203', 'bia12@example.test', 'Bia Doze');
insert into public.catalog_curators (profile_id) values ('10000000-0000-0000-0000-000000001201');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001202');
select public.record_alone_training('2026-10-02', 'UTC', 30, 'private note',
  '[{"source_text":"galopanti, armada","movements":[
     {"movement_key":"galopanti","movement_name":"Galopanti","catalogued":false,"segment_key":"m:1"},
     {"movement_key":"armada","movement_name":"Armada","segment_key":"m:2"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000001201', '2026-10-02T10:00:00Z');
reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001203');
select public.record_alone_training('2026-10-03', 'UTC', 30, null,
  '[{"source_text":"galopanti","movements":[
     {"movement_key":"galopanti","movement_name":"galopanti","catalogued":false,"segment_key":"m:1"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000001202', '2026-10-03T10:00:00Z');

select is(public.am_i_catalog_curator(), false, 'ordinary users are not curators');
select throws_ok($$select * from public.list_uncatalogued_terms()$$, 'PT403', 'not_authorized',
  'non-curators cannot list terms');
select throws_ok($$select public.map_catalog_term('galopanti', 'galopante')$$, 'PT403', 'not_authorized',
  'non-curators cannot map');
select throws_ok($$insert into public.catalog_term_mappings (term, action) values ('x', 'ignore')$$,
  '42501', null, 'clients cannot write mappings directly');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001201');
select is(public.am_i_catalog_curator(), true, 'the curator is recognized');
select results_eq(
  $$select term, people, uses from public.list_uncatalogued_terms()$$,
  $$values ('galopanti'::text, 2::bigint, 2::bigint)$$,
  'terms are aggregated across people without names or notes'
);
select throws_ok($$select public.map_catalog_term('Galopanti!', 'galopante')$$, 'P0001', 'invalid_term',
  'terms must be slugs');
select is(public.map_catalog_term('galopanti', 'galopante') ->> 'relinked', '2',
  'mapping re-links completed history');
reset role;
select set_eq(
  $$select movement_key, catalogued, movement_name_snapshot from public.training_occurrence_movements
     where segment_key = 'm:1'$$,
  $$values ('galopante'::text, true, 'Galopanti'::text), ('galopante'::text, true, 'galopanti'::text)$$,
  'relinked rows keep their written names'
);
select throws_ok(
  $$update public.training_occurrence_movements set movement_key = 'armada' where segment_key = 'm:1'$$,
  'P0001', 'completed_training_immutable', 'ordinary updates of completed rows still fail'
);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001201');
select is((select count(*)::integer from public.list_uncatalogued_terms()), 0, 'mapped terms leave the list');
select is(public.ignore_catalog_term('stretching') ->> 'status', 'saved', 'curator ignores a term');
select is(public.set_catalog_term_needs_video('galopante', true) ->> 'status', 'saved', 'curator tags a term');

reset role;
select tests.set_actor(null, 'anon');
select is(
  (select count(*)::integer from public.catalog_term_mappings),
  3, 'anonymous visitors can read mappings for the parser'
);

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx supabase test db supabase/tests/0012_catalog_curation.test.sql`
Expected: FAIL — relation `catalog_curators` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/202610100003_catalog_curation.sql
create table public.catalog_curators (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default now()
);

create table public.catalog_term_mappings (
  term text primary key,
  action text,
  target_slug text,
  target_term text,
  needs_video boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint catalog_term_mappings_term_check check (term ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint catalog_term_mappings_action_check check (
    (action is null and target_slug is null and target_term is null)
    or (action = 'alias' and target_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and target_term is null)
    or (action = 'merge' and target_term ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and target_slug is null)
    or (action = 'ignore' and target_slug is null and target_term is null)
  )
);

alter table public.catalog_curators enable row level security;
alter table public.catalog_term_mappings enable row level security;
create policy catalog_curators_select_self on public.catalog_curators
for select to authenticated using (profile_id = auth.uid());
create policy catalog_term_mappings_select_all on public.catalog_term_mappings
for select to anon, authenticated using (true);
revoke all on table public.catalog_curators, public.catalog_term_mappings from public, anon, authenticated;
grant select on table public.catalog_curators to authenticated;
grant select on table public.catalog_term_mappings to anon, authenticated;

create function private.is_catalog_curator(actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select actor_id is not null
     and exists (select 1 from public.catalog_curators curator where curator.profile_id = actor_id);
$$;

create function private.require_catalog_curator(actor_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_catalog_curator(actor_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
end;
$$;

create function private.require_term(value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if value is null or value !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception using errcode = 'P0001', message = 'invalid_term';
  end if;
  return value;
end;
$$;

-- Allow the curator relink function, and only it, to change movement keys of immutable rows.
create or replace function private.protect_published_plan_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_round_id uuid;
begin
  if tg_op = 'UPDATE'
     and current_setting('roda.catalog_relink', true) = 'on'
     and (old.id, old.plan_round_id, old.position, old.movement_name_snapshot, old.side,
          old.repetitions, old.duration_seconds, old.instructions, old.segment_key)
         is not distinct from
         (new.id, new.plan_round_id, new.position, new.movement_name_snapshot, new.side,
          new.repetitions, new.duration_seconds, new.instructions, new.segment_key) then
    return new;
  end if;
  target_round_id := case when tg_op = 'DELETE' then old.plan_round_id else new.plan_round_id end;
  if exists (
    select 1
      from public.workout_plan_rounds round
      join public.workout_plan_versions version on version.id = round.plan_version_id
     where round.id = target_round_id and version.published_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'published_plan_immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function private.protect_completed_occurrence_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_round_id uuid;
declare target_occurrence_id uuid;
begin
  if tg_op = 'UPDATE'
     and current_setting('roda.catalog_relink', true) = 'on'
     and (old.id, old.occurrence_round_id, old.position, old.movement_name_snapshot, old.side,
          old.repetitions, old.duration_seconds, old.instructions, old.segment_key)
         is not distinct from
         (new.id, new.occurrence_round_id, new.position, new.movement_name_snapshot, new.side,
          new.repetitions, new.duration_seconds, new.instructions, new.segment_key) then
    return new;
  end if;
  target_round_id := case when tg_op = 'DELETE' then old.occurrence_round_id else new.occurrence_round_id end;
  select round.occurrence_id into target_occurrence_id
    from public.training_occurrence_rounds round where round.id = target_round_id;
  if private.occurrence_is_completed(target_occurrence_id) then
    raise exception using errcode = 'P0001', message = 'completed_training_immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function private.relink_uncatalogued(source_term text, target_key text, mark_catalogued boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare occurrence_count integer;
declare plan_count integer;
begin
  perform set_config('roda.catalog_relink', 'on', true);
  update public.training_occurrence_movements
     set movement_key = target_key, catalogued = mark_catalogued
   where movement_key = source_term and not catalogued;
  get diagnostics occurrence_count = row_count;
  update public.workout_plan_movements
     set movement_key = target_key, catalogued = mark_catalogued
   where movement_key = source_term and not catalogued;
  get diagnostics plan_count = row_count;
  perform set_config('roda.catalog_relink', 'off', true);
  return occurrence_count + plan_count;
end;
$$;

create function private.upsert_term_mapping(
  actor_id uuid, source_term text, new_action text, new_target_slug text, new_target_term text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.catalog_term_mappings (term, action, target_slug, target_term, updated_by, updated_at)
  values (source_term, new_action, new_target_slug, new_target_term, actor_id, now())
  on conflict (term) do update
     set action = excluded.action, target_slug = excluded.target_slug,
         target_term = excluded.target_term, updated_by = excluded.updated_by,
         updated_at = excluded.updated_at;
$$;

create function private.map_catalog_term(actor_id uuid, source_term text, new_target_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare relinked integer;
begin
  perform private.require_catalog_curator(actor_id);
  perform private.require_term(source_term);
  perform private.require_term(new_target_slug);
  perform private.upsert_term_mapping(actor_id, source_term, 'alias', new_target_slug, null);
  relinked := private.relink_uncatalogued(source_term, new_target_slug, true);
  return jsonb_build_object('status', 'saved', 'relinked', relinked);
end;
$$;

create function private.merge_catalog_term(actor_id uuid, source_term text, new_target_term text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare relinked integer;
begin
  perform private.require_catalog_curator(actor_id);
  perform private.require_term(source_term);
  perform private.require_term(new_target_term);
  if source_term = new_target_term then
    raise exception using errcode = 'P0001', message = 'invalid_term';
  end if;
  perform private.upsert_term_mapping(actor_id, source_term, 'merge', null, new_target_term);
  relinked := private.relink_uncatalogued(source_term, new_target_term, false);
  return jsonb_build_object('status', 'saved', 'relinked', relinked);
end;
$$;

create function private.ignore_catalog_term(actor_id uuid, source_term text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_catalog_curator(actor_id);
  perform private.require_term(source_term);
  perform private.upsert_term_mapping(actor_id, source_term, 'ignore', null, null);
  return jsonb_build_object('status', 'saved');
end;
$$;

create function private.set_catalog_term_needs_video(actor_id uuid, source_term text, flag boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_catalog_curator(actor_id);
  perform private.require_term(source_term);
  insert into public.catalog_term_mappings (term, needs_video, updated_by, updated_at)
  values (source_term, coalesce(flag, false), actor_id, now())
  on conflict (term) do update
     set needs_video = excluded.needs_video, updated_by = excluded.updated_by,
         updated_at = excluded.updated_at;
  return jsonb_build_object('status', 'saved');
end;
$$;

create function private.list_uncatalogued_terms(actor_id uuid)
returns table (
  term text, spelling text, people bigint, uses bigint,
  first_seen timestamptz, last_seen timestamptz, needs_video boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_catalog_curator(actor_id);
  return query
  with uses as (
    select movement.movement_key term, movement.movement_name_snapshot spelling,
           participation.profile_id person, movement.created_at seen
      from public.training_occurrence_movements movement
      join public.training_occurrence_rounds round on round.id = movement.occurrence_round_id
      join public.training_participations participation
        on participation.occurrence_id = round.occurrence_id
     where not movement.catalogued
    union all
    select movement.movement_key, movement.movement_name_snapshot,
           plan.creator_profile_id, movement.created_at
      from public.workout_plan_movements movement
      join public.workout_plan_rounds round on round.id = movement.plan_round_id
      join public.workout_plan_versions version on version.id = round.plan_version_id
      join public.workout_plans plan on plan.id = version.plan_id
     where not movement.catalogued
  )
  select uses.term,
         mode() within group (order by uses.spelling),
         count(distinct uses.person)::bigint,
         count(*)::bigint,
         min(uses.seen), max(uses.seen),
         coalesce(bool_or(mapping.needs_video), false)
    from uses
    left join public.catalog_term_mappings mapping on mapping.term = uses.term
   where mapping.action is null
   group by uses.term
   order by count(distinct uses.person) desc, count(*) desc, uses.term;
end;
$$;

create function public.am_i_catalog_curator()
returns boolean language sql stable set search_path = ''
as $$ select private.is_catalog_curator(auth.uid()); $$;
create function public.list_uncatalogued_terms()
returns table (
  term text, spelling text, people bigint, uses bigint,
  first_seen timestamptz, last_seen timestamptz, needs_video boolean
)
language sql stable set search_path = ''
as $$ select * from private.list_uncatalogued_terms(auth.uid()); $$;
create function public.map_catalog_term(term text, target_slug text)
returns jsonb language sql set search_path = ''
as $$ select private.map_catalog_term(auth.uid(), term, target_slug); $$;
create function public.merge_catalog_term(term text, target_term text)
returns jsonb language sql set search_path = ''
as $$ select private.merge_catalog_term(auth.uid(), term, target_term); $$;
create function public.ignore_catalog_term(term text)
returns jsonb language sql set search_path = ''
as $$ select private.ignore_catalog_term(auth.uid(), term); $$;
create function public.set_catalog_term_needs_video(term text, needs_video boolean)
returns jsonb language sql set search_path = ''
as $$ select private.set_catalog_term_needs_video(auth.uid(), term, needs_video); $$;

revoke execute on function private.is_catalog_curator(uuid) from public, anon, authenticated;
revoke execute on function private.require_catalog_curator(uuid) from public, anon, authenticated;
revoke execute on function private.require_term(text) from public, anon, authenticated;
revoke execute on function private.relink_uncatalogued(text, text, boolean) from public, anon, authenticated;
revoke execute on function private.upsert_term_mapping(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function private.map_catalog_term(uuid, text, text) from public, anon, authenticated;
revoke execute on function private.merge_catalog_term(uuid, text, text) from public, anon, authenticated;
revoke execute on function private.ignore_catalog_term(uuid, text) from public, anon, authenticated;
revoke execute on function private.set_catalog_term_needs_video(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function private.list_uncatalogued_terms(uuid) from public, anon, authenticated;
grant execute on function private.is_catalog_curator(uuid) to authenticated;
grant execute on function private.map_catalog_term(uuid, text, text) to authenticated;
grant execute on function private.merge_catalog_term(uuid, text, text) to authenticated;
grant execute on function private.ignore_catalog_term(uuid, text) to authenticated;
grant execute on function private.set_catalog_term_needs_video(uuid, text, boolean) to authenticated;
grant execute on function private.list_uncatalogued_terms(uuid) to authenticated;
revoke execute on function public.am_i_catalog_curator() from public, anon, authenticated;
revoke execute on function public.list_uncatalogued_terms() from public, anon, authenticated;
revoke execute on function public.map_catalog_term(text, text) from public, anon, authenticated;
revoke execute on function public.merge_catalog_term(text, text) from public, anon, authenticated;
revoke execute on function public.ignore_catalog_term(text) from public, anon, authenticated;
revoke execute on function public.set_catalog_term_needs_video(text, boolean) from public, anon, authenticated;
grant execute on function public.am_i_catalog_curator() to authenticated;
grant execute on function public.list_uncatalogued_terms() to authenticated;
grant execute on function public.map_catalog_term(text, text) to authenticated;
grant execute on function public.merge_catalog_term(text, text) to authenticated;
grant execute on function public.ignore_catalog_term(text) to authenticated;
grant execute on function public.set_catalog_term_needs_video(text, boolean) to authenticated;
```

Grant the project owner the curator role in a separate step after deployment, not in this migration, by running in the Supabase SQL editor: `insert into public.catalog_curators (profile_id) select id from auth.users where email = '<owner email>';`. Record this step in `docs/auth-and-database-operations.md` under a new "Catalog curators" heading in Task 20.

- [ ] **Step 4: Run database tests**

Run: `npm run supabase:reset && npm run test:db`
Expected: PASS.

- [ ] **Step 5: Write the failing service test**

```js
// tests/unit/catalog-service.test.js
import { describe, expect, it } from 'vitest';

import { createCatalogService } from '../../src/app/catalog-service.js';
import { createE2ECatalogService } from '../../src/app/testing/fake-services.js';

function harness() {
  const calls = [];
  const query = {
    select: (columns) => { calls.push(['select', columns]); return Promise.resolve({ data: [{ term: 'x' }], error: null }); },
  };
  return {
    calls,
    client: {
      from: (table) => { calls.push(['from', table]); return query; },
      rpc: async (name, params = {}) => { calls.push([name, params]); return { data: { status: 'saved' }, error: null }; },
    },
  };
}

function memoryWindow(entries = {}) {
  const values = new Map(Object.entries(entries));
  return { localStorage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) } };
}

describe('catalog service', () => {
  it('reads mappings from the table and curates through RPCs', async () => {
    const { client, calls } = harness();
    const service = createCatalogService(client);
    expect(await service.listTermMappings()).toEqual([{ term: 'x' }]);
    await service.amICurator();
    await service.listUncataloguedTerms();
    await service.mapTerm('galopanti', 'galopante');
    await service.mergeTerm('galopanti', 'galopante-x');
    await service.ignoreTerm('stretching');
    await service.setNeedsVideo('godeme', true);
    expect(calls).toEqual([
      ['from', 'catalog_term_mappings'],
      ['select', 'term, action, target_slug, target_term, needs_video'],
      ['am_i_catalog_curator', {}],
      ['list_uncatalogued_terms', {}],
      ['map_catalog_term', { term: 'galopanti', target_slug: 'galopante' }],
      ['merge_catalog_term', { term: 'galopanti', target_term: 'galopante-x' }],
      ['ignore_catalog_term', { term: 'stretching' }],
      ['set_catalog_term_needs_video', { term: 'godeme', needs_video: true }],
    ]);
  });

  it('rejects non-slug terms before calling Supabase', async () => {
    const { client, calls } = harness();
    await expect(createCatalogService(client).mapTerm('Galopanti!', 'galopante'))
      .rejects.toMatchObject({ code: 'invalid_term' });
    expect(calls).toEqual([]);
  });

  it('derives terms and applies mappings in the local fake', async () => {
    const trainingState = {
      occurrences: [{ id: 'o1', rounds: [{ movements: [
        { movement_key: 'galopanti', movement_name: 'Galopanti', catalogued: false },
        { movement_key: 'armada', movement_name: 'Armada', catalogued: true },
      ] }] }],
      participations: [{ id: 'p1', occurrence_id: 'o1', profile_id: 'practitioner-1' }],
    };
    const window = memoryWindow({
      'roda.e2e.catalogCurator': 'true',
      'roda.e2e.trainingState': JSON.stringify(trainingState),
    });
    const service = createE2ECatalogService({ window });
    expect(await service.amICurator()).toBe(true);
    expect(await service.listUncataloguedTerms()).toMatchObject([
      { term: 'galopanti', spelling: 'Galopanti', people: 1, uses: 1, needs_video: false },
    ]);
    await service.mapTerm('galopanti', 'galopante');
    expect(await service.listUncataloguedTerms()).toEqual([]);
    expect(await service.listTermMappings()).toMatchObject([
      { term: 'galopanti', action: 'alias', target_slug: 'galopante' },
    ]);
  });
});
```

- [ ] **Step 6: Implement**

```js
// src/app/catalog-service.js
import { AppError, toAppError } from './errors.js';

const TERM = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function requireTerm(value) {
  if (!TERM.test(value ?? '')) throw new AppError('validation', 'invalid_term', 'Choose a valid term.');
  return value;
}

export function createCatalogService(client) {
  async function call(name, params = {}) {
    const result = await client.rpc(name, params);
    if (result.error) throw toAppError(result.error);
    return result.data;
  }
  return {
    async listTermMappings() {
      const result = await client.from('catalog_term_mappings')
        .select('term, action, target_slug, target_term, needs_video');
      if (result.error) throw toAppError(result.error);
      return result.data;
    },
    async amICurator() {
      return Boolean(await call('am_i_catalog_curator'));
    },
    async listUncataloguedTerms() {
      return call('list_uncatalogued_terms');
    },
    async mapTerm(term, targetSlug) {
      return call('map_catalog_term', { term: requireTerm(term), target_slug: requireTerm(targetSlug) });
    },
    async mergeTerm(term, targetTerm) {
      return call('merge_catalog_term', { term: requireTerm(term), target_term: requireTerm(targetTerm) });
    },
    async ignoreTerm(term) {
      return call('ignore_catalog_term', { term: requireTerm(term) });
    },
    async setNeedsVideo(term, needsVideo) {
      return call('set_catalog_term_needs_video', { term: requireTerm(term), needs_video: Boolean(needsVideo) });
    },
  };
}
```

Add to `src/app/testing/fake-services.js` (import `requireTerm` from `../catalog-service.js` at the top):

```js
export function createE2ECatalogService({ window }) {
  const { localStorage: storage } = window;
  const key = 'roda.e2e.catalogState';
  const read = () => ({ mappings: [], ...JSON.parse(storage.getItem(key) ?? '{}') });
  const write = (state) => storage.setItem(key, JSON.stringify(state));
  const curator = () => storage.getItem('roda.e2e.catalogCurator') === 'true';
  const requireCurator = () => {
    if (!curator()) throw new AppError('authorization', 'not_authorized');
  };
  const training = () => JSON.parse(storage.getItem('roda.e2e.trainingState') ?? '{}');
  const writeTraining = (state) => storage.setItem('roda.e2e.trainingState', JSON.stringify(state));
  const upsert = (term, values) => {
    const state = read();
    const existing = state.mappings.find((mapping) => mapping.term === term);
    if (existing) Object.assign(existing, values);
    else state.mappings.push({ term, action: null, target_slug: null, target_term: null, needs_video: false, ...values });
    write(state);
  };
  const relink = (term, targetKey, catalogued) => {
    const state = training();
    let relinked = 0;
    for (const occurrence of state.occurrences ?? []) {
      for (const round of occurrence.rounds ?? []) {
        for (const movement of round.movements ?? []) {
          if (movement.movement_key === term && movement.catalogued === false) {
            movement.movement_key = targetKey;
            movement.catalogued = catalogued;
            relinked += 1;
          }
        }
      }
    }
    writeTraining(state);
    return relinked;
  };
  return {
    async listTermMappings() {
      return read().mappings;
    },
    async amICurator() {
      return curator();
    },
    async listUncataloguedTerms() {
      requireCurator();
      const handled = new Set(read().mappings.filter(({ action }) => action).map(({ term }) => term));
      const flagged = new Set(read().mappings.filter(({ needs_video: flag }) => flag).map(({ term }) => term));
      const state = training();
      const byTerm = new Map();
      for (const participation of state.participations ?? []) {
        const occurrence = (state.occurrences ?? []).find(({ id }) => id === participation.occurrence_id);
        for (const round of occurrence?.rounds ?? []) {
          for (const movement of round.movements ?? []) {
            if (movement.catalogued !== false || handled.has(movement.movement_key)) continue;
            const entry = byTerm.get(movement.movement_key) ?? {
              term: movement.movement_key, spelling: movement.movement_name, people: new Set(), uses: 0,
              first_seen: occurrence.occurred_at ?? null, last_seen: occurrence.occurred_at ?? null,
              needs_video: flagged.has(movement.movement_key),
            };
            entry.people.add(participation.profile_id);
            entry.uses += 1;
            byTerm.set(movement.movement_key, entry);
          }
        }
      }
      return [...byTerm.values()]
        .map((entry) => ({ ...entry, people: entry.people.size }))
        .sort((a, b) => b.people - a.people || b.uses - a.uses || a.term.localeCompare(b.term));
    },
    async mapTerm(term, targetSlug) {
      requireCurator();
      requireTerm(term); requireTerm(targetSlug);
      upsert(term, { action: 'alias', target_slug: targetSlug, target_term: null });
      return { status: 'saved', relinked: relink(term, targetSlug, true) };
    },
    async mergeTerm(term, targetTerm) {
      requireCurator();
      requireTerm(term); requireTerm(targetTerm);
      upsert(term, { action: 'merge', target_slug: null, target_term: targetTerm });
      return { status: 'saved', relinked: relink(term, targetTerm, false) };
    },
    async ignoreTerm(term) {
      requireCurator();
      upsert(requireTerm(term), { action: 'ignore', target_slug: null, target_term: null });
      return { status: 'saved' };
    },
    async setNeedsVideo(term, needsVideo) {
      requireCurator();
      upsert(requireTerm(term), { needs_video: Boolean(needsVideo) });
      return { status: 'saved' };
    },
  };
}
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run tests/unit/catalog-service.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/202610100003_catalog_curation.sql supabase/tests/0012_catalog_curation.test.sql src/app/catalog-service.js src/app/testing/fake-services.js tests/unit/catalog-service.test.js
git commit -m "feat: let catalog curators map uncatalogued terms

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Class resources and past classes — database and service

**Files:**
- Create: `supabase/migrations/202610100004_training_resources.sql`, `supabase/tests/0013_training_resources.test.sql`
- Modify: `src/app/training-service.js`, `src/app/testing/fake-services.js`
- Test: `tests/unit/training-service.test.js`

**Interfaces:**
- Produces (SQL):
  - `public.add_training_resource(occurrence_id uuid, kind text, title text, url text, body text) → jsonb { status, resource_id }`
  - `public.update_training_resource(resource_id uuid, title text, url text, body text) → jsonb { status, resource_id }`
  - `public.delete_training_resource(resource_id uuid) → jsonb { status }`
  - `public.list_training_resource_kinds(month_start date, month_end date, profile_id uuid default null) → table(occurrence_id uuid, kinds text[])`
  - `public.record_past_class(kind text, group_id uuid, student_profile_id uuid, connection_id uuid, occurred_at timestamptz, local_date date, timezone text, duration_minutes integer, attendees jsonb, rounds jsonb, idempotency_key uuid) → jsonb` (same shape as `complete_group_training`; error `past_class_in_future` when `occurred_at > now()`)
  - `get_training_day` entries gain `occurrence_id`, `can_add_resources boolean`, and `resources: [{ id, kind, title, url, body, added_by, can_edit }]`.
- Produces (JS, real and fake `trainingService`):
  - `addResource({ occurrenceId, kind, title, url, body })`, `updateResource({ resourceId, title, url, body })`, `deleteResource(resourceId)`, `listResourceKinds({ start, endExclusive, profileId })`, `recordPastClass({ kind, groupId, studentProfileId, connectionId, occurredAt, localDate, timezone, durationMinutes, attendees: [{ profileId, durationMinutes }], rounds, idempotencyKey })`.
  - Validation codes: `invalid_resource_kind`, `invalid_resource_url` (not `https://` or > 2,048), `invalid_resource_body` (empty or > 262,144), `invalid_resource_title` (> 200), `past_class_in_future`.

- [ ] **Step 1: Write the failing database test**

```sql
-- supabase/tests/0013_training_resources.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select ok((select relrowsecurity from pg_class where oid = 'public.training_resources'::regclass), 'resources have RLS');

select tests.create_user('10000000-0000-0000-0000-000000001301', 'coach13@example.test', 'Mestre Treze');
select tests.create_user('10000000-0000-0000-0000-000000001302', 'ana13@example.test', 'Ana Treze');
select tests.create_user('10000000-0000-0000-0000-000000001303', 'bia13@example.test', 'Bia Treze');
select tests.create_user('10000000-0000-0000-0000-000000001304', 'out13@example.test', 'Caio Treze');
insert into public.coach_profiles (profile_id) values ('10000000-0000-0000-0000-000000001301');
insert into public.groups (id, owner_id, name, timezone)
values ('20000000-0000-0000-0000-000000001301', '10000000-0000-0000-0000-000000001301', 'Grupo Treze', 'Europe/Lisbon');
insert into public.group_memberships (group_id, profile_id, access_level) values
  ('20000000-0000-0000-0000-000000001301', '10000000-0000-0000-0000-000000001301', 'coach'),
  ('20000000-0000-0000-0000-000000001301', '10000000-0000-0000-0000-000000001302', 'member'),
  ('20000000-0000-0000-0000-000000001301', '10000000-0000-0000-0000-000000001303', 'member');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001301');
select throws_ok(
  $$select public.record_past_class('group', '20000000-0000-0000-0000-000000001301', null, null,
    now() + interval '1 day', current_date + 1, 'Europe/Lisbon', 60,
    '[{"profile_id":"10000000-0000-0000-0000-000000001302","duration_minutes":60}]'::jsonb,
    null, '50000000-0000-0000-0000-000000001301')$$,
  'P0001', 'past_class_in_future', 'past classes must be in the past'
);
select public.record_past_class('group', '20000000-0000-0000-0000-000000001301', null, null,
  '2026-09-11T13:14:14Z', '2026-09-11', 'Europe/Lisbon', 77,
  '[{"profile_id":"10000000-0000-0000-0000-000000001302","duration_minutes":77},
    {"profile_id":"10000000-0000-0000-0000-000000001303","duration_minutes":60}]'::jsonb,
  '[{"source_text":"ginga, armada","movements":[{"movement_key":"ginga","movement_name":"Ginga","segment_key":"m:1"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000001302') ->> 'occurrence_id' as occurrence_id \gset
select is(
  (select count(*)::integer from public.training_participations where occurrence_id = :'occurrence_id'),
  2, 'a past group class creates one participation per attendee'
);
select is(
  public.record_past_class('group', '20000000-0000-0000-0000-000000001301', null, null,
    '2026-09-11T13:14:14Z', '2026-09-11', 'Europe/Lisbon', 77,
    '[{"profile_id":"10000000-0000-0000-0000-000000001302","duration_minutes":77}]'::jsonb,
    null, '50000000-0000-0000-0000-000000001302') ->> 'occurrence_id',
  :'occurrence_id', 'retrying with the same key returns the same class'
);
select throws_ok(
  $$select public.record_past_class('group', '20000000-0000-0000-0000-000000001301', null, null,
    '2026-09-12T10:00:00Z', '2026-09-12', 'Europe/Lisbon', 60,
    '[{"profile_id":"10000000-0000-0000-0000-000000001304","duration_minutes":60}]'::jsonb,
    null, '50000000-0000-0000-0000-000000001303')$$,
  'P0001', 'invalid_attendee', 'attendees must be active members'
);

select public.add_training_resource(:'occurrence_id', 'video', 'Zoom recording', 'https://www.youtube.com/watch?v=oMmctHNRyBg', null)
  ->> 'resource_id' as video_id \gset
select public.add_training_resource(:'occurrence_id', 'summary', 'Summary', null, '# Class 1' || chr(10) || '- ginga');
select throws_ok(
  format($$select public.add_training_resource(%L, 'video', null, 'http://example.test', null)$$, :'occurrence_id'),
  '23514', null, 'video links must be https'
);
select throws_ok(
  format($$select public.add_training_resource(%L, 'voice', null, null, '')$$, :'occurrence_id'),
  '23514', null, 'transcripts need text'
);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001302');
select is(
  jsonb_array_length(public.get_training_day('2026-09-11', null) -> 0 -> 'resources'),
  2, 'attendees see the class resources'
);
select is(
  (public.get_training_day('2026-09-11', null) -> 0 ->> 'can_add_resources')::boolean,
  false, 'students cannot add resources to a coach class'
);
select throws_ok(
  format($$select public.add_training_resource(%L, 'summary', null, null, 'mine')$$, :'occurrence_id'),
  'PT403', 'not_authorized', 'students cannot add resources to a coach class'
);
select is(
  (select kinds from public.list_training_resource_kinds('2026-09-01', '2026-10-01', null)),
  array['summary', 'video']::text[], 'calendar receives resource kinds'
);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001304');
select is((select count(*)::integer from public.training_resources), 0, 'outsiders read no resources');
select throws_ok(
  format($$select public.delete_training_resource(%L)$$, :'video_id'),
  'PT403', 'not_authorized', 'outsiders cannot delete resources'
);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001302');
select public.record_alone_training('2026-10-04', 'UTC', 30, null,
  '[{"source_text":"ginga"}]'::jsonb, '50000000-0000-0000-0000-000000001304', '2026-10-04T09:00:00Z')
  ->> 'occurrence_id' as alone_id \gset
select is(
  public.add_training_resource(:'alone_id', 'voice', 'Voice memo', null, 'felt good') ->> 'status',
  'saved', 'practitioners add resources to their own Alone training'
);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001301');
select is(public.update_training_resource(:'video_id', 'Recording', 'https://youtu.be/oMmctHNRyBg', null) ->> 'status',
  'saved', 'authors edit their resources');
select is(public.delete_training_resource(:'video_id') ->> 'status', 'deleted', 'authors delete their resources');

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx supabase test db supabase/tests/0013_training_resources.test.sql`
Expected: FAIL — `training_resources` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/202610100004_training_resources.sql
create table public.training_resources (
  id uuid primary key default extensions.gen_random_uuid(),
  occurrence_id uuid not null references public.training_occurrences(id) on delete cascade,
  kind text not null,
  title text,
  url text,
  body text,
  added_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_resources_kind_check check (kind in ('video', 'voice', 'summary')),
  constraint training_resources_title_check check (title is null or char_length(title) between 1 and 200),
  constraint training_resources_content_check check (
    (kind = 'video' and body is null and url ~ '^https://' and char_length(url) <= 2048)
    or (kind in ('voice', 'summary') and url is null
        and char_length(btrim(coalesce(body, ''))) between 1 and 262144)
  )
);
create index training_resources_occurrence_idx on public.training_resources (occurrence_id);
create trigger training_resources_set_updated_at
before update on public.training_resources
for each row execute function private.set_updated_at();

alter table public.training_resources enable row level security;
create policy training_resources_select_authorized
on public.training_resources for select to authenticated
using (exists (
  select 1 from public.training_occurrences occurrence
   where occurrence.id = training_resources.occurrence_id
     and (
       occurrence.recorded_by = auth.uid()
       or exists (
         select 1 from public.training_participations participation
          where participation.occurrence_id = occurrence.id
            and private.can_read_training(auth.uid(), participation.profile_id)
       )
     )
));
revoke all on table public.training_resources from public, anon, authenticated;
grant select on table public.training_resources to authenticated;

create function private.can_write_training_resources(actor_id uuid, target_occurrence_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select actor_id is not null and exists (
    select 1 from public.training_occurrences occurrence
     where occurrence.id = target_occurrence_id
       and (
         occurrence.recorded_by = actor_id
         or (occurrence.group_id is not null and private.is_group_coach(occurrence.group_id, actor_id))
       )
  );
$$;

create function private.add_training_resource(
  actor_id uuid, target_occurrence_id uuid, new_kind text, new_title text, new_url text, new_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare created_id uuid;
begin
  if not private.can_write_training_resources(actor_id, target_occurrence_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  insert into public.training_resources (occurrence_id, kind, title, url, body, added_by)
  values (
    target_occurrence_id, new_kind, nullif(btrim(coalesce(new_title, '')), ''),
    nullif(btrim(coalesce(new_url, '')), ''), new_body, actor_id
  ) returning id into created_id;
  return jsonb_build_object('status', 'saved', 'resource_id', created_id);
end;
$$;

create function private.update_training_resource(
  actor_id uuid, target_resource_id uuid, new_title text, new_url text, new_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target public.training_resources;
begin
  select * into target from public.training_resources where id = target_resource_id;
  if not found or target.added_by <> actor_id
     or not private.can_write_training_resources(actor_id, target.occurrence_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  update public.training_resources
     set title = nullif(btrim(coalesce(new_title, '')), ''),
         url = nullif(btrim(coalesce(new_url, '')), ''),
         body = new_body
   where id = target_resource_id;
  return jsonb_build_object('status', 'saved', 'resource_id', target_resource_id);
end;
$$;

create function private.delete_training_resource(actor_id uuid, target_resource_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target public.training_resources;
begin
  select * into target from public.training_resources where id = target_resource_id;
  if not found or target.added_by <> actor_id
     or not private.can_write_training_resources(actor_id, target.occurrence_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  delete from public.training_resources where id = target_resource_id;
  return jsonb_build_object('status', 'deleted', 'resource_id', target_resource_id);
end;
$$;

create function private.resources_json(actor_id uuid, target_occurrence_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', resource.id, 'kind', resource.kind, 'title', resource.title,
    'url', resource.url, 'body', resource.body, 'added_by', resource.added_by,
    'can_edit', resource.added_by = actor_id
  ) order by resource.created_at, resource.id), '[]'::jsonb)
  from public.training_resources resource
  where resource.occurrence_id = target_occurrence_id;
$$;

create function private.list_training_resource_kinds(
  actor_id uuid, range_start date, range_end_exclusive date, target_profile_id uuid
)
returns table (occurrence_id uuid, kinds text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare practitioner_id uuid := coalesce(target_profile_id, actor_id);
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if not private.can_read_training(actor_id, practitioner_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  return query
  select occurrence.id, array_agg(distinct resource.kind order by resource.kind)
    from public.training_participations participation
    join public.training_occurrences occurrence on occurrence.id = participation.occurrence_id
    join public.training_resources resource on resource.occurrence_id = occurrence.id
   where participation.profile_id = practitioner_id
     and occurrence.local_date >= range_start
     and occurrence.local_date < range_end_exclusive
   group by occurrence.id;
end;
$$;

create or replace function private.get_training_day(
  actor_id uuid,
  target_local_date date,
  target_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare practitioner_id uuid := coalesce(target_profile_id, actor_id);
declare result jsonb;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if not private.can_read_training(actor_id, practitioner_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  select coalesce(jsonb_agg(entry order by entry ->> 'starts_at'), '[]'::jsonb)
    into result
    from (
      select jsonb_build_object(
        'id', occurrence.id, 'occurrence_id', occurrence.id, 'item_type', 'completed',
        'kind', occurrence.kind::text, 'status', 'completed',
        'starts_at', occurrence.occurred_at,
        'duration_minutes', participation.actual_duration_minutes,
        'group_id', occurrence.group_id, 'group_name', target_group.name,
        'coach_profile_id', occurrence.recorded_by, 'coach_name', coach.display_name,
        'participation_id', participation.id,
        'personal_notes', participation.personal_notes,
        'rounds', private.occurrence_rounds_json(
          actor_id, occurrence.id, participation.id
        ),
        'feedback', private.feedback_json(actor_id, participation.id),
        'feedback_contexts', private.feedback_contexts_json(actor_id, participation.id),
        'resources', private.resources_json(actor_id, occurrence.id),
        'can_add_resources', private.can_write_training_resources(actor_id, occurrence.id)
      ) entry
      from public.training_participations participation
      join public.training_occurrences occurrence on occurrence.id = participation.occurrence_id
      left join public.groups target_group on target_group.id = occurrence.group_id
      left join public.profiles coach on coach.id = occurrence.recorded_by
      where participation.profile_id = practitioner_id
        and occurrence.local_date = target_local_date
    ) completed;
  return result;
end;
$$;

create function private.record_past_class(
  actor_id uuid,
  target_kind text,
  target_group_id uuid,
  target_student_profile_id uuid,
  target_connection_id uuid,
  target_occurred_at timestamptz,
  target_local_date date,
  target_timezone text,
  target_duration_minutes integer,
  attendees jsonb,
  actual_rounds jsonb,
  target_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare existing_occurrence public.training_occurrences;
declare created_occurrence public.training_occurrences;
declare attendee jsonb;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  select * into existing_occurrence from public.training_occurrences occurrence
   where occurrence.idempotency_key = target_idempotency_key;
  if found then
    if existing_occurrence.recorded_by = actor_id and existing_occurrence.schedule_id is null
       and existing_occurrence.kind::text = target_kind then
      return private.completion_response(existing_occurrence.id);
    end if;
    raise exception using errcode = 'P0001', message = 'duplicate_completion';
  end if;
  if target_occurred_at is null or target_occurred_at > now() then
    raise exception using errcode = 'P0001', message = 'past_class_in_future';
  end if;
  if target_duration_minutes is null or target_duration_minutes not between 1 and 1440 then
    raise exception using errcode = 'P0001', message = 'invalid_duration';
  end if;

  if target_kind = 'group' then
    if target_group_id is null or not private.is_group_coach(target_group_id, actor_id) then
      raise exception using errcode = 'PT403', message = 'not_authorized';
    end if;
    if jsonb_typeof(attendees) <> 'array' or jsonb_array_length(attendees) = 0 then
      raise exception using errcode = 'P0001', message = 'invalid_attendee';
    end if;
    for attendee in select value from jsonb_array_elements(attendees)
    loop
      if not private.is_active_group_member(target_group_id, (attendee ->> 'profile_id')::uuid)
         or coalesce((attendee ->> 'duration_minutes')::integer, 0) not between 1 and 1440 then
        raise exception using errcode = 'P0001', message = 'invalid_attendee';
      end if;
    end loop;
    if (select count(*) from jsonb_array_elements(attendees)) <>
       (select count(distinct value ->> 'profile_id') from jsonb_array_elements(attendees)) then
      raise exception using errcode = 'P0001', message = 'invalid_attendee';
    end if;
  elsif target_kind = 'personal_class' then
    if target_student_profile_id is null
       or ((target_group_id is not null)::integer + (target_connection_id is not null)::integer) <> 1 then
      raise exception using errcode = 'P0001', message = 'invalid_coaching_context';
    end if;
    if target_group_id is not null then
      if not private.can_coach_practitioner(actor_id, target_student_profile_id, target_group_id) then
        raise exception using errcode = 'PT403', message = 'not_authorized';
      end if;
    elsif not exists (
      select 1 from public.coach_student_connections connection
       where connection.id = target_connection_id
         and connection.coach_profile_id = actor_id
         and connection.student_profile_id = target_student_profile_id
         and connection.state = 'active'
    ) then
      raise exception using errcode = 'P0001', message = 'connection_ended';
    end if;
  else
    raise exception using errcode = 'P0001', message = 'invalid_training_kind';
  end if;

  insert into public.training_occurrences (
    kind, group_id, student_profile_id, recorded_by, occurred_at, local_date,
    timezone, default_duration_minutes, idempotency_key
  ) values (
    target_kind::public.training_kind, target_group_id,
    case when target_kind = 'personal_class' then target_student_profile_id end,
    actor_id, target_occurred_at, target_local_date, target_timezone,
    target_duration_minutes, target_idempotency_key
  ) returning * into created_occurrence;
  perform private.insert_occurrence_rounds(created_occurrence.id, actual_rounds);
  if target_kind = 'group' then
    insert into public.training_participations (
      occurrence_id, profile_id, actual_duration_minutes, confirmed_at, confirmed_by
    )
    select created_occurrence.id, (value ->> 'profile_id')::uuid,
           (value ->> 'duration_minutes')::integer, target_occurred_at, actor_id
      from jsonb_array_elements(attendees);
  else
    insert into public.training_participations (
      occurrence_id, profile_id, actual_duration_minutes, confirmed_at, confirmed_by
    ) values (
      created_occurrence.id, target_student_profile_id, target_duration_minutes,
      target_occurred_at, actor_id
    );
  end if;
  return private.completion_response(created_occurrence.id);
end;
$$;

create function public.add_training_resource(occurrence_id uuid, kind text, title text, url text, body text)
returns jsonb language sql set search_path = ''
as $$ select private.add_training_resource(auth.uid(), occurrence_id, kind, title, url, body); $$;
create function public.update_training_resource(resource_id uuid, title text, url text, body text)
returns jsonb language sql set search_path = ''
as $$ select private.update_training_resource(auth.uid(), resource_id, title, url, body); $$;
create function public.delete_training_resource(resource_id uuid)
returns jsonb language sql set search_path = ''
as $$ select private.delete_training_resource(auth.uid(), resource_id); $$;
create function public.list_training_resource_kinds(month_start date, month_end date, profile_id uuid default null)
returns table (occurrence_id uuid, kinds text[])
language sql stable set search_path = ''
as $$ select * from private.list_training_resource_kinds(auth.uid(), month_start, month_end, profile_id); $$;
create function public.record_past_class(
  kind text, group_id uuid, student_profile_id uuid, connection_id uuid,
  occurred_at timestamptz, local_date date, timezone text, duration_minutes integer,
  attendees jsonb, rounds jsonb, idempotency_key uuid
)
returns jsonb language sql set search_path = ''
as $$
  select private.record_past_class(
    auth.uid(), kind, group_id, student_profile_id, connection_id, occurred_at,
    local_date, timezone, duration_minutes, attendees, rounds, idempotency_key
  );
$$;

revoke execute on function private.can_write_training_resources(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.add_training_resource(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function private.update_training_resource(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function private.delete_training_resource(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.resources_json(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.list_training_resource_kinds(uuid, date, date, uuid) from public, anon, authenticated;
revoke execute on function private.record_past_class(uuid, text, uuid, uuid, uuid, timestamptz, date, text, integer, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function private.add_training_resource(uuid, uuid, text, text, text, text) to authenticated;
grant execute on function private.update_training_resource(uuid, uuid, text, text, text) to authenticated;
grant execute on function private.delete_training_resource(uuid, uuid) to authenticated;
grant execute on function private.list_training_resource_kinds(uuid, date, date, uuid) to authenticated;
grant execute on function private.record_past_class(uuid, text, uuid, uuid, uuid, timestamptz, date, text, integer, jsonb, jsonb, uuid) to authenticated;
revoke execute on function public.add_training_resource(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.update_training_resource(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.delete_training_resource(uuid) from public, anon, authenticated;
revoke execute on function public.list_training_resource_kinds(date, date, uuid) from public, anon, authenticated;
revoke execute on function public.record_past_class(text, uuid, uuid, uuid, timestamptz, date, text, integer, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.add_training_resource(uuid, text, text, text, text) to authenticated;
grant execute on function public.update_training_resource(uuid, text, text, text) to authenticated;
grant execute on function public.delete_training_resource(uuid) to authenticated;
grant execute on function public.list_training_resource_kinds(date, date, uuid) to authenticated;
grant execute on function public.record_past_class(text, uuid, uuid, uuid, timestamptz, date, text, integer, jsonb, jsonb, uuid) to authenticated;
```

- [ ] **Step 4: Run database tests**

Run: `npm run supabase:reset && npm run test:db`
Expected: PASS.

- [ ] **Step 5: Write failing service tests**

Add to `tests/unit/training-service.test.js`:

```js
  it('uses stable resource and past-class contracts', async () => {
    const { client, calls } = harness();
    const service = createTrainingService(client, { randomUUID: () => 'past-key' });
    await service.addResource({ occurrenceId: 'o-1', kind: 'video', title: ' Rec ', url: ' https://youtu.be/x ' });
    await service.addResource({ occurrenceId: 'o-1', kind: 'summary', body: '# Notes' });
    await service.updateResource({ resourceId: 'r-1', title: '', body: 'Updated', kind: 'voice' });
    await service.deleteResource('r-1');
    await service.listResourceKinds({ start: '2026-09-01', endExclusive: '2026-10-01' });
    await service.recordPastClass({
      kind: 'group', groupId: 'g-1', occurredAt: '2026-09-11T13:14:14Z', localDate: '2026-09-11',
      timezone: 'Europe/Lisbon', durationMinutes: 77,
      attendees: [{ profileId: 's-1', durationMinutes: 77 }], rounds: null,
    }, new Date('2026-10-10T00:00:00Z'));
    expect(calls).toEqual([
      ['add_training_resource', { occurrence_id: 'o-1', kind: 'video', title: 'Rec', url: 'https://youtu.be/x', body: null }],
      ['add_training_resource', { occurrence_id: 'o-1', kind: 'summary', title: null, url: null, body: '# Notes' }],
      ['update_training_resource', { resource_id: 'r-1', title: null, url: null, body: 'Updated' }],
      ['delete_training_resource', { resource_id: 'r-1' }],
      ['list_training_resource_kinds', { month_start: '2026-09-01', month_end: '2026-10-01', profile_id: null }],
      ['record_past_class', {
        kind: 'group', group_id: 'g-1', student_profile_id: null, connection_id: null,
        occurred_at: '2026-09-11T13:14:14Z', local_date: '2026-09-11', timezone: 'Europe/Lisbon',
        duration_minutes: 77, attendees: [{ profile_id: 's-1', duration_minutes: 77 }],
        rounds: null, idempotency_key: 'past-key',
      }],
    ]);
  });

  it.each([
    [{ occurrenceId: 'o', kind: 'photo', body: 'x' }, 'invalid_resource_kind'],
    [{ occurrenceId: 'o', kind: 'video', url: 'http://x.test' }, 'invalid_resource_url'],
    [{ occurrenceId: 'o', kind: 'video', url: `https://${'a'.repeat(2050)}` }, 'invalid_resource_url'],
    [{ occurrenceId: 'o', kind: 'summary', body: '   ' }, 'invalid_resource_body'],
    [{ occurrenceId: 'o', kind: 'voice', body: 'x'.repeat(262145) }, 'invalid_resource_body'],
    [{ occurrenceId: 'o', kind: 'voice', body: 'x', title: 't'.repeat(201) }, 'invalid_resource_title'],
  ])('validates resources %#', async (input, code) => {
    const { client, calls } = harness();
    await expect(createTrainingService(client).addResource(input)).rejects.toMatchObject({ code });
    expect(calls).toEqual([]);
  });

  it('rejects future past classes before calling Supabase', async () => {
    const { client, calls } = harness();
    await expect(createTrainingService(client).recordPastClass({
      kind: 'group', groupId: 'g', occurredAt: '2026-10-11T00:00:00Z', localDate: '2026-10-11',
      timezone: 'UTC', durationMinutes: 30, attendees: [{ profileId: 's', durationMinutes: 30 }],
    }, new Date('2026-10-10T00:00:00Z'))).rejects.toMatchObject({ code: 'past_class_in_future' });
    expect(calls).toEqual([]);
  });
```

- [ ] **Step 6: Implement in `src/app/training-service.js`**

Add helpers above `createTrainingService`:

```js
const RESOURCE_KINDS = new Set(['video', 'voice', 'summary']);

export function normalizeResource({ kind, title = null, url = null, body = null }) {
  if (!RESOURCE_KINDS.has(kind)) invalid('invalid_resource_kind', 'Choose video, voice, or summary.');
  const cleanTitle = optional(title);
  if (cleanTitle && cleanTitle.length > 200) invalid('invalid_resource_title', 'Use a title of 200 characters or fewer.');
  if (kind === 'video') {
    const cleanUrl = clean(url) ?? '';
    if (!cleanUrl.startsWith('https://') || cleanUrl.length > 2048) {
      invalid('invalid_resource_url', 'Paste a link that starts with https://.');
    }
    return { title: cleanTitle, url: cleanUrl, body: null };
  }
  const text = typeof body === 'string' ? body : '';
  if (!text.trim() || text.length > 262144) invalid('invalid_resource_body', 'Add text up to 256 KB.');
  return { title: cleanTitle, url: null, body: text };
}
```

Add methods inside the returned object:

```js
    async addResource(input) {
      const resource = normalizeResource(input);
      return call('add_training_resource', { occurrence_id: input.occurrenceId, kind: input.kind, ...resource });
    },
    async updateResource(input) {
      const resource = normalizeResource(input);
      return call('update_training_resource', { resource_id: input.resourceId, ...resource });
    },
    async deleteResource(resourceId) {
      return call('delete_training_resource', { resource_id: resourceId });
    },
    async listResourceKinds(input) {
      return call('list_training_resource_kinds', {
        month_start: requireLocalDate(input.start),
        month_end: requireLocalDate(input.endExclusive),
        profile_id: input.profileId ?? null,
      });
    },
    async recordPastClass(input, now = new Date()) {
      if (!(new Date(input.occurredAt) <= now)) {
        invalid('past_class_in_future', 'Choose a time that has already passed.');
      }
      const attendees = (input.attendees ?? []).map((attendee) => ({
        profile_id: attendee.profileId,
        duration_minutes: requireDuration(attendee.durationMinutes),
      }));
      return call('record_past_class', {
        kind: input.kind,
        group_id: input.groupId ?? null,
        student_profile_id: input.studentProfileId ?? null,
        connection_id: input.connectionId ?? null,
        occurred_at: input.occurredAt,
        local_date: requireLocalDate(input.localDate),
        timezone: requireTimezone(input.timezone),
        duration_minutes: requireDuration(input.durationMinutes),
        attendees,
        rounds: input.rounds ?? null,
        idempotency_key: input.idempotencyKey ?? randomUUID(),
      });
    },
```

`updateResource` callers pass the resource's `kind` so validation applies; the RPC itself does not take `kind`.

- [ ] **Step 7: Implement in the fake training service**

Add `resources: []` to `readState()` defaults. Add methods:

```js
    async addResource(input) {
      const state = readState();
      guard(state, 'addResource');
      const resource = normalizeResource(input);
      const occurrence = state.occurrences.find(({ id }) => id === input.occurrenceId);
      if (!occurrence || occurrence.recorded_by !== actorId()) throw new AppError('authorization', 'not_authorized');
      const id = nextId(state, 'resource');
      state.resources.push({ id, occurrence_id: occurrence.id, kind: input.kind, added_by: actorId(), ...resource });
      writeState(state);
      record({ type: 'add-resource', kind: input.kind });
      return { status: 'saved', resource_id: id };
    },
    async updateResource(input) {
      const state = readState();
      const resource = state.resources.find(({ id }) => id === input.resourceId);
      if (!resource || resource.added_by !== actorId()) throw new AppError('authorization', 'not_authorized');
      Object.assign(resource, normalizeResource({ ...input, kind: resource.kind }));
      writeState(state);
      return { status: 'saved', resource_id: resource.id };
    },
    async deleteResource(resourceId) {
      const state = readState();
      const resource = state.resources.find(({ id }) => id === resourceId);
      if (!resource || resource.added_by !== actorId()) throw new AppError('authorization', 'not_authorized');
      state.resources = state.resources.filter(({ id }) => id !== resourceId);
      writeState(state);
      return { status: 'deleted', resource_id: resourceId };
    },
    async listResourceKinds(input) {
      const state = readState();
      const profileId = input.profileId ?? actorId();
      const occurrenceIds = new Set(state.participations
        .filter(({ profile_id: id }) => id === profileId).map(({ occurrence_id: id }) => id));
      const byOccurrence = new Map();
      for (const resource of state.resources) {
        const occurrence = state.occurrences.find(({ id }) => id === resource.occurrence_id);
        if (!occurrenceIds.has(resource.occurrence_id)) continue;
        if (occurrence.local_date < input.start || occurrence.local_date >= input.endExclusive) continue;
        const kinds = byOccurrence.get(resource.occurrence_id) ?? new Set();
        kinds.add(resource.kind);
        byOccurrence.set(resource.occurrence_id, kinds);
      }
      return [...byOccurrence].map(([occurrenceId, kinds]) => ({
        occurrence_id: occurrenceId, kinds: [...kinds].sort(),
      }));
    },
    async recordPastClass(input) {
      const state = readState();
      guard(state, 'recordPastClass');
      const existing = state.occurrences.find(({ idempotency_key: key }) => key === input.idempotencyKey);
      if (existing) return completion(state, existing);
      if (new Date(input.occurredAt) > new Date()) {
        throw new AppError('validation', 'past_class_in_future');
      }
      const occurrence = {
        id: nextId(state, 'occurrence'), kind: input.kind, group_id: input.groupId ?? null,
        schedule_id: null, recorded_by: actorId(), occurred_at: input.occurredAt,
        local_date: input.localDate, timezone: input.timezone,
        default_duration_minutes: input.durationMinutes, idempotency_key: input.idempotencyKey,
        rounds: structuredClone(input.rounds ?? []),
      };
      state.occurrences.push(occurrence);
      const attendees = input.kind === 'group'
        ? input.attendees
        : [{ profileId: input.studentProfileId, durationMinutes: input.durationMinutes }];
      for (const attendee of attendees) {
        state.participations.push({
          id: nextId(state, 'participation'), occurrence_id: occurrence.id,
          profile_id: attendee.profileId, actual_duration_minutes: attendee.durationMinutes,
          personal_notes: null, confirmed_at: input.occurredAt,
        });
      }
      writeState(state);
      record({ type: 'record-past-class', occurrenceId: occurrence.id });
      return completion(state, occurrence);
    },
```

In `getDay`, add to each returned entry:

```js
            occurrence_id: occurrence.id,
            resources: state.resources
              .filter(({ occurrence_id: id }) => id === occurrence.id)
              .map((resource) => ({ ...resource, can_edit: resource.added_by === actorId() })),
            can_add_resources: occurrence.recorded_by === actorId(),
```

Import `normalizeResource` from `../training-service.js` at the top of `fake-services.js`.

- [ ] **Step 8: Run tests**

Run: `npx vitest run tests/unit/training-service.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/202610100004_training_resources.sql supabase/tests/0013_training_resources.test.sql src/app/training-service.js src/app/testing/fake-services.js tests/unit/training-service.test.js
git commit -m "feat: add class resources and past-class recording

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Statistics from segment ratings

**Files:**
- Create: `supabase/migrations/202610100005_segment_statistics.sql`, `supabase/tests/0014_segment_statistics.test.sql`
- Modify: `src/app/testing/fake-services.js` (`createE2EStatisticsService.getPersonal`)
- Test: `tests/unit/statistics-service.test.js`

**Interfaces:**
- Produces: `get_personal_training_statistics` result gains `hardest_transitions: [{ from_movement_key, to_movement_key, from_name, to_name, hard_count, rating_count }]` (top 5 by `hard_count` desc, then `rating_count` desc, then keys; only pairs with `hard_count > 0`). `difficulty_trends` now also counts `move` segment ratings (score mapping identical; round ratings are never counted).

- [ ] **Step 1: Write the failing database test**

```sql
-- supabase/tests/0014_segment_statistics.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select tests.create_user('10000000-0000-0000-0000-000000001401', 'ana14@example.test', 'Ana Catorze');
reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001401');
select public.record_alone_training('2026-10-01', 'UTC', 30, null,
  '[{"source_text":"armada, au","movements":[
     {"movement_key":"armada","movement_name":"Armada","segment_key":"m:1"},
     {"movement_key":"au","movement_name":"Aú","segment_key":"m:2"}],
    "ratings":[{"segment_key":"r","segment_kind":"round","difficulty":"hard"},
               {"segment_key":"t:1>2","segment_kind":"transition","difficulty":"hard","from_movement_key":"armada","to_movement_key":"au"},
               {"segment_key":"m:2","segment_kind":"move","difficulty":"hard"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000001401', '2026-10-01T09:00:00Z');
select public.record_alone_training('2026-10-02', 'UTC', 30, null,
  '[{"source_text":"armada, au","movements":[
     {"movement_key":"armada","movement_name":"Armada","segment_key":"m:1"},
     {"movement_key":"au","movement_name":"Aú","segment_key":"m:2"}],
    "ratings":[{"segment_key":"t:1>2","segment_kind":"transition","difficulty":"okay","from_movement_key":"armada","to_movement_key":"au"},
               {"segment_key":"m:2","segment_kind":"move","difficulty":"easy"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000001402', '2026-10-02T09:00:00Z');

select public.get_personal_training_statistics('2026-10-01', '2026-11-01', 'UTC') as stats \gset
select is(
  (:'stats'::jsonb -> 'hardest_transitions' -> 0) - 'from_name' - 'to_name',
  '{"from_movement_key":"armada","to_movement_key":"au","hard_count":1,"rating_count":2}'::jsonb,
  'hardest transitions aggregate transition ratings'
);
select is(
  (select item ->> 'improving' from jsonb_array_elements(:'stats'::jsonb -> 'difficulty_trends') item
    where item ->> 'movement_key' = 'au'),
  'true', 'move segment ratings feed movement trends'
);
select is(
  (select count(*)::integer from jsonb_array_elements(:'stats'::jsonb -> 'difficulty_trends') item
    where item ->> 'movement_key' = 'armada'),
  0, 'round ratings never count as movement ratings'
);

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx supabase test db supabase/tests/0014_segment_statistics.test.sql`
Expected: FAIL — `hardest_transitions` is null.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/202610100005_segment_statistics.sql` containing `create or replace function private.get_personal_training_statistics(actor_id uuid, range_start date, range_end_exclusive date, target_timezone text)` whose body is copied **verbatim** from `supabase/migrations/202609220004_training_statistics.sql` (the `create function private.get_personal_training_statistics` definition, from its first line through its closing `$$;`) with exactly these three edits:

1. Replace the whole `scored_assessments as ( … )` CTE with:

```sql
  ), scored_assessments as (
    select movement.movement_key,
           movement.movement_name_snapshot movement_name,
           occurrence.occurred_at,
           assessment.id,
           case assessment.difficulty
             when 'hard' then 1 when 'okay' then 2 else 3
           end score,
           assessment.difficulty::text difficulty
      from public.training_movement_assessments assessment
      join activity on activity.participation_id = assessment.participation_id
      join public.training_occurrence_movements movement
        on movement.id = assessment.occurrence_movement_id
      join public.training_occurrence_rounds round
        on round.id = movement.occurrence_round_id
      join public.training_occurrences occurrence
        on occurrence.id = round.occurrence_id
    union all
    select movement.movement_key,
           movement.movement_name_snapshot,
           occurrence.occurred_at,
           segment.id,
           case segment.difficulty
             when 'hard' then 1 when 'okay' then 2 else 3
           end,
           segment.difficulty::text
      from public.training_segment_assessments segment
      join activity on activity.participation_id = segment.participation_id
      join public.training_occurrence_rounds round
        on round.id = segment.occurrence_round_id
      join public.training_occurrence_movements movement
        on movement.occurrence_round_id = round.id
       and movement.segment_key = segment.segment_key
      join public.training_occurrences occurrence
        on occurrence.id = round.occurrence_id
     where segment.segment_kind = 'move'
```

2. Immediately after the `difficulty_trends as ( … )` CTE (before the final `select jsonb_build_object(`), add:

```sql
  ), transition_counts as (
    select segment.from_movement_key, segment.to_movement_key,
           count(*) filter (where segment.difficulty = 'hard')::bigint hard_count,
           count(*)::bigint rating_count
      from public.training_segment_assessments segment
      join activity on activity.participation_id = segment.participation_id
     where segment.segment_kind in ('transition', 'loop')
       and segment.from_movement_key is not null
       and segment.to_movement_key is not null
     group by segment.from_movement_key, segment.to_movement_key
  ), movement_names as (
    select movement.movement_key, max(movement.movement_name_snapshot) movement_name
      from activity
      join public.training_occurrence_rounds round on round.occurrence_id = activity.occurrence_id
      join public.training_occurrence_movements movement on movement.occurrence_round_id = round.id
     group by movement.movement_key
  ), hardest_transitions as (
    select coalesce(jsonb_agg(item order by (item ->> 'hard_count')::bigint desc,
                                         (item ->> 'rating_count')::bigint desc,
                                         item ->> 'from_movement_key', item ->> 'to_movement_key'), '[]'::jsonb) value
      from (
        select jsonb_build_object(
          'from_movement_key', counts.from_movement_key,
          'to_movement_key', counts.to_movement_key,
          'from_name', coalesce(from_name.movement_name, counts.from_movement_key),
          'to_name', coalesce(to_name.movement_name, counts.to_movement_key),
          'hard_count', counts.hard_count,
          'rating_count', counts.rating_count
        ) item
          from transition_counts counts
          left join movement_names from_name on from_name.movement_key = counts.from_movement_key
          left join movement_names to_name on to_name.movement_key = counts.to_movement_key
         where counts.hard_count > 0
         order by counts.hard_count desc, counts.rating_count desc,
                  counts.from_movement_key, counts.to_movement_key
         limit 5
      ) ranked
```

3. In the final `jsonb_build_object(…)`, after `'difficulty_trends', difficulty_trends.value` add `, 'hardest_transitions', hardest_transitions.value`, and change the `from` clause to `from totals cross join streak cross join favorite_movements cross join difficulty_trends cross join hardest_transitions;`.

The `public.get_personal_training_statistics` wrapper and grants are unchanged and must not be redefined.

- [ ] **Step 4: Update the fake statistics service**

In `createE2EStatisticsService.getPersonal` in `fake-services.js`, compute `hardest_transitions` from `trainingState.roundRatings` for the actor's participations in range:

```js
      const ratingRows = participations.flatMap((participation) => (
        Object.values(trainingState.roundRatings?.[participation.id] ?? {}).flat()
      ));
      const pairs = new Map();
      for (const rating of ratingRows) {
        if (!['transition', 'loop'].includes(rating.segment_kind)
          || !rating.from_movement_key || !rating.to_movement_key) continue;
        const keyName = `${rating.from_movement_key}>${rating.to_movement_key}`;
        const entry = pairs.get(keyName) ?? {
          from_movement_key: rating.from_movement_key, to_movement_key: rating.to_movement_key,
          from_name: rating.from_movement_key, to_name: rating.to_movement_key,
          hard_count: 0, rating_count: 0,
        };
        entry.rating_count += 1;
        if (rating.difficulty === 'hard') entry.hard_count += 1;
        pairs.set(keyName, entry);
      }
      const hardestTransitions = [...pairs.values()].filter(({ hard_count: count }) => count > 0)
        .sort((a, b) => b.hard_count - a.hard_count || b.rating_count - a.rating_count
          || a.from_movement_key.localeCompare(b.from_movement_key))
        .slice(0, 5);
```

and include `hardest_transitions: hardestTransitions` in the returned object. Use the variable names already present in that function for the actor's in-range participations (rename `participations` above to match).

Add to `tests/unit/statistics-service.test.js` a test that seeds `roda.e2e.trainingState` with one participation in range and `roundRatings` containing one hard `transition` rating from `armada` to `au`, calls `createE2EStatisticsService({ window }).getPersonal({ start: '2026-10-01', endExclusive: '2026-11-01', timezone: 'UTC' })`, and asserts `result.hardest_transitions` equals `[{ from_movement_key: 'armada', to_movement_key: 'au', from_name: 'armada', to_name: 'au', hard_count: 1, rating_count: 1 }]`.

- [ ] **Step 5: Run tests**

Run: `npm run supabase:reset && npm run test:db && npx vitest run tests/unit/statistics-service.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/202610100005_segment_statistics.sql supabase/tests/0014_segment_statistics.test.sql src/app/testing/fake-services.js tests/unit/statistics-service.test.js
git commit -m "feat(db): compute movement trends and hardest transitions from segment ratings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Move figure, move picker, and segment strip components

**Files:**
- Create: `src/app/ui/move-figure.js`, `src/app/ui/move-picker.js`, `src/app/ui/segment-strip.js`
- Modify: `src/app/dashboard-i18n.js`, `assets/training-forms.css`
- Test: `tests/unit/move-picker.test.js`, `tests/unit/segment-strip.test.js`

**Interfaces:**
- Consumes: `listCategories`, `listMoves` (Task 1); `buildSegments` segment shape (Task 3).
- Produces:
  - `figureSvg(document, entry) → SVGElement` (placeholder `<svg>` with the move's initials when `entry.pose` is null).
  - `createMovePicker({ document, i18n, onPick }) → { element, setCategory(category), refreshCopy() }`; `onPick(entry)` fires on tile click; `element` has `data-move-picker`.
  - `createSegmentStrip({ document, i18n, idPrefix, onChange }) → { element, render(segments, ratings: Map<key, { difficulty, note }>) }`; `onChange(key, rating|null)` fires on edit. Each segment is a `<button data-segment-key aria-label="…">`; the open editor is a `<fieldset data-segment-editor>` with radios named `${idPrefix}-segment` and a note input.
  - New i18n keys (en / pt) listed in Step 3.

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/move-picker.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { createMovePicker } from '../../src/app/ui/move-picker.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

describe('move picker', () => {
  it('filters by category and reports picked moves', () => {
    const onPick = vi.fn();
    const picker = createMovePicker({ document, i18n, onPick });
    document.body.replaceChildren(picker.element);
    expect(document.querySelectorAll('[data-pick]').length).toBe(57);
    document.querySelector('[data-category="arm-strikes"]').click();
    expect([...document.querySelectorAll('[data-pick]')].map((tile) => tile.dataset.pick))
      .toEqual(['galopante', 'godeme', 'elbow-strike', 'escala']);
    expect(document.querySelector('[data-category="arm-strikes"]').getAttribute('aria-pressed')).toBe('true');
    document.querySelector('[data-pick="godeme"]').click();
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ slug: 'godeme', name: 'Godeme' }));
  });

  it('draws figures for captured moves and placeholders for the rest', () => {
    const picker = createMovePicker({ document, i18n, onPick() {} });
    document.body.replaceChildren(picker.element);
    expect(document.querySelector('[data-pick="armada"] svg polyline')).not.toBeNull();
    expect(document.querySelector('[data-pick="ginga"] svg text').textContent).toBe('G');
    expect(document.querySelector('[data-pick="armada"]').getAttribute('aria-label')).toBe('Armada');
  });
});
```

```js
// tests/unit/segment-strip.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { parseRound } from '../../src/app/training-text-parser.js';
import { buildSegments } from '../../src/app/training-sequence.js';
import { createSegmentStrip } from '../../src/app/ui/segment-strip.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

describe('segment strip', () => {
  it('renders segments and edits one rating at a time', () => {
    const onChange = vi.fn();
    const strip = createSegmentStrip({ document, i18n, idPrefix: 'r1', onChange });
    document.body.replaceChildren(strip.element);
    strip.render(buildSegments(parseRound('armada, au').steps), new Map());
    const labels = [...document.querySelectorAll('[data-segment-key]')].map((button) => button.getAttribute('aria-label'));
    expect(labels).toEqual(['Setup', 'Armada', 'Transition Armada → Aú', 'Aú']);
    document.querySelector('[data-segment-key="t:1>2"]').click();
    const editor = document.querySelector('[data-segment-editor]');
    expect(editor.querySelector('legend').textContent).toBe('Difficulty for Transition Armada → Aú');
    editor.querySelector('input[value="hard"]').click();
    expect(onChange).toHaveBeenLastCalledWith('t:1>2', { difficulty: 'hard', note: '' });
    editor.querySelector('input[name="note"]').value = 'late hands';
    editor.querySelector('input[name="note"]').dispatchEvent(new Event('input', { bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith('t:1>2', { difficulty: 'hard', note: 'late hands' });
    editor.querySelector('input[value=""]').click();
    expect(onChange).toHaveBeenLastCalledWith('t:1>2', null);
  });

  it('shows existing ratings on the segment buttons', () => {
    const strip = createSegmentStrip({ document, i18n, idPrefix: 'r2', onChange() {} });
    document.body.replaceChildren(strip.element);
    strip.render(buildSegments(parseRound('armada').steps), new Map([['m:1', { difficulty: 'hard', note: '' }]]));
    expect(document.querySelector('[data-segment-key="m:1"]').dataset.difficulty).toBe('hard');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/move-picker.test.js tests/unit/segment-strip.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Add i18n keys**

Add to the `en` block of `src/app/dashboard-i18n.js`:

```js
    'catalog.category.all': 'All',
    'catalog.category.essentials': 'Essentials',
    'catalog.category.golpes': 'Kicks',
    'catalog.category.esquivas': 'Dodges',
    'catalog.category.floreios': 'Acrobatics',
    'catalog.category.quedas': 'Takedowns',
    'catalog.category.arm-strikes': 'Arm strikes',
    'picker.categories': 'Move categories',
    'picker.moves': 'Moves',
    'segments.label': 'Parts of this round',
    'segments.setup': 'Setup',
    'segments.transition': 'Transition {from} → {to}',
    'segments.loop': 'Loop back {from} → {to}',
    'segments.difficultyFor': 'Difficulty for {segment}',
    'segments.notRated': 'Not rated',
    'segments.note': 'Note',
```

and to the `pt` block:

```js
    'catalog.category.all': 'Todos',
    'catalog.category.essentials': 'Essenciais',
    'catalog.category.golpes': 'Golpes',
    'catalog.category.esquivas': 'Esquivas',
    'catalog.category.floreios': 'Floreios',
    'catalog.category.quedas': 'Quedas',
    'catalog.category.arm-strikes': 'Golpes de mão',
    'picker.categories': 'Categorias de movimentos',
    'picker.moves': 'Movimentos',
    'segments.label': 'Partes desta ronda',
    'segments.setup': 'Entrada',
    'segments.transition': 'Transição {from} → {to}',
    'segments.loop': 'Volta {from} → {to}',
    'segments.difficultyFor': 'Dificuldade de {segment}',
    'segments.notRated': 'Sem avaliação',
    'segments.note': 'Nota',
```

- [ ] **Step 4: Implement the figure**

```js
// src/app/ui/move-figure.js
const SVG = 'http://www.w3.org/2000/svg';
const DEFAULT_POSE = Object.freeze({
  head: [60, 22], shoulder: [58, 40], hip: [60, 84],
  elbowL: [44, 50], handL: [40, 64], elbowR: [72, 50], handR: [78, 62],
  kneeL: [50, 114], footL: [46, 150], kneeR: [70, 114], footR: [74, 150], headR: 11,
});
const LIMBS = Object.freeze({
  torso: ['shoulder', 'hip'],
  legL: ['hip', 'kneeL', 'footL'],
  legR: ['hip', 'kneeR', 'footR'],
  armL: ['shoulder', 'elbowL', 'handL'],
  armR: ['shoulder', 'elbowR', 'handR'],
});

function polyline(document, points, width, className) {
  const line = document.createElementNS(SVG, 'polyline');
  line.setAttribute('points', points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
  line.setAttribute('class', className);
  line.setAttribute('stroke-width', String(width));
  return line;
}

export function figureSvg(document, entry) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 120 160');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'move-figure');
  if (!entry.pose) {
    const text = document.createElementNS(SVG, 'text');
    text.setAttribute('x', '60');
    text.setAttribute('y', '92');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('class', 'move-figure-placeholder');
    text.textContent = entry.name.split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase();
    svg.append(text);
    return svg;
  }
  const joints = { ...DEFAULT_POSE, ...entry.pose };
  for (const [name, keys] of Object.entries(LIMBS)) {
    svg.append(polyline(document, keys.map((key) => joints[key]), name === 'torso' ? 11 : 9, 'move-figure-body'));
  }
  const head = document.createElementNS(SVG, 'circle');
  head.setAttribute('cx', String(joints.head[0]));
  head.setAttribute('cy', String(joints.head[1]));
  head.setAttribute('r', String(joints.headR ?? 11));
  head.setAttribute('class', 'move-figure-head');
  svg.append(head);
  if (entry.highlight && LIMBS[entry.highlight]) {
    svg.append(polyline(document, LIMBS[entry.highlight].map((key) => joints[key]), 9, 'move-figure-highlight'));
  }
  return svg;
}
```

Before committing, compare `DEFAULT_POSE` with `const DEFAULT` in `index.html` (around line 976) and copy any differing values (including `headR`) so dashboard tiles match the public site.

- [ ] **Step 5: Implement the picker**

```js
// src/app/ui/move-picker.js
import { listCategories, listMoves } from '../movement-catalog.js';
import { figureSvg } from './move-figure.js';

export function createMovePicker({ document, i18n, onPick }) {
  const element = document.createElement('div');
  element.className = 'move-picker';
  element.dataset.movePicker = '';
  const chips = document.createElement('div');
  chips.className = 'move-picker-categories';
  chips.setAttribute('role', 'group');
  const grid = document.createElement('div');
  grid.className = 'move-picker-grid';
  element.append(chips, grid);
  let category = 'all';

  function renderChips() {
    chips.setAttribute('aria-label', i18n.t('picker.categories'));
    chips.replaceChildren(...['all', ...listCategories()].map((id) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.category = id;
      chip.textContent = i18n.t(`catalog.category.${id}`);
      chip.setAttribute('aria-pressed', String(id === category));
      return chip;
    }));
  }

  function renderGrid() {
    grid.setAttribute('aria-label', i18n.t('picker.moves'));
    const moves = listMoves({ category: category === 'all' ? null : category });
    grid.replaceChildren(...moves.map((entry) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'pick';
      tile.dataset.pick = entry.slug;
      tile.setAttribute('aria-label', entry.name);
      const name = document.createElement('span');
      name.className = 'pick-name';
      name.textContent = entry.name;
      tile.append(figureSvg(document, entry), name);
      return tile;
    }));
  }

  function setCategory(next) {
    category = next;
    renderChips();
    renderGrid();
  }

  chips.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-category]');
    if (chip) setCategory(chip.dataset.category);
  });
  grid.addEventListener('click', (event) => {
    const tile = event.target.closest('[data-pick]');
    if (!tile) return;
    const entry = listMoves().find(({ slug }) => slug === tile.dataset.pick);
    if (entry) onPick(entry);
  });

  setCategory('all');
  return { element, setCategory, refreshCopy: () => setCategory(category) };
}
```

- [ ] **Step 6: Implement the strip**

```js
// src/app/ui/segment-strip.js
import { getMove } from '../movement-catalog.js';

function moveName(slug) {
  return getMove(slug)?.name ?? slug;
}

export function segmentLabel(i18n, segment) {
  if (segment.kind === 'setup') return i18n.t('segments.setup');
  if (segment.kind === 'transition') {
    return i18n.t('segments.transition', { from: moveName(segment.from), to: moveName(segment.to) });
  }
  if (segment.kind === 'loop') {
    return i18n.t('segments.loop', { from: moveName(segment.from), to: moveName(segment.to) });
  }
  return segment.label;
}

export function createSegmentStrip({ document, i18n, idPrefix, onChange }) {
  const element = document.createElement('div');
  element.className = 'segment-strip';
  const list = document.createElement('div');
  list.className = 'segment-strip-list';
  list.setAttribute('role', 'group');
  const editorSlot = document.createElement('div');
  element.append(list, editorSlot);
  let segments = [];
  let ratings = new Map();
  let openKey = null;

  function renderEditor() {
    editorSlot.replaceChildren();
    const segment = segments.find(({ key }) => key === openKey);
    if (!segment) return;
    const current = ratings.get(segment.key) ?? { difficulty: '', note: '' };
    const fieldset = document.createElement('fieldset');
    fieldset.dataset.segmentEditor = segment.key;
    const legend = document.createElement('legend');
    legend.textContent = i18n.t('segments.difficultyFor', { segment: segmentLabel(i18n, segment) });
    fieldset.append(legend);
    for (const [value, key] of [['easy', 'training.easy'], ['okay', 'training.okay'], ['hard', 'training.hard'], ['', 'segments.notRated']]) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `${idPrefix}-segment`;
      radio.value = value;
      radio.checked = (current.difficulty ?? '') === value;
      label.append(radio, ` ${i18n.t(key)}`);
      fieldset.append(label);
    }
    const noteLabel = document.createElement('label');
    noteLabel.textContent = i18n.t('segments.note');
    const note = document.createElement('input');
    note.name = 'note';
    note.className = 'field-input';
    note.maxLength = 2000;
    note.value = current.note ?? '';
    noteLabel.append(note);
    fieldset.append(noteLabel);
    editorSlot.append(fieldset);
  }

  function emit() {
    const fieldset = editorSlot.querySelector('[data-segment-editor]');
    if (!fieldset) return;
    const difficulty = fieldset.querySelector('input[type="radio"]:checked')?.value ?? '';
    const note = fieldset.querySelector('input[name="note"]').value;
    const rating = difficulty ? { difficulty, note } : null;
    if (rating) ratings.set(openKey, rating);
    else ratings.delete(openKey);
    onChange(openKey, rating);
    renderList();
  }

  function renderList() {
    list.setAttribute('aria-label', i18n.t('segments.label'));
    list.replaceChildren(...segments.map((segment) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `segment segment-${segment.kind}`;
      button.dataset.segmentKey = segment.key;
      button.dataset.difficulty = ratings.get(segment.key)?.difficulty ?? '';
      button.setAttribute('aria-label', segmentLabel(i18n, segment));
      button.setAttribute('aria-expanded', String(segment.key === openKey));
      button.textContent = segment.kind === 'move' ? segment.label
        : segment.kind === 'setup' ? i18n.t('segments.setup') : segment.label;
      return button;
    }));
  }

  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-segment-key]');
    if (!button) return;
    openKey = openKey === button.dataset.segmentKey ? null : button.dataset.segmentKey;
    renderList();
    renderEditor();
  });
  editorSlot.addEventListener('change', emit);
  editorSlot.addEventListener('input', (event) => {
    if (event.target.name === 'note') emit();
  });

  return {
    element,
    render(nextSegments, nextRatings) {
      segments = nextSegments;
      ratings = nextRatings;
      if (!segments.some(({ key }) => key === openKey)) openKey = null;
      renderList();
      renderEditor();
    },
  };
}
```

Note: radio `click` in jsdom dispatches `change`, which bubbles to `editorSlot`.

- [ ] **Step 7: Add styles**

Append to `assets/training-forms.css`:

```css
.move-picker { display: grid; gap: .6rem; }
.move-picker-categories { display: flex; flex-wrap: wrap; gap: .4rem; }
.move-picker-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: .5rem; max-height: 320px; overflow-y: auto; }
.move-picker .pick { display: grid; justify-items: center; gap: .2rem; padding: .4rem; border: 1px solid var(--line, #3a2d20); border-radius: 12px; background: transparent; color: inherit; cursor: pointer; }
.move-picker .pick:hover, .move-picker .pick:focus-visible { border-color: var(--gold, #eba63c); }
.move-figure { width: 56px; height: 74px; }
.move-figure-body { fill: none; stroke: #e6d4b2; stroke-linecap: round; stroke-linejoin: round; }
.move-figure-head { fill: #e6d4b2; }
.move-figure-highlight { fill: none; stroke: #eba63c; stroke-linecap: round; stroke-linejoin: round; }
.move-figure-placeholder { fill: #e6d4b2; font: 700 40px/1 system-ui, sans-serif; }
.pick-name { font-size: .72rem; text-align: center; }
.segment-strip-list { display: flex; flex-wrap: wrap; gap: .3rem; align-items: center; }
.segment { border: 1px solid var(--line, #3a2d20); border-radius: 999px; padding: .2rem .6rem; background: transparent; color: inherit; font-size: .78rem; cursor: pointer; }
.segment-transition, .segment-loop, .segment-setup { border-style: dashed; }
.segment[data-difficulty="easy"] { border-color: #6fae6a; }
.segment[data-difficulty="okay"] { border-color: #eba63c; }
.segment[data-difficulty="hard"] { border-color: #d0573f; background: rgb(208 87 63 / 18%); }
```

- [ ] **Step 8: Run tests**

Run: `npx vitest run tests/unit/move-picker.test.js tests/unit/segment-strip.test.js tests/unit/dashboard-i18n.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/ui/move-figure.js src/app/ui/move-picker.js src/app/ui/segment-strip.js src/app/dashboard-i18n.js assets/training-forms.css tests/unit/move-picker.test.js tests/unit/segment-strip.test.js
git commit -m "feat: add move picker and segment strip components

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Round editor

**Files:**
- Create: `src/app/ui/round-editor.js`
- Modify: `src/app/dashboard-i18n.js`, `assets/training-forms.css`
- Test: `tests/unit/round-editor.test.js`

**Interfaces:**
- Consumes: Tasks 2, 3, 10; `repertoire` object with `list()` and `save({ title, sourceText, sequence })` (Task 6).
- Produces:
  - `createRoundEditor({ document, i18n, mode: 'record' | 'plan', getTermMappings = () => [], repertoire = null, showAddButton = true }) → { element, setRounds(rounds), getRounds(), addRound(text = ''), hasContent(), refreshCopy() }`
  - `setRounds([{ sourceText, ratings = [], planned = [] }])` — `ratings` uses the API rating shape; `planned` is display-only.
  - `getRounds() → Array<{ label: null, source_text, sequence, movements, ratings }>` — omits cards whose text is blank; `ratings` contains the round rating (`segment_key: 'r'`) when chosen plus every current segment rating, with `from_movement_key`/`to_movement_key` for `transition` and `loop` only.
  - Accessible names used by tests and e2e: textarea label **"Round {n} text"**; round difficulty legend **"How hard was this round?"** (record) or **"Planned difficulty"** (plan); buttons **"Add round"**, **"Add moves"**, **"Insert saved sequence"**, **"Save as sequence"**, **"Rate parts"**, **"Remove round {n}"**; chip exclude button **"Not a move: {name}"**.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/round-editor.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { createRoundEditor } from '../../src/app/ui/round-editor.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

function type(textarea, value) {
  textarea.value = value;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function mount(options = {}) {
  const editor = createRoundEditor({ document, i18n, mode: 'record', ...options });
  document.body.replaceChildren(editor.element);
  return editor;
}

const text = (n = 1) => document.querySelector(`textarea[aria-label="Round ${n} text"]`);

describe('round editor', () => {
  beforeEach(() => { document.body.replaceChildren(); });

  it('starts with one round and shows recognized and new chips in order', () => {
    const editor = mount();
    editor.setRounds([{ sourceText: '' }]);
    type(text(), '10x armada, galopanti → aú');
    const chips = [...document.querySelectorAll('[data-chip]')].map((chip) => [chip.dataset.chip, chip.dataset.status]);
    expect(chips).toEqual([['1', 'known'], ['2', 'new'], ['3', 'known']]);
    expect(editor.getRounds()).toEqual([expect.objectContaining({
      label: null, source_text: '10x armada, galopanti → aú',
      movements: [
        expect.objectContaining({ movement_key: 'armada', repetitions: 10, catalogued: true }),
        expect.objectContaining({ movement_key: 'galopanti', catalogued: false }),
        expect.objectContaining({ movement_key: 'au' }),
      ],
      ratings: [],
    })]);
  });

  it('excludes a chip without changing the text', () => {
    const editor = mount();
    editor.setRounds([{ sourceText: 'armada, stretching, au' }]);
    document.querySelector('button[aria-label="Not a move: stretching"]').click();
    const [round] = editor.getRounds();
    expect(round.source_text).toBe('armada, stretching, au');
    expect(round.movements.map(({ movement_key: key }) => key)).toEqual(['armada', 'au']);
  });

  it('collects the round rating and segment ratings with neighbors', () => {
    const editor = mount();
    editor.setRounds([{ sourceText: 'armada, au' }]);
    document.querySelector('[data-round-difficulty] input[value="hard"]').click();
    document.querySelector('button[aria-label="Rate parts"]').click();
    document.querySelector('[data-segment-key="t:1>2"]').click();
    document.querySelector('[data-segment-editor] input[value="hard"]').click();
    expect(editor.getRounds()[0].ratings).toEqual([
      { segment_key: 'r', segment_kind: 'round', difficulty: 'hard', note: null, from_movement_key: null, to_movement_key: null },
      { segment_key: 't:1>2', segment_kind: 'transition', difficulty: 'hard', note: null, from_movement_key: 'armada', to_movement_key: 'au' },
    ]);
  });

  it('drops ratings for parts that disappear after editing', () => {
    const editor = mount();
    editor.setRounds([{ sourceText: 'armada, au' }]);
    document.querySelector('button[aria-label="Rate parts"]').click();
    document.querySelector('[data-segment-key="t:1>2"]').click();
    document.querySelector('[data-segment-editor] input[value="hard"]').click();
    type(text(), 'armada');
    expect(editor.getRounds()[0].ratings).toEqual([]);
  });

  it('splits pasted multi-round text into cards', () => {
    const editor = mount();
    editor.setRounds([{ sourceText: '' }]);
    const event = new Event('paste', { bubbles: true, cancelable: true });
    event.clipboardData = { getData: () => 'Round 1: ginga 10 min\nRound 2: 10x (armada, au)' };
    text().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getRounds().map(({ source_text: value }) => value)).toEqual(['ginga 10 min', '10x (armada, au)']);
  });

  it('appends picked moves and inserts saved sequences as a group', async () => {
    const repertoire = {
      list: vi.fn().mockResolvedValue([{ id: 's1', title: 'Flow', source_text: 'armada, au' }]),
      save: vi.fn().mockResolvedValue({ status: 'saved' }),
    };
    const editor = mount({ repertoire });
    editor.setRounds([{ sourceText: 'ginga' }]);
    document.querySelector('button[aria-label="Add moves"]').click();
    document.querySelector('[data-pick="armada"]').click();
    expect(text().value).toBe('ginga, Armada');
    document.querySelector('button[aria-label="Insert saved sequence"]').click();
    await vi.waitFor(() => expect(document.querySelector('[data-saved-select] option[value="s1"]')).not.toBeNull());
    document.querySelector('[data-action="insert-saved"]').click();
    expect(text().value).toBe('ginga, Armada, 1x (armada, au)');
    document.querySelector('button[aria-label="Save as sequence"]').click();
    await vi.waitFor(() => expect(repertoire.save).toHaveBeenCalledWith({
      title: '', sourceText: 'ginga, Armada, 1x (armada, au)', sequence: expect.any(Array),
    }));
  });

  it('labels planned difficulty in plan mode and shows plan expectations in record mode', () => {
    mount({ mode: 'plan' }).setRounds([{ sourceText: 'armada' }]);
    expect(document.querySelector('[data-round-difficulty] legend').textContent).toBe('Planned difficulty');
    mount().setRounds([{ sourceText: 'armada', planned: [{ segment_key: 'r', segment_kind: 'round', difficulty: 'hard' }] }]);
    expect(document.querySelector('[data-planned]').textContent).toBe('Planned: Hard');
  });

  it('adds and removes rounds and ignores blank cards', () => {
    const editor = mount();
    editor.setRounds([{ sourceText: 'armada' }]);
    document.querySelector('[data-action="add-round"]').click();
    expect(text(2)).not.toBeNull();
    expect(editor.getRounds()).toHaveLength(1);
    document.querySelector('button[aria-label="Remove round 1"]').click();
    expect(text(1).value).toBe('');
    expect(editor.hasContent()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/round-editor.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Add i18n keys**

`en`:

```js
    'rounds.round': 'Round {number}',
    'rounds.text': 'Round {number} text',
    'rounds.placeholder': 'e.g. 10x (armada, aú, 3x ginga)',
    'rounds.remove': 'Remove round {number}',
    'rounds.add': 'Add round',
    'rounds.chips': 'How this round was read',
    'rounds.new': 'new',
    'rounds.notAMove': 'Not a move: {name}',
    'rounds.unbalanced': "Some parentheses aren't closed. The rest is read as a plain sequence.",
    'rounds.felt': 'How hard was this round?',
    'rounds.planned': 'Planned difficulty',
    'rounds.plannedValue': 'Planned: {difficulty}',
    'rounds.addMoves': 'Add moves',
    'rounds.insertSaved': 'Insert saved sequence',
    'rounds.chooseSaved': 'Saved sequence',
    'rounds.insert': 'Insert',
    'rounds.noSaved': 'No saved sequences yet.',
    'rounds.saveSequence': 'Save as sequence',
    'rounds.sequenceSaved': 'Saved to your repertoire.',
    'rounds.sequenceSaveError': "We couldn't save this sequence. Please try again.",
    'rounds.rateParts': 'Rate parts',
```

`pt`:

```js
    'rounds.round': 'Ronda {number}',
    'rounds.text': 'Texto da ronda {number}',
    'rounds.placeholder': 'ex.: 10x (armada, aú, 3x ginga)',
    'rounds.remove': 'Remover ronda {number}',
    'rounds.add': 'Adicionar ronda',
    'rounds.chips': 'Como esta ronda foi lida',
    'rounds.new': 'novo',
    'rounds.notAMove': 'Não é um movimento: {name}',
    'rounds.unbalanced': 'Há parênteses por fechar. O resto é lido como sequência simples.',
    'rounds.felt': 'Quão difícil foi esta ronda?',
    'rounds.planned': 'Dificuldade prevista',
    'rounds.plannedValue': 'Previsto: {difficulty}',
    'rounds.addMoves': 'Adicionar movimentos',
    'rounds.insertSaved': 'Inserir sequência guardada',
    'rounds.chooseSaved': 'Sequência guardada',
    'rounds.insert': 'Inserir',
    'rounds.noSaved': 'Ainda não tens sequências guardadas.',
    'rounds.saveSequence': 'Guardar como sequência',
    'rounds.sequenceSaved': 'Guardada no teu repertório.',
    'rounds.sequenceSaveError': 'Não foi possível guardar esta sequência. Tenta novamente.',
    'rounds.rateParts': 'Avaliar partes',
```

The existing `alone.addRound` (`Add round`) stays for the dialog button.

- [ ] **Step 4: Implement the editor**

```js
// src/app/ui/round-editor.js
import { parseRound, splitRounds } from '../training-text-parser.js';
import { buildSegments, toMovementRows, withoutExcluded } from '../training-sequence.js';
import { createMovePicker } from './move-picker.js';
import { createSegmentStrip } from './segment-strip.js';

let editorCount = 0;

function el(document, tag, { className, text, attrs = {} } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

function appendToText(current, addition) {
  const trimmed = current.replace(/\s+$/, '');
  if (!trimmed) return addition;
  return /[,(→]$/.test(trimmed) || /->$/.test(trimmed) ? `${trimmed} ${addition}` : `${trimmed}, ${addition}`;
}

export function createRoundEditor({
  document, i18n, mode = 'record', getTermMappings = () => [], repertoire = null, showAddButton = true,
}) {
  editorCount += 1;
  const editorId = `round-editor-${editorCount}`;
  const element = el(document, 'div', { className: 'round-editor' });
  const list = el(document, 'div', { className: 'round-card-list' });
  const addButton = el(document, 'button', { className: 'secondary-button' });
  addButton.type = 'button';
  addButton.dataset.action = 'add-round';
  element.append(list);
  if (showAddButton) element.append(addButton);
  let cards = [];
  let cardCount = 0;

  function newCard({ sourceText = '', ratings = [], planned = [] } = {}) {
    cardCount += 1;
    const segmentRatings = new Map();
    let roundDifficulty = '';
    for (const rating of ratings) {
      if (rating.segment_key === 'r') roundDifficulty = rating.difficulty;
      else segmentRatings.set(rating.segment_key, { difficulty: rating.difficulty, note: rating.note ?? '' });
    }
    return {
      id: `${editorId}-card-${cardCount}`,
      text: sourceText,
      excluded: new Set(),
      roundDifficulty,
      segmentRatings,
      planned: planned.find(({ segment_key: key }) => key === 'r')?.difficulty ?? null,
      pickerOpen: false,
      savedOpen: false,
      stripOpen: false,
      message: '',
    };
  }

  function parsed(card) {
    const result = parseRound(card.text, { termMappings: getTermMappings() });
    const steps = withoutExcluded(result.steps, card.excluded);
    return { steps, allSteps: result.steps, warnings: result.warnings, segments: buildSegments(steps) };
  }

  function pruneRatings(card, segments) {
    const keys = new Set(segments.map(({ key }) => key));
    for (const key of [...card.segmentRatings.keys()]) if (!keys.has(key)) card.segmentRatings.delete(key);
  }

  function renderChips(container, steps, card) {
    container.replaceChildren();
    steps.forEach((step, index) => {
      if (index > 0) container.append(el(document, 'li', { className: 'chip-arrow', text: '→', attrs: { 'aria-hidden': 'true' } }));
      if (step.type === 'group') {
        const group = el(document, 'li', { className: 'chip-group' });
        group.append(el(document, 'span', { className: 'chip-group-count', text: `×${step.repeat}` }));
        const inner = el(document, 'ul', { className: 'round-chips' });
        renderChips(inner, step.steps, card);
        group.append(inner);
        container.append(group);
        return;
      }
      const chip = el(document, 'li', { className: `round-chip round-chip-${step.catalogued ? 'known' : 'new'}` });
      chip.dataset.chip = step.path;
      chip.dataset.status = step.catalogued ? 'known' : 'new';
      const label = step.reps ? `${step.name} ×${step.reps}` : step.name;
      chip.append(el(document, 'span', { text: step.catalogued ? `✓ ${label}` : `${label} · ${i18n.t('rounds.new')}` }));
      if (card.excluded.has(step.path)) chip.classList.add('round-chip-excluded');
      const exclude = el(document, 'button', { className: 'round-chip-exclude', text: '×', attrs: { 'aria-label': i18n.t('rounds.notAMove', { name: step.name }) } });
      exclude.type = 'button';
      exclude.dataset.action = 'exclude-step';
      exclude.dataset.path = step.path;
      chip.append(exclude);
      container.append(chip);
    });
  }

  function toolButton(action, key, expanded = null) {
    const button = el(document, 'button', { className: 'quiet-button', text: i18n.t(key), attrs: { 'aria-label': i18n.t(key) } });
    button.type = 'button';
    button.dataset.action = action;
    if (expanded !== null) button.setAttribute('aria-expanded', String(expanded));
    return button;
  }

  function renderCard(card, index) {
    const number = index + 1;
    const section = el(document, 'section', { className: 'round-card' });
    section.dataset.roundCard = card.id;
    const header = el(document, 'header', { className: 'round-card-header' });
    header.append(el(document, 'h3', { text: i18n.t('rounds.round', { number }) }));
    const remove = el(document, 'button', { className: 'quiet-button', text: '×', attrs: { 'aria-label': i18n.t('rounds.remove', { number }) } });
    remove.type = 'button';
    remove.dataset.action = 'remove-round';
    header.append(remove);

    const textarea = el(document, 'textarea', { className: 'field-input field-textarea', attrs: { 'aria-label': i18n.t('rounds.text', { number }), placeholder: i18n.t('rounds.placeholder'), rows: '3', maxlength: '4000' } });
    textarea.dataset.roundText = '';
    textarea.value = card.text;

    const { steps, allSteps, warnings, segments } = parsed(card);
    pruneRatings(card, segments);
    const chips = el(document, 'ul', { className: 'round-chips', attrs: { 'aria-label': i18n.t('rounds.chips') } });
    chips.dataset.roundChips = '';
    renderChips(chips, allSteps, card);
    const warning = el(document, 'p', { className: 'round-warning', text: warnings.length ? i18n.t('rounds.unbalanced') : '', attrs: { role: 'status' } });

    const difficulty = el(document, 'fieldset', { className: 'round-difficulty' });
    difficulty.dataset.roundDifficulty = '';
    difficulty.append(el(document, 'legend', { text: i18n.t(mode === 'plan' ? 'rounds.planned' : 'rounds.felt') }));
    for (const value of ['easy', 'okay', 'hard']) {
      const label = el(document, 'label');
      const radio = el(document, 'input', { attrs: { type: 'radio', name: `${card.id}-difficulty`, value } });
      radio.checked = card.roundDifficulty === value;
      label.append(radio, ` ${i18n.t(`training.${value}`)}`);
      difficulty.append(label);
    }
    if (card.planned && mode !== 'plan') {
      const planned = el(document, 'p', { className: 'round-planned', text: i18n.t('rounds.plannedValue', { difficulty: i18n.t(`training.${card.planned}`) }) });
      planned.dataset.planned = '';
      difficulty.append(planned);
    }

    const tools = el(document, 'div', { className: 'round-tools' });
    tools.append(toolButton('toggle-picker', 'rounds.addMoves', card.pickerOpen));
    if (repertoire) {
      tools.append(toolButton('toggle-saved', 'rounds.insertSaved', card.savedOpen), toolButton('save-sequence', 'rounds.saveSequence'));
    }
    tools.append(toolButton('toggle-strip', 'rounds.rateParts', card.stripOpen));
    const message = el(document, 'p', { className: 'round-message', text: card.message, attrs: { role: 'status' } });

    section.append(header, textarea, chips, warning, difficulty, tools, message);
    if (card.pickerOpen) {
      const picker = createMovePicker({
        document, i18n,
        onPick(entry) {
          card.text = appendToText(card.text, entry.name);
          render();
        },
      });
      section.append(picker.element);
    }
    if (card.savedOpen) {
      const saved = el(document, 'div', { className: 'round-saved' });
      saved.dataset.savedPanel = '';
      section.append(saved);
      repertoire.list().then((items) => {
        saved.replaceChildren();
        if (!items.length) {
          saved.append(el(document, 'p', { text: i18n.t('rounds.noSaved') }));
          return;
        }
        const select = el(document, 'select', { className: 'field-input', attrs: { 'aria-label': i18n.t('rounds.chooseSaved') } });
        select.dataset.savedSelect = '';
        for (const item of items) {
          const option = el(document, 'option', { text: item.title });
          option.value = item.id;
          option.dataset.text = item.source_text;
          select.append(option);
        }
        const insert = el(document, 'button', { className: 'secondary-button', text: i18n.t('rounds.insert') });
        insert.type = 'button';
        insert.dataset.action = 'insert-saved';
        saved.append(select, insert);
      }).catch(() => {
        saved.textContent = i18n.t('rounds.sequenceSaveError');
      });
    }
    if (card.stripOpen) {
      const strip = createSegmentStrip({
        document, i18n, idPrefix: card.id,
        onChange(key, rating) {
          if (rating) card.segmentRatings.set(key, rating);
          else card.segmentRatings.delete(key);
        },
      });
      strip.render(segments, card.segmentRatings);
      section.append(strip.element);
    }
    card.steps = steps;
    card.segments = segments;
    return section;
  }

  function render() {
    const focused = document.activeElement?.closest?.('[data-round-card]')?.dataset.roundCard;
    const caret = document.activeElement?.selectionStart;
    addButton.textContent = i18n.t('rounds.add');
    list.replaceChildren(...cards.map(renderCard));
    if (focused) {
      const textarea = list.querySelector(`[data-round-card="${focused}"] [data-round-text]`);
      if (textarea && typeof caret === 'number') {
        textarea.focus();
        textarea.setSelectionRange(caret, caret);
      }
    }
  }

  function cardFor(target) {
    const id = target.closest('[data-round-card]')?.dataset.roundCard;
    return cards.find((card) => card.id === id);
  }

  list.addEventListener('input', (event) => {
    if (!event.target.matches('[data-round-text]')) return;
    const card = cardFor(event.target);
    card.text = event.target.value;
    card.excluded.clear();
    const { allSteps, warnings, segments } = parsed(card);
    pruneRatings(card, segments);
    const section = event.target.closest('[data-round-card]');
    renderChips(section.querySelector('[data-round-chips]'), allSteps, card);
    section.querySelector('.round-warning').textContent = warnings.length ? i18n.t('rounds.unbalanced') : '';
    if (card.stripOpen) render();
  });

  list.addEventListener('paste', (event) => {
    if (!event.target.matches('[data-round-text]')) return;
    const pasted = event.clipboardData?.getData('text') ?? '';
    const parts = splitRounds(pasted);
    if (parts.length < 2) return;
    event.preventDefault();
    const card = cardFor(event.target);
    const index = cards.indexOf(card);
    card.text = card.text.trim() ? appendToText(card.text, parts[0]) : parts[0];
    cards.splice(index + 1, 0, ...parts.slice(1).map((part) => newCard({ sourceText: part })));
    render();
  });

  list.addEventListener('change', (event) => {
    if (!event.target.matches('[data-round-difficulty] input[type="radio"]')) return;
    cardFor(event.target).roundDifficulty = event.target.value;
  });

  list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const card = cardFor(button);
    const action = button.dataset.action;
    if (action === 'remove-round') {
      cards = cards.filter((entry) => entry !== card);
      if (!cards.length) cards.push(newCard());
      render();
    } else if (action === 'exclude-step') {
      if (card.excluded.has(button.dataset.path)) card.excluded.delete(button.dataset.path);
      else card.excluded.add(button.dataset.path);
      render();
    } else if (action === 'toggle-picker') {
      card.pickerOpen = !card.pickerOpen;
      render();
    } else if (action === 'toggle-saved') {
      card.savedOpen = !card.savedOpen;
      render();
    } else if (action === 'toggle-strip') {
      card.stripOpen = !card.stripOpen;
      render();
    } else if (action === 'insert-saved') {
      const option = button.parentElement.querySelector('[data-saved-select]').selectedOptions[0];
      card.text = appendToText(card.text, `1x (${option.dataset.text})`);
      card.savedOpen = false;
      render();
    } else if (action === 'save-sequence') {
      if (!card.text.trim()) return;
      try {
        await repertoire.save({ title: '', sourceText: card.text.trim(), sequence: parsed(card).steps });
        card.message = i18n.t('rounds.sequenceSaved');
      } catch {
        card.message = i18n.t('rounds.sequenceSaveError');
      }
      render();
    }
  });

  addButton.addEventListener('click', () => {
    cards.push(newCard());
    render();
  });

  return {
    element,
    setRounds(rounds) {
      cards = (rounds?.length ? rounds : []).map(newCard);
      render();
    },
    addRound(text = '') {
      cards.push(newCard({ sourceText: text }));
      render();
    },
    hasContent() {
      return cards.some((card) => card.text.trim());
    },
    getRounds() {
      return cards.filter((card) => card.text.trim()).map((card) => {
        const { steps, segments } = parsed(card);
        const byKey = new Map(segments.map((segment) => [segment.key, segment]));
        const ratings = [];
        if (card.roundDifficulty) {
          ratings.push({ segment_key: 'r', segment_kind: 'round', difficulty: card.roundDifficulty, note: null, from_movement_key: null, to_movement_key: null });
        }
        for (const [key, rating] of card.segmentRatings) {
          const segment = byKey.get(key);
          if (!segment) continue;
          const neighbors = ['transition', 'loop'].includes(segment.kind);
          ratings.push({
            segment_key: key, segment_kind: segment.kind, difficulty: rating.difficulty,
            note: rating.note?.trim() || null,
            from_movement_key: neighbors ? segment.from : null,
            to_movement_key: neighbors ? segment.to : null,
          });
        }
        return {
          label: null,
          source_text: card.text.trim(),
          sequence: steps,
          movements: toMovementRows(steps),
          ratings,
        };
      });
    },
    refreshCopy: render,
  };
}
```

The test `adds and removes rounds` expects that removing the only non-empty card leaves one empty card; `remove-round` above guarantees at least one card remains.

- [ ] **Step 5: Add styles**

Append to `assets/training-forms.css`:

```css
.round-editor { display: grid; gap: .8rem; }
.round-card { display: grid; gap: .5rem; padding: .8rem; border: 1px solid var(--line, #3a2d20); border-radius: 14px; }
.round-card-header { display: flex; justify-content: space-between; align-items: center; }
.round-chips { display: flex; flex-wrap: wrap; gap: .3rem; list-style: none; margin: 0; padding: 0; align-items: center; }
.round-chip { display: inline-flex; gap: .3rem; align-items: center; border-radius: 999px; padding: .15rem .55rem; font-size: .78rem; border: 1px solid #6fae6a; }
.round-chip-new { border-color: #eba63c; border-style: dashed; }
.round-chip-excluded { opacity: .45; text-decoration: line-through; }
.round-chip-exclude { border: 0; background: transparent; color: inherit; cursor: pointer; }
.chip-group { display: inline-flex; gap: .3rem; align-items: center; padding: .15rem .4rem; border: 1px solid var(--line, #3a2d20); border-radius: 10px; }
.chip-group-count { font-weight: 700; }
.round-difficulty { display: flex; flex-wrap: wrap; gap: .6rem; border: 0; padding: 0; }
.round-tools { display: flex; flex-wrap: wrap; gap: .4rem; }
.round-warning:empty, .round-message:empty { display: none; }
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/unit/round-editor.test.js tests/unit/dashboard-i18n.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/ui/round-editor.js src/app/dashboard-i18n.js assets/training-forms.css tests/unit/round-editor.test.js
git commit -m "feat: add text-first round editor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Record training and day detail use round cards

**Files:**
- Create: `src/app/ui/round-detail.js`
- Modify: `src/app/ui/round-editor.js` (export `buildRatings`), `src/app/ui/training-calendar-view.js`, `src/app/entries/dashboard.js`, `src/app/dashboard-i18n.js`
- Test: `tests/unit/round-detail.test.js`, `tests/unit/training-calendar-view.test.js`, `tests/e2e/training-calendar.spec.js`

**Interfaces:**
- Consumes: `createRoundEditor` (Task 11), `createSegmentStrip` (Task 10), `trainingService.saveRoundAssessments` (Task 5).
- Produces:
  - `buildRatings({ roundDifficulty, segmentRatings: Map, segments }) → rating[]` exported from `round-editor.js` (the logic currently inline in `getRounds`; `getRounds` now calls it).
  - `createRoundDetail({ document, i18n, round, index, editable, onSave, getTermMappings }) → HTMLElement` with `data-round-detail=<round.id>`; when editable it contains `<form data-round-rating-form>` with a **"Save ratings"** submit button.
  - `createTrainingCalendarView({ …existing, getTermMappings = () => [], repertoire = null })`; `openAlone(date, { rounds } = {})` pre-fills round cards with `[{ sourceText }]`.

- [ ] **Step 1: Extract `buildRatings`**

In `src/app/ui/round-editor.js`, add and export:

```js
export function buildRatings({ roundDifficulty, segmentRatings, segments }) {
  const byKey = new Map(segments.map((segment) => [segment.key, segment]));
  const ratings = [];
  if (roundDifficulty) {
    ratings.push({ segment_key: 'r', segment_kind: 'round', difficulty: roundDifficulty, note: null, from_movement_key: null, to_movement_key: null });
  }
  for (const [key, rating] of segmentRatings) {
    const segment = byKey.get(key);
    if (!segment) continue;
    const neighbors = ['transition', 'loop'].includes(segment.kind);
    ratings.push({
      segment_key: key, segment_kind: segment.kind, difficulty: rating.difficulty,
      note: rating.note?.trim() || null,
      from_movement_key: neighbors ? segment.from : null,
      to_movement_key: neighbors ? segment.to : null,
    });
  }
  return ratings;
}
```

and replace the rating loop inside `getRounds()` with `const ratings = buildRatings({ roundDifficulty: card.roundDifficulty, segmentRatings: card.segmentRatings, segments });`. Run `npx vitest run tests/unit/round-editor.test.js` — still PASS.

- [ ] **Step 2: Write the failing round-detail test**

```js
// tests/unit/round-detail.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { createRoundDetail } from '../../src/app/ui/round-detail.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

describe('round detail', () => {
  it('shows the written text, planned difficulty, and saves felt ratings', async () => {
    const onSave = vi.fn().mockResolvedValue({ status: 'saved' });
    const round = {
      id: 'round-1', source_text: 'armada, au', sequence: [],
      ratings: [{ segment_key: 'r', segment_kind: 'round', difficulty: 'okay' }],
      planned: [{ segment_key: 'r', segment_kind: 'round', difficulty: 'hard' }],
      movements: [],
    };
    document.body.replaceChildren(createRoundDetail({ document, i18n, round, index: 0, editable: true, onSave }));
    expect(document.querySelector('.round-source').textContent).toBe('armada, au');
    expect(document.querySelector('[data-planned]').textContent).toBe('Planned: Hard');
    expect(document.querySelector('[data-round-rating-form] input[value="okay"]').checked).toBe(true);
    document.querySelector('[data-round-rating-form] input[value="hard"]').click();
    document.querySelector('button[aria-label="Rate parts"]').click();
    document.querySelector('[data-segment-key="t:1>2"]').click();
    document.querySelector('[data-segment-editor] input[value="hard"]').click();
    document.querySelector('[data-round-rating-form]').requestSubmit();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith([
      { segment_key: 'r', segment_kind: 'round', difficulty: 'hard', note: null, from_movement_key: null, to_movement_key: null },
      { segment_key: 't:1>2', segment_kind: 'transition', difficulty: 'hard', note: null, from_movement_key: 'armada', to_movement_key: 'au' },
    ]));
    expect(document.querySelector('[data-round-rating-form] [role="status"]').textContent).toBe('Ratings saved.');
  });

  it('falls back to movement names for rounds recorded before text existed', () => {
    const round = {
      id: 'legacy', source_text: null, sequence: null, ratings: [], planned: [],
      movements: [{ movement_name: 'Armada', repetitions: 10, assessment: { difficulty: 'hard' } }],
    };
    document.body.replaceChildren(createRoundDetail({ document, i18n, round, index: 1, editable: false, onSave() {} }));
    expect(document.querySelector('h4').textContent).toBe('Round 2');
    expect(document.querySelector('.round-source').textContent).toBe('10x Armada');
    expect(document.querySelector('.round-legacy-ratings').textContent).toBe('Armada: Hard');
    expect(document.querySelector('[data-round-rating-form]')).toBeNull();
  });

  it('keeps entered ratings and reports a failed save', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('offline'));
    const round = { id: 'r', source_text: 'au', sequence: [], ratings: [], planned: [], movements: [] };
    document.body.replaceChildren(createRoundDetail({ document, i18n, round, index: 0, editable: true, onSave }));
    document.querySelector('[data-round-rating-form] input[value="easy"]').click();
    document.querySelector('[data-round-rating-form]').requestSubmit();
    await vi.waitFor(() => expect(document.querySelector('[data-round-rating-form] [role="status"]').textContent).toBe('offline'));
    expect(document.querySelector('[data-round-rating-form] input[value="easy"]').checked).toBe(true);
  });
});
```

- [ ] **Step 3: Add i18n keys**

`en`:

```js
    'alone.needRound': 'Write what you trained in at least one round.',
    'training.saveRatings': 'Save ratings',
    'training.ratingsSaved': 'Ratings saved.',
    'training.ratingsError': "We couldn't save these ratings. Please try again.",
    'training.roundRating': 'Round: {difficulty}',
    'training.legacyRating': '{name}: {difficulty}',
```

`pt`:

```js
    'alone.needRound': 'Escreve o que treinaste em pelo menos uma ronda.',
    'training.saveRatings': 'Guardar avaliações',
    'training.ratingsSaved': 'Avaliações guardadas.',
    'training.ratingsError': 'Não foi possível guardar as avaliações. Tenta novamente.',
    'training.roundRating': 'Ronda: {difficulty}',
    'training.legacyRating': '{name}: {difficulty}',
```

- [ ] **Step 4: Implement round detail**

```js
// src/app/ui/round-detail.js
import { parseRound } from '../training-text-parser.js';
import { buildSegments } from '../training-sequence.js';
import { buildRatings } from './round-editor.js';
import { createSegmentStrip, segmentLabel } from './segment-strip.js';

let detailCount = 0;

function legacyText(movements) {
  return (movements ?? []).map((movement) => (
    movement.repetitions ? `${movement.repetitions}x ${movement.movement_name}` : movement.movement_name
  )).join(', ');
}

export function createRoundDetail({ document, i18n, round, index, editable, onSave, getTermMappings = () => [] }) {
  detailCount += 1;
  const idPrefix = `round-detail-${detailCount}`;
  const section = document.createElement('section');
  section.className = 'training-round-detail';
  section.dataset.roundDetail = round.id;
  const heading = document.createElement('h4');
  heading.textContent = round.label || i18n.t('rounds.round', { number: index + 1 });
  const source = document.createElement('p');
  source.className = 'round-source';
  const text = round.source_text || legacyText(round.movements);
  source.textContent = text;
  section.append(heading, source);

  const steps = Array.isArray(round.sequence) && round.sequence.length
    ? round.sequence
    : parseRound(text, { termMappings: getTermMappings() }).steps;
  const segments = buildSegments(steps);

  const plannedRound = (round.planned ?? []).find(({ segment_key: key }) => key === 'r');
  if (plannedRound) {
    const planned = document.createElement('p');
    planned.dataset.planned = '';
    planned.textContent = i18n.t('rounds.plannedValue', { difficulty: i18n.t(`training.${plannedRound.difficulty}`) });
    section.append(planned);
  }

  const legacy = (round.movements ?? []).filter(({ assessment }) => assessment);
  if (legacy.length) {
    const list = document.createElement('p');
    list.className = 'round-legacy-ratings';
    list.textContent = legacy.map((movement) => i18n.t('training.legacyRating', {
      name: movement.movement_name, difficulty: i18n.t(`training.${movement.assessment.difficulty}`),
    })).join(' · ');
    section.append(list);
  }

  const roundRating = (round.ratings ?? []).find(({ segment_key: key }) => key === 'r');
  const segmentRatings = new Map((round.ratings ?? [])
    .filter(({ segment_key: key }) => key !== 'r')
    .map((rating) => [rating.segment_key, { difficulty: rating.difficulty, note: rating.note ?? '' }]));

  if (!editable) {
    const summary = [];
    if (roundRating) summary.push(i18n.t('training.roundRating', { difficulty: i18n.t(`training.${roundRating.difficulty}`) }));
    for (const segment of segments) {
      const rating = segmentRatings.get(segment.key);
      if (rating) summary.push(`${segmentLabel(i18n, segment)}: ${i18n.t(`training.${rating.difficulty}`)}`);
    }
    if (summary.length) {
      const ratings = document.createElement('p');
      ratings.className = 'round-ratings';
      ratings.textContent = summary.join(' · ');
      section.append(ratings);
    }
    return section;
  }

  const form = document.createElement('form');
  form.dataset.roundRatingForm = round.id;
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'round-difficulty';
  const legend = document.createElement('legend');
  legend.textContent = i18n.t('rounds.felt');
  fieldset.append(legend);
  for (const value of ['easy', 'okay', 'hard']) {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `${idPrefix}-difficulty`;
    radio.value = value;
    radio.checked = roundRating?.difficulty === value;
    label.append(radio, ` ${i18n.t(`training.${value}`)}`);
    fieldset.append(label);
  }
  const rateParts = document.createElement('button');
  rateParts.type = 'button';
  rateParts.className = 'quiet-button';
  rateParts.textContent = i18n.t('rounds.rateParts');
  rateParts.setAttribute('aria-label', i18n.t('rounds.rateParts'));
  rateParts.setAttribute('aria-expanded', 'false');
  const strip = createSegmentStrip({
    document, i18n, idPrefix,
    onChange(key, rating) {
      if (rating) segmentRatings.set(key, rating);
      else segmentRatings.delete(key);
    },
  });
  strip.element.hidden = true;
  strip.render(segments, segmentRatings);
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'secondary-button';
  save.textContent = i18n.t('training.saveRatings');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  form.append(fieldset, rateParts, strip.element, save, status);
  section.append(form);

  rateParts.addEventListener('click', () => {
    strip.element.hidden = !strip.element.hidden;
    rateParts.setAttribute('aria-expanded', String(!strip.element.hidden));
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    status.textContent = '';
    save.disabled = true;
    const roundDifficulty = fieldset.querySelector('input:checked')?.value ?? '';
    try {
      await onSave(buildRatings({ roundDifficulty, segmentRatings, segments }));
      status.textContent = i18n.t('training.ratingsSaved');
    } catch (error) {
      status.textContent = error?.message || i18n.t('training.ratingsError');
    } finally {
      save.disabled = false;
    }
  });
  return section;
}
```

- [ ] **Step 5: Run round-detail tests**

Run: `npx vitest run tests/unit/round-detail.test.js`
Expected: PASS.

- [ ] **Step 6: Rewrite the calendar view tests that depend on the old inputs**

In `tests/unit/training-calendar-view.test.js`:

1. Add `saveRoundAssessments: vi.fn().mockResolvedValue({ status: 'saved' }),` to the `service()` defaults.
2. In `keeps the Alone form intact after failure and reuses its request key`, replace the three lines that click `#addAloneRound`, click `[data-action="add-movement"]`, and set `[data-movement-key]` with:

```js
    const roundText = document.querySelector('textarea[aria-label="Round 1 text"]');
    roundText.value = '10x armada, au';
    roundText.dispatchEvent(new Event('input', { bubbles: true }));
```

and add after the first `toHaveBeenCalledTimes(1)` wait:

```js
    expect(api.recordAloneTraining.mock.calls[0][0].rounds).toEqual([expect.objectContaining({
      source_text: '10x armada, au',
      movements: [
        expect.objectContaining({ movement_key: 'armada', repetitions: 10 }),
        expect.objectContaining({ movement_key: 'au' }),
      ],
    })]);
    expect(document.querySelector('textarea[aria-label="Round 1 text"]').value).toBe('10x armada, au');
```

3. Replace the two tests `saves personal notes separately and assesses each movement before refreshing the day` and `keeps the selected day visible after a failed assessment` with:

```js
  it('saves personal notes and round ratings before refreshing the day', async () => {
    const day = [{
      id: 'a', kind: 'alone', duration_minutes: 45, participation_id: 'participation-1',
      personal_notes: '', rounds: [{
        id: 'round-1', source_text: 'armada, au', sequence: [], ratings: [], planned: [], movements: [],
      }],
    }];
    const api = service({ getDay: vi.fn().mockResolvedValue(day) });
    const view = createTrainingCalendarView({
      document, service: api, i18n: i18n(), profile: { id: 'practitioner-1' }, timezone: 'Europe/Lisbon',
    });
    await view.loadMonth('2026-09');
    await view.selectDay('2026-09-22');
    const notes = document.querySelector('[data-notes-form="participation-1"]');
    notes.elements.notes.value = 'Balance needs work';
    notes.requestSubmit();
    await vi.waitFor(() => expect(api.saveNotes).toHaveBeenCalledWith({
      participationId: 'participation-1', notes: 'Balance needs work',
    }));
    await vi.waitFor(() => expect(document.querySelector('[data-round-rating-form="round-1"]')).not.toBeNull());
    const ratingForm = document.querySelector('[data-round-rating-form="round-1"]');
    ratingForm.querySelector('input[value="hard"]').click();
    ratingForm.requestSubmit();
    await vi.waitFor(() => expect(api.saveRoundAssessments).toHaveBeenCalledWith({
      participationId: 'participation-1', roundId: 'round-1',
      ratings: [{ segment_key: 'r', segment_kind: 'round', difficulty: 'hard', note: null, from_movement_key: null, to_movement_key: null }],
    }));
    expect(document.querySelector('.round-source').textContent).toBe('armada, au');
  });

  it('refuses to save Alone training without any round text', async () => {
    const api = service();
    const view = createTrainingCalendarView({
      document, service: api, i18n: i18n(), profile: { id: 'practitioner-1' }, timezone: 'Europe/Lisbon',
    });
    await view.loadMonth('2026-09');
    view.openAlone('2026-09-22');
    document.querySelector('#aloneTrainingForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(document.querySelector('#aloneTrainingStatus').textContent)
      .toBe('Write what you trained in at least one round.');
    expect(api.recordAloneTraining).not.toHaveBeenCalled();
  });

  it('pre-fills round cards when logging a saved sequence', async () => {
    const view = createTrainingCalendarView({
      document, service: service(), i18n: i18n(), profile: { id: 'practitioner-1' }, timezone: 'Europe/Lisbon',
    });
    await view.loadMonth('2026-09');
    view.openAlone('2026-09-22', { rounds: [{ sourceText: 'armada, au' }] });
    expect(document.querySelector('textarea[aria-label="Round 1 text"]').value).toBe('armada, au');
  });
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npx vitest run tests/unit/training-calendar-view.test.js`
Expected: FAIL — no `Round 1 text` textarea; no `[data-round-rating-form]`.

- [ ] **Step 8: Change `src/app/ui/training-calendar-view.js`**

1. Delete the `MOVEMENTS` constant, `addMovementRow`, `addRoundEditor`, `serializeRounds`, and the `rounds.addEventListener('click', …)` listener for `add-movement`.
2. Add imports:

```js
import { createRoundDetail } from './round-detail.js';
import { createRoundEditor } from './round-editor.js';
```

3. Add `getTermMappings = () => [], repertoire = null,` to the destructured options of `createTrainingCalendarView`.
4. After the element lookups, create and mount the editor:

```js
  const roundEditor = createRoundEditor({
    document, i18n, mode: 'record', getTermMappings, repertoire, showAddButton: false,
  });
  rounds.replaceChildren(roundEditor.element);
```

5. In `applyCopy()`, append `roundEditor.refreshCopy();`.
6. Replace `addRound.addEventListener('click', addRoundEditor);` with `addRound.addEventListener('click', () => roundEditor.addRound());`.
7. Replace `openAlone` with:

```js
  function openAlone(date = state.selectedDate, { rounds: prefill = null } = {}) {
    applyCopy();
    dateInput.value = date ?? `${state.visibleMonth}-01`;
    durationInput.value = '45';
    notesInput.value = '';
    roundEditor.setRounds(prefill?.length ? prefill : [{ sourceText: '' }]);
    formStatus.textContent = '';
    idempotencyKey = service.createIdempotencyKey();
    showDialog(dialog);
  }
```

8. In `submitAlone`, at the very top (before `submitting = true`), add:

```js
    const payloadRounds = roundEditor.getRounds();
    if (!payloadRounds.length) {
      formStatus.textContent = i18n.t('alone.needRound');
      return;
    }
```

pass `rounds: payloadRounds` instead of `rounds: serializeRounds()`, and replace `rounds.replaceChildren();` after success with `roundEditor.setRounds([{ sourceText: '' }]);`.
9. In `renderDetail`, replace the entire `for (const [roundIndex, round] of (item.rounds ?? []).entries()) { … }` loop (movement names plus assessment forms) with:

```js
      for (const [roundIndex, round] of (item.rounds ?? []).entries()) {
        article.append(createRoundDetail({
          document, i18n, round, index: roundIndex, getTermMappings,
          editable: ownRecord && Boolean(item.participation_id),
          onSave: (ratings) => service.saveRoundAssessments({
            participationId: item.participation_id, roundId: round.id, ratings,
          }),
        }));
      }
```

10. In the `detail.addEventListener('submit', …)` handler, delete the `assessmentForm` variable, its branch, and its use in `activeForm` (round forms stop propagation themselves).

- [ ] **Step 9: Wire term mappings and repertoire in the dashboard entry**

In `src/app/entries/dashboard.js`:

```js
import { createCatalogService } from '../catalog-service.js';
import { createRepertoireService } from '../repertoire-service.js';
// add to the fake-services import list:
//   createE2ECatalogService, createE2ERepertoireService,
```

after `statisticsService` is created:

```js
  const catalogService = localMode
    ? createE2ECatalogService({ window })
    : createCatalogService(client);
  const repertoireService = localMode
    ? createE2ERepertoireService({ window })
    : createRepertoireService(client);
  let termMappings = [];
  const getTermMappings = () => termMappings;
  catalogService.listTermMappings().then((rows) => { termMappings = rows; }).catch(() => {});
```

and pass `getTermMappings, repertoire: repertoireService` to `createTrainingCalendarView(...)`.

- [ ] **Step 10: Update the browser test**

In `tests/e2e/training-calendar.spec.js`, replace the last three lines of `fillAlone` (the Add round / Add movement / selectOption calls) with:

```js
  await dialog.getByLabel('Round 1 text').fill('10x armada, au');
```

Replace the test `records a personal movement assessment without losing the selected day` with:

```js
test('rates a round and a transition from the day detail', async ({ page }) => {
  await page.goto('/dashboard');
  const dialog = await fillAlone(page, { notes: 'Assessment day' });
  await dialog.getByRole('button', { name: 'Save training' }).click();
  await expect(dialog).toBeHidden();

  const detail = page.locator('#trainingDayDetail');
  await expect(detail.locator('.round-source')).toHaveText('10x armada, au');
  await detail.getByRole('radio', { name: 'Hard' }).first().check();
  await detail.getByRole('button', { name: 'Rate parts' }).click();
  await detail.getByRole('button', { name: 'Transition Armada → Aú' }).click();
  await detail.locator('[data-segment-editor]').getByRole('radio', { name: 'Hard' }).check();
  await detail.getByRole('button', { name: 'Save ratings' }).click();
  await expect(detail.getByText('Ratings saved.')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('roda.e2e.trainingState'));
    return Object.values(state.roundRatings).flatMap((byRound) => Object.values(byRound).flat())
      .map(({ segment_key: key, difficulty }) => `${key}:${difficulty}`).sort();
  })).toEqual(['r:hard', 't:1>2:hard']);
});

test('records a round typed with an unknown move and shows it as new', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Record Alone training' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record Alone training' });
  await dialog.getByLabel('Round 1 text').fill('armada, galopanti');
  await expect(dialog.locator('[data-chip="2"]')).toHaveAttribute('data-status', 'new');
  await dialog.getByLabel('Training date').fill('2026-09-23');
  await dialog.getByRole('button', { name: 'Save training' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('roda.e2e.trainingState'))
    .occurrences[0].rounds[0].movements.map(({ movement_key: key, catalogued }) => `${key}:${catalogued}`)))
    .toEqual(['armada:true', 'galopanti:false']);
});
```

- [ ] **Step 11: Run unit and browser tests**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS. Fix any other test that referenced `[data-assessment-form]`, `add-movement`, or `[data-movement-key]` by switching it to the round text box.

- [ ] **Step 12: Commit**

```bash
git add src/app/ui/round-detail.js src/app/ui/round-editor.js src/app/ui/training-calendar-view.js src/app/entries/dashboard.js src/app/dashboard-i18n.js tests/unit/round-detail.test.js tests/unit/training-calendar-view.test.js tests/e2e/training-calendar.spec.js
git commit -m "feat: record training as text rounds with round and part ratings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Coach plan editor uses round cards

**Files:**
- Modify: `src/app/ui/coaching-training-view.js`, `src/app/training-plan-state.js`, `src/app/entries/dashboard.js`
- Test: `tests/unit/coaching-training-view.test.js`, `tests/unit/training-plan-state.test.js`, `tests/e2e/coaching-training.spec.js`

**Interfaces:**
- Consumes: `createRoundEditor` (mode `plan`), `createRoundDetail` (read-only for published plans).
- Produces: `createCoachingTrainingView({ …existing, getTermMappings = () => [], repertoire = null })`. Plan drafts keep metadata only (`id, versionId, expectedUpdatedAt, title, description, groupId, durationMinutes, instructions, published, rounds: [{ sourceText, ratings }]`); the save payload's `rounds` come from `roundEditor.getRounds()`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/coaching-training-view.test.js`, replace the bodies of the tests that set `[name="movementName"]` (around lines 131 and 205) so they type into the round editor instead:

```js
    document.querySelector('[data-action="add-round"]').click();
    const roundText = document.querySelector('textarea[aria-label="Round 1 text"]');
    roundText.value = '8x armada, godeme';
    roundText.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-round-difficulty] input[value="hard"]').click();
```

and change their assertions on the `createPlan`/`savePlanDraft` payload to:

```js
    expect(trainingService.createPlan).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Armada ladder',
      rounds: [expect.objectContaining({
        source_text: '8x armada, godeme',
        movements: [
          expect.objectContaining({ movement_key: 'armada', repetitions: 8 }),
          expect.objectContaining({ movement_key: 'godeme', catalogued: true }),
        ],
        ratings: [expect.objectContaining({ segment_key: 'r', difficulty: 'hard' })],
      })],
    }));
```

For the test around line 205 that asserts the draft survives a failed save, assert `document.querySelector('textarea[aria-label="Round 1 text"]').value` equals `'8x armada, godeme'` instead of the old movement input.

Add a test for legacy plans:

```js
  it('shows legacy plan movements as round text', async () => {
    trainingService.listPlans.mockResolvedValue([{
      plan_id: 'legacy', version_id: 'v1', title: 'Old plan', state: 'draft',
      expected_duration_minutes: 30, rounds: [{ id: 'r1', movements: [
        { movement_key: 'armada', movement_name: 'Armada', repetitions: 10 },
        { movement_key: 'au', movement_name: 'Aú' },
      ] }],
    }]);
    // reuse this file's existing helper that renders the Schedule tab for a coach
    await openScheduleTab();
    document.querySelector('[data-action="edit-plan"][data-value="legacy"]').click();
    expect(document.querySelector('textarea[aria-label="Round 1 text"]').value).toBe('10x Armada, Aú');
  });
```

If the file has no `openScheduleTab` helper, inline the same setup lines the neighbouring tests use (create the view, `setContext({ mode: 'coaching', activeTab: 'schedule', groupId: 'group-1', isCoach: true })`, `await view.load()`).

In `tests/unit/training-plan-state.test.js`, delete the tests for `addMovement`, `moveMovement`, `removeMovement`, `addRound`, and `moveRound` (those exports are removed in Step 3) and keep the `createPlanDraft` coverage, updating its expected round shape to `{ sourceText, ratings }`.

In `tests/e2e/coaching-training.spec.js`, replace lines 61-63 (`Add movement`, `Movement`, `Movement repetitions`) with:

```js
  await dialog.getByLabel('Round 1 text').fill('8x armada');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/coaching-training-view.test.js tests/unit/training-plan-state.test.js`
Expected: FAIL.

- [ ] **Step 3: Simplify `src/app/training-plan-state.js`**

Replace the file with:

```js
import { sequenceToText } from './training-sequence.js';

function legacyRoundText(round) {
  return (round.movements ?? []).map((movement) => {
    const name = movement.movementName ?? movement.movement_name ?? '';
    const reps = movement.repetitions ?? null;
    return reps ? `${reps}x ${name}` : name;
  }).join(', ');
}

export function roundText(round) {
  if (round.source_text ?? round.sourceText) return round.source_text ?? round.sourceText;
  if (Array.isArray(round.sequence) && round.sequence.length) return sequenceToText(round.sequence);
  return legacyRoundText(round);
}

export function createPlanDraft(value = {}) {
  return {
    id: value.id ?? null,
    versionId: value.versionId ?? null,
    expectedUpdatedAt: value.expectedUpdatedAt ?? null,
    title: value.title ?? '',
    description: value.description ?? '',
    groupId: value.groupId ?? null,
    durationMinutes: value.durationMinutes ?? 60,
    instructions: value.instructions ?? '',
    published: Boolean(value.published),
    rounds: (value.rounds ?? []).map((round) => ({
      sourceText: roundText(round),
      ratings: round.ratings ?? [],
    })),
  };
}

export function serializePlanDraft(draft, rounds) {
  return {
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    durationMinutes: Number(draft.durationMinutes),
    instructions: draft.instructions.trim() || null,
    rounds,
  };
}
```

The view reads only `id`, `versionId`, `expectedUpdatedAt`, `title`, `description`, `durationMinutes`, `instructions`, `published`, and `rounds` from the draft, all of which are kept. The view still adds `groupId: context.groupId` to the serialized payload itself.

- [ ] **Step 4: Change `src/app/ui/coaching-training-view.js`**

1. Replace the `training-plan-state.js` import with `import { createPlanDraft, serializePlanDraft } from '../training-plan-state.js';` and add `import { createRoundDetail } from './round-detail.js';` and `import { createRoundEditor } from './round-editor.js';`.
2. Delete the `MOVEMENTS` constant.
3. Add `getTermMappings = () => [], repertoire = null,` to the destructured options.
4. In `normalizePlan`, replace the `rounds:` mapping with `rounds: plan.rounds ?? [],` (createPlanDraft converts them).
5. Create the editor once, near the other `let` declarations:

```js
  const planRoundEditor = createRoundEditor({ document, i18n, mode: 'plan', getTermMappings, repertoire });
```

6. In `syncEditor`, delete the `rounds:` mapping (round cards keep their own state).
7. In `renderPlanForm`, replace everything from `const rounds = element(document, 'div', { className: 'plan-rounds' });` through `planForm.append(names);` with:

```js
    if (readOnly) {
      const rounds = element(document, 'div', { className: 'plan-rounds' });
      editorState.rounds.forEach((round, index) => {
        rounds.append(createRoundDetail({
          document, i18n, index, editable: false, onSave() {}, getTermMappings,
          round: { id: `plan-round-${index}`, source_text: round.sourceText, sequence: null, ratings: round.ratings, planned: [], movements: [] },
        }));
      });
      planForm.append(rounds);
    } else {
      planForm.append(planRoundEditor.element);
    }
```

and change the actions block so it no longer appends an `add-round` button (the editor has its own **Add round** button). Keep **Save draft** and **Publish plan**.
8. In `openPlanEditor`, after `editorState = …`, add `planRoundEditor.setRounds(editorState.rounds);`.
9. In the `planForm` click handler, delete the branches for `add-round`, `add-plan-movement`, `remove-movement`, `move-round-up`, `move-round-down`, `move-movement-up`, `move-movement-down`. The round editor handles clicks inside its own element; make the handler return early when `event.target.closest('.round-editor')`.
10. In the submit handler, replace `serializePlanDraft(editorState)` with `serializePlanDraft(editorState, planRoundEditor.getRounds())`, and after a successful save set `editorState.rounds = planRoundEditor.getRounds().map((round) => ({ sourceText: round.source_text, ratings: round.ratings }));` before `renderPlanForm()`. Because `renderPlanForm` re-appends the same `planRoundEditor.element`, typed text survives re-renders and failed saves.
11. Pass `getTermMappings, repertoire: repertoireService` to `createCoachingTrainingView(...)` in `src/app/entries/dashboard.js`.

- [ ] **Step 5: Run tests**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/ui/coaching-training-view.js src/app/training-plan-state.js src/app/entries/dashboard.js tests/unit/coaching-training-view.test.js tests/unit/training-plan-state.test.js tests/e2e/coaching-training.spec.js
git commit -m "feat: compose coach plans with text rounds and planned difficulty

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Repertoire tab and one-time browser import

**Files:**
- Create: `src/app/repertoire-import.js`, `src/app/ui/repertoire-view.js`
- Modify: `dashboard.html`, `src/app/dashboard-state.js`, `src/app/ui/dashboard-view.js`, `src/app/entries/dashboard.js`, `src/app/dashboard-i18n.js`
- Test: `tests/unit/repertoire-import.test.js`, `tests/unit/repertoire-view.test.js`, `tests/unit/dashboard-state.test.js`, `tests/e2e/repertoire.spec.js`

**Interfaces:**
- Consumes: `repertoireService` (Task 6), `trainingCalendarController.openAlone(date, { rounds })` (Task 12).
- Produces:
  - `localSequenceItems(storage) → Array<{ import_ref, title, source_text, sequence: null }>` — reads `roda.seqs` (arrays of `{ c, n }`), joins names with `, `, and sets `import_ref` to `local:` + an 8-hex-digit FNV-1a hash of the text.
  - `importLocalRepertoire({ storage, repertoire, userId }) → Promise<{ imported: number, skipped: boolean }>` — sets `roda.seqs.imported:<userId>` to `'1'` only after every batch (≤ 100) succeeds; throws on failure so the next visit retries.
  - `createRepertoireView({ document, i18n, repertoire, onLog }) → { load(), clear() }` rendering into `#trainingRepertoirePanel`. Buttons per item: **"Log"**, **"Rename"**, **"Delete"** (the second click on a **"Confirm delete"** label deletes).
  - Training tabs become `calendar | statistics | repertoire | catalog`; `#trainingCatalogTab` is hidden unless the user is a curator (Task 16 sets visibility).

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/repertoire-import.test.js
import { describe, expect, it, vi } from 'vitest';

import { importLocalRepertoire, localSequenceItems } from '../../src/app/repertoire-import.js';

function storage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), values };
}

const saved = JSON.stringify([
  [{ c: 'golpes', n: 'Armada' }, { c: 'floreios', n: 'Aú' }],
  [{ c: 'golpes', n: 'Armada' }, { c: 'floreios', n: 'Aú' }],
  [{ c: 'esquivas', n: 'Negativa' }],
]);

describe('repertoire import', () => {
  it('converts browser sequences to notation text with stable references', () => {
    const items = localSequenceItems(storage({ 'roda.seqs': saved }));
    expect(items.map(({ source_text: text }) => text)).toEqual(['Armada, Aú', 'Armada, Aú', 'Negativa']);
    expect(items[0].import_ref).toMatch(/^local:[0-9a-f]{8}$/);
    expect(items[0].import_ref).toBe(items[1].import_ref);
    expect(localSequenceItems(storage({ 'roda.seqs': 'not json' }))).toEqual([]);
  });

  it('imports once per user and retries after a failure', async () => {
    const local = storage({ 'roda.seqs': saved });
    const repertoire = { importItems: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ imported: 2 }) };
    await expect(importLocalRepertoire({ storage: local, repertoire, userId: 'u1' })).rejects.toThrow('offline');
    expect(local.values.get('roda.seqs.imported:u1')).toBeUndefined();
    expect(await importLocalRepertoire({ storage: local, repertoire, userId: 'u1' })).toEqual({ imported: 2, skipped: false });
    expect(await importLocalRepertoire({ storage: local, repertoire, userId: 'u1' })).toEqual({ imported: 0, skipped: true });
    expect(repertoire.importItems).toHaveBeenCalledTimes(2);
    expect(local.values.get('roda.seqs')).toBe(saved);
  });

  it('marks users with nothing to import as done', async () => {
    const local = storage();
    const repertoire = { importItems: vi.fn() };
    expect(await importLocalRepertoire({ storage: local, repertoire, userId: 'u2' })).toEqual({ imported: 0, skipped: false });
    expect(repertoire.importItems).not.toHaveBeenCalled();
  });
});
```

```js
// tests/unit/repertoire-view.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { createRepertoireView } from '../../src/app/ui/repertoire-view.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

describe('repertoire view', () => {
  beforeEach(() => { document.body.innerHTML = '<section id="trainingRepertoirePanel"></section>'; });

  it('lists, logs, renames, and deletes sequences', async () => {
    const repertoire = {
      list: vi.fn().mockResolvedValue([{ id: 's1', title: 'Flow', source_text: 'armada, <b>au</b>' }]),
      save: vi.fn().mockResolvedValue({ status: 'saved' }),
      remove: vi.fn().mockResolvedValue({ status: 'deleted' }),
    };
    const onLog = vi.fn();
    const view = createRepertoireView({ document, i18n, repertoire, onLog });
    await view.load();
    const panel = document.querySelector('#trainingRepertoirePanel');
    expect(panel.querySelector('.repertoire-text').textContent).toBe('armada, <b>au</b>');
    expect(panel.querySelector('b')).toBeNull();
    panel.querySelector('button[data-action="log"]').click();
    expect(onLog).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
    panel.querySelector('button[data-action="rename"]').click();
    panel.querySelector('input[name="title"]').value = 'Renamed';
    panel.querySelector('form[data-rename]').requestSubmit();
    await vi.waitFor(() => expect(repertoire.save).toHaveBeenCalledWith({
      id: 's1', title: 'Renamed', sourceText: 'armada, <b>au</b>', sequence: null,
    }));
    const remove = panel.querySelector('button[data-action="delete"]');
    remove.click();
    expect(repertoire.remove).not.toHaveBeenCalled();
    expect(panel.querySelector('button[data-action="delete"]').textContent).toBe('Confirm delete');
    panel.querySelector('button[data-action="delete"]').click();
    await vi.waitFor(() => expect(repertoire.remove).toHaveBeenCalledWith('s1'));
  });

  it('explains how to add the first sequence', async () => {
    const view = createRepertoireView({ document, i18n, repertoire: { list: vi.fn().mockResolvedValue([]) }, onLog() {} });
    await view.load();
    expect(document.querySelector('#trainingRepertoirePanel').textContent)
      .toContain('Save a round as a sequence');
  });
});
```

Add to `tests/unit/dashboard-state.test.js`:

```js
  it('accepts repertoire and catalog tabs in My Training', () => {
    let state = createDashboardState();
    state = reduceDashboardState(state, { type: 'TAB_CHOSEN', mode: 'training', tab: 'repertoire' });
    expect(dashboardView(state).activeTab).toBe('repertoire');
    state = reduceDashboardState(state, { type: 'TAB_CHOSEN', mode: 'training', tab: 'catalog' });
    expect(dashboardView(state).activeTab).toBe('catalog');
  });
```

(Import `dashboardView` alongside the existing imports if not already imported.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/repertoire-import.test.js tests/unit/repertoire-view.test.js tests/unit/dashboard-state.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement the import**

```js
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
```

- [ ] **Step 4: Implement the view**

```js
// src/app/ui/repertoire-view.js
export function createRepertoireView({ document, i18n, repertoire, onLog }) {
  const panel = document.querySelector('#trainingRepertoirePanel');
  let items = [];
  let renaming = null;
  let confirming = null;
  let loadToken = 0;

  function button(text, action, id) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'secondary-button';
    node.textContent = text;
    node.dataset.action = action;
    node.dataset.id = id;
    return node;
  }

  function render(message = '') {
    panel.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = i18n.t('repertoire.title');
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = message;
    panel.append(heading, status);
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'calendar-empty';
      empty.textContent = i18n.t('repertoire.empty');
      panel.append(empty);
      return;
    }
    const list = document.createElement('div');
    list.className = 'repertoire-list';
    for (const item of items) {
      const card = document.createElement('article');
      card.className = 'repertoire-card';
      card.dataset.sequenceId = item.id;
      if (renaming === item.id) {
        const form = document.createElement('form');
        form.dataset.rename = item.id;
        const label = document.createElement('label');
        label.textContent = i18n.t('repertoire.titleLabel');
        const input = document.createElement('input');
        input.name = 'title';
        input.className = 'field-input';
        input.maxLength = 120;
        input.value = item.title;
        label.append(input);
        const save = document.createElement('button');
        save.type = 'submit';
        save.className = 'secondary-button';
        save.textContent = i18n.t('repertoire.saveTitle');
        form.append(label, save);
        card.append(form);
      } else {
        const title = document.createElement('h3');
        title.textContent = item.title;
        card.append(title);
      }
      const text = document.createElement('p');
      text.className = 'repertoire-text';
      text.textContent = item.source_text;
      const actions = document.createElement('div');
      actions.className = 'dashboard-actions';
      actions.append(
        button(i18n.t('repertoire.log'), 'log', item.id),
        button(i18n.t('repertoire.rename'), 'rename', item.id),
        button(i18n.t(confirming === item.id ? 'repertoire.confirmDelete' : 'repertoire.delete'), 'delete', item.id),
      );
      card.append(text, actions);
      list.append(card);
    }
    panel.append(list);
  }

  async function load(message = '') {
    const token = ++loadToken;
    try {
      const next = await repertoire.list();
      if (token !== loadToken) return;
      items = next;
      render(message);
    } catch (error) {
      if (token === loadToken) render(error?.message || i18n.t('repertoire.loadError'));
    }
  }

  panel.addEventListener('click', async (event) => {
    const target = event.target.closest('button[data-action]');
    if (!target || target.type === 'submit') return;
    const item = items.find(({ id }) => id === target.dataset.id);
    if (!item) return;
    if (target.dataset.action === 'log') onLog(item);
    if (target.dataset.action === 'rename') { renaming = item.id; confirming = null; render(); }
    if (target.dataset.action === 'delete') {
      if (confirming !== item.id) { confirming = item.id; render(); return; }
      confirming = null;
      try {
        await repertoire.remove(item.id);
        await load(i18n.t('repertoire.deleted'));
      } catch (error) {
        render(error?.message || i18n.t('repertoire.saveError'));
      }
    }
  });

  panel.addEventListener('submit', async (event) => {
    const form = event.target.closest('form[data-rename]');
    if (!form) return;
    event.preventDefault();
    const item = items.find(({ id }) => id === form.dataset.rename);
    try {
      await repertoire.save({ id: item.id, title: form.elements.title.value, sourceText: item.source_text, sequence: item.sequence ?? null });
      renaming = null;
      await load(i18n.t('repertoire.renamed'));
    } catch (error) {
      render(error?.message || i18n.t('repertoire.saveError'));
    }
  });

  return {
    load,
    clear() {
      loadToken += 1;
      items = [];
      panel.replaceChildren();
    },
  };
}
```

- [ ] **Step 5: Add i18n keys**

`en`:

```js
    'dashboard.repertoire': 'Repertoire',
    'dashboard.catalog': 'Catalog',
    'repertoire.title': 'Your repertoire',
    'repertoire.empty': 'Save a round as a sequence, or build one on the public Sequences page, and it will appear here.',
    'repertoire.log': 'Log',
    'repertoire.rename': 'Rename',
    'repertoire.delete': 'Delete',
    'repertoire.confirmDelete': 'Confirm delete',
    'repertoire.titleLabel': 'Sequence title',
    'repertoire.saveTitle': 'Save title',
    'repertoire.renamed': 'Sequence renamed.',
    'repertoire.deleted': 'Sequence deleted.',
    'repertoire.loadError': "We couldn't load your repertoire. Please try again.",
    'repertoire.saveError': "We couldn't update this sequence. Please try again.",
```

`pt`:

```js
    'dashboard.repertoire': 'Repertório',
    'dashboard.catalog': 'Catálogo',
    'repertoire.title': 'O teu repertório',
    'repertoire.empty': 'Guarda uma ronda como sequência, ou cria uma na página pública de Sequências, e ela aparece aqui.',
    'repertoire.log': 'Registar',
    'repertoire.rename': 'Mudar nome',
    'repertoire.delete': 'Apagar',
    'repertoire.confirmDelete': 'Confirmar',
    'repertoire.titleLabel': 'Título da sequência',
    'repertoire.saveTitle': 'Guardar título',
    'repertoire.renamed': 'Nome alterado.',
    'repertoire.deleted': 'Sequência apagada.',
    'repertoire.loadError': 'Não foi possível carregar o repertório. Tenta novamente.',
    'repertoire.saveError': 'Não foi possível atualizar esta sequência. Tenta novamente.',
```

- [ ] **Step 6: Add the tabs**

In `dashboard.html`, inside `#trainingTabs` after the Statistics tab:

```html
          <button id="trainingRepertoireTab" type="button" role="tab" data-dashboard-tab="repertoire" aria-controls="trainingRepertoirePanel" aria-selected="false">Repertoire</button>
          <button id="trainingCatalogTab" type="button" role="tab" data-dashboard-tab="catalog" aria-controls="trainingCatalogPanel" aria-selected="false" hidden>Catalog</button>
```

and after `#trainingStatisticsPanel`:

```html
        <section id="trainingRepertoirePanel" role="tabpanel" aria-labelledby="trainingRepertoireTab" hidden></section>
        <section id="trainingCatalogPanel" role="tabpanel" aria-labelledby="trainingCatalogTab" hidden></section>
```

In `src/app/dashboard-state.js` change the training allow-list to `['calendar', 'statistics', 'repertoire', 'catalog']`.

In `src/app/ui/dashboard-view.js`, next to the existing `#trainingStatisticsTab` copy line add:

```js
    document.querySelector('#trainingRepertoireTab').textContent = i18n.t('dashboard.repertoire');
    document.querySelector('#trainingCatalogTab').textContent = i18n.t('dashboard.catalog');
```

and extend the panel map:

```js
      panel.hidden = panel.id !== {
        calendar: 'trainingCalendarPanel',
        statistics: 'trainingStatisticsPanel',
        repertoire: 'trainingRepertoirePanel',
        catalog: 'trainingCatalogPanel',
      }[view.activeTab];
```

- [ ] **Step 7: Wire the entry**

In `src/app/entries/dashboard.js`:

```js
import { importLocalRepertoire } from '../repertoire-import.js';
import { createRepertoireView } from '../ui/repertoire-view.js';
```

Declare `let repertoireController;`. In `createControllers`, after `trainingCalendarController` is created:

```js
    repertoireController = createRepertoireView({
      document, i18n, repertoire: repertoireService,
      onLog: (item) => trainingCalendarController.openAlone(undefined, {
        rounds: [{ sourceText: item.source_text }],
      }),
    });
```

Declare `let repertoireImport = Promise.resolve();` next to the other `let` declarations. In `onContextChange` add:

```js
        if (mode === 'training' && activeTab === 'repertoire') {
          repertoireImport.then(() => repertoireController.load());
        }
```

In `onSignOut` add `repertoireController.clear();`. In `initialize()`, immediately after `createControllers(startup.coachProfile);` and before `dashboard.load(...)`:

```js
      repertoireImport = importLocalRepertoire({
        storage: localStorage, repertoire: repertoireService, userId: session.user.id,
      }).catch(() => {});
```

Waiting on `repertoireImport` keeps the first Repertoire view from rendering before the browser import finishes.

- [ ] **Step 8: Write the browser test**

```js
// tests/e2e/repertoire.spec.js
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1', email: 'ana@example.com' } }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify({
      id: 'practitioner-1', display_name: 'Ana Silva', avatar_path: null,
      timezone_override: 'Europe/Lisbon', leaderboard_visible: true, completed_at: '2026-09-11T20:00:00Z',
    }));
    localStorage.setItem('roda.seqs', JSON.stringify([[{ c: 'golpes', n: 'Armada' }, { c: 'floreios', n: 'Aú' }]]));
  });
});

test('imports browser sequences once and logs one as training', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('tab', { name: 'Repertoire' }).click();
  await expect(page.locator('#trainingRepertoirePanel .repertoire-text')).toHaveText(['Armada, Aú']);
  await page.reload();
  await page.getByRole('tab', { name: 'Repertoire' }).click();
  await expect(page.locator('#trainingRepertoirePanel .repertoire-text')).toHaveCount(1);

  await page.getByRole('button', { name: 'Log' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record Alone training' });
  await expect(dialog.getByLabel('Round 1 text')).toHaveValue('Armada, Aú');
  await dialog.getByLabel('Training date').fill('2026-09-24');
  await dialog.getByRole('button', { name: 'Save training' }).click();
  await expect(dialog).toBeHidden();
});

test('saves a round as a sequence from Record training', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Record Alone training' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record Alone training' });
  await dialog.getByLabel('Round 1 text').fill('10x (ginga, armada)');
  await dialog.getByRole('button', { name: 'Save as sequence' }).click();
  await expect(dialog.getByText('Saved to your repertoire.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close Alone training' }).click();
  await page.getByRole('tab', { name: 'Repertoire' }).click();
  await expect(page.locator('#trainingRepertoirePanel .repertoire-text')).toContainText(['10x (ginga, armada)']);
});
```

- [ ] **Step 9: Run tests**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/app/repertoire-import.js src/app/ui/repertoire-view.js dashboard.html src/app/dashboard-state.js src/app/ui/dashboard-view.js src/app/entries/dashboard.js src/app/dashboard-i18n.js tests/unit/repertoire-import.test.js tests/unit/repertoire-view.test.js tests/unit/dashboard-state.test.js tests/e2e/repertoire.spec.js
git commit -m "feat: add repertoire tab and import browser sequences once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Public Sequences page uses the account repertoire

**Files:**
- Create: `src/app/entries/public-sequences.js`
- Modify: `scripts/build.mjs`, `index.html` (Sequences script block and one script tag only)
- Test: `tests/e2e/public-sequences.spec.js`, `tests/unit/build-config.test.js`

**Interfaces:**
- Consumes: auth service (`getSession`, `onAuthStateChange`), repertoire service, `importLocalRepertoire`.
- Produces: `window.rodaRepertoire = { isSignedIn(): boolean, list(): Promise<item[]>, save(sourceText): Promise, remove(id): Promise }`, plus a `roda:repertoire-ready` event on `window` whenever the session changes.

- [ ] **Step 1: Write the failing browser test**

```js
// tests/e2e/public-sequences.spec.js
import { expect, test } from '@playwright/test';

async function openBuilder(page) {
  await page.goto('/#sequences');
  // A hash-only navigation does not reload; reload so the bundles see the seeded storage.
  await page.reload();
  await page.getByRole('tab', { name: 'Build your own' }).click();
}

test('signed-out sequences stay in the browser', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await openBuilder(page);
  await page.locator('#seqPickerGrid .pick[title="Armada"]').click();
  await page.locator('#seqPickerGrid .pick[title="Aú"]').click();
  await page.getByRole('button', { name: 'Save to repertoire' }).click();
  await expect(page.locator('#seqSaved .seqtxt')).toHaveText(['Armada → Aú']);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('roda.seqs')).length)).toBe(1);
});

test('signed-in sequences import once and save to the account', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1', email: 'ana@example.com' } }));
    localStorage.setItem('roda.seqs', JSON.stringify([[{ c: 'esquivas', n: 'Negativa' }]]));
  });
  await openBuilder(page);
  await expect(page.locator('#seqSaved .seqtxt')).toHaveText(['Negativa']);
  await page.locator('#seqPickerGrid .pick[title="Armada"]').click();
  await page.getByRole('button', { name: 'Save to repertoire' }).click();
  await expect(page.locator('#seqSaved .seqtxt')).toHaveText(['Armada', 'Negativa']);
  const accountTexts = await page.evaluate(() => JSON.parse(localStorage.getItem('roda.e2e.repertoireState'))
    .items.map(({ source_text: text }) => text).sort());
  expect(accountTexts).toEqual(['Armada', 'Negativa']);
  await page.locator('#seqSaved [data-load]').first().click();
  await expect(page.locator('#seqStrip .seq-step')).toHaveCount(1);
});

test('account sequence text is rendered as text', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1', email: 'ana@example.com' } }));
    localStorage.setItem('roda.e2e.repertoireState', JSON.stringify({ counter: 1, items: [{
      id: 'sequence-1', profile_id: 'practitioner-1', import_ref: null, title: 'x',
      source_text: '<img src=x onerror="window.__xss=1">', sequence: null, updated_at: '2026-10-10T12:00:00Z',
    }] }));
  });
  await openBuilder(page);
  await expect(page.locator('#seqSaved .seqtxt')).toHaveText(['<img src=x onerror="window.__xss=1">']);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});
```

The signed-in list shows account text verbatim (`Armada`), while the signed-out list keeps today's `Armada → Aú` rendering of browser entries.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:e2e -- tests/e2e/public-sequences.spec.js`
Expected: the signed-out test PASSES (existing behavior); the signed-in tests FAIL.

- [ ] **Step 3: Write the entry**

```js
// src/app/entries/public-sequences.js
import { createAuthService } from '../auth-service.js';
import { publicConfig } from '../config.js';
import { importLocalRepertoire } from '../repertoire-import.js';
import { createRepertoireService } from '../repertoire-service.js';
import { createRodaClient } from '../supabase-client.js';
import { createE2EAuthService, createE2ERepertoireService } from '../testing/fake-services.js';

function main() {
  const client = __RODA_E2E__ ? null : createRodaClient(publicConfig);
  const authService = __RODA_E2E__
    ? createE2EAuthService({ window })
    : createAuthService({ client, origin: location.origin, storage: localStorage });
  const repertoire = __RODA_E2E__
    ? createE2ERepertoireService({ window })
    : createRepertoireService(client);
  let session = null;

  window.rodaRepertoire = {
    isSignedIn: () => Boolean(session),
    list: () => repertoire.list(),
    save: (sourceText) => repertoire.save({ title: '', sourceText, sequence: null }),
    remove: (id) => repertoire.remove(id),
  };

  async function applySession(nextSession) {
    session = nextSession;
    if (session) {
      try {
        await importLocalRepertoire({ storage: localStorage, repertoire, userId: session.user.id });
      } catch {
        // The browser copy stays; the import retries on the next visit.
      }
    }
    window.dispatchEvent(new Event('roda:repertoire-ready'));
  }

  authService.getSession().then(applySession).catch(() => applySession(null));
  authService.onAuthStateChange((_event, nextSession) => { applySession(nextSession); });
}

main();
```

In `scripts/build.mjs` add `'public-sequences': 'src/app/entries/public-sequences.js',` to `entryPoints`. If `tests/unit/build-config.test.js` asserts the entry list, add `public-sequences` there.

- [ ] **Step 4: Change the Sequences script in `index.html`**

Add next to the existing `<script type="module" src="assets/generated/public-auth.js"></script>`:

```html
<script type="module" src="assets/generated/public-sequences.js"></script>
```

In the `/* build-your-own */` block, replace `renderSeqSaved` with:

```js
function seqAccount(){ return (window.rodaRepertoire && window.rodaRepertoire.isSignedIn()) ? window.rodaRepertoire : null; }
let seqSavedRows=[];
async function seqSavedList(){
  const acct=seqAccount();
  if(acct){ try{ return (await acct.list()).map(item=>({id:item.id, text:item.source_text, names:item.source_text.split(/\s*,\s*/)})); }catch(e){} }
  return seqLoadSaved().map((rec,i)=>({id:'local:'+i, text:rec.map(s=>s.n).join(' → '), names:rec.map(s=>s.n), rec}));
}
async function renderSeqSaved(){
  const wrap=document.getElementById('seqSavedWrap'), list=document.getElementById('seqSaved'); if(!list) return;
  seqSavedRows=await seqSavedList();
  if(wrap) wrap.hidden=!seqSavedRows.length;
  const loadLbl=(STR[LANG]&&STR[LANG].seqLoad)||'Load', delLbl=(STR[LANG]&&STR[LANG].seqDelete)||'Delete';
  list.replaceChildren(...seqSavedRows.map((row,i)=>{
    const div=document.createElement('div'); div.className='saved-row';
    const txt=document.createElement('span'); txt.className='seqtxt'; txt.textContent=row.text;
    const load=document.createElement('button'); load.type='button'; load.dataset.load=String(i); load.textContent=loadLbl;
    const del=document.createElement('button'); del.type='button'; del.dataset.del=String(i); del.textContent=delLbl;
    div.append(txt,load,del); return div;
  }));
}
function seqFindByName(name){
  const key=String(name).trim().toLowerCase();
  return flat.find(f=>f.move.n.toLowerCase()===key) || null;
}
window.addEventListener('roda:repertoire-ready', renderSeqSaved);
```

In `wireSequences`, replace the save handler body with:

```js
  if(sv)   sv.addEventListener('click',async ()=>{
    if(!seqState.length) return;
    const acct=seqAccount();
    if(acct){ try{ await acct.save(seqState.map(f=>f.move.n).join(', ')); }catch(e){} }
    else { const saved=seqLoadSaved(); saved.unshift(seqState.map(f=>({c:f.catId,n:f.move.n}))); seqPersist(saved); }
    renderSeqSaved();
  });
```

and replace the saved-list click handler with:

```js
  if(savedList) savedList.addEventListener('click',async e=>{
    const lb=e.target.closest('[data-load]'), db=e.target.closest('[data-del]');
    if(lb){
      const row=seqSavedRows[+lb.dataset.load];
      if(row){ seqState.length=0;
        if(row.rec) row.rec.forEach(s=>{ const m=seqFindMove(s.c,s.n); if(m) seqState.push({move:m,catId:s.c}); });
        else row.names.forEach(n=>{ const f=seqFindByName(n); if(f) seqState.push(f); });
        const bt=document.querySelector('.seq-tab[data-seq="build"]'); if(bt) bt.click();
        seqRenderStrip(); window.scrollTo(0,0); }
    }
    if(db){
      const row=seqSavedRows[+db.dataset.del];
      const acct=seqAccount();
      if(row && acct && !row.rec){ try{ await acct.remove(row.id); }catch(e){} }
      else if(row && row.rec){ const a=seqLoadSaved(); a.splice(+row.id.slice(6),1); seqPersist(a); }
      renderSeqSaved();
    }
  });
```

Keep every other line of the Sequences code unchanged. Do not touch anything outside `#sequencesView`, the Sequences script block, and the added script tag.

- [ ] **Step 5: Run tests**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/entries/public-sequences.js scripts/build.mjs index.html tests/e2e/public-sequences.spec.js tests/unit/build-config.test.js
git commit -m "feat: save public sequences to the signed-in account

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Curator Catalog tab

**Files:**
- Create: `src/app/ui/catalog-view.js`
- Modify: `src/app/entries/dashboard.js`, `src/app/dashboard-i18n.js`
- Test: `tests/unit/catalog-view.test.js`, `tests/e2e/catalog-curation.spec.js`

**Interfaces:**
- Consumes: `catalogService` (Task 7), `listMoves()` (Task 1).
- Produces: `createCatalogView({ document, i18n, catalog, onMappingsChanged }) → { load(), clear() }` rendering into `#trainingCatalogPanel`. One `<tr data-term>` per term with: a **"Map {term} to move"** `<select>` plus **"Map"** button, a **"Merge {term} into"** text input plus **"Merge"** button, a **"Not a move"** button, and a **"Needs video"** checkbox. The entry refreshes parser term mappings after each action and shows the tab only when `amICurator()` resolves `true`.

- [ ] **Step 1: Write the failing unit test**

```js
// tests/unit/catalog-view.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { createCatalogView } from '../../src/app/ui/catalog-view.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

function catalog() {
  return {
    listUncataloguedTerms: vi.fn().mockResolvedValue([{
      term: 'galopanti', spelling: 'Galopanti', people: 2, uses: 3,
      first_seen: '2026-09-11T10:00:00Z', last_seen: '2026-10-02T10:00:00Z', needs_video: false,
    }]),
    mapTerm: vi.fn().mockResolvedValue({ status: 'saved', relinked: 3 }),
    mergeTerm: vi.fn().mockResolvedValue({ status: 'saved', relinked: 3 }),
    ignoreTerm: vi.fn().mockResolvedValue({ status: 'saved' }),
    setNeedsVideo: vi.fn().mockResolvedValue({ status: 'saved' }),
  };
}

describe('catalog view', () => {
  beforeEach(() => { document.body.innerHTML = '<section id="trainingCatalogPanel"></section>'; });

  it('shows aggregates only and maps, merges, ignores, and tags terms', async () => {
    const service = catalog();
    const onMappingsChanged = vi.fn();
    const view = createCatalogView({ document, i18n, catalog: service, onMappingsChanged });
    await view.load();
    const row = document.querySelector('[data-term="galopanti"]');
    expect(row.textContent).toContain('Galopanti');
    expect(row.querySelector('[data-people]').textContent).toBe('2');
    expect(row.querySelector('[data-uses]').textContent).toBe('3');

    row.querySelector('select[aria-label="Map galopanti to move"]').value = 'galopante';
    row.querySelector('button[data-action="map"]').click();
    await vi.waitFor(() => expect(service.mapTerm).toHaveBeenCalledWith('galopanti', 'galopante'));
    await vi.waitFor(() => expect(onMappingsChanged).toHaveBeenCalled());

    const fresh = () => document.querySelector('[data-term="galopanti"]');
    fresh().querySelector('input[aria-label="Merge galopanti into"]').value = 'Galopante Alto';
    fresh().querySelector('button[data-action="merge"]').click();
    await vi.waitFor(() => expect(service.mergeTerm).toHaveBeenCalledWith('galopanti', 'galopante-alto'));
    fresh().querySelector('button[data-action="ignore"]').click();
    await vi.waitFor(() => expect(service.ignoreTerm).toHaveBeenCalledWith('galopanti'));
    fresh().querySelector('input[data-action="needs-video"]').click();
    await vi.waitFor(() => expect(service.setNeedsVideo).toHaveBeenCalledWith('galopanti', true));
  });

  it('explains an empty list', async () => {
    const service = catalog();
    service.listUncataloguedTerms.mockResolvedValue([]);
    await createCatalogView({ document, i18n, catalog: service, onMappingsChanged() {} }).load();
    expect(document.querySelector('#trainingCatalogPanel').textContent).toContain('Every written move matches the catalog.');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/catalog-view.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Add i18n keys**

`en`:

```js
    'catalog.title': 'Uncatalogued moves',
    'catalog.intro': 'Words people wrote that do not match a catalog move. Only totals are shown.',
    'catalog.empty': 'Every written move matches the catalog.',
    'catalog.term': 'Term',
    'catalog.spelling': 'Most common spelling',
    'catalog.people': 'People',
    'catalog.uses': 'Uses',
    'catalog.seen': 'First / last seen',
    'catalog.actions': 'Actions',
    'catalog.mapTo': 'Map {term} to move',
    'catalog.map': 'Map',
    'catalog.mergeInto': 'Merge {term} into',
    'catalog.merge': 'Merge',
    'catalog.ignore': 'Not a move',
    'catalog.needsVideo': 'Needs video',
    'catalog.saved': 'Catalog updated.',
    'catalog.loadError': "We couldn't load uncatalogued moves. Please try again.",
```

`pt`:

```js
    'catalog.title': 'Movimentos fora do catálogo',
    'catalog.intro': 'Palavras escritas que não correspondem a um movimento do catálogo. Só são mostrados totais.',
    'catalog.empty': 'Todos os movimentos escritos correspondem ao catálogo.',
    'catalog.term': 'Termo',
    'catalog.spelling': 'Grafia mais comum',
    'catalog.people': 'Pessoas',
    'catalog.uses': 'Usos',
    'catalog.seen': 'Primeira / última vez',
    'catalog.actions': 'Ações',
    'catalog.mapTo': 'Associar {term} a um movimento',
    'catalog.map': 'Associar',
    'catalog.mergeInto': 'Juntar {term} a',
    'catalog.merge': 'Juntar',
    'catalog.ignore': 'Não é um movimento',
    'catalog.needsVideo': 'Precisa de vídeo',
    'catalog.saved': 'Catálogo atualizado.',
    'catalog.loadError': 'Não foi possível carregar os movimentos fora do catálogo. Tenta novamente.',
```

- [ ] **Step 4: Implement the view**

```js
// src/app/ui/catalog-view.js
import { listMoves, slugify } from '../movement-catalog.js';

export function createCatalogView({ document, i18n, catalog, onMappingsChanged }) {
  const panel = document.querySelector('#trainingCatalogPanel');
  let terms = [];
  let token = 0;

  function cell(tag, text, dataName) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (dataName) node.dataset[dataName] = '';
    return node;
  }

  function actionButton(text, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-button';
    button.textContent = text;
    button.dataset.action = action;
    return button;
  }

  function render(message = '') {
    panel.replaceChildren(cell('h2', i18n.t('catalog.title')), cell('p', i18n.t('catalog.intro')));
    const status = cell('p', message);
    status.setAttribute('role', 'status');
    panel.append(status);
    if (!terms.length) {
      const empty = cell('p', i18n.t('catalog.empty'));
      empty.className = 'calendar-empty';
      panel.append(empty);
      return;
    }
    const table = document.createElement('table');
    table.className = 'catalog-table';
    const head = document.createElement('tr');
    for (const key of ['catalog.term', 'catalog.spelling', 'catalog.people', 'catalog.uses', 'catalog.seen', 'catalog.actions']) {
      head.append(cell('th', i18n.t(key)));
    }
    table.append(head);
    for (const term of terms) {
      const row = document.createElement('tr');
      row.dataset.term = term.term;
      const seen = [term.first_seen, term.last_seen].map((value) => (value ? i18n.formatDate(value) : '—')).join(' / ');
      row.append(
        cell('td', term.term), cell('td', term.spelling),
        cell('td', String(term.people), 'people'), cell('td', String(term.uses), 'uses'),
        cell('td', seen),
      );
      const actions = document.createElement('td');
      const select = document.createElement('select');
      select.className = 'field-input';
      select.setAttribute('aria-label', i18n.t('catalog.mapTo', { term: term.term }));
      for (const move of listMoves()) {
        const option = document.createElement('option');
        option.value = move.slug;
        option.textContent = move.name;
        select.append(option);
      }
      const merge = document.createElement('input');
      merge.className = 'field-input';
      merge.setAttribute('aria-label', i18n.t('catalog.mergeInto', { term: term.term }));
      const needsVideo = document.createElement('input');
      needsVideo.type = 'checkbox';
      needsVideo.checked = Boolean(term.needs_video);
      needsVideo.dataset.action = 'needs-video';
      const videoLabel = document.createElement('label');
      videoLabel.append(needsVideo, ` ${i18n.t('catalog.needsVideo')}`);
      actions.append(
        select, actionButton(i18n.t('catalog.map'), 'map'),
        merge, actionButton(i18n.t('catalog.merge'), 'merge'),
        actionButton(i18n.t('catalog.ignore'), 'ignore'), videoLabel,
      );
      row.append(actions);
      table.append(row);
    }
    panel.append(table);
  }

  async function load(message = '') {
    const current = ++token;
    try {
      const next = await catalog.listUncataloguedTerms();
      if (current !== token) return;
      terms = next;
      render(message);
    } catch (error) {
      if (current === token) render(error?.message || i18n.t('catalog.loadError'));
    }
  }

  async function act(run) {
    try {
      await run();
      await onMappingsChanged();
      await load(i18n.t('catalog.saved'));
    } catch (error) {
      render(error?.message || i18n.t('catalog.loadError'));
    }
  }

  panel.addEventListener('click', (event) => {
    const control = event.target.closest('[data-action]');
    const row = event.target.closest('[data-term]');
    if (!control || !row) return;
    const term = row.dataset.term;
    if (control.dataset.action === 'map') act(() => catalog.mapTerm(term, row.querySelector('select').value));
    if (control.dataset.action === 'merge') {
      const target = slugify(row.querySelector('input:not([type])').value);
      if (target) act(() => catalog.mergeTerm(term, target));
    }
    if (control.dataset.action === 'ignore') act(() => catalog.ignoreTerm(term));
    if (control.dataset.action === 'needs-video') act(() => catalog.setNeedsVideo(term, control.checked));
  });

  return {
    load,
    clear() {
      token += 1;
      terms = [];
      panel.replaceChildren();
    },
  };
}
```

- [ ] **Step 5: Wire the entry**

In `src/app/entries/dashboard.js`, import `createCatalogView`, declare `let catalogController;`, and replace the one-off `listTermMappings()` call from Task 12 with:

```js
  async function refreshTermMappings() {
    try { termMappings = await catalogService.listTermMappings(); } catch { /* keep previous mappings */ }
  }
  refreshTermMappings();
```

In `createControllers`:

```js
    catalogController = createCatalogView({
      document, i18n, catalog: catalogService, onMappingsChanged: refreshTermMappings,
    });
```

In `onContextChange` add `if (mode === 'training' && activeTab === 'catalog') catalogController.load();`, in `onSignOut` add `catalogController.clear();`, and in `initialize()` after `initialized = true;`:

```js
      catalogService.amICurator()
        .then((curator) => { document.querySelector('#trainingCatalogTab').hidden = !curator; })
        .catch(() => {});
```

- [ ] **Step 6: Write the browser test**

```js
// tests/e2e/catalog-curation.spec.js
import { expect, test } from '@playwright/test';

async function seed(page, curator) {
  await page.goto('/');
  await page.evaluate((isCurator) => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1', email: 'ana@example.com' } }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify({
      id: 'practitioner-1', display_name: 'Ana Silva', avatar_path: null,
      timezone_override: 'Europe/Lisbon', leaderboard_visible: true, completed_at: '2026-09-11T20:00:00Z',
    }));
    if (isCurator) localStorage.setItem('roda.e2e.catalogCurator', 'true');
  }, curator);
}

async function recordGalopanti(page) {
  await page.getByRole('button', { name: 'Record Alone training' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record Alone training' });
  await dialog.getByLabel('Training date').fill('2026-10-02');
  await dialog.getByLabel('Round 1 text').fill('galopanti, armada');
  await dialog.getByRole('button', { name: 'Save training' }).click();
  await expect(dialog).toBeHidden();
}

test('hides the Catalog tab from non-curators', async ({ page }) => {
  await seed(page, false);
  await page.goto('/dashboard');
  await expect(page.getByRole('tab', { name: 'Calendar' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Catalog' })).toBeHidden();
});

test('a curator maps a term and the parser recognizes it next time', async ({ page }) => {
  await seed(page, true);
  await page.goto('/dashboard');
  await recordGalopanti(page);
  await page.getByRole('tab', { name: 'Catalog' }).click();
  const row = page.locator('[data-term="galopanti"]');
  await expect(row.locator('[data-people]')).toHaveText('1');
  await row.getByLabel('Map galopanti to move').selectOption('galopante');
  await row.getByRole('button', { name: 'Map' }).click();
  await expect(page.getByText('Every written move matches the catalog.')).toBeVisible();

  await page.getByRole('tab', { name: 'Calendar' }).click();
  await page.getByRole('button', { name: 'Record Alone training' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record Alone training' });
  await dialog.getByLabel('Round 1 text').fill('galopanti');
  await expect(dialog.locator('[data-chip="1"]')).toHaveAttribute('data-status', 'known');
});
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/ui/catalog-view.js src/app/entries/dashboard.js src/app/dashboard-i18n.js tests/unit/catalog-view.test.js tests/e2e/catalog-curation.spec.js
git commit -m "feat: add curator catalog tab for uncatalogued moves

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Class resources in the calendar

**Files:**
- Create: `src/app/markdown-lite.js`, `src/app/ui/resource-view.js`
- Modify: `src/app/ui/training-calendar-view.js`, `src/app/dashboard-i18n.js`, `assets/training-calendar.css`
- Test: `tests/unit/markdown-lite.test.js`, `tests/unit/resource-view.test.js`, `tests/unit/training-calendar-view.test.js`, `tests/e2e/training-resources.spec.js`

**Interfaces:**
- Consumes: `trainingService.addResource/updateResource/deleteResource/listResourceKinds` (Task 8); day entries carry `occurrence_id`, `resources`, `can_add_resources`.
- Produces:
  - `renderMarkdown(document, text) → DocumentFragment` — headings (`#`–`###`), paragraphs, `-`/`*` and `1.` lists, `**bold**`, `*italic*`/`_italic_`, `` `code` ``, `[text](https://…)` links with `rel="noopener noreferrer"` and `target="_blank"`. Everything else is text; no element is created from raw HTML.
  - `RESOURCE_ICONS = { video: '🎥', voice: '🎙️', summary: '📄' }`.
  - `resourceIcons(document, i18n, kinds) → HTMLElement` (`span.resource-icons`, `aria-label` like `"Video, Summary"`).
  - `createResourceSection({ document, i18n, item, service, onChanged }) → HTMLElement` with `data-resources=<occurrence_id>`. When `item.can_add_resources`, it shows **"Add resources"** opening a form with **"Resource type"** select (`Video link`, `Voice transcript`, `Summary`), **"Title"**, **"Link"**, **"Text"**, a file input labelled **"Text files (.txt, .md)"** accepting multiple files, and **"Save resources"**. Resources whose `can_edit` is true get **"Delete {title}"** buttons.

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/markdown-lite.test.js
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { renderMarkdown } from '../../src/app/markdown-lite.js';

function html(text) {
  const root = document.createElement('div');
  root.append(renderMarkdown(document, text));
  return root;
}

describe('markdown lite', () => {
  it('renders the supported subset', () => {
    const root = html('# Class 1\n\nWarm-up with **ginga** and *negativa*.\n\n- armada\n- `au`\n\n1. first\n2. second\n\nSee [video](https://youtu.be/x).');
    expect(root.querySelector('h1').textContent).toBe('Class 1');
    expect(root.querySelector('strong').textContent).toBe('ginga');
    expect(root.querySelector('em').textContent).toBe('negativa');
    expect([...root.querySelectorAll('ul li')].map((li) => li.textContent)).toEqual(['armada', 'au']);
    expect(root.querySelector('code').textContent).toBe('au');
    expect(root.querySelectorAll('ol li')).toHaveLength(2);
    const link = root.querySelector('a');
    expect(link.href).toBe('https://youtu.be/x');
    expect(link.rel).toBe('noopener noreferrer');
  });

  it('keeps hostile input inert', () => {
    const root = html('<script>window.bad=1</script>\n\n<img src=x onerror=alert(1)>\n\n[click](javascript:alert(1))\n\n[http](http://example.test)');
    expect(root.querySelector('script, img')).toBeNull();
    expect(root.querySelector('a')).toBeNull();
    expect(root.textContent).toContain('<script>window.bad=1</script>');
    expect(root.textContent).toContain('[click](javascript:alert(1))');
  });
});
```

```js
// tests/unit/resource-view.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { createResourceSection, resourceIcons } from '../../src/app/ui/resource-view.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

describe('resource view', () => {
  it('renders icons for present kinds', () => {
    const icons = resourceIcons(document, i18n, ['summary', 'video']);
    expect(icons.textContent).toBe('🎥📄');
    expect(icons.getAttribute('aria-label')).toBe('Video, Summary');
  });

  it('shows resources and adds link, text, and files', async () => {
    const service = {
      addResource: vi.fn().mockResolvedValue({ status: 'saved' }),
      deleteResource: vi.fn().mockResolvedValue({ status: 'deleted' }),
    };
    const onChanged = vi.fn();
    const item = {
      occurrence_id: 'o1', can_add_resources: true,
      resources: [
        { id: 'r1', kind: 'video', title: 'Zoom', url: 'https://youtu.be/x', body: null, can_edit: true },
        { id: 'r2', kind: 'summary', title: null, url: null, body: '# Notes', can_edit: false },
      ],
    };
    document.body.replaceChildren(createResourceSection({ document, i18n, item, service, onChanged }));
    const link = document.querySelector('a[href="https://youtu.be/x"]');
    expect(link.textContent).toBe('🎥 Zoom');
    expect(link.target).toBe('_blank');
    expect(document.querySelector('.resource-markdown h1').textContent).toBe('Notes');
    expect(document.querySelector('button[aria-label="Delete Summary"]')).toBeNull();

    document.querySelector('button[data-action="open-resources"]').click();
    const form = document.querySelector('form[data-resource-form]');
    form.querySelector('select[name="kind"]').value = 'video';
    form.querySelector('input[name="url"]').value = 'https://youtu.be/y';
    const file = new File(['transcript text'], 'class-2.txt', { type: 'text/plain' });
    Object.defineProperty(form.querySelector('input[type="file"]'), 'files', { value: [file] });
    form.requestSubmit();
    await vi.waitFor(() => expect(service.addResource).toHaveBeenCalledTimes(2));
    expect(service.addResource).toHaveBeenCalledWith({ occurrenceId: 'o1', kind: 'video', title: '', url: 'https://youtu.be/y', body: null });
    expect(service.addResource).toHaveBeenCalledWith({ occurrenceId: 'o1', kind: 'voice', title: 'class-2.txt', url: null, body: 'transcript text' });
    expect(onChanged).toHaveBeenCalled();

    document.querySelector('button[aria-label="Delete Zoom"]').click();
    await vi.waitFor(() => expect(service.deleteResource).toHaveBeenCalledWith('r1'));
  });

  it('keeps the form and shows the error when saving fails', async () => {
    const service = { addResource: vi.fn().mockRejectedValue(new Error('Paste a link that starts with https://.')) };
    const item = { occurrence_id: 'o1', can_add_resources: true, resources: [] };
    document.body.replaceChildren(createResourceSection({ document, i18n, item, service, onChanged() {} }));
    document.querySelector('button[data-action="open-resources"]').click();
    const form = document.querySelector('form[data-resource-form]');
    form.querySelector('select[name="kind"]').value = 'video';
    form.querySelector('input[name="url"]').value = 'http://bad';
    form.requestSubmit();
    await vi.waitFor(() => expect(form.querySelector('[role="status"]').textContent).toBe('Paste a link that starts with https://.'));
    expect(form.querySelector('input[name="url"]').value).toBe('http://bad');
  });
});
```

Add to `tests/unit/training-calendar-view.test.js` (and `listResourceKinds: vi.fn().mockResolvedValue([{ occurrence_id: 'a', kinds: ['summary', 'video'] }])` to the `service()` defaults):

```js
  it('marks days that have class resources', async () => {
    const view = createTrainingCalendarView({
      document, service: service(), i18n: i18n(), profile: { id: 'practitioner-1' }, timezone: 'Europe/Lisbon',
    });
    await view.loadMonth('2026-09');
    await vi.waitFor(() => expect(document.querySelector('[data-date="2026-09-22"] .resource-icons').textContent).toBe('🎥📄'));
    expect(document.querySelector('[data-date="2026-09-22"]').getAttribute('aria-label')).toContain('Video, Summary');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/markdown-lite.test.js tests/unit/resource-view.test.js tests/unit/training-calendar-view.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement markdown-lite**

```js
// src/app/markdown-lite.js
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https:\/\/[^)\s]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function inline(document, parent, text) {
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) parent.append(text.slice(last, match.index));
    const token = match[0];
    let node;
    if (token.startsWith('**')) {
      node = document.createElement('strong');
      node.textContent = token.slice(2, -2);
    } else if (token.startsWith('`')) {
      node = document.createElement('code');
      node.textContent = token.slice(1, -1);
    } else if (token.startsWith('[')) {
      const [, label, href] = /^\[([^\]]+)\]\((https:\/\/[^)\s]+)\)$/.exec(token);
      node = document.createElement('a');
      node.href = href;
      node.target = '_blank';
      node.rel = 'noopener noreferrer';
      node.textContent = label;
    } else {
      node = document.createElement('em');
      node.textContent = token.slice(1, -1);
    }
    parent.append(node);
    last = match.index + token.length;
  }
  if (last < text.length) parent.append(text.slice(last));
}

export function renderMarkdown(document, text) {
  const fragment = document.createDocumentFragment();
  const blocks = String(text ?? '').replace(/\r\n/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim());
    if (!lines.length) continue;
    const heading = /^(#{1,3})\s+(.*)$/.exec(lines[0]);
    if (heading && lines.length === 1) {
      const node = document.createElement(`h${heading[1].length}`);
      inline(document, node, heading[2]);
      fragment.append(node);
      continue;
    }
    if (lines.every((line) => /^\s*[-*]\s+/.test(line)) || lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
      const ordered = /^\s*\d+\./.test(lines[0]);
      const list = document.createElement(ordered ? 'ol' : 'ul');
      for (const line of lines) {
        const item = document.createElement('li');
        inline(document, item, line.replace(/^\s*(?:[-*]|\d+\.)\s+/, ''));
        list.append(item);
      }
      fragment.append(list);
      continue;
    }
    const paragraph = document.createElement('p');
    lines.forEach((line, index) => {
      if (index) paragraph.append(document.createElement('br'));
      inline(document, paragraph, line);
    });
    fragment.append(paragraph);
  }
  return fragment;
}
```

- [ ] **Step 4: Add i18n keys**

`en`:

```js
    'resources.video': 'Video',
    'resources.voice': 'Voice transcript',
    'resources.summary': 'Summary',
    'resources.videoLink': 'Video link',
    'resources.title': 'Class resources',
    'resources.add': 'Add resources',
    'resources.kind': 'Resource type',
    'resources.itemTitle': 'Title',
    'resources.link': 'Link',
    'resources.text': 'Text',
    'resources.files': 'Text files (.txt, .md)',
    'resources.save': 'Save resources',
    'resources.saved': 'Resources saved.',
    'resources.delete': 'Delete {title}',
    'resources.empty': 'Add a link, a transcript, or a summary.',
    'resources.saveError': "We couldn't save these resources. Your entries are still here.",
```

`pt`:

```js
    'resources.video': 'Vídeo',
    'resources.voice': 'Transcrição de voz',
    'resources.summary': 'Resumo',
    'resources.videoLink': 'Link de vídeo',
    'resources.title': 'Recursos da aula',
    'resources.add': 'Adicionar recursos',
    'resources.kind': 'Tipo de recurso',
    'resources.itemTitle': 'Título',
    'resources.link': 'Link',
    'resources.text': 'Texto',
    'resources.files': 'Ficheiros de texto (.txt, .md)',
    'resources.save': 'Guardar recursos',
    'resources.saved': 'Recursos guardados.',
    'resources.delete': 'Apagar {title}',
    'resources.empty': 'Adiciona um link, uma transcrição ou um resumo.',
    'resources.saveError': 'Não foi possível guardar os recursos. Os teus dados continuam aqui.',
```

- [ ] **Step 5: Implement the resource view**

```js
// src/app/ui/resource-view.js
import { renderMarkdown } from '../markdown-lite.js';

export const RESOURCE_ICONS = Object.freeze({ video: '🎥', voice: '🎙️', summary: '📄' });
const ORDER = ['video', 'voice', 'summary'];

export function resourceIcons(document, i18n, kinds) {
  const present = ORDER.filter((kind) => kinds.includes(kind));
  const span = document.createElement('span');
  span.className = 'resource-icons';
  span.textContent = present.map((kind) => RESOURCE_ICONS[kind]).join('');
  span.setAttribute('aria-label', present.map((kind) => i18n.t(`resources.${kind}`)).join(', '));
  return span;
}

function titleFor(i18n, resource) {
  return resource.title || i18n.t(`resources.${resource.kind}`);
}

export function createResourceSection({ document, i18n, item, service, onChanged }) {
  const section = document.createElement('section');
  section.className = 'training-resources';
  section.dataset.resources = item.occurrence_id;
  const heading = document.createElement('h4');
  heading.textContent = i18n.t('resources.title');
  section.append(heading);

  for (const resource of item.resources ?? []) {
    const row = document.createElement('div');
    row.className = `resource resource-${resource.kind}`;
    const label = `${RESOURCE_ICONS[resource.kind]} ${titleFor(i18n, resource)}`;
    if (resource.kind === 'video') {
      const link = document.createElement('a');
      link.href = resource.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = label;
      row.append(link);
    } else {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = label;
      details.append(summary);
      if (resource.kind === 'summary') {
        const body = document.createElement('div');
        body.className = 'resource-markdown';
        body.append(renderMarkdown(document, resource.body));
        details.append(body);
      } else {
        const body = document.createElement('pre');
        body.className = 'resource-transcript';
        body.textContent = resource.body;
        details.append(body);
      }
      row.append(details);
    }
    if (resource.can_edit) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'quiet-button';
      remove.textContent = '×';
      remove.dataset.action = 'delete-resource';
      remove.dataset.resourceId = resource.id;
      remove.setAttribute('aria-label', i18n.t('resources.delete', { title: titleFor(i18n, resource) }));
      row.append(remove);
    }
    section.append(row);
  }

  if (!item.can_add_resources) return section;

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'secondary-button';
  open.dataset.action = 'open-resources';
  open.textContent = i18n.t('resources.add');
  section.append(open);

  function buildForm() {
    const form = document.createElement('form');
    form.dataset.resourceForm = item.occurrence_id;
    const field = (labelKey, control) => {
      const label = document.createElement('label');
      label.className = 'field-label';
      label.textContent = i18n.t(labelKey);
      label.append(control);
      return label;
    };
    const kind = document.createElement('select');
    kind.name = 'kind';
    kind.className = 'field-input';
    for (const [value, key] of [['video', 'resources.videoLink'], ['voice', 'resources.voice'], ['summary', 'resources.summary']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = i18n.t(key);
      kind.append(option);
    }
    const title = Object.assign(document.createElement('input'), { name: 'title', className: 'field-input', maxLength: 200 });
    const url = Object.assign(document.createElement('input'), { name: 'url', className: 'field-input', type: 'url' });
    const text = Object.assign(document.createElement('textarea'), { name: 'body', className: 'field-input field-textarea' });
    const files = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: '.txt,.md,text/plain,text/markdown' });
    const save = Object.assign(document.createElement('button'), { type: 'submit', className: 'primary-button', textContent: i18n.t('resources.save') });
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    form.append(
      field('resources.kind', kind), field('resources.itemTitle', title), field('resources.link', url),
      field('resources.text', text), field('resources.files', files), save, status,
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      status.textContent = '';
      save.disabled = true;
      const pending = [];
      const chosen = kind.value;
      if (chosen === 'video' && url.value.trim()) {
        pending.push({ occurrenceId: item.occurrence_id, kind: 'video', title: title.value, url: url.value, body: null });
      }
      if (chosen !== 'video' && text.value.trim()) {
        pending.push({ occurrenceId: item.occurrence_id, kind: chosen, title: title.value, url: null, body: text.value });
      }
      for (const file of files.files ?? []) {
        pending.push({
          occurrenceId: item.occurrence_id,
          kind: /\.md$/i.test(file.name) ? 'summary' : 'voice',
          title: file.name, url: null, body: await file.text(),
        });
      }
      if (!pending.length) {
        status.textContent = i18n.t('resources.empty');
        save.disabled = false;
        return;
      }
      try {
        for (const resource of pending) await service.addResource(resource);
        status.textContent = i18n.t('resources.saved');
        await onChanged();
      } catch (error) {
        status.textContent = error?.message || i18n.t('resources.saveError');
      } finally {
        save.disabled = false;
      }
    });
    return form;
  }

  section.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    if (button.dataset.action === 'open-resources' && !section.querySelector('form[data-resource-form]')) {
      section.append(buildForm());
    }
    if (button.dataset.action === 'delete-resource') {
      await service.deleteResource(button.dataset.resourceId);
      await onChanged();
    }
  });
  return section;
}
```

The resource form saves sequentially; if the third of three fails, the first two are saved and the message tells the user to retry. Re-submitting may duplicate the first two; accept this for a manual flow and note it in the PR.

- [ ] **Step 6: Wire into the calendar view**

In `src/app/ui/training-calendar-view.js`:

1. Import `createResourceSection, resourceIcons` from `./resource-view.js`.
2. Add `let resourceKinds = new Map();` beside the other `let` state.
3. In `loadMonth`, after `state = reduceCalendarState(state, { type: 'MONTH_LOAD_SUCCEEDED', token, items });`, add:

```js
      try {
        const kinds = await service.listResourceKinds({
          start: bounds.start, endExclusive: bounds.endExclusive, profileId: viewedProfileId,
        });
        if (token === requestToken) {
          resourceKinds = new Map(kinds.map((row) => [row.occurrence_id, row.kinds]));
        }
      } catch {
        resourceKinds = new Map();
      }
```

4. In `renderCalendar`, inside the per-day loop after `button.append(markers);`:

```js
      const kinds = [...new Set(items.flatMap((item) => resourceKinds.get(item.item_id) ?? []))];
      if (kinds.length) {
        const icons = resourceIcons(document, i18n, kinds);
        button.append(icons);
        button.setAttribute('aria-label', `${button.getAttribute('aria-label')} · ${icons.getAttribute('aria-label')}`);
      }
```

5. In `renderDetail`, after the round details for each `item`, append:

```js
      if ((item.resources ?? []).length || item.can_add_resources) {
        article.append(createResourceSection({
          document, i18n, item, service,
          onChanged: async () => {
            await loadMonth(state.visibleMonth);
            await selectDay(state.selectedDate);
          },
        }));
      }
```

6. In `clear()`, reset `resourceKinds = new Map();`.

Append to `assets/training-calendar.css`:

```css
.resource-icons { display: block; font-size: .7rem; line-height: 1; }
.training-resources { display: grid; gap: .4rem; margin-top: .6rem; }
.resource { display: flex; gap: .4rem; align-items: flex-start; }
.resource-transcript { white-space: pre-wrap; max-height: 320px; overflow: auto; }
.resource-markdown { max-height: 420px; overflow: auto; }
```

- [ ] **Step 7: Write the browser test**

```js
// tests/e2e/training-resources.spec.js
import { expect, test } from '@playwright/test';

test('adds a video link and a summary file to Alone training', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1', email: 'ana@example.com' } }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify({
      id: 'practitioner-1', display_name: 'Ana Silva', avatar_path: null,
      timezone_override: 'Europe/Lisbon', leaderboard_visible: true, completed_at: '2026-09-11T20:00:00Z',
    }));
  });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Record Alone training' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record Alone training' });
  await dialog.getByLabel('Training date').fill('2026-09-22');
  await dialog.getByLabel('Round 1 text').fill('ginga 10 min');
  await dialog.getByRole('button', { name: 'Save training' }).click();
  await expect(dialog).toBeHidden();

  const detail = page.locator('#trainingDayDetail');
  await detail.getByRole('button', { name: 'Add resources' }).click();
  await detail.getByLabel('Resource type').selectOption('video');
  await detail.getByLabel('Title').fill('Zoom recording');
  await detail.getByLabel('Link').fill('https://www.youtube.com/watch?v=oMmctHNRyBg');
  await detail.getByLabel('Text files (.txt, .md)').setInputFiles({
    name: 'summary.md', mimeType: 'text/markdown', buffer: Buffer.from('# Class 1\n\n- ginga\n- armada'),
  });
  await detail.getByRole('button', { name: 'Save resources' }).click();
  await expect(detail.getByRole('link', { name: '🎥 Zoom recording' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=oMmctHNRyBg');
  await detail.getByText('📄 summary.md').click();
  await expect(detail.locator('.resource-markdown h1')).toHaveText('Class 1');
  await expect(page.getByRole('gridcell', { name: /September 22.*Video, Summary/ })).toBeVisible();
});
```

- [ ] **Step 8: Run tests**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/markdown-lite.js src/app/ui/resource-view.js src/app/ui/training-calendar-view.js src/app/dashboard-i18n.js assets/training-calendar.css tests/unit/markdown-lite.test.js tests/unit/resource-view.test.js tests/unit/training-calendar-view.test.js tests/e2e/training-resources.spec.js
git commit -m "feat: show and add class resources in the calendar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Record a past class

**Files:**
- Create: `src/app/ui/past-class-view.js`
- Modify: `src/app/ui/round-editor.js` (add `ratings` option), `src/app/ui/coaching-training-view.js`, `src/app/dashboard-i18n.js`
- Test: `tests/unit/past-class-view.test.js`, `tests/e2e/past-class.spec.js`

**Interfaces:**
- Consumes: `trainingService.recordPastClass`, `trainingService.addResource`, `scheduledInstant` (exported from `coaching-training-view.js`), `createRoundEditor({ ratings: false })`.
- Produces: `createPastClassView({ document, i18n, trainingService, timezone, getContext, getStudents, getRoster, getTermMappings, onRecorded }) → { open(), close() }` where `getContext() → { groupId }`, `getStudents() → [{ profileId, name, connectionId, groupId }]`, `getRoster() → [{ profile_id, display_name, access_level }]`. The dialog is labelled **"Record a past class"** and has **"Class type"** (`Group class` / `Personal class`), **"Student"**, **"Class date"**, **"Start time"**, **"Duration in minutes"**, attendee checkboxes, round cards, **"Video link"**, **"Summary"**, **"Voice transcript"**, and **"Save past class"**. The Schedule tab header gains a **"Record a past class"** button (`data-action="record-past-class"`).

- [ ] **Step 1: Add the `ratings` option to the round editor**

In `createRoundEditor`'s options add `ratings = true`. In `renderCard`, only build and append the difficulty fieldset and the **Rate parts** tool button when `ratings` is true; `getRounds()` returns `ratings: []` when `ratings` is false. Add a unit test to `tests/unit/round-editor.test.js`:

```js
  it('hides difficulty controls when ratings are off', () => {
    const editor = mount({ ratings: false });
    editor.setRounds([{ sourceText: 'armada' }]);
    expect(document.querySelector('[data-round-difficulty]')).toBeNull();
    expect(document.querySelector('button[aria-label="Rate parts"]')).toBeNull();
    expect(editor.getRounds()[0].ratings).toEqual([]);
  });
```

- [ ] **Step 2: Write the failing unit test**

```js
// tests/unit/past-class-view.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { createPastClassView } from '../../src/app/ui/past-class-view.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

function setup(overrides = {}) {
  const trainingService = {
    createIdempotencyKey: vi.fn(() => 'past-key'),
    recordPastClass: vi.fn().mockResolvedValue({ status: 'completed', occurrence_id: 'o1' }),
    addResource: vi.fn().mockResolvedValue({ status: 'saved' }),
    ...overrides,
  };
  const onRecorded = vi.fn();
  const view = createPastClassView({
    document, i18n, trainingService, timezone: 'Europe/Lisbon',
    getContext: () => ({ groupId: 'g1' }),
    getStudents: () => [{ profileId: 's-direct', name: 'Direct Ana', connectionId: 'c1', groupId: null }],
    getRoster: () => [
      { profile_id: 's1', display_name: 'Bia', access_level: 'member' },
      { profile_id: 's2', display_name: 'Caio', access_level: 'member' },
      { profile_id: 'coach', display_name: 'Coach', access_level: 'coach' },
    ],
    getTermMappings: () => [],
    onRecorded,
  });
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.showModal = function showModal() { this.open = true; };
    dialog.close = function close() { this.open = false; };
  }
  return { view, trainingService, onRecorded };
}

function fill(label, value) {
  const input = [...document.querySelectorAll('label')].find((node) => node.firstChild?.textContent === label).querySelector('input, select, textarea');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('past class view', () => {
  beforeEach(() => { document.body.replaceChildren(); });

  it('records a group class with attendees, rounds, and resources', async () => {
    const { view, trainingService, onRecorded } = setup();
    view.open();
    fill('Class date', '2026-09-11');
    fill('Start time', '14:14');
    fill('Duration in minutes', '77');
    document.querySelector('input[name="attendee"][value="s2"]').click();
    const round = document.querySelector('textarea[aria-label="Round 1 text"]');
    round.value = 'ginga, armada';
    round.dispatchEvent(new Event('input', { bubbles: true }));
    fill('Video link', 'https://www.youtube.com/watch?v=oMmctHNRyBg');
    fill('Summary', '# Class 1');
    document.querySelector('form[data-past-class-form]').requestSubmit();
    await vi.waitFor(() => expect(onRecorded).toHaveBeenCalled());
    expect(trainingService.recordPastClass).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'group', groupId: 'g1', localDate: '2026-09-11', occurredAt: '2026-09-11T13:14:00.000Z',
      timezone: 'Europe/Lisbon', durationMinutes: 77, idempotencyKey: 'past-key',
      attendees: [{ profileId: 's1', durationMinutes: 77 }],
      rounds: [expect.objectContaining({ source_text: 'ginga, armada' })],
    }));
    expect(trainingService.addResource.mock.calls.map(([input]) => input.kind)).toEqual(['video', 'summary']);
  });

  it('records a personal class through the student connection', async () => {
    const { view, trainingService } = setup();
    view.open();
    fill('Class type', 'personal_class');
    fill('Class date', '2026-09-15');
    fill('Start time', '13:46');
    fill('Duration in minutes', '85');
    document.querySelector('form[data-past-class-form]').requestSubmit();
    await vi.waitFor(() => expect(trainingService.recordPastClass).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'personal_class', studentProfileId: 's-direct', connectionId: 'c1', groupId: null,
    })));
  });

  it('keeps entries and reuses the request key after a failure', async () => {
    const { view, trainingService } = setup({
      recordPastClass: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ status: 'completed', occurrence_id: 'o1' }),
    });
    view.open();
    fill('Class date', '2026-09-11');
    fill('Start time', '14:14');
    fill('Duration in minutes', '60');
    const form = document.querySelector('form[data-past-class-form]');
    form.requestSubmit();
    await vi.waitFor(() => expect(form.querySelector('[role="status"]').textContent).toBe('offline'));
    form.requestSubmit();
    await vi.waitFor(() => expect(trainingService.recordPastClass).toHaveBeenCalledTimes(2));
    expect(trainingService.recordPastClass.mock.calls.map(([input]) => input.idempotencyKey)).toEqual(['past-key', 'past-key']);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/unit/past-class-view.test.js tests/unit/round-editor.test.js`
Expected: FAIL.

- [ ] **Step 4: Add i18n keys**

`en`:

```js
    'pastClass.open': 'Record a past class',
    'pastClass.title': 'Record a past class',
    'pastClass.close': 'Close past class',
    'pastClass.kind': 'Class type',
    'pastClass.group': 'Group class',
    'pastClass.personal': 'Personal class',
    'pastClass.student': 'Student',
    'pastClass.date': 'Class date',
    'pastClass.time': 'Start time',
    'pastClass.duration': 'Duration in minutes',
    'pastClass.attendees': 'Who attended',
    'pastClass.videoLink': 'Video link',
    'pastClass.summary': 'Summary',
    'pastClass.transcript': 'Voice transcript',
    'pastClass.save': 'Save past class',
    'pastClass.saving': 'Saving past class…',
    'pastClass.noStudents': 'Connect with a student or choose a group first.',
    'pastClass.saved': 'Past class saved.',
    'pastClass.resourceError': 'The class was saved, but some resources were not. Add them from the calendar.',
```

`pt`:

```js
    'pastClass.open': 'Registar uma aula passada',
    'pastClass.title': 'Registar uma aula passada',
    'pastClass.close': 'Fechar aula passada',
    'pastClass.kind': 'Tipo de aula',
    'pastClass.group': 'Aula de grupo',
    'pastClass.personal': 'Aula individual',
    'pastClass.student': 'Aluno',
    'pastClass.date': 'Data da aula',
    'pastClass.time': 'Hora de início',
    'pastClass.duration': 'Duração em minutos',
    'pastClass.attendees': 'Quem esteve presente',
    'pastClass.videoLink': 'Link de vídeo',
    'pastClass.summary': 'Resumo',
    'pastClass.transcript': 'Transcrição de voz',
    'pastClass.save': 'Guardar aula passada',
    'pastClass.saving': 'A guardar aula passada…',
    'pastClass.noStudents': 'Liga-te primeiro a um aluno ou escolhe um grupo.',
    'pastClass.saved': 'Aula passada guardada.',
    'pastClass.resourceError': 'A aula foi guardada, mas alguns recursos não. Adiciona-os a partir do calendário.',
```

- [ ] **Step 5: Implement the view**

```js
// src/app/ui/past-class-view.js
import { scheduledInstant } from './coaching-training-view.js';
import { createRoundEditor } from './round-editor.js';

function labelled(document, text, control) {
  const label = document.createElement('label');
  label.className = 'field-label';
  label.append(text, control);
  return label;
}

export function createPastClassView({
  document, i18n, trainingService, timezone, getContext, getStudents, getRoster, getTermMappings, onRecorded,
}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'profile-dialog group-dialog';
  dialog.setAttribute('aria-label', i18n.t('pastClass.title'));
  const form = document.createElement('form');
  form.dataset.pastClassForm = '';
  dialog.append(form);
  document.body.append(dialog);
  const rounds = createRoundEditor({ document, i18n, mode: 'record', getTermMappings, ratings: false });
  let idempotencyKey = null;
  let saving = false;

  function input(type, name, extra = {}) {
    return Object.assign(document.createElement(type === 'textarea' ? 'textarea' : 'input'), {
      ...(type === 'textarea' ? {} : { type }), name, className: type === 'textarea' ? 'field-input field-textarea' : 'field-input', ...extra,
    });
  }

  function render() {
    const { groupId } = getContext();
    const students = getStudents();
    form.replaceChildren();
    const close = Object.assign(document.createElement('button'), { type: 'button', className: 'profile-close', textContent: '×' });
    close.dataset.action = 'close-past-class';
    close.setAttribute('aria-label', i18n.t('pastClass.close'));
    const heading = Object.assign(document.createElement('h1'), { textContent: i18n.t('pastClass.title') });
    const kind = Object.assign(document.createElement('select'), { name: 'kind', className: 'field-input' });
    if (groupId) kind.append(Object.assign(document.createElement('option'), { value: 'group', textContent: i18n.t('pastClass.group') }));
    if (students.length) kind.append(Object.assign(document.createElement('option'), { value: 'personal_class', textContent: i18n.t('pastClass.personal') }));
    const student = Object.assign(document.createElement('select'), { name: 'student', className: 'field-input' });
    for (const entry of students) {
      student.append(Object.assign(document.createElement('option'), { value: entry.profileId, textContent: entry.name }));
    }
    const attendees = document.createElement('fieldset');
    attendees.className = 'attendance-list';
    attendees.append(Object.assign(document.createElement('legend'), { textContent: i18n.t('pastClass.attendees') }));
    for (const member of getRoster().filter(({ access_level: level }) => level === 'member')) {
      const box = Object.assign(document.createElement('input'), { type: 'checkbox', name: 'attendee', value: member.profile_id, checked: true });
      const label = document.createElement('label');
      label.append(box, ` ${member.display_name}`);
      attendees.append(label);
    }
    const studentField = labelled(document, i18n.t('pastClass.student'), student);
    const syncKind = () => {
      studentField.hidden = kind.value !== 'personal_class';
      attendees.hidden = kind.value !== 'group';
    };
    kind.addEventListener('change', syncKind);
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const save = Object.assign(document.createElement('button'), { type: 'submit', className: 'primary-button', textContent: i18n.t('pastClass.save') });
    form.append(
      close, heading,
      labelled(document, i18n.t('pastClass.kind'), kind), studentField,
      labelled(document, i18n.t('pastClass.date'), input('date', 'date', { required: true })),
      labelled(document, i18n.t('pastClass.time'), input('time', 'time', { required: true })),
      labelled(document, i18n.t('pastClass.duration'), input('number', 'duration', { required: true, min: '1', max: '1440', value: '60' })),
      attendees, rounds.element,
      labelled(document, i18n.t('pastClass.videoLink'), input('url', 'videoLink')),
      labelled(document, i18n.t('pastClass.summary'), input('textarea', 'summary')),
      labelled(document, i18n.t('pastClass.transcript'), input('textarea', 'transcript')),
      status, save,
    );
    if (!kind.options.length) status.textContent = i18n.t('pastClass.noStudents');
    save.disabled = !kind.options.length;
    syncKind();
  }

  async function submit() {
    if (saving) return;
    const status = form.querySelector('[role="status"]');
    const save = form.querySelector('button[type="submit"]');
    const elements = form.elements;
    const kind = elements.kind.value;
    const duration = Number(elements.duration.value);
    status.textContent = '';
    saving = true;
    save.disabled = true;
    save.textContent = i18n.t('pastClass.saving');
    try {
      const occurredAt = scheduledInstant(elements.date.value, elements.time.value, timezone);
      const student = getStudents().find(({ profileId }) => profileId === elements.student.value);
      const result = await trainingService.recordPastClass({
        kind,
        groupId: kind === 'group' ? getContext().groupId : student?.groupId ?? null,
        studentProfileId: kind === 'personal_class' ? student?.profileId : null,
        connectionId: kind === 'personal_class' ? student?.connectionId ?? null : null,
        occurredAt, localDate: elements.date.value, timezone, durationMinutes: duration,
        attendees: kind === 'group'
          ? [...form.querySelectorAll('input[name="attendee"]:checked')].map((box) => ({ profileId: box.value, durationMinutes: duration }))
          : [],
        rounds: rounds.getRounds(),
        idempotencyKey,
      });
      const resources = [
        ['video', elements.videoLink.value, null],
        ['summary', null, elements.summary.value],
        ['voice', null, elements.transcript.value],
      ].filter(([, url, body]) => (url ?? body ?? '').trim());
      try {
        for (const [resourceKind, url, body] of resources) {
          await trainingService.addResource({ occurrenceId: result.occurrence_id, kind: resourceKind, title: '', url, body });
        }
      } catch {
        status.textContent = i18n.t('pastClass.resourceError');
        await onRecorded(result);
        return;
      }
      idempotencyKey = null;
      dialog.close();
      await onRecorded(result);
    } catch (error) {
      status.textContent = error?.message || i18n.t('pastClass.resourceError');
    } finally {
      saving = false;
      save.disabled = false;
      save.textContent = i18n.t('pastClass.save');
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });
  form.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="close-past-class"]')) dialog.close();
  });

  return {
    open() {
      idempotencyKey = trainingService.createIdempotencyKey();
      render();
      rounds.setRounds([{ sourceText: '' }]);
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    },
    close() {
      if (dialog.open) dialog.close();
    },
  };
}
```

`scheduledInstant('2026-09-11', '14:14', 'Europe/Lisbon')` returns `2026-09-11T13:14:00.000Z` (Lisbon is UTC+1 in September), matching the unit test.

- [ ] **Step 6: Wire into the coaching view**

In `src/app/ui/coaching-training-view.js`:

1. Import `createPastClassView` from `./past-class-view.js`. This creates an import cycle (`past-class-view` imports `scheduledInstant` from `coaching-training-view`); it is safe because `scheduledInstant` is only called at submit time. If the bundler warns, move `scheduledInstant` and `zonedParts` into `src/app/time-zones.js` and import from both views.
2. After the `planRoundEditor` declaration:

```js
  const pastClass = createPastClassView({
    document, i18n, trainingService, timezone, getTermMappings,
    getContext: () => ({ groupId: context.groupId }),
    getStudents: coachStudents,
    getRoster: () => roster,
    onRecorded: async () => { await load(); },
  });
```

3. In `render()`, add `actionButton(i18n.t('pastClass.open'), 'record-past-class')` to the header next to **Create workout plan**.
4. In the `workspace` click handler, add `if (button.dataset.action === 'record-past-class') return pastClass.open();`.
5. In `clearPrivate()`, add `pastClass.close();`.

- [ ] **Step 7: Write the browser test**

```js
// tests/e2e/past-class.spec.js
import { expect, test } from '@playwright/test';

const group = {
  id: 'group-lua', slug: 'grupo-lua', owner_id: 'practitioner-1', name: 'Grupo Lua',
  description: 'Evening training', location: 'Lisbon', timezone: 'Europe/Lisbon',
  picture_path: null, is_discoverable: true, archived_at: null,
};

test('a coach records a past group class with a video link', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((seededGroup) => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1', email: 'coach@example.com' } }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify({
      id: 'practitioner-1', display_name: 'Coach Lua', avatar_path: null,
      timezone_override: 'Europe/Lisbon', leaderboard_visible: true, completed_at: '2026-09-11T20:00:00Z',
    }));
    localStorage.setItem('roda.e2e.coachProfile', JSON.stringify({ profile_id: 'practitioner-1', activated_at: '2026-09-11T20:00:00Z' }));
    localStorage.setItem('roda.e2e.groupState', JSON.stringify({
      groups: [seededGroup],
      memberships: [{ group_id: seededGroup.id, profile_id: 'practitioner-1', access_level: 'coach', state: 'active', joined_at: '2026-09-01T20:00:00Z', group: seededGroup }],
      rosters: { [seededGroup.id]: [
        { profile_id: 'student-group', display_name: 'Group Bia', access_level: 'member', membership_state: 'active' },
      ] },
    }));
    localStorage.setItem('roda.e2e.connectionState', JSON.stringify({ people: {}, connections: [] }));
  }, group);
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Coaching' }).click();
  await page.getByRole('button', { name: 'Record a past class' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record a past class' });
  await dialog.getByLabel('Class date').fill('2026-09-11');
  await dialog.getByLabel('Start time').fill('14:14');
  await dialog.getByLabel('Duration in minutes').fill('77');
  await dialog.getByLabel('Round 1 text').fill('ginga, armada');
  await dialog.getByLabel('Video link').fill('https://www.youtube.com/watch?v=oMmctHNRyBg');
  await dialog.getByRole('button', { name: 'Save past class' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('roda.e2e.trainingState'));
    return {
      occurrences: state.occurrences.map(({ kind, local_date: date }) => `${kind}:${date}`),
      participants: state.participations.map(({ profile_id: id }) => id),
      resources: state.resources.map(({ kind, url }) => `${kind}:${url}`),
    };
  })).toEqual({
    occurrences: ['group:2026-09-11'],
    participants: ['student-group'],
    resources: ['video:https://www.youtube.com/watch?v=oMmctHNRyBg'],
  });
});
```

The fake `addResource` from Task 8 requires `occurrence.recorded_by === actorId()`, which holds for the coach who recorded the class.

- [ ] **Step 8: Run tests**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/ui/past-class-view.js src/app/ui/round-editor.js src/app/ui/coaching-training-view.js src/app/dashboard-i18n.js tests/unit/past-class-view.test.js tests/unit/round-editor.test.js tests/e2e/past-class.spec.js
git commit -m "feat: let coaches record past classes with resources

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Hardest transitions in personal statistics

**Files:**
- Modify: `src/app/ui/statistics-view.js`, `src/app/dashboard-i18n.js`
- Test: `tests/unit/statistics-view.test.js`

**Interfaces:**
- Consumes: `hardest_transitions` from Task 9.
- Produces: a `section[data-hardest-transitions]` in the personal statistics panel, headed **"Hardest transitions"**, listing `"{from} → {to} · {hard} of {total} hard"`, or **"Rate transitions in your rounds to see which ones are hardest."** when the list is empty.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/statistics-view.test.js`, following the file's existing pattern for rendering personal statistics (reuse its fixture and `service` helper; set the personal result to include the new field):

```js
  it('lists the hardest transitions', async () => {
    const api = service({
      getPersonal: vi.fn().mockResolvedValue({
        ...personalFixture,
        hardest_transitions: [{
          from_movement_key: 'armada', to_movement_key: 'au', from_name: 'Armada', to_name: 'Aú',
          hard_count: 3, rating_count: 4,
        }],
      }),
    });
    const view = createView(api);
    await view.loadPersonal();
    const section = document.querySelector('[data-hardest-transitions]');
    expect(section.querySelector('h3').textContent).toBe('Hardest transitions');
    expect(section.querySelector('li').textContent).toBe('Armada → Aú · 3 of 4 hard');
  });

  it('explains how to fill the hardest transitions list', async () => {
    const api = service({ getPersonal: vi.fn().mockResolvedValue({ ...personalFixture, hardest_transitions: [] }) });
    const view = createView(api);
    await view.loadPersonal();
    expect(document.querySelector('[data-hardest-transitions]').textContent)
      .toContain('Rate transitions in your rounds to see which ones are hardest.');
  });
```

Use the names this test file already defines for its personal-statistics fixture and view factory in place of `personalFixture` and `createView`; if it builds them inline, extract them into local helpers first.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/statistics-view.test.js`
Expected: FAIL.

- [ ] **Step 3: Add i18n keys**

`en`: `'statistics.hardestTransitions': 'Hardest transitions'`, `'statistics.transitionLine': '{from} → {to} · {hard} of {total} hard'`, `'statistics.noTransitions': 'Rate transitions in your rounds to see which ones are hardest.'`.

`pt`: `'statistics.hardestTransitions': 'Transições mais difíceis'`, `'statistics.transitionLine': '{from} → {to} · {hard} de {total} difíceis'`, `'statistics.noTransitions': 'Avalia as transições nas tuas rondas para veres as mais difíceis.'`.

- [ ] **Step 4: Render the section**

In `src/app/ui/statistics-view.js`, in the function that renders the personal result (where `difficulty_trends` is rendered), append after the difficulty-trend section:

```js
    const transitions = document.createElement('section');
    transitions.dataset.hardestTransitions = '';
    const transitionsHeading = document.createElement('h3');
    transitionsHeading.textContent = i18n.t('statistics.hardestTransitions');
    transitions.append(transitionsHeading);
    const rows = result.hardest_transitions ?? [];
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'calendar-empty';
      empty.textContent = i18n.t('statistics.noTransitions');
      transitions.append(empty);
    } else {
      const list = document.createElement('ol');
      for (const row of rows) {
        const item = document.createElement('li');
        item.textContent = i18n.t('statistics.transitionLine', {
          from: row.from_name, to: row.to_name, hard: row.hard_count, total: row.rating_count,
        });
        list.append(item);
      }
      transitions.append(list);
    }
    container.append(transitions);
```

Replace `result` and `container` with the variable names that function already uses for the personal statistics payload and its parent element.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/statistics-view.test.js tests/unit/dashboard-i18n.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/ui/statistics-view.js src/app/dashboard-i18n.js tests/unit/statistics-view.test.js
git commit -m "feat: show hardest transitions in personal statistics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Demo data, documentation, and full verification

**Files:**
- Modify: `src/app/demo-data.js`, `tests/unit/demo-data.test.js`, `README.md`, `ROADMAP.md`, `docs/auth-and-database-operations.md`, `docs/training-platform-design-decisions.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a demo (`/dashboard?demo=1`) that shows text rounds, a round rating, a saved sequence, and a class with a video link; updated docs.

- [ ] **Step 1: Update demo data**

In `src/app/demo-data.js`, change each seeded occurrence's `rounds` to the text shape, for example:

```js
rounds: [{
  id: 'demo-round-1', source_text: 'ginga 10 min, 10x (armada, aú, 3x ginga)', sequence: [],
  movements: [
    { movement_key: 'ginga', movement_name: 'Ginga', catalogued: true, segment_key: 'm:1', duration_seconds: 600 },
    { movement_key: 'armada', movement_name: 'Armada', catalogued: true, segment_key: 'm:2.1' },
    { movement_key: 'au', movement_name: 'Aú', catalogued: true, segment_key: 'm:2.2' },
    { movement_key: 'ginga', movement_name: 'Ginga', catalogued: true, segment_key: 'm:2.3', repetitions: 3 },
  ],
}],
```

Seed `roundRatings` for one participation with `{ 'demo-round-1': [{ segment_key: 'r', segment_kind: 'round', difficulty: 'okay' }, { segment_key: 't:2.1>2.2', segment_kind: 'transition', difficulty: 'hard', from_movement_key: 'armada', to_movement_key: 'au' }] }`, add one `resources` entry `{ id: 'demo-resource-1', occurrence_id: <that occurrence>, kind: 'video', title: 'Class recording', url: 'https://www.youtube.com/', body: null, added_by: <demo user id> }`, and seed `roda.e2e.repertoireState` with one item `{ id: 'sequence-1', profile_id: <demo user id>, import_ref: null, title: 'Armada into aú', source_text: '10x (armada, aú)', sequence: null, updated_at: <now ISO> }`. Do not use the private recordings from `/home/joao/roda-private/` in demo data. Extend `tests/unit/demo-data.test.js` to assert the seeded state contains `source_text`, a `roundRatings` entry, a resource, and a repertoire item.

- [ ] **Step 2: Update documentation**

- `README.md`: in the dashboard feature list, describe text rounds, the move picker, round and part ratings, the Repertoire tab, class resources, and recording past classes in one short paragraph each.
- `ROADMAP.md`: under "Training coordination and tracking", add a bullet list "Delivered in the training-input increment" naming the same features, and add "Locations and class map (spec pending)" plus "Coach scheduling redesign" as next items.
- `docs/auth-and-database-operations.md`: add a "Catalog curators" section with the exact SQL to grant the role, `insert into public.catalog_curators (profile_id) select id from auth.users where email = '<owner email>';`, and to revoke it, `delete from public.catalog_curators where profile_id = '<profile id>';`, noting the role is granted only from the SQL editor.
- `docs/training-platform-design-decisions.md`: add "Decision 4: Text-first training input" summarizing principles 1–7 of the spec, linking `docs/superpowers/specs/2026-10-10-training-input-catalog-design.md`.

- [ ] **Step 3: Run the full verification suite**

Run:

```bash
npm run build
npm run test:unit
npm run supabase:reset
npm run test:db
npm run test:e2e
```

Expected: every command exits 0. Record the pass counts for the PR description.

- [ ] **Step 4: Check the security items for this change**

Run `npx supabase db lint` (if available in the installed CLI) and confirm by query that every new table has RLS:

```bash
npx supabase db execute --local "select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity;"
```

Expected: no rows. Confirm with `rg -n "security definer" supabase/migrations/2026101000*` that every definer function is in schema `private` and declares `set search_path = ''`.

- [ ] **Step 5: Commit**

```bash
git add src/app/demo-data.js tests/unit/demo-data.test.js README.md ROADMAP.md docs/auth-and-database-operations.md docs/training-platform-design-decisions.md
git commit -m "docs: describe text-first training input and refresh demo data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

