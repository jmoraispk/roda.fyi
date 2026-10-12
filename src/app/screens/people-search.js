// src/app/screens/people-search.js
import { el } from '../shell/page.js';

// role 'coach': find someone to coach me. role 'student': find someone I coach.
export function openPeopleSearch(ctx, { role, onRequested = () => {} }) {
  const { document, i18n } = ctx;
  const connection = ctx.services.connection;
  const input = el(document, 'input', {
    className: 'field-input',
    attrs: { type: 'search', name: 'search', autocomplete: 'off', 'aria-label': i18n.t(role === 'coach' ? 'connections.searchCoaches' : 'connections.searchStudents') },
  });
  const results = el(document, 'div', { className: 'day-items' });
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  let token = 0;
  let timer = null;

  function candidateRow(person) {
    const button = el(document, 'button', {
      className: 'button-secondary small', text: i18n.t('peopleSearch.request'),
      attrs: { type: 'button', 'aria-label': i18n.t('connections.request', { name: person.display_name }) },
      dataset: { candidate: person.profile_id },
    });
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = '';
      try {
        if (role === 'coach') await connection.request(person.profile_id, ctx.profile.id);
        else await connection.request(ctx.profile.id, person.profile_id);
        status.textContent = i18n.t('connections.requested', { name: person.display_name });
        onRequested(person);
      } catch (error) {
        status.textContent = error?.message || i18n.t('groupPage.actionError');
        button.disabled = false;
      }
    });
    return el(document, 'div', { className: 'card list-row' }, [el(document, 'span', { text: person.display_name }), button]);
  }

  async function search() {
    const mine = ++token;
    try {
      const people = await connection.searchCandidates(input.value, role);
      if (mine !== token) return;
      results.replaceChildren(...(people.length
        ? people.map(candidateRow)
        : [el(document, 'p', { className: 'muted', text: i18n.t('connections.noResults') })]));
    } catch (error) {
      if (mine === token) status.textContent = error?.message || i18n.t('app.loadError');
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(search, 250);
  });
  const sheet = ctx.openSheet({
    title: i18n.t(role === 'coach' ? 'connections.findCoach' : 'connections.findStudent'),
    content: el(document, 'div', { className: 'sheet-form' }, [input, status, results]),
    onClose: () => clearTimeout(timer),
  });
  search();
  return sheet;
}
