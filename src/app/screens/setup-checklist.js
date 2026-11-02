// src/app/screens/setup-checklist.js
// "Finish setting up" on Today: the few things that make roda useful, each a
// link to where it is done. It disappears when everything is done, and a
// person can hide it for themself.
import { el } from '../shell/page.js';

const HIDDEN = 'roda.setupChecklist.hidden';

const STEPS = Object.freeze({
  city: { label: 'setup.city', href: '#/me/settings' },
  install: { label: 'setup.install', href: '/install' },
  group: { label: 'setup.group', href: '#/me/groups' },
  training: { label: 'setup.training', href: '#/log' },
});

export function setupSteps({ hasCity, onPhone, installed, hasGroup, hasTraining }) {
  return [
    { id: 'city', done: Boolean(hasCity) },
    // Putting roda on the home screen only matters on a phone.
    ...(onPhone || installed ? [{ id: 'install', done: Boolean(installed) }] : []),
    { id: 'group', done: Boolean(hasGroup) },
    { id: 'training', done: Boolean(hasTraining) },
  ].map((step) => ({ ...step, ...STEPS[step.id] }));
}

function hiddenFor(storage, profileId) {
  try {
    return storage?.getItem(HIDDEN) === profileId;
  } catch {
    return false;
  }
}

export function renderSetupChecklist({ document, i18n, storage, profileId, steps }) {
  if (steps.every((step) => step.done) || hiddenFor(storage, profileId)) return null;
  const done = steps.filter((step) => step.done).length;
  const hide = el(document, 'button', {
    className: 'quiet-button', text: i18n.t('setup.hide'), attrs: { type: 'button' }, dataset: { action: 'hide-setup' },
  });
  const card = el(document, 'section', { className: 'card setup-checklist', attrs: { 'aria-label': i18n.t('setup.title') } }, [
    el(document, 'div', { className: 'setup-head' }, [
      el(document, 'h2', { className: 'setup-title', text: i18n.t('setup.title') }),
      el(document, 'span', { className: 'muted setup-progress', text: i18n.t('setup.progress', { done, total: steps.length }) }),
    ]),
    el(document, 'ul', { className: 'setup-steps' }, steps.map((step) => el(document, 'li', {}, [
      step.done
        ? el(document, 'span', { className: 'setup-step done', dataset: { step: step.id } }, [
          el(document, 'span', { className: 'setup-mark', text: '✓', attrs: { 'aria-hidden': 'true' } }),
          el(document, 'span', { text: i18n.t(step.label) }),
        ])
        : el(document, 'a', { className: 'setup-step', attrs: { href: step.href }, dataset: { step: step.id } }, [
          el(document, 'span', { className: 'setup-mark', attrs: { 'aria-hidden': 'true' } }),
          el(document, 'span', { text: i18n.t(step.label) }),
          el(document, 'span', { className: 'muted', text: '›', attrs: { 'aria-hidden': 'true' } }),
        ]),
    ]))),
    hide,
  ]);
  hide.addEventListener('click', () => {
    try {
      storage?.setItem(HIDDEN, profileId);
    } catch {
      // Blocked storage: the card simply comes back next time.
    }
    card.remove();
  });
  return card;
}

// Gathers what the checklist needs. If the account data can't be read (offline),
// it shows nothing rather than a wrong list.
export async function loadSetupChecklist(ctx, { hasTraining }) {
  const { services } = ctx;
  const [mine, memberships, connections] = await Promise.all([
    services.discover?.loadMine?.().catch(() => null) ?? null,
    services.group?.listMyMemberships?.().catch(() => null) ?? null,
    services.connection?.listMine?.().catch(() => null) ?? null,
  ]);
  if (mine === null || memberships === null) return null;
  const hasGroup = memberships.some((membership) => membership.state === 'active' && !membership.group?.archived_at)
    || (connections ?? []).some((connection) => connection.state === 'active');
  const device = ctx.device?.() ?? {};
  const steps = setupSteps({
    hasCity: Boolean(mine?.place_city), onPhone: device.onPhone, installed: device.installed, hasGroup, hasTraining,
  });
  let storage = null;
  try {
    storage = ctx.window?.localStorage ?? null;
  } catch {
    storage = null;
  }
  return renderSetupChecklist({ document: ctx.document, i18n: ctx.i18n, storage, profileId: ctx.profile.id, steps });
}
