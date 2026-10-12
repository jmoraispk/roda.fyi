-- supabase/tests/0016_app_read_api.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_function('public', 'list_recent_trainings', array['integer']);
select has_function('public', 'get_training', array['uuid']);

select tests.create_user('10000000-0000-0000-0000-000000001601', 'coach16@example.test', 'Mestre Dezasseis');
select tests.create_user('10000000-0000-0000-0000-000000001602', 'ana16@example.test', 'Ana Dezasseis');
select tests.create_user('10000000-0000-0000-0000-000000001603', 'bia16@example.test', 'Bia Dezasseis');
select tests.create_user('10000000-0000-0000-0000-000000001604', 'out16@example.test', 'Caio Dezasseis');
insert into public.coach_profiles (profile_id) values ('10000000-0000-0000-0000-000000001601');
insert into public.groups (id, owner_id, name, timezone)
values ('20000000-0000-0000-0000-000000001601', '10000000-0000-0000-0000-000000001601', 'Grupo Dezasseis', 'Europe/Lisbon');
insert into public.group_memberships (group_id, profile_id, access_level) values
  ('20000000-0000-0000-0000-000000001601', '10000000-0000-0000-0000-000000001601', 'coach'),
  ('20000000-0000-0000-0000-000000001601', '10000000-0000-0000-0000-000000001602', 'member'),
  ('20000000-0000-0000-0000-000000001601', '10000000-0000-0000-0000-000000001603', 'member');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001601');
select public.record_past_class('group', '20000000-0000-0000-0000-000000001601', null, null,
  '2026-09-26T13:19:30Z', '2026-09-26', 'Europe/Lisbon', 56,
  '[{"profile_id":"10000000-0000-0000-0000-000000001602","duration_minutes":56}]'::jsonb,
  '[{"source_text":"ginga 10 min, 10x (armada, au)","movements":[{"movement_key":"ginga","movement_name":"Ginga","segment_key":"m:1"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000001601') ->> 'occurrence_id' as class_id \gset
select public.add_training_resource(:'class_id', 'video', 'Recording', 'https://youtu.be/VAI3JUKTwz0', null);
select is((public.list_recent_trainings(10) -> 0 ->> 'role'), 'coach', 'the coach sees the class they taught');
select is((public.get_training(:'class_id') ->> 'attendee_count')::integer, 1, 'the coach sees the attendee count');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001602');
select public.record_alone_training('2026-09-27', 'Europe/Lisbon', 45, 'Knees ok',
  ('[{"source_text":"' || repeat('armada, ', 30) || 'au","movements":[{"movement_key":"armada","movement_name":"Armada","segment_key":"m:1"}],
     "ratings":[{"segment_key":"r","segment_kind":"round","difficulty":"okay"}]}]')::jsonb,
  '50000000-0000-0000-0000-000000001602', '2026-09-27T08:00:00Z') ->> 'occurrence_id' as alone_id \gset
select is(jsonb_array_length(public.list_recent_trainings(10)), 2, 'the attendee sees the class and their own training');
select is(public.list_recent_trainings(10) -> 0 ->> 'occurrence_id', :'alone_id', 'newest first');
select is(public.list_recent_trainings(10) -> 0 ->> 'felt', 'okay', 'round rating appears as felt');
select is(public.list_recent_trainings(10) -> 1 -> 'resource_kinds', '["video"]'::jsonb, 'resource kinds are listed');
select is(public.list_recent_trainings(10) -> 1 ->> 'first_round_text', 'ginga 10 min, 10x (armada, au)', 'first round text is returned');
select is(jsonb_array_length(public.list_recent_trainings(1)), 1, 'the limit is applied');
select is(public.get_training(:'class_id') ->> 'role', 'participant', 'an attendee views as participant');
select is(public.get_training(:'class_id') -> 'participation' ->> 'duration_minutes', '56', 'participation duration is returned');
select is(jsonb_array_length(public.get_training(:'class_id') -> 'resources'), 1, 'resources are returned');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001603');
select throws_ok(format($$select public.get_training(%L)$$, :'class_id'), 'PT403', 'not_authorized',
  'a group member who did not attend cannot open the class');
select is(jsonb_array_length(public.list_recent_trainings(10)), 0, 'no unrelated trainings are listed');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001604');
select throws_ok(format($$select public.get_training(%L)$$, :'alone_id'), 'PT403', 'not_authorized',
  'outsiders cannot open a training');

reset role;
select tests.set_actor(null, 'anon');
select throws_ok($$select public.list_recent_trainings(10)$$, '42501', null, 'anonymous callers are refused');

reset role;
select * from finish();
rollback;
