// src/app/ui/round-editor.js
import { parseRound, splitRounds } from '../training-text-parser.js';
import { buildSegments, toMovementRows, withoutExcluded } from '../training-sequence.js';
import { createMovePicker } from './move-picker.js';
import { createSegmentStrip } from './segment-strip.js';

let editorCount = 0;

function el(document, tag, { className, text, attrs = {} } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

function appendToText(current, addition) {
  const trimmed = current.replace(/\s+$/, '');
  if (!trimmed) return addition;
  return /[,(→]$/.test(trimmed) || /->$/.test(trimmed) ? `${trimmed} ${addition}` : `${trimmed}, ${addition}`;
}

export function buildRatings({ roundDifficulty, segmentRatings, segments }) {
  const byKey = new Map(segments.map((segment) => [segment.key, segment]));
  const ratings = [];
  if (roundDifficulty) {
    ratings.push({ segment_key: 'r', segment_kind: 'round', difficulty: roundDifficulty, note: null, from_movement_key: null, to_movement_key: null });
  }
  for (const [key, rating] of segmentRatings) {
    const segment = byKey.get(key);
    if (!segment) continue;
    const neighbors = ['transition', 'loop'].includes(segment.kind);
    ratings.push({
      segment_key: key, segment_kind: segment.kind, difficulty: rating.difficulty,
      note: rating.note?.trim() || null,
      from_movement_key: neighbors ? segment.from : null,
      to_movement_key: neighbors ? segment.to : null,
    });
  }
  return ratings;
}

export function createRoundEditor({
  document, i18n, mode = 'record', getTermMappings = () => [], repertoire = null, showAddButton = true,
  ratings: ratingsEnabled = true,
}) {
  editorCount += 1;
  const editorId = `round-editor-${editorCount}`;
  const element = el(document, 'div', { className: 'round-editor' });
  const list = el(document, 'div', { className: 'round-card-list' });
  const addButton = el(document, 'button', { className: 'secondary-button' });
  addButton.type = 'button';
  addButton.dataset.action = 'add-round';
  element.append(list);
  if (showAddButton) element.append(addButton);
  let cards = [];
  let cardCount = 0;

  function newCard({ sourceText = '', ratings = [], planned = [] } = {}) {
    cardCount += 1;
    const segmentRatings = new Map();
    let roundDifficulty = '';
    for (const rating of ratings) {
      if (rating.segment_key === 'r') roundDifficulty = rating.difficulty;
      else segmentRatings.set(rating.segment_key, { difficulty: rating.difficulty, note: rating.note ?? '' });
    }
    return {
      id: `${editorId}-card-${cardCount}`,
      text: sourceText,
      excluded: new Set(),
      roundDifficulty,
      segmentRatings,
      planned: planned.find(({ segment_key: key }) => key === 'r')?.difficulty ?? null,
      pickerOpen: false,
      savedOpen: false,
      stripOpen: false,
      message: '',
    };
  }

  function parsed(card) {
    const result = parseRound(card.text, { termMappings: getTermMappings() });
    const steps = withoutExcluded(result.steps, card.excluded);
    return { steps, allSteps: result.steps, warnings: result.warnings, segments: buildSegments(steps) };
  }

  function pruneRatings(card, segments) {
    const keys = new Set(segments.map(({ key }) => key));
    for (const key of [...card.segmentRatings.keys()]) if (!keys.has(key)) card.segmentRatings.delete(key);
  }

  function renderChips(container, steps, card) {
    container.replaceChildren();
    steps.forEach((step, index) => {
      if (index > 0) container.append(el(document, 'li', { className: 'chip-arrow', text: '→', attrs: { 'aria-hidden': 'true' } }));
      if (step.type === 'group') {
        const group = el(document, 'li', { className: 'chip-group' });
        group.append(el(document, 'span', { className: 'chip-group-count', text: `×${step.repeat}` }));
        const inner = el(document, 'ul', { className: 'round-chips' });
        renderChips(inner, step.steps, card);
        group.append(inner);
        container.append(group);
        return;
      }
      const chip = el(document, 'li', { className: `round-chip round-chip-${step.catalogued ? 'known' : 'new'}` });
      chip.dataset.chip = step.path;
      chip.dataset.status = step.catalogued ? 'known' : 'new';
      const label = step.reps ? `${step.name} ×${step.reps}` : step.name;
      chip.append(el(document, 'span', { text: step.catalogued ? `✓ ${label}` : `${label} · ${i18n.t('rounds.new')}` }));
      if (card.excluded.has(step.path)) chip.classList.add('round-chip-excluded');
      const exclude = el(document, 'button', { className: 'round-chip-exclude', text: '×', attrs: { 'aria-label': i18n.t('rounds.notAMove', { name: step.name }) } });
      exclude.type = 'button';
      exclude.dataset.action = 'exclude-step';
      exclude.dataset.path = step.path;
      chip.append(exclude);
      container.append(chip);
    });
  }

  function toolButton(action, key, expanded = null) {
    const button = el(document, 'button', { className: 'quiet-button', text: i18n.t(key), attrs: { 'aria-label': i18n.t(key) } });
    button.type = 'button';
    button.dataset.action = action;
    if (expanded !== null) button.setAttribute('aria-expanded', String(expanded));
    return button;
  }

  function renderCard(card, index) {
    const number = index + 1;
    const section = el(document, 'section', { className: 'round-card' });
    section.dataset.roundCard = card.id;
    const header = el(document, 'header', { className: 'round-card-header' });
    header.append(el(document, 'h3', { text: i18n.t('rounds.round', { number }) }));
    const remove = el(document, 'button', { className: 'quiet-button', text: '×', attrs: { 'aria-label': i18n.t('rounds.remove', { number }) } });
    remove.type = 'button';
    remove.dataset.action = 'remove-round';
    header.append(remove);

    const textarea = el(document, 'textarea', { className: 'field-input field-textarea', attrs: { 'aria-label': i18n.t('rounds.text', { number }), placeholder: i18n.t('rounds.placeholder'), rows: '3', maxlength: '4000' } });
    textarea.dataset.roundText = '';
    textarea.value = card.text;

    const { steps, allSteps, warnings, segments } = parsed(card);
    pruneRatings(card, segments);
    const chips = el(document, 'ul', { className: 'round-chips', attrs: { 'aria-label': i18n.t('rounds.chips') } });
    chips.dataset.roundChips = '';
    renderChips(chips, allSteps, card);
    const warning = el(document, 'p', { className: 'round-warning', text: warnings.length ? i18n.t('rounds.unbalanced') : '', attrs: { role: 'status' } });

    const difficulty = el(document, 'fieldset', { className: 'round-difficulty' });
    difficulty.dataset.roundDifficulty = '';
    difficulty.append(el(document, 'legend', { text: i18n.t(mode === 'plan' ? 'rounds.planned' : 'rounds.felt') }));
    for (const value of ['easy', 'okay', 'hard']) {
      const label = el(document, 'label');
      const radio = el(document, 'input', { attrs: { type: 'radio', name: `${card.id}-difficulty`, value } });
      radio.checked = card.roundDifficulty === value;
      label.append(radio, ` ${i18n.t(`training.${value}`)}`);
      difficulty.append(label);
    }
    if (card.planned && mode !== 'plan') {
      const planned = el(document, 'p', { className: 'round-planned', text: i18n.t('rounds.plannedValue', { difficulty: i18n.t(`training.${card.planned}`) }) });
      planned.dataset.planned = '';
      difficulty.append(planned);
    }

    const tools = el(document, 'div', { className: 'round-tools' });
    tools.append(toolButton('toggle-picker', 'rounds.addMoves', card.pickerOpen));
    if (repertoire) {
      tools.append(toolButton('toggle-saved', 'rounds.insertSaved', card.savedOpen), toolButton('save-sequence', 'rounds.saveSequence'));
    }
    if (ratingsEnabled) tools.append(toolButton('toggle-strip', 'rounds.rateParts', card.stripOpen));
    const message = el(document, 'p', { className: 'round-message', text: card.message, attrs: { role: 'status' } });

    section.append(header, textarea, chips, warning);
    if (ratingsEnabled) section.append(difficulty);
    section.append(tools, message);
    if (card.pickerOpen) {
      const picker = createMovePicker({
        document, i18n,
        onPick(entry) {
          card.text = appendToText(card.text, entry.name);
          render();
        },
      });
      section.append(picker.element);
    }
    if (card.savedOpen) {
      const saved = el(document, 'div', { className: 'round-saved' });
      saved.dataset.savedPanel = '';
      section.append(saved);
      repertoire.list().then((items) => {
        saved.replaceChildren();
        if (!items.length) {
          saved.append(el(document, 'p', { text: i18n.t('rounds.noSaved') }));
          return;
        }
        const select = el(document, 'select', { className: 'field-input', attrs: { 'aria-label': i18n.t('rounds.chooseSaved') } });
        select.dataset.savedSelect = '';
        for (const item of items) {
          const option = el(document, 'option', { text: item.title });
          option.value = item.id;
          option.dataset.text = item.source_text;
          select.append(option);
        }
        const insert = el(document, 'button', { className: 'secondary-button', text: i18n.t('rounds.insert') });
        insert.type = 'button';
        insert.dataset.action = 'insert-saved';
        saved.append(select, insert);
      }).catch(() => {
        saved.textContent = i18n.t('rounds.sequenceSaveError');
      });
    }
    if (card.stripOpen) {
      const strip = createSegmentStrip({
        document, i18n, idPrefix: card.id,
        onChange(key, rating) {
          if (rating) card.segmentRatings.set(key, rating);
          else card.segmentRatings.delete(key);
        },
      });
      strip.render(segments, card.segmentRatings);
      section.append(strip.element);
    }
    card.steps = steps;
    card.segments = segments;
    return section;
  }

  function render() {
    const focused = document.activeElement?.closest?.('[data-round-card]')?.dataset.roundCard;
    const caret = document.activeElement?.selectionStart;
    addButton.textContent = i18n.t('rounds.add');
    list.replaceChildren(...cards.map(renderCard));
    if (focused) {
      const textarea = list.querySelector(`[data-round-card="${focused}"] [data-round-text]`);
      if (textarea && typeof caret === 'number') {
        textarea.focus();
        textarea.setSelectionRange(caret, caret);
      }
    }
  }

  function cardFor(target) {
    const id = target.closest('[data-round-card]')?.dataset.roundCard;
    return cards.find((card) => card.id === id);
  }

  list.addEventListener('input', (event) => {
    if (!event.target.matches('[data-round-text]')) return;
    const card = cardFor(event.target);
    card.text = event.target.value;
    card.excluded.clear();
    const { allSteps, warnings, segments } = parsed(card);
    pruneRatings(card, segments);
    const section = event.target.closest('[data-round-card]');
    renderChips(section.querySelector('[data-round-chips]'), allSteps, card);
    section.querySelector('.round-warning').textContent = warnings.length ? i18n.t('rounds.unbalanced') : '';
    if (card.stripOpen) render();
  });

  list.addEventListener('paste', (event) => {
    if (!event.target.matches('[data-round-text]')) return;
    const pasted = event.clipboardData?.getData('text') ?? '';
    const parts = splitRounds(pasted);
    if (parts.length < 2) return;
    event.preventDefault();
    const card = cardFor(event.target);
    const index = cards.indexOf(card);
    card.text = card.text.trim() ? appendToText(card.text, parts[0]) : parts[0];
    cards.splice(index + 1, 0, ...parts.slice(1).map((part) => newCard({ sourceText: part })));
    render();
  });

  list.addEventListener('change', (event) => {
    if (!event.target.matches('[data-round-difficulty] input[type="radio"]')) return;
    cardFor(event.target).roundDifficulty = event.target.value;
  });

  list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const card = cardFor(button);
    const action = button.dataset.action;
    if (action === 'remove-round') {
      cards = cards.filter((entry) => entry !== card);
      if (!cards.length) cards.push(newCard());
      render();
    } else if (action === 'exclude-step') {
      if (card.excluded.has(button.dataset.path)) card.excluded.delete(button.dataset.path);
      else card.excluded.add(button.dataset.path);
      render();
    } else if (action === 'toggle-picker') {
      card.pickerOpen = !card.pickerOpen;
      render();
    } else if (action === 'toggle-saved') {
      card.savedOpen = !card.savedOpen;
      render();
    } else if (action === 'toggle-strip') {
      card.stripOpen = !card.stripOpen;
      render();
    } else if (action === 'insert-saved') {
      const option = button.parentElement.querySelector('[data-saved-select]').selectedOptions[0];
      card.text = appendToText(card.text, `1x (${option.dataset.text})`);
      card.savedOpen = false;
      render();
    } else if (action === 'save-sequence') {
      if (!card.text.trim()) return;
      try {
        await repertoire.save({ title: '', sourceText: card.text.trim(), sequence: parsed(card).steps });
        card.message = i18n.t('rounds.sequenceSaved');
      } catch {
        card.message = i18n.t('rounds.sequenceSaveError');
      }
      render();
    }
  });

  addButton.addEventListener('click', () => {
    cards.push(newCard());
    render();
  });

  return {
    element,
    setRounds(rounds) {
      cards = (rounds?.length ? rounds : []).map(newCard);
      render();
    },
    addRound(text = '') {
      cards.push(newCard({ sourceText: text }));
      render();
    },
    hasContent() {
      return cards.some((card) => card.text.trim());
    },
    getRounds() {
      return cards.filter((card) => card.text.trim()).map((card) => {
        const { steps, segments } = parsed(card);
        const ratings = !ratingsEnabled ? [] : buildRatings({
          roundDifficulty: card.roundDifficulty, segmentRatings: card.segmentRatings, segments,
        });
        return {
          label: null,
          source_text: card.text.trim(),
          sequence: steps,
          movements: toMovementRows(steps),
          ratings,
        };
      });
    },
    refreshCopy: render,
  };
}
