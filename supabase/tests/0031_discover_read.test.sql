-- supabase/tests/0031_discover_read.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_function('public', 'discover_points', array['numeric', 'numeric', 'numeric', 'numeric']);
select has_function('public', 'discover_city_people', array['text', 'text', 'text', 'integer']);
select has_function('public', 'discover_person', array['uuid']);
select has_function('public', 'discover_group', array['uuid']);
select has_function('public', 'discover_search', array['text', 'integer']);

select tests.create_user('10000000-0000-0000-0000-000000003101', 'alice31@example.test', 'Alice Everyone');
select tests.create_user('10000000-0000-0000-0000-000000003102', 'bruno31@example.test', 'Bruno Teach');
select tests.create_user('10000000-0000-0000-0000-000000003103', 'carla31@example.test', 'Carla Signed');
select tests.create_user('10000000-0000-0000-0000-000000003104', 'dora31@example.test', 'Dora Hidden');
select tests.create_user('10000000-0000-0000-0000-000000003105', 'edu31@example.test', 'Edu Nobody');
select tests.create_user('10000000-0000-0000-0000-000000003106', 'fabi31@example.test', 'Fabi Unfinished');
select tests.create_user('10000000-0000-0000-0000-000000003107', 'vera31@example.test', 'Vera Viewer');
insert into public.coach_profiles (profile_id) values
  ('10000000-0000-0000-0000-000000003102'), ('10000000-0000-0000-0000-000000003105');

update public.profiles set completed_at = now(), usage_mode = 'train'
 where id in ('10000000-0000-0000-0000-000000003101', '10000000-0000-0000-0000-000000003102',
              '10000000-0000-0000-0000-000000003103', '10000000-0000-0000-0000-000000003104',
              '10000000-0000-0000-0000-000000003105', '10000000-0000-0000-0000-000000003107');
update public.profiles set usage_mode = 'teach'
 where id in ('10000000-0000-0000-0000-000000003102', '10000000-0000-0000-0000-000000003105');
update public.profiles set usage_mode = 'both', discover_visibility = 'everyone'
 where id = '10000000-0000-0000-0000-000000003106';
update public.profiles set discover_visibility = 'everyone' where id = '10000000-0000-0000-0000-000000003101';
update public.profiles set discover_visibility = 'signed_in', contact_website = 'https://carla.example'
 where id = '10000000-0000-0000-0000-000000003103';
update public.profiles set discover_visibility = 'nobody', contact_instagram = 'edu.secret'
 where id = '10000000-0000-0000-0000-000000003105';
update public.profiles
   set place_city = 'Lisbon', place_region = 'Lisboa', place_country = 'Portugal', place_lat = 38.72, place_lng = -9.14
 where id in ('10000000-0000-0000-0000-000000003101', '10000000-0000-0000-0000-000000003102',
              '10000000-0000-0000-0000-000000003103', '10000000-0000-0000-0000-000000003104',
              '10000000-0000-0000-0000-000000003106');
update public.profiles
   set place_city = 'Porto', place_region = 'Porto', place_country = 'Portugal', place_lat = 41.15, place_lng = -8.61
 where id = '10000000-0000-0000-0000-000000003105';

insert into public.groups (id, owner_id, name, timezone, is_discoverable, location,
                           place_city, place_region, place_country, place_lat, place_lng, contact_instagram)
values
  ('20000000-0000-0000-0000-000000003101', '10000000-0000-0000-0000-000000003102', 'Roda Lisboa', 'Europe/Lisbon', true,
   'Arroios', 'Lisbon', 'Lisboa', 'Portugal', 38.73, -9.13, 'rodalisboa'),
  ('20000000-0000-0000-0000-000000003102', '10000000-0000-0000-0000-000000003105', 'Roda Secreta', 'Europe/Lisbon', false,
   null, 'Porto', 'Porto', 'Portugal', 41.15, -8.61, null),
  ('20000000-0000-0000-0000-000000003103', '10000000-0000-0000-0000-000000003102', 'Roda Suva', 'Pacific/Fiji', true,
   null, 'Suva', 'Central', 'Fiji', -18.14, 178.44, null);
insert into public.group_memberships (group_id, profile_id, access_level) values
  ('20000000-0000-0000-0000-000000003101', '10000000-0000-0000-0000-000000003102', 'coach'),
  ('20000000-0000-0000-0000-000000003101', '10000000-0000-0000-0000-000000003101', 'member'),
  ('20000000-0000-0000-0000-000000003101', '10000000-0000-0000-0000-000000003104', 'member'),
  ('20000000-0000-0000-0000-000000003102', '10000000-0000-0000-0000-000000003105', 'coach'),
  ('20000000-0000-0000-0000-000000003103', '10000000-0000-0000-0000-000000003102', 'coach');

-- A signed-in viewer
reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003107');
select results_eq(
  $$ select kind, city, person_count, lat from public.discover_points(30, -20, 50, 10) where kind = 'city' $$,
  $$ values ('city'::text, 'Lisbon'::text, 3, 38.72::numeric) $$,
  'a signed-in person sees Everyone and Signed-in people, clustered per city at two decimals');
select results_eq(
  $$ select name from public.discover_points(30, -20, 50, 10) where kind = 'group' $$,
  $$ values ('Roda Lisboa'::text) $$,
  'only discoverable groups with a place are pinned');
select results_eq(
  $$ select name from public.discover_points(-30, 170, 0, -170) where kind = 'group' $$,
  $$ values ('Roda Suva'::text) $$,
  'a box across the antimeridian finds pins on its far side');
select throws_ok($$ select * from public.discover_points(50, -20, 30, 10) $$,
  'P0001', 'invalid_bounds', 'an inverted latitude range is refused');
select throws_ok($$ select * from public.discover_points(30, -200, 50, 10) $$,
  'P0001', 'invalid_bounds', 'longitudes stay within -180 to 180');
select results_eq(
  $$ select display_name from public.discover_city_people('Lisbon', 'Lisboa', 'Portugal') $$,
  $$ values ('Alice Everyone'::text), ('Bruno Teach'::text), ('Carla Signed'::text) $$,
  'a city lists only visible, finished profiles');
select is(public.discover_person('10000000-0000-0000-0000-000000003104'), null, 'a Train profile that never chose has no card');
select is(public.discover_person('10000000-0000-0000-0000-000000003105'), null, 'an explicit Nobody coach has no card');
select is(public.discover_person('10000000-0000-0000-0000-000000003106'), null, 'an unfinished profile has no card');
select is(public.discover_person('10000000-0000-0000-0000-000000003103') -> 'contacts' ->> 'website', 'https://carla.example',
  'contacts come with a visible card');
select is(public.discover_person('10000000-0000-0000-0000-000000003101') ->> 'visibility', null,
  'others never see the chosen visibility');
select is(public.discover_person('10000000-0000-0000-0000-000000003101') -> 'trains_in',
  jsonb_build_array(jsonb_build_object('group_id', '20000000-0000-0000-0000-000000003101', 'name', 'Roda Lisboa')),
  'a card lists the discoverable groups the person trains in');
select is(public.discover_person('10000000-0000-0000-0000-000000003102') -> 'teaches',
  jsonb_build_array(
    jsonb_build_object('group_id', '20000000-0000-0000-0000-000000003101', 'name', 'Roda Lisboa', 'role', 'owner'),
    jsonb_build_object('group_id', '20000000-0000-0000-0000-000000003103', 'name', 'Roda Suva', 'role', 'owner')),
  'a card lists the groups the person teaches');
select results_eq(
  $$ select kind, label, person_count from public.discover_search('lisb', 20) $$,
  $$ values ('city'::text, 'Lisbon'::text, 3), ('group'::text, 'Roda Lisboa'::text, null::integer) $$,
  'search finds the city with its visible count and the group');
select is((select count(*)::integer from public.discover_search('dora', 20)), 0, 'hidden people are not searchable');
select is((select count(*)::integer from public.discover_search('edu', 20)), 0, 'explicitly hidden coaches are not searchable');
select is((select count(*)::integer from public.discover_search('secreta', 20)), 0, 'undiscoverable groups are not searchable');
select is((select count(*)::integer from public.discover_search('a', 20)), 0, 'one-letter searches return nothing');
select is((select count(*)::integer from public.discover_search('%%', 20)), 0, 'wildcards match literally');
select is(public.discover_group('20000000-0000-0000-0000-000000003102'), null, 'an undiscoverable group has no card for outsiders');
select is(public.discover_group('20000000-0000-0000-0000-000000003101') -> 'coaches',
  jsonb_build_array(jsonb_build_object('profile_id', '10000000-0000-0000-0000-000000003102',
    'display_name', 'Bruno Teach', 'is_owner', true)),
  'a group card lists its visible coaches');
select is(public.discover_group('20000000-0000-0000-0000-000000003101') -> 'contacts' ->> 'instagram', 'rodalisboa',
  'a group card carries its contacts');
select is(public.discover_group('20000000-0000-0000-0000-000000003101') ->> 'my_status', null, 'an outsider has no status');
select public.request_group_access('20000000-0000-0000-0000-000000003101', 'member', null);
select is(public.discover_group('20000000-0000-0000-0000-000000003101') ->> 'my_status', 'pending',
  'a pending join request shows on the card');
select is((public.discover_group('20000000-0000-0000-0000-000000003101') ->> 'my_request_id')::uuid,
  (select id from public.group_join_requests where profile_id = '10000000-0000-0000-0000-000000003107'),
  'the card carries the pending request id for Cancel request');

-- A hidden person still sees themself
reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003104');
select is((select person_count from public.discover_points(30, -20, 50, 10) where kind = 'city' and city = 'Lisbon'), 4,
  'a hidden person is counted in their own view');
select is(public.discover_person('10000000-0000-0000-0000-000000003104') ->> 'visibility', 'nobody',
  'a person sees their own effective visibility');
select is((public.discover_person('10000000-0000-0000-0000-000000003104') ->> 'is_self')::boolean, true, 'the card knows it is mine');
select is(public.discover_group('20000000-0000-0000-0000-000000003101') ->> 'my_status', 'member', 'members see their status');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003105');
select isnt(public.discover_group('20000000-0000-0000-0000-000000003102'), null, 'members still open their undiscoverable group');
select is(public.discover_group('20000000-0000-0000-0000-000000003102') ->> 'my_status', 'owner', 'owners see their status');

-- Anonymous rules (no grant yet, so call the private functions as the test owner)
reset role;
select is((select person_count from private.discover_points(null, 30, -20, 50, 10) where kind = 'city'), 2,
  'anonymous viewers would see only Everyone profiles');
select is(private.discover_person(null, '10000000-0000-0000-0000-000000003103'), null,
  'anonymous viewers never see Signed-in profiles');
select isnt(private.discover_person(null, '10000000-0000-0000-0000-000000003102'), null,
  'anonymous viewers would see Everyone profiles');
select tests.set_actor(null, 'anon');
select throws_ok($$ select * from public.discover_points(30, -20, 50, 10) $$, '42501', null, 'anonymous callers cannot read points yet');
select throws_ok($$ select public.discover_person('10000000-0000-0000-0000-000000003102') $$, '42501', null, 'anonymous callers cannot read cards yet');
select throws_ok($$ select * from public.discover_search('lisb', 20) $$, '42501', null, 'anonymous callers cannot search yet');

-- Photos follow card visibility
reset role;
update public.profiles set avatar_path = '10000000-0000-0000-0000-000000003101/11111111-1111-4111-8111-111111111111.jpg'
 where id = '10000000-0000-0000-0000-000000003101';
update public.profiles set avatar_path = '10000000-0000-0000-0000-000000003104/22222222-2222-4222-8222-222222222222.jpg'
 where id = '10000000-0000-0000-0000-000000003104';
select ok(private.can_read_profile_picture('10000000-0000-0000-0000-000000003101/11111111-1111-4111-8111-111111111111.jpg',
  '10000000-0000-0000-0000-000000003107'), 'a visible card''s photo is readable');
select ok(not private.can_read_profile_picture('10000000-0000-0000-0000-000000003104/22222222-2222-4222-8222-222222222222.jpg',
  '10000000-0000-0000-0000-000000003107'), 'a hidden person''s photo stays private');

-- Limits
reset role;
select tests.create_user(('10000000-0000-0000-0000-0000000031' || n)::uuid, 'zeta' || n || '@example.test', 'Zeta ' || n)
  from generate_series(10, 34) n;
update public.profiles set completed_at = now(), usage_mode = 'teach' where display_name like 'Zeta %';
with created as (
  insert into public.groups (owner_id, name, timezone, place_city, place_lat, place_lng)
  select '10000000-0000-0000-0000-000000003102', 'Pin ' || n, 'UTC', 'Pin ' || n, round(-40 + n * 0.1, 2), 100
    from generate_series(1, 501) n
  returning id
)
insert into public.group_memberships (group_id, profile_id, access_level)
select id, '10000000-0000-0000-0000-000000003102', 'coach' from created;
select tests.set_actor('10000000-0000-0000-0000-000000003107');
select is((select count(*)::integer from public.discover_search('zeta', 500)), 20, 'search returns at most 20 rows');
select is((select count(*)::integer from public.discover_points(-90, -180, 90, 180)), 500, 'points return at most 500 rows');

reset role;
select * from finish();
rollback;
