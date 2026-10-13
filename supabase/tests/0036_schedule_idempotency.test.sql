-- supabase/tests/0036_schedule_idempotency.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_column('public', 'scheduled_trainings', 'idempotency_key', 'schedules remember their request key');
select has_function('public', 'schedule_group_training', array['uuid', 'uuid', 'timestamp with time zone', 'date', 'text', 'boolean', 'uuid']);
select has_function('public', 'schedule_personal_class', array['uuid', 'uuid', 'uuid', 'uuid', 'timestamp with time zone', 'date', 'text', 'boolean', 'uuid']);

select tests.create_user('10000000-0000-0000-0000-000000003601', 'coach36@example.test', 'Mestre Trinta Seis');
select tests.create_user('10000000-0000-0000-0000-000000003602', 'ana36@example.test', 'Ana Trinta Seis');
insert into public.coach_profiles (profile_id) values ('10000000-0000-0000-0000-000000003601');
insert into public.groups (id, owner_id, name, timezone)
values ('20000000-0000-0000-0000-000000003601', '10000000-0000-0000-0000-000000003601', 'Grupo Trinta Seis', 'Europe/Lisbon');
insert into public.group_memberships (group_id, profile_id, access_level) values
  ('20000000-0000-0000-0000-000000003601', '10000000-0000-0000-0000-000000003601', 'coach'),
  ('20000000-0000-0000-0000-000000003601', '10000000-0000-0000-0000-000000003602', 'member');
insert into public.coach_student_connections (
  id, coach_profile_id, student_profile_id, state, initiated_by, decided_at, decided_by
) values (
  '40000000-0000-0000-0000-000000003601', '10000000-0000-0000-0000-000000003601',
  '10000000-0000-0000-0000-000000003602', 'active', '10000000-0000-0000-0000-000000003602',
  now(), '10000000-0000-0000-0000-000000003601'
);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003601');
select public.create_workout_plan(
  'Armada ladder', null, null, 60, null,
  '[{"source_text":"10x (armada, au)","movements":[{"movement_key":"armada","movement_name":"Armada","segment_key":"m:1"}]}]'::jsonb
) ->> 'plan_id' as plan_id \gset
select public.publish_workout_plan(:'plan_id') ->> 'version_id' as version_id \gset

select public.schedule_group_training(:'version_id', '20000000-0000-0000-0000-000000003601',
  '2026-11-03T18:00:00Z', '2026-11-03', 'Europe/Lisbon', true, '70000000-0000-0000-0000-000000003601') ->> 'schedule_id' as first_id \gset
select is(
  public.schedule_group_training(:'version_id', '20000000-0000-0000-0000-000000003601',
    '2026-11-03T18:00:00Z', '2026-11-03', 'Europe/Lisbon', true, '70000000-0000-0000-0000-000000003601') ->> 'schedule_id',
  :'first_id', 'a retried group class returns the first class');
select is((select count(*)::integer from public.scheduled_trainings where arranged_by = '10000000-0000-0000-0000-000000003601'), 1,
  'the retry creates nothing');
select isnt(
  public.schedule_group_training(:'version_id', '20000000-0000-0000-0000-000000003601',
    '2026-11-04T18:00:00Z', '2026-11-04', 'Europe/Lisbon', true, '70000000-0000-0000-0000-000000003602') ->> 'schedule_id',
  :'first_id', 'a new key schedules a new class');
select public.schedule_group_training(:'version_id', '20000000-0000-0000-0000-000000003601',
  '2026-11-05T18:00:00Z', '2026-11-05', 'Europe/Lisbon', true);
select is((select count(*)::integer from public.scheduled_trainings where arranged_by = '10000000-0000-0000-0000-000000003601'), 3,
  'a call without a key still schedules');

select public.schedule_personal_class(:'version_id', '10000000-0000-0000-0000-000000003602', null,
  '40000000-0000-0000-0000-000000003601', '2026-11-06T18:00:00Z', '2026-11-06', 'Europe/Lisbon', true,
  '70000000-0000-0000-0000-000000003603') ->> 'schedule_id' as personal_id \gset
select is(
  public.schedule_personal_class(:'version_id', '10000000-0000-0000-0000-000000003602', null,
    '40000000-0000-0000-0000-000000003601', '2026-11-06T18:00:00Z', '2026-11-06', 'Europe/Lisbon', true,
    '70000000-0000-0000-0000-000000003603') ->> 'schedule_id',
  :'personal_id', 'a retried personal class returns the first class');

reset role;
select ok(
  not has_function_privilege('authenticated', 'private.remember_schedule_key(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.scheduled_once(uuid, uuid)', 'execute'),
  'the key helpers run only inside the scheduling functions'
);

select * from finish();
rollback;
