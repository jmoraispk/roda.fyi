// src/app/screens/groups.js
import { el, pageHeader } from '../shell/page.js';
import { confirmButton } from './confirm-button.js';
import { openGroupForm } from './group-form.js';
import { openPeopleSearch } from './people-search.js';

function roleKey(membership, profileId) {
  if (membership.group.owner_id === profileId) return 'groupsPage.owner';
  return membership.access_level === 'coach' ? 'groupsPage.coach' : 'groupsPage.member';
}

export async function renderGroups(ctx) {
  const { document, i18n, services, profile } = ctx;
  const screen = el(document, 'section', { className: 'screen screen-groups' }, [
    pageHeader({ document, title: i18n.t('app.groups'), backLabel: i18n.t('app.back'), onBack: () => ctx.back('/me') }),
  ]);
  let memberships;
  let connections;
  try {
    [memberships, connections] = await Promise.all([services.group.listMyMemberships(), services.connection.listMine()]);
  } catch (error) {
    screen.append(el(document, 'p', { className: 'muted', text: error?.message || i18n.t('app.loadError') }));
    return screen;
  }
  const reload = async () => screen.replaceWith(await renderGroups(ctx));
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  const act = async (run) => {
    status.textContent = '';
    try {
      await run();
    } catch (error) {
      status.textContent = error?.message || i18n.t('groupPage.actionError');
    }
  };

  const groups = memberships.filter((membership) => membership.state === 'active' && membership.group && !membership.group.archived_at);
  screen.append(el(document, 'div', { className: 'section-head' }, [
    el(document, 'h2', { className: 'section-label', text: i18n.t('groupsPage.mine') }),
    ctx.isCoach() ? el(document, 'button', {
      className: 'button-secondary small', text: `+ ${i18n.t('groupsPage.create')}`, attrs: { type: 'button' }, dataset: { action: 'create-group' },
      on: { click: () => openGroupForm(ctx, { onSaved: (groupId) => ctx.navigate(`/group/${groupId}`) }) },
    }) : null,
  ]));
  screen.append(groups.length
    ? el(document, 'div', { className: 'day-items' }, groups.map((membership) => el(document, 'a', {
      className: 'card list-row', attrs: { href: `#/group/${membership.group_id}` },
    }, [
      el(document, 'div', {}, [
        el(document, 'strong', { text: membership.group.name }),
        el(document, 'div', { className: 'muted', text: [i18n.t(roleKey(membership, profile.id)), membership.group.location].filter(Boolean).join(' · ') }),
      ]),
      el(document, 'span', { className: 'muted', text: '›', attrs: { 'aria-hidden': 'true' } }),
    ])))
    : el(document, 'p', { className: 'muted', text: i18n.t('groupsPage.empty') }));
  if (!ctx.isCoach()) screen.append(el(document, 'p', { className: 'muted', text: i18n.t('groupsPage.createHint') }));

  function coachRow(connection) {
    const name = connection.coach_display_name;
    const how = connection.connection_kind === 'group'
      ? i18n.t('connections.group', { group: connection.group_name })
      : i18n.t('connections.direct');
    const actions = [];
    if (connection.connection_kind === 'direct' && connection.state === 'pending' && connection.initiated_by !== profile.id) {
      for (const [decision, key, label, className] of [
        ['accepted', 'teaching.accept', 'connections.accept', 'button-primary small'],
        ['declined', 'teaching.decline', 'connections.decline', 'button-secondary small'],
      ]) {
        actions.push(el(document, 'button', {
          className, text: i18n.t(key), dataset: { decision }, attrs: { type: 'button', 'aria-label': i18n.t(label, { name }) },
          on: { click: () => act(async () => { await services.connection.decide(connection.connection_id, decision); await reload(); }) },
        }));
      }
    } else if (connection.connection_kind === 'direct' && connection.state === 'active') {
      actions.push(confirmButton(document, {
        text: i18n.t('groupsPage.end'), confirmText: i18n.t('groupsPage.confirmEnd'),
        label: i18n.t('connections.end', { name }), dataset: { action: 'end-coach' },
        onConfirm: () => act(async () => { await services.connection.end(connection.connection_id); await reload(); }),
      }));
    }
    return el(document, 'div', { className: 'card list-row', dataset: { coach: connection.coach_profile_id } }, [
      el(document, 'div', {}, [
        el(document, 'strong', { text: name }),
        el(document, 'div', { className: 'muted', text: `${how} · ${i18n.t(`connections.${connection.state}`)}` }),
      ]),
      el(document, 'div', { className: 'row-actions' }, actions),
    ]);
  }

  const coaches = connections.filter((connection) => connection.student_profile_id === profile.id
    && ['pending', 'active'].includes(connection.state));
  screen.append(
    el(document, 'div', { className: 'section-head' }, [
      el(document, 'h2', { className: 'section-label', text: i18n.t('groupsPage.coaches') }),
      el(document, 'button', {
        className: 'button-secondary small', text: i18n.t('connections.findCoach'), attrs: { type: 'button' }, dataset: { action: 'find-coach' },
        on: { click: () => openPeopleSearch(ctx, { role: 'coach', onRequested: () => reload() }) },
      }),
    ]),
    coaches.length
      ? el(document, 'div', { className: 'day-items' }, coaches.map(coachRow))
      : el(document, 'p', { className: 'muted', text: i18n.t('connections.empty') }),
    status,
  );
  return screen;
}
