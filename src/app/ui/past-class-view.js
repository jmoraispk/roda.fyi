// src/app/ui/past-class-view.js
import { scheduledInstant } from '../time-zones.js';
import { createRoundEditor } from './round-editor.js';
import { normalizeResource } from '../training-service.js';

function labelled(document, text, control) {
  const label = document.createElement('label');
  label.className = 'field-label';
  label.append(text, control);
  return label;
}

export function createPastClassView({
  document, i18n, trainingService, timezone, getContext, getStudents, getRoster, getTermMappings, onRecorded,
}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'profile-dialog group-dialog';
  dialog.setAttribute('aria-label', i18n.t('pastClass.title'));
  const form = document.createElement('form');
  form.dataset.pastClassForm = '';
  dialog.append(form);
  document.body.append(dialog);
  const rounds = createRoundEditor({ document, i18n, mode: 'record', getTermMappings, ratings: false });
  let idempotencyKey = null;
  // Resources already saved for this class, so a retry does not add them twice.
  let addedResources = new Set();
  let saving = false;

  function input(type, name, extra = {}) {
    return Object.assign(document.createElement(type === 'textarea' ? 'textarea' : 'input'), {
      ...(type === 'textarea' ? {} : { type }), name, className: type === 'textarea' ? 'field-input field-textarea' : 'field-input', ...extra,
    });
  }

  function render() {
    const { groupId } = getContext();
    const students = getStudents();
    form.replaceChildren();
    const close = Object.assign(document.createElement('button'), { type: 'button', className: 'profile-close', textContent: '×' });
    close.dataset.action = 'close-past-class';
    close.setAttribute('aria-label', i18n.t('pastClass.close'));
    const heading = Object.assign(document.createElement('h1'), { textContent: i18n.t('pastClass.title') });
    const kind = Object.assign(document.createElement('select'), { name: 'kind', className: 'field-input' });
    if (groupId) kind.append(Object.assign(document.createElement('option'), { value: 'group', textContent: i18n.t('pastClass.group') }));
    if (students.length) kind.append(Object.assign(document.createElement('option'), { value: 'personal_class', textContent: i18n.t('pastClass.personal') }));
    const student = Object.assign(document.createElement('select'), { name: 'student', className: 'field-input' });
    for (const entry of students) {
      student.append(Object.assign(document.createElement('option'), { value: entry.profileId, textContent: entry.name }));
    }
    const attendees = document.createElement('fieldset');
    attendees.className = 'attendance-list';
    attendees.append(Object.assign(document.createElement('legend'), { textContent: i18n.t('pastClass.attendees') }));
    for (const member of getRoster().filter(({ access_level: level }) => level === 'member')) {
      const box = Object.assign(document.createElement('input'), { type: 'checkbox', name: 'attendee', value: member.profile_id, checked: true });
      const label = document.createElement('label');
      label.append(box, ` ${member.display_name}`);
      attendees.append(label);
    }
    const studentField = labelled(document, i18n.t('pastClass.student'), student);
    const syncKind = () => {
      studentField.hidden = kind.value !== 'personal_class';
      attendees.hidden = kind.value !== 'group';
    };
    kind.addEventListener('change', syncKind);
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const save = Object.assign(document.createElement('button'), { type: 'submit', className: 'primary-button', textContent: i18n.t('pastClass.save') });
    form.append(
      close, heading,
      labelled(document, i18n.t('pastClass.kind'), kind), studentField,
      labelled(document, i18n.t('pastClass.date'), input('date', 'date', { required: true })),
      labelled(document, i18n.t('pastClass.time'), input('time', 'time', { required: true })),
      labelled(document, i18n.t('pastClass.duration'), input('number', 'duration', { required: true, min: '1', max: '1440', value: '60' })),
      attendees, rounds.element,
      labelled(document, i18n.t('pastClass.videoLink'), input('url', 'videoLink')),
      labelled(document, i18n.t('pastClass.summary'), input('textarea', 'summary')),
      labelled(document, i18n.t('pastClass.transcript'), input('textarea', 'transcript')),
      status, save,
    );
    if (!kind.options.length) status.textContent = i18n.t('pastClass.noStudents');
    save.disabled = !kind.options.length;
    syncKind();
  }

  async function submit() {
    if (saving) return;
    const status = form.querySelector('[role="status"]');
    const save = form.querySelector('button[type="submit"]');
    const elements = form.elements;
    const kind = elements.kind.value;
    const duration = Number(elements.duration.value);
    status.textContent = '';
    saving = true;
    save.disabled = true;
    save.textContent = i18n.t('pastClass.saving');
    try {
      const resources = [
        ['video', elements.videoLink.value, null],
        ['summary', null, elements.summary.value],
        ['voice', null, elements.transcript.value],
      ].filter(([, url, body]) => (url ?? body ?? '').trim());
      resources.forEach(([resourceKind, url, body]) => normalizeResource({ kind: resourceKind, url, body }));
      const occurredAt = scheduledInstant(elements.date.value, elements.time.value, timezone);
      const student = getStudents().find(({ profileId }) => profileId === elements.student.value);
      const result = await trainingService.recordPastClass({
        kind,
        groupId: kind === 'group' ? getContext().groupId : student?.groupId ?? null,
        studentProfileId: kind === 'personal_class' ? student?.profileId : null,
        connectionId: kind === 'personal_class' ? student?.connectionId ?? null : null,
        occurredAt, localDate: elements.date.value, timezone, durationMinutes: duration,
        attendees: kind === 'group'
          ? [...form.querySelectorAll('input[name="attendee"]:checked')].map((box) => ({ profileId: box.value, durationMinutes: duration }))
          : [],
        rounds: rounds.getRounds(),
        idempotencyKey,
      });
      try {
        for (const [resourceKind, url, body] of resources) {
          const signature = JSON.stringify([result.occurrence_id, resourceKind, url, body]);
          if (addedResources.has(signature)) continue;
          await trainingService.addResource({ occurrenceId: result.occurrence_id, kind: resourceKind, title: '', url, body });
          addedResources.add(signature);
        }
      } catch {
        status.textContent = i18n.t('pastClass.resourceError');
        await onRecorded(result);
        return;
      }
      idempotencyKey = null;
      dialog.close();
      await onRecorded(result);
    } catch (error) {
      status.textContent = error?.message || i18n.t('pastClass.resourceError');
    } finally {
      saving = false;
      save.disabled = false;
      save.textContent = i18n.t('pastClass.save');
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });
  form.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="close-past-class"]')) dialog.close();
  });

  return {
    open() {
      idempotencyKey = trainingService.createIdempotencyKey();
      addedResources = new Set();
      render();
      rounds.setRounds([{ sourceText: '' }]);
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    },
    close() {
      if (dialog.open) dialog.close();
    },
  };
}
