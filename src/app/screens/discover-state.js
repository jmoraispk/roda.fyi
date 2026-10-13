// src/app/screens/discover-state.js
import { EMAIL } from '../discover-rules.js';
import { el } from '../shell/page.js';

export const WORLD_VIEW = Object.freeze({ lat: 20, lng: 0, zoom: 2 });

function wrapLng(lng) {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

export function normalizeBounds({ minLat, minLng, maxLat, maxLng }) {
  const clampLat = (value) => round4(Math.min(90, Math.max(-90, value)));
  if (maxLng - minLng >= 360) return { minLat: clampLat(minLat), minLng: -180, maxLat: clampLat(maxLat), maxLng: 180 };
  let east = wrapLng(maxLng);
  if (east === -180 && maxLng > minLng) east = 180;
  return { minLat: clampLat(minLat), minLng: round4(wrapLng(minLng)), maxLat: clampLat(maxLat), maxLng: round4(east) };
}

export function initialView({ remembered = null, myPlace = null } = {}) {
  if (remembered) return remembered;
  if (myPlace) return { lat: myPlace.lat, lng: myPlace.lng, zoom: 10 };
  return WORLD_VIEW;
}

export function summarize(points) {
  return points.reduce((total, point) => (point.kind === 'city'
    ? { ...total, people: total.people + (point.person_count ?? 0) }
    : { ...total, groups: total.groups + 1 }), { people: 0, groups: 0 });
}

export function pinLabel(point) {
  return point.kind === 'city' ? `${point.city} · ${point.person_count}` : point.name;
}

export function pinElement(document, point) {
  return el(document, 'span', { className: `discover-pin ${point.kind}`, text: pinLabel(point) });
}

export function sortForPanel(points) {
  return [...points].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'city' ? -1 : 1)
    || (b.person_count ?? 0) - (a.person_count ?? 0)
    || pinLabel(a).localeCompare(pinLabel(b)));
}

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function contactLinks(contacts = {}) {
  const links = [];
  if (contacts.instagram && /^[A-Za-z0-9._]{1,30}$/.test(contacts.instagram)) {
    links.push({ kind: 'instagram', text: `@${contacts.instagram}`, href: `https://www.instagram.com/${contacts.instagram}/` });
  }
  const website = contacts.website ? httpsUrl(contacts.website) : null;
  if (website) links.push({ kind: 'website', text: website.host, href: website.href });
  const digits = String(contacts.whatsapp ?? '').replace(/\D/g, '');
  if (digits.length >= 6 && digits.length <= 20) {
    links.push({ kind: 'whatsapp', text: contacts.whatsapp, href: `https://wa.me/${digits}` });
  }
  if (contacts.email && EMAIL.test(contacts.email)) {
    links.push({ kind: 'email', text: contacts.email, href: `mailto:${contacts.email}` });
  }
  return links;
}
