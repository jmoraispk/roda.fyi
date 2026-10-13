// src/app/discover-rules.js
// Discover rules shared by the screens and the local fake. The database applies the same rules.
export const VISIBILITIES = Object.freeze(['everyone', 'signed_in', 'nobody']);
const CONTACT_FIELDS = Object.freeze(['instagram', 'website', 'whatsapp', 'email']);
const INSTAGRAM = /^[A-Za-z0-9._]{1,30}$/;
const WEBSITE = /^https:\/\/\S+$/;
const WHATSAPP = /^\+?[0-9 ]{6,20}$/;
export const EMAIL = /^[^@\s?#]+@[^@\s?#]+\.[^@\s?#]+$/;

export function effectiveVisibility({ discover_visibility: visibility = null, usage_mode: mode = 'train' } = {}) {
  if (visibility) return visibility;
  return mode === 'both' || mode === 'teach' ? 'everyone' : 'nobody';
}

export function canSeePerson(viewerId, person) {
  if (viewerId && person.id === viewerId) return true;
  if (!person.completed_at) return false;
  const visibility = effectiveVisibility(person);
  return visibility === 'everyone' || (visibility === 'signed_in' && Boolean(viewerId));
}

export function roundCoordinate(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

export function foldText(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase().trim();
}

function trimmed(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

export function normalizeContacts(raw = {}) {
  const instagram = trimmed(raw.instagram)?.replace(/^@/, '') || null;
  let website = trimmed(raw.website);
  if (website && !/^[a-z][a-z0-9+.-]*:/i.test(website)) website = `https://${website}`;
  const whatsapp = trimmed(raw.whatsapp)?.replace(/[-().]/g, '').replace(/\s+/g, ' ') || null;
  return { instagram, website, whatsapp, email: trimmed(raw.email) };
}

export function validateContacts(contacts) {
  const errors = {};
  if (contacts.instagram && !INSTAGRAM.test(contacts.instagram)) errors.instagram = 'invalid_instagram';
  if (contacts.website && (!WEBSITE.test(contacts.website) || contacts.website.length > 2048)) errors.website = 'invalid_website';
  if (contacts.whatsapp && !WHATSAPP.test(contacts.whatsapp)) errors.whatsapp = 'invalid_whatsapp';
  if (contacts.email && (!EMAIL.test(contacts.email) || contacts.email.length > 254)) errors.email = 'invalid_email';
  return errors;
}

export function fieldErrors(error) {
  const field = String(error?.code ?? '').replace(/^invalid_/, '');
  return CONTACT_FIELDS.includes(field) ? { [field]: error.code } : {};
}

export function normalizePlace(place) {
  const city = trimmed(place?.city);
  if (!city) return null;
  const lat = roundCoordinate(place.lat);
  const lng = roundCoordinate(place.lng);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const clip = (value) => trimmed(value)?.slice(0, 120) ?? null;
  return { city: city.slice(0, 120), region: clip(place.region), country: clip(place.country), lat, lng };
}

export function placeFromRow(row) {
  if (!row?.place_city) return null;
  return {
    city: row.place_city, region: row.place_region ?? null, country: row.place_country ?? null,
    lat: Number(row.place_lat), lng: Number(row.place_lng),
  };
}

export function contactsFromRow(row) {
  return {
    instagram: row?.contact_instagram ?? null, website: row?.contact_website ?? null,
    whatsapp: row?.contact_whatsapp ?? null, email: row?.contact_email ?? null,
  };
}

export function placeColumns(place) {
  return {
    place_city: place?.city ?? null, place_region: place?.region ?? null, place_country: place?.country ?? null,
    place_lat: place?.lat ?? null, place_lng: place?.lng ?? null,
  };
}

export function contactColumns(contacts) {
  return {
    contact_instagram: contacts?.instagram ?? null, contact_website: contacts?.website ?? null,
    contact_whatsapp: contacts?.whatsapp ?? null, contact_email: contacts?.email ?? null,
  };
}

export function placeLabel({ city, region, country } = {}) {
  return [city, region, country].filter(Boolean).filter((part, index, all) => all.indexOf(part) === index).join(', ');
}

export function inBounds(lat, lng, { minLat, minLng, maxLat, maxLng }) {
  if (lat < minLat || lat > maxLat) return false;
  return minLng <= maxLng ? lng >= minLng && lng <= maxLng : lng >= minLng || lng <= maxLng;
}

export function cityKey({ city, region = null, country = null }) {
  return JSON.stringify([city, region ?? null, country ?? null]);
}
