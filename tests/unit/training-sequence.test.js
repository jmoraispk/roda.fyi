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

  it('caps long unrecognized text so it fits the stored name and note limits', () => {
    const sentence = `today I focused on ${'keeping my knees bent '.repeat(12)}`;
    const [row] = toMovementRows(steps(sentence));
    expect(row.catalogued).toBe(false);
    expect(row.movement_name.length).toBeLessThanOrEqual(200);
    const [noted] = toMovementRows(steps(`ginga (${'x'.repeat(2100)})`));
    expect(noted.instructions.length).toBeLessThanOrEqual(2000);
  });
});
