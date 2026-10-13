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

// Ruling R10: which card wins depends on how the person uses roda.
const ORDER = {
  train: ['rate', 'nextAttend', 'finish', 'nextTeach'],
  both: ['finish', 'rate', 'next'],
  teach: ['finish', 'nextTeach', 'rate', 'nextAttend'],
};

export function nowNextCard({ calendarItems, recent, profileId, now, todayIso: localToday = null, mode = 'both' }) {
  const time = now.getTime();
  const teaches = (item) => item.coach_profile_id === profileId;
  const scheduled = calendarItems.filter((item) => item.item_type === 'scheduled' && item.status === 'scheduled');
  const todayIso = localToday ?? now.toISOString().slice(0, 10);
  const tomorrowIso = addDaysIso(todayIso, 1);
  const upcoming = scheduled
    .filter((item) => endOf(item) > time && item.local_date >= todayIso && item.local_date <= tomorrowIso)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const nextOf = (items) => (items[0] ? { type: 'next', item: items[0], teaching: teaches(items[0]) } : null);
  const cards = {
    finish() {
      const item = scheduled
        .filter((entry) => teaches(entry) && endOf(entry) <= time && time - endOf(entry) < 12 * HOUR)
        .sort((a, b) => endOf(b) - endOf(a))[0];
      return item ? { type: 'finish', item } : null;
    },
    rate() {
      const training = recent.find((entry) => entry.role === 'participant' && entry.kind !== 'alone'
        && !entry.felt && time - new Date(entry.occurred_at).getTime() < 12 * HOUR);
      return training ? { type: 'rate', training } : null;
    },
    next: () => nextOf(upcoming),
    nextTeach: () => nextOf(upcoming.filter(teaches)),
    nextAttend: () => nextOf(upcoming.filter((item) => !teaches(item))),
  };
  for (const key of ORDER[mode] ?? ORDER.both) {
    const card = cards[key]();
    if (card) return card;
  }
  return null;
}

export function kindLabel(i18n, kind) {
  if (kind === 'personal_class') return i18n.t('training.personalClass');
  if (kind === 'group') return i18n.t('training.group');
  return i18n.t('training.alone');
}
