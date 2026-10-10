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
