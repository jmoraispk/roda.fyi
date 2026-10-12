import { renderPlaceholder } from './placeholder.js';

export async function renderToday(ctx) {
  return renderPlaceholder(ctx, { title: ctx.i18n.t('app.today') });
}
