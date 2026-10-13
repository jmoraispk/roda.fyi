// src/app/time-display.js
// Ruling 14: every time is in the viewer's zone. When a class was recorded in
// another zone whose clock differs, its own time is added as a quiet second line.
const LOCALES = Object.freeze({ en: 'en-US', pt: 'pt-PT' });
const localeOf = (locale) => LOCALES[locale] ?? 'en-US';

export function clockTime(locale, iso, timeZone) {
  return new Intl.DateTimeFormat(localeOf(locale), { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
}

export function zonePlace(timeZone) {
  return String(timeZone ?? '').split('/').pop().replace(/_/g, ' ');
}

function dayKey(iso, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(new Date(iso));
}

export function whenParts({ i18n, iso, viewerZone, classZone }) {
  const locale = i18n.locale();
  const date = i18n.formatDate(iso, { weekday: 'short', day: 'numeric', month: 'short', timeZone: viewerZone });
  const time = clockTime(locale, iso, viewerZone);
  let elsewhere = null;
  if (classZone && classZone !== viewerZone) {
    const there = clockTime(locale, iso, classZone);
    const sameDay = dayKey(iso, classZone) === dayKey(iso, viewerZone);
    if (there !== time || !sameDay) {
      const weekday = new Intl.DateTimeFormat(localeOf(locale), { weekday: 'short', timeZone: classZone }).format(new Date(iso));
      elsewhere = i18n.t('time.inPlace', { time: sameDay ? there : `${weekday} ${there}`, place: zonePlace(classZone) });
    }
  }
  return { date, time, elsewhere };
}
