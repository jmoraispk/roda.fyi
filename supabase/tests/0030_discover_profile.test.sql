-- supabase/tests/0030_discover_profile.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_column('public', 'profiles', 'discover_visibility', 'profiles have a Discover visibility');
select has_column('public', 'profiles', 'contact_whatsapp', 'profiles have a WhatsApp contact');
select col_type_is('public', 'profiles', 'place_lat', 'numeric(5,2)', 'latitude keeps two decimals');
select col_type_is('public', 'groups', 'place_lng', 'numeric(5,2)', 'group longitude keeps two decimals');
select has_column('public', 'groups', 'contact_website', 'groups have a website contact');
select hasnt_column('public', 'groups', 'contact_whatsapp', 'groups have no WhatsApp contact');
select has_function('public', 'update_discover_profile',
  array['text', 'text', 'text', 'text', 'numeric', 'numeric', 'text', 'text', 'text', 'text']);
select has_function('public', 'update_group_discover',
  array['uuid', 'text', 'text', 'text', 'numeric', 'numeric', 'text', 'text', 'text']);

select results_eq(
  $$ select private.discover_effective_visibility(choice, mode)
       from (values (null::text, 'train'::text, 1), (null, 'both', 2), (null, 'teach', 3),
                    ('signed_in', 'teach', 4), ('everyone', 'train', 5)) given(choice, mode, position)
      order by position $$,
  $$ values ('nobody'::text), ('everyone'::text), ('everyone'::text), ('signed_in'::text), ('everyone'::text) $$,
  'an unchosen visibility follows the mode; a chosen one wins');
select results_eq(
  $$ select private.discover_can_see(actor, target, choice, 'train', finished)
       from (values
         ('10000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000002'::uuid, 'everyone'::text, now(), 1),
         (null, '10000000-0000-0000-0000-000000000002', 'everyone', now(), 2),
         (null, '10000000-0000-0000-0000-000000000002', 'signed_in', now(), 3),
         ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'signed_in', now(), 4),
         ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', null, now(), 5),
         ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'nobody', null, 6),
         ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'everyone', null, 7)
       ) given(actor, target, choice, finished, position)
      order by position $$,
  $$ values (true), (true), (false), (true), (false), (true), (false) $$,
  'the visibility table: everyone, anonymous, signed in, train default, self, unfinished');

select tests.create_user('10000000-0000-0000-0000-000000003001', 'ana30@example.test', 'Ana Trinta');
select tests.create_user('10000000-0000-0000-0000-000000003002', 'owner30@example.test', 'Mestre Trinta');
select tests.create_user('10000000-0000-0000-0000-000000003003', 'coach30@example.test', 'Coach Trinta');
select tests.create_user('10000000-0000-0000-0000-000000003004', 'bia30@example.test', 'Bia Trinta');
insert into public.coach_profiles (profile_id) values
  ('10000000-0000-0000-0000-000000003002'), ('10000000-0000-0000-0000-000000003003');
insert into public.groups (id, owner_id, name, timezone)
values ('20000000-0000-0000-0000-000000003001', '10000000-0000-0000-0000-000000003002', 'Grupo Trinta', 'Europe/Lisbon');
insert into public.group_memberships (group_id, profile_id, access_level) values
  ('20000000-0000-0000-0000-000000003001', '10000000-0000-0000-0000-000000003002', 'coach'),
  ('20000000-0000-0000-0000-000000003001', '10000000-0000-0000-0000-000000003003', 'coach'),
  ('20000000-0000-0000-0000-000000003001', '10000000-0000-0000-0000-000000003004', 'member');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003001');
select is(public.update_discover_profile('nobody', '  Lisbon ', 'Lisbon', 'Portugal', 38.7169, -9.1399,
  '@ana.silva', 'https://ana.example', '+351 912 345 678', ' ana@example.test ') ->> 'status', 'updated',
  'a person saves their Discover settings');
select results_eq(
  $$ select discover_visibility, place_city, place_lat, place_lng, contact_instagram, contact_email
       from public.profiles where id = '10000000-0000-0000-0000-000000003001' $$,
  $$ values ('nobody'::text, 'Lisbon'::text, 38.72::numeric, -9.14::numeric, 'ana.silva'::text, 'ana@example.test'::text) $$,
  'text is trimmed, coordinates are rounded to two decimals, and @ is dropped');
select public.update_discover_profile(null, null, null, null, null, null, '', null, null, null);
select results_eq(
  $$ select discover_visibility, place_city, place_lat, contact_instagram, contact_website
       from public.profiles where id = '10000000-0000-0000-0000-000000003001' $$,
  $$ values (null::text, null::text, null::numeric, null::text, null::text) $$,
  'saving empty values returns to the mode default and clears place and contacts');
select throws_ok($$ select public.update_discover_profile('friends', null, null, null, null, null, null, null, null, null) $$,
  'P0001', 'invalid_visibility', 'an unknown visibility is refused');
select throws_ok($$ select public.update_discover_profile(null, 'Lisbon', null, null, 38.7, null, null, null, null, null) $$,
  'P0001', 'invalid_place', 'a latitude needs a longitude');
select throws_ok($$ select public.update_discover_profile(null, null, null, null, 38.7, -9.1, null, null, null, null) $$,
  'P0001', 'invalid_place', 'coordinates need a city');
select throws_ok($$ select public.update_discover_profile(null, 'Nowhere', null, null, 91, 0, null, null, null, null) $$,
  'P0001', 'invalid_place', 'latitude stays within -90 to 90');
select throws_ok($$ select public.update_discover_profile(null, 'Nowhere', null, null, 0, 180.5, null, null, null, null) $$,
  'P0001', 'invalid_place', 'longitude stays within -180 to 180');
select throws_ok($$ select public.update_discover_profile(null, repeat('a', 121), null, null, 0, 0, null, null, null, null) $$,
  'P0001', 'invalid_place', 'city names are at most 120 characters');
select throws_ok($$ select public.update_discover_profile(null, null, null, null, null, null, 'ana silva', null, null, null) $$,
  'P0001', 'invalid_instagram', 'Instagram handles have no spaces');
select throws_ok($$ select public.update_discover_profile(null, null, null, null, null, null, null, 'http://ana.example', null, null) $$,
  'P0001', 'invalid_website', 'websites must use https');
select throws_ok($$ select public.update_discover_profile(null, null, null, null, null, null, null, 'javascript:alert(1)', null, null) $$,
  'P0001', 'invalid_website', 'script links are refused');
select throws_ok($$ select public.update_discover_profile(null, null, null, null, null, null, null, null, '12345', null) $$,
  'P0001', 'invalid_whatsapp', 'WhatsApp numbers have at least six digits');
select throws_ok($$ select public.update_discover_profile(null, null, null, null, null, null, null, null, null, 'ana@example') $$,
  'P0001', 'invalid_email', 'emails need a domain with a dot');
select throws_ok(
  $$ update public.profiles set discover_visibility = 'everyone' where id = '10000000-0000-0000-0000-000000003001' $$,
  '42501', null, 'people cannot write Discover columns directly');

reset role;
select throws_ok($$ update public.profiles set contact_website = 'http://x.example' where id = '10000000-0000-0000-0000-000000003001' $$,
  '23514', null, 'the website constraint holds without the function');
select throws_ok($$ update public.profiles set place_lat = 10 where id = '10000000-0000-0000-0000-000000003001' $$,
  '23514', null, 'a latitude alone breaks the place constraints');
select throws_ok($$ update public.profiles set discover_visibility = 'friends' where id = '10000000-0000-0000-0000-000000003001' $$,
  '23514', null, 'the visibility constraint holds without the function');
select throws_ok($$ update public.profiles set contact_instagram = 'has space' where id = '10000000-0000-0000-0000-000000003001' $$,
  '23514', null, 'the Instagram constraint holds without the function');
select throws_ok($$ update public.profiles set contact_whatsapp = 'call me' where id = '10000000-0000-0000-0000-000000003001' $$,
  '23514', null, 'the WhatsApp constraint holds without the function');
select throws_ok($$ update public.profiles set contact_email = 'nobody' where id = '10000000-0000-0000-0000-000000003001' $$,
  '23514', null, 'the email constraint holds without the function');
select throws_ok($$ update public.groups set place_city = 'Far', place_lat = 0, place_lng = 200 where id = '20000000-0000-0000-0000-000000003001' $$,
  '23514', null, 'group longitudes stay within -180 to 180');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003002');
select is(public.update_group_discover('20000000-0000-0000-0000-000000003001', 'Lisbon', 'Lisbon', 'Portugal',
  38.7223, -9.1393, '@grupotrinta', 'https://trinta.example', 'ola@trinta.example') ->> 'status', 'updated',
  'the owner sets the group place and contacts');
select results_eq(
  $$ select place_city, place_lat, place_lng, contact_instagram, location
       from public.groups where id = '20000000-0000-0000-0000-000000003001' $$,
  $$ values ('Lisbon'::text, 38.72::numeric, -9.14::numeric, 'grupotrinta'::text, null::text) $$,
  'the group place is rounded and the location label is untouched');
select throws_ok($$ select public.update_group_discover('20000000-0000-0000-0000-000000003001', null, null, null, null, null, null, 'ftp://x', null) $$,
  'P0001', 'invalid_website', 'group websites must use https');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003003');
select throws_ok($$ select public.update_group_discover('20000000-0000-0000-0000-000000003001', null, null, null, null, null, null, null, null) $$,
  'PT403', 'not_authorized', 'a coach who is not the owner cannot change the group place');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003004');
select throws_ok($$ select public.update_group_discover('20000000-0000-0000-0000-000000003001', null, null, null, null, null, null, null, null) $$,
  'PT403', 'not_authorized', 'a member cannot change the group place');

reset role;
select tests.set_actor(null, 'anon');
select throws_ok($$ select public.update_discover_profile(null, null, null, null, null, null, null, null, null, null) $$,
  '42501', null, 'anonymous callers cannot save Discover settings');
select throws_ok($$ select public.update_group_discover('20000000-0000-0000-0000-000000003001', null, null, null, null, null, null, null, null) $$,
  '42501', null, 'anonymous callers cannot change groups');

reset role;
select * from finish();
rollback;
