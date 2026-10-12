// src/app/screens/today-state.js
const HOUR = 3600000;

function addDaysIso(iso, amount) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function weekDays(todayIso) {
  const offset = (new Date(`${todayIso}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monday = addDaysIso(todayIso, -offset);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDaysIso(monday, index);
    return { date, day: Number(date.slice(8)), isToday: date === todayIso };
  });
}

export function weekRange(todayIso) {
  const days = weekDays(todayIso);
  const start = [days[0].date, addDaysIso(todayIso, -1)].sort()[0];
  const endExclusive = [addDaysIso(days[6].date, 1), addDaysIso(todayIso, 2)].sort().at(-1);
  return { start, endExclusive };
}

export function clipText(text, max = 120) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function endOf(item) {
  return new Date(item.starts_at).getTime() + (item.duration_minutes ?? 0) * 60000;
}

export function nowNextCard({ calendarItems, recent, profileId, now, todayIso: localToday = null }) {
  const time = now.getTime();
  const scheduled = calendarItems.filter((item) => item.item_type === 'scheduled' && item.status === 'scheduled');
  const finish = scheduled
    .filter((item) => item.coach_profile_id === profileId && endOf(item) <= time && time - endOf(item) < 12 * HOUR)
    .sort((a, b) => endOf(b) - endOf(a))[0];
  if (finish) return { type: 'finish', item: finish };
  const rate = recent.find((training) => training.role === 'participant' && training.kind !== 'alone'
    && !training.has_rating && time - new Date(training.occurred_at).getTime() < 12 * HOUR);
  if (rate) return { type: 'rate', training: rate };
  const todayIso = localToday ?? now.toISOString().slice(0, 10);
  const tomorrowIso = addDaysIso(todayIso, 1);
  const next = scheduled
    .filter((item) => endOf(item) > time && item.local_date >= todayIso && item.local_date <= tomorrowIso)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  if (next) return { type: 'next', item: next, teaching: next.coach_profile_id === profileId };
  return null;
}

export function kindLabel(i18n, kind) {
  if (kind === 'personal_class') return i18n.t('training.personalClass');
  if (kind === 'group') return i18n.t('training.group');
  return i18n.t('training.alone');
}
