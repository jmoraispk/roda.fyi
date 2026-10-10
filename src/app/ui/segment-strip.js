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
