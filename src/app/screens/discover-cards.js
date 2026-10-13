// src/app/screens/discover-cards.js
import { placeLabel } from '../discover-rules.js';
import { el, initials, pageHeader } from '../shell/page.js';
import { contactLinks } from './discover-state.js';

async function avatar(ctx, kind, path, name) {
  const node = el(ctx.document, 'div', { className: 'me-avatar discover-avatar', text: initials(name), attrs: { 'aria-hidden': 'true' } });
  if (path) {
    const url = await ctx.services.discover.pictureUrl(kind, path).catch(() => null);
    if (url) node.replaceChildren(el(ctx.document, 'img', { attrs: { src: url, alt: '' } }));
  }
  return node;
}

function contactList(ctx, contacts) {
  const { document, i18n } = ctx;
  const links = contactLinks(contacts ?? {});
  if (!links.length) return null;
  return el(document, 'section', { className: 'discover-contacts' }, [
    el(document, 'h2', { className: 'section-label', text: i18n.t('person.contacts') }),
    el(document, 'ul', { className: 'discover-contact-list' }, links.map((link) => el(document, 'li', {}, [
      el(document, 'span', { className: 'muted', text: `${i18n.t(`contact.${link.kind}`)} ` }),
      el(document, 'a', { text: link.text, attrs: {
        href: link.href, target: link.kind === 'email' ? null : '_blank', rel: 'noopener noreferrer nofollow',
      } }),
    ]))),
  ]);
}

function groupLinks(ctx, groups, withRole) {
  return el(ctx.document, 'ul', { className: 'discover-group-list' }, groups.map((group) => el(ctx.document, 'li', {}, [
    el(ctx.document, 'a', { text: group.name, attrs: { href: `#/group/${group.group_id}` } }),
    withRole ? el(ctx.document, 'span', { className: 'muted', text: ` · ${ctx.i18n.t(`person.${group.role}`)}` }) : null,
  ])));
}

function shell(ctx, back, children) {
  return el(ctx.document, 'section', { className: 'screen screen-discover-card' }, [
    pageHeader({ document: ctx.document, title: '', backLabel: ctx.i18n.t('app.back'), onBack: back }), ...children,
  ]);
}

function unavailable(ctx, key, back) {
  return shell(ctx, back, [el(ctx.document, 'p', { className: 'muted', text: ctx.i18n.t(key) })]);
}

async function load(loader) {
  try {
    return { value: await loader() };
  } catch (error) {
    return { error };
  }
}

const isGone = (error) => !error || error.kind === 'validation' || error.kind === 'authorization';

export async function renderPerson(ctx, route) {
  const { document, i18n } = ctx;
  const back = () => ctx.back('/discover');
  const { value: person, error } = await load(() => ctx.services.discover.person(route.params.id));
  if (!person) return unavailable(ctx, isGone(error) ? 'person.unavailable' : 'app.loadError', back);
  const meta = [i18n.t(`person.mode.${person.usage_mode ?? 'train'}`), person.city ? placeLabel(person) : null]
    .filter(Boolean).join(' · ');
  const children = [
    el(document, 'div', { className: 'me-top' }, [
      await avatar(ctx, 'profile', person.avatar_path, person.display_name),
      el(document, 'div', {}, [
        el(document, 'h1', { className: 'page-title', text: person.display_name }),
        el(document, 'p', { className: 'muted', text: meta }),
      ]),
    ]),
  ];
  if (person.is_self) {
    const key = person.visibility === 'nobody' ? 'person.hiddenSelf' : `person.visibleSelf.${person.visibility}`;
    children.push(el(document, 'p', { className: 'card discover-self' }, [
      `${i18n.t(key)} `, el(document, 'a', { text: i18n.t('person.editSelf'), attrs: { href: '#/me/settings' } }),
    ]));
  }
  if (person.trains_in?.length) {
    children.push(el(document, 'h2', { className: 'section-label', text: i18n.t('person.trainsIn') }), groupLinks(ctx, person.trains_in, false));
  }
  if (person.teaches?.length) {
    children.push(el(document, 'h2', { className: 'section-label', text: i18n.t('person.teaches') }), groupLinks(ctx, person.teaches, true));
  }
  children.push(contactList(ctx, person.contacts));
  return shell(ctx, back, children.filter(Boolean));
}

export async function renderGroupCard(ctx, route) {
  const { document, i18n } = ctx;
  const back = () => ctx.back('/discover');
  const { value: group, error } = await load(() => ctx.services.discover.group(route.params.id));
  if (!group) return unavailable(ctx, isGone(error) ? 'groupCard.unavailable' : 'app.loadError', back);
  let requestId = group.my_request_id ?? null;
  const status = el(document, 'p', { className: 'muted discover-join-status', attrs: { role: 'status' } });
  const actions = el(document, 'div', { className: 'discover-join' });

  function showJoin() {
    const join = el(document, 'button', { className: 'button-primary', text: i18n.t('groupCard.join'), attrs: { type: 'button' } });
    join.addEventListener('click', async () => {
      if (join.disabled) return;
      join.disabled = true;
      try {
        const result = await ctx.services.group.requestAccess(group.group_id, 'member');
        requestId = result?.request_id ?? requestId;
        showPending();
      } catch (requestError) {
        join.disabled = false;
        status.textContent = requestError?.message || i18n.t('app.loadError');
      }
    });
    status.textContent = '';
    actions.replaceChildren(join);
  }

  function showPending() {
    status.textContent = i18n.t('groupCard.requested');
    const cancel = el(document, 'button', { className: 'button-secondary', text: i18n.t('groupCard.cancel'), attrs: { type: 'button' } });
    cancel.addEventListener('click', async () => {
      if (cancel.disabled || !requestId) return;
      cancel.disabled = true;
      try {
        await ctx.services.group.cancelJoinRequest(requestId);
        requestId = null;
        showJoin();
      } catch (cancelError) {
        cancel.disabled = false;
        status.textContent = cancelError?.message || i18n.t('app.loadError');
      }
    });
    actions.replaceChildren(...(requestId ? [cancel] : []));
  }

  if (group.my_status === 'pending') showPending();
  else if (group.my_status) status.textContent = i18n.t('groupCard.member');
  else showJoin();

  const children = [
    el(document, 'div', { className: 'me-top' }, [
      await avatar(ctx, 'group', group.picture_path, group.name),
      el(document, 'div', {}, [
        el(document, 'h1', { className: 'page-title', text: group.name }),
        el(document, 'p', { className: 'muted', text: group.location || (group.city ? placeLabel(group) : '') }),
      ]),
    ]),
  ];
  if (group.coaches?.length) {
    children.push(
      el(document, 'h2', { className: 'section-label', text: i18n.t('groupCard.coaches') }),
      el(document, 'ul', { className: 'discover-group-list' }, group.coaches.map((coach) => el(document, 'li', {}, [
        el(document, 'a', { text: coach.display_name, attrs: { href: `#/person/${coach.profile_id}` } }),
        coach.is_owner ? el(document, 'span', { className: 'muted', text: ` · ${i18n.t('person.owner')}` }) : null,
      ]))),
    );
  }
  children.push(contactList(ctx, group.contacts), actions, status);
  return shell(ctx, back, children.filter(Boolean));
}
