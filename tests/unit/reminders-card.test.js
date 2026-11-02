// tests/unit/reminders-card.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { remindersCardWanted, renderRemindersCard } from '../../src/app/screens/reminders-card.js';
import { fakeDevice } from './helpers/fake-push-device.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

function memory() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

describe('reminders card', () => {
  beforeEach(() => { document.body.replaceChildren(); });

  it('appears only where notifications can be turned on and this device was never asked', () => {
    const storage = memory();
    expect(remindersCardWanted({ device: fakeDevice(), storage })).toBe(true);
    expect(remindersCardWanted({ device: null, storage })).toBe(false);
    expect(remindersCardWanted({ device: fakeDevice({ support: 'ios-browser' }), storage })).toBe(false);
    expect(remindersCardWanted({ device: fakeDevice({ support: 'unsupported' }), storage })).toBe(false);
    expect(remindersCardWanted({ device: fakeDevice({ permission: 'granted' }), storage })).toBe(false);
    expect(remindersCardWanted({ device: fakeDevice({ permission: 'denied' }), storage })).toBe(false);
    storage.setItem('roda.reminders.answered', '1');
    expect(remindersCardWanted({ device: fakeDevice(), storage })).toBe(false);
    expect(remindersCardWanted({ device: fakeDevice(), storage: { getItem: () => { throw new Error('blocked'); } } })).toBe(false);
  });

  it('remembers Not now on this device', () => {
    const storage = memory();
    const card = renderRemindersCard({ document, i18n, storage, device: fakeDevice(), onTurnOn: vi.fn() });
    document.body.append(card);
    expect(card.getAttribute('aria-label')).toBe('Turn on reminders');
    expect(card.textContent).toContain('Get a nudge before class and a reminder to add the video after.');
    card.querySelector('[data-action="reminders-later"]').click();
    expect(document.querySelector('.reminders-card')).toBeNull();
    expect(storage.getItem('roda.reminders.answered')).toBe('1');
  });

  it('turns notifications on and goes away', async () => {
    const storage = memory();
    const onTurnOn = vi.fn().mockResolvedValue('on');
    document.body.append(renderRemindersCard({ document, i18n, storage, device: fakeDevice(), onTurnOn }));
    document.querySelector('[data-action="turn-on-reminders"]').click();
    await vi.waitFor(() => expect(document.querySelector('.reminders-card')).toBeNull());
    expect(onTurnOn).toHaveBeenCalledTimes(1);
    expect(storage.getItem('roda.reminders.answered')).toBe('1');
  });

  it('says what went wrong and lets the person try again', async () => {
    const onTurnOn = vi.fn().mockRejectedValue(new Error('The network request failed. Please try again.'));
    document.body.append(renderRemindersCard({ document, i18n, storage: memory(), device: fakeDevice(), onTurnOn }));
    document.querySelector('[data-action="turn-on-reminders"]').click();
    await vi.waitFor(() => expect(document.querySelector('.reminders-card [role="status"]').textContent)
      .toBe('The network request failed. Please try again.'));
    expect(document.querySelector('[data-action="turn-on-reminders"]').disabled).toBe(false);
  });

  it('is not built when it is not wanted', () => {
    expect(renderRemindersCard({ document, i18n, storage: memory(), device: null, onTurnOn: vi.fn() })).toBeNull();
  });
});
