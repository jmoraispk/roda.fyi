// src/app/screens/class.js
import { roundText } from '../training-plan-state.js';
import { el, pageHeader } from '../shell/page.js';
import { kindLabel } from './today-state.js';

function timeOf(ctx, iso, timezone) {
  return new Intl.DateTimeFormat(ctx.i18n.locale() === 'pt' ? 'pt-PT' : 'en-US', {
    hour: '2-digit', minute: '2-digit', timeZone: timezone || ctx.timezone,
  }).format(new Date(iso));
}

function cancelSheet(ctx, data) {
  const { document, i18n } = ctx;
  const reason = el(document, 'textarea', { className: 'field-input field-textarea', attrs: { name: 'reason', maxlength: '500' } });
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  const confirm = el(document, 'button', { className: 'button-danger', text: i18n.t('classPage.confirmCancel'), attrs: { type: 'submit' } });
  const form = el(document, 'form', { className: 'sheet-form' }, [
    el(document, 'label', { className: 'field-label' }, [i18n.t('classPage.reason'), reason]), status, confirm,
  ]);
  const sheet = ctx.openSheet({ title: i18n.t('classPage.cancel'), content: form });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    confirm.disabled = true;
    try {
      await ctx.services.training.cancelScheduledTraining(data.schedule_id, reason.value);
      sheet.close();
      ctx.navigate('/');
    } catch (error) {
      status.textContent = error?.message || i18n.t('classPage.cancelError');
      confirm.disabled = false;
    }
  });
}

export async function renderClass(ctx, route) {
  const { document, i18n } = ctx;
  const training = ctx.services.training;
  const screen = el(document, 'section', { className: 'screen screen-class' });
  const back = () => ctx.back('/');
  let data;
  try {
    data = await training.getScheduledClass(route.params.id);
  } catch (error) {
    const unavailable = error?.kind === 'authorization' || error?.kind === 'validation';
    screen.append(
      pageHeader({ document, title: '', backLabel: i18n.t('app.back'), onBack: back }),
      el(document, 'p', { className: 'muted', text: unavailable ? i18n.t('classPage.unavailable') : (error?.message || i18n.t('app.loadError')) }),
    );
    return screen;
  }
  const editPlan = data.plan_id
    ? [el(document, 'a', { className: 'button-secondary small', text: i18n.t('classPage.editPlan'), attrs: { href: `#/me/teaching/plans/${data.plan_id}` } })]
    : [];
  screen.append(pageHeader({ document, title: '', backLabel: i18n.t('app.back'), onBack: back, actions: editPlan }));
  const second = data.group_name ?? (data.student_name ? i18n.t('trainingPage.with', { name: data.student_name }) : null);
  const meta = [
    i18n.formatDate(`${data.local_date}T12:00:00`, { weekday: 'short', day: 'numeric', month: 'short' }),
    timeOf(ctx, data.starts_at, data.timezone), i18n.t('today.youTeach'),
    data.plan_title ? i18n.t('classPage.plan', { title: data.plan_title }) : null,
  ].filter(Boolean).join(' · ');
  const coming = el(document, 'span', { className: 'tag' });
  screen.append(
    el(document, 'h1', { className: 'training-title', text: [kindLabel(i18n, data.kind), second].filter(Boolean).join(' · ') }),
    el(document, 'p', { className: 'training-meta muted', text: meta }),
    el(document, 'div', { className: 'training-tags' }, [
      el(document, 'span', { className: 'tag', text: `⏱ ${i18n.formatDuration(data.duration_minutes)}` }), coming,
    ]),
  );

  if (data.state !== 'scheduled') {
    coming.remove();
    screen.append(el(document, 'p', { className: 'card muted', text: i18n.t(data.state === 'cancelled' ? 'classPage.cancelled' : 'classPage.finished') }));
    if (data.occurrence_id) {
      screen.append(el(document, 'a', { className: 'button-primary', text: i18n.t('classPage.openClass'), attrs: { href: `#/training/${data.occurrence_id}` } }));
    }
    return screen;
  }

  screen.append(
    el(document, 'h2', { className: 'section-label', text: i18n.t('classPage.planLabel') }),
    el(document, 'ol', { className: 'chapters' }, (data.rounds ?? []).map((round, index) => el(document, 'li', { className: 'chapter' }, [
      el(document, 'span', { className: 'chapter-number', text: String(index + 1) }),
      el(document, 'span', { className: 'chapter-text', text: roundText(round) }),
    ]))),
  );
  if (data.instructions) screen.append(el(document, 'p', { className: 'training-notes', text: data.instructions }));

  const here = new Set(data.people.map(({ profile_id: id }) => id));
  const started = new Date(data.starts_at) <= ctx.now();
  const hint = el(document, 'p', { className: 'muted class-hint' });
  const status = el(document, 'p', { className: 'log-status', attrs: { role: 'status' } });
  const finish = el(document, 'button', { className: 'bar-main', text: i18n.t('classPage.finish'), attrs: { type: 'button' }, dataset: { action: 'finish' } });
  const cancel = el(document, 'button', { text: i18n.t('classPage.cancel'), attrs: { type: 'button' }, dataset: { action: 'cancel' } });
  let busy = false;
  function refresh() {
    coming.textContent = `👥 ${i18n.t('classPage.coming', { count: here.size })}`;
    const studentAbsent = data.kind === 'personal_class' && !here.size;
    finish.disabled = busy || !started || studentAbsent;
    hint.textContent = !started ? i18n.t('classPage.notStarted')
      : studentAbsent ? i18n.t('classPage.studentAbsent', { name: data.student_name ?? '' }) : '';
  }
  const people = el(document, 'div', { className: 'attendance' }, data.people.map((person) => {
    const row = el(document, 'button', {
      className: 'attendance-row', attrs: { type: 'button', role: 'checkbox', 'aria-checked': 'true' }, dataset: { person: person.profile_id },
    }, [
      el(document, 'span', { text: person.display_name ?? '' }),
      el(document, 'span', { className: 'attendance-check', text: '✓', attrs: { 'aria-hidden': 'true' } }),
    ]);
    row.addEventListener('click', () => {
      if (here.has(person.profile_id)) here.delete(person.profile_id);
      else here.add(person.profile_id);
      row.setAttribute('aria-checked', String(here.has(person.profile_id)));
      refresh();
    });
    return row;
  }));
  screen.append(el(document, 'h2', { className: 'section-label', text: i18n.t('classPage.whosHere') }), people, hint, status);

  const idempotencyKey = training.createIdempotencyKey();
  finish.addEventListener('click', async () => {
    if (busy || finish.disabled) return;
    if (data.kind === 'group' && !here.size) {
      status.textContent = i18n.t('classPage.nobody');
      return;
    }
    busy = true;
    refresh();
    finish.textContent = i18n.t('classPage.finishing');
    status.textContent = '';
    try {
      const minutes = data.duration_minutes;
      const result = data.kind === 'group'
        ? await training.completeGroupTraining({
          scheduleId: data.schedule_id, durationMinutes: minutes, idempotencyKey,
          attendees: [...here].map((profileId) => ({ profileId, durationMinutes: minutes })),
        })
        : await training.completePersonalClass({ scheduleId: data.schedule_id, durationMinutes: minutes, idempotencyKey });
      ctx.replace(`/training/${result.occurrence_id}?add=1`);
    } catch (error) {
      if (['duplicate_completion', 'cancelled_training'].includes(error?.code)) {
        screen.replaceWith(await renderClass(ctx, route));
        return;
      }
      status.textContent = error?.code === 'invalid_attendee'
        ? i18n.t('coach.membershipChanged')
        : (error?.message || i18n.t('classPage.finishError'));
      busy = false;
      finish.textContent = i18n.t('classPage.finish');
      refresh();
    }
  });
  cancel.addEventListener('click', () => cancelSheet(ctx, data));
  refresh();
  screen.append(el(document, 'div', { className: 'training-bar' }, [cancel, finish]));
  return screen;
}
