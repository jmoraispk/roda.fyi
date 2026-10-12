// src/app/screens/teaching.js
import { el, pageHeader } from '../shell/page.js';
import { openScheduleSheet } from './schedule-sheet.js';
import { openPeopleSearch } from './people-search.js';
import { loadTeaching, pendingStudentRequests } from './teaching-state.js';
import { kindLabel } from './today-state.js';

function addDaysIso(iso, amount) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function row(document, { href, title, meta = null }) {
  return el(document, 'a', { className: 'card list-row', attrs: { href } }, [
    el(document, 'div', {}, [el(document, 'strong', { text: title }), meta ? el(document, 'div', { className: 'muted', text: meta }) : null]),
    el(document, 'span', { className: 'muted', text: '›', attrs: { 'aria-hidden': 'true' } }),
  ]);
}

function listOrEmpty(document, rows, emptyText) {
  return rows.length
    ? el(document, 'div', { className: 'day-items' }, rows)
    : el(document, 'p', { className: 'muted', text: emptyText });
}

export async function renderTeaching(ctx) {
  const { document, i18n } = ctx;
  const screen = el(document, 'section', { className: 'screen screen-teaching' }, [
    pageHeader({ document, title: i18n.t('app.teaching'), backLabel: i18n.t('app.back'), onBack: () => ctx.back('/me') }),
  ]);
  let teaching;
  let calendar;
  try {
    const todayIso = ctx.today();
    [teaching, calendar] = await Promise.all([
      loadTeaching(ctx),
      ctx.services.training.listMyCalendar({ start: todayIso, endExclusive: addDaysIso(todayIso, 60) }),
    ]);
  } catch (error) {
    screen.append(el(document, 'p', { className: 'muted', text: error?.message || i18n.t('app.loadError') }));
    return screen;
  }
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  const reload = async () => screen.replaceWith(await renderTeaching(ctx));

  screen.append(el(document, 'div', { className: 'chip-row' }, [
    el(document, 'button', {
      className: 'button-primary', text: `📅 ${i18n.t('plus.schedule')}`, attrs: { type: 'button' }, dataset: { action: 'schedule' },
      on: { click: () => openScheduleSheet(ctx, { teaching }) },
    }),
    el(document, 'a', { className: 'button-secondary', text: `🧾 ${i18n.t('plus.record')}`, attrs: { href: '#/me/teaching/record' } }),
  ]), status);

  const classes = calendar.filter((item) => item.item_type === 'scheduled' && item.role === 'coach');
  screen.append(
    el(document, 'h2', { className: 'section-label', text: i18n.t('teaching.upcoming') }),
    listOrEmpty(document, classes.map((item) => row(document, {
      href: `#/class/${item.item_id}`,
      title: [kindLabel(i18n, item.kind), item.group_name
        ?? (item.student_name ? i18n.t('trainingPage.with', { name: item.student_name }) : null)].filter(Boolean).join(' · '),
      meta: [i18n.formatDate(item.starts_at, {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: ctx.timezone,
      }), item.plan_title].filter(Boolean).join(' · '),
    })), i18n.t('teaching.noUpcoming')),
  );

  screen.append(
    el(document, 'div', { className: 'section-head' }, [
      el(document, 'h2', { className: 'section-label', text: i18n.t('teaching.plans') }),
      el(document, 'a', { className: 'button-secondary small', text: `+ ${i18n.t('teaching.newPlan')}`, attrs: { href: '#/me/teaching/plans/new' } }),
    ]),
    listOrEmpty(document, teaching.plans.map((plan) => row(document, {
      href: `#/me/teaching/plans/${plan.plan_id}`,
      title: plan.title,
      meta: `${i18n.formatDuration(plan.expected_duration_minutes)} · ${i18n.t(plan.state === 'published' ? 'coach.published' : 'coach.draft')}`,
    })), i18n.t('coach.noPlans')),
  );

  const requests = pendingStudentRequests({ profileId: ctx.profile.id, connections: teaching.connections });
  screen.append(
    el(document, 'div', { className: 'section-head' }, [
      el(document, 'h2', { className: 'section-label', text: i18n.t('teaching.students') }),
      el(document, 'button', {
        className: 'button-secondary small', text: i18n.t('connections.findStudent'), attrs: { type: 'button' }, dataset: { action: 'find-student' },
        on: { click: () => openPeopleSearch(ctx, { role: 'student' }) },
      }),
    ]),
    ...(requests.length ? [el(document, 'div', { className: 'day-items' }, requests.map((connection) => el(document, 'div', {
      className: 'card list-row', dataset: { request: connection.connection_id },
    }, [
      el(document, 'span', { text: i18n.t('teaching.wantsCoaching', { name: connection.student_display_name }) }),
      el(document, 'div', { className: 'row-actions' }, [
        ['accepted', 'teaching.accept', 'connections.accept', 'button-primary small'],
        ['declined', 'teaching.decline', 'connections.decline', 'button-secondary small'],
      ].map(([decision, key, label, className]) => el(document, 'button', {
        className, text: i18n.t(key), dataset: { decision },
        attrs: { type: 'button', 'aria-label': i18n.t(label, { name: connection.student_display_name }) },
        on: { click: async () => {
          try {
            await ctx.services.connection.decide(connection.connection_id, decision);
            await reload();
          } catch (error) {
            status.textContent = error?.message || i18n.t('groupPage.actionError');
          }
        } },
      }))),
    ])))] : []),
    listOrEmpty(document, teaching.students.map((student) => row(document, {
      href: `#/me/teaching/students/${student.profileId}`, title: student.name,
    })), i18n.t('coach.noStudents')),
  );
  // Ruling R23: on desktop, pages opened from here appear beside this list.
  screen.dataset.teachingHome = '';
  return screen;
}
