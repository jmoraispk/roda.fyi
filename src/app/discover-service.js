// src/app/discover-service.js
import { contactColumns, placeColumns } from './discover-rules.js';
import { toAppError } from './errors.js';

export const MY_DISCOVER_COLUMNS = 'id, usage_mode, discover_visibility, place_city, place_region, place_country, place_lat, place_lng, contact_instagram, contact_website, contact_whatsapp, contact_email';
export const GROUP_DISCOVER_COLUMNS = 'id, owner_id, name, is_discoverable, place_city, place_region, place_country, place_lat, place_lng, contact_instagram, contact_website, contact_email';

export function createDiscoverService(client) {
  async function call(name, params = {}) {
    const result = await client.rpc(name, params);
    if (result.error) throw toAppError(result.error);
    return result.data;
  }

  async function read(query) {
    const result = await query;
    if (result.error) throw toAppError(result.error);
    return result.data;
  }

  return {
    loadMine() {
      return read(client.from('profiles').select(MY_DISCOVER_COLUMNS).single());
    },
    updateMine({ visibility = null, place = null, contacts = {} } = {}) {
      return call('update_discover_profile', { visibility, ...placeColumns(place), ...contactColumns(contacts) });
    },
    loadGroup(groupId) {
      return read(client.from('groups').select(GROUP_DISCOVER_COLUMNS).eq('id', groupId).single());
    },
    updateGroup(groupId, { place = null, contacts = {} } = {}) {
      const { contact_whatsapp: _whatsapp, ...groupContacts } = contactColumns(contacts);
      return call('update_group_discover', { group_id: groupId, ...placeColumns(place), ...groupContacts });
    },
    points({ minLat, minLng, maxLat, maxLng }) {
      return call('discover_points', { min_lat: minLat, min_lng: minLng, max_lat: maxLat, max_lng: maxLng });
    },
    cityPeople({ city, region = null, country = null }, limit = 50) {
      return call('discover_city_people', { city, region, country, result_limit: limit });
    },
    person(profileId) {
      return call('discover_person', { profile_id: profileId });
    },
    group(groupId) {
      return call('discover_group', { group_id: groupId });
    },
    search(text, limit = 20) {
      return call('discover_search', { search_text: String(text ?? '').trim(), result_limit: limit });
    },
    async pictureUrl(kind, path) {
      if (!path) return null;
      const bucket = kind === 'group' ? 'group-pictures' : 'profile-pictures';
      const result = await client.storage.from(bucket).createSignedUrl(path, 3600);
      return result.error ? null : result.data?.signedUrl ?? null;
    },
  };
}
