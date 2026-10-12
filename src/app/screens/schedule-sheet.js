// src/app/screens/schedule-sheet.js
import { scheduledInstant } from '../time-zones.js';
import { el } from '../shell/page.js';
import { loadTeaching, studentContext } from './teaching-state.js';

function field(document, label, control) {
  return el(document, 'label', { className: 'field-label' }, [label, control]);
}

function timeProblem(error) {
  return String(error?.message).includes('does not exist') ? 'coach.nonexistentTime' : 'coach.invalidDateTime';
}

function help(ctx, { messageKey, buttonKey, path, close }) {
  const { document, i18n } = ctx;
  return el(document, 'div', {}, [
    el(document, 'p', { className: 'muted', text: i18n.t(messageKey) }),
    el(document, 'button', {
      className: 'button-secondary', text: i18n.t(buttonKey), attrs: { type: 'button' }, dataset: { action: 'schedule-help' },
      on: { click: () => { close(); ctx.navigate(path); } },
    }),
  ]);
}

function buildForm(ctx, teaching, { planVersionId, target, onScheduled, close }) {
  const { document, i18n } = ctx;
  const plans = teaching.plans.filter((plan) => plan.state === 'published');
  const targets = [
    ...teaching.groups.map((group) => [`group:${group.id}`, i18n.t('schedule.groupOption', { name: group.name })]),
    ...teaching.students.map((student) => [`student:${student.profileId}`, i18n.t('schedule.studentOption', { name: student.name })]),
  ];
  if (!plans.length) return help(ctx, { messageKey: 'schedule.needPlan', buttonKey: 'teaching.newPlan', path: '/me/teaching/plans/new', close });
  if (!targets.length) return help(ctx, { messageKey: 'schedule.needPeople', buttonKey: 'app.groups', path: '/me/groups', close });

  const option = ([value, text]) => el(document, 'option', { text, attrs: { value } });
  const plan = el(document, 'select', { className: 'field-input', attrs: { name: 'plan' } },
    plans.map(({ version_id: id, title }) => option([id, title])));
  if (planVersionId && plans.some(({ version_id: id }) => id === planVersionId)) plan.value = planVersionId;
  const who = el(document, 'select', { className: 'field-input', attrs: { name: 'who' } }, targets.map(option));
  if (target && targets.some(([value]) => value === target)) who.value = target;
  const date = el(document, 'input', { className: 'field-input', attrs: { type: 'date', name: 'date', min: ctx.today(), required: true } });
  date.value = ctx.today();
  const time = el(document, 'input', { className: 'field-input', attrs: { type: 'time', name: 'time', step: '300', required: true } });
  time.value = '19:00';
  const visible = el(document, 'input', { attrs: { type: 'checkbox', name: 'visible' } });
  visible.checked = true;
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  const submit = el(document, 'button', { className: 'button-primary', text: i18n.t('schedule.submit'), attrs: { type: 'submit' } });
  const form = el(document, 'form', { className: 'sheet-form', attrs: { novalidate: true } }, [
    field(document, i18n.t('schedule.plan'), plan),
    field(document, i18n.t('schedule.who'), who),
    field(document, i18n.t('schedule.date'), date),
    field(document, i18n.t('schedule.time'), time),
    el(document, 'label', { className: 'check-row' }, [visible, ` ${i18n.t('schedule.visible')}`]),
    status, submit,
  ]);
  let busy = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    status.textContent = '';
    let startsAt;
    try {
      startsAt = scheduledInstant(date.value, time.value, ctx.timezone);
    } catch (error) {
      status.textContent = i18n.t(timeProblem(error));
      return;
    }
    if (new Date(startsAt) <= ctx.now()) {
      status.textContent = i18n.t('schedule.past');
      return;
    }
    busy = true;
    submit.disabled = true;
    const [kind, id] = who.value.split(':');
    const common = {
      planVersionId: plan.value, localDate: date.value, startsAt, timezone: ctx.timezone, visibleInAdvance: visible.checked,
    };
    try {
      const result = kind === 'group'
        ? await ctx.services.training.scheduleGroupTraining({ ...common, groupId: id })
        : await ctx.services.training.schedulePersonalClass({
          ...common, studentProfileId: id,
          ...studentContext(teaching.students.find(({ profileId }) => profileId === id)),
        });
      close();
      onScheduled(result);
    } catch (error) {
      status.textContent = error?.message || i18n.t('coach.scheduleSaveError');
    } finally {
      busy = false;
      submit.disabled = false;
    }
  });
  return form;
}

// Ruling R8: a bottom sheet; with no `teaching` given it loads the data itself.
export function openScheduleSheet(ctx, {
  teaching = null, planVersionId = null, target = null,
  onScheduled = (result) => ctx.navigate(`/class/${result.schedule_id}`),
} = {}) {
  const { document, i18n } = ctx;
  const body = el(document, 'div', { className: 'schedule-sheet' }, [
    el(document, 'p', { className: 'muted', text: i18n.t('app.loading') }),
  ]);
  const sheet = ctx.openSheet({ title: i18n.t('schedule.title'), content: body });
  Promise.resolve(teaching ?? loadTeaching(ctx)).then((data) => {
    if (!body.isConnected) return;
    body.replaceChildren(buildForm(ctx, data, { planVersionId, target, onScheduled, close: () => sheet.close() }));
    body.querySelector('select, button')?.focus();
  }).catch((error) => {
    if (body.isConnected) body.replaceChildren(el(document, 'p', { className: 'muted', text: error?.message || i18n.t('app.loadError') }));
  });
  return sheet;
}
