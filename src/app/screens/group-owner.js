// src/app/screens/group-owner.js
import { el } from '../shell/page.js';
import { confirmButton } from './confirm-button.js';
import { renderGroupDiscoverForm } from './group-discover-form.js';
import { openGroupForm } from './group-form.js';
import { linkBox } from './link-box.js';

// Ruling R15: links keep pointing at /dashboard until the switch-over.
export function discoveryLink(origin, token) {
  return `${origin}/dashboard?group_link=${encodeURIComponent(token)}`;
}

function sheetForm(ctx, { title, label, name, options, submitText, submitClass = 'button-primary', onSubmit }) {
  const { document } = ctx;
  const select = el(document, 'select', { className: 'field-input', attrs: { name } },
    options.map(([value, text]) => el(document, 'option', { text, attrs: { value } })));
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  const submit = el(document, 'button', { className: submitClass, text: submitText, attrs: { type: 'submit' } });
  const form = el(document, 'form', { className: 'sheet-form' }, [
    el(document, 'label', { className: 'field-label' }, [label, select]), status, submit,
  ]);
  const sheet = ctx.openSheet({ title, content: form });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = '';
    try {
      await onSubmit(select.value);
      sheet.close();
    } catch (error) {
      status.textContent = error?.message || ctx.i18n.t('groupPage.actionError');
    } finally {
      submit.disabled = false;
    }
  });
  return sheet;
}

export function renderOwnerTools(ctx, { group, roster, relationships, reload, status }) {
  const { document, i18n, services } = ctx;
  const t = (key, values) => i18n.t(key, values);
  const act = async (run) => {
    status.textContent = '';
    try {
      await run();
    } catch (error) {
      status.textContent = error?.message || t('groupPage.actionError');
    }
  };
  const button = (key, action, onClick, className = 'button-secondary small') => el(document, 'button', {
    className, text: t(key), attrs: { type: 'button' }, dataset: { action }, on: { click: onClick },
  });

  const linkArea = el(document, 'div', { className: 'link-box' });
  const coaches = roster.filter((member) => (member.membership_state ?? 'active') === 'active'
    && member.access_level === 'coach' && member.profile_id !== ctx.profile.id);

  const tools = el(document, 'div', { className: 'chip-row' }, [
    button('groupForm.editTitle', 'edit-group', () => openGroupForm(ctx, { group, onSaved: () => reload() })),
    button('groupPage.discoveryLink', 'discovery-link', () => act(async () => {
      const result = await services.group.rotateDiscoveryLink(group.id);
      linkArea.replaceChildren(
        ...linkBox(ctx, { link: discoveryLink(ctx.window.location.origin, result.token), label: t('groupPage.discoveryLabel'), note: t('groupPage.discoveryHint'), status }),
        button('groupPage.revokeLink', 'revoke-link', () => act(async () => {
          await services.group.revokeDiscoveryLink(group.id);
          linkArea.replaceChildren();
          status.textContent = t('groupPage.linkRevoked');
        })),
      );
    })),
    coaches.length ? button('groupPage.transfer', 'transfer', () => sheetForm(ctx, {
      title: t('groupPage.transfer'), label: t('groupPage.newOwner'), name: 'newOwner',
      options: coaches.map((member) => [member.profile_id, member.display_name]),
      submitText: t('groupPage.transferConfirm'), submitClass: 'button-danger',
      onSubmit: async (newOwnerId) => { await services.group.transferOwnership(group.id, newOwnerId); await reload(); },
    })) : null,
    button('groupPage.inviteChild', 'invite-child', () => act(async () => {
      const groups = (await services.group.searchGroups('')).filter((candidate) => candidate.id !== group.id);
      if (!groups.length) {
        status.textContent = t('groupPage.noChildGroups');
        return;
      }
      sheetForm(ctx, {
        title: t('groupPage.inviteChild'), label: t('groupPage.childGroup'), name: 'childGroup',
        options: groups.map((candidate) => [candidate.id, candidate.name]), submitText: t('groupPage.sendInvite'),
        onSubmit: async (childGroupId) => {
          await services.group.inviteChildGroup(group.id, childGroupId);
          status.textContent = t('groupPage.childInvited');
        },
      });
    })),
  ]);

  function relationRow(relationship) {
    const isChild = relationship.child_group_id === group.id;
    const text = `${relationship.parent_name ?? ''} → ${relationship.child_name ?? group.name} · ${t(relationship.state === 'active' ? 'groupPage.relationActive' : 'groupPage.relationPending')}`;
    const actions = [];
    if (relationship.state === 'pending' && isChild) {
      for (const [decision, key, label, className] of [
        ['accepted', 'teaching.accept', 'groupPage.acceptParent', 'button-primary small'],
        ['declined', 'teaching.decline', 'groupPage.declineParent', 'button-secondary small'],
      ]) {
        actions.push(el(document, 'button', {
          className, text: t(key), dataset: { relationDecision: decision },
          attrs: { type: 'button', 'aria-label': t(label, { name: relationship.parent_name ?? '' }) },
          on: { click: () => act(async () => { await services.group.decideRelationship(relationship.id, decision); await reload(); }) },
        }));
      }
    }
    if (relationship.state === 'active') {
      actions.push(confirmButton(document, {
        text: t('groupPage.revoke'), confirmText: t('groupPage.confirmRevoke'), dataset: { action: 'revoke-relation' },
        onConfirm: () => act(async () => { await services.group.revokeRelationship(relationship.id); await reload(); }),
      }));
      if (isChild) {
        const sharing = el(document, 'select', { className: 'field-input', attrs: { name: 'sharing', 'aria-label': t('groupPage.sharing') } },
          [['named_progress', 'groupPage.namedProgress'], ['full_coaching', 'groupPage.fullCoaching']]
            .map(([value, key]) => el(document, 'option', { text: t(key), attrs: { value } })));
        sharing.value = relationship.sharing_level;
        sharing.addEventListener('change', () => act(async () => {
          await services.group.setRelationshipSharing(relationship.id, sharing.value);
          status.textContent = t('groupPage.sharingSaved');
        }));
        actions.push(sharing);
      }
    }
    return el(document, 'div', { className: 'card relation-row', dataset: { relationship: relationship.id } }, [
      el(document, 'span', { text }), el(document, 'div', { className: 'row-actions' }, actions),
    ]);
  }

  // The Discover place and contacts load on their own; owner tools render without waiting.
  const discoverSlot = el(document, 'div', { className: 'group-discover-slot' });
  renderGroupDiscoverForm(ctx, group.id).then((form) => { if (form) discoverSlot.replaceWith(form); }).catch(() => {});

  return el(document, 'section', { className: 'owner-tools' }, [
    el(document, 'h2', { className: 'section-label', text: t('groupPage.ownerTools') }),
    tools,
    linkArea,
    el(document, 'h2', { className: 'section-label', text: t('groupPage.hierarchy') }),
    el(document, 'p', { className: 'muted', text: t('groupPage.hierarchyNote') }),
    ...relationships.filter((relationship) => ['pending', 'active'].includes(relationship.state)).map(relationRow),
    discoverSlot,
    confirmButton(document, {
      text: t('groupPage.archive'), confirmText: t('groupPage.confirmArchive'), className: 'button-danger', dataset: { action: 'archive-group' },
      onConfirm: () => act(async () => { await services.group.archiveGroup(group.id); ctx.navigate('/me/groups'); }),
    }),
  ]);
}
