// tests/unit/sent-requests.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { renderSentRequests } from '../../src/app/screens/sent-requests.js';

const PENDING = { id: 'r1', group_id: 'g1', state: 'pending', expires_at: '2099-01-01T00:00:00Z', group: { id: 'g1', name: 'Grupo Lua', location: 'Lisbon' } };

function ctx(rows, cancelJoinRequest = vi.fn().mockResolvedValue({ status: 'cancelled' })) {
  const values = new Map([['roda.dashboard.locale', 'en']]);
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  return {
    document,
    i18n: createDashboardI18n({ document, storage, navigator: { languages: ['en'] } }),
    now: () => new Date('2026-10-20T12:00:00Z'),
    services: { group: { listMyJoinRequests: vi.fn().mockResolvedValue(rows), cancelJoinRequest } },
  };
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('requests I sent', () => {
  it('lists pending requests and cancels one', async () => {
    const context = ctx([PENDING, { ...PENDING, id: 'r2', state: 'declined' }, { ...PENDING, id: 'r3', expires_at: '2026-01-01T00:00:00Z' }]);
    const view = await renderSentRequests(context);
    expect([...view.querySelectorAll('a')].map((link) => [link.textContent, link.getAttribute('href')])).toEqual([['Grupo Lua', '#/group/g1']]);
    view.querySelector('button').click();
    await flush();
    expect(context.services.group.cancelJoinRequest).toHaveBeenCalledWith('r1');
    expect(view.querySelector('li')).toBeNull();
    expect(view.textContent).toContain('Request canceled.');
  });

  it('renders nothing without pending requests', async () => {
    await expect(renderSentRequests(ctx([]))).resolves.toBeNull();
  });
});
