// src/app/screens/sent-requests.js
import { el } from '../shell/page.js';

export async function renderSentRequests(ctx) {
  const { document, i18n } = ctx;
  let rows;
  try {
    rows = await ctx.services.group.listMyJoinRequests();
  } catch {
    return null;
  }
  const now = ctx.now?.() ?? new Date();
  const pending = rows.filter((row) => row.state === 'pending' && new Date(row.expires_at) > now);
  if (!pending.length) return null;
  const status = el(document, 'p', { className: 'muted', attrs: { role: 'status' } });
  const list = el(document, 'ul', { className: 'discover-group-list' });
  for (const row of pending) {
    const cancel = el(document, 'button', { className: 'quiet-button', text: i18n.t('groupCard.cancel'), attrs: { type: 'button' } });
    const item = el(document, 'li', { className: 'sent-request' }, [
      el(document, 'a', { text: row.group?.name ?? '', attrs: { href: `#/group/${row.group_id}` } }), ' ', cancel,
    ]);
    cancel.addEventListener('click', async () => {
      if (cancel.disabled) return;
      cancel.disabled = true;
      try {
        await ctx.services.group.cancelJoinRequest(row.id);
        item.remove();
        status.textContent = i18n.t('sentRequests.canceled');
      } catch (error) {
        cancel.disabled = false;
        status.textContent = error?.message || i18n.t('app.loadError');
      }
    });
    list.append(item);
  }
  return el(document, 'section', { className: 'sent-requests' }, [
    el(document, 'h2', { className: 'section-label', text: i18n.t('sentRequests.title') }), list, status,
  ]);
}
