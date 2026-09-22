function button(document, label, action, attributes = {}) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'secondary-button';
  element.textContent = label;
  element.dataset.action = action;
  for (const [name, value] of Object.entries(attributes)) element.dataset[name] = value;
  return element;
}

function safeMessage(error) {
  return error?.message || 'Something went wrong. Please try again.';
}

export function createConnectionView({
  document,
  service,
  i18n,
  identity,
  onAccessRevoked = async () => {},
}) {
  const workspace = document.querySelector('#connectionWorkspace');
  const status = document.querySelector('#connectionStatus');
  const dialog = document.querySelector('#connectionSearchDialog');
  const title = document.querySelector('#connectionSearchTitle');
  const input = document.querySelector('#connectionSearchInput');
  const results = document.querySelector('#connectionSearchResults');
  let loadToken = 0;
  let searchToken = 0;
  let searchRole = 'coach';
  let searchTimer;

  function otherPerson(connection) {
    return identity.profileId === connection.coach_profile_id
      ? {
        id: connection.student_profile_id,
        name: connection.student_display_name,
        avatarPath: connection.student_avatar_path,
      }
      : {
        id: connection.coach_profile_id,
        name: connection.coach_display_name,
        avatarPath: connection.coach_avatar_path,
      };
  }

  function render(connections = []) {
    workspace.hidden = false;
    workspace.replaceChildren();
    const header = document.createElement('div');
    header.className = 'connection-header';
    const heading = document.createElement('h2');
    heading.textContent = i18n.t('connections.title');
    const actions = document.createElement('div');
    actions.className = 'connection-actions';
    actions.append(button(document, i18n.t('connections.findCoach'), 'find-coach'));
    if (identity.isCoach) {
      actions.append(button(document, i18n.t('connections.findStudent'), 'find-student'));
    }
    header.append(heading, actions);
    workspace.append(header);

    const list = document.createElement('div');
    list.className = 'connection-list';
    for (const connection of connections) {
      const person = otherPerson(connection);
      const row = document.createElement('article');
      row.className = 'connection-row';
      if (connection.connection_id) row.dataset.connectionId = connection.connection_id;

      const body = document.createElement('div');
      const name = document.createElement('h3');
      name.textContent = person.name;
      const context = document.createElement('p');
      context.textContent = connection.connection_kind === 'group'
        ? i18n.t('connections.group', { group: connection.group_name })
        : i18n.t('connections.direct');
      const state = document.createElement('span');
      state.className = `connection-state connection-state-${connection.state}`;
      state.textContent = i18n.t(`connections.${connection.state}`);
      body.append(name, context, state);
      row.append(body);

      if (connection.connection_kind === 'direct' && connection.connection_id) {
        const rowActions = document.createElement('div');
        rowActions.className = 'connection-row-actions';
        if (connection.state === 'pending' && connection.initiated_by !== identity.profileId) {
          rowActions.append(
            button(document, i18n.t('connections.accept', { name: person.name }),
              'accept-connection', { connectionId: connection.connection_id }),
            button(document, i18n.t('connections.decline', { name: person.name }),
              'decline-connection', { connectionId: connection.connection_id }),
          );
        } else if (connection.state === 'active') {
          rowActions.append(button(
            document,
            i18n.t('connections.end', { name: person.name }),
            'end-connection',
            { connectionId: connection.connection_id },
          ));
        }
        row.append(rowActions);
      }
      list.append(row);
    }
    if (connections.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'connection-empty';
      empty.textContent = i18n.t('connections.empty');
      list.append(empty);
    }
    workspace.append(list);
  }

  async function load() {
    const token = ++loadToken;
    try {
      const connections = await service.listMine();
      if (token !== loadToken) return;
      render(connections);
    } catch (error) {
      if (token !== loadToken) return;
      if (error?.kind === 'authorization') {
        clear();
        status.textContent = i18n.t('connections.accessRevoked');
        await onAccessRevoked();
      } else {
        status.textContent = safeMessage(error);
      }
    }
  }

  function renderCandidates(candidates) {
    results.replaceChildren();
    for (const candidate of candidates) {
      const row = document.createElement('article');
      row.className = 'connection-candidate';
      const name = document.createElement('span');
      name.textContent = candidate.display_name;
      row.append(name, button(
        document,
        i18n.t('connections.request', { name: candidate.display_name }),
        'request-connection',
        { candidateId: candidate.profile_id, candidateName: candidate.display_name },
      ));
      results.append(row);
    }
    if (candidates.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = i18n.t('connections.noResults');
      results.append(empty);
    }
  }

  async function showSearch(role = 'coach', searchText = '') {
    searchRole = role === 'student' && identity.isCoach ? 'student' : 'coach';
    const token = ++searchToken;
    title.textContent = i18n.t('connections.searchTitle');
    input.setAttribute('aria-label', i18n.t(
      searchRole === 'coach' ? 'connections.searchCoaches' : 'connections.searchStudents',
    ));
    input.value = searchText;
    if (!dialog.open) dialog.showModal();
    try {
      const candidates = await service.searchCandidates(searchText, searchRole);
      if (token !== searchToken) return;
      renderCandidates(candidates);
    } catch (error) {
      if (token !== searchToken) return;
      results.replaceChildren();
      status.textContent = safeMessage(error);
    }
  }

  function clear() {
    loadToken += 1;
    searchToken += 1;
    clearTimeout(searchTimer);
    workspace.replaceChildren();
    workspace.hidden = true;
    results.replaceChildren();
    if (dialog.open) dialog.close();
  }

  workspace.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    try {
      if (target.dataset.action === 'find-coach') return showSearch('coach');
      if (target.dataset.action === 'find-student') return showSearch('student');
      if (target.dataset.action === 'accept-connection') {
        await service.decide(target.dataset.connectionId, 'accepted');
        await load();
      } else if (target.dataset.action === 'decline-connection') {
        await service.decide(target.dataset.connectionId, 'declined');
        await load();
      } else if (target.dataset.action === 'end-connection') {
        await service.end(target.dataset.connectionId);
        status.textContent = i18n.t('connections.ended');
        await load();
      }
    } catch (error) {
      status.textContent = safeMessage(error);
    }
  });

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => showSearch(searchRole, input.value), 180);
  });

  results.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action="request-connection"]');
    if (!target) return;
    try {
      const coachId = searchRole === 'coach' ? target.dataset.candidateId : identity.profileId;
      const studentId = searchRole === 'student' ? target.dataset.candidateId : identity.profileId;
      await service.request(coachId, studentId);
      status.textContent = i18n.t('connections.requested', {
        name: target.dataset.candidateName,
      });
      dialog.close();
      await load();
    } catch (error) {
      status.textContent = safeMessage(error);
    }
  });

  dialog.querySelector('[data-close-connection-search]')?.addEventListener('click', () => {
    searchToken += 1;
    dialog.close();
  });

  return { load, showSearch, clear, render };
}
