// tests/unit/geocoder.test.js
import { describe, expect, it, vi } from 'vitest';

import { createNominatimGeocoder, parsePlace } from '../../src/app/geocoder.js';

const LISBOA = {
  lat: '38.7077507', lon: '-9.1365919', name: 'Lisboa',
  address: { city: 'Lisboa', state: 'Lisboa', country: 'Portugal' },
};

function setup(responses = [[LISBOA]]) {
  let clock = 0;
  const fetch = vi.fn(async () => {
    const body = responses.length > 1 ? responses.shift() : responses[0];
    if (body instanceof Error) throw body;
    if (body?.status) return { ok: false, status: body.status, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  });
  const wait = vi.fn(async (ms) => { clock += ms; });
  const geocoder = createNominatimGeocoder({ fetch, now: () => clock, wait, language: () => 'pt' });
  return { geocoder, fetch, wait, tick: (ms) => { clock += ms; } };
}

describe('nominatim geocoder', () => {
  it('asks for city-level places with policy-friendly parameters', async () => {
    const { geocoder, fetch } = setup();
    await expect(geocoder.searchCities('  Lisboa ')).resolves.toEqual([
      { city: 'Lisboa', region: 'Lisboa', country: 'Portugal', lat: 38.71, lng: -9.14 },
    ]);
    const [url, options] = fetch.mock.calls[0];
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://nominatim.openstreetmap.org/search');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      q: 'Lisboa', format: 'jsonv2', addressdetails: '1', limit: '5', featureType: 'city', 'accept-language': 'pt',
    });
    expect(options).toEqual({ credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin' });
  });

  it('sends one request per distinct search, even when pressed twice', async () => {
    const { geocoder, fetch } = setup();
    await Promise.all([geocoder.searchCities('Lisboa'), geocoder.searchCities('Lisboa')]);
    await geocoder.searchCities('Lisboa');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('spaces requests at least one second apart', async () => {
    const { geocoder, fetch, wait, tick } = setup();
    await geocoder.searchCities('Lisboa');
    tick(200);
    await geocoder.searchCities('Porto');
    expect(wait).toHaveBeenCalledWith(800);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('never sends one-letter searches', async () => {
    const { geocoder, fetch } = setup();
    await expect(geocoder.searchCities(' L ')).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([[{ status: 429 }], [new TypeError('Failed to fetch')]])('turns %o into a retryable error and retries later', async (failure) => {
    const { geocoder, fetch } = setup([failure, [LISBOA]]);
    await expect(geocoder.searchCities('Lisboa')).rejects.toMatchObject({ code: 'geocoder_unavailable', retryable: true });
    await expect(geocoder.searchCities('Lisboa')).resolves.toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reverse-geocodes a rounded tap at city zoom', async () => {
    const { geocoder, fetch } = setup([LISBOA]);
    await expect(geocoder.reverse({ lat: 38.712345, lng: -9.139876 })).resolves.toMatchObject({ city: 'Lisboa' });
    const params = new URL(fetch.mock.calls[0][0]).searchParams;
    expect([params.get('lat'), params.get('lon'), params.get('zoom')]).toEqual(['38.71', '-9.14', '10']);
  });

  it('returns null when reverse finds nothing', async () => {
    const { geocoder } = setup([{ error: 'Unable to geocode' }]);
    await expect(geocoder.reverse({ lat: 0, lng: 0 })).resolves.toBeNull();
  });

  it('drops duplicate cities', async () => {
    const { geocoder } = setup([[LISBOA, { ...LISBOA, lat: '38.71' }]]);
    await expect(geocoder.searchCities('Lisboa')).resolves.toHaveLength(1);
  });

  it('parses towns and villages and drops unusable rows', () => {
    expect(parsePlace({ lat: '1', lon: '2', address: { town: 'Ilhéus', state: 'Bahia', country: 'Brasil' } }))
      .toEqual({ city: 'Ilhéus', region: 'Bahia', country: 'Brasil', lat: 1, lng: 2 });
    expect(parsePlace({ lat: '1', lon: '2', address: {} })).toBeNull();
    expect(parsePlace({ name: 'Somewhere', address: {} })).toBeNull();
    expect(parsePlace({ lat: '1', lon: '2', name: 'y'.repeat(200), address: {} }).city).toHaveLength(120);
    expect(parsePlace(null)).toBeNull();
  });
});
