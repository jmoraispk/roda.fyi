-- supabase/migrations/202610200002_discover_read.sql
create function private.discover_points(
  actor_id uuid, min_lat numeric, min_lng numeric, max_lat numeric, max_lng numeric
)
returns table (
  kind text, lat numeric, lng numeric, city text, region text, country text,
  person_count integer, group_id uuid, name text, location text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if min_lat is null or min_lng is null or max_lat is null or max_lng is null
     or min_lat > max_lat or min_lat < -90 or max_lat > 90
     or min_lng < -180 or min_lng > 180 or max_lng < -180 or max_lng > 180 then
    raise exception using errcode = 'P0001', message = 'invalid_bounds';
  end if;
  return query
  with visible_people as (
    select person.place_city, person.place_region, person.place_country, person.place_lat, person.place_lng
      from public.profiles person
     where person.place_lat is not null
       and person.place_lat between min_lat and max_lat
       and case when min_lng <= max_lng then person.place_lng between min_lng and max_lng
                else person.place_lng >= min_lng or person.place_lng <= max_lng end
       and private.discover_can_see(actor_id, person.id, person.discover_visibility,
                                    person.usage_mode, person.completed_at)
  ),
  points as (
    select 'city'::text as kind,
           round(avg(visible.place_lat), 2) as lat,
           round(avg(visible.place_lng), 2) as lng,
           visible.place_city as city,
           visible.place_region as region,
           visible.place_country as country,
           count(*)::integer as person_count,
           null::uuid as group_id,
           null::text as name,
           null::text as location
      from visible_people visible
     group by visible.place_city, visible.place_region, visible.place_country
    union all
    select 'group'::text, pinned.place_lat, pinned.place_lng,
           pinned.place_city, pinned.place_region, pinned.place_country,
           null::integer, pinned.id, pinned.name, pinned.location
      from public.groups pinned
     where pinned.archived_at is null
       and pinned.is_discoverable
       and pinned.place_lat is not null
       and pinned.place_lat between min_lat and max_lat
       and case when min_lng <= max_lng then pinned.place_lng between min_lng and max_lng
                else pinned.place_lng >= min_lng or pinned.place_lng <= max_lng end
  )
  select point.kind, point.lat, point.lng, point.city, point.region, point.country,
         point.person_count, point.group_id, point.name, point.location
    from points point
   order by coalesce(point.person_count, 1) desc, point.kind, coalesce(point.city, point.name), point.group_id
   limit 500;
end;
$$;

create function private.discover_city_people(
  actor_id uuid, target_city text, target_region text, target_country text, result_limit integer
)
returns table (profile_id uuid, display_name text, avatar_path text, usage_mode text)
language sql
stable
security definer
set search_path = ''
as $$
  select person.id, person.display_name, person.avatar_path, person.usage_mode
    from public.profiles person
   where person.place_city = target_city
     and person.place_region is not distinct from target_region
     and person.place_country is not distinct from target_country
     and private.discover_can_see(actor_id, person.id, person.discover_visibility,
                                  person.usage_mode, person.completed_at)
   order by person.id = actor_id desc nulls last, person.display_name, person.id
   limit least(greatest(coalesce(result_limit, 50), 1), 100);
$$;

create function private.discover_person(actor_id uuid, target_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'profile_id', person.id,
    'display_name', person.display_name,
    'avatar_path', person.avatar_path,
    'usage_mode', person.usage_mode,
    'city', person.place_city,
    'region', person.place_region,
    'country', person.place_country,
    'lat', person.place_lat,
    'lng', person.place_lng,
    'is_self', coalesce(person.id = actor_id, false),
    'visibility', case when person.id = actor_id
      then private.discover_effective_visibility(person.discover_visibility, person.usage_mode) end,
    'contacts', jsonb_strip_nulls(jsonb_build_object(
      'instagram', person.contact_instagram, 'website', person.contact_website,
      'whatsapp', person.contact_whatsapp, 'email', person.contact_email)),
    'trains_in', coalesce((
      select jsonb_agg(jsonb_build_object('group_id', joined.id, 'name', joined.name) order by joined.name, joined.id)
        from public.group_memberships membership
        join public.groups joined on joined.id = membership.group_id
       where membership.profile_id = person.id and membership.state = 'active'
         and membership.access_level = 'member'
         and joined.archived_at is null and joined.is_discoverable
    ), '[]'::jsonb),
    'teaches', coalesce((
      select jsonb_agg(jsonb_build_object(
               'group_id', taught.id, 'name', taught.name,
               'role', case when taught.owner_id = person.id then 'owner' else 'coach' end)
             order by taught.name, taught.id)
        from public.group_memberships membership
        join public.groups taught on taught.id = membership.group_id
       where membership.profile_id = person.id and membership.state = 'active'
         and membership.access_level = 'coach'
         and taught.archived_at is null and taught.is_discoverable
    ), '[]'::jsonb)
  )
    from public.profiles person
   where person.id = target_profile_id
     and private.discover_can_see(actor_id, person.id, person.discover_visibility,
                                  person.usage_mode, person.completed_at);
$$;

create function private.discover_group(actor_id uuid, target_group_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'group_id', shown.id,
    'name', shown.name,
    'picture_path', shown.picture_path,
    'location', shown.location,
    'city', shown.place_city,
    'region', shown.place_region,
    'country', shown.place_country,
    'lat', shown.place_lat,
    'lng', shown.place_lng,
    'is_discoverable', shown.is_discoverable,
    'contacts', jsonb_strip_nulls(jsonb_build_object(
      'instagram', shown.contact_instagram, 'website', shown.contact_website, 'email', shown.contact_email)),
    'coaches', coalesce((
      select jsonb_agg(jsonb_build_object(
               'profile_id', coach.id, 'display_name', coach.display_name, 'is_owner', coach.id = shown.owner_id)
             order by coach.id = shown.owner_id desc, coach.display_name, coach.id)
        from public.group_memberships membership
        join public.profiles coach on coach.id = membership.profile_id
       where membership.group_id = shown.id and membership.state = 'active'
         and membership.access_level = 'coach'
         and private.discover_can_see(actor_id, coach.id, coach.discover_visibility,
                                      coach.usage_mode, coach.completed_at)
    ), '[]'::jsonb),
    'my_status', case
      when actor_id is null then null
      when shown.owner_id = actor_id then 'owner'
      when exists (
        select 1 from public.group_memberships mine
         where mine.group_id = shown.id and mine.profile_id = actor_id
           and mine.state = 'active' and mine.access_level = 'coach'
      ) then 'coach'
      when exists (
        select 1 from public.group_memberships mine
         where mine.group_id = shown.id and mine.profile_id = actor_id and mine.state = 'active'
      ) then 'member'
      when exists (
        select 1 from public.group_join_requests request
         where request.group_id = shown.id and request.profile_id = actor_id
           and request.state = 'pending' and request.expires_at > now()
      ) then 'pending'
    end,
    'my_request_id', (
      select request.id from public.group_join_requests request
       where request.group_id = shown.id and request.profile_id = actor_id
         and request.state = 'pending' and request.expires_at > now()
       order by request.created_at desc
       limit 1
    )
  )
    from public.groups shown
   where shown.id = target_group_id
     and shown.archived_at is null
     and (shown.is_discoverable or private.is_active_group_member(shown.id, actor_id));
$$;

create function private.discover_search(actor_id uuid, search_text text, result_limit integer)
returns table (
  kind text, profile_id uuid, group_id uuid, label text, city text, region text, country text,
  lat numeric, lng numeric, person_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  needle text := extensions.unaccent(lower(btrim(coalesce(search_text, ''))));
  pattern text;
  cap integer := least(greatest(coalesce(result_limit, 20), 1), 20);
begin
  if char_length(needle) < 2 then
    return;
  end if;
  pattern := '%' || replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
  with visible as (
    select person.*
      from public.profiles person
     where private.discover_can_see(actor_id, person.id, person.discover_visibility,
                                    person.usage_mode, person.completed_at)
  ),
  cities as (
    select 'city'::text as kind, null::uuid as profile_id, null::uuid as group_id,
           visible.place_city as label, visible.place_city as city, visible.place_region as region,
           visible.place_country as country,
           round(avg(visible.place_lat), 2) as lat, round(avg(visible.place_lng), 2) as lng,
           count(*)::integer as person_count,
           row_number() over (order by count(*) desc, visible.place_city) as rank_in_kind,
           0 as kind_order
      from visible
     where visible.place_city is not null
       and extensions.unaccent(lower(visible.place_city)) like pattern
     group by visible.place_city, visible.place_region, visible.place_country
  ),
  people as (
    select 'person'::text, visible.id, null::uuid, visible.display_name, visible.place_city,
           visible.place_region, visible.place_country, visible.place_lat, visible.place_lng,
           null::integer,
           row_number() over (order by visible.display_name, visible.id),
           1
      from visible
     where extensions.unaccent(lower(visible.display_name)) like pattern
  ),
  found_groups as (
    select 'group'::text, null::uuid, found.id, found.name, found.place_city, found.place_region,
           found.place_country, found.place_lat, found.place_lng, null::integer,
           row_number() over (order by found.name, found.id),
           2
      from public.groups found
     where found.archived_at is null
       and found.is_discoverable
       and extensions.unaccent(lower(found.name || ' ' || coalesce(found.location, '') || ' '
                                     || coalesce(found.place_city, ''))) like pattern
  )
  select result.kind, result.profile_id, result.group_id, result.label, result.city, result.region,
         result.country, result.lat, result.lng, result.person_count
    from (select * from cities union all select * from people union all select * from found_groups) result
   order by result.rank_in_kind, result.kind_order
   limit cap;
end;
$$;

-- Ruling 11: a photo is readable exactly when its Discover card is visible.
create or replace function private.can_read_profile_picture(object_name text, actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    actor_id is not null
    and (
      object_name ~ (
        '^' || actor_id::text ||
        '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
      )
      or exists (
        select 1
          from public.profiles profile
         where profile.avatar_path = object_name
           and (
             private.is_direct_coach_of(actor_id, profile.id)
             or exists (
               select 1
                 from public.group_memberships membership
                 join public.groups child_group
                   on child_group.id = membership.group_id
                  and child_group.archived_at is null
                where membership.profile_id = profile.id
                  and membership.state = 'active'
                  and private.has_named_parent_progress(actor_id, child_group.id)
             )
             or private.discover_can_see(actor_id, profile.id, profile.discover_visibility,
                                         profile.usage_mode, profile.completed_at)
           )
      )
    ),
    false
  );
$$;

create function public.discover_points(min_lat numeric, min_lng numeric, max_lat numeric, max_lng numeric)
returns table (
  kind text, lat numeric, lng numeric, city text, region text, country text,
  person_count integer, group_id uuid, name text, location text
)
language sql stable set search_path = ''
as $$ select * from private.discover_points(auth.uid(), min_lat, min_lng, max_lat, max_lng); $$;

create function public.discover_city_people(
  city text, region text default null, country text default null, result_limit integer default 50
)
returns table (profile_id uuid, display_name text, avatar_path text, usage_mode text)
language sql stable set search_path = ''
as $$ select * from private.discover_city_people(auth.uid(), city, region, country, result_limit); $$;

create function public.discover_person(profile_id uuid)
returns jsonb language sql stable set search_path = ''
as $$ select private.discover_person(auth.uid(), profile_id); $$;

create function public.discover_group(group_id uuid)
returns jsonb language sql stable set search_path = ''
as $$ select private.discover_group(auth.uid(), group_id); $$;

create function public.discover_search(search_text text, result_limit integer default 20)
returns table (
  kind text, profile_id uuid, group_id uuid, label text, city text, region text, country text,
  lat numeric, lng numeric, person_count integer
)
language sql stable set search_path = ''
as $$ select * from private.discover_search(auth.uid(), search_text, result_limit); $$;

revoke execute on function private.discover_points(uuid, numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke execute on function private.discover_city_people(uuid, text, text, text, integer) from public, anon, authenticated;
revoke execute on function private.discover_person(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.discover_group(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.discover_search(uuid, text, integer) from public, anon, authenticated;
grant execute on function private.discover_points(uuid, numeric, numeric, numeric, numeric) to authenticated;
grant execute on function private.discover_city_people(uuid, text, text, text, integer) to authenticated;
grant execute on function private.discover_person(uuid, uuid) to authenticated;
grant execute on function private.discover_group(uuid, uuid) to authenticated;
grant execute on function private.discover_search(uuid, text, integer) to authenticated;
revoke execute on function public.discover_points(numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.discover_city_people(text, text, text, integer) from public, anon, authenticated;
revoke execute on function public.discover_person(uuid) from public, anon, authenticated;
revoke execute on function public.discover_group(uuid) from public, anon, authenticated;
revoke execute on function public.discover_search(text, integer) from public, anon, authenticated;
grant execute on function public.discover_points(numeric, numeric, numeric, numeric) to authenticated;
grant execute on function public.discover_city_people(text, text, text, integer) to authenticated;
grant execute on function public.discover_person(uuid) to authenticated;
grant execute on function public.discover_group(uuid) to authenticated;
grant execute on function public.discover_search(text, integer) to authenticated;
