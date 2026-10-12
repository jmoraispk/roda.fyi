// src/app/shell/layout.js
import { el } from './page.js';

const TABS = [['today', '#/', 'app.today', '◉'], ['calendar', '#/calendar', 'app.calendar', '▦'],
  ['discover', '#/discover', 'app.discover', '⌖'], ['me', '#/me', 'app.me', '☺']];

export function createLayout({ document, i18n, onPlus }) {
  const links = TABS.map(([tab, href, key, icon]) => el(document, 'a', {
    className: 'app-tab', attrs: { href }, dataset: { tab },
  }, [el(document, 'span', { className: 'app-tab-icon', text: icon, attrs: { 'aria-hidden': 'true' } }),
    el(document, 'span', { className: 'app-tab-label', dataset: { label: key } })]));
  const plus = el(document, 'button', { className: 'app-plus', text: '+', attrs: { type: 'button' }, on: { click: () => onPlus() } });
  const plusSide = el(document, 'button', { className: 'app-plus-side', attrs: { type: 'button' }, on: { click: () => onPlus() } });
  const brand = el(document, 'a', { className: 'app-brand', text: 'RODA', attrs: { href: '#/' } });
  const nav = el(document, 'nav', { className: 'app-nav' },
    [brand, plusSide, links[0], links[1], el(document, 'div', { className: 'app-plus-slot' }, [plus]), links[2], links[3]]);
  const main = el(document, 'main', { className: 'app-main', attrs: { id: 'appMain', tabindex: '-1' } });
  const detail = el(document, 'aside', { className: 'app-detail', attrs: { id: 'appDetail' } });
  const offline = el(document, 'p', { className: 'app-offline', attrs: { role: 'status', hidden: true } });
  const root = el(document, 'div', { className: 'app' }, [nav, offline, el(document, 'div', { className: 'app-panes' }, [main, detail])]);

  function refreshCopy() {
    nav.setAttribute('aria-label', i18n.t('app.navigation'));
    plus.setAttribute('aria-label', i18n.t('app.create'));
    plusSide.textContent = `+ ${i18n.t('app.logTraining')}`;
    offline.textContent = i18n.t('app.offline');
    for (const label of nav.querySelectorAll('[data-label]')) label.textContent = i18n.t(label.dataset.label);
  }
  refreshCopy();

  return {
    root, main, detail,
    setActive(tab) {
      for (const link of links) {
        if (link.dataset.tab === tab) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
    },
    setDetailMode(open) {
      document.body.classList.toggle('app-detail-open', Boolean(open));
    },
    setOffline(isOffline) {
      offline.hidden = !isOffline;
    },
    refreshCopy,
  };
}
