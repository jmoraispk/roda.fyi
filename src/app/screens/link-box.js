// src/app/screens/link-box.js
import { el } from '../shell/page.js';

// A read-only link with Copy, an optional email share, and a short note.
export function linkBox(ctx, { link, label, note, mailSubject = null, status }) {
  const { document, i18n } = ctx;
  const input = el(document, 'input', { className: 'field-input', attrs: { readonly: true, 'aria-label': label } });
  input.value = link;
  const copy = el(document, 'button', {
    className: 'button-secondary small', text: i18n.t('groupPage.copy'), attrs: { type: 'button' }, dataset: { action: 'copy-link' },
    on: { click: async () => {
      try {
        await ctx.window.navigator.clipboard.writeText(link);
        status.textContent = i18n.t('groupPage.copied');
      } catch {
        input.select();
      }
    } },
  });
  const share = mailSubject
    ? el(document, 'a', {
      className: 'button-secondary small', text: i18n.t('groupPage.shareEmail'),
      attrs: { href: `mailto:?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(link)}` },
    })
    : null;
  return [input, el(document, 'div', { className: 'row-actions' }, [copy, share]), el(document, 'p', { className: 'muted', text: note })];
}
