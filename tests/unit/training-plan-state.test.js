import { describe, expect, it } from 'vitest';

import { createPlanDraft, roundText, serializePlanDraft } from '../../src/app/training-plan-state.js';

describe('training plan state', () => {
  it('creates drafts whose rounds are text with ratings', () => {
    const draft = createPlanDraft({
      title: 'Basics',
      rounds: [
        { source_text: '10x (armada, au)', ratings: [{ segment_key: 'r', difficulty: 'hard' }] },
        { movements: [{ movement_name: 'Ginga', repetitions: 3 }, { movementName: 'Aú' }] },
      ],
    });
    expect(draft).toMatchObject({ id: null, title: 'Basics', durationMinutes: 60, published: false });
    expect(draft.rounds).toEqual([
      { sourceText: '10x (armada, au)', ratings: [{ segment_key: 'r', difficulty: 'hard' }] },
      { sourceText: '3x Ginga, Aú', ratings: [] },
    ]);
  });

  it('prefers stored text, then the parsed sequence, then legacy movements', () => {
    expect(roundText({ source_text: 'ginga', sequence: [], movements: [] })).toBe('ginga');
    expect(roundText({
      sequence: [{ type: 'move', path: '1', name: 'Armada', reps: 2, durationSeconds: null, note: null }],
    })).toBe('2x Armada');
    expect(roundText({ movements: [{ movement_name: 'Negativa' }] })).toBe('Negativa');
  });

  it('serializes trimmed metadata with editor rounds', () => {
    const rounds = [{ label: null, source_text: 'au', sequence: [], movements: [], ratings: [] }];
    expect(serializePlanDraft(createPlanDraft({
      title: '  Plan  ', description: '  ', durationMinutes: '45', instructions: ' Go ',
    }), rounds)).toEqual({
      title: 'Plan', description: null, durationMinutes: 45, instructions: 'Go', rounds,
    });
  });
});
