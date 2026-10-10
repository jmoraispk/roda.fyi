-- supabase/tests/0012_catalog_curation.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select ok((select relrowsecurity from pg_class where oid = 'public.catalog_curators'::regclass), 'curators have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.catalog_term_mappings'::regclass), 'mappings have RLS');

select tests.create_user('10000000-0000-0000-0000-000000001201', 'curator12@example.test', 'Cura Doze');
select tests.create_user('10000000-0000-0000-0000-000000001202', 'ana12@example.test', 'Ana Doze');
select tests.create_user('10000000-0000-0000-0000-000000001203', 'bia12@example.test', 'Bia Doze');
insert into public.catalog_curators (profile_id) values ('10000000-0000-0000-0000-000000001201');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001202');
select public.record_alone_training('2026-10-02', 'UTC', 30, 'private note',
  '[{"source_text":"galopanti, armada","movements":[
     {"movement_key":"galopanti","movement_name":"Galopanti","catalogued":false,"segment_key":"m:1"},
     {"movement_key":"armada","movement_name":"Armada","segment_key":"m:2"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000001201', '2026-10-02T10:00:00Z');
reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001203');
select public.record_alone_training('2026-10-03', 'UTC', 30, null,
  '[{"source_text":"galopanti","movements":[
     {"movement_key":"galopanti","movement_name":"galopanti","catalogued":false,"segment_key":"m:1"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000001202', '2026-10-03T10:00:00Z');

select is(public.am_i_catalog_curator(), false, 'ordinary users are not curators');
select throws_ok($$select * from public.list_uncatalogued_terms()$$, 'PT403', 'not_authorized',
  'non-curators cannot list terms');
select throws_ok($$select public.map_catalog_term('galopanti', 'galopante')$$, 'PT403', 'not_authorized',
  'non-curators cannot map');
select throws_ok($$insert into public.catalog_term_mappings (term, action) values ('x', 'ignore')$$,
  '42501', null, 'clients cannot write mappings directly');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001201');
select is(public.am_i_catalog_curator(), true, 'the curator is recognized');
select results_eq(
  $$select term, people, uses from public.list_uncatalogued_terms()$$,
  $$values ('galopanti'::text, 2::bigint, 2::bigint)$$,
  'terms are aggregated across people without names or notes'
);
select throws_ok($$select public.map_catalog_term('Galopanti!', 'galopante')$$, 'P0001', 'invalid_term',
  'terms must be slugs');
select is(public.map_catalog_term('galopanti', 'galopante') ->> 'relinked', '2',
  'mapping re-links completed history');
reset role;
select set_eq(
  $$select movement_key, catalogued, movement_name_snapshot from public.training_occurrence_movements
     where segment_key = 'm:1'$$,
  $$values ('galopante'::text, true, 'Galopanti'::text), ('galopante'::text, true, 'galopanti'::text)$$,
  'relinked rows keep their written names'
);
select throws_ok(
  $$update public.training_occurrence_movements set movement_key = 'armada' where segment_key = 'm:1'$$,
  'P0001', 'completed_training_immutable', 'ordinary updates of completed rows still fail'
);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001201');
select is((select count(*)::integer from public.list_uncatalogued_terms()), 0, 'mapped terms leave the list');
select is(public.ignore_catalog_term('stretching') ->> 'status', 'saved', 'curator ignores a term');
select is(public.set_catalog_term_needs_video('galopante', true) ->> 'status', 'saved', 'curator tags a term');

reset role;
select tests.set_actor(null, 'anon');
select is(
  (select count(*)::integer from public.catalog_term_mappings),
  3, 'anonymous visitors can read mappings for the parser'
);

reset role;
select * from finish();
rollback;
