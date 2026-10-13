// tests/unit/sign-out.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { signOutSafely } from '../../src/app/screens/sign-out.js';
import { openSheet } from '../../src/app/shell/sheet.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });
const ctx = (training) => ({ document, window, i18n, services: { training }, openSheet: (options) => openSheet({ document, ...options }) });
const queue = () => localStorage.setItem('roda.pendingResources:o1', JSON.stringify([
  { occurrenceId: 'o1', kind: 'summary', title: '', url: null, body: '# Notes', clientKey: 'a' },
]));

describe('sign out', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
  });

  it('signs out at once when nothing is waiting, and keeps an unsent draft', async () => {
    localStorage.setItem('roda.logDraft:p1', JSON.stringify({ rounds: [{ sourceText: 'ginga' }] }));
    const signOut = vi.fn().mockResolvedValue();
    expect(await signOutSafely(ctx({ addResource: vi.fn() }), { signOut })).toBe(true);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('roda.logDraft:p1')).not.toBeNull();
  });

  it('sends waiting resources first, then signs out', async () => {
    queue();
    const training = { addResource: vi.fn().mockResolvedValue({ status: 'saved' }) };
    const signOut = vi.fn().mockResolvedValue();
    expect(await signOutSafely(ctx(training), { signOut })).toBe(true);
    expect(training.addResource).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('stays signed in, keeps the items, and offers only Try again when they cannot be sent', async () => {
    queue();
    const training = { addResource: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ status: 'saved' }) };
    const signOut = vi.fn().mockResolvedValue();
    expect(await signOutSafely(ctx(training), { signOut })).toBe(false);
    const sheet = document.querySelector('[role="dialog"]');
    expect(sheet.getAttribute('aria-label')).toBe('Waiting to sync');
    expect(sheet.textContent).toContain('One item is still waiting to sync — connect to the internet and try again.');
    expect([...sheet.querySelectorAll('button:not([data-sheet-close])')].map((button) => button.textContent)).toEqual(['Try again']);
    expect(signOut).not.toHaveBeenCalled();
    expect(localStorage.getItem('roda.pendingResources:o1')).not.toBeNull();
    sheet.querySelector('[data-action="retry-sign-out"]').click();
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem('roda.pendingResources:o1')).toBeNull();
  });


  it('signs out when only another account has something waiting', async () => {
    localStorage.setItem('roda.pendingResources:o9', JSON.stringify([{ occurrenceId: 'o9', kind: 'summary', title: '', url: null, body: 'x', clientKey: 'k', profileId: 'other' }]));
    const training = { addResource: vi.fn() };
    const signOut = vi.fn().mockResolvedValue();
    expect(await signOutSafely({ ...ctx(training), profile: { id: 'me' } }, { signOut })).toBe(true);
    expect(training.addResource).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('explains a failed sign-out instead of doing nothing, and ignores a double tap', async () => {
    const training = { addResource: vi.fn() };
    const signOut = vi.fn().mockRejectedValue(new Error('The network request failed.'));
    const context = { ...ctx(training), profile: { id: 'me' } };
    const [first, second] = await Promise.all([signOutSafely(context, { signOut }), signOutSafely(context, { signOut })]);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect([first, second]).toEqual([false, false]);
    expect(document.querySelector('[role="dialog"]').textContent).toContain('The network request failed.');
  });

});
