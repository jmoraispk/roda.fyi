// src/app/screens/discover-settings.js
import {
  VISIBILITIES, contactsFromRow, effectiveVisibility, fieldErrors, normalizeContacts, normalizePlace, placeFromRow,
  placeLabel, validateContacts,
} from '../discover-rules.js';
import { el } from '../shell/page.js';
import { WORLD_VIEW } from './discover-state.js';

const VISIBILITY_KEYS = Object.freeze({
  everyone: 'discoverSettings.everyone', signed_in: 'discoverSettings.signedIn', nobody: 'discoverSettings.nobody',
});
const CONTACT_FIELDS = Object.freeze([
  ['instagram', 'discoverSettings.instagram', 'text'],
  ['website', 'discoverSettings.website', 'url'],
  ['whatsapp', 'discoverSettings.whatsapp', 'tel'],
  ['email', 'discoverSettings.email', 'email'],
]);
const KNOWN_ERRORS = new Set([
  'invalid_place', 'invalid_visibility', 'invalid_instagram', 'invalid_website', 'invalid_whatsapp', 'invalid_email',
]);

export function errorText(i18n, error) {
  return KNOWN_ERRORS.has(error?.code)
    ? i18n.t(`discoverSettings.error.${error.code}`)
    : (error?.message || i18n.t('app.loadError'));
}

export function createCityPicker(ctx, { value = null, onChange = () => {} } = {}) {
  const { document, i18n } = ctx;
  let current = value;
  let searching = false;
  const label = el(document, 'p', { className: 'discover-city-current' });
  const remove = el(document, 'button', { className: 'quiet-button', text: i18n.t('discoverSettings.removeCity'), attrs: { type: 'button' } });
  const input = el(document, 'input', { className: 'field-input', attrs: {
    type: 'search', 'aria-label': i18n.t('discoverSettings.citySearch'), placeholder: i18n.t('discoverSettings.citySearch'),
    autocomplete: 'off', enterkeyhint: 'search',
  } });
  const searchButton = el(document, 'button', { className: 'secondary-button', text: i18n.t('discoverSettings.search'), attrs: { type: 'button' } });
  const results = el(document, 'div', { className: 'discover-city-results', attrs: { 'aria-live': 'polite' } });
  const mapButton = ctx.createMap
    ? el(document, 'button', { className: 'quiet-button', text: i18n.t('discoverSettings.pickOnMap'), attrs: { type: 'button' }, dataset: { action: 'pick-on-map' } })
    : null;

  function refresh() {
    label.textContent = current ? placeLabel(current) : i18n.t('discoverSettings.cityNone');
    remove.hidden = !current;
  }

  function choose(place) {
    current = place;
    results.replaceChildren();
    refresh();
    onChange(place);
  }

  async function search() {
    const text = input.value.trim();
    if (text.length < 2 || searching) return;
    searching = true;
    searchButton.disabled = true;
    results.replaceChildren(el(document, 'p', { className: 'muted', text: i18n.t('discoverSettings.searching') }));
    try {
      const places = await ctx.services.geocoder.searchCities(text);
      results.replaceChildren(...(places.length
        ? places.map((place) => el(document, 'button', {
          className: 'discover-row', text: placeLabel(place), attrs: { type: 'button' }, on: { click: () => choose(place) },
        }))
        : [el(document, 'p', { className: 'muted', text: i18n.t('discoverSettings.noCity') })]));
    } catch {
      results.replaceChildren(el(document, 'p', { className: 'field-error', text: i18n.t('geocoder.unavailable') }));
    } finally {
      searching = false;
      searchButton.disabled = false;
    }
  }

  function pickOnMap() {
    const container = el(document, 'div', { className: 'discover-pick-map' });
    const status = el(document, 'p', { className: 'muted', attrs: { role: 'status' } });
    let map = null;
    let busy = false;
    const sheet = ctx.openSheet({
      title: i18n.t('discoverSettings.tapMap'),
      content: el(document, 'div', {}, [container, status]),
      onClose: () => map?.destroy(),
    });
    map = ctx.createMap({
      container,
      view: current ? { lat: current.lat, lng: current.lng, zoom: 10 } : WORLD_VIEW,
      onTap: async (point) => {
        if (busy) return;
        busy = true;
        status.textContent = i18n.t('discoverSettings.searching');
        try {
          const place = await ctx.services.geocoder.reverse(point);
          if (place) {
            sheet.close();
            choose(place);
          } else {
            status.textContent = i18n.t('discoverSettings.noCity');
          }
        } catch {
          status.textContent = i18n.t('geocoder.unavailable');
        } finally {
          busy = false;
        }
      },
    });
  }

  remove.addEventListener('click', () => choose(null));
  searchButton.addEventListener('click', search);
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    search();
  });
  mapButton?.addEventListener('click', pickOnMap);
  refresh();
  const element = el(document, 'div', { className: 'discover-city' }, [
    label, remove, el(document, 'div', { className: 'discover-city-search' }, [input, searchButton]), results, mapButton,
    el(document, 'p', { className: 'muted discover-privacy', text: i18n.t('discover.privacy') }),
  ]);
  return { element, value: () => current };
}

export function createVisibilityChoice(ctx, { stored = null, mode = 'train', name = 'discoverVisibility' } = {}) {
  const { document, i18n } = ctx;
  let chosen = stored;
  const effective = effectiveVisibility({ discover_visibility: stored, usage_mode: mode });
  const hint = el(document, 'p', { className: 'muted', text: i18n.t('discoverSettings.defaultHint'), attrs: { hidden: Boolean(stored) } });
  const options = VISIBILITIES.map((value) => el(document, 'label', { className: 'discover-radio' }, [
    el(document, 'input', {
      attrs: { type: 'radio', name, value, checked: value === effective },
      on: { change: () => { chosen = value; hint.hidden = true; } },
    }),
    ` ${i18n.t(VISIBILITY_KEYS[value])}`,
  ]));
  const element = el(document, 'fieldset', { className: 'discover-visibility' }, [
    el(document, 'legend', { className: 'section-label', text: i18n.t('discoverSettings.who') }), ...options, hint,
  ]);
  return { element, value: () => chosen };
}

export function createContactFields(ctx, { values = {}, fields = ['instagram', 'website', 'whatsapp', 'email'] } = {}) {
  const { document, i18n } = ctx;
  const inputs = {};
  const errors = {};
  const element = el(document, 'div', { className: 'discover-contacts-form' }, CONTACT_FIELDS
    .filter(([key]) => fields.includes(key))
    .map(([key, labelKey, type]) => {
      inputs[key] = el(document, 'input', { className: 'field-input', attrs: { type, name: key, value: values[key] ?? '', autocomplete: 'off' } });
      errors[key] = el(document, 'span', { className: 'field-error' });
      return el(document, 'label', { className: 'field-label' }, [i18n.t(labelKey), inputs[key], errors[key]]);
    }));
  return {
    element,
    read() {
      return normalizeContacts(Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value])));
    },
    showErrors(map) {
      for (const [key, node] of Object.entries(errors)) {
        node.textContent = map[key] ? i18n.t(`discoverSettings.error.${map[key]}`) : '';
        inputs[key].setAttribute('aria-invalid', String(Boolean(map[key])));
      }
    },
    focusFirstError(map) {
      inputs[Object.keys(inputs).find((key) => map[key])]?.focus();
    },
  };
}

export async function renderDiscoverSettings(ctx) {
  const { document, i18n } = ctx;
  const section = el(document, 'section', { className: 'discover-settings', attrs: { 'aria-labelledby': 'discoverSettingsTitle' } }, [
    el(document, 'h2', { className: 'section-label', text: i18n.t('discoverSettings.title'), attrs: { id: 'discoverSettingsTitle' } }),
  ]);
  let mine;
  try {
    mine = await ctx.services.discover.loadMine();
  } catch (error) {
    section.append(el(document, 'p', { className: 'muted', text: errorText(i18n, error) }));
    return section;
  }
  let place = placeFromRow(mine);
  const city = createCityPicker(ctx, { value: place, onChange: (next) => { place = next; } });
  const visibility = createVisibilityChoice(ctx, { stored: mine.discover_visibility ?? null, mode: mine.usage_mode ?? 'train' });
  const contacts = createContactFields(ctx, { values: contactsFromRow(mine) });
  const status = el(document, 'p', { className: 'muted', attrs: { role: 'status' } });
  const save = el(document, 'button', {
    className: 'button-primary', text: i18n.t('discoverSettings.save'), attrs: { type: 'button' }, dataset: { action: 'save-discover' },
  });
  save.addEventListener('click', async () => {
    const values = contacts.read();
    const errors = validateContacts(values);
    contacts.showErrors(errors);
    if (Object.keys(errors).length) {
      status.textContent = '';
      contacts.focusFirstError(errors);
      return;
    }
    save.disabled = true;
    status.textContent = i18n.t('log.saving');
    try {
      await ctx.services.discover.updateMine({ visibility: visibility.value(), place: normalizePlace(place), contacts: values });
      status.textContent = i18n.t('discoverSettings.saved');
    } catch (error) {
      contacts.showErrors(fieldErrors(error));
      status.textContent = errorText(i18n, error);
    } finally {
      save.disabled = false;
    }
  });
  section.append(
    el(document, 'h3', { className: 'field-label', text: i18n.t('discoverSettings.city') }), city.element,
    visibility.element,
    el(document, 'h3', { className: 'field-label', text: i18n.t('discoverSettings.contacts') }),
    el(document, 'p', { className: 'muted', text: i18n.t('discoverSettings.contactsHint') }),
    contacts.element, save, status,
  );
  return section;
}
