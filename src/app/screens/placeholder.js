// src/app/screens/placeholder.js
import { el, pageHeader } from '../shell/page.js';

export async function renderPlaceholder(ctx, { title }) {
  const { document, i18n } = ctx;
  return el(document, 'section', { className: 'screen screen-placeholder' }, [
    pageHeader({ document, title, backLabel: i18n.t('app.back'), onBack: () => ctx.back('/') }),
    el(document, 'p', { className: 'muted', text: i18n.t('app.comingSoon') }),
    el(document, 'a', { className: 'button-secondary', text: i18n.t('app.classic'), attrs: { href: '/dashboard' } }),
  ]);
}
