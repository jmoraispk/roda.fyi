-- supabase/tests/0018_teaching_read_api.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_function('public', 'list_my_calendar', array['date', 'date']);
select has_function('public', 'get_scheduled_class', array['uuid']);

select tests.create_user('10000000-0000-0000-0000-000000001801', 'coach18@example.test', 'Mestre Dezoito');
select tests.create_user('10000000-0000-0000-0000-000000001802', 'ana18@example.test', 'Ana Dezoito');
select tests.create_user('10000000-0000-0000-0000-000000001803', 'bia18@example.test', 'Bia Dezoito');
select tests.create_user('10000000-0000-0000-0000-000000001804', 'caio18@example.test', 'Caio Dezoito');
insert into public.coach_profiles (profile_id) values ('10000000-0000-0000-0000-000000001801');
insert into public.groups (id, owner_id, name, timezone)
values ('20000000-0000-0000-0000-000000001801', '10000000-0000-0000-0000-000000001801', 'Grupo Dezoito', 'Europe/Lisbon');
insert into public.group_memberships (group_id, profile_id, access_level) values
  ('20000000-0000-0000-0000-000000001801', '10000000-0000-0000-0000-000000001801', 'coach'),
  ('20000000-0000-0000-0000-000000001801', '10000000-0000-0000-0000-000000001802', 'member'),
  ('20000000-0000-0000-0000-000000001801', '10000000-0000-0000-0000-000000001803', 'member');
insert into public.coach_student_connections (
  id, coach_profile_id, student_profile_id, state, initiated_by, decided_at, decided_by
) values (
  '40000000-0000-0000-0000-000000001801', '10000000-0000-0000-0000-000000001801',
  '10000000-0000-0000-0000-000000001802', 'active', '10000000-0000-0000-0000-000000001802',
  now(), '10000000-0000-0000-0000-000000001801'
);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001801');
select public.create_workout_plan(
  'Armada ladder', null, null, 60, 'Stay loose',
  '[{"source_text":"10x (armada, au)","movements":[{"movement_key":"armada","movement_name":"Armada","segment_key":"m:1"}]}]'::jsonb
) ->> 'plan_id' as plan_id \gset
select public.publish_workout_plan(:'plan_id') ->> 'version_id' as version_id \gset
select public.schedule_personal_class(
  :'version_id', '10000000-0000-0000-0000-000000001802', null, '40000000-0000-0000-0000-000000001801',
  '2026-10-20T18:00:00Z', '2026-10-20', 'Europe/Lisbon', true
) ->> 'schedule_id' as personal_id \gset
select public.schedule_group_training(
  :'version_id', '20000000-0000-0000-0000-000000001801',
  '2026-10-21T18:00:00Z', '2026-10-21', 'Europe/Lisbon', true
) ->> 'schedule_id' as group_schedule_id \gset
select public.record_past_class('group', '20000000-0000-0000-0000-000000001801', null, null,
  '2026-10-05T18:00:00Z', '2026-10-05', 'Europe/Lisbon', 60,
  '[{"profile_id":"10000000-0000-0000-0000-000000001802","duration_minutes":60}]'::jsonb,
  '[{"source_text":"ginga 10 min","movements":[{"movement_key":"ginga","movement_name":"Ginga","segment_key":"m:1"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000001801') ->> 'occurrence_id' as class_id \gset
select public.add_training_resource(:'class_id', 'video', 'Recording', 'https://youtu.be/VAI3JUKTwz0', null);

select is((select count(*)::integer from public.list_my_calendar('2026-10-01', '2026-11-01')), 3,
  'the coach sees the personal class, the group class, and the class they taught');
select is((select role from public.list_my_calendar('2026-10-01', '2026-11-01') where item_id = :'personal_id'),
  'coach', 'the personal class they arranged is listed as coaching');
select is((select count(*)::integer from public.list_my_calendar('2026-10-01', '2026-11-01') where item_id = :'group_schedule_id'),
  1, 'a group class appears once even though the coach is a member');
select is((select role from public.list_my_calendar('2026-10-01', '2026-11-01') where item_id = :'group_schedule_id'),
  'coach', 'the group class they arranged is listed as coaching');
select is((select plan_title from public.list_my_calendar('2026-10-01', '2026-11-01') where item_id = :'personal_id'),
  'Armada ladder', 'coaching items carry the plan title');
select is((select student_name from public.list_my_calendar('2026-10-01', '2026-11-01') where item_id = :'personal_id'),
  'Ana Dezoito', 'a personal class the coach teaches names its student');
select is((select item_type from public.list_my_calendar('2026-10-01', '2026-11-01') where item_id = :'class_id'),
  'completed', 'the taught class is a completed item');
select is((select resource_kinds from public.list_my_calendar('2026-10-01', '2026-11-01') where item_id = :'class_id'),
  '["video"]'::jsonb, 'taught classes list their resource kinds');
select is(public.get_scheduled_class(:'group_schedule_id') ->> 'plan_title', 'Armada ladder', 'the class page has the plan title');
select is(jsonb_array_length(public.get_scheduled_class(:'group_schedule_id') -> 'rounds'), 1, 'the plan rounds are included');
select is(jsonb_array_length(public.get_scheduled_class(:'group_schedule_id') -> 'people'), 2,
  'a group class lists its members but not the coach');
select is(public.get_scheduled_class(:'personal_id') -> 'people' -> 0 ->> 'display_name', 'Ana Dezoito',
  'a personal class lists its student');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001802');
select is((select count(*)::integer from public.list_my_calendar('2026-10-01', '2026-11-01')), 3,
  'the student sees their personal class, the group class, and the class they attended');
select is((select role from public.list_my_calendar('2026-10-01', '2026-11-01') where item_id = :'personal_id'),
  'participant', 'students see their classes as participants');
select is((select resource_kinds from public.list_my_calendar('2026-10-01', '2026-11-01') where item_id = :'class_id'),
  '["video"]'::jsonb, 'attended classes list their resource kinds');
select throws_ok(format($$select public.get_scheduled_class(%L)$$, :'group_schedule_id'), 'PT403', 'not_authorized',
  'students cannot open the coach''s class page');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001804');
select is((select count(*)::integer from public.list_my_calendar('2026-10-01', '2026-11-01')), 0, 'outsiders see nothing');
select throws_ok(format($$select public.get_scheduled_class(%L)$$, :'personal_id'), 'PT403', 'not_authorized',
  'outsiders cannot open a class page');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001801');
select public.cancel_scheduled_training(:'personal_id', null);
select is(public.get_scheduled_class(:'personal_id') ->> 'state', 'cancelled', 'a cancelled class reports its state');
select is((select count(*)::integer from public.list_my_calendar('2026-10-01', '2026-11-01') where item_id = :'personal_id'),
  0, 'cancelled classes leave the calendar');

reset role;
select tests.set_actor(null, 'anon');
select throws_ok($$select * from public.list_my_calendar('2026-10-01', '2026-11-01')$$, '42501', null, 'anonymous callers are refused');

reset role;
select * from finish();
rollback;
