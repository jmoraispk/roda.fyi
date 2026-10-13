// tests/unit/group-discover-form.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { renderGroupDiscoverForm } from '../../src/app/screens/group-discover-form.js';

const GROUP = {
  id: 'g1', owner_id: 'p1', name: 'Roda da Lua', is_discoverable: true,
  place_city: 'Lisbon', place_region: 'Lisbon', place_country: 'Portugal', place_lat: 38.72, place_lng: -9.14,
  contact_instagram: 'rodadalua', contact_website: null, contact_email: null,
};

function ctx(group = GROUP, discover = {}) {
  const values = new Map([['roda.dashboard.locale', 'en']]);
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  return {
    document,
    i18n: createDashboardI18n({ document, storage, navigator: { languages: ['en'] } }),
    profile: { id: 'p1', display_name: 'Ana Silva' },
    services: {
      discover: { loadGroup: vi.fn().mockResolvedValue(group), updateGroup: vi.fn().mockResolvedValue({ status: 'updated' }), ...discover },
      geocoder: { searchCities: vi.fn().mockResolvedValue([]), reverse: vi.fn() },
    },
  };
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('group Discover form', () => {
  it('lets the owner change the place and contacts', async () => {
    const context = ctx();
    const form = await renderGroupDiscoverForm(context, 'g1');
    document.body.replaceChildren(form);
    expect(context.services.discover.loadGroup).toHaveBeenCalledWith('g1');
    expect(form.querySelector('.discover-city-current').textContent).toBe('Lisbon, Portugal');
    expect(form.querySelector('input[name="whatsapp"]')).toBeNull();
    expect(form.querySelector('input[name="instagram"]').value).toBe('rodadalua');
    form.querySelector('input[name="email"]').value = 'ola@lua.example';
    form.querySelector('button[data-action="save-group-discover"]').click();
    await flush();
    expect(context.services.discover.updateGroup).toHaveBeenCalledWith('g1', {
      place: { city: 'Lisbon', region: 'Lisbon', country: 'Portugal', lat: 38.72, lng: -9.14 },
      contacts: { instagram: 'rodadalua', website: null, whatsapp: null, email: 'ola@lua.example' },
    });
    expect(form.textContent).toContain('Saved.');
  });

  it('removes the place when the owner clears the city', async () => {
    const context = ctx();
    const form = await renderGroupDiscoverForm(context, 'g1');
    [...form.querySelectorAll('button')].find((button) => button.textContent === 'Remove city').click();
    form.querySelector('button[data-action="save-group-discover"]').click();
    await flush();
    expect(context.services.discover.updateGroup.mock.lastCall[1].place).toBeNull();
  });

  it('says when the group stays off the map', async () => {
    const form = await renderGroupDiscoverForm(ctx({ ...GROUP, is_discoverable: false }), 'g1');
    expect(form.textContent).toContain("This group isn't discoverable, so it stays off the map");
  });

  it('blocks an invalid website and shows server rejections', async () => {
    const rejection = Object.assign(new Error('x'), { kind: 'validation', code: 'invalid_email' });
    const context = ctx(GROUP, { updateGroup: vi.fn().mockRejectedValue(rejection) });
    const form = await renderGroupDiscoverForm(context, 'g1');
    document.body.replaceChildren(form);
    form.querySelector('input[name="website"]').value = 'http://lua.example';
    form.querySelector('button[data-action="save-group-discover"]').click();
    await flush();
    expect(context.services.discover.updateGroup).not.toHaveBeenCalled();
    expect(form.textContent).toContain('Use a full address starting with https://.');
    form.querySelector('input[name="website"]').value = '';
    form.querySelector('input[name="email"]').value = 'ola@lua.example';
    form.querySelector('button[data-action="save-group-discover"]').click();
    await flush();
    expect(form.querySelector('input[name="email"]').getAttribute('aria-invalid')).toBe('true');
  });

  it('renders nothing for someone who does not own the group', async () => {
    await expect(renderGroupDiscoverForm(ctx({ ...GROUP, owner_id: 'someone' }), 'g1')).resolves.toBeNull();
  });
});
