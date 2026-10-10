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

// Stored limits: movement names 200 characters, notes 2000. Unrecognized text
// can be longer, so it is trimmed here rather than blocking the save.
function clip(text, limit) {
  return typeof text === 'string' && text.length > limit ? text.slice(0, limit).trim() : text;
}

function clipKey(slug) {
  return slug.length > 80 ? slug.slice(0, 80).replace(/-+$/, '') : slug;
}

export function toMovementRows(steps) {
  return leaves(steps).map((step) => ({
    movement_key: clipKey(step.slug),
    movement_name: clip(step.name, 200),
    catalogued: step.catalogued,
    segment_key: `m:${step.path}`,
    side: step.side,
    repetitions: step.reps,
    duration_seconds: step.durationSeconds,
    instructions: clip(step.note, 2000),
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
