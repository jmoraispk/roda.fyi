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
