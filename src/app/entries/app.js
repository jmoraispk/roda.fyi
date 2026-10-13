// src/app/entries/app.js
import { loadStartup } from '../app-startup.js';
import { createServices } from '../create-services.js';
import { clearLegacyDashboardKeys } from '../local-data.js';
import { E2E_TILES, OSM_TILES } from '../map-tiles.js';
import { createLeafletMap } from '../screens/discover-map.js';
import { createDashboardI18n } from '../dashboard-i18n.js';
import { useErrorTranslations } from '../errors.js';
import { seedDemoData } from '../demo-data.js';
import { renderCatalog } from '../screens/catalog.js';
import { renderProgress } from '../screens/progress.js';
import { renderRepertoire } from '../screens/repertoire.js';
import { renderCalendar } from '../screens/calendar.js';
import { renderClass } from '../screens/class.js';
import { renderPerson } from '../screens/discover-cards.js';
import { renderDiscover } from '../screens/discover.js';
import { renderGroup } from '../screens/group.js';
import { renderGroups } from '../screens/groups.js';
import { renderLog } from '../screens/log.js';
import { renderMe, renderSettings } from '../screens/me.js';
import { signOutSafely } from '../screens/sign-out.js';
import { renderPlan } from '../screens/plan.js';
import { renderStudent } from '../screens/student.js';
import { renderTeaching } from '../screens/teaching.js';
import { renderToday } from '../screens/today.js';
import { renderWelcome } from '../screens/welcome.js';
import { renderTraining } from '../screens/training.js';
import { modeOf, plusActions, redirectFor } from '../shell/access.js';
import { openPlusMenu } from '../screens/plus-menu.js';
import { renderRecordClass } from '../screens/record-class.js';
import { createLayout } from '../shell/layout.js';
import { runEntryLinks, takeEntryLinks } from '../shell/entry-links.js';
import { el } from '../shell/page.js';
import { createRouter, isDetail, tabFor } from '../shell/router.js';
import { closeSheet, openSheet } from '../shell/sheet.js';

function localIsoDate(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function zoneFor(profile) {
  return profile.timezone_override || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

async function main() {
  clearLegacyDashboardKeys(localStorage);
  const params = new URLSearchParams(location.search);
  const demoMode = params.get('demo') === '1';
  if (demoMode) seedDemoData(localStorage);
  const tabStorage = (() => {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  })();
  const localMode = __RODA_E2E__ || demoMode;
  const i18n = createDashboardI18n({ document, storage: localStorage, navigator });
  useErrorTranslations(i18n);
  const services = createServices({ window, localMode, e2e: __RODA_E2E__, language: () => i18n.locale() });
  const root = document.querySelector('#appRoot');

  const toSignIn = () => location.replace(`/?next=${encodeURIComponent(`${location.pathname}${location.search}${location.hash}`)}`);
  const startup = await loadStartup({ auth: services.auth, profile: services.profile });
  if (startup.status === 'signed-out') {
    toSignIn();
    return;
  }
  if (startup.status === 'error') {
    root.replaceChildren(el(document, 'section', { className: 'screen' }, [
      el(document, 'p', { text: navigator.onLine ? (startup.error?.message || i18n.t('app.loadError')) : i18n.t('app.offline') }),
      el(document, 'button', { className: 'button-primary', text: i18n.t('app.retry'), attrs: { type: 'button' }, on: { click: () => location.reload() } }),
    ]));
    return;
  }
  const { profile, session } = startup;
  takeEntryLinks(window, tabStorage);
  let isCoach = Boolean(startup.coachProfile);
  services.auth.onAuthStateChange((_event, nextSession) => {
    if (!nextSession) toSignIn();
  });
  let termMappings = [];
  async function refreshTermMappings() {
    try {
      termMappings = await services.catalog.listTermMappings();
    } catch {
      // Keep the last mappings; recognition still works with the built-in catalog.
    }
  }
  refreshTermMappings();

  const desktop = window.matchMedia('(min-width: 900px)');
  let lastTopLevel = { name: 'today', path: '/', params: {}, query: {} };
  let renderToken = 0;
  // Ruling R9: + follows the mode on phones and on the desktop sidebar.
  const layout = createLayout({
    document, i18n, demo: demoMode,
    onPlus: () => {
      const actions = plusActions(modeOf(profile));
      if (actions.length === 1) router.navigate('/log');
      else openPlusMenu(ctx, actions);
    },
    plusLabel: () => (plusActions(modeOf(profile)).length === 1 ? 'app.logTraining' : 'app.create'),
  });
  root.replaceChildren(layout.root);
  layout.setOffline(!navigator.onLine);
  window.addEventListener('online', () => layout.setOffline(false));
  window.addEventListener('offline', () => layout.setOffline(true));

  const tiles = __RODA_E2E__ ? E2E_TILES : OSM_TILES;
  const ctx = {
    document, window, i18n, services, profile, timezone: zoneFor(profile), user: session.user,
    navigate: (path) => router.navigate(path),
    replace: (path) => router.replace(path),
    back: (fallback = '/') => router.back(fallback),
    today: () => localIsoDate(new Date(), ctx.timezone),
    now: () => new Date(),
    getTermMappings: () => termMappings,
    refreshTermMappings,
    isCoach: () => isCoach,
    markCoach: () => { isCoach = true; },
    createMap: (options) => createLeafletMap({ document, tiles, ...options }),
    openSheet: (options) => openSheet({ document, closeLabel: i18n.t('app.close'), ...options }),
  };

  function profileSaved(fresh) {
    Object.assign(profile, fresh);
    ctx.timezone = zoneFor(profile);
    layout.refreshCopy();
  }

  async function meSection(route) {
    const { section } = route.params;
    if (section === 'settings') {
      return renderSettings(ctx, {
        onLocaleChange: () => { layout.refreshCopy(); show(route); },
        onSignOut: () => signOutSafely(ctx, {
          signOut: async () => { await services.auth.signOut(); location.replace('/'); },
        }),
        onProfileSaved: profileSaved,
      });
    }
    if (section === 'teaching') return renderTeaching(ctx, route);
    if (section === 'progress') return renderProgress(ctx, route);
    if (section === 'repertoire') return renderRepertoire(ctx, route);
    if (section === 'groups') return renderGroups(ctx, route);
    if (section === 'catalog') {
      let curator = false;
      try {
        curator = await services.catalog.amICurator();
      } catch {
        curator = false;
      }
      if (!curator) {
        router.replace('/me');
        return null;
      }
      return renderCatalog(ctx, route);
    }
    router.replace('/me');
    return null;
  }

  async function screenFor(route) {
    switch (route.name) {
      case 'today': return renderToday(ctx, route);
      case 'calendar': return renderCalendar(ctx, route);
      case 'training': return renderTraining(ctx, route);
      case 'log': return renderLog(ctx, route);
      case 'me': return renderMe(ctx, route, { onModeChange: () => layout.refreshCopy() });
      case 'me-section': return meSection(route);
      case 'welcome':
        return renderWelcome(ctx, route, {
          onDone: (fresh, mode) => {
            if (mode !== 'train') isCoach = true;
            profileSaved(fresh);
            router.replace('/');
          },
        });
      case 'teaching-record': return renderRecordClass(ctx, route);
      case 'class': return renderClass(ctx, route);
      case 'teaching-plan': return renderPlan(ctx, route);
      case 'teaching-student': return renderStudent(ctx, route);
      case 'group': return renderGroup(ctx, route);
      case 'discover': return renderDiscover(ctx, route);
      case 'person': return renderPerson(ctx, route);
      default: return renderToday(ctx, route);
    }
  }

  async function show(route) {
    const redirect = redirectFor(route, { profile, isCoach });
    if (redirect) {
      router.replace(redirect);
      return;
    }
    const token = ++renderToken;
    closeSheet();
    const detailRoute = isDetail(route);
    // Ruling R23: a class, plan, or student opened from Teaching appears beside it on desktop.
    const besideTeaching = desktop.matches && ['class', 'teaching-plan', 'teaching-student'].includes(route.name)
      && layout.main.firstElementChild?.dataset.teachingHome !== undefined;
    // Ruling 16 (Plan 3): person and group cards opened from Discover appear beside the map on desktop.
    const besideDiscover = (route.name === 'person' || route.name === 'group') && lastTopLevel.name === 'discover';
    const sideBySide = (desktop.matches && (route.name === 'training' || besideDiscover)) || besideTeaching;
    layout.setActive(tabFor(route) ?? tabFor(lastTopLevel));
    layout.setDetailMode(detailRoute && !sideBySide);
    // The welcome has no way out until it is finished, on phones and desktop alike.
    layout.root.classList.toggle('app-welcome', route.name === 'welcome');
    if (!detailRoute) lastTopLevel = route;
    const target = sideBySide ? layout.detail : layout.main;
    target.replaceChildren(el(document, 'p', { className: 'muted screen-loading', text: i18n.t('app.loading') }));
    if (sideBySide && !besideTeaching && layout.main.firstElementChild?.dataset.screen !== lastTopLevel.name) {
      const top = await screenFor(lastTopLevel);
      top.dataset.screen = lastTopLevel.name;
      if (token === renderToken) layout.main.replaceChildren(top);
    }
    if (!sideBySide) layout.detail.replaceChildren();
    const view = await screenFor(route);
    if (!view || token !== renderToken) return;
    view.dataset.screen = route.name;
    target.replaceChildren(view);
    if (!sideBySide) layout.main.focus({ preventScroll: true });
    if (route.name !== 'welcome') runEntryLinks(ctx, tabStorage);
  }

  const router = createRouter({ window, onRoute: (route) => { show(route); } });
  router.start();

  if (!__RODA_E2E__ && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/app-sw.js', { scope: '/app' }).catch(() => {});
  }
}

main();
