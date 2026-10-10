-- supabase/tests/0013_training_resources.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select ok((select relrowsecurity from pg_class where oid = 'public.training_resources'::regclass), 'resources have RLS');

select tests.create_user('10000000-0000-0000-0000-000000001301', 'coach13@example.test', 'Mestre Treze');
select tests.create_user('10000000-0000-0000-0000-000000001302', 'ana13@example.test', 'Ana Treze');
select tests.create_user('10000000-0000-0000-0000-000000001303', 'bia13@example.test', 'Bia Treze');
select tests.create_user('10000000-0000-0000-0000-000000001304', 'out13@example.test', 'Caio Treze');
insert into public.coach_profiles (profile_id) values ('10000000-0000-0000-0000-000000001301');
insert into public.groups (id, owner_id, name, timezone)
values ('20000000-0000-0000-0000-000000001301', '10000000-0000-0000-0000-000000001301', 'Grupo Treze', 'Europe/Lisbon');
insert into public.group_memberships (group_id, profile_id, access_level) values
  ('20000000-0000-0000-0000-000000001301', '10000000-0000-0000-0000-000000001301', 'coach'),
  ('20000000-0000-0000-0000-000000001301', '10000000-0000-0000-0000-000000001302', 'member'),
  ('20000000-0000-0000-0000-000000001301', '10000000-0000-0000-0000-000000001303', 'member');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001301');
select throws_ok(
  $$select public.record_past_class('group', '20000000-0000-0000-0000-000000001301', null, null,
    now() + interval '1 day', current_date + 1, 'Europe/Lisbon', 60,
    '[{"profile_id":"10000000-0000-0000-0000-000000001302","duration_minutes":60}]'::jsonb,
    null, '50000000-0000-0000-0000-000000001301')$$,
  'P0001', 'past_class_in_future', 'past classes must be in the past'
);
select public.record_past_class('group', '20000000-0000-0000-0000-000000001301', null, null,
  '2026-09-11T13:14:14Z', '2026-09-11', 'Europe/Lisbon', 77,
  '[{"profile_id":"10000000-0000-0000-0000-000000001302","duration_minutes":77},
    {"profile_id":"10000000-0000-0000-0000-000000001303","duration_minutes":60}]'::jsonb,
  '[{"source_text":"ginga, armada","movements":[{"movement_key":"ginga","movement_name":"Ginga","segment_key":"m:1"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000001302') ->> 'occurrence_id' as occurrence_id \gset
select is(
  (select count(*)::integer from public.training_participations where occurrence_id = :'occurrence_id'),
  2, 'a past group class creates one participation per attendee'
);
select is(
  public.record_past_class('group', '20000000-0000-0000-0000-000000001301', null, null,
    '2026-09-11T13:14:14Z', '2026-09-11', 'Europe/Lisbon', 77,
    '[{"profile_id":"10000000-0000-0000-0000-000000001302","duration_minutes":77}]'::jsonb,
    null, '50000000-0000-0000-0000-000000001302') ->> 'occurrence_id',
  :'occurrence_id', 'retrying with the same key returns the same class'
);
select throws_ok(
  $$select public.record_past_class('group', '20000000-0000-0000-0000-000000001301', null, null,
    '2026-09-12T10:00:00Z', '2026-09-12', 'Europe/Lisbon', 60,
    '[{"profile_id":"10000000-0000-0000-0000-000000001304","duration_minutes":60}]'::jsonb,
    null, '50000000-0000-0000-0000-000000001303')$$,
  'P0001', 'invalid_attendee', 'attendees must be active members'
);

select public.add_training_resource(:'occurrence_id', 'video', 'Zoom recording', 'https://www.youtube.com/watch?v=oMmctHNRyBg', null)
  ->> 'resource_id' as video_id \gset
select public.add_training_resource(:'occurrence_id', 'summary', 'Summary', null, '# Class 1' || chr(10) || '- ginga');
select throws_ok(
  format($$select public.add_training_resource(%L, 'video', null, 'http://example.test', null)$$, :'occurrence_id'),
  '23514', null, 'video links must be https'
);
select throws_ok(
  format($$select public.add_training_resource(%L, 'voice', null, null, '')$$, :'occurrence_id'),
  '23514', null, 'transcripts need text'
);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001302');
select is(
  jsonb_array_length(public.get_training_day('2026-09-11', null) -> 0 -> 'resources'),
  2, 'attendees see the class resources'
);
select is(
  (public.get_training_day('2026-09-11', null) -> 0 ->> 'can_add_resources')::boolean,
  false, 'students cannot add resources to a coach class'
);
select throws_ok(
  format($$select public.add_training_resource(%L, 'summary', null, null, 'mine')$$, :'occurrence_id'),
  'PT403', 'not_authorized', 'students cannot add resources to a coach class'
);
select is(
  (select kinds from public.list_training_resource_kinds('2026-09-01', '2026-10-01', null)),
  array['summary', 'video']::text[], 'calendar receives resource kinds'
);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001304');
select is((select count(*)::integer from public.training_resources), 0, 'outsiders read no resources');
select throws_ok(
  format($$select public.delete_training_resource(%L)$$, :'video_id'),
  'PT403', 'not_authorized', 'outsiders cannot delete resources'
);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001302');
select public.record_alone_training('2026-10-04', 'UTC', 30, null,
  '[{"source_text":"ginga"}]'::jsonb, '50000000-0000-0000-0000-000000001304', '2026-10-04T09:00:00Z')
  ->> 'occurrence_id' as alone_id \gset
select is(
  public.add_training_resource(:'alone_id', 'voice', 'Voice memo', null, 'felt good') ->> 'status',
  'saved', 'practitioners add resources to their own Alone training'
);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001301');
select is(public.update_training_resource(:'video_id', 'Recording', 'https://youtu.be/oMmctHNRyBg', null) ->> 'status',
  'saved', 'authors edit their resources');
select is(public.delete_training_resource(:'video_id') ->> 'status', 'deleted', 'authors delete their resources');

reset role;
select * from finish();
rollback;
