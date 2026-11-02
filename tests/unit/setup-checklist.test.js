// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { loadSetupChecklist, renderSetupChecklist, setupSteps } from '../../src/app/screens/setup-checklist.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });
function memory() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

describe('setup checklist', () => {
  beforeEach(() => { document.body.replaceChildren(); });

  it('lists what is left, with the home-screen step only on phones', () => {
    const phone = setupSteps({ hasCity: false, onPhone: true, installed: false, hasGroup: true, hasTraining: false });
    expect(phone.map(({ id, done }) => [id, done])).toEqual([
      ['city', false], ['install', false], ['group', true], ['training', false],
    ]);
    expect(setupSteps({ hasCity: true, onPhone: false, installed: false, hasGroup: true, hasTraining: true }).map(({ id }) => id))
      .toEqual(['city', 'group', 'training']);
  });

  it('links each unfinished step to where it is done and counts progress', () => {
    const steps = setupSteps({ hasCity: false, onPhone: true, installed: false, hasGroup: true, hasTraining: false });
    const card = renderSetupChecklist({ document, i18n, storage: memory(), profileId: 'me', steps });
    document.body.append(card);
    expect(card.querySelector('.setup-progress').textContent).toBe('1 of 4 done');
    expect([...card.querySelectorAll('a.setup-step')].map((link) => link.getAttribute('href')))
      .toEqual(['#/me/settings', '/install', '#/log']);
    expect(card.querySelector('[data-step="group"]').textContent).toContain('Join or create your group');
  });

  it('goes away when everything is done', () => {
    const steps = setupSteps({ hasCity: true, onPhone: true, installed: true, hasGroup: true, hasTraining: true });
    expect(renderSetupChecklist({ document, i18n, storage: memory(), profileId: 'me', steps })).toBeNull();
  });

  it('stays hidden for that person once hidden', () => {
    const storage = memory();
    const steps = setupSteps({ hasCity: false, onPhone: false, installed: false, hasGroup: false, hasTraining: false });
    const card = renderSetupChecklist({ document, i18n, storage, profileId: 'me', steps });
    document.body.append(card);
    card.querySelector('[data-action="hide-setup"]').click();
    expect(card.isConnected).toBe(false);
    expect(renderSetupChecklist({ document, i18n, storage, profileId: 'me', steps })).toBeNull();
    expect(renderSetupChecklist({ document, i18n, storage, profileId: 'someone-else', steps })).not.toBeNull();
  });

  it('reads the account to decide what is done, and shows nothing when it cannot', async () => {
    const services = {
      discover: { loadMine: async () => ({ place_city: 'Washington' }) },
      group: { listMyMemberships: async () => [{ state: 'left', group: {} }] },
      connection: { listMine: async () => [{ state: 'active' }] },
    };
    const ctx = { document, i18n, window, services, profile: { id: 'me' }, device: () => ({ onPhone: false, installed: false }) };
    const card = await loadSetupChecklist(ctx, { hasTraining: false });
    expect([...card.querySelectorAll('[data-step]')].map((node) => [node.dataset.step, node.classList.contains('done')]))
      .toEqual([['city', true], ['group', true], ['training', false]]);
    const offline = { ...ctx, services: { ...services, discover: { loadMine: async () => { throw new Error('offline'); } } } };
    expect(await loadSetupChecklist(offline, { hasTraining: false })).toBeNull();
  });
});
