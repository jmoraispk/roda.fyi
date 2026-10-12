// src/app/screens/calendar.js
import { calendarGrid, monthBounds, shiftMonth } from '../training-calendar-state.js';
import { el, pageHeader } from '../shell/page.js';
import { resourceIcons } from '../ui/resource-view.js';
import { kindLabel } from './today-state.js';

function dayItem(ctx, item) {
  const { document, i18n } = ctx;
  const upcoming = item.item_type !== 'completed';
  const time = new Intl.DateTimeFormat(i18n.locale() === 'pt' ? 'pt-PT' : 'en-US', {
    hour: '2-digit', minute: '2-digit', timeZone: ctx.timezone,
  }).format(new Date(item.starts_at));
  const who = item.group_name ?? (item.student_name ? i18n.t('trainingPage.with', { name: item.student_name }) : null);
  const title = [kindLabel(i18n, item.kind), who].filter(Boolean).join(' · ');
  const meta = [time, i18n.formatDuration(item.duration_minutes), upcoming ? i18n.t('cal.upcoming') : null].filter(Boolean).join(' · ');
  const target = upcoming
    ? (item.role === 'coach' ? `/class/${item.item_id}` : null)
    : `/training/${item.item_id}`;
  return el(document, target ? 'button' : 'div', {
    className: `card day-item${upcoming ? ' upcoming' : ''}`, attrs: target ? { type: 'button' } : {},
    on: target ? { click: () => { ctx.navigate(target); } } : {},
  }, [el(document, 'div', {}, [el(document, 'strong', { text: title }), el(document, 'div', { className: 'muted', text: meta })]),
    resourceIcons(document, i18n, item.resource_kinds ?? [])]);
}

export async function renderCalendar(ctx, route) {
  const { document, i18n } = ctx;
  const month = route.params.month ?? ctx.today().slice(0, 7);
  const bounds = monthBounds(month);
  const screen = el(document, 'section', { className: 'screen screen-calendar' });
  const title = i18n.formatDate(`${month}-15T12:00:00`, { month: 'long', year: 'numeric' });
  screen.append(pageHeader({ document, title, actions: [
    el(document, 'button', { className: 'icon-button', text: '‹', attrs: { type: 'button', 'aria-label': i18n.t('cal.previous') },
      on: { click: () => ctx.navigate(`/calendar/${shiftMonth(month, -1)}`) } }),
    el(document, 'button', { className: 'icon-button', text: '›', attrs: { type: 'button', 'aria-label': i18n.t('cal.next') },
      on: { click: () => ctx.navigate(`/calendar/${shiftMonth(month, 1)}`) } }),
  ] }));
  let items;
  try {
    items = await ctx.services.training.listMyCalendar({ start: bounds.start, endExclusive: bounds.endExclusive });
  } catch (error) {
    screen.append(el(document, 'p', { className: 'muted', text: error?.message || i18n.t('app.loadError') }));
    return screen;
  }
  const byDate = new Map();
  for (const item of items) byDate.set(item.local_date, [...(byDate.get(item.local_date) ?? []), item]);
  const todayIso = ctx.today();

  function openDay(date) {
    const dayItems = (byDate.get(date) ?? []).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const content = el(document, 'div', { className: 'day-items' }, dayItems.length
      ? dayItems.map((item) => dayItem(ctx, item))
      : [el(document, 'p', { className: 'muted', text: i18n.t('cal.empty') })]);
    ctx.openSheet({ title: i18n.formatDate(`${date}T12:00:00`, { weekday: 'long', month: 'long', day: 'numeric' }), content });
  }

  const weekdayFormatter = new Intl.DateTimeFormat(i18n.locale() === 'pt' ? 'pt-PT' : 'en-US', { weekday: 'narrow', timeZone: 'UTC' });
  const grid = el(document, 'div', { className: 'cal-grid', attrs: { role: 'grid', 'aria-label': title } });
  for (let index = 0; index < 7; index += 1) {
    grid.append(el(document, 'span', { className: 'cal-weekday', text: weekdayFormatter.format(new Date(Date.UTC(2026, 5, 1 + index))), attrs: { role: 'columnheader' } }));
  }
  for (const day of calendarGrid(month)) {
    const dayItems = byDate.get(day.date) ?? [];
    const label = [i18n.formatDate(`${day.date}T12:00:00`, { dateStyle: 'long' }),
      ...dayItems.map((item) => kindLabel(i18n, item.kind))].join(' · ');
    grid.append(el(document, 'button', {
      className: `cal-day${day.inMonth ? '' : ' outside'}`,
      attrs: { type: 'button', role: 'gridcell', 'aria-label': label, 'aria-current': day.date === todayIso ? 'date' : null },
      dataset: { date: day.date }, on: { click: () => openDay(day.date) },
    }, [el(document, 'span', { text: String(day.day) }),
      el(document, 'span', { className: 'cal-dots' }, dayItems.map((item) => el(document, 'i', {
        className: `cal-dot ${item.kind}${item.item_type === 'completed' ? '' : ' upcoming'}`,
      })))]));
  }
  let startX = null;
  grid.addEventListener('pointerdown', (event) => { startX = event.clientX; });
  grid.addEventListener('pointerup', (event) => {
    if (startX !== null && Math.abs(event.clientX - startX) > 60) {
      ctx.navigate(`/calendar/${shiftMonth(month, event.clientX < startX ? 1 : -1)}`);
    }
    startX = null;
  });
  screen.append(grid, el(document, 'p', { className: 'cal-legend muted' }, [
    ['alone', 'training.alone'], ['group', 'training.group'], ['personal_class', 'training.personalClass'],
  ].map(([kind, key]) => el(document, 'span', {}, [el(document, 'i', { className: `cal-dot ${kind}` }), ` ${i18n.t(key)}`]))));
  if (route.params.day) setTimeout(() => { if (screen.isConnected) openDay(`${month}-${route.params.day}`); }, 0);
  return screen;
}
