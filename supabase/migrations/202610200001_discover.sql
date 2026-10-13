-- supabase/migrations/202610200001_discover.sql
-- Discover v1: city-level places, contacts, and visibility. Requires 202610120001_usage_mode.sql.

alter table public.profiles
  add column discover_visibility text,
  add column place_city text,
  add column place_region text,
  add column place_country text,
  add column place_lat numeric(5,2),
  add column place_lng numeric(5,2),
  add column contact_instagram text,
  add column contact_website text,
  add column contact_whatsapp text,
  add column contact_email text;

alter table public.profiles
  add constraint profiles_discover_visibility_check check (
    discover_visibility is null or discover_visibility in ('everyone', 'signed_in', 'nobody')
  ),
  add constraint profiles_place_text_check check (
    (place_city is null or (place_city = btrim(place_city) and char_length(place_city) between 1 and 120))
    and (place_region is null or (place_region = btrim(place_region) and char_length(place_region) between 1 and 120))
    and (place_country is null or (place_country = btrim(place_country) and char_length(place_country) between 1 and 120))
  ),
  add constraint profiles_place_coordinates_check check (
    (place_lat is null) = (place_lng is null)
    and (place_lat is null or place_lat between -90 and 90)
    and (place_lng is null or place_lng between -180 and 180)
  ),
  add constraint profiles_place_complete_check check (
    (place_lat is null and place_city is null and place_region is null and place_country is null)
    or (place_lat is not null and place_city is not null)
  ),
  add constraint profiles_contact_instagram_check check (
    contact_instagram is null or contact_instagram ~ '^[A-Za-z0-9._]{1,30}$'
  ),
  add constraint profiles_contact_website_check check (
    contact_website is null
    or (contact_website ~ '^https://[^[:space:]]+$' and char_length(contact_website) <= 2048)
  ),
  add constraint profiles_contact_whatsapp_check check (
    contact_whatsapp is null or contact_whatsapp ~ '^\+?[0-9 ]{6,20}$'
  ),
  add constraint profiles_contact_email_check check (
    contact_email is null
    or (char_length(contact_email) <= 254
        and contact_email ~ '^[^@[:space:]?#]+@[^@[:space:]?#]+\.[^@[:space:]?#]+$')
  );

alter table public.groups
  add column place_city text,
  add column place_region text,
  add column place_country text,
  add column place_lat numeric(5,2),
  add column place_lng numeric(5,2),
  add column contact_instagram text,
  add column contact_website text,
  add column contact_email text;

alter table public.groups
  add constraint groups_place_text_check check (
    (place_city is null or (place_city = btrim(place_city) and char_length(place_city) between 1 and 120))
    and (place_region is null or (place_region = btrim(place_region) and char_length(place_region) between 1 and 120))
    and (place_country is null or (place_country = btrim(place_country) and char_length(place_country) between 1 and 120))
  ),
  add constraint groups_place_coordinates_check check (
    (place_lat is null) = (place_lng is null)
    and (place_lat is null or place_lat between -90 and 90)
    and (place_lng is null or place_lng between -180 and 180)
  ),
  add constraint groups_place_complete_check check (
    (place_lat is null and place_city is null and place_region is null and place_country is null)
    or (place_lat is not null and place_city is not null)
  ),
  add constraint groups_contact_instagram_check check (
    contact_instagram is null or contact_instagram ~ '^[A-Za-z0-9._]{1,30}$'
  ),
  add constraint groups_contact_website_check check (
    contact_website is null
    or (contact_website ~ '^https://[^[:space:]]+$' and char_length(contact_website) <= 2048)
  ),
  add constraint groups_contact_email_check check (
    contact_email is null
    or (char_length(contact_email) <= 254
        and contact_email ~ '^[^@[:space:]?#]+@[^@[:space:]?#]+\.[^@[:space:]?#]+$')
  );

create index profiles_discover_place_idx on public.profiles (place_lat, place_lng)
  where place_lat is not null;
create index groups_discover_place_idx on public.groups (place_lat, place_lng)
  where place_lat is not null and archived_at is null and is_discoverable;

create function private.discover_effective_visibility(visibility text, mode text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(visibility, case when mode in ('both', 'teach') then 'everyone' else 'nobody' end);
$$;

-- The one visibility rule for points, city lists, cards, search, and photos.
create function private.discover_can_see(
  actor_id uuid, target_id uuid, visibility text, mode text, completed_at timestamptz
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(target_id = actor_id, false)
      or (completed_at is not null and (
            private.discover_effective_visibility(visibility, mode) = 'everyone'
            or (private.discover_effective_visibility(visibility, mode) = 'signed_in' and actor_id is not null)));
$$;

create function private.discover_place(city text, region text, country text, lat numeric, lng numeric)
returns table (place_city text, place_region text, place_country text, place_lat numeric, place_lng numeric)
language plpgsql
immutable
set search_path = ''
as $$
declare
  clean_city text := nullif(btrim(city), '');
  clean_region text := nullif(btrim(region), '');
  clean_country text := nullif(btrim(country), '');
begin
  if clean_city is null and lat is null and lng is null then
    return query select null::text, null::text, null::text, null::numeric, null::numeric;
    return;
  end if;
  if clean_city is null or lat is null or lng is null
     or char_length(clean_city) > 120
     or char_length(coalesce(clean_region, '')) > 120
     or char_length(coalesce(clean_country, '')) > 120
     or lat < -90 or lat > 90 or lng < -180 or lng > 180 then
    raise exception using errcode = 'P0001', message = 'invalid_place';
  end if;
  return query select clean_city, clean_region, clean_country, round(lat, 2), round(lng, 2);
end;
$$;

create function private.discover_contact(contact_kind text, raw_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  clean text := nullif(btrim(raw_value), '');
begin
  if contact_kind = 'instagram' then
    clean := nullif(regexp_replace(coalesce(clean, ''), '^@', ''), '');
  end if;
  if clean is null then
    return null;
  end if;
  if (contact_kind = 'instagram' and clean ~ '^[A-Za-z0-9._]{1,30}$')
     or (contact_kind = 'website' and clean ~ '^https://[^[:space:]]+$' and char_length(clean) <= 2048)
     or (contact_kind = 'whatsapp' and clean ~ '^\+?[0-9 ]{6,20}$')
     or (contact_kind = 'email' and char_length(clean) <= 254
         and clean ~ '^[^@[:space:]?#]+@[^@[:space:]?#]+\.[^@[:space:]?#]+$') then
    return clean;
  end if;
  raise exception using errcode = 'P0001', message = 'invalid_' || contact_kind;
end;
$$;

create function private.update_discover_profile(
  actor_id uuid, new_visibility text,
  new_city text, new_region text, new_country text, new_lat numeric, new_lng numeric,
  new_instagram text, new_website text, new_whatsapp text, new_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  place record;
begin
  if actor_id is null or not exists (select 1 from public.profiles person where person.id = actor_id) then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if new_visibility is not null and new_visibility not in ('everyone', 'signed_in', 'nobody') then
    raise exception using errcode = 'P0001', message = 'invalid_visibility';
  end if;
  select * into place from private.discover_place(new_city, new_region, new_country, new_lat, new_lng);
  update public.profiles person
     set discover_visibility = new_visibility,
         place_city = place.place_city,
         place_region = place.place_region,
         place_country = place.place_country,
         place_lat = place.place_lat,
         place_lng = place.place_lng,
         contact_instagram = private.discover_contact('instagram', new_instagram),
         contact_website = private.discover_contact('website', new_website),
         contact_whatsapp = private.discover_contact('whatsapp', new_whatsapp),
         contact_email = private.discover_contact('email', new_email)
   where person.id = actor_id;
  return jsonb_build_object('status', 'updated', 'profile_id', actor_id);
end;
$$;

create function private.update_group_discover(
  actor_id uuid, target_group_id uuid,
  new_city text, new_region text, new_country text, new_lat numeric, new_lng numeric,
  new_instagram text, new_website text, new_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  place record;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if not private.is_group_owner(target_group_id, actor_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  select * into place from private.discover_place(new_city, new_region, new_country, new_lat, new_lng);
  update public.groups target
     set place_city = place.place_city,
         place_region = place.place_region,
         place_country = place.place_country,
         place_lat = place.place_lat,
         place_lng = place.place_lng,
         contact_instagram = private.discover_contact('instagram', new_instagram),
         contact_website = private.discover_contact('website', new_website),
         contact_email = private.discover_contact('email', new_email)
   where target.id = target_group_id;
  return jsonb_build_object('status', 'updated', 'group_id', target_group_id);
end;
$$;

create function public.update_discover_profile(
  visibility text, place_city text, place_region text, place_country text,
  place_lat numeric, place_lng numeric,
  contact_instagram text, contact_website text, contact_whatsapp text, contact_email text
)
returns jsonb language sql set search_path = ''
as $$
  select private.update_discover_profile(auth.uid(), visibility, place_city, place_region, place_country,
    place_lat, place_lng, contact_instagram, contact_website, contact_whatsapp, contact_email);
$$;

create function public.update_group_discover(
  group_id uuid, place_city text, place_region text, place_country text,
  place_lat numeric, place_lng numeric,
  contact_instagram text, contact_website text, contact_email text
)
returns jsonb language sql set search_path = ''
as $$
  select private.update_group_discover(auth.uid(), group_id, place_city, place_region, place_country,
    place_lat, place_lng, contact_instagram, contact_website, contact_email);
$$;

revoke execute on function private.discover_effective_visibility(text, text) from public, anon, authenticated;
revoke execute on function private.discover_can_see(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function private.discover_place(text, text, text, numeric, numeric) from public, anon, authenticated;
revoke execute on function private.discover_contact(text, text) from public, anon, authenticated;
revoke execute on function private.update_discover_profile(uuid, text, text, text, text, numeric, numeric, text, text, text, text)
  from public, anon, authenticated;
revoke execute on function private.update_group_discover(uuid, uuid, text, text, text, numeric, numeric, text, text, text)
  from public, anon, authenticated;
grant execute on function private.update_discover_profile(uuid, text, text, text, text, numeric, numeric, text, text, text, text)
  to authenticated;
grant execute on function private.update_group_discover(uuid, uuid, text, text, text, numeric, numeric, text, text, text)
  to authenticated;
revoke execute on function public.update_discover_profile(text, text, text, text, numeric, numeric, text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.update_group_discover(uuid, text, text, text, numeric, numeric, text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_discover_profile(text, text, text, text, numeric, numeric, text, text, text, text)
  to authenticated;
grant execute on function public.update_group_discover(uuid, text, text, text, numeric, numeric, text, text, text)
  to authenticated;
