function actionButton(document, label, attributes = {}, primary = false) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = primary ? 'primary-button' : 'secondary-button';
  element.textContent = label;
  for (const [name, value] of Object.entries(attributes)) {
    element.dataset[name] = value;
  }
  return element;
}

function section(document, title, wide = false) {
  const element = document.createElement('section');
  element.className = `group-panel${wide ? ' group-panel-wide' : ''}`;
  const heading = document.createElement('h3');
  heading.textContent = title;
  element.append(heading);
  return element;
}

function safeMessage(error) {
  return error?.message || 'Something went wrong. Please try again.';
}

export function createGroupView({
  document,
  groupService,
  identity: initialIdentity,
  onMembershipsChanged = async () => {},
  onAccessRevoked = async () => {},
}) {
  const workspace = document.querySelector('#groupWorkspace');
  const status = document.querySelector('#groupStatus');
  const discovery = document.querySelector('#groupDiscovery');
  const management = document.querySelector('#groupManagement');
  const dashboardContent = document.querySelector('#dashboardContent');
  const createDialog = document.querySelector('#createGroupDialog');
  const createForm = document.querySelector('#createGroupForm');
  const relationshipDialog = document.querySelector('#relationshipDialog');
  const relationshipForm = document.querySelector('#relationshipForm');
  const childDialog = document.querySelector('#childGroupDialog');
  const childForm = document.querySelector('#childGroupForm');
  const memberInvitationDialog = document.querySelector('#memberInvitationDialog');
  const memberInvitationForm = document.querySelector('#memberInvitationForm');
  const transferDialog = document.querySelector('#transferOwnershipDialog');
  const transferForm = document.querySelector('#transferOwnershipForm');
  const archiveDialog = document.querySelector('#archiveGroupDialog');
  const archiveForm = document.querySelector('#archiveGroupForm');
  let identity = { ...initialIdentity };
  let current = null;
  let discoveryTimer = null;
  let managementLoad = 0;
  let discoveryLoad = 0;

  function detectedTimezone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }

  function reveal() {
    if (workspace) workspace.hidden = false;
    if (dashboardContent) dashboardContent.hidden = true;
  }

  function showError(error, target = status) {
    if (target) target.textContent = safeMessage(error);
  }

  function closeDialog(dialog) {
    if (dialog?.open) dialog.close();
  }

  function renderGroupCards(container, groups = []) {
    const grid = document.createElement('div');
    grid.className = 'group-grid';
    for (const group of groups) {
      const card = document.createElement('article');
      card.className = 'group-card';
      card.setAttribute('aria-label', group.name);
      const heading = document.createElement('h3');
      heading.textContent = group.name;
      const details = document.createElement('p');
      details.textContent = [group.location, group.description].filter(Boolean).join(' · ')
        || 'No location or description yet.';
      card.append(heading, details);
      card.append(actionButton(document, 'Request member access', {
        action: 'request-member',
        groupId: group.id,
      }));
      if (identity.isCoach) {
        card.append(actionButton(document, 'Request coach access', {
          action: 'request-coach',
          groupId: group.id,
        }));
      }
      grid.append(card);
    }
    if (groups.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'group-muted';
      empty.textContent = 'No discoverable groups match that search.';
      grid.append(empty);
    }
    container.append(grid);
  }

  function renderDiscovery(groups = [], options = {}) {
    managementLoad += 1;
    reveal();
    management.replaceChildren();
    discovery.replaceChildren();
    discovery.className = 'group-discovery';

    const head = document.createElement('div');
    head.className = 'group-discovery-head';
    const title = document.createElement('h2');
    title.textContent = options.title ?? 'Find a group';
    const searchWrap = document.createElement('label');
    searchWrap.className = 'group-search';
    const search = document.createElement('input');
    search.type = 'search';
    search.setAttribute('aria-label', 'Search groups');
    search.placeholder = 'Search by name or location';
    search.value = options.searchText ?? '';
    searchWrap.append(search);
    head.append(title, searchWrap);
    discovery.append(head);

    if (identity.isCoach) {
      discovery.append(actionButton(document, 'Create another group', { action: 'create-group' }, true));
    }
    renderGroupCards(discovery, groups);
  }

  async function showDiscovery(searchText = '') {
    const request = ++discoveryLoad;
    managementLoad += 1;
    try {
      const groups = await groupService.searchGroups(searchText);
      if (request !== discoveryLoad) return;
      renderDiscovery(groups, { searchText });
    } catch (error) {
      if (request !== discoveryLoad) return;
      reveal();
      showError(error);
    }
  }

  function appendRow(panel, text, actions = []) {
    const row = document.createElement('div');
    row.className = 'group-row';
    const name = document.createElement('span');
    name.textContent = text;
    row.append(name);
    if (actions.length) {
      const buttons = document.createElement('div');
      buttons.className = 'group-row-actions';
      buttons.append(...actions);
      row.append(buttons);
    }
    panel.append(row);
  }

  function renderInvitationResult(panel, invitation) {
    const result = document.createElement('div');
    result.className = 'invitation-result';
    const link = `${globalThis.location?.origin ?? ''}/dashboard?member_invite=${encodeURIComponent(invitation.token)}`;
    const input = document.createElement('input');
    input.readOnly = true;
    input.setAttribute('aria-label', 'Invitation link');
    input.value = link;
    const share = document.createElement('a');
    share.textContent = 'Share by email';
    share.href = `mailto:?subject=${encodeURIComponent(`Join ${current.group.name} on Roda`)}&body=${encodeURIComponent(link)}`;
    const expiry = document.createElement('span');
    expiry.className = 'group-muted';
    expiry.textContent = 'Expires in 7 days · one-time use';
    result.append(input, share, expiry);
    panel.append(result);
  }

  function renderDiscoveryLink(panel, token) {
    panel.querySelector('.discovery-link-result')?.remove();
    const result = document.createElement('div');
    result.className = 'invitation-result discovery-link-result';
    const link = `${globalThis.location?.origin ?? ''}/dashboard?group_link=${encodeURIComponent(token)}`;
    const input = document.createElement('input');
    input.readOnly = true;
    input.setAttribute('aria-label', 'Discovery link');
    input.value = link;
    const warning = document.createElement('span');
    warning.className = 'group-muted';
    warning.textContent = 'This link reveals this group but never grants membership.';
    result.append(
      input,
      warning,
      actionButton(document, 'Rotate discovery link', { action: 'rotate-discovery' }),
      actionButton(document, 'Revoke discovery link', { action: 'revoke-discovery' }),
    );
    panel.append(result);
  }

  function renderManagement({ group, membership, roster = [], requests = [], relationships = [] }) {
    reveal();
    discovery.replaceChildren();
    management.replaceChildren();
    management.className = 'group-management';
    current = { group, membership, roster, requests, relationships };
    const isActiveCoach = membership?.state === 'active' && membership.access_level === 'coach';
    const isOwner = group.owner_id === identity.profileId;

    const heading = document.createElement('h2');
    heading.textContent = group.name;
    management.append(heading);

    const grid = document.createElement('div');
    grid.className = 'group-management-grid';
    if (isActiveCoach) {
      const invitations = section(document, 'Invite a student');
      const inviteForm = document.createElement('div');
      inviteForm.className = 'invite-form';
      const email = document.createElement('input');
      email.type = 'email';
      email.setAttribute('aria-label', 'Student email (optional)');
      email.placeholder = 'student@example.com (optional)';
      inviteForm.append(email, actionButton(document, 'Create invitation', {
        action: 'invite-member',
      }));
      invitations.append(inviteForm);
      grid.append(invitations);

      const requestSection = section(document, 'Pending requests');
      for (const request of requests.filter((item) => item.state === 'pending')) {
        const actions = [];
        if (request.requested_access === 'member' || isOwner) {
          actions.push(actionButton(document, `Approve ${request.display_name}`, {
            decision: 'approved', requestId: request.id,
          }));
        }
        actions.push(actionButton(document, `Decline ${request.display_name}`, {
          decision: 'declined', requestId: request.id,
        }));
        appendRow(requestSection, `${request.display_name} · ${request.requested_access}`, actions);
      }
      if (!requests.some((item) => item.state === 'pending')) {
        const empty = document.createElement('p');
        empty.className = 'group-muted';
        empty.textContent = 'No pending requests.';
        requestSection.append(empty);
      }
      grid.append(requestSection);

      const rosterSection = section(document, 'Roster', true);
      for (const member of roster.filter((item) => item.membership_state === 'active')) {
        const canRemove = member.profile_id !== identity.profileId
          && (member.access_level === 'member' || isOwner);
        const actions = canRemove ? [actionButton(document, `Remove ${member.display_name}`, {
          action: 'remove-member', profileId: member.profile_id,
        })] : [];
        appendRow(rosterSection, `${member.display_name} · ${member.access_level}`, actions);
      }
      grid.append(rosterSection);
    }

    const settings = section(document, 'Group settings', true);
    if (isOwner) {
      settings.append(
        actionButton(document, 'Edit group', { action: 'edit-group' }),
        actionButton(document, 'Change group timezone', { action: 'change-timezone' }),
        actionButton(document, 'Transfer ownership', { action: 'transfer-ownership' }),
        actionButton(document, 'Archive group', { action: 'archive-group' }),
        actionButton(document, 'Invite child group', { action: 'invite-child-group' }),
        actionButton(document, 'Create discovery link', { action: 'rotate-discovery' }),
      );
      if (relationships.some((item) => (
        item.state === 'active' && item.child_group_id === group.id
      ))) {
        settings.append(actionButton(document, 'Relationship settings', {
          action: 'relationship-settings',
        }));
      }
    } else if (membership?.state === 'active') {
      settings.append(actionButton(document, 'Leave group', { action: 'leave-group' }));
    }
    grid.append(settings);

    if (relationships.length) {
      const hierarchy = section(document, 'Group hierarchy', true);
      const note = document.createElement('p');
      note.className = 'group-muted';
      note.textContent = 'Visibility applies to the immediate parent only; it never cascades to higher groups.';
      hierarchy.append(note);
      for (const relationship of relationships) {
        const actions = [];
        if (isOwner && relationship.child_group_id === group.id && relationship.state === 'pending') {
          actions.push(
            actionButton(document, `Accept ${relationship.parent_name} as parent`, {
              relationshipDecision: 'accepted', relationshipId: relationship.id,
            }),
            actionButton(document, `Decline ${relationship.parent_name} as parent`, {
              relationshipDecision: 'declined', relationshipId: relationship.id,
            }),
          );
        }
        if (isOwner && relationship.state === 'active') {
          actions.push(actionButton(document, 'Revoke relationship', {
            action: 'revoke-relationship', relationshipId: relationship.id,
          }));
        }
        appendRow(
          hierarchy,
          `${relationship.parent_name ?? 'Parent group'} → ${relationship.child_name ?? group.name} · ${relationship.state} · ${relationship.sharing_level === 'full_coaching' ? 'Full coaching access' : 'Named progress'}`,
          actions,
        );
      }
      grid.append(hierarchy);
    }

    management.append(grid);
  }

  async function loadManagement(group, membership) {
    const request = ++managementLoad;
    discoveryLoad += 1;
    try {
      const canManage = membership?.state === 'active' && membership.access_level === 'coach';
      const [roster, requests, relationships] = await Promise.all([
        canManage && groupService.listRoster ? groupService.listRoster(group.id) : [],
        canManage && groupService.listJoinRequests ? groupService.listJoinRequests(group.id) : [],
        groupService.listRelationships ? groupService.listRelationships(group.id) : [],
      ]);
      if (request !== managementLoad) return;
      renderManagement({ group, membership, roster, requests, relationships });
    } catch (error) {
      if (request !== managementLoad) return;
      if (error?.kind === 'authorization' && group?.id) {
        clearPrivate();
        await onAccessRevoked(group.id);
        reveal();
        status.textContent = 'You no longer have access to that group.';
      } else {
        showError(error);
      }
    }
  }

  async function reloadManagement(message = '') {
    if (!current) return;
    const { group, membership } = current;
    await loadManagement(group, membership);
    if (message) status.textContent = message;
  }

  function openCreateGroup() {
    if (!identity.isCoach) return;
    createForm?.reset();
    createForm.dataset.mode = 'create';
    createForm.querySelector('h1').textContent = 'Create a group';
    createForm.querySelector('[type="submit"]').textContent = 'Create group';
    createForm.elements.timezone.value = detectedTimezone();
    createDialog?.showModal();
  }

  function openEditGroup(timezoneOnly = false) {
    if (!current) return;
    createForm.dataset.mode = timezoneOnly ? 'timezone' : 'edit';
    createForm.querySelector('h1').textContent = timezoneOnly ? 'Change group timezone' : 'Edit group';
    createForm.querySelector('[type="submit"]').textContent = timezoneOnly ? 'Save timezone' : 'Save group';
    createForm.elements.name.value = current.group.name ?? '';
    createForm.elements.description.value = current.group.description ?? '';
    createForm.elements.location.value = current.group.location ?? '';
    createForm.elements.timezone.value = current.group.timezone ?? detectedTimezone();
    createForm.elements.discoverable.checked = Boolean(current.group.is_discoverable);
    createDialog.showModal();
    if (timezoneOnly) createForm.elements.timezone.focus();
  }

  discovery.addEventListener('input', (event) => {
    if (event.target.type !== 'search') return;
    clearTimeout(discoveryTimer);
    discoveryTimer = setTimeout(() => showDiscovery(event.target.value), 180);
  });

  discovery.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'create-group') {
      openCreateGroup();
      return;
    }
    if (!target.dataset.groupId) return;
    const requestedAccess = target.dataset.action === 'request-coach' ? 'coach' : 'member';
    try {
      await groupService.requestAccess(target.dataset.groupId, requestedAccess);
      status.textContent = requestedAccess === 'coach'
        ? 'Your coach access request is pending.'
        : 'Your member access request is pending.';
    } catch (error) {
      showError(error);
    }
  });

  management.addEventListener('click', async (event) => {
    const target = event.target.closest('button');
    if (!target || !current) return;
    try {
      if (target.dataset.action === 'invite-member') {
        const email = management.querySelector('input[type="email"]').value.trim();
        const invitation = await groupService.createInvitation(current.group.id, email);
        const panel = target.closest('.group-panel');
        panel.querySelector('.invitation-result')?.remove();
        renderInvitationResult(panel, invitation);
        status.textContent = 'Invitation link created.';
      } else if (target.dataset.requestId) {
        await groupService.decideJoinRequest(target.dataset.requestId, target.dataset.decision);
        await reloadManagement(target.dataset.decision === 'approved' ? 'Request approved.' : 'Request declined.');
      } else if (target.dataset.action === 'remove-member') {
        await groupService.removeMember(current.group.id, target.dataset.profileId);
        await reloadManagement('Member removed.');
      } else if (target.dataset.relationshipDecision) {
        await groupService.decideRelationship(
          target.dataset.relationshipId,
          target.dataset.relationshipDecision,
        );
        await reloadManagement(target.dataset.relationshipDecision === 'accepted'
          ? 'Parent group accepted.'
          : 'Parent group declined.');
      } else if (target.dataset.action === 'revoke-relationship') {
        await groupService.revokeRelationship(target.dataset.relationshipId);
        await reloadManagement('Group relationship revoked.');
      } else if (target.dataset.action === 'relationship-settings') {
        const relationship = current.relationships.find((item) => (
          item.state === 'active' && item.child_group_id === current.group.id
        ));
        relationshipForm.dataset.relationshipId = relationship.id;
        const radio = relationshipForm.querySelector(`[value="${relationship.sharing_level}"]`);
        if (radio) radio.checked = true;
        relationshipDialog.showModal();
      } else if (target.dataset.action === 'rotate-discovery') {
        const link = await groupService.rotateDiscoveryLink(current.group.id);
        renderDiscoveryLink(target.closest('.group-panel'), link.token);
        status.textContent = 'Discovery link ready.';
      } else if (target.dataset.action === 'revoke-discovery') {
        await groupService.revokeDiscoveryLink(current.group.id);
        target.closest('.discovery-link-result')?.remove();
        status.textContent = 'Discovery link revoked.';
      } else if (target.dataset.action === 'transfer-ownership') {
        const select = transferForm.querySelector('select');
        select.replaceChildren();
        for (const member of current.roster.filter((item) => (
          item.membership_state === 'active'
          && item.access_level === 'coach'
          && item.profile_id !== identity.profileId
        ))) {
          const option = document.createElement('option');
          option.value = member.profile_id;
          option.textContent = member.display_name;
          select.append(option);
        }
        transferDialog.showModal();
      } else if (target.dataset.action === 'edit-group') {
        openEditGroup();
      } else if (target.dataset.action === 'change-timezone') {
        openEditGroup(true);
      } else if (target.dataset.action === 'archive-group') {
        archiveDialog.showModal();
      } else if (target.dataset.action === 'invite-child-group') {
        const groups = await groupService.searchGroups('');
        const select = childForm.querySelector('select');
        select.replaceChildren();
        for (const group of groups.filter((item) => item.id !== current.group.id)) {
          const option = document.createElement('option');
          option.value = group.id;
          option.textContent = group.name;
          select.append(option);
        }
        childDialog.showModal();
      }
    } catch (error) {
      showError(error);
    }
  });

  createForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = createForm.querySelector('[type="submit"]');
    const dialogStatus = createForm.querySelector('[data-dialog-status]');
    submit.disabled = true;
    try {
      const data = new FormData(createForm);
      const values = {
        name: data.get('name'),
        description: data.get('description'),
        location: data.get('location'),
        timezone: data.get('timezone'),
        discoverable: data.get('discoverable') === 'on',
      };
      const mode = createForm.dataset.mode;
      const editing = mode === 'edit' || mode === 'timezone';
      const result = mode === 'timezone'
        ? await groupService.setGroupTimezone(current.group.id, values.timezone)
        : editing
          ? await groupService.updateGroup(current.group.id, values)
          : await groupService.createGroup(values);
      closeDialog(createDialog);
      const groupId = editing ? current.group.id : (result.group_id ?? result.id);
      const memberships = await onMembershipsChanged(groupId);
      const membership = memberships?.find((item) => item.group_id === groupId);
      if (membership) await loadManagement(membership.group, membership);
      status.textContent = mode === 'timezone'
        ? 'Group timezone updated.'
        : editing ? 'Group updated.' : 'Group created.';
    } catch (error) {
      showError(error, dialogStatus);
    } finally {
      submit.disabled = false;
    }
  });

  relationshipForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(relationshipForm);
    const level = data.get('sharingLevel');
    const dialogStatus = relationshipForm.querySelector('[data-dialog-status]');
    try {
      await groupService.setRelationshipSharing(relationshipForm.dataset.relationshipId, level);
      closeDialog(relationshipDialog);
      await reloadManagement(level === 'full_coaching'
        ? 'Full coaching access saved for the immediate parent.'
        : 'Named progress saved for the immediate parent.');
    } catch (error) {
      showError(error, dialogStatus);
    }
  });

  childForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const dialogStatus = childForm.querySelector('[data-dialog-status]');
    try {
      const childGroupId = new FormData(childForm).get('childGroup');
      await groupService.inviteChildGroup(current.group.id, childGroupId);
      closeDialog(childDialog);
      status.textContent = 'Group invitation sent.';
    } catch (error) {
      showError(error, dialogStatus);
    }
  });

  memberInvitationForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const dialogStatus = memberInvitationForm.querySelector('[data-dialog-status]');
    const submit = memberInvitationForm.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const result = await groupService.acceptInvitation(memberInvitationForm.dataset.token);
      if (result.status === 'accepted' && !result.already_used) {
        closeDialog(memberInvitationDialog);
        await onMembershipsChanged(result.group_id);
        status.textContent = 'Invitation accepted. You are now a group member.';
      } else {
        const messages = {
          expired: 'This invitation has expired.',
          revoked: 'This invitation was revoked.',
          accepted: 'This invitation has already been used.',
        };
        closeDialog(memberInvitationDialog);
        reveal();
        status.textContent = messages[result.status] ?? 'This invitation is no longer available.';
      }
    } catch (error) {
      showError(error, dialogStatus);
    } finally {
      submit.disabled = false;
    }
  });

  transferForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const dialogStatus = transferForm.querySelector('[data-dialog-status]');
    try {
      const newOwnerId = new FormData(transferForm).get('newOwner');
      await groupService.transferOwnership(current.group.id, newOwnerId);
      closeDialog(transferDialog);
      await onMembershipsChanged(current.group.id);
      status.textContent = 'Ownership transferred.';
    } catch (error) {
      showError(error, dialogStatus);
    }
  });

  archiveForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const dialogStatus = archiveForm.querySelector('[data-dialog-status]');
    try {
      const groupId = current.group.id;
      await groupService.archiveGroup(groupId);
      closeDialog(archiveDialog);
      clearPrivate();
      await onMembershipsChanged();
    } catch (error) {
      showError(error, dialogStatus);
    }
  });

  for (const close of document.querySelectorAll('[data-close-dialog]')) {
    close.addEventListener('click', () => closeDialog(close.closest('dialog')));
  }

  function clearPrivate() {
    managementLoad += 1;
    discoveryLoad += 1;
    current = null;
    clearTimeout(discoveryTimer);
    discovery.replaceChildren();
    management.replaceChildren();
    if (status) status.textContent = '';
    if (workspace) workspace.hidden = true;
    if (dashboardContent) dashboardContent.hidden = false;
    for (const dialog of [
      createDialog,
      relationshipDialog,
      childDialog,
      memberInvitationDialog,
      transferDialog,
      archiveDialog,
    ]) {
      closeDialog(dialog);
    }
  }

  return {
    renderDiscovery,
    renderManagement,
    showDiscovery,
    openCreateGroup,
    loadManagement,
    setIdentity(nextIdentity) {
      identity = { ...nextIdentity };
    },
    handleMemberInvitation(token) {
      memberInvitationForm.dataset.token = token;
      memberInvitationForm.querySelector('[data-dialog-status]').textContent = '';
      memberInvitationDialog.showModal();
    },
    hide() {
      managementLoad += 1;
      discoveryLoad += 1;
      if (workspace) workspace.hidden = true;
      if (dashboardContent) dashboardContent.hidden = false;
    },
    clearPrivate,
  };
}
