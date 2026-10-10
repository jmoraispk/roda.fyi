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
