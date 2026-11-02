// src/app/screens/notification-settings.js
// Settings → Notifications: this device's switch (Ruling 15) and what to send
// to every device of the account (Ruling 16).
import { AFTER_CHOICES, BEFORE_CHOICES, QUIET_HOURS } from '../notification-service.js';
import { deviceState, notificationLink, turnOff, turnOn } from '../notifications.js';
import { el } from '../shell/page.js';

const STATE_TEXT = Object.freeze({
  on: 'notifications.on', blocked: 'notifications.blocked', 'ios-browser': 'notifications.iosBrowser',
  unsupported: 'notifications.unsupported', demo: 'notifications.demo',
});

export function minutesLabel(i18n, minutes) {
  if (minutes < 60) return i18n.t('notifications.minutes', { count: minutes });
  if (minutes === 60) return i18n.t('notifications.hour');
  return i18n.t('notifications.hours', { count: minutes / 60 });
}

export function hourLabel(i18n, value) {
  const hour = Number(String(value).slice(0, 2));
  return new Intl.DateTimeFormat(i18n.locale() === 'pt' ? 'pt-PT' : 'en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2026, 0, 1, hour))).replace(/\u202f/g, ' ');
}

function choice(document, { name, label, values, value, text }) {
  return el(document, 'select', { className: 'field-input', attrs: { name, 'aria-label': label } },
    values.map((option) => el(document, 'option', { text: text(option), attrs: { value: String(option), selected: option === value } })));
}

function toggle(document, { name, label, checked }) {
  const input = el(document, 'input', { attrs: { type: 'checkbox', name, checked: Boolean(checked) } });
  return { input, row: el(document, 'label', { className: 'notification-row' }, [input, el(document, 'span', { text: label })]) };
}

function deviceBox(ctx) {
  const { document, i18n } = ctx;
  const box = el(document, 'div', { className: 'card notification-device' });
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  let busy = false;

  async function act(action) {
    if (busy) return;
    busy = true;
    status.textContent = '';
    try {
      draw(await action(notificationLink(ctx)));
    } catch (error) {
      status.textContent = error?.message || i18n.t('app.loadError');
    } finally {
      busy = false;
    }
  }

  function draw(state) {
    const parts = [el(document, 'h3', { className: 'notification-heading', text: i18n.t('notifications.device') })];
    if (state === 'off') {
      parts.push(el(document, 'button', {
        className: 'button-primary', text: i18n.t('notifications.turnOn'), attrs: { type: 'button' },
        dataset: { action: 'turn-on-notifications' }, on: { click: () => act(turnOn) },
      }));
    } else {
      parts.push(el(document, 'p', { className: 'notification-state', text: i18n.t(STATE_TEXT[state]), dataset: { state } }));
    }
    if (state === 'on') {
      parts.push(el(document, 'button', {
        className: 'button-secondary', text: i18n.t('notifications.turnOff'), attrs: { type: 'button' },
        dataset: { action: 'turn-off-notifications' }, on: { click: () => act(turnOff) },
      }));
    }
    if (state === 'blocked') parts.push(el(document, 'p', { className: 'muted', text: i18n.t('notifications.blockedHelp') }));
    if (state === 'ios-browser') {
      parts.push(
        el(document, 'p', { className: 'muted', text: i18n.t('notifications.iosHelp') }),
        el(document, 'a', { className: 'button-secondary', text: i18n.t('install.guide'), attrs: { href: '/install' } }),
      );
    }
    box.replaceChildren(...parts, status);
  }

  return { box, draw };
}

async function preferencesForm(ctx) {
  const { document, i18n, services } = ctx;
  let saved;
  try {
    saved = await services.notifications.getPreferences();
  } catch (error) {
    return el(document, 'p', { className: 'muted', text: error?.message || i18n.t('app.loadError') });
  }
  const setup = toggle(document, { name: 'setup', label: i18n.t('notifications.setup'), checked: saved.setup });
  const before = toggle(document, { name: 'before_class', label: i18n.t('notifications.beforeClass'), checked: saved.before_class });
  const beforeWhen = choice(document, {
    name: 'before_minutes', label: i18n.t('notifications.beforeWhen'), values: BEFORE_CHOICES, value: saved.before_minutes,
    text: (minutes) => minutesLabel(i18n, minutes),
  });
  const after = toggle(document, { name: 'after_class', label: i18n.t('notifications.afterClass'), checked: saved.after_class });
  const afterWhen = choice(document, {
    name: 'after_minutes', label: i18n.t('notifications.afterWhen'), values: AFTER_CHOICES, value: saved.after_minutes,
    text: (minutes) => minutesLabel(i18n, minutes),
  });
  const coach = ctx.isCoach?.() ? toggle(document, { name: 'coach', label: i18n.t('notifications.coach'), checked: saved.coach }) : null;
  const quiet = toggle(document, { name: 'quiet', label: i18n.t('notifications.quiet'), checked: saved.quiet_start !== null });
  const quietFrom = choice(document, {
    name: 'quiet_start', label: i18n.t('notifications.quietFrom'), values: QUIET_HOURS, value: saved.quiet_start ?? '22:00',
    text: (hour) => hourLabel(i18n, hour),
  });
  const quietTo = choice(document, {
    name: 'quiet_end', label: i18n.t('notifications.quietTo'), values: QUIET_HOURS, value: saved.quiet_end ?? '08:00',
    text: (hour) => hourLabel(i18n, hour),
  });
  const sync = () => {
    beforeWhen.disabled = !before.input.checked;
    afterWhen.disabled = !after.input.checked;
    quietFrom.disabled = !quiet.input.checked;
    quietTo.disabled = !quiet.input.checked;
  };
  for (const input of [before.input, after.input, quiet.input]) input.addEventListener('change', sync);
  sync();

  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' }, dataset: { notificationStatus: '' } });
  const save = el(document, 'button', {
    className: 'button-primary', text: i18n.t('notifications.save'), attrs: { type: 'button' }, dataset: { action: 'save-notifications' },
  });
  save.addEventListener('click', async () => {
    save.disabled = true;
    status.textContent = '';
    try {
      saved = await services.notifications.updatePreferences({
        setup: setup.input.checked,
        before_class: before.input.checked,
        before_minutes: Number(beforeWhen.value),
        after_class: after.input.checked,
        after_minutes: Number(afterWhen.value),
        coach: coach ? coach.input.checked : saved.coach,
        quiet_start: quiet.input.checked ? quietFrom.value : null,
        quiet_end: quiet.input.checked ? quietTo.value : null,
      });
      status.textContent = i18n.t('notifications.saved');
    } catch (error) {
      status.textContent = error?.message || i18n.t('app.loadError');
    } finally {
      save.disabled = false;
    }
  });

  return el(document, 'div', { className: 'card notification-preferences' }, [
    el(document, 'h3', { className: 'notification-heading', text: i18n.t('notifications.what') }),
    el(document, 'p', { className: 'muted', text: i18n.t('notifications.whatHelp') }),
    setup.row,
    el(document, 'div', { className: 'notification-pair' }, [before.row, beforeWhen]),
    el(document, 'div', { className: 'notification-pair' }, [after.row, afterWhen]),
    coach?.row ?? null,
    el(document, 'div', { className: 'notification-pair' }, [
      quiet.row, quietFrom, el(document, 'span', { className: 'muted', text: i18n.t('notifications.until') }), quietTo,
    ]),
    save,
    status,
  ]);
}

export async function renderNotificationSettings(ctx) {
  if (!ctx.services?.notifications) return null;
  const { document, i18n } = ctx;
  const device = deviceBox(ctx);
  device.draw(await deviceState(ctx.pushDevice ?? null).catch(() => 'unsupported'));
  return el(document, 'section', { className: 'notification-settings', attrs: { 'aria-label': i18n.t('notifications.title') } }, [
    el(document, 'h2', { className: 'section-label', text: i18n.t('notifications.title') }),
    device.box,
    await preferencesForm(ctx),
  ]);
}
