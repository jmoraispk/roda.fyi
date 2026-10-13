// tests/unit/discover-state.test.js
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { WORLD_VIEW, contactLinks, initialView, markerLongitudes, normalizeBounds, pinElement, pinLabel, sortForPanel, summarize } from '../../src/app/screens/discover-state.js';

describe('discover state', () => {
  it.each([
    [{ minLat: 38, minLng: -10, maxLat: 39, maxLng: -9 }, { minLat: 38, minLng: -10, maxLat: 39, maxLng: -9 }],
    [{ minLat: -95, minLng: -540, maxLat: 95, maxLng: 540 }, { minLat: -90, minLng: -180, maxLat: 90, maxLng: 180 }],
    [{ minLat: -30, minLng: 170, maxLat: 0, maxLng: 190 }, { minLat: -30, minLng: 170, maxLat: 0, maxLng: -170 }],
    [{ minLat: -30, minLng: -200, maxLat: 0, maxLng: -170 }, { minLat: -30, minLng: 160, maxLat: 0, maxLng: -170 }],
    [{ minLat: 0, minLng: 100, maxLat: 10, maxLng: 180 }, { minLat: 0, minLng: 100, maxLat: 10, maxLng: 180 }],
    [{ minLat: 38.123456, minLng: -9.987654, maxLat: 39, maxLng: -9 }, { minLat: 38.1235, minLng: -9.9877, maxLat: 39, maxLng: -9 }],
  ])('normalizes %o', (input, expected) => {
    expect(normalizeBounds(input)).toEqual(expected);
  });

  it('starts at the remembered view, then my city, then the world', () => {
    expect(initialView({ remembered: { lat: 1, lng: 2, zoom: 5 }, myPlace: { lat: 38.72, lng: -9.14 } }))
      .toEqual({ lat: 1, lng: 2, zoom: 5 });
    expect(initialView({ myPlace: { lat: 38.72, lng: -9.14 } })).toEqual({ lat: 38.72, lng: -9.14, zoom: 10 });
    expect(initialView()).toEqual(WORLD_VIEW);
  });

  it('summarizes and orders what is in view', () => {
    const points = [
      { kind: 'group', name: 'Grupo Lua' }, { kind: 'city', city: 'Porto', person_count: 1 },
      { kind: 'city', city: 'Lisbon', person_count: 3 },
    ];
    expect(summarize(points)).toEqual({ people: 4, groups: 1 });
    expect(sortForPanel(points).map(pinLabel)).toEqual(['Lisbon · 3', 'Porto · 1', 'Grupo Lua']);
  });

  it('builds pins as text so names cannot inject markup', () => {
    const pin = pinElement(document, { kind: 'city', city: '<img src=x onerror=alert(1)>', person_count: 2 });
    expect(pin.querySelector('img')).toBeNull();
    expect(pin.textContent).toBe('<img src=x onerror=alert(1)> · 2');
    expect(pin.className).toBe('discover-pin city');
  });

  it('links only to safe contact addresses', () => {
    expect(contactLinks({
      instagram: 'ana.silva', website: 'https://ana.example/aulas', whatsapp: '+351 912 345 678', email: 'ana@example.com',
    })).toEqual([
      { kind: 'instagram', text: '@ana.silva', href: 'https://www.instagram.com/ana.silva/' },
      { kind: 'website', text: 'ana.example', href: 'https://ana.example/aulas' },
      { kind: 'whatsapp', text: '+351 912 345 678', href: 'https://wa.me/351912345678' },
      { kind: 'email', text: 'ana@example.com', href: 'mailto:ana@example.com' },
    ]);
    expect(contactLinks({ instagram: 'x/../evil', website: 'javascript:alert(1)', email: 'a@b.co?cc=x@y.z' })).toEqual([]);
    expect(contactLinks({ website: 'http://ana.example', whatsapp: '12' })).toEqual([]);
  });

  it('places a pin on every world copy that is in view', () => {
    expect(markerLongitudes(-9.14, -221, 221)).toEqual([-9.14]);
    expect(markerLongitudes(-178, 170, 190)).toEqual([182]);
    expect(markerLongitudes(179, -200, 200)).toEqual([-181, 179]);
    expect(markerLongitudes(-9.14, -400, 400)).toEqual([-369.14, -9.14, 350.86]);
    expect(markerLongitudes(10, 20, 30)).toEqual([10]);
  });
});
