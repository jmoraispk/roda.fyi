// src/app/screens/discover.js
import { placeFromRow, placeLabel } from '../discover-rules.js';
import { el } from '../shell/page.js';
import { initialView, normalizeBounds, pinLabel, sortForPanel, summarize } from './discover-state.js';

let rememberedView = null;
let activeMap = null;

export function resetDiscoverMemory() {
  activeMap?.destroy();
  activeMap = null;
  rememberedView = null;
}

// Called by the app whenever another screen opens: Leaflet keeps listeners and
// timers alive until its map is removed.
export function releaseDiscoverMap() {
  activeMap?.destroy();
  activeMap = null;
}

function counted(i18n, key, count) {
  return i18n.t(`${key}.${count === 1 ? 'one' : 'other'}`, { count });
}

export async function renderDiscover(ctx) {
  const { document, i18n, services } = ctx;
  activeMap?.destroy();
  activeMap = null;
  let myPlace = null;
  try {
    myPlace = placeFromRow(await services.discover.loadMine());
  } catch {
    myPlace = null;
  }

  let points = [];
  let panelMode = 'view';
  let map = null;
  let loadToken = 0;
  let searchToken = 0;
  let moveTimer = null;
  let searchTimer = null;

  const input = el(document, 'input', { className: 'field-input discover-search-input', attrs: {
    type: 'search', 'aria-label': i18n.t('discover.search'), placeholder: i18n.t('discover.search'),
    autocomplete: 'off', enterkeyhint: 'search',
  } });
  const results = el(document, 'div', { className: 'discover-results', attrs: { hidden: true } });
  const searchForm = el(document, 'form', { className: 'discover-search', attrs: { role: 'search' } }, [input, results]);
  const mapNode = el(document, 'div', { className: 'discover-map', attrs: { role: 'region', 'aria-label': i18n.t('discover.map') } });
  const summary = el(document, 'span', { className: 'discover-summary' });
  const handle = el(document, 'button', {
    className: 'discover-panel-handle', attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'discoverPanelBody' },
  }, [el(document, 'span', { className: 'sheet-grab', attrs: { 'aria-hidden': 'true' } }), summary]);
  const body = el(document, 'div', { className: 'discover-panel-body', attrs: { id: 'discoverPanelBody' } });
  const panel = el(document, 'section', { className: 'discover-panel', attrs: { 'aria-label': i18n.t('discover.inView') } }, [handle, body]);
  const privacy = el(document, 'p', { className: 'muted discover-privacy', text: i18n.t('discover.privacy') });
  const screen = el(document, 'section', { className: 'screen screen-discover' }, [
    el(document, 'h1', { className: 'visually-hidden', text: i18n.t('app.discover') }), searchForm, mapNode, panel,
  ]);

  function setExpanded(open) {
    // On desktop the list is always open and the handle is only a label.
    if (wide?.matches) {
      panel.classList.add('expanded');
      return;
    }
    handle.setAttribute('aria-expanded', String(open));
    panel.classList.toggle('expanded', open);
  }
  // On desktop the list is always shown, so the handle is only a label.
  const wide = ctx.window?.matchMedia?.('(min-width: 900px)');
  function syncWide() {
    if (wide?.matches) {
      handle.disabled = true;
      handle.removeAttribute('aria-expanded');
      panel.classList.add('expanded');
    } else {
      handle.disabled = false;
      handle.setAttribute('aria-expanded', String(panel.classList.contains('expanded')));
    }
  }
  wide?.addEventListener?.('change', syncWide);
  syncWide();

  function row(title, detail, onClick, dataset = {}) {
    return el(document, 'button', { className: 'discover-row', attrs: { type: 'button' }, dataset, on: { click: onClick } }, [
      el(document, 'span', { className: 'discover-row-title', text: title }),
      detail ? el(document, 'span', { className: 'muted', text: detail }) : null,
    ]);
  }

  function updateSummary() {
    const totals = summarize(points);
    summary.textContent = `${counted(i18n, 'discover.people', totals.people)} · ${counted(i18n, 'discover.groups', totals.groups)}`;
  }

  function renderInView() {
    panelMode = 'view';
    updateSummary();
    const rows = sortForPanel(points).map((point) => (point.kind === 'city'
      ? row(pinLabel(point), placeLabel(point), () => showCity(point), { kind: 'city' })
      : row(point.name, point.location || placeLabel(point), () => ctx.navigate(`/group/${point.group_id}`),
        { kind: 'group', groupId: point.group_id })));
    const hint = myPlace ? null : el(document, 'p', { className: 'discover-add-city' }, [
      `${i18n.t('discover.addCity')} `,
      el(document, 'a', { text: i18n.t('discover.addCityAction'), attrs: { href: '#/me/settings' } }),
    ]);
    const empty = el(document, 'p', { className: 'muted', text: i18n.t('discover.empty') });
    body.replaceChildren(...[hint, ...(rows.length ? rows : [empty]), privacy].filter(Boolean));
  }

  let cityToken = 0;
  async function showCity(point) {
    const token = ++cityToken;
    panelMode = 'city';
    setExpanded(true);
    const back = el(document, 'button', {
      className: 'quiet-button', text: `‹ ${i18n.t('discover.allInView')}`, attrs: { type: 'button' }, on: { click: renderInView },
    });
    body.replaceChildren(el(document, 'p', { className: 'muted', text: i18n.t('app.loading') }));
    let people;
    try {
      people = await services.discover.cityPeople({ city: point.city, region: point.region ?? null, country: point.country ?? null });
    } catch (error) {
      if (token !== cityToken) return;
      body.replaceChildren(el(document, 'p', { className: 'muted', text: error?.message || i18n.t('app.loadError') }), back, privacy);
      return;
    }
    // Only the most recently chosen city may fill the panel.
    if (panelMode !== 'city' || token !== cityToken) return;
    body.replaceChildren(
      el(document, 'h2', { className: 'section-label', text: i18n.t('discover.cityPeople', { city: point.city }) }),
      ...people.map((person) => row(
        person.profile_id === ctx.profile.id ? `${person.display_name} (${i18n.t('discover.you')})` : person.display_name,
        i18n.t(`person.mode.${person.usage_mode ?? 'train'}`),
        () => ctx.navigate(`/person/${person.profile_id}`),
        { kind: 'person', profileId: person.profile_id },
      )),
      back, privacy,
    );
  }

  async function loadPoints(bounds) {
    const token = ++loadToken;
    try {
      const next = await services.discover.points(bounds);
      if (token !== loadToken) return;
      points = next;
      map?.setPoints(points);
      if (panelMode === 'view') renderInView();
      else updateSummary();
    } catch {
      if (token !== loadToken) return;
      panelMode = 'view';
      body.replaceChildren(
        el(document, 'p', { className: 'muted', text: i18n.t('discover.loadError') }),
        el(document, 'button', {
          className: 'secondary-button', text: i18n.t('app.retry'), attrs: { type: 'button' }, on: { click: () => loadPoints(bounds) },
        }),
        privacy,
      );
    }
  }

  function onMove({ bounds, view }) {
    rememberedView = view;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => { loadPoints(normalizeBounds(bounds)); }, 250);
  }

  function closeResults() {
    results.hidden = true;
    results.replaceChildren();
  }

  async function findPlace(text) {
    let places;
    try {
      places = await services.geocoder.searchCities(text);
    } catch {
      results.replaceChildren(el(document, 'p', { className: 'muted', text: i18n.t('geocoder.unavailable') }));
      return;
    }
    if (!places.length) {
      results.replaceChildren(el(document, 'p', { className: 'muted', text: i18n.t('discover.noPlaceFound', { text }) }));
      return;
    }
    closeResults();
    map?.flyTo({ lat: places[0].lat, lng: places[0].lng, zoom: 11 });
  }

  async function runSearch(text) {
    const token = ++searchToken;
    let rows = [];
    let failed = false;
    try {
      rows = await services.discover.search(text, 20);
    } catch {
      failed = true;
    }
    if (token !== searchToken) return;
    const items = rows.map((item) => {
      const detail = item.city ? placeLabel(item) : null;
      if (item.kind === 'person') {
        return row(item.label, detail, () => ctx.navigate(`/person/${item.profile_id}`), { kind: 'person', profileId: item.profile_id });
      }
      if (item.kind === 'group') {
        return row(item.label, detail, () => ctx.navigate(`/group/${item.group_id}`), { kind: 'group', groupId: item.group_id });
      }
      return row(`${item.label} · ${item.person_count}`, detail, () => {
        closeResults();
        map?.flyTo({ lat: Number(item.lat), lng: Number(item.lng), zoom: 11 });
        showCity(item);
      }, { kind: 'city' });
    });
    const empty = el(document, 'p', { className: 'muted', text: i18n.t(failed ? 'app.loadError' : 'discover.noResults') });
    results.replaceChildren(...(items.length ? items : [empty]),
      row(i18n.t('discover.findOnMap', { text }), null, () => findPlace(text), { kind: 'place' }));
    results.hidden = false;
  }

  handle.addEventListener('click', () => setExpanded(handle.getAttribute('aria-expanded') !== 'true'));
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const text = input.value.trim();
    if (text.length < 2) {
      searchToken += 1;
      closeResults();
      return;
    }
    searchTimer = setTimeout(() => { runSearch(text); }, 300);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    input.value = '';
    searchToken += 1;
    closeResults();
  });
  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    clearTimeout(searchTimer);
    const text = input.value.trim();
    if (text.length >= 2) runSearch(text);
  });

  renderInView();
  const view = initialView({ remembered: rememberedView, myPlace });
  setTimeout(() => {
    if (!mapNode.isConnected) return;
    map = ctx.createMap({
      container: mapNode,
      view,
      onMove,
      onSelect: (point) => (point.kind === 'group' ? ctx.navigate(`/group/${point.group_id}`) : showCity(point)),
    });
    activeMap = map;
    map.setPoints(points);
  }, 0);
  return screen;
}
