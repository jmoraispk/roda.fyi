// tests/unit/discover-rules.test.js
import { describe, expect, it } from 'vitest';

import {
  canSeePerson, contactColumns, effectiveVisibility, fieldErrors, foldText, inBounds, normalizeContacts,
  normalizePlace, placeColumns, placeFromRow, placeLabel, roundCoordinate, validateContacts,
} from '../../src/app/discover-rules.js';

describe('discover rules', () => {
  it.each([
    [null, 'train', 'nobody'], [null, 'both', 'everyone'], [null, 'teach', 'everyone'], [null, undefined, 'nobody'],
    ['signed_in', 'teach', 'signed_in'], ['everyone', 'train', 'everyone'],
  ])('visibility %s with mode %s is %s', (visibility, mode, expected) => {
    expect(effectiveVisibility({ discover_visibility: visibility, usage_mode: mode })).toBe(expected);
  });

  it('applies the viewer table', () => {
    const done = '2026-09-01T00:00:00Z';
    const everyone = { id: 'a', discover_visibility: 'everyone', usage_mode: 'train', completed_at: done };
    const signedIn = { id: 'b', discover_visibility: 'signed_in', usage_mode: 'train', completed_at: done };
    const hidden = { id: 'c', discover_visibility: null, usage_mode: 'train', completed_at: done };
    const unfinished = { id: 'd', discover_visibility: 'everyone', usage_mode: 'teach', completed_at: null };
    const people = [everyone, signedIn, hidden, unfinished];
    expect(people.map((person) => canSeePerson('viewer', person))).toEqual([true, true, false, false]);
    expect(people.map((person) => canSeePerson(null, person))).toEqual([true, false, false, false]);
    expect(canSeePerson('c', hidden)).toBe(true);
    expect(canSeePerson('d', unfinished)).toBe(true);
  });

  it('rounds coordinates to two decimals and keeps missing values missing', () => {
    expect(roundCoordinate('38.7169')).toBe(38.72);
    expect(roundCoordinate(-9.1399)).toBe(-9.14);
    expect(roundCoordinate(null)).toBeNull();
    expect(roundCoordinate('')).toBeNull();
    expect(roundCoordinate('north')).toBeNull();
  });

  it('normalizes contacts the way people type them', () => {
    expect(normalizeContacts({
      instagram: ' @ana.silva ', website: 'ana.example/aulas', whatsapp: '+351 912-345-678', email: ' ana@example.com ',
    })).toEqual({
      instagram: 'ana.silva', website: 'https://ana.example/aulas', whatsapp: '+351 912345678', email: 'ana@example.com',
    });
    expect(normalizeContacts({ instagram: '', website: '   ' }))
      .toEqual({ instagram: null, website: null, whatsapp: null, email: null });
  });

  it.each([
    [{ instagram: 'ana silva' }, { instagram: 'invalid_instagram' }],
    [{ instagram: 'a'.repeat(31) }, { instagram: 'invalid_instagram' }],
    [{ website: 'http://ana.example' }, { website: 'invalid_website' }],
    [{ website: 'javascript:alert(1)' }, { website: 'invalid_website' }],
    [{ website: `https://${'a'.repeat(2041)}` }, { website: 'invalid_website' }],
    [{ whatsapp: '12345' }, { whatsapp: 'invalid_whatsapp' }],
    [{ whatsapp: '+351 912 345 678' }, {}],
    [{ email: 'ana@example' }, { email: 'invalid_email' }],
    [{ email: 'ana@example.com' }, {}],
  ])('validates %o', (contacts, errors) => {
    expect(validateContacts(normalizeContacts(contacts))).toEqual(errors);
  });

  it('maps a server rejection to its field', () => {
    expect(fieldErrors({ code: 'invalid_website' })).toEqual({ website: 'invalid_website' });
    expect(fieldErrors({ code: 'invalid_place' })).toEqual({});
    expect(fieldErrors(null)).toEqual({});
  });

  it('keeps only complete, rounded places', () => {
    expect(normalizePlace({ city: ' Lisbon ', region: 'Lisbon', country: 'Portugal', lat: 38.7169, lng: -9.1399 }))
      .toEqual({ city: 'Lisbon', region: 'Lisbon', country: 'Portugal', lat: 38.72, lng: -9.14 });
    expect(normalizePlace(null)).toBeNull();
    expect(normalizePlace({ city: 'Lisbon', lat: null, lng: -9 })).toBeNull();
    expect(normalizePlace({ city: 'Nowhere', lat: 91, lng: 0 })).toBeNull();
    expect(normalizePlace({ city: 'x'.repeat(130), lat: 0, lng: 0 }).city).toHaveLength(120);
  });

  it('converts between rows, columns, and labels', () => {
    const row = { place_city: 'Lisbon', place_region: 'Lisbon', place_country: 'Portugal', place_lat: '38.72', place_lng: '-9.14' };
    const place = placeFromRow(row);
    expect(place).toEqual({ city: 'Lisbon', region: 'Lisbon', country: 'Portugal', lat: 38.72, lng: -9.14 });
    expect(placeColumns(place)).toEqual({ ...row, place_lat: 38.72, place_lng: -9.14 });
    expect(placeColumns(null).place_city).toBeNull();
    expect(placeFromRow({ place_city: null })).toBeNull();
    expect(placeLabel(place)).toBe('Lisbon, Portugal');
    expect(placeLabel({ city: 'Salvador', region: 'Bahia', country: 'Brazil' })).toBe('Salvador, Bahia, Brazil');
    expect(contactColumns({ instagram: 'ana' })).toEqual({
      contact_instagram: 'ana', contact_website: null, contact_whatsapp: null, contact_email: null,
    });
  });

  it('finds points inside a box, including one across the antimeridian', () => {
    const box = { minLat: 30, minLng: -20, maxLat: 50, maxLng: 10 };
    expect(inBounds(38.72, -9.14, box)).toBe(true);
    expect(inBounds(-22.91, -43.17, box)).toBe(false);
    const pacific = { minLat: -30, minLng: 170, maxLat: 0, maxLng: -170 };
    expect(inBounds(-18.14, 178.44, pacific)).toBe(true);
    expect(inBounds(-18.14, -175, pacific)).toBe(true);
    expect(inBounds(-18.14, 0, pacific)).toBe(false);
  });

  it('folds accents and case for search', () => {
    expect(foldText('  Aú São ')).toBe('au sao');
  });
});
