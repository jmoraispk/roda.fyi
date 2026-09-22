function randomId(options = {}) {
  return (options.randomUUID ?? (() => globalThis.crypto.randomUUID()))();
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value) {
  return text(value) || null;
}

function optionalNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function movementKey(value) {
  return text(value).toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function normalizedRound(value = {}, options = {}) {
  return {
    id: value.id ?? randomId(options),
    label: value.label ?? '',
    repetitions: value.repetitions ?? null,
    durationSeconds: value.durationSeconds ?? value.duration_seconds ?? null,
    restSeconds: value.restSeconds ?? value.rest_seconds ?? null,
    instructions: value.instructions ?? '',
    movements: Array.isArray(value.movements) ? value.movements : [],
  };
}

function normalizedMovement(value = {}, options = {}) {
  return {
    id: value.id ?? randomId(options),
    movementKey: value.movementKey ?? value.movement_key ?? '',
    movementName: value.movementName ?? value.movement_name ?? '',
    side: value.side ?? '',
    repetitions: value.repetitions ?? null,
    durationSeconds: value.durationSeconds ?? value.duration_seconds ?? null,
    instructions: value.instructions ?? '',
  };
}

function moved(items, itemId, direction) {
  const current = items.findIndex(({ id }) => id === itemId);
  if (current < 0) return items.slice();
  const target = direction === 'up'
    ? current - 1
    : direction === 'down'
      ? current + 1
      : Number(direction);
  if (!Number.isInteger(target) || target < 0 || target >= items.length || target === current) {
    return items.slice();
  }
  const result = items.slice();
  const [item] = result.splice(current, 1);
  result.splice(target, 0, item);
  return result;
}

export function createPlanDraft(values = {}) {
  return {
    id: values.id ?? null,
    versionId: values.versionId ?? null,
    expectedUpdatedAt: values.expectedUpdatedAt ?? null,
    title: values.title ?? '',
    description: values.description ?? '',
    groupId: values.groupId ?? null,
    durationMinutes: values.durationMinutes ?? 60,
    instructions: values.instructions ?? '',
    published: Boolean(values.published),
    rounds: Array.isArray(values.rounds) ? values.rounds : [],
  };
}

export function addRound(state, round = {}, options = {}) {
  return { ...state, rounds: [...state.rounds, normalizedRound(round, options)] };
}

export function moveRound(state, roundId, direction) {
  return { ...state, rounds: moved(state.rounds, roundId, direction) };
}

export function addMovement(state, roundId, movement = {}, options = {}) {
  return {
    ...state,
    rounds: state.rounds.map((round) => round.id === roundId
      ? { ...round, movements: [...round.movements, normalizedMovement(movement, options)] }
      : round),
  };
}

export function moveMovement(state, roundId, itemId, direction) {
  return {
    ...state,
    rounds: state.rounds.map((round) => round.id === roundId
      ? { ...round, movements: moved(round.movements, itemId, direction) }
      : round),
  };
}

export function removeMovement(state, roundId, itemId) {
  return {
    ...state,
    rounds: state.rounds.map((round) => round.id === roundId
      ? { ...round, movements: round.movements.filter(({ id }) => id !== itemId) }
      : round),
  };
}

export function serializePlanDraft(state) {
  return {
    title: text(state.title),
    description: optionalText(state.description),
    durationMinutes: Number(state.durationMinutes),
    instructions: optionalText(state.instructions),
    rounds: state.rounds.map((round) => ({
      label: optionalText(round.label),
      repetitions: optionalNumber(round.repetitions),
      duration_seconds: optionalNumber(round.durationSeconds),
      rest_seconds: optionalNumber(round.restSeconds),
      instructions: optionalText(round.instructions),
      movements: round.movements.map((movement) => ({
        movement_key: movementKey(movement.movementKey),
        movement_name: text(movement.movementName),
        side: optionalText(movement.side),
        repetitions: optionalNumber(movement.repetitions),
        duration_seconds: optionalNumber(movement.durationSeconds),
        instructions: optionalText(movement.instructions),
      })),
    })),
  };
}
