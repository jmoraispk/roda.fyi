import { describe, expect, it } from 'vitest';

import {
  addMovement,
  addRound,
  createPlanDraft,
  moveMovement,
  moveRound,
  removeMovement,
  serializePlanDraft,
} from '../../src/app/training-plan-state.js';

function ids(...values) {
  let index = 0;
  return () => values[index++];
}

describe('training plan state', () => {
  it('creates stable client IDs and updates immutably', () => {
    const original = createPlanDraft({ title: 'Basics' });
    const withRound = addRound(original, { label: 'Warm up' }, {
      randomUUID: ids('round-1'),
    });
    const withMovement = addMovement(withRound, 'round-1', {
      movementKey: 'ginga', movementName: 'Ginga', repetitions: 10,
    }, { randomUUID: ids('movement-1') });

    expect(original.rounds).toEqual([]);
    expect(withRound.rounds[0]).toMatchObject({ id: 'round-1', movements: [] });
    expect(withMovement.rounds[0].movements[0]).toMatchObject({
      id: 'movement-1', movementKey: 'ginga', movementName: 'Ginga',
    });
    expect(withMovement.rounds).not.toBe(withRound.rounds);
    expect(withMovement.rounds[0]).not.toBe(withRound.rounds[0]);
  });

  it('moves rounds and movements without mutating prior state', () => {
    let state = createPlanDraft();
    state = addRound(state, { label: 'One' }, { randomUUID: ids('r1') });
    state = addRound(state, { label: 'Two' }, { randomUUID: ids('r2') });
    state = addMovement(state, 'r1', {
      movementKey: 'ginga', movementName: 'Ginga',
    }, { randomUUID: ids('m1') });
    state = addMovement(state, 'r1', {
      movementKey: 'armada', movementName: 'Armada',
    }, { randomUUID: ids('m2') });
    const movedRounds = moveRound(state, 'r2', 'up');
    const movedMovements = moveMovement(state, 'r1', 'm2', 'up');
    const removed = removeMovement(movedMovements, 'r1', 'm1');

    expect(state.rounds.map(({ id }) => id)).toEqual(['r1', 'r2']);
    expect(movedRounds.rounds.map(({ id }) => id)).toEqual(['r2', 'r1']);
    expect(movedMovements.rounds[0].movements.map(({ id }) => id)).toEqual(['m2', 'm1']);
    expect(removed.rounds[0].movements.map(({ id }) => id)).toEqual(['m2']);
  });

  it('serializes ordered server payloads without client IDs', () => {
    let state = createPlanDraft({
      title: '  Armada flow  ', description: '  ', durationMinutes: 45,
      instructions: '  Move slowly  ',
    });
    state = addRound(state, {
      label: '  Round one  ', repetitions: '3', restSeconds: '30',
    }, { randomUUID: ids('round-client') });
    state = addMovement(state, 'round-client', {
      movementKey: ' Armada ', movementName: ' Armada ', repetitions: '10',
      side: '', instructions: '  Control  ',
    }, { randomUUID: ids('movement-client') });

    expect(serializePlanDraft(state)).toEqual({
      title: 'Armada flow', description: null, durationMinutes: 45,
      instructions: 'Move slowly',
      rounds: [{
        label: 'Round one', repetitions: 3, duration_seconds: null,
        rest_seconds: 30, instructions: null,
        movements: [{
          movement_key: 'armada', movement_name: 'Armada', side: null,
          repetitions: 10, duration_seconds: null, instructions: 'Control',
        }],
      }],
    });
    expect(JSON.stringify(serializePlanDraft(state))).not.toContain('client');
  });
});
