-- supabase/tests/0037_discover_search_cap.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select tests.create_user('10000000-0000-0000-0000-000000003701', 'owner37@example.test', 'Owner Trinta Sete');
select tests.create_user('10000000-0000-0000-0000-000000003702', 'viewer37@example.test', 'Viewer Trinta Sete');
insert into public.groups (id, owner_id, name, timezone, is_discoverable)
values ('20000000-0000-0000-0000-000000003701', '10000000-0000-0000-0000-000000003701',
        repeat('Lua', 33) || 'L', 'Europe/Lisbon', true);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003702');
select is(
  (select count(*)::integer from public.discover_search(repeat('Lua', 33) || 'L' || repeat(' and more words', 400), 20)
    where kind = 'group'),
  1, 'search reads only the first 100 characters, so a very long query still finds the group');
select is(
  (select count(*)::integer from public.discover_search(repeat('x', 100000), 20)), 0,
  'a huge query returns nothing instead of scanning with it');

reset role;
select * from finish();
rollback;
