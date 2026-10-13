// src/app/screens/record-class.js
import { normalizeResource } from '../training-service.js';
import { splitRounds } from '../training-text-parser.js';
import { el, pageHeader } from '../shell/page.js';
import { createRoundEditor } from '../ui/round-editor.js';
import { createChatBox } from './chat-box.js';
import { saveResourcesOrQueue } from './resource-queue.js';
import { defaultStartTime, startInstant } from './start-time.js';
import { loadTeaching, studentContext } from './teaching-state.js';

function field(document, label, control) {
  return el(document, 'label', { className: 'field-label' }, [label, control]);
}

function choice(document, name, label, options) {
  const node = el(document, 'select', { className: 'field-input', attrs: { name } },
    options.map(([value, text]) => el(document, 'option', { text, attrs: { value } })));
  return { node, field: field(document, label, node) };
}

// Ruling R7: a full page; resources that fail to save wait on the training page.
export async function renderRecordClass(ctx) {
  const { document, i18n } = ctx;
  const training = ctx.services.training;
  const screen = el(document, 'section', { className: 'screen screen-record' }, [
    pageHeader({ document, title: i18n.t('record.title'), backLabel: i18n.t('app.back'), onBack: () => ctx.back('/me/teaching') }),
  ]);
  let teaching;
  try {
    teaching = await loadTeaching(ctx);
  } catch (error) {
    screen.append(el(document, 'p', { className: 'muted', text: error?.message || i18n.t('app.loadError') }));
    return screen;
  }
  const kinds = [...(teaching.groups.length ? ['group'] : []), ...(teaching.students.length ? ['personal_class'] : [])];
  if (!kinds.length) {
    screen.append(
      el(document, 'p', { className: 'muted', text: i18n.t('schedule.needPeople') }),
      el(document, 'a', { className: 'button-secondary', text: i18n.t('app.groups'), attrs: { href: '#/me/groups' } }),
    );
    return screen;
  }
  let kind = kinds[0];
  let saving = false;
  const idempotencyKey = training.createIdempotencyKey();
  // One key per resource kind for the whole page, so pressing Save again after
  // a failure never adds a resource twice.
  const resourceKeys = {
    video: training.createIdempotencyKey(), summary: training.createIdempotencyKey(), voice: training.createIdempotencyKey(),
  };

  const kindButtons = kinds.map((value) => el(document, 'button', {
    text: i18n.t(value === 'group' ? 'training.group' : 'training.personalClass'),
    attrs: { type: 'button' }, dataset: { kind: value }, on: { click: () => { kind = value; sync(); } },
  }));
  const group = choice(document, 'group', i18n.t('record.group'), teaching.groups.map(({ id, name }) => [id, name]));
  const student = choice(document, 'student', i18n.t('record.student'), teaching.students.map(({ profileId, name }) => [profileId, name]));
  const attendees = el(document, 'fieldset', { className: 'attendance-list' });
  function renderAttendees() {
    const members = (teaching.rosters[group.node.value] ?? []).filter((member) => member.access_level === 'member'
      && (member.membership_state ?? 'active') === 'active' && member.profile_id !== ctx.profile.id);
    attendees.replaceChildren(el(document, 'legend', { text: i18n.t('record.attendees') }), ...members.map((member) => {
      const box = el(document, 'input', { attrs: { type: 'checkbox', name: 'attendee', value: member.profile_id } });
      box.checked = true;
      return el(document, 'label', { className: 'check-row' }, [box, ` ${member.display_name}`]);
    }));
  }
  function sync() {
    for (const button of kindButtons) button.setAttribute('aria-pressed', String(button.dataset.kind === kind));
    group.field.hidden = kind !== 'group';
    attendees.hidden = kind !== 'group';
    student.field.hidden = kind !== 'personal_class';
  }
  group.node.addEventListener('change', renderAttendees);
  renderAttendees();
  sync();

  const date = el(document, 'input', { className: 'field-input', attrs: { type: 'date', name: 'date', max: ctx.today() } });
  date.value = ctx.today();
  const time = el(document, 'input', { className: 'field-input', attrs: { type: 'time', name: 'time', step: '300' } });
  time.value = defaultStartTime({ now: ctx.now(), timezone: ctx.timezone, durationMinutes: 60 });
  const duration = el(document, 'input', { className: 'field-input', attrs: { type: 'number', name: 'duration', min: '1', max: '1440', inputmode: 'numeric' } });
  duration.value = '60';

  const editor = createRoundEditor({ document, i18n, mode: 'record', getTermMappings: ctx.getTermMappings, ratings: false, showAddButton: false });
  const chat = createChatBox({ document, i18n, onSubmit: (text) => {
    const parts = splitRounds(text);
    editor.setRounds([
      ...editor.getRounds().map((round) => ({ sourceText: round.source_text })),
      ...(parts.length ? parts : [text]).map((sourceText) => ({ sourceText })),
    ]);
  } });

  const video = el(document, 'input', { className: 'field-input', attrs: { type: 'url', name: 'videoLink', placeholder: 'https://' } });
  const summary = el(document, 'textarea', { className: 'field-input field-textarea', attrs: { name: 'summary' } });
  const transcript = el(document, 'textarea', { className: 'field-input field-textarea', attrs: { name: 'transcript' } });
  const resources = el(document, 'details', { className: 'record-resources' }, [
    el(document, 'summary', { text: `📎 ${i18n.t('resources.add')}` }),
    field(document, i18n.t('pastClass.videoLink'), video),
    field(document, i18n.t('pastClass.summary'), summary),
    field(document, i18n.t('pastClass.transcript'), transcript),
  ]);
  const status = el(document, 'p', { className: 'log-status', attrs: { role: 'status' } });
  const save = el(document, 'button', { className: 'button-primary log-save', text: i18n.t('record.save'), attrs: { type: 'button' }, dataset: { action: 'save' } });

  save.addEventListener('click', async () => {
    if (saving) return;
    status.textContent = '';
    const rounds = editor.getRounds();
    if (!rounds.length) {
      status.textContent = i18n.t('alone.needRound');
      return;
    }
    const start = startInstant({ localDate: date.value, startTime: time.value, timezone: ctx.timezone, now: ctx.now() });
    if (start.error) {
      status.textContent = i18n.t(start.error);
      return;
    }
    const minutes = Number(duration.value);
    const extras = [['video', video.value, null], ['summary', null, summary.value], ['voice', null, transcript.value]]
      .filter(([, url, body]) => (url ?? body ?? '').trim())
      .map(([resourceKind, url, body]) => ({ kind: resourceKind, title: '', url, body, clientKey: resourceKeys[resourceKind] }));
    try {
      extras.forEach((resource) => normalizeResource(resource));
    } catch (problem) {
      status.textContent = problem.message;
      return;
    }
    const checked = [...attendees.querySelectorAll('input[name="attendee"]:checked')]
      .map((box) => ({ profileId: box.value, durationMinutes: minutes }));
    if (kind === 'group' && !checked.length) {
      status.textContent = i18n.t('classPage.nobody');
      return;
    }
    const chosen = teaching.students.find(({ profileId }) => profileId === student.node.value);
    const context = kind === 'group' ? { groupId: group.node.value, connectionId: null } : studentContext(chosen);
    saving = true;
    save.disabled = true;
    save.textContent = i18n.t('pastClass.saving');
    try {
      const result = await training.recordPastClass({
        kind, groupId: context.groupId, connectionId: context.connectionId,
        studentProfileId: kind === 'personal_class' ? chosen.profileId : null,
        occurredAt: start.occurredAt, localDate: date.value, timezone: ctx.timezone, durationMinutes: minutes,
        attendees: kind === 'group' ? checked : [], rounds, idempotencyKey,
      }, ctx.now());
      await saveResourcesOrQueue({ storage: ctx.window.localStorage, service: training, occurrenceId: result.occurrence_id, resources: extras });
      ctx.navigate(`/training/${result.occurrence_id}`);
    } catch (error) {
      status.textContent = error?.message || i18n.t('record.saveError');
    } finally {
      saving = false;
      save.disabled = false;
      save.textContent = i18n.t('record.save');
    }
  });

  screen.append(
    el(document, 'div', { className: 'segmented', attrs: { role: 'group', 'aria-label': i18n.t('record.kind') } }, kindButtons),
    group.field, attendees, student.field,
    el(document, 'div', { className: 'record-when' }, [
      field(document, i18n.t('pastClass.date'), date),
      field(document, i18n.t('log.startTime'), time),
      field(document, i18n.t('pastClass.duration'), duration),
    ]),
    el(document, 'h2', { className: 'section-label', text: i18n.t('trainingPage.rounds') }),
    editor.element, resources, status,
    el(document, 'div', { className: 'log-dock' }, [chat.element, save]),
  );
  return screen;
}
