const PERIODS = new Set(['week', 'month', 'year', 'all']);
const METRICS = new Set(['time', 'sessions']);

function pad(value) {
  return String(value).padStart(2, '0');
}

function isoDate(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function parseLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) throw new RangeError('Enter a valid statistics date.');
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) {
    throw new RangeError('Enter a valid statistics date.');
  }
  return date;
}

function localDateForInstant(instant, timezone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(instant)
    .map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

export function normalizePeriod(period) {
  return PERIODS.has(period) ? period : 'month';
}

export function normalizeMetric(metric) {
  return METRICS.has(metric) ? metric : 'time';
}

export function statisticsRange(period, today = new Date(), timezone = 'UTC') {
  const normalized = normalizePeriod(period);
  const localDate = typeof today === 'string' ? today : localDateForInstant(today, timezone);
  const date = parseLocalDate(localDate);

  if (normalized === 'week') {
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    const start = addDays(date, -mondayOffset);
    return { start: isoDate(start), endExclusive: isoDate(addDays(start, 7)) };
  }
  if (normalized === 'month') {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
    return { start: isoDate(start), endExclusive: isoDate(end) };
  }
  if (normalized === 'year') {
    const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const end = new Date(Date.UTC(date.getUTCFullYear() + 1, 0, 1));
    return { start: isoDate(start), endExclusive: isoDate(end) };
  }
  return { start: '1900-01-01', endExclusive: isoDate(addDays(date, 1)) };
}

export function formatDuration(totalMinutes) {
  const minutes = Math.max(0, Number(totalMinutes) || 0);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder}m`;
  if (!remainder) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

export function formatRankValue({ metric, totalMinutes, sessionCount }, locale = 'en') {
  if (normalizeMetric(metric) === 'time') return formatDuration(totalMinutes);
  const count = Number(sessionCount) || 0;
  if (locale === 'pt') return `${count} ${count === 1 ? 'treino' : 'treinos'}`;
  return `${count} ${count === 1 ? 'training' : 'trainings'}`;
}
