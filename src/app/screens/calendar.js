import { renderPlaceholder } from './placeholder.js';

export async function renderCalendar(ctx) {
  return renderPlaceholder(ctx, { title: ctx.i18n.t('app.calendar') });
}
