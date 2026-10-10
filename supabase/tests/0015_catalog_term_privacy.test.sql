\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select tests.create_user('10000000-0000-0000-0000-000000001501', 'curator15@example.test', 'Cura Quinze');
select tests.create_user('10000000-0000-0000-0000-000000001502', 'ana15@example.test', 'Ana Quinze');
insert into public.catalog_curators (profile_id) values ('10000000-0000-0000-0000-000000001501');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001502');
select public.record_alone_training('2026-10-05', 'UTC', 30, null,
  '[{"source_text":"galopanti, felt dizzy after the fight with my brother","movements":[
     {"movement_key":"galopanti","movement_name":"galopanti","catalogued":false,"segment_key":"m:1"},
     {"movement_key":"felt-dizzy-after-the-fight-with-my-brother","movement_name":"felt dizzy after the fight with my brother","catalogued":false,"segment_key":"m:2"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000001501', '2026-10-05T10:00:00Z');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001501');
select set_eq(
  $$select term from public.list_uncatalogued_terms()$$,
  $$values ('galopanti'::text)$$,
  'sentence-like fragments of private notes are not listed to curators'
);

reset role;
select * from finish();
rollback;
