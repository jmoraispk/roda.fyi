// tests/unit/discover-service.test.js
import { describe, expect, it } from 'vitest';

import { createDiscoverService, GROUP_DISCOVER_COLUMNS, MY_DISCOVER_COLUMNS } from '../../src/app/discover-service.js';
import { createE2EDiscoverService } from '../../src/app/testing/fake-services.js';

function harness({ rows = {}, rpc = {}, signed = { data: { signedUrl: 'https://cdn.example/p.jpg' }, error: null } } = {}) {
  const calls = [];
  return {
    calls,
    client: {
      rpc: async (name, params = {}) => {
        calls.push(['rpc', name, params]);
        return rpc[name] ?? { data: [], error: null };
      },
      from(table) {
        const query = {
          select(columns) { calls.push(['select', table, columns]); return query; },
          eq(column, value) { calls.push(['eq', column, value]); return query; },
          single: async () => rows[table] ?? { data: null, error: null },
        };
        return query;
      },
      storage: {
        from(bucket) {
          return {
            createSignedUrl: async (path, seconds) => {
              calls.push(['sign', bucket, path, seconds]);
              return signed;
            },
          };
        },
      },
    },
  };
}

const LISBON = { city: 'Lisbon', region: 'Lisbon', country: 'Portugal', lat: 38.72, lng: -9.14 };

describe('discover service', () => {
  it('sends settings with column-named parameters', async () => {
    const { client, calls } = harness();
    const service = createDiscoverService(client);
    await service.updateMine({ visibility: null, place: LISBON, contacts: { instagram: 'ana' } });
    await service.updateGroup('g1', { place: null, contacts: { website: 'https://g.example', whatsapp: '+351 900 000 000' } });
    expect(calls).toEqual([
      ['rpc', 'update_discover_profile', {
        visibility: null, place_city: 'Lisbon', place_region: 'Lisbon', place_country: 'Portugal',
        place_lat: 38.72, place_lng: -9.14, contact_instagram: 'ana', contact_website: null,
        contact_whatsapp: null, contact_email: null,
      }],
      ['rpc', 'update_group_discover', {
        group_id: 'g1', place_city: null, place_region: null, place_country: null, place_lat: null, place_lng: null,
        contact_instagram: null, contact_website: 'https://g.example', contact_email: null,
      }],
    ]);
  });

  it('reads points, city lists, cards, and search results', async () => {
    const { client, calls } = harness();
    const service = createDiscoverService(client);
    await service.points({ minLat: 30, minLng: -20, maxLat: 50, maxLng: 10 });
    await service.cityPeople({ ...LISBON, kind: 'city' });
    await service.person('p1');
    await service.group('g1');
    await service.search('  lis ');
    expect(calls).toEqual([
      ['rpc', 'discover_points', { min_lat: 30, min_lng: -20, max_lat: 50, max_lng: 10 }],
      ['rpc', 'discover_city_people', { city: 'Lisbon', region: 'Lisbon', country: 'Portugal', result_limit: 50 }],
      ['rpc', 'discover_person', { profile_id: 'p1' }],
      ['rpc', 'discover_group', { group_id: 'g1' }],
      ['rpc', 'discover_search', { search_text: 'lis', result_limit: 20 }],
    ]);
  });

  it('loads my settings and a group, and maps errors', async () => {
    const { client, calls } = harness({
      rows: { profiles: { data: { id: 'p1', place_city: null }, error: null }, groups: { data: { id: 'g1', owner_id: 'p1' }, error: null } },
      rpc: { update_discover_profile: { data: null, error: { code: 'P0001', message: 'invalid_website' } } },
    });
    const service = createDiscoverService(client);
    await expect(service.loadMine()).resolves.toEqual({ id: 'p1', place_city: null });
    await expect(service.loadGroup('g1')).resolves.toEqual({ id: 'g1', owner_id: 'p1' });
    expect(calls).toEqual([
      ['select', 'profiles', MY_DISCOVER_COLUMNS],
      ['select', 'groups', GROUP_DISCOVER_COLUMNS],
      ['eq', 'id', 'g1'],
    ]);
    await expect(service.updateMine({ contacts: { website: 'http://x' } }))
      .rejects.toMatchObject({ kind: 'validation', code: 'invalid_website' });
  });

  it('signs pictures only when a path exists', async () => {
    const { client, calls } = harness();
    const service = createDiscoverService(client);
    expect(await service.pictureUrl('profile', null)).toBeNull();
    expect(await service.pictureUrl('group', 'g1/x.jpg')).toBe('https://cdn.example/p.jpg');
    expect(calls).toEqual([['sign', 'group-pictures', 'g1/x.jpg', 3600]]);
    const failing = createDiscoverService(harness({ signed: { data: null, error: { message: 'denied' } } }).client);
    expect(await failing.pictureUrl('profile', 'p1/x.jpg')).toBeNull();
  });
});

describe('local Discover fake', () => {
  function fakeWindow(entries = {}) {
    const values = new Map(Object.entries(entries));
    return {
      __RODA_E2E_EVENTS__: [],
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
      },
    };
  }
  const SESSION = JSON.stringify({ user: { id: 'practitioner-1' } });
  const PROFILE = JSON.stringify({ id: 'practitioner-1', display_name: 'Ana Silva', usage_mode: 'train', completed_at: '2026-09-11T20:00:00Z' });
  const EVERYWHERE = { minLat: -90, minLng: -180, maxLat: 90, maxLng: 180 };
  const lisbonCount = async (service) => (await service.points(EVERYWHERE))
    .find((point) => point.kind === 'city' && point.city === 'Lisbon').person_count;

  it('follows the visibility table for clusters, cards, and search', async () => {
    const window = fakeWindow({ 'roda.e2e.session': SESSION, 'roda.e2e.profile': PROFILE });
    const service = createE2EDiscoverService({ window });
    await service.updateMine({ visibility: null, place: LISBON, contacts: {} });
    expect(await lisbonCount(service)).toBe(3);
    expect(await service.person('discover-caio')).toBeNull();
    expect((await service.person('practitioner-1')).visibility).toBe('nobody');
    expect((await service.cityPeople(LISBON))[0].profile_id).toBe('practitioner-1');
    window.localStorage.setItem('roda.e2e.discoverViewer', 'discover-bia');
    expect(await lisbonCount(service)).toBe(2);
    expect(await service.person('practitioner-1')).toBeNull();
    expect(await service.search('ana')).toEqual([]);
    window.localStorage.removeItem('roda.e2e.discoverViewer');
    await service.updateMine({ visibility: 'everyone', place: LISBON, contacts: {} });
    window.localStorage.setItem('roda.e2e.discoverViewer', 'discover-bia');
    expect(await lisbonCount(service)).toBe(3);
    expect((await service.search('ana')).map(({ kind, profile_id: id }) => [kind, id])).toEqual([['person', 'practitioner-1']]);
  });

  it('rejects invalid contacts and lets only owners change their group', async () => {
    const group = { id: 'group-1', owner_id: 'practitioner-1', name: 'Roda da Lua', is_discoverable: true, archived_at: null };
    const other = { id: 'group-2', owner_id: 'someone', name: 'Outra', is_discoverable: true, archived_at: null };
    const window = fakeWindow({
      'roda.e2e.session': SESSION, 'roda.e2e.profile': PROFILE,
      'roda.e2e.groupState': JSON.stringify({ groups: [group, other] }),
    });
    const service = createE2EDiscoverService({ window });
    await expect(service.updateMine({ contacts: { website: 'http://x.example' } }))
      .rejects.toMatchObject({ code: 'invalid_website' });
    await service.updateGroup('group-1', { place: LISBON, contacts: { email: 'ola@lua.example' } });
    expect((await service.loadGroup('group-1')).contact_email).toBe('ola@lua.example');
    expect((await service.points(EVERYWHERE)).some((point) => point.group_id === 'group-1')).toBe(true);
    await expect(service.updateGroup('group-2', { place: LISBON, contacts: {} }))
      .rejects.toMatchObject({ kind: 'authorization' });
  });

  it('reports coaches and join status on group cards', async () => {
    const window = fakeWindow({ 'roda.e2e.session': SESSION, 'roda.e2e.profile': PROFILE });
    const service = createE2EDiscoverService({ window });
    const card = await service.group('discover-group-lua');
    expect(card.my_status).toBeNull();
    expect(card.coaches).toEqual([{ profile_id: 'discover-lua', display_name: 'Mestre Lua', is_owner: true }]);
    window.localStorage.setItem('roda.e2e.groupState', JSON.stringify({
      joinRequests: { 'discover-group-lua': [{ id: 'r1', profile_id: 'practitioner-1', state: 'pending' }] },
    }));
    expect(await service.group('discover-group-lua')).toMatchObject({ my_status: 'pending', my_request_id: 'r1' });
    expect(await service.group('discover-group-hidden')).toBeNull();
  });
});
