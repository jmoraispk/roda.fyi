function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDate({ year, month, day }) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) throw new RangeError('Invalid local date.');
  const result = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (result.month < 1 || result.month > 12
    || result.day < 1 || result.day > daysInMonth(result.year, result.month)) {
    throw new RangeError('Invalid local date.');
  }
  return result;
}

function parseMonth(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  if (!match) throw new RangeError('Invalid month.');
  const result = { year: Number(match[1]), month: Number(match[2]) };
  if (result.month < 1 || result.month > 12) throw new RangeError('Invalid month.');
  return result;
}

function daysInMonth(year, month) {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function addDays(value, amount) {
  const date = typeof value === 'string' ? parseDate(value) : { ...value };
  const direction = Math.sign(amount);
  for (let remaining = Math.abs(amount); remaining > 0; remaining -= 1) {
    date.day += direction;
    if (date.day > daysInMonth(date.year, date.month)) {
      date.day = 1;
      date.month += 1;
      if (date.month > 12) {
        date.month = 1;
        date.year += 1;
      }
    } else if (date.day < 1) {
      date.month -= 1;
      if (date.month < 1) {
        date.month = 12;
        date.year -= 1;
      }
      date.day = daysInMonth(date.year, date.month);
    }
  }
  return date;
}

function weekday({ year, month, day }) {
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const adjustedYear = month < 3 ? year - 1 : year;
  return (adjustedYear + Math.floor(adjustedYear / 4)
    - Math.floor(adjustedYear / 100) + Math.floor(adjustedYear / 400)
    + offsets[month - 1] + day) % 7;
}

export function monthBounds(monthValue) {
  const { year, month } = parseMonth(monthValue);
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return {
    start: formatDate({ year, month, day: 1 }),
    endExclusive: formatDate({ ...next, day: 1 }),
  };
}

export function shiftMonth(monthValue, amount) {
  const source = parseMonth(monthValue);
  const index = source.year * 12 + source.month - 1 + amount;
  const year = Math.floor(index / 12);
  const month = ((index % 12) + 12) % 12 + 1;
  return `${year}-${pad(month)}`;
}

export function calendarGrid(monthValue, { weekStartsOn = 1 } = {}) {
  const { year, month } = parseMonth(monthValue);
  const first = { year, month, day: 1 };
  const offset = (weekday(first) - weekStartsOn + 7) % 7;
  const start = addDays(first, -offset);
  const cellCount = Math.ceil((offset + daysInMonth(year, month)) / 7) * 7;
  return Array.from({ length: cellCount }, (_, index) => {
    const value = addDays(start, index);
    return {
      date: formatDate(value),
      year: value.year,
      month: value.month,
      day: value.day,
      inMonth: value.year === year && value.month === month,
    };
  });
}

export function mondayWeekBounds(localDate, _timezone = 'UTC') {
  const source = parseDate(localDate);
  const offset = (weekday(source) + 6) % 7;
  const start = addDays(source, -offset);
  return {
    start: formatDate(start),
    endExclusive: formatDate(addDays(start, 7)),
  };
}

export function localDateFromInstant(instant, timezone) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function currentMonth() {
  return localDateFromInstant(new Date().toISOString(),
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC').slice(0, 7);
}

export function createCalendarState(values = {}) {
  return {
    visibleMonth: values.visibleMonth ?? currentMonth(),
    selectedDate: values.selectedDate ?? null,
    summaryByDate: values.summaryByDate ?? new Map(),
    dayDetail: values.dayDetail ?? null,
    loadingToken: values.loadingToken ?? 0,
    loading: false,
    error: null,
  };
}

export function reduceCalendarState(state, event) {
  switch (event.type) {
    case 'MONTH_LOAD_STARTED':
      return {
        ...state,
        visibleMonth: event.visibleMonth,
        loadingToken: event.token,
        loading: true,
        error: null,
      };
    case 'MONTH_LOAD_SUCCEEDED': {
      if (event.token !== state.loadingToken) return state;
      const summaryByDate = new Map();
      for (const item of event.items ?? []) {
        const date = item.local_date ?? item.localDate;
        summaryByDate.set(date, [...(summaryByDate.get(date) ?? []), item]);
      }
      return { ...state, summaryByDate, loading: false, error: null };
    }
    case 'MONTH_LOAD_FAILED':
      return event.token === state.loadingToken
        ? { ...state, loading: false, error: event.error }
        : state;
    case 'DAY_SELECTED':
      return { ...state, selectedDate: event.date, dayDetail: null, error: null };
    case 'DAY_LOAD_SUCCEEDED':
      return event.date === state.selectedDate
        ? { ...state, dayDetail: event.items, error: null }
        : state;
    case 'DAY_LOAD_FAILED':
      return event.date === state.selectedDate ? { ...state, error: event.error } : state;
    case 'CLEAR_PRIVATE':
      return {
        ...state,
        selectedDate: null,
        summaryByDate: new Map(),
        dayDetail: null,
        loading: false,
        error: null,
      };
    default:
      return state;
  }
}
