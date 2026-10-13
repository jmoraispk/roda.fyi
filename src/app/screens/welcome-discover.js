// src/app/screens/welcome-discover.js
import { normalizePlace } from '../discover-rules.js';
import { el } from '../shell/page.js';
import { createCityPicker, createVisibilityChoice } from './discover-settings.js';

// Welcome step 3 (plan 2 Ruling R1): optional city and "Who can find you".
export const discoverStep = {
  id: 'discover',
  title: 'welcomeDiscover.title',
  render(state, ctx) {
    state.discoverCity ??= createCityPicker(ctx, { value: null, onChange: (place) => { state.discoverPlace = place; } });
    const chosen = state.discoverVisibility?.value() ?? null;
    if (!state.discoverVisibility || (chosen === null && state.discoverVisibilityMode !== state.mode)) {
      state.discoverVisibility = createVisibilityChoice(ctx, { stored: chosen, mode: state.mode, name: 'welcomeVisibility' });
      state.discoverVisibilityMode = state.mode;
    }
    return el(ctx.document, 'div', { className: 'welcome-discover' }, [
      el(ctx.document, 'p', { className: 'muted', text: ctx.i18n.t('welcomeDiscover.intro') }),
      el(ctx.document, 'h3', { className: 'field-label', text: ctx.i18n.t('discoverSettings.city') }),
      state.discoverCity.element,
      state.discoverVisibility.element,
    ]);
  },
  async save(state, ctx) {
    const visibility = state.discoverVisibility?.value() ?? null;
    const place = normalizePlace(state.discoverPlace ?? null);
    if (!place && visibility === null) return;
    await ctx.services.discover.updateMine({ visibility, place, contacts: {} });
  },
};
