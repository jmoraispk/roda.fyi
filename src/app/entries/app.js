// src/app/entries/app.js
import { createServices } from '../create-services.js';
import { createDashboardI18n } from '../dashboard-i18n.js';
import { seedDemoData } from '../demo-data.js';
import { renderCalendar } from '../screens/calendar.js';
import { renderLog } from '../screens/log.js';
import { renderMe, renderSettings } from '../screens/me.js';
import { renderPlaceholder } from '../screens/placeholder.js';
import { renderToday } from '../screens/today.js';
import { renderTraining } from '../screens/training.js';
import { createLayout } from '../shell/layout.js';
import { el } from '../shell/page.js';
import { createRouter, isDetail, tabFor } from '../shell/router.js';
import { openSheet } from '../shell/sheet.js';

function localIsoDate(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

async function main() {
  const params = new URLSearchParams(location.search);
  const demoMode = params.get('demo') === '1';
  if (demoMode) seedDemoData(localStorage);
  const localMode = __RODA_E2E__ || demoMode;
  const services = createServices({ window, localMode });
  const i18n = createDashboardI18n({ document, storage: localStorage, navigator });
  const root = document.querySelector('#appRoot');

  const session = await services.auth.getSession();
  if (!session) {
    location.replace(`/?next=${encodeURIComponent(`/app${location.hash}`)}`);
    return;
  }
  const profile = await services.profile.loadProfile();
  const timezone = profile.timezone_override || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  let termMappings = [];
  services.catalog.listTermMappings().then((rows) => { termMappings = rows; }).catch(() => {});

  const desktop = window.matchMedia('(min-width: 900px)');
  let lastTopLevel = { name: 'today', path: '/', params: {} };
  let renderToken = 0;
  const layout = createLayout({ document, i18n, onPlus: () => router.navigate('/log') });
  root.replaceChildren(layout.root);
  layout.setOffline(!navigator.onLine);
  window.addEventListener('online', () => layout.setOffline(false));
  window.addEventListener('offline', () => layout.setOffline(true));

  const ctx = {
    document, window, i18n, services, profile, timezone,
    navigate: (path) => router.navigate(path),
    back: (fallback = '/') => router.back(fallback),
    today: () => localIsoDate(new Date(), timezone),
    now: () => new Date(),
    getTermMappings: () => termMappings,
    openSheet: (options) => openSheet({ document, closeLabel: i18n.t('app.close'), ...options }),
  };

  async function screenFor(route) {
    if (!profile.completed_at) {
      return el(document, 'section', { className: 'screen' }, [
        el(document, 'p', { text: i18n.t('app.completeProfile') }),
        el(document, 'a', { className: 'button-secondary', text: i18n.t('app.classic'), attrs: { href: '/dashboard' } }),
      ]);
    }
    switch (route.name) {
      case 'today': return renderToday(ctx, route);
      case 'calendar': return renderCalendar(ctx, route);
      case 'training': return renderTraining(ctx, route);
      case 'log': return renderLog(ctx, route);
      case 'me': return renderMe(ctx, route);
      case 'me-section':
        if (route.params.section === 'settings') {
          return renderSettings(ctx, {
            onLocaleChange: () => { layout.refreshCopy(); show(route); },
            onSignOut: async () => { await services.auth.signOut(); location.replace('/'); },
          });
        }
        return renderPlaceholder(ctx, { title: i18n.t(`app.${route.params.section}`) });
      case 'discover': return renderPlaceholder(ctx, { title: i18n.t('app.discover') });
      default: return renderPlaceholder(ctx, { title: i18n.t('app.today') });
    }
  }

  async function show(route) {
    const token = ++renderToken;
    const detailRoute = isDetail(route);
    const sideBySide = desktop.matches && route.name === 'training';
    layout.setActive(tabFor(route) ?? tabFor(lastTopLevel));
    layout.setDetailMode(detailRoute && !sideBySide);
    if (!detailRoute) lastTopLevel = route;
    const target = sideBySide ? layout.detail : layout.main;
    target.replaceChildren(el(document, 'p', { className: 'muted screen-loading', text: i18n.t('app.loading') }));
    if (sideBySide && !layout.main.firstElementChild?.dataset.screen) {
      const top = await screenFor(lastTopLevel);
      top.dataset.screen = lastTopLevel.name;
      if (token === renderToken) layout.main.replaceChildren(top);
    }
    if (!sideBySide) layout.detail.replaceChildren();
    const view = await screenFor(route);
    if (token !== renderToken) return;
    view.dataset.screen = route.name;
    target.replaceChildren(view);
    if (!sideBySide) layout.main.focus({ preventScroll: true });
  }

  const router = createRouter({ window, onRoute: (route) => { show(route); } });
  router.start();

  if (!__RODA_E2E__ && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/app-sw.js', { scope: '/app' }).catch(() => {});
  }
}

main();
