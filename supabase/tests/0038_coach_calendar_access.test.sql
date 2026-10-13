-- supabase/tests/0038_coach_calendar_access.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select tests.create_user('10000000-0000-0000-0000-000000003801', 'owner38@example.test', 'Owner Trinta Oito');
select tests.create_user('10000000-0000-0000-0000-000000003802', 'coach38@example.test', 'Coach Trinta Oito');
select tests.create_user('10000000-0000-0000-0000-000000003803', 'ana38@example.test', 'Ana Trinta Oito');
insert into public.coach_profiles (profile_id) values
  ('10000000-0000-0000-0000-000000003801'), ('10000000-0000-0000-0000-000000003802');
insert into public.groups (id, owner_id, name, timezone)
values ('20000000-0000-0000-0000-000000003801', '10000000-0000-0000-0000-000000003801', 'Grupo Trinta Oito', 'Europe/Lisbon');
insert into public.group_memberships (group_id, profile_id, access_level) values
  ('20000000-0000-0000-0000-000000003801', '10000000-0000-0000-0000-000000003801', 'coach'),
  ('20000000-0000-0000-0000-000000003801', '10000000-0000-0000-0000-000000003802', 'coach'),
  ('20000000-0000-0000-0000-000000003801', '10000000-0000-0000-0000-000000003803', 'member');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003802');
select public.create_workout_plan(
  'Armada ladder', null, null, 60, null,
  '[{"source_text":"10x (armada, au)","movements":[{"movement_key":"armada","movement_name":"Armada","segment_key":"m:1"}]}]'::jsonb
) ->> 'plan_id' as plan_id \gset
select public.publish_workout_plan(:'plan_id') ->> 'version_id' as version_id \gset
select public.schedule_group_training(:'version_id', '20000000-0000-0000-0000-000000003801',
  '2026-11-10T18:00:00Z', '2026-11-10', 'Europe/Lisbon', true) ->> 'schedule_id' as schedule_id \gset
select is((select count(*)::integer from public.list_my_calendar('2026-11-01', '2026-12-01') where item_id = :'schedule_id'), 1,
  'an active coach sees the class they arranged');

reset role;
update public.group_memberships set state = 'removed', ended_at = now(), ended_by = '10000000-0000-0000-0000-000000003801'
 where group_id = '20000000-0000-0000-0000-000000003801' and profile_id = '10000000-0000-0000-0000-000000003802';

select tests.set_actor('10000000-0000-0000-0000-000000003802');
select is((select count(*)::integer from public.list_my_calendar('2026-11-01', '2026-12-01') where item_id = :'schedule_id'), 0,
  'a removed coach no longer sees a class they can no longer open');

reset role;
select * from finish();
rollback;
