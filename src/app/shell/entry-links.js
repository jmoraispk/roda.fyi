// src/app/shell/entry-links.js
// One-time links (member invitations, unlisted group links) arrive as query
// parameters. The token leaves the address bar as soon as the signed-in app
// starts, waits in this tab's storage, and opens on the first screen that is
// not the welcome flow.
import { el } from './page.js';

export const LINK_PARAMS = Object.freeze(['member_invite', 'group_link']);
const KEY = 'roda.entryLinks';
let held = null;

export function takeEntryLinks(window, storage) {
  const url = new URL(window.location.href);
  const links = {};
  let changed = false;
  for (const name of LINK_PARAMS) {
    if (!url.searchParams.has(name)) continue;
    const value = url.searchParams.get(name).trim();
    if (value) links[name] = value;
    url.searchParams.delete(name);
    changed = true;
  }
  if (changed) window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  if (Object.keys(links).length) {
    try {
      storage.setItem(KEY, JSON.stringify(links));
      held = null;
    } catch {
      // Storage is missing or blocked: keep the link for this page load only.
      held = links;
    }
  }
  return links;
}

function readLinks(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(KEY) ?? 'null');
    if (saved && typeof saved === 'object') return saved;
  } catch {
    // Fall back to the in-memory copy.
  }
  return held;
}

function forget(storage) {
  held = null;
  try {
    storage?.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}

const INVITE_MESSAGES = Object.freeze({ expired: 'links.expired', revoked: 'links.revoked', accepted: 'links.used' });
// What the database raises for an invitation that can never be accepted by this person.
const INVITE_REFUSALS = Object.freeze({
  invitation_not_found: 'links.revoked',
  invitation_revoked: 'links.revoked',
  already_used: 'links.used',
  invitation_expired: 'links.expired',
  invitation_email_mismatch: 'links.otherEmail',
});

function showInvitation(ctx, token) {
  const { document, i18n } = ctx;
  const status = el(document, 'p', { attrs: { role: 'status' } });
  const accept = el(document, 'button', {
    className: 'button-primary', text: i18n.t('links.accept'), attrs: { type: 'button' }, dataset: { action: 'accept-invite' },
  });
  const body = el(document, 'div', { className: 'entry-link' }, [el(document, 'p', { text: i18n.t('links.inviteIntro') }), accept, status]);
  accept.addEventListener('click', async () => {
    accept.disabled = true;
    try {
      const result = await ctx.services.group.acceptInvitation(token);
      // 'already_accepted': this same person accepted it before, so they are in the group.
      if ((result?.status === 'accepted' && !result.already_used) || result?.status === 'already_accepted') {
        status.textContent = i18n.t('links.accepted');
        accept.replaceWith(el(document, 'button', {
          className: 'button-secondary', text: i18n.t('links.openGroups'), attrs: { type: 'button' }, dataset: { action: 'open-groups' },
          on: { click: () => ctx.navigate('/me/groups') },
        }));
        return;
      }
      status.textContent = i18n.t(INVITE_MESSAGES[result?.status] ?? 'links.unavailable');
    } catch (error) {
      const refusal = INVITE_REFUSALS[error?.code];
      if (refusal) {
        status.textContent = i18n.t(refusal);
        return;
      }
      status.textContent = error?.message || i18n.t('links.unavailable');
      accept.disabled = false;
    }
  });
  ctx.openSheet({ title: i18n.t('links.inviteTitle'), content: body });
}

async function showGroupLink(ctx, token) {
  const { document, i18n } = ctx;
  let group = null;
  try {
    group = await ctx.services.group.resolveDiscoveryToken(token);
  } catch {
    group = null;
  }
  if (!group) {
    ctx.openSheet({ title: i18n.t('links.groupTitle'), content: el(document, 'p', { text: i18n.t('links.groupUnavailable') }) });
    return;
  }
  const status = el(document, 'p', { attrs: { role: 'status' } });
  const request = el(document, 'button', {
    className: 'button-primary', text: i18n.t('links.requestMember'), attrs: { type: 'button' }, dataset: { action: 'request-member' },
  });
  request.addEventListener('click', async () => {
    request.disabled = true;
    try {
      await ctx.services.group.requestAccess(group.id, 'member', token);
      status.textContent = i18n.t('links.requested');
    } catch (error) {
      status.textContent = error?.message || i18n.t('app.loadError');
      request.disabled = false;
    }
  });
  ctx.openSheet({ title: group.name, content: el(document, 'div', { className: 'entry-link' }, [
    group.location ? el(document, 'p', { className: 'muted', text: group.location }) : null,
    group.description ? el(document, 'p', { text: group.description }) : null,
    el(document, 'p', { className: 'muted', text: i18n.t('links.groupNote') }),
    request, status,
  ]) });
}

export async function runEntryLinks(ctx, storage) {
  const links = readLinks(storage);
  if (!links) return;
  forget(storage);
  if (links.member_invite) showInvitation(ctx, links.member_invite);
  else if (links.group_link) await showGroupLink(ctx, links.group_link);
}
