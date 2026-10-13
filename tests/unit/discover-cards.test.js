// tests/unit/discover-cards.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { renderGroupCard, renderPerson } from '../../src/app/screens/discover-cards.js';

const PERSON = {
  profile_id: 'p2', display_name: 'Mestre Lua', avatar_path: 'p2/a.jpg', usage_mode: 'teach',
  city: 'Lisbon', region: 'Lisbon', country: 'Portugal', is_self: false, visibility: null,
  contacts: { instagram: 'mestrelua', website: 'javascript:alert(1)' },
  trains_in: [], teaches: [{ group_id: 'g1', name: 'Grupo Lua', role: 'owner' }],
};
const GROUP = {
  group_id: 'g1', name: 'Grupo Lua', picture_path: null, location: 'Arroios, Lisbon', city: 'Lisbon', region: 'Lisbon',
  country: 'Portugal', lat: 38.73, lng: -9.13, is_discoverable: true, contacts: { email: 'ola@grupolua.example' },
  coaches: [{ profile_id: 'p2', display_name: 'Mestre Lua', is_owner: true }], my_status: null, my_request_id: null,
};

function ctx({ discover = {}, group = {} } = {}) {
  const values = new Map([['roda.dashboard.locale', 'en']]);
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  return {
    document,
    i18n: createDashboardI18n({ document, storage, navigator: { languages: ['en'] } }),
    profile: { id: 'me', display_name: 'Ana Silva' },
    back: vi.fn(),
    services: {
      discover: {
        person: vi.fn().mockResolvedValue(PERSON), group: vi.fn().mockResolvedValue(GROUP),
        pictureUrl: vi.fn().mockResolvedValue(null), ...discover,
      },
      group: {
        requestAccess: vi.fn().mockResolvedValue({ status: 'pending', request_id: 'r1' }),
        cancelJoinRequest: vi.fn().mockResolvedValue({ status: 'cancelled' }),
        ...group,
      },
    },
  };
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const button = (view, text) => [...view.querySelectorAll('button')].find((node) => node.textContent === text);

describe('person page', () => {
  it('shows a card with safe contacts and group links', async () => {
    const context = ctx({ discover: { pictureUrl: vi.fn().mockResolvedValue('https://cdn.example/p2.jpg') } });
    const view = await renderPerson(context, { params: { id: 'p2' } });
    expect(context.services.discover.person).toHaveBeenCalledWith('p2');
    expect(view.querySelector('h1').textContent).toBe('Mestre Lua');
    expect(view.textContent).toContain('Teaches · Lisbon, Portugal');
    expect(view.querySelector('.discover-avatar img').getAttribute('src')).toBe('https://cdn.example/p2.jpg');
    expect(context.services.discover.pictureUrl).toHaveBeenCalledWith('profile', 'p2/a.jpg');
    expect(view.querySelector('a[href="#/group/g1"]').textContent).toBe('Grupo Lua');
    expect(view.textContent).toContain('owner');
    expect([...view.querySelectorAll('.discover-contact-list a')].map((link) => link.getAttribute('href')))
      .toEqual(['https://www.instagram.com/mestrelua/']);
    expect(view.querySelector('.discover-contact-list a').getAttribute('rel')).toBe('noopener noreferrer nofollow');
  });

  it.each([
    ['missing', () => vi.fn().mockResolvedValue(null)],
    ['malformed', () => vi.fn().mockRejectedValue(Object.assign(new Error('bad'), { kind: 'validation' }))],
  ])('says a %s card is not available and goes back to Discover', async (_name, makePerson) => {
    const context = ctx({ discover: { person: makePerson() } });
    const view = await renderPerson(context, { params: { id: 'x' } });
    expect(view.textContent).toContain("This person isn't available.");
    view.querySelector('.page-back').click();
    expect(context.back).toHaveBeenCalledWith('/discover');
  });

  it('reminds a hidden person that only they see their card', async () => {
    const context = ctx({ discover: { person: vi.fn().mockResolvedValue({
      ...PERSON, profile_id: 'me', display_name: 'Ana Silva', is_self: true, visibility: 'nobody', contacts: {}, teaches: [],
    }) } });
    const view = await renderPerson(context, { params: { id: 'me' } });
    expect(view.textContent).toContain('Only you can see your card.');
    expect(view.querySelector('.discover-self a').getAttribute('href')).toBe('#/me/settings');
    expect(view.querySelector('.discover-contact-list')).toBeNull();
  });
});

describe('group card', () => {
  it('shows coaches and contacts and asks to join once', async () => {
    const context = ctx();
    const view = await renderGroupCard(context, { params: { id: 'g1' } });
    document.body.replaceChildren(view);
    expect(view.querySelector('h1').textContent).toBe('Grupo Lua');
    expect(view.textContent).toContain('Arroios, Lisbon');
    expect(view.querySelector('a[href="#/person/p2"]').textContent).toBe('Mestre Lua');
    expect(view.querySelector('a[href="mailto:ola@grupolua.example"]')).not.toBeNull();
    const join = button(view, 'Ask to join');
    join.click();
    join.click();
    await flush();
    expect(context.services.group.requestAccess).toHaveBeenCalledTimes(1);
    expect(context.services.group.requestAccess).toHaveBeenCalledWith('g1', 'member');
    expect(view.textContent).toContain('Request sent. The group will reply.');
    expect(button(view, 'Ask to join')).toBeUndefined();
    expect(button(view, 'Cancel request')).toBeDefined();
  });

  it('keeps the button when the request fails', async () => {
    const context = ctx({ group: { requestAccess: vi.fn().mockRejectedValue(new Error('You do not have permission to do that.')) } });
    const view = await renderGroupCard(context, { params: { id: 'g1' } });
    const join = button(view, 'Ask to join');
    join.click();
    await flush();
    expect(join.disabled).toBe(false);
    expect(view.textContent).toContain('You do not have permission to do that.');
  });

  it('cancels a pending request', async () => {
    const context = ctx({ discover: { group: vi.fn().mockResolvedValue({ ...GROUP, my_status: 'pending', my_request_id: 'r9' }) } });
    const view = await renderGroupCard(context, { params: { id: 'g1' } });
    expect(view.textContent).toContain('Request sent. The group will reply.');
    button(view, 'Cancel request').click();
    await flush();
    expect(context.services.group.cancelJoinRequest).toHaveBeenCalledWith('r9');
    expect(button(view, 'Ask to join')).toBeDefined();
  });

  it.each(['member', 'coach', 'owner'])('tells a %s they are in the group', async (status) => {
    const view = await renderGroupCard(ctx({ discover: { group: vi.fn().mockResolvedValue({ ...GROUP, my_status: status }) } }), { params: { id: 'g1' } });
    expect(view.textContent).toContain("You're in this group.");
    expect(button(view, 'Ask to join')).toBeUndefined();
  });

  it('says when a group is not available', async () => {
    const view = await renderGroupCard(ctx({ discover: { group: vi.fn().mockResolvedValue(null) } }), { params: { id: 'g9' } });
    expect(view.textContent).toContain("This group isn't available.");
  });
});
