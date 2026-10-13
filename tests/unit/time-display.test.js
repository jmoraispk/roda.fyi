// tests/unit/time-display.test.js
import { describe, expect, it } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { clockTime, whenParts, zonePlace } from '../../src/app/time-display.js';

const i18n = (locale) => createDashboardI18n({ document: null, storage: { getItem: () => locale, setItem() {} }, navigator: { languages: [locale] } });

describe('time display', () => {
  it('names the place of a zone', () => {
    expect(zonePlace('Europe/Lisbon')).toBe('Lisbon');
    expect(zonePlace('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
    expect(zonePlace('UTC')).toBe('UTC');
  });

  it('formats a clock time in a zone', () => {
    expect(clockTime('en', '2026-10-08T18:00:00Z', 'America/New_York')).toBe('02:00 PM');
    expect(clockTime('pt', '2026-10-08T18:00:00Z', 'Europe/Lisbon')).toBe('19:00');
  });

  it('shows the viewer first and the class zone when its clock differs', () => {
    expect(whenParts({ i18n: i18n('en'), iso: '2026-10-08T18:00:00Z', viewerZone: 'America/New_York', classZone: 'Europe/Lisbon' }))
      .toEqual({ date: 'Thu, Oct 8', time: '02:00 PM', elsewhere: '07:00 PM in Lisbon' });
    expect(whenParts({ i18n: i18n('pt'), iso: '2026-10-08T18:00:00Z', viewerZone: 'America/New_York', classZone: 'Europe/Lisbon' }).elsewhere)
      .toBe('19:00 em Lisbon');
  });

  it('adds the weekday when the class zone is on another day', () => {
    expect(whenParts({ i18n: i18n('en'), iso: '2026-10-09T03:30:00Z', viewerZone: 'America/Los_Angeles', classZone: 'Europe/Lisbon' }))
      .toEqual({ date: 'Thu, Oct 8', time: '08:30 PM', elsewhere: 'Fri 04:30 AM in Lisbon' });
  });

  it('says nothing more when the zone or its clock is the same', () => {
    expect(whenParts({ i18n: i18n('en'), iso: '2026-10-08T18:00:00Z', viewerZone: 'Europe/Lisbon', classZone: 'Europe/Lisbon' }).elsewhere).toBeNull();
    expect(whenParts({ i18n: i18n('en'), iso: '2026-10-08T18:00:00Z', viewerZone: 'Europe/London', classZone: 'Europe/Lisbon' }).elsewhere).toBeNull();
    expect(whenParts({ i18n: i18n('en'), iso: '2026-10-08T18:00:00Z', viewerZone: 'Europe/Lisbon', classZone: null }).elsewhere).toBeNull();
  });
});
