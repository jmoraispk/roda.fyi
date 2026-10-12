// src/app/screens/log.js
import { normalizeResource } from '../training-service.js';
import { splitRounds } from '../training-text-parser.js';
import { el, pageHeader } from '../shell/page.js';
import { createMovePicker } from '../ui/move-picker.js';
import { RESOURCE_ICONS } from '../ui/resource-view.js';
import { createRoundEditor } from '../ui/round-editor.js';
import { createChatBox } from './chat-box.js';
import { clearDraft, loadDraft, saveDraft } from './log-draft.js';
import { defaultStartTime, startInstant } from './start-time.js';

function addDaysIso(iso, amount) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

const DURATIONS = [15, 30, 45, 60, 75, 90, 120, 150, 180];

export async function renderLog(ctx) {
  const { document, window, i18n, profile } = ctx;
  const storage = window.localStorage;
  const training = ctx.services.training;
  const todayIso = ctx.today();
  const saved = loadDraft(storage, profile.id);
  const state = {
    localDate: saved?.localDate ?? todayIso,
    durationMinutes: saved?.durationMinutes ?? 45,
    notes: saved?.notes ?? '',
    resources: saved?.resources ?? [],
    idempotencyKey: saved?.idempotencyKey ?? training.createIdempotencyKey(),
    startTime: saved?.startTime ?? null,
    startTouched: saved?.startTouched ?? false,
  };
  const now = () => ctx.now?.() ?? new Date();
  const startFor = () => defaultStartTime({ now: now(), timezone: ctx.timezone, durationMinutes: state.durationMinutes });
  if (!state.startTime) state.startTime = startFor();
  let saving = false;
  let finished = false;

  const editor = createRoundEditor({ document, i18n, mode: 'record', getTermMappings: ctx.getTermMappings, showAddButton: false });
  editor.setRounds(saved?.rounds ?? []);
  const screen = el(document, 'section', { className: 'screen screen-log' });
  const status = el(document, 'p', { className: 'log-status', attrs: { role: 'status' } });

  function currentRounds() {
    return editor.getRounds().map((round) => ({ sourceText: round.source_text, ratings: round.ratings }));
  }
  let timer = null;
  function persist() {
    if (finished) return;
    clearTimeout(timer);
    timer = setTimeout(() => saveDraft(storage, profile.id, { ...state, rounds: currentRounds() }), 250);
  }
  function persistNow() {
    if (finished) return;
    clearTimeout(timer);
    saveDraft(storage, profile.id, { ...state, rounds: currentRounds() });
  }
  function addRounds(texts) {
    editor.setRounds([...currentRounds(), ...texts.map((sourceText) => ({ sourceText }))]);
    hint.hidden = true;
    persistNow();
  }

  const dateInput = el(document, 'input', { className: 'chip-input', attrs: { type: 'date', 'aria-label': i18n.t('log.date'), max: todayIso } });
  dateInput.value = state.localDate;
  const dateChips = [['today', todayIso], ['yesterday', addDaysIso(todayIso, -1)]].map(([name, value]) => el(document, 'button', {
    className: 'chip', text: i18n.t(`log.${name}`), attrs: { type: 'button' }, dataset: { chip: name },
  }));
  function syncDate() {
    dateChips[0].setAttribute('aria-pressed', String(state.localDate === todayIso));
    dateChips[1].setAttribute('aria-pressed', String(state.localDate === addDaysIso(todayIso, -1)));
    dateInput.value = state.localDate;
  }
  dateChips[0].addEventListener('click', () => { state.localDate = todayIso; syncDate(); persist(); });
  dateChips[1].addEventListener('click', () => { state.localDate = addDaysIso(todayIso, -1); syncDate(); persist(); });
  dateInput.addEventListener('change', () => { if (dateInput.value) state.localDate = dateInput.value; syncDate(); persist(); });
  syncDate();
  const duration = el(document, 'select', { className: 'chip-input', attrs: { 'aria-label': i18n.t('log.duration') } },
    [...new Set([...DURATIONS, state.durationMinutes])].sort((a, b) => a - b).map((minutes) => {
      const option = el(document, 'option', { text: i18n.formatDuration(minutes), attrs: { value: String(minutes) } });
      option.selected = minutes === state.durationMinutes;
      return option;
    }));
  const startInput = el(document, 'input', {
    className: 'chip-input', attrs: { type: 'time', step: '300', 'aria-label': i18n.t('log.startTime') }, dataset: { chip: 'start' },
  });
  startInput.value = state.startTime;
  startInput.addEventListener('change', () => {
    if (startInput.value) {
      state.startTime = startInput.value;
      state.startTouched = true;
    } else {
      startInput.value = state.startTime;
    }
    persist();
  });
  duration.addEventListener('change', () => {
    state.durationMinutes = Number(duration.value);
    if (!state.startTouched) {
      state.startTime = startFor();
      startInput.value = state.startTime;
    }
    persist();
  });

  const hint = el(document, 'p', { className: 'muted log-hint', text: i18n.t('log.hint') });
  hint.hidden = currentRounds().length > 0;
  const chat = createChatBox({ document, i18n, onSubmit: (text) => {
    const parts = splitRounds(text);
    addRounds(parts.length ? parts : [text]);
  } });

  const resourceList = el(document, 'div', { className: 'log-resources' });
  function renderResources() {
    resourceList.replaceChildren(...state.resources.map((resource, index) => {
      const name = i18n.t(`resources.${resource.kind}`);
      return el(document, 'button', { className: 'chip log-resource', text: `${RESOURCE_ICONS[resource.kind]} ${name} ×`,
        attrs: { type: 'button', 'aria-label': i18n.t('log.remove', { name }) },
        on: { click: () => { state.resources.splice(index, 1); renderResources(); persistNow(); } } });
    }));
  }
  renderResources();

  function resourceSheet(kind) {
    const fields = kind === 'video'
      ? [el(document, 'input', { className: 'field-input', attrs: { name: 'url', type: 'url', 'aria-label': i18n.t('resources.link'), placeholder: 'https://' } })]
      : [el(document, 'textarea', { className: 'field-input field-textarea', attrs: { name: 'body', 'aria-label': i18n.t('resources.text') } })];
    const title = el(document, 'input', { className: 'field-input', attrs: { name: 'title', 'aria-label': i18n.t('resources.itemTitle'), placeholder: i18n.t('resources.itemTitle') } });
    const error = el(document, 'p', { attrs: { role: 'status' } });
    const form = el(document, 'form', { className: 'log-resource-form' }, [...fields, title,
      el(document, 'button', { className: 'button-primary', text: i18n.t('log.add'), attrs: { type: 'submit' } }), error]);
    const sheet = ctx.openSheet({ title: i18n.t(`resources.${kind}`), content: form });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const resource = { kind, title: title.value.trim(), url: form.elements.url?.value ?? null, body: form.elements.body?.value ?? null };
      try {
        normalizeResource(resource);
      } catch (problem) {
        error.textContent = problem.message;
        return;
      }
      state.resources.push(resource);
      renderResources();
      persistNow();
      sheet.close();
    });
  }

  function notesSheet() {
    const textarea = el(document, 'textarea', { className: 'field-input field-textarea', attrs: { 'aria-label': i18n.t('log.notes'), maxlength: '4000' } });
    textarea.value = state.notes;
    textarea.addEventListener('input', () => { state.notes = textarea.value; persist(); });
    ctx.openSheet({ title: i18n.t('log.notes'), content: textarea });
  }

  function movesSheet() {
    const picker = createMovePicker({ document, i18n, onPick: (entry) => chat.insert(entry.name) });
    ctx.openSheet({ title: i18n.t('log.moves'), content: picker.element, onClose: () => chat.focus() });
  }

  async function savedSheet() {
    const list = el(document, 'div', { className: 'day-items' }, [el(document, 'p', { className: 'muted', text: i18n.t('app.loading') })]);
    const sheet = ctx.openSheet({ title: i18n.t('log.saved'), content: list });
    try {
      const items = await ctx.services.repertoire.list();
      list.replaceChildren(...(items.length ? items.map((item) => el(document, 'button', {
        className: 'card day-item', attrs: { type: 'button' }, dataset: { sequence: item.id },
        on: { click: () => { addRounds([item.source_text]); sheet.close(); } },
      }, [el(document, 'div', {}, [el(document, 'strong', { text: item.title }), el(document, 'div', { className: 'muted', text: item.source_text })])]))
        : [el(document, 'p', { className: 'muted', text: i18n.t('log.noSaved') })]));
    } catch (error) {
      list.replaceChildren(el(document, 'p', { className: 'muted', text: error?.message || i18n.t('app.loadError') }));
    }
  }

  const chips = el(document, 'div', { className: 'chip-row log-tools' }, [
    ['moves', `🥋 ${i18n.t('log.moves')}`, movesSheet], ['saved', `📚 ${i18n.t('log.saved')}`, savedSheet],
    ['notes', `📝 ${i18n.t('log.notes')}`, notesSheet], ['link', `🎥 ${i18n.t('log.link')}`, () => resourceSheet('video')],
    ['transcript', `🎙️ ${i18n.t('log.transcript')}`, () => resourceSheet('voice')], ['summary', `📄 ${i18n.t('log.summary')}`, () => resourceSheet('summary')],
  ].map(([name, text, action]) => el(document, 'button', { className: 'chip', text, attrs: { type: 'button' }, dataset: { chip: name }, on: { click: action } })));

  const saveButton = el(document, 'button', { className: 'button-primary log-save', text: i18n.t('log.save'), attrs: { type: 'button' }, dataset: { action: 'save' } });
  saveButton.addEventListener('click', async () => {
    if (saving) return;
    const rounds = editor.getRounds();
    if (!rounds.length) {
      status.textContent = i18n.t('alone.needRound');
      return;
    }
    const start = startInstant({ localDate: state.localDate, startTime: state.startTime, timezone: ctx.timezone, now: now() });
    if (start.error) {
      status.textContent = i18n.t(start.error);
      return;
    }
    saving = true;
    saveButton.disabled = true;
    saveButton.textContent = i18n.t('log.saving');
    status.textContent = '';
    persistNow();
    try {
      const result = await training.recordAloneTraining({
        localDate: state.localDate, timezone: ctx.timezone, durationMinutes: state.durationMinutes,
        notes: state.notes, rounds, idempotencyKey: state.idempotencyKey,
        occurredAt: start.occurredAt,
      });
      const pending = state.resources.map((resource) => ({ occurrenceId: result.occurrence_id, ...resource }));
      while (pending.length) {
        try {
          await training.addResource(pending[0]);
          pending.shift();
        } catch {
          try {
            storage.setItem(`roda.pendingResources:${result.occurrence_id}`, JSON.stringify(pending));
          } catch {
            // The training page shows nothing to retry when storage is blocked.
          }
          break;
        }
      }
      finished = true;
      clearTimeout(timer);
      clearDraft(storage, profile.id);
      ctx.navigate(`/training/${result.occurrence_id}`);
    } catch (error) {
      status.textContent = error?.message || i18n.t('alone.saveError');
    } finally {
      saving = false;
      saveButton.disabled = false;
      saveButton.textContent = i18n.t('log.save');
    }
  });

  screen.addEventListener('input', persist);
  screen.addEventListener('change', persist);
  screen.addEventListener('click', persist);
  screen.append(
    pageHeader({ document, title: i18n.t('log.title'), backLabel: i18n.t('app.close'), onBack: () => ctx.back('/') }),
    el(document, 'div', { className: 'chip-row' }, [...dateChips, dateInput, startInput, duration]),
    hint, editor.element, resourceList, chips, status,
    el(document, 'div', { className: 'log-dock' }, [chat.element, saveButton]),
  );
  return screen;
}
