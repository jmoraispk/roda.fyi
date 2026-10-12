// src/app/screens/me.js
import { createProfileForm, saveProfile } from './profile-form.js';
import { el, initials, pageHeader } from '../shell/page.js';

export async function renderMe(ctx) {
  const { document, i18n, profile, services } = ctx;
  let curator = false;
  try {
    curator = await services.catalog.amICurator();
  } catch {
    curator = false;
  }
  const rows = [
    ['progress', 'app.progress', '📈'], ['repertoire', 'app.repertoire', '📚'],
    ['teaching', 'app.teaching', '🧑‍🏫'], ['groups', 'app.groups', '👥'],
    ...(curator ? [['catalog', 'app.catalog', '🗂️']] : []),
    ['settings', 'app.settings', '⚙️'],
  ];
  return el(document, 'section', { className: 'screen screen-me' }, [
    pageHeader({ document, title: i18n.t('app.me') }),
    el(document, 'div', { className: 'me-top' }, [
      el(document, 'div', { className: 'me-avatar', text: initials(profile.display_name), attrs: { 'aria-hidden': 'true' } }),
      el(document, 'div', { className: 'me-name', text: profile.display_name }),
    ]),
    el(document, 'nav', { className: 'me-list' }, rows.map(([section, key, icon]) => el(document, 'a', {
      className: 'me-row', attrs: { href: `#/me/${section}` },
    }, [el(document, 'span', { text: `${icon} ${i18n.t(key)}` }), el(document, 'span', { className: 'muted', text: '›' })]))),
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
