// src/app/screens/today.js
import { el, initials, pageHeader } from '../shell/page.js';
import { resourceIcons } from '../ui/resource-view.js';
import { clipText, kindLabel, nowNextCard, weekDays, weekRange } from './today-state.js';

function timeOf(ctx, iso) {
  return new Intl.DateTimeFormat(ctx.i18n.locale() === 'pt' ? 'pt-PT' : 'en-US', {
    hour: '2-digit', minute: '2-digit', timeZone: ctx.timezone,
  }).format(new Date(iso));
}

function nowCard(ctx, card) {
  const { document, i18n } = ctx;
  if (card.type === 'rate') {
    return el(document, 'article', { className: 'card now-card' }, [
      el(document, 'div', { className: 'section-label', text: i18n.t('today.rateTitle') }),
      el(document, 'h2', { text: card.training.group_name ?? kindLabel(i18n, card.training.kind) }),
      el(document, 'button', { className: 'button-primary', text: i18n.t('today.rate'), attrs: { type: 'button' },
        on: { click: () => ctx.navigate(`/training/${card.training.occurrence_id}`) } }),
    ]);
  }
  const { item } = card;
  const finishing = card.type === 'finish';
  const meta = [timeOf(ctx, item.starts_at), item.plan_title, (finishing || card.teaching) ? i18n.t('today.youTeach') : null]
    .filter(Boolean).join(' · ');
  const action = finishing || card.teaching
    ? el(document, 'button', { className: 'button-primary', text: i18n.t(finishing ? 'today.finishClass' : 'today.open'),
      attrs: { type: 'button' }, on: { click: () => ctx.navigate(`/class/${item.item_id}`) } })
    : null;
  return el(document, 'article', { className: 'card now-card' }, [
    el(document, 'div', { className: 'section-label', text: i18n.t(finishing ? 'today.finishTitle' : 'today.nextTitle') }),
    el(document, 'h2', { text: item.group_name ?? kindLabel(i18n, item.kind) }),
    el(document, 'p', { className: 'muted', text: meta }),
    action,
  ]);
}

function recentCard(ctx, training) {
  const { document, i18n } = ctx;
  const title = [kindLabel(i18n, training.kind), training.group_name].filter(Boolean).join(' · ');
  const meta = [i18n.formatDate(`${training.local_date}T12:00:00`, { weekday: 'short', day: 'numeric', month: 'short' }),
    i18n.formatDuration(training.duration_minutes),
    training.kind === 'group' ? i18n.t('today.attended', { count: training.attendee_count }) : null].filter(Boolean).join(' · ');
  const card = el(document, 'button', { className: 'card recent-card', attrs: { type: 'button' },
    on: { click: () => ctx.navigate(`/training/${training.occurrence_id}`) } }, [
    el(document, 'div', { className: 'recent-head' }, [el(document, 'strong', { text: title }),
      resourceIcons(document, i18n, training.resource_kinds ?? [])]),
    el(document, 'div', { className: 'muted', text: meta }),
    el(document, 'div', { className: 'recent-text', text: clipText(training.first_round_text) }),
  ]);
  if (training.felt) {
    card.append(el(document, 'span', { className: 'felt', text: i18n.t('today.felt', { difficulty: i18n.t(`training.${training.felt}`) }) }));
  }
  return card;
}

export async function renderToday(ctx) {
  const { document, i18n, profile } = ctx;
  const todayIso = ctx.today();
  const screen = el(document, 'section', { className: 'screen screen-today' });
  const avatar = el(document, 'a', { className: 'me-avatar small', text: initials(profile.display_name), attrs: { href: '#/me', 'aria-label': i18n.t('app.me') } });
  screen.append(pageHeader({ document, title: i18n.t('app.today'), actions: [avatar] }));
  let calendarItems;
  let recent;
  try {
    const range = weekRange(todayIso);
    [calendarItems, recent] = await Promise.all([
      ctx.services.training.listCalendar({ start: range.start, endExclusive: range.endExclusive }),
      ctx.services.training.listRecentTrainings(10),
    ]);
  } catch (error) {
    screen.append(el(document, 'p', { className: 'muted', text: error?.message || i18n.t('app.loadError') }),
      el(document, 'button', { className: 'button-secondary', text: i18n.t('app.retry'), attrs: { type: 'button' }, dataset: { action: 'retry' },
        on: { click: async () => screen.replaceWith(await renderToday(ctx)) } }));
    return screen;
  }
  const trainedDays = new Set(calendarItems.filter(({ item_type: type }) => type === 'completed').map(({ local_date: date }) => date));
  screen.append(el(document, 'div', { className: 'week-strip' }, weekDays(todayIso).map((day) => el(document, 'button', {
    className: 'week-day', attrs: { type: 'button', 'aria-current': day.isToday ? 'date' : null,
      'aria-label': i18n.formatDate(`${day.date}T12:00:00`, { weekday: 'long', day: 'numeric', month: 'long' }) },
    dataset: { day: day.date }, on: { click: () => ctx.navigate(`/calendar/${day.date}`) },
  }, [el(document, 'span', { className: 'week-name', text: i18n.formatDate(`${day.date}T12:00:00`, { weekday: 'narrow' }) }),
    el(document, 'span', { text: String(day.day) }),
    trainedDays.has(day.date) ? el(document, 'span', { className: 'week-dot', attrs: { 'aria-hidden': 'true' } }) : null]))));
  const card = nowNextCard({ calendarItems, recent, profileId: profile.id, now: ctx.now() });
  if (card) screen.append(nowCard(ctx, card));
  screen.append(el(document, 'h2', { className: 'section-label', text: i18n.t('today.recent') }));
  if (!recent.length) screen.append(el(document, 'p', { className: 'card muted empty-card', text: i18n.t('today.empty') }));
  else screen.append(el(document, 'div', { className: 'recent-list' }, recent.map((training) => recentCard(ctx, training))));
  return screen;
}
