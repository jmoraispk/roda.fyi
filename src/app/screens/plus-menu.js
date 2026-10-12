// src/app/screens/plus-menu.js
import { el } from '../shell/page.js';
import { openScheduleSheet } from './schedule-sheet.js';

const ITEMS = {
  log: ['📝', 'plus.log', (ctx) => ctx.navigate('/log')],
  schedule: ['📅', 'plus.schedule', (ctx) => openScheduleSheet(ctx)],
  record: ['🧾', 'plus.record', (ctx) => ctx.navigate('/me/teaching/record')],
};

export function openPlusMenu(ctx, actions) {
  const { document, i18n } = ctx;
  let sheet = null;
  const content = el(document, 'div', { className: 'plus-menu' }, actions.map((action) => {
    const [icon, key, run] = ITEMS[action];
    return el(document, 'button', {
      className: 'card plus-item', text: `${icon} ${i18n.t(key)}`, attrs: { type: 'button' }, dataset: { plus: action },
      on: { click: () => { sheet.close(); run(ctx); } },
    });
  }));
  sheet = ctx.openSheet({ title: i18n.t('app.create'), content });
  return sheet;
}
