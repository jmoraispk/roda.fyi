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
