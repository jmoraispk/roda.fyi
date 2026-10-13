// src/app/geocoder.js
// City search against OpenStreetMap Nominatim, following its usage policy:
// user-initiated requests only, at most one per second, cached, never bulk.
// The browser sends this site's origin as Referer, which identifies the app.
import { cityKey, roundCoordinate } from './discover-rules.js';
import { AppError } from './errors.js';

export const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org';
const MIN_INTERVAL_MS = 1000;

function clip(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, 120) : null;
}

export function parsePlace(item) {
  if (!item || typeof item !== 'object') return null;
  const address = item.address ?? {};
  const city = clip(address.city ?? address.town ?? address.village ?? address.municipality ?? address.hamlet ?? item.name);
  const lat = roundCoordinate(item.lat);
  const lng = roundCoordinate(item.lon);
  if (!city || lat === null || lng === null) return null;
  return {
    city,
    region: clip(address.state ?? address.region ?? address.province ?? address.county),
    country: clip(address.country),
    lat,
    lng,
  };
}

function unavailable(cause) {
  return new AppError('network', 'geocoder_unavailable', 'City search is not available right now.', { retryable: true, cause });
}

export function createNominatimGeocoder({
  fetch,
  language = () => 'en',
  now = () => Date.now(),
  wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
  endpoint = NOMINATIM_ENDPOINT,
} = {}) {
  const cache = new Map();
  let nextAllowedAt = 0;
  let queue = Promise.resolve();

  function request(path, params) {
    const url = new URL(path, endpoint);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const key = url.href;
    if (cache.has(key)) return cache.get(key);
    const pending = queue.then(async () => {
      const delay = nextAllowedAt - now();
      if (delay > 0) await wait(delay);
      nextAllowedAt = now() + MIN_INTERVAL_MS;
      let response;
      try {
        response = await fetch(key, { credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin' });
      } catch (error) {
        throw unavailable(error);
      }
      if (!response.ok) throw unavailable();
      return response.json();
    });
    queue = pending.catch(() => {});
    cache.set(key, pending);
    pending.catch(() => cache.delete(key));
    return pending;
  }

  return {
    async searchCities(query) {
      const text = String(query ?? '').trim();
      if (text.length < 2) return [];
      const rows = await request('/search', {
        q: text, format: 'jsonv2', addressdetails: '1', limit: '5', featureType: 'city', 'accept-language': language(),
      });
      const seen = new Set();
      return (Array.isArray(rows) ? rows : []).map(parsePlace).filter((place) => {
        if (!place || seen.has(cityKey(place))) return false;
        seen.add(cityKey(place));
        return true;
      });
    },
    async reverse({ lat, lng }) {
      const row = await request('/reverse', {
        lat: String(roundCoordinate(lat)), lon: String(roundCoordinate(lng)),
        format: 'jsonv2', zoom: '10', addressdetails: '1', 'accept-language': language(),
      });
      return row?.error ? null : parsePlace(row);
    },
  };
}
