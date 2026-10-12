// src/app/screens/me.js
import { listsTeaching, modeOf } from '../shell/access.js';
import { el, initials, pageHeader } from '../shell/page.js';
import { createModeSlider } from './mode-slider.js';
import { createProfileForm, saveProfile } from './profile-form.js';

const ROWS = [
  ['progress', 'app.progress', '📈'], ['repertoire', 'app.repertoire', '📚'], ['teaching', 'app.teaching', '🧑‍🏫'],
  ['groups', 'app.groups', '👥'], ['catalog', 'app.catalog', '🗂️'], ['settings', 'app.settings', '⚙️'],
];

export async function renderMe(ctx, _route = {}, { onModeChange = () => {} } = {}) {
  const { document, i18n, profile, services } = ctx;
  let curator = false;
  try {
    curator = await services.catalog.amICurator();
  } catch {
    curator = false;
  }
  const list = el(document, 'nav', { className: 'me-list', attrs: { 'aria-label': i18n.t('app.me') } });
  function renderRows(mode) {
    list.replaceChildren(...ROWS
      .filter(([section]) => (section !== 'teaching' || listsTeaching(mode)) && (section !== 'catalog' || curator))
      .map(([section, key, icon]) => el(document, 'a', { className: 'me-row', attrs: { href: `#/me/${section}` } }, [
        el(document, 'span', { text: `${icon} ${i18n.t(key)}` }),
        el(document, 'span', { className: 'muted', text: '›' }),
      ])));
  }
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  let saved = modeOf(profile);
  let request = 0;
  // Saves run one at a time, in the order chosen, so the server ends on the last choice;
  // every success is remembered so a later failure snaps back to what was really saved.
  let queue = Promise.resolve();
  const save = async (mode, mine) => {
    try {
      await services.profile.setUsageMode(mode);
      saved = mode;
      profile.usage_mode = mode;
      if (mode !== 'train') ctx.markCoach();
      if (mine !== request) return;
      renderRows(mode);
      onModeChange(mode);
    } catch (error) {
      if (mine !== request) return;
      slider.set(saved);
      renderRows(saved);
      status.textContent = error?.message || i18n.t('mode.saveError');
    }
  };
  const slider = createModeSlider({
    document, i18n, value: saved,
    onChange: (mode) => {
      const mine = ++request;
      status.textContent = '';
      queue = queue.then(() => save(mode, mine));
      return queue;
    },
  });
  renderRows(saved);
  return el(document, 'section', { className: 'screen screen-me' }, [
    pageHeader({ document, title: i18n.t('app.me') }),
    el(document, 'a', { className: 'me-top', attrs: { href: '#/me/settings', 'aria-label': `${profile.display_name} · ${i18n.t('profileForm.title')}` } }, [
      el(document, 'div', { className: 'me-avatar', text: initials(profile.display_name), attrs: { 'aria-hidden': 'true' } }),
      el(document, 'div', { className: 'me-name', text: profile.display_name }),
    ]),
    slider.element,
    status,
    list,
  ]);
}

export async function renderSettings(ctx, { onLocaleChange, onSignOut, onProfileSaved = () => {} }) {
  const { document, i18n } = ctx;
  const form = createProfileForm({ document, i18n, user: ctx.user, profile: ctx.profile, withSettings: true });
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' }, dataset: { profileStatus: '' } });
  const memo = {};
  let saving = false;
  const save = el(document, 'button', {
    className: 'button-primary', text: i18n.t('profileForm.save'), attrs: { type: 'button' }, dataset: { action: 'save-profile' },
  });
  save.addEventListener('click', async () => {
    if (saving) return;
    saving = true;
    save.disabled = true;
    status.textContent = '';
    try {
      const fresh = await saveProfile(ctx, form.values(), memo);
      status.textContent = i18n.t('profileForm.saved');
      onProfileSaved(fresh);
    } catch (error) {
      status.textContent = error?.message || i18n.t('profileForm.saveError');
    } finally {
      saving = false;
      save.disabled = false;
    }
  });
  const languages = el(document, 'div', { className: 'segmented', attrs: { role: 'group', 'aria-label': i18n.t('app.language') } },
    [['en', 'English'], ['pt', 'Português']].map(([locale, label]) => el(document, 'button', {
      text: label, attrs: { type: 'button', 'aria-pressed': String(i18n.locale() === locale) }, dataset: { locale },
      on: { click: () => { i18n.setLocale(locale); onLocaleChange(); } },
    })));
  return el(document, 'section', { className: 'screen screen-settings' }, [
    pageHeader({ document, title: i18n.t('app.settings'), backLabel: i18n.t('app.back'), onBack: () => ctx.back('/me') }),
    el(document, 'h2', { className: 'section-label', text: i18n.t('profileForm.title') }),
    form.element, save, status,
    el(document, 'h2', { className: 'section-label', text: i18n.t('app.language') }),
    languages,
    el(document, 'a', { className: 'button-secondary', text: i18n.t('app.classic'), attrs: { href: '/dashboard' } }),
    el(document, 'button', {
      className: 'button-danger', text: i18n.t('app.signOut'), attrs: { type: 'button' }, dataset: { action: 'sign-out' },
      on: { click: () => onSignOut() },
    }),
  ]);
}
