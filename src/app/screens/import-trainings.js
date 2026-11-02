// src/app/screens/import-trainings.js
// Me → Settings → Import trainings: paste a file of past trainings (date, length,
// rounds, video links, summaries, transcripts) and they become the person's own
// logs, through the same checks as logging by hand. Every training and resource
// gets a key made from its id, so importing the same file again adds nothing.
import { el, pageHeader } from '../shell/page.js';
import { toMovementRows } from '../training-sequence.js';
import { parseRound, roundDuration } from '../training-text-parser.js';

const MAX_TRAININGS = 200;
const KINDS = new Set(['video', 'summary', 'voice']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resourceFrom(item) {
  if (!item || !KINDS.has(item.kind)) return null;
  const title = text(item.title);
  if (item.kind === 'video') {
    const url = text(item.url);
    return /^https:\/\//.test(url) && url.length <= 2048 ? { kind: 'video', title, url, body: null } : null;
  }
  const body = typeof item.body === 'string' ? item.body : '';
  return body.trim() && body.length <= 262144 ? { kind: item.kind, title, url: null, body } : null;
}

export function parseImport(source, { now = new Date() } = {}) {
  let data;
  try {
    data = JSON.parse(source);
  } catch {
    return { trainings: [], errors: ['The file is not valid JSON.'] };
  }
  const list = Array.isArray(data) ? data : data?.trainings;
  if (!Array.isArray(list) || !list.length) return { trainings: [], errors: ['The file has no trainings.'] };
  if (list.length > MAX_TRAININGS) return { trainings: [], errors: [`Import at most ${MAX_TRAININGS} trainings at a time.`] };
  const errors = [];
  const seen = new Set();
  const trainings = [];
  list.forEach((item, index) => {
    const label = `Training ${index + 1}`;
    const id = text(item?.id);
    const start = new Date(item?.start);
    const durationMinutes = Number(item?.durationMinutes);
    const rounds = Array.isArray(item?.rounds) ? item.rounds.map(text).filter(Boolean) : [];
    const resources = Array.isArray(item?.resources) ? item.resources : [];
    if (!id || id.length > 100) return errors.push(`${label}: add an id.`);
    if (seen.has(id)) return errors.push(`${label}: the id ${id} is used twice.`);
    seen.add(id);
    if (Number.isNaN(start.getTime())) return errors.push(`${label}: the start time is not a date and time.`);
    if (start > now) return errors.push(`${label}: the start time is in the future.`);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 600) {
      return errors.push(`${label}: the duration must be 1 to 600 minutes.`);
    }
    if (!rounds.length) return errors.push(`${label}: add at least one round.`);
    const cleanResources = resources.map(resourceFrom);
    const bad = cleanResources.findIndex((resource) => !resource);
    if (bad >= 0) return errors.push(`${label}: resource ${bad + 1} is not a video link, summary, or transcript.`);
    trainings.push({
      id, start: start.toISOString(), durationMinutes, rounds, notes: text(item?.notes) || null, resources: cleanResources,
    });
    return null;
  });
  return { trainings: errors.length ? [] : trainings, errors };
}

// A UUID made from the training's id, so the same file always uses the same keys.
export async function importKey(id, part) {
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`roda-import:${id}:${part}`)));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function counted(i18n, key, count) {
  return i18n.t(`${key}.${count === 1 ? 'one' : 'other'}`, { count });
}

function localDate(iso, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

function roundFrom(source, termMappings) {
  const { steps } = parseRound(source, { termMappings });
  return {
    label: null, source_text: source, duration_seconds: roundDuration(source), sequence: steps, movements: toMovementRows(steps), ratings: [],
  };
}

export async function renderImport(ctx) {
  const { document, i18n } = ctx;
  const training = ctx.services.training;
  const area = el(document, 'textarea', {
    className: 'field-textarea import-file', attrs: { name: 'importFile', rows: '8', 'aria-label': i18n.t('import.paste'), spellcheck: 'false' },
  });
  const preview = el(document, 'div', { className: 'import-preview', attrs: { 'aria-live': 'polite' } });
  const run = el(document, 'button', {
    className: 'button-primary', text: i18n.t('import.button'), attrs: { type: 'button', disabled: '' }, dataset: { action: 'import' },
  });
  let parsed = { trainings: [], errors: [] };

  function showPreview() {
    parsed = parseImport(area.value, { now: ctx.now?.() ?? new Date() });
    run.disabled = !parsed.trainings.length;
    if (!area.value.trim()) {
      preview.replaceChildren();
      return;
    }
    if (parsed.errors.length) {
      preview.replaceChildren(el(document, 'ul', { className: 'import-errors' }, parsed.errors.map((error) => el(document, 'li', { text: error }))));
      return;
    }
    preview.replaceChildren(
      el(document, 'p', { className: 'muted', text: i18n.t(parsed.trainings.length === 1 ? 'import.countOne' : 'import.countMany', { count: parsed.trainings.length }) }),
      el(document, 'ul', { className: 'import-list' }, parsed.trainings.map((item) => el(document, 'li', { dataset: { importRow: item.id } }, [
        el(document, 'span', { text: `${localDate(item.start, ctx.timezone)} · ${i18n.formatDuration(item.durationMinutes)} · ${counted(i18n, 'import.rounds', item.rounds.length)} · ${counted(i18n, 'import.resources', item.resources.length)}` }),
        el(document, 'span', { className: 'import-status muted' }),
      ]))),
    );
  }

  async function importOne(item) {
    const result = await training.recordAloneTraining({
      localDate: localDate(item.start, ctx.timezone),
      timezone: ctx.timezone,
      durationMinutes: item.durationMinutes,
      notes: item.notes,
      rounds: item.rounds.map((source) => roundFrom(source, ctx.getTermMappings?.() ?? [])),
      idempotencyKey: await importKey(item.id, 'training'),
      occurredAt: item.start,
    });
    for (const [index, resource] of item.resources.entries()) {
      await training.addResource({ occurrenceId: result.occurrence_id, ...resource, clientKey: await importKey(item.id, `resource-${index}`) });
    }
  }

  run.addEventListener('click', async () => {
    run.disabled = true;
    area.disabled = true;
    for (const item of parsed.trainings) {
      const status = preview.querySelector(`[data-import-row="${CSS.escape(item.id)}"] .import-status`);
      status.textContent = i18n.t('log.saving');
      try {
        await importOne(item);
        status.textContent = `✓ ${i18n.t('import.done')}`;
      } catch (error) {
        status.textContent = `✗ ${error?.message || i18n.t('app.loadError')}`;
      }
    }
    area.disabled = false;
    run.disabled = false;
  });
  area.addEventListener('input', showPreview);

  return el(document, 'section', { className: 'screen screen-import' }, [
    pageHeader({ document, title: i18n.t('import.title'), backLabel: i18n.t('app.back'), onBack: () => ctx.back('/me/settings') }),
    el(document, 'p', { className: 'muted', text: i18n.t('import.intro') }),
    area, preview, run,
  ]);
}
