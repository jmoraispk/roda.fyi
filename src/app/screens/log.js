import { renderPlaceholder } from './placeholder.js';

export async function renderLog(ctx) {
  return renderPlaceholder(ctx, { title: ctx.i18n.t('app.logTraining') });
}
