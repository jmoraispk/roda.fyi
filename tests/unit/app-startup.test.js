import { describe, expect, it, vi } from 'vitest';

import { loadStartup } from '../../src/app/app-startup.js';

describe('app startup', () => {
  it('treats a missing or failing session as signed out', async () => {
    expect(await loadStartup({ auth: { getSession: vi.fn().mockResolvedValue(null) }, profile: {} }))
      .toEqual({ status: 'signed-out' });
    expect(await loadStartup({ auth: { getSession: vi.fn().mockRejectedValue(new Error('refresh failed')) }, profile: {} }))
      .toEqual({ status: 'signed-out' });
  });

  it('reports a profile load failure instead of hanging', async () => {
    const error = new TypeError('offline');
    expect(await loadStartup({
      auth: { getSession: vi.fn().mockResolvedValue({ user: { id: 'u' } }) },
      profile: { loadProfile: vi.fn().mockRejectedValue(error) },
    })).toEqual({ status: 'error', error });
  });

  it('returns the session, profile, and coach profile when ready', async () => {
    const session = { user: { id: 'u' } };
    const profile = { id: 'u' };
    expect(await loadStartup({
      auth: { getSession: vi.fn().mockResolvedValue(session) },
      profile: { loadProfile: vi.fn().mockResolvedValue(profile), loadCoachProfile: vi.fn().mockResolvedValue({ profile_id: 'u' }) },
    })).toEqual({ status: 'ready', session, profile, coachProfile: { profile_id: 'u' } });
  });

  it('treats a failing coach profile load as no coaching', async () => {
    const session = { user: { id: 'u' } };
    expect(await loadStartup({
      auth: { getSession: vi.fn().mockResolvedValue(session) },
      profile: { loadProfile: vi.fn().mockResolvedValue({ id: 'u' }), loadCoachProfile: vi.fn().mockRejectedValue(new Error('offline')) },
    })).toEqual({ status: 'ready', session, profile: { id: 'u' }, coachProfile: null });
  });
});
