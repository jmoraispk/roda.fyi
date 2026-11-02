// src/app/screens/reminders-card.js
// "Turn on reminders" on Today: asked once per device, and only where
// notifications can really be turned on (Ruling 17).
import { el } from '../shell/page.js';

const ANSWERED = 'roda.reminders.answered';

function answered(storage) {
  try {
    return storage?.getItem(ANSWERED) === '1';
  } catch {
    // Unreadable storage: do not risk asking on every visit.
    return true;
  }
}

function remember(storage) {
  try {
    storage?.setItem(ANSWERED, '1');
  } catch {
    // Blocked storage: the card may come back next time.
  }
}

export function remindersCardWanted({ device, storage }) {
  if (!device || device.support() !== 'supported' || device.permission() !== 'default') return false;
  return !answered(storage);
}

export function renderRemindersCard({ document, i18n, storage, device, onTurnOn }) {
  if (!remindersCardWanted({ device, storage })) return null;
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  const turnOnButton = el(document, 'button', {
    className: 'button-primary', text: i18n.t('reminders.turnOn'), attrs: { type: 'button' }, dataset: { action: 'turn-on-reminders' },
  });
  const later = el(document, 'button', {
    className: 'quiet-button', text: i18n.t('reminders.notNow'), attrs: { type: 'button' }, dataset: { action: 'reminders-later' },
  });
  const card = el(document, 'section', { className: 'card reminders-card', attrs: { 'aria-label': i18n.t('reminders.title') } }, [
    el(document, 'h2', { className: 'install-title', text: i18n.t('reminders.title') }),
    el(document, 'p', { text: i18n.t('reminders.body') }),
    el(document, 'div', { className: 'install-actions' }, [turnOnButton, later]),
    status,
  ]);
  turnOnButton.addEventListener('click', async () => {
    remember(storage);
    turnOnButton.disabled = true;
    status.textContent = '';
    try {
      await onTurnOn();
      card.remove();
    } catch (error) {
      status.textContent = error?.message || i18n.t('app.loadError');
      turnOnButton.disabled = false;
    }
  });
  later.addEventListener('click', () => {
    remember(storage);
    card.remove();
  });
  return card;
}
