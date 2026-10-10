-- supabase/tests/0014_segment_statistics.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select tests.create_user('10000000-0000-0000-0000-000000001401', 'ana14@example.test', 'Ana Catorze');
reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001401');
select public.record_alone_training('2026-10-01', 'UTC', 30, null,
  '[{"source_text":"armada, au","movements":[
     {"movement_key":"armada","movement_name":"Armada","segment_key":"m:1"},
     {"movement_key":"au","movement_name":"Aú","segment_key":"m:2"}],
    "ratings":[{"segment_key":"r","segment_kind":"round","difficulty":"hard"},
               {"segment_key":"t:1>2","segment_kind":"transition","difficulty":"hard","from_movement_key":"armada","to_movement_key":"au"},
               {"segment_key":"m:2","segment_kind":"move","difficulty":"hard"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000001401', '2026-10-01T09:00:00Z');
select public.record_alone_training('2026-10-02', 'UTC', 30, null,
  '[{"source_text":"armada, au","movements":[
     {"movement_key":"armada","movement_name":"Armada","segment_key":"m:1"},
     {"movement_key":"au","movement_name":"Aú","segment_key":"m:2"}],
    "ratings":[{"segment_key":"t:1>2","segment_kind":"transition","difficulty":"okay","from_movement_key":"armada","to_movement_key":"au"},
               {"segment_key":"m:2","segment_kind":"move","difficulty":"easy"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000001402', '2026-10-02T09:00:00Z');

select public.get_personal_training_statistics('2026-10-01', '2026-11-01', 'UTC') as stats \gset
select is(
  (:'stats'::jsonb -> 'hardest_transitions' -> 0) - 'from_name' - 'to_name',
  '{"from_movement_key":"armada","to_movement_key":"au","hard_count":1,"rating_count":2}'::jsonb,
  'hardest transitions aggregate transition ratings'
);
select is(
  (select item ->> 'improving' from jsonb_array_elements(:'stats'::jsonb -> 'difficulty_trends') item
    where item ->> 'movement_key' = 'au'),
  'true', 'move segment ratings feed movement trends'
);
select is(
  (select count(*)::integer from jsonb_array_elements(:'stats'::jsonb -> 'difficulty_trends') item
    where item ->> 'movement_key' = 'armada'),
  0, 'round ratings never count as movement ratings'
);

reset role;
select * from finish();
rollback;
