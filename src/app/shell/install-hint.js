// src/app/shell/install-hint.js
// roda is a web app: people install it from the browser. iPhones have no
// install button, so the hint explains Add to Home Screen; browsers that offer
// an install prompt (Chrome, Edge, Android) get a real Install button.
import { el } from './page.js';

const DISMISSED = 'roda.installHint.dismissed';

export function installMode({ userAgent = '', standalone = false, canPrompt = false, touchPoints = 0 }) {
  if (standalone) return null;
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1);
  if (ios) return 'ios';
  return canPrompt ? 'prompt' : null;
}

function dismissed(storage) {
  try {
    return storage?.getItem(DISMISSED) === '1';
  } catch {
    return false;
  }
}

export function renderInstallHint({ document, i18n, storage, mode, installPrompt = null }) {
  if (!mode || dismissed(storage)) return null;
  const later = el(document, 'button', {
    className: 'quiet-button', text: i18n.t('install.notNow'), attrs: { type: 'button' }, dataset: { action: 'install-later' },
  });
  const actions = el(document, 'div', { className: 'install-actions' }, [later]);
  const card = el(document, 'section', { className: 'card install-hint', attrs: { 'aria-label': i18n.t('install.title') } }, [
    el(document, 'h2', { className: 'install-title', text: i18n.t('install.title') }),
    el(document, 'p', { text: i18n.t(mode === 'ios' ? 'install.ios' : 'install.prompt') }),
    actions,
  ]);
  if (mode === 'ios') {
    actions.prepend(el(document, 'a', { className: 'button-secondary', text: i18n.t('install.guide'), attrs: { href: '/install' } }));
  } else if (installPrompt) {
    const install = el(document, 'button', {
      className: 'button-primary', text: i18n.t('install.button'), attrs: { type: 'button' }, dataset: { action: 'install-app' },
    });
    install.addEventListener('click', async () => {
      install.disabled = true;
      try {
        await installPrompt.prompt();
        await installPrompt.userChoice;
      } finally {
        card.remove();
      }
    });
    actions.prepend(install);
  }
  later.addEventListener('click', () => {
    try {
      storage?.setItem(DISMISSED, '1');
    } catch {
      // Blocked storage: the hint simply comes back next time.
    }
    card.remove();
  });
  return card;
}
