-- supabase/tests/0035_resource_idempotency.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_column('public', 'training_resources', 'client_key', 'resources remember their client key');
select has_function('public', 'add_training_resource', array['uuid', 'text', 'text', 'text', 'text', 'uuid']);
select hasnt_function('public', 'add_training_resource', array['uuid', 'text', 'text', 'text', 'text']);

select tests.create_user('10000000-0000-0000-0000-000000003501', 'ana35@example.test', 'Ana Trinta Cinco');
select tests.create_user('10000000-0000-0000-0000-000000003502', 'bia35@example.test', 'Bia Trinta Cinco');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003501');
select public.record_alone_training('2026-10-01', 'Europe/Lisbon', 45, null,
  '[{"source_text":"ginga","movements":[{"movement_key":"ginga","movement_name":"Ginga","segment_key":"m:1"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000003501', '2026-10-01T08:00:00Z') ->> 'occurrence_id' as first_id \gset
select public.record_alone_training('2026-10-02', 'Europe/Lisbon', 45, null,
  '[{"source_text":"ginga","movements":[{"movement_key":"ginga","movement_name":"Ginga","segment_key":"m:1"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000003502', '2026-10-02T08:00:00Z') ->> 'occurrence_id' as second_id \gset

select public.add_training_resource(:'first_id', 'video', 'Recording', 'https://youtu.be/VAI3JUKTwz0', null,
  '60000000-0000-0000-0000-000000003501') ->> 'resource_id' as resource_id \gset
select is(
  public.add_training_resource(:'first_id', 'video', 'Recording', 'https://youtu.be/VAI3JUKTwz0', null,
    '60000000-0000-0000-0000-000000003501') ->> 'resource_id',
  :'resource_id', 'repeating a client key returns the first resource');
select is((select count(*)::integer from public.training_resources where occurrence_id = :'first_id'), 1,
  'the repeat adds nothing');
select throws_ok(
  format($$select public.add_training_resource(%L, 'video', null, 'https://youtu.be/x', null, '60000000-0000-0000-0000-000000003501')$$, :'second_id'),
  'P0001', 'idempotency_conflict', 'a client key cannot move to another training');
select public.add_training_resource(:'first_id', 'summary', null, null, '# Notes');
select is((select count(*)::integer from public.training_resources where occurrence_id = :'first_id'), 2,
  'calls without a key still add a resource');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003502');
select public.record_alone_training('2026-10-03', 'Europe/Lisbon', 30, null,
  '[{"source_text":"ginga","movements":[{"movement_key":"ginga","movement_name":"Ginga","segment_key":"m:1"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000003503', '2026-10-03T08:00:00Z') ->> 'occurrence_id' as bia_id \gset
select isnt(
  public.add_training_resource(:'bia_id', 'video', null, 'https://youtu.be/VAI3JUKTwz0', null,
    '60000000-0000-0000-0000-000000003501') ->> 'resource_id',
  :'resource_id', 'another person may use the same key value');

reset role;
select * from finish();
rollback;
