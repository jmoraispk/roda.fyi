function zonedParts(instant, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  return Object.fromEntries(parts.map(({ type, value }) => [type, Number(value)]));
}

export function scheduledInstant(date, time, timezone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(`${date}T${time}`);
  if (!match) throw new RangeError('Enter a valid training date and time.');
  const desired = match.slice(1).map(Number);
  const desiredEpoch = Date.UTC(desired[0], desired[1] - 1, desired[2], desired[3], desired[4]);
  let candidate = desiredEpoch;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = zonedParts(candidate, timezone);
    const observedEpoch = Date.UTC(
      observed.year, observed.month - 1, observed.day,
      observed.hour, observed.minute, observed.second,
    );
    candidate -= observedEpoch - desiredEpoch;
  }
  const final = zonedParts(candidate, timezone);
  if ([final.year, final.month, final.day, final.hour, final.minute]
    .some((value, index) => value !== desired[index])) {
    throw new RangeError('That local time does not exist in the selected timezone.');
  }
  return new Date(candidate).toISOString();
}
