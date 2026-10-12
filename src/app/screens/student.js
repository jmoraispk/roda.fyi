// src/app/screens/student.js
import { roundText } from '../training-plan-state.js';
import { el, pageHeader } from '../shell/page.js';
import { confirmButton } from './confirm-button.js';
import { openScheduleSheet } from './schedule-sheet.js';
import { loadTeaching } from './teaching-state.js';
import { kindLabel } from './today-state.js';

function addDaysIso(iso, amount) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function feedbackQuote(document, entry) {
  return el(document, 'blockquote', { className: 'feedback' }, [
    el(document, 'p', { text: entry.body }),
    el(document, 'cite', { className: 'muted', text: entry.coach_name ?? '' }),
  ]);
}

function feedbackForm(ctx, entry, list) {
  const { document, i18n } = ctx;
  const context = el(document, 'select', { className: 'field-input', attrs: { name: 'context' } },
    entry.feedback_contexts.map((option) => el(document, 'option', { text: option.label, attrs: { value: `${option.kind}:${option.id}` } })));
  const body = el(document, 'textarea', { className: 'field-input field-textarea', attrs: { name: 'body', maxlength: '4000' } });
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  const submit = el(document, 'button', { className: 'button-primary', text: i18n.t('training.addFeedback'), attrs: { type: 'submit' } });
  const form = el(document, 'form', { className: 'sheet-form', dataset: { feedback: entry.participation_id } }, [
    entry.feedback_contexts.length > 1 ? el(document, 'label', { className: 'field-label' }, [i18n.t('training.feedbackContext'), context]) : null,
    el(document, 'label', { className: 'field-label' }, [i18n.t('training.feedbackBody'), body]),
    status, submit,
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!body.value.trim()) return;
    const [kind, id] = context.value.split(':');
    submit.disabled = true;
    status.textContent = '';
    try {
      await ctx.services.training.addFeedback({
        participationId: entry.participation_id,
        groupId: kind === 'group' ? id : null,
        connectionId: kind === 'connection' ? id : null,
        body: body.value,
      });
      list.append(feedbackQuote(document, { body: body.value.trim(), coach_name: ctx.profile.display_name }));
      body.value = '';
      status.textContent = i18n.t('coach.feedbackSaved');
    } catch (error) {
      status.textContent = error?.message || i18n.t('coach.feedbackSaveError');
    } finally {
      submit.disabled = false;
    }
  });
  return form;
}

async function openDay(ctx, studentId, item) {
  const { document, i18n } = ctx;
  const content = el(document, 'div', { className: 'student-day' }, [el(document, 'p', { className: 'muted', text: i18n.t('app.loading') })]);
  ctx.openSheet({ title: i18n.formatDate(`${item.local_date}T12:00:00`, { weekday: 'long', day: 'numeric', month: 'long' }), content });
  try {
    const day = await ctx.services.training.getDay({ localDate: item.local_date, profileId: studentId });
    const entry = day.find((candidate) => (candidate.occurrence_id ?? candidate.id) === item.item_id);
    if (!entry) {
      content.replaceChildren(el(document, 'p', { className: 'muted', text: i18n.t('student.dayEmpty') }));
      return;
    }
    const list = el(document, 'div', { className: 'feedback-list' }, (entry.feedback ?? []).map((feedback) => feedbackQuote(document, feedback)));
    content.replaceChildren(...[
      el(document, 'p', { className: 'muted', text: `${kindLabel(i18n, entry.kind)} · ${i18n.formatDuration(entry.duration_minutes)}` }),
      el(document, 'ol', { className: 'chapters' }, (entry.rounds ?? []).map((round, index) => el(document, 'li', { className: 'chapter' }, [
        el(document, 'span', { className: 'chapter-number', text: String(index + 1) }),
        el(document, 'span', { className: 'chapter-text', text: roundText(round) }),
      ]))),
      el(document, 'h3', { className: 'section-label', text: i18n.t('trainingPage.feedback') }),
      list,
      (entry.feedback_contexts ?? []).length ? feedbackForm(ctx, entry, list) : null,
    ].filter(Boolean));
  } catch (error) {
    content.replaceChildren(el(document, 'p', { className: 'muted', text: error?.message || i18n.t('coach.detailsLoadError') }));
  }
}

export async function renderStudent(ctx, route) {
  const { document, i18n } = ctx;
  const studentId = route.params.id;
  const screen = el(document, 'section', { className: 'screen screen-student' });
  const back = () => ctx.back('/me/teaching');
  const unavailable = (text) => {
    screen.append(
      pageHeader({ document, title: '', backLabel: i18n.t('app.back'), onBack: back }),
      el(document, 'p', { className: 'muted', text }),
    );
    return screen;
  };
  let teaching;
  let items;
  try {
    const todayIso = ctx.today();
    [teaching, items] = await Promise.all([
      loadTeaching(ctx),
      ctx.services.training.listCalendar({ start: addDaysIso(todayIso, -365), endExclusive: addDaysIso(todayIso, 1), profileId: studentId }),
    ]);
  } catch (error) {
    return unavailable(error?.kind === 'authorization' ? i18n.t('student.unavailable') : (error?.message || i18n.t('app.loadError')));
  }
  const student = teaching.students.find(({ profileId }) => profileId === studentId);
  if (!student) return unavailable(i18n.t('student.unavailable'));

  const actions = [el(document, 'button', {
    className: 'button-primary', text: `📅 ${i18n.t('plus.schedule')}`, attrs: { type: 'button' }, dataset: { action: 'schedule' },
    on: { click: () => openScheduleSheet(ctx, { teaching, target: `student:${studentId}` }) },
  })];
  if (student.connectionId) {
    actions.push(confirmButton(document, {
      text: i18n.t('student.end'), confirmText: i18n.t('student.confirmEnd'), dataset: { action: 'end-coaching' },
      onConfirm: async () => {
        await ctx.services.connection.end(student.connectionId);
        ctx.navigate('/me/teaching');
      },
    }));
  }
  const done = items.filter(({ item_type: type }) => type === 'completed')
    .sort((left, right) => right.starts_at.localeCompare(left.starts_at));
  screen.append(
    pageHeader({ document, title: student.name, backLabel: i18n.t('app.back'), onBack: back }),
    el(document, 'div', { className: 'chip-row' }, actions),
    el(document, 'h2', { className: 'section-label', text: i18n.t('student.history') }),
    done.length
      ? el(document, 'div', { className: 'day-items' }, done.map((item) => el(document, 'button', {
        className: 'card day-item', attrs: { type: 'button' }, dataset: { occurrence: item.item_id },
        on: { click: () => openDay(ctx, studentId, item) },
      }, [el(document, 'div', {}, [
        el(document, 'strong', { text: [kindLabel(i18n, item.kind), item.group_name].filter(Boolean).join(' · ') }),
        el(document, 'div', { className: 'muted', text: `${i18n.formatDate(`${item.local_date}T12:00:00`, { weekday: 'short', day: 'numeric', month: 'short' })} · ${i18n.formatDuration(item.duration_minutes)}` }),
      ])])))
      : el(document, 'p', { className: 'muted', text: i18n.t('coach.noCompleted') }),
  );
  return screen;
}
