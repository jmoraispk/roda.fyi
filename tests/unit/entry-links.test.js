// tests/unit/entry-links.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { AppError } from '../../src/app/errors.js';
import { inviteLink } from '../../src/app/screens/group.js';
import { discoveryLink } from '../../src/app/screens/group-owner.js';
import { runEntryLinks, takeEntryLinks } from '../../src/app/shell/entry-links.js';
import { openSheet } from '../../src/app/shell/sheet.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

function memory() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
}

const ctx = (group) => ({ document, i18n, services: { group }, navigate: vi.fn(), openSheet: (options) => openSheet({ document, ...options }) });
const sheet = () => document.querySelector('[role="dialog"]');

describe('entry links', () => {
  beforeEach(() => { document.body.replaceChildren(); });

  it('makes links that open the app', () => {
    expect(inviteLink('https://roda.fyi', 'a b')).toBe('https://roda.fyi/app?member_invite=a%20b');
    expect(discoveryLink('https://roda.fyi', 'x/y')).toBe('https://roda.fyi/app?group_link=x%2Fy');
  });

  it('captures an invitation and scrubs it from the address bar', () => {
    window.history.replaceState(null, '', '/app?member_invite=abc&demo=1#/calendar');
    const storage = memory();
    expect(takeEntryLinks(window, storage)).toEqual({ member_invite: 'abc' });
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/app?demo=1#/calendar');
    expect(JSON.parse(storage.getItem('roda.entryLinks'))).toEqual({ member_invite: 'abc' });
  });

  it('drops an empty token and stores nothing', () => {
    window.history.replaceState(null, '', '/app?group_link=#/');
    const storage = memory();
    expect(takeEntryLinks(window, storage)).toEqual({});
    expect(window.location.search).toBe('');
    expect(storage.getItem('roda.entryLinks')).toBeNull();
  });

  it('does nothing without a waiting link', async () => {
    await runEntryLinks(ctx({}), memory());
    expect(sheet()).toBeNull();
  });

  it('accepts an invitation once', async () => {
    const storage = memory();
    storage.setItem('roda.entryLinks', JSON.stringify({ member_invite: 'abc' }));
    const group = { acceptInvitation: vi.fn().mockResolvedValue({ status: 'accepted', group_id: 'g1' }) };
    const context = ctx(group);
    await runEntryLinks(context, storage);
    expect(storage.getItem('roda.entryLinks')).toBeNull();
    expect(sheet().getAttribute('aria-label')).toBe('Group invitation');
    sheet().querySelector('[data-action="accept-invite"]').click();
    await vi.waitFor(() => expect(sheet().textContent).toContain('Invitation accepted. You are now a group member.'));
    expect(group.acceptInvitation).toHaveBeenCalledWith('abc');
    sheet().querySelector('[data-action="open-groups"]').click();
    expect(context.navigate).toHaveBeenCalledWith('/me/groups');
  });

  it.each([
    [{ status: 'expired' }, 'This invitation has expired.'],
    [{ status: 'revoked' }, 'This invitation was revoked.'],
    [{ status: 'accepted', already_used: true }, 'This invitation has already been used.'],
  ])('explains an invitation answered with %o', async (result, message) => {
    const storage = memory();
    storage.setItem('roda.entryLinks', JSON.stringify({ member_invite: 'abc' }));
    await runEntryLinks(ctx({ acceptInvitation: vi.fn().mockResolvedValue(result) }), storage);
    sheet().querySelector('[data-action="accept-invite"]').click();
    await vi.waitFor(() => expect(sheet().textContent).toContain(message));
  });

  it.each([
    ['invitation_not_found', 'This invitation was revoked.'],
    ['invitation_revoked', 'This invitation was revoked.'],
    ['already_used', 'This invitation has already been used.'],
    ['invitation_expired', 'This invitation has expired.'],
    ['invitation_email_mismatch', 'This invitation was sent to a different email address.'],
  ])('explains the database refusing an invitation with %s and stops offering Accept', async (code, message) => {
    const storage = memory();
    storage.setItem('roda.entryLinks', JSON.stringify({ member_invite: 'abc' }));
    await runEntryLinks(ctx({ acceptInvitation: vi.fn().mockRejectedValue(new AppError('validation', code)) }), storage);
    const accept = sheet().querySelector('[data-action="accept-invite"]');
    accept.click();
    await vi.waitFor(() => expect(sheet().textContent).toContain(message));
    expect(accept.disabled).toBe(true);
  });

  it('treats an invitation already accepted by the same person as joined', async () => {
    const storage = memory();
    storage.setItem('roda.entryLinks', JSON.stringify({ member_invite: 'abc' }));
    const context = ctx({ acceptInvitation: vi.fn().mockResolvedValue({ status: 'already_accepted', group_id: 'g1' }) });
    await runEntryLinks(context, storage);
    sheet().querySelector('[data-action="accept-invite"]').click();
    await vi.waitFor(() => expect(sheet().textContent).toContain('Invitation accepted. You are now a group member.'));
    expect(sheet().querySelector('[data-action="open-groups"]')).not.toBeNull();
  });

  it('lets a person try again after a network failure', async () => {
    const storage = memory();
    storage.setItem('roda.entryLinks', JSON.stringify({ member_invite: 'abc' }));
    await runEntryLinks(ctx({ acceptInvitation: vi.fn().mockRejectedValue(new AppError('network', 'network_error')) }), storage);
    const accept = sheet().querySelector('[data-action="accept-invite"]');
    accept.click();
    await vi.waitFor(() => expect(accept.disabled).toBe(false));
  });

  it('shows a linked group and asks to join with the link', async () => {
    const storage = memory();
    storage.setItem('roda.entryLinks', JSON.stringify({ group_link: 'secret' }));
    const group = {
      resolveDiscoveryToken: vi.fn().mockResolvedValue({ id: 'g2', name: 'Grupo Mata', location: 'Porto', description: 'Saturday roda' }),
      requestAccess: vi.fn().mockResolvedValue({ status: 'pending' }),
    };
    await runEntryLinks(ctx(group), storage);
    expect(sheet().getAttribute('aria-label')).toBe('Grupo Mata');
    expect(sheet().textContent).toContain('Porto');
    sheet().querySelector('[data-action="request-member"]').click();
    await vi.waitFor(() => expect(sheet().textContent).toContain('Your member access request is pending.'));
    expect(group.requestAccess).toHaveBeenCalledWith('g2', 'member', 'secret');
  });

  it('says when a group link cannot be opened', async () => {
    const storage = memory();
    storage.setItem('roda.entryLinks', JSON.stringify({ group_link: 'nope' }));
    await runEntryLinks(ctx({ resolveDiscoveryToken: vi.fn().mockResolvedValue(null) }), storage);
    expect(sheet().getAttribute('aria-label')).toBe('Group link');
    expect(sheet().textContent).toContain('This group link is unavailable.');
  });
});
