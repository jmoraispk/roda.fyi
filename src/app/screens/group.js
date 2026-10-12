// src/app/screens/group.js
import { el, pageHeader } from '../shell/page.js';
import { confirmButton } from './confirm-button.js';
import { linkBox } from './link-box.js';

// Ruling R15: links keep pointing at /dashboard until the switch-over.
export function inviteLink(origin, token) {
  return `${origin}/dashboard?member_invite=${encodeURIComponent(token)}`;
}

function section(document, title, children) {
  return el(document, 'section', { className: 'group-section' }, [
    el(document, 'h2', { className: 'section-label', text: title }), ...children,
  ]);
}

export async function renderGroup(ctx, route) {
  const { document, i18n, services, profile } = ctx;
  const t = (key, values) => i18n.t(key, values);
  const groupId = route.params.id;
  const screen = el(document, 'section', { className: 'screen screen-group' });
  const back = () => ctx.back('/me/groups');
  const notAvailable = (text) => {
    screen.append(pageHeader({ document, title: '', backLabel: t('app.back'), onBack: back }), el(document, 'p', { className: 'muted', text }));
    return screen;
  };
  let memberships;
  try {
    memberships = await services.group.listMyMemberships();
  } catch (error) {
    return notAvailable(error?.message || t('app.loadError'));
  }
  const membership = memberships.find((item) => item.group_id === groupId && item.state === 'active' && item.group && !item.group.archived_at);
  // Ruling R14: Plan 3 replaces this branch with the Discover group card.
  if (!membership) return notAvailable(t('groupPage.unavailable'));
  const { group } = membership;
  const isOwner = group.owner_id === profile.id;
  const isCoach = membership.access_level === 'coach';
  let roster = [];
  let requests = [];
  let relationships = [];
  try {
    [roster, requests, relationships] = await Promise.all([
      isCoach ? services.group.listRoster(groupId) : [],
      isCoach ? services.group.listJoinRequests(groupId) : [],
      isOwner ? services.group.listRelationships(groupId) : [],
    ]);
  } catch (error) {
    return notAvailable(error?.kind === 'authorization' ? t('groupPage.unavailable') : (error?.message || t('app.loadError')));
  }
  const reload = async () => screen.replaceWith(await renderGroup(ctx, route));
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' }, dataset: { groupStatus: '' } });
  const act = async (run) => {
    status.textContent = '';
    try {
      await run();
    } catch (error) {
      status.textContent = error?.message || t('groupPage.actionError');
    }
  };

  function inviteSection() {
    const email = el(document, 'input', {
      className: 'field-input', attrs: { type: 'email', name: 'inviteEmail', autocomplete: 'off', 'aria-label': t('groupPage.inviteEmail'), placeholder: t('groupPage.inviteEmail') },
    });
    const result = el(document, 'div', { className: 'link-box' });
    const create = el(document, 'button', {
      className: 'button-secondary', text: t('groupPage.createInvite'), attrs: { type: 'button' }, dataset: { action: 'create-invite' },
    });
    create.addEventListener('click', () => act(async () => {
      const invitation = await services.group.createInvitation(groupId, email.value);
      result.replaceChildren(...linkBox(ctx, {
        link: inviteLink(ctx.window.location.origin, invitation.token), label: t('groupPage.inviteLink'),
        note: t('groupPage.inviteExpiry'), mailSubject: t('groupPage.inviteSubject', { name: group.name }), status,
      }));
    }));
    return section(document, t('groupPage.invite'), [email, create, result]);
  }

  function requestsSection() {
    const pending = requests.filter((request) => request.state === 'pending');
    if (!pending.length) return section(document, t('groupPage.requests'), [el(document, 'p', { className: 'muted', text: t('groupPage.noRequests') })]);
    return section(document, t('groupPage.requests'), pending.map((request) => {
      const decisions = [
        ...(request.requested_access === 'member' || isOwner ? [['approved', 'groupPage.approve', 'groupPage.approveName', 'button-primary small']] : []),
        ['declined', 'groupPage.decline', 'groupPage.declineName', 'button-secondary small'],
      ];
      return el(document, 'div', { className: 'card list-row', dataset: { joinRequest: request.id } }, [
        el(document, 'span', { text: t(request.requested_access === 'coach' ? 'groupPage.wantsCoach' : 'groupPage.wantsMember', { name: request.display_name }) }),
        el(document, 'div', { className: 'row-actions' }, decisions.map(([decision, key, label, className]) => el(document, 'button', {
          className, text: t(key), dataset: { decision }, attrs: { type: 'button', 'aria-label': t(label, { name: request.display_name }) },
          on: { click: () => act(async () => { await services.group.decideJoinRequest(request.id, decision); await reload(); }) },
        }))),
      ]);
    }));
  }

  function rosterSection() {
    const active = roster.filter((member) => (member.membership_state ?? 'active') === 'active');
    return section(document, t('groupPage.roster'), active.map((member) => {
      const canRemove = member.profile_id !== profile.id && (member.access_level === 'member' || isOwner);
      return el(document, 'div', { className: 'card list-row', dataset: { member: member.profile_id } }, [
        el(document, 'div', {}, [
          el(document, 'strong', { text: member.display_name }),
          el(document, 'div', { className: 'muted', text: t(member.access_level === 'coach' ? 'groupsPage.coach' : 'groupsPage.member') }),
        ]),
        canRemove ? confirmButton(document, {
          text: t('groupPage.remove'), confirmText: t('groupPage.confirmRemove'),
          label: t('groupPage.removeName', { name: member.display_name }), dataset: { action: 'remove-member' },
          onConfirm: () => act(async () => { await services.group.removeMember(groupId, member.profile_id); await reload(); }),
        }) : null,
      ]);
    }));
  }

  const role = t(isOwner ? 'groupsPage.owner' : isCoach ? 'groupsPage.coach' : 'groupsPage.member');
  screen.append(...[
    pageHeader({ document, title: group.name, backLabel: t('app.back'), onBack: back }),
    el(document, 'p', { className: 'muted', text: [role, group.location, group.timezone].filter(Boolean).join(' · ') }),
    group.description ? el(document, 'p', { text: group.description }) : null,
    status,
    ...(isCoach ? [inviteSection(), requestsSection(), rosterSection()] : []),
    isOwner ? null : confirmButton(document, {
      text: t('groupPage.leave'), confirmText: t('groupPage.confirmLeave'), className: 'button-danger', dataset: { action: 'leave-group' },
      onConfirm: () => act(async () => { await services.group.leaveGroup(groupId); ctx.navigate('/me/groups'); }),
    }),
  ].filter(Boolean));
  return screen;
}
