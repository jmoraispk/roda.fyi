// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { AppError } from '../../src/app/errors.js';
import { createConnectionView } from '../../src/app/ui/connection-view.js';

function fixture() {
  document.body.innerHTML = `
    <section id="connectionWorkspace"></section>
    <p id="connectionStatus" role="status"></p>
    <dialog id="connectionSearchDialog">
      <button type="button" data-close-connection-search>×</button>
      <h2 id="connectionSearchTitle"></h2>
      <input id="connectionSearchInput" type="search">
      <div id="connectionSearchResults"></div>
    </dialog>
  `;
  const dialog = document.querySelector('#connectionSearchDialog');
  dialog.showModal = () => dialog.setAttribute('open', '');
  dialog.close = () => dialog.removeAttribute('open');
}

function i18n() {
  return createDashboardI18n({
    document,
    storage: { getItem: () => null, setItem() {} },
    navigator: { languages: ['en'] },
  });
}

function service(overrides = {}) {
  return {
    listMine: async () => [{
      connection_id: 'connection-1',
      connection_kind: 'direct',
      coach_profile_id: 'coach-1',
      coach_display_name: 'Mestre Lua',
      student_profile_id: 'student-1',
      student_display_name: 'Student Ana',
      state: 'active',
      initiated_by: 'student-1',
    }, {
      connection_id: null,
      connection_kind: 'group',
      coach_profile_id: 'coach-2',
      coach_display_name: 'Professora Sol',
      student_profile_id: 'student-1',
      student_display_name: 'Student Ana',
      group_id: 'group-1',
      group_name: 'Grupo Sol',
      state: 'active',
    }],
    searchCandidates: async () => [],
    request: async () => ({ status: 'pending' }),
    decide: async () => ({ status: 'active' }),
    end: async () => ({ status: 'ended' }),
    ...overrides,
  };
}

beforeEach(fixture);

describe('connection view', () => {
  it('renders direct and group-derived connections with only valid actions', async () => {
    const view = createConnectionView({
      document,
      service: service(),
      i18n: i18n(),
      identity: { profileId: 'student-1', isCoach: false },
    });

    await view.load();

    expect(document.querySelector('[data-connection-id="connection-1"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Direct connection');
    expect(document.body.textContent).toContain('Through Grupo Sol');
    expect(document.querySelector('[data-action="end-connection"]')).not.toBeNull();
    expect(document.querySelector('[data-action="find-student"]')).toBeNull();
  });

  it('lets a request recipient accept or decline a pending connection', async () => {
    const decide = vi.fn(async () => ({ status: 'active' }));
    const connectionService = service({
      listMine: async () => [{
        connection_id: 'pending-1', connection_kind: 'direct',
        coach_profile_id: 'coach-1', coach_display_name: 'Mestre Lua',
        student_profile_id: 'student-1', student_display_name: 'Student Ana',
        initiated_by: 'coach-1', state: 'pending',
      }],
      decide,
    });
    const view = createConnectionView({
      document, service: connectionService, i18n: i18n(),
      identity: { profileId: 'student-1', isCoach: false },
    });
    await view.load();

    document.querySelector('[data-action="accept-connection"]').click();
    await Promise.resolve();
    await Promise.resolve();
    expect(decide).toHaveBeenCalledWith('pending-1', 'accepted');
  });

  it('searches safely and requests the selected coach', async () => {
    const request = vi.fn(async () => ({ status: 'pending' }));
    const view = createConnectionView({
      document,
      service: service({
        searchCandidates: async () => [{
          profile_id: 'coach-1', display_name: 'Mestre Lua', avatar_path: null,
        }],
        request,
        listMine: async () => [],
      }),
      i18n: i18n(),
      identity: { profileId: 'student-1', isCoach: false },
    });
    await view.showSearch('coach', 'Lua');

    expect(document.querySelector('#connectionSearchInput').getAttribute('aria-label'))
      .toBe('Search coaches');
    document.querySelector('[data-candidate-id="coach-1"]').click();
    await Promise.resolve();
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith('coach-1', 'student-1');
    expect(document.querySelector('#connectionStatus').textContent)
      .toBe('Request sent to Mestre Lua.');
  });

  it('suppresses an older search response', async () => {
    let finishOld;
    const oldResult = new Promise((resolve) => { finishOld = resolve; });
    const view = createConnectionView({
      document,
      service: service({
        searchCandidates: (query) => query === 'Lua'
          ? oldResult
          : Promise.resolve([{ profile_id: 'coach-2', display_name: 'Mestre Sol' }]),
      }),
      i18n: i18n(),
      identity: { profileId: 'student-1', isCoach: false },
    });

    const oldSearch = view.showSearch('coach', 'Lua');
    await view.showSearch('coach', 'Sol');
    finishOld([{ profile_id: 'coach-1', display_name: 'Mestre Lua' }]);
    await oldSearch;

    expect(document.querySelector('#connectionSearchResults').textContent).toContain('Mestre Sol');
    expect(document.querySelector('#connectionSearchResults').textContent).not.toContain('Mestre Lua');
  });

  it('clears names before reporting revoked access', async () => {
    const onAccessRevoked = vi.fn();
    let revoked = false;
    const view = createConnectionView({
      document,
      service: service({
        listMine: async () => {
          if (revoked) throw new AppError('authorization', 'not_authorized');
          return [{
            connection_id: 'connection-1', connection_kind: 'direct',
            coach_profile_id: 'coach-1', coach_display_name: 'Mestre Lua',
            student_profile_id: 'student-1', student_display_name: 'Student Ana',
            state: 'active', initiated_by: 'student-1',
          }];
        },
      }),
      i18n: i18n(),
      identity: { profileId: 'student-1', isCoach: false },
      onAccessRevoked,
    });
    await view.load();
    revoked = true;
    await view.load();

    expect(onAccessRevoked).toHaveBeenCalledOnce();
    expect(document.querySelector('#connectionWorkspace').textContent).not.toContain('Student Ana');
    expect(document.querySelector('#connectionWorkspace').textContent).not.toContain('Mestre Lua');
    expect(document.querySelector('#connectionStatus').textContent)
      .toContain('no longer have access');
  });
});
