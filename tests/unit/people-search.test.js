// tests/unit/people-search.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openPeopleSearch } from '../../src/app/screens/people-search.js';
import { closeSheet } from '../../src/app/shell/sheet.js';
import { appCtx } from './app-test-context.js';

describe('people search', () => {
  beforeEach(() => { closeSheet(); document.body.replaceChildren(); });

  it('searches coaches as I type and asks one to coach me', async () => {
    const connection = {
      searchCandidates: vi.fn(async (text) => (text ? [] : [{ profile_id: 'lua', display_name: 'Professora Lua' }])),
      request: vi.fn().mockResolvedValue({ status: 'pending' }),
    };
    const onRequested = vi.fn();
    openPeopleSearch(appCtx({ services: { connection } }), { role: 'coach', onRequested });
    await vi.waitFor(() => expect(document.querySelector('[data-candidate="lua"]')).not.toBeNull());
    expect(document.querySelector('[role="dialog"]').getAttribute('aria-label')).toBe('Find a coach');
    document.querySelector('[data-candidate="lua"]').click();
    await vi.waitFor(() => expect(connection.request).toHaveBeenCalledWith('lua', 'me'));
    expect(onRequested).toHaveBeenCalledWith(expect.objectContaining({ profile_id: 'lua' }));
    expect(document.querySelector('[role="dialog"] [role="status"]').textContent).toBe('Request sent to Professora Lua.');
    const input = document.querySelector('input[type="search"]');
    input.value = 'zz';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]').textContent).toContain('No matching people found.'));
    expect(connection.searchCandidates).toHaveBeenLastCalledWith('zz', 'coach');
  });
});
