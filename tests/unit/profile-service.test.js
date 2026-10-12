import { describe, expect, it } from 'vitest';

import {
  createProfileService,
  detectBrowserTimezone,
  profilePrefill,
  requireUsageMode,
  resolveTimezoneOverride,
  USAGE_MODES,
} from '../../src/app/profile-service.js';
import { createE2EProfileService } from '../../src/app/testing/fake-services.js';

function rpcClient(results = {}) {
  const calls = [];
  return {
    calls,
    client: {
      rpc: async (name, params = {}) => {
        calls.push([name, params]);
        return results[name] ?? { data: { status: 'ok' }, error: null };
      },
    },
  };
}

function profileClient({ profile, coachProfile } = {}) {
  const calls = [];
  const rows = {
    profiles: { data: profile ?? null, error: null },
    coach_profiles: { data: coachProfile ?? null, error: null },
  };
  return {
    calls,
    client: {
      from(table) {
        return {
          select(columns) {
            calls.push(['select', table, columns]);
            return {
              single: async () => rows[table],
              maybeSingle: async () => rows[table],
            };
          },
        };
      },
      rpc: async (name, params = {}) => {
        calls.push(['rpc', name, params]);
        return { data: { status: 'updated' }, error: null };
      },
      storage: {
        from(bucket) {
          return {
            upload: async (path, file, options) => {
              calls.push(['upload', bucket, path, file, options]);
              return { data: { path }, error: null };
            },
          };
        },
      },
    },
  };
}

describe('detectBrowserTimezone', () => {
  it('returns the IANA timezone reported by the browser', () => {
    const intl = {
      DateTimeFormat: () => ({
        resolvedOptions: () => ({ timeZone: 'America/Sao_Paulo' }),
      }),
    };

    expect(detectBrowserTimezone(intl)).toBe('America/Sao_Paulo');
  });

  it('returns null when the browser does not report a timezone', () => {
    const intl = {
      DateTimeFormat: () => ({ resolvedOptions: () => ({}) }),
    };

    expect(detectBrowserTimezone(intl)).toBeNull();
  });
});

describe('resolveTimezoneOverride', () => {
  it.each([null, '', 'Automatic', ' automatic '])(
    'stores the automatic choice %s as null',
    (choice) => {
      expect(resolveTimezoneOverride(choice)).toBeNull();
    },
  );

  it('stores a valid manual IANA timezone', () => {
    expect(resolveTimezoneOverride('  Europe/Lisbon  ')).toBe('Europe/Lisbon');
  });

  it('rejects an invalid manual timezone before calling Supabase', () => {
    expect(() => resolveTimezoneOverride('Mars/Olympus_Mons')).toThrow('valid timezone');
  });
});

describe('profilePrefill', () => {
  const user = {
    email: 'ana@example.com',
    user_metadata: {
      full_name: 'Ana Silva',
      avatar_url: 'https://images.example/ana.jpg',
    },
  };

  it('prefills an incomplete profile from Google metadata', () => {
    expect(profilePrefill(user, {
      display_name: 'Capoeirista',
      avatar_path: null,
      timezone_override: null,
      leaderboard_visible: true,
      completed_at: null,
    })).toEqual({
      displayName: 'Ana Silva',
      providerAvatarUrl: 'https://images.example/ana.jpg',
      timezoneChoice: 'Automatic',
      leaderboardVisible: true,
    });
  });

  it('never replaces a completed display name with provider metadata', () => {
    expect(profilePrefill(user, {
      display_name: 'Professora Lua',
      avatar_path: 'user-1/profile.webp',
      timezone_override: 'America/Bahia',
      leaderboard_visible: false,
      completed_at: '2026-09-11T20:00:00Z',
    })).toEqual({
      displayName: 'Professora Lua',
      providerAvatarUrl: null,
      timezoneChoice: 'America/Bahia',
      leaderboardVisible: false,
    });
  });
});

describe('createProfileService', () => {
  it('loads the private profile and optional coach extension separately', async () => {
    const profile = {
      id: 'user-1',
      display_name: 'Lua',
      avatar_path: null,
      timezone_override: null,
      leaderboard_visible: true,
      completed_at: null,
    };
    const coachProfile = { profile_id: 'user-1', activated_at: '2026-09-11T20:00:00Z' };
    const { client, calls } = profileClient({ profile, coachProfile });
    const service = createProfileService(client);

    expect(await service.loadProfile()).toEqual(profile);
    expect(await service.loadCoachProfile()).toEqual(coachProfile);
    expect(calls).toEqual([
      ['select', 'profiles', 'id, display_name, avatar_path, timezone_override, leaderboard_visible, usage_mode, completed_at, created_at, updated_at'],
      ['select', 'coach_profiles', 'profile_id, activated_at, created_at, updated_at'],
    ]);
  });

  it('completes the same practitioner profile with Automatic timezone as null', async () => {
    const { client, calls } = rpcClient({
      complete_my_profile: {
        data: { status: 'updated', profile_id: 'user-1' },
        error: null,
      },
    });
    const service = createProfileService(client);

    const result = await service.completeProfile({
      displayName: '  Mestre Sol  ',
      timezoneChoice: 'Automatic',
      leaderboardVisible: true,
    });

    expect(result.status).toBe('updated');
    expect(calls).toEqual([['complete_my_profile', {
      display_name: 'Mestre Sol',
      timezone_override: null,
      leaderboard_visible: true,
    }]]);
  });

  it('registers coaching as an extension of the current profile', async () => {
    const { client, calls } = rpcClient({
      register_as_coach: {
        data: { status: 'active', profile_id: 'user-1' },
        error: null,
      },
    });
    const service = createProfileService(client);

    expect(await service.registerAsCoach()).toEqual({
      status: 'active',
      profile_id: 'user-1',
    });
    expect(calls).toEqual([['register_as_coach', {}]]);
  });

  it('rejects a blank display name without issuing a profile mutation', async () => {
    const { client, calls } = rpcClient();
    const service = createProfileService(client);

    await expect(service.completeProfile({
      displayName: '   ',
      timezoneChoice: 'Automatic',
      leaderboardVisible: true,
    })).rejects.toMatchObject({ code: 'invalid_display_name' });
    expect(calls).toEqual([]);
  });

  it('uploads a fresh profile image path before assigning it to the profile', async () => {
    const { client, calls } = profileClient();
    const service = createProfileService(client, { randomUUID: () => 'image-uuid' });
    const file = { name: 'portrait.png', type: 'image/png', size: 1024 };

    expect(await service.uploadProfilePicture('user-1', file)).toEqual({
      status: 'updated',
      path: 'user-1/image-uuid.png',
    });
    expect(calls).toEqual([
      ['upload', 'profile-pictures', 'user-1/image-uuid.png', file, {
        cacheControl: '3600',
        contentType: 'image/png',
        upsert: false,
      }],
      ['rpc', 'set_my_profile_picture', { avatar_path: 'user-1/image-uuid.png' }],
    ]);
  });

  it('rejects an unsupported or oversized profile image before upload', async () => {
    const { client, calls } = profileClient();
    const service = createProfileService(client, { randomUUID: () => 'image-uuid' });

    await expect(service.uploadProfilePicture('user-1', {
      name: 'portrait.gif', type: 'image/gif', size: 1024,
    })).rejects.toMatchObject({ code: 'invalid_picture_type' });
    await expect(service.uploadProfilePicture('user-1', {
      name: 'portrait.png', type: 'image/png', size: (5 * 1024 * 1024) + 1,
    })).rejects.toMatchObject({ code: 'picture_too_large' });
    expect(calls).toEqual([]);
  });
});

describe('usage mode', () => {
  it('sets the usage mode through the RPC', async () => {
    const { client, calls } = rpcClient({ set_usage_mode: { data: { status: 'updated', usage_mode: 'both' }, error: null } });
    const service = createProfileService(client);
    expect(await service.setUsageMode('both')).toEqual({ status: 'updated', usage_mode: 'both' });
    expect(calls).toEqual([['set_usage_mode', { mode: 'both' }]]);
  });

  it('rejects unknown modes before calling Supabase', async () => {
    const { client, calls } = rpcClient();
    await expect(createProfileService(client).setUsageMode('coach')).rejects.toMatchObject({ code: 'invalid_usage_mode' });
    expect(calls).toEqual([]);
    expect(USAGE_MODES).toEqual(['train', 'both', 'teach']);
    expect(requireUsageMode('teach')).toBe('teach');
  });

  it('stores the mode and registers coaching in the local fake', async () => {
    const values = new Map([['roda.e2e.profile', JSON.stringify({ id: 'practitioner-1', display_name: 'Ana', completed_at: null })]]);
    const window = {
      localStorage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) },
      __RODA_E2E_EVENTS__: [],
    };
    const service = createE2EProfileService({ window });
    expect((await service.loadProfile()).usage_mode).toBe('train');
    expect(await service.setUsageMode('teach')).toEqual({ status: 'updated', usage_mode: 'teach', coach_profile_created: true });
    expect((await service.loadProfile()).usage_mode).toBe('teach');
    expect(await service.loadCoachProfile()).toMatchObject({ profile_id: 'practitioner-1' });
    expect(await service.setUsageMode('train')).toMatchObject({ coach_profile_created: false });
    expect(await service.loadCoachProfile()).not.toBeNull();
    expect(window.__RODA_E2E_EVENTS__).toContainEqual({ type: 'set-usage-mode', mode: 'train' });
  });
});