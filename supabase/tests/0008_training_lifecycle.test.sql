\set ON_ERROR_STOP on
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED

select no_plan();

select has_function('public', 'create_workout_plan', array['text','text','uuid','integer','text','jsonb']);
select has_function('public', 'save_workout_plan_draft', array['uuid','text','text','integer','text','jsonb','timestamp with time zone']);
select has_function('public', 'publish_workout_plan', array['uuid']);
select has_function('public', 'list_workout_plans', array['uuid']);
select has_function('public', 'schedule_group_training', array['uuid','uuid','timestamp with time zone','date','text','boolean','uuid']);
select has_function('public', 'schedule_personal_class', array['uuid','uuid','uuid','uuid','timestamp with time zone','date','text','boolean','uuid']);
select has_function('public', 'cancel_scheduled_training', array['uuid','text']);
select has_function('public', 'record_alone_training', array['date','text','integer','text','jsonb','uuid','timestamp with time zone']);
select has_function('public', 'complete_group_training', array['uuid','jsonb','integer','uuid','jsonb','timestamp with time zone']);
select has_function('public', 'complete_personal_class', array['uuid','integer','uuid','jsonb','timestamp with time zone']);
select has_function('public', 'save_training_assessment', array['uuid','uuid','movement_difficulty','text']);
select has_function('public', 'save_training_notes', array['uuid','text']);
select has_function('public', 'add_training_feedback', array['uuid','uuid','uuid','text']);
select has_function('public', 'list_training_calendar', array['date','date','uuid']);
select has_function('public', 'get_training_day', array['date','uuid']);

select tests.create_user('10000000-0000-0000-0000-000000000301', 'coach3@example.test', 'Mestre Vida');
select tests.create_user('10000000-0000-0000-0000-000000000302', 'student3@example.test', 'Ana Mar');
select tests.create_user('10000000-0000-0000-0000-000000000303', 'member3@example.test', 'Bia Lua');
select tests.create_user('10000000-0000-0000-0000-000000000304', 'outsider3@example.test', 'Caio Sol');
select tests.create_user('10000000-0000-0000-0000-000000000305', 'directcoach3@example.test', 'Professora Céu');

insert into public.coach_profiles (profile_id)
values
  ('10000000-0000-0000-0000-000000000301'),
  ('10000000-0000-0000-0000-000000000305');
insert into public.groups (id, owner_id, name, timezone)
values (
  '20000000-0000-0000-0000-000000000301',
  '10000000-0000-0000-0000-000000000301',
  'Grupo Vida', 'Europe/Lisbon'
);
insert into public.group_memberships (group_id, profile_id, access_level)
values
  ('20000000-0000-0000-0000-000000000301', '10000000-0000-0000-0000-000000000301', 'coach'),
  ('20000000-0000-0000-0000-000000000301', '10000000-0000-0000-0000-000000000302', 'member'),
  ('20000000-0000-0000-0000-000000000301', '10000000-0000-0000-0000-000000000303', 'member');
insert into public.coach_student_connections (
  id, coach_profile_id, student_profile_id, state, initiated_by, decided_at, decided_by
) values
  (
    '40000000-0000-0000-0000-000000000301',
    '10000000-0000-0000-0000-000000000301',
    '10000000-0000-0000-0000-000000000302',
    'active', '10000000-0000-0000-0000-000000000302', now(),
    '10000000-0000-0000-0000-000000000301'
  ),
  (
    '40000000-0000-0000-0000-000000000302',
    '10000000-0000-0000-0000-000000000305',
    '10000000-0000-0000-0000-000000000302',
    'active', '10000000-0000-0000-0000-000000000302', now(),
    '10000000-0000-0000-0000-000000000305'
  );

select tests.set_actor('10000000-0000-0000-0000-000000000301');
select public.create_workout_plan(
  '  Armada control  ', '  Balance work  ',
  '20000000-0000-0000-0000-000000000301', 60, '  Move slowly  ',
  '[{"label":"Round one","repetitions":3,"rest_seconds":30,"movements":[{"movement_key":" Armada ","movement_name":"Armada","repetitions":10}]}]'::jsonb
) ->> 'plan_id' as plan_id \gset
select is(
  (select title from public.workout_plans where id = :'plan_id'),
  'Armada control', 'plan text is normalized'
);
select is(
  (select count(*)::integer
     from public.list_workout_plans('20000000-0000-0000-0000-000000000301')),
  1, 'the creating coach can list the draft'
);
select (select updated_at::text from public.workout_plans where id = :'plan_id') as plan_updated_at \gset
select is(
  public.save_workout_plan_draft(
    :'plan_id', 'Armada control', 'Balance work', 55, 'Move slowly',
    '[{"label":"Round one","movements":[{"movement_key":"armada","movement_name":"Armada","repetitions":8}]}]'::jsonb,
    :'plan_updated_at'::timestamptz
  ) ->> 'status',
  'saved', 'a current draft can be saved'
);
select throws_ok(
  format(
    'select public.save_workout_plan_draft(%L::uuid, %L, null, 55, null, %L::jsonb, %L::timestamptz)',
    :'plan_id', 'Stale overwrite', '[]', :'plan_updated_at'
  ),
  'P0001', 'edit_conflict', 'a stale draft edit is rejected'
);
select public.publish_workout_plan(:'plan_id') ->> 'version_id' as plan_version_id \gset
select is(
  (select state::text from public.workout_plans where id = :'plan_id'),
  'published', 'publishing changes the plan lifecycle'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
select throws_ok(
  format(
    'update public.workout_plan_movements set repetitions = 99 where plan_round_id in (select id from public.workout_plan_rounds where plan_version_id = %L::uuid)',
    :'plan_version_id'
  ),
  'P0001', 'published_plan_immutable', 'published content stays immutable'
);

select tests.set_actor('10000000-0000-0000-0000-000000000301');
select public.schedule_group_training(
  :'plan_version_id', '20000000-0000-0000-0000-000000000301',
  '2026-09-25T18:00:00Z', '2026-09-25', 'Europe/Lisbon', false
) ->> 'schedule_id' as group_schedule_id \gset
select public.schedule_group_training(
  :'plan_version_id', '20000000-0000-0000-0000-000000000301',
  '2026-09-26T18:00:00Z', '2026-09-26', 'Europe/Lisbon', true
) ->> 'schedule_id' as valid_group_schedule_id \gset
select public.schedule_group_training(
  :'plan_version_id', '20000000-0000-0000-0000-000000000301',
  '2026-09-27T18:00:00Z', '2026-09-27', 'Europe/Lisbon', true
) ->> 'schedule_id' as cancelled_group_schedule_id \gset
select is(
  public.cancel_scheduled_training(:'cancelled_group_schedule_id', '  Rain  ') ->> 'status',
  'cancelled', 'a coach can cancel a schedule'
);
select throws_ok(
  format(
    'select public.complete_group_training(%L::uuid, %L::jsonb, 60, %L::uuid)',
    :'cancelled_group_schedule_id',
    '[{"profile_id":"10000000-0000-0000-0000-000000000302","duration_minutes":60}]',
    '70000000-0000-0000-0000-000000000301'
  ),
  'P0001', 'cancelled_training', 'cancelled schedules cannot be completed'
);

select throws_ok(
  format(
    'select public.complete_group_training(%L::uuid, %L::jsonb, 60, %L::uuid)',
    :'group_schedule_id',
    '[{"profile_id":"10000000-0000-0000-0000-000000000302","duration_minutes":60},{"profile_id":"10000000-0000-0000-0000-000000000304","duration_minutes":60}]',
    '70000000-0000-0000-0000-000000000302'
  ),
  'P0001', 'invalid_attendee', 'one invalid attendee rejects the full completion'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
select is(
  (select count(*)::integer from public.training_occurrences where schedule_id = :'group_schedule_id'),
  0, 'failed group completion leaves no partial occurrence'
);

select tests.set_actor('10000000-0000-0000-0000-000000000301');
select public.complete_group_training(
  :'valid_group_schedule_id',
  '[{"profile_id":"10000000-0000-0000-0000-000000000302","duration_minutes":45},
    {"profile_id":"10000000-0000-0000-0000-000000000303","duration_minutes":60}]'::jsonb,
  60, '70000000-0000-0000-0000-000000000303'
) ->> 'occurrence_id' as group_occurrence_id \gset
select is(
  public.complete_group_training(
    :'valid_group_schedule_id',
    '[{"profile_id":"10000000-0000-0000-0000-000000000302","duration_minutes":45},
      {"profile_id":"10000000-0000-0000-0000-000000000303","duration_minutes":60}]'::jsonb,
    60, '70000000-0000-0000-0000-000000000303'
  ) ->> 'occurrence_id',
  :'group_occurrence_id', 'a completion retry returns the existing occurrence'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
select results_eq(
  format(
    'select profile_id, actual_duration_minutes from public.training_participations where occurrence_id = %L::uuid order by profile_id',
    :'group_occurrence_id'
  ),
  $$ values
       ('10000000-0000-0000-0000-000000000302'::uuid, 45),
       ('10000000-0000-0000-0000-000000000303'::uuid, 60) $$,
  'participant-specific duration overrides are preserved'
);

select tests.set_actor('10000000-0000-0000-0000-000000000302');
select public.record_alone_training(
  '2026-09-22', 'Europe/Lisbon', 40, '  Armada practice  ',
  '[{"label":"Practice","movements":[{"movement_key":"armada","movement_name":"Armada"}]}]'::jsonb,
  '70000000-0000-0000-0000-000000000304', '2026-09-22T18:00:00Z'
) ->> 'participation_id' as alone_participation_id \gset
select is(
  public.record_alone_training(
    '2026-09-22', 'Europe/Lisbon', 40, 'Armada practice',
    '[{"label":"Practice","movements":[{"movement_key":"armada","movement_name":"Armada"}]}]'::jsonb,
    '70000000-0000-0000-0000-000000000304', '2026-09-22T18:00:00Z'
  ) ->> 'participation_id',
  :'alone_participation_id', 'an Alone retry is idempotent'
);
select is(
  (select count(*)::integer from public.list_training_calendar(
    '2026-09-01', '2026-10-01', null
  )),
  3, 'personal calendar includes completed and upcoming training'
);
select (public.get_training_day('2026-09-22', null) #>> '{0,rounds,0,movements,0,id}') as occurrence_movement_id \gset
select is(
  public.save_training_notes(:'alone_participation_id', '  Felt smooth  ') ->> 'status',
  'saved', 'a practitioner can save personal notes'
);
select is(
  public.save_training_assessment(
    :'alone_participation_id', :'occurrence_movement_id', 'easy', '  Better today  '
  ) ->> 'status',
  'saved', 'a practitioner can assess their practiced movement'
);
select throws_ok(
  format(
    'select public.add_training_feedback(%L::uuid, %L::uuid, null, %L)',
    :'alone_participation_id',
    '20000000-0000-0000-0000-000000000301', 'Not a coach call'
  ),
  'PT403', 'not_authorized', 'a student cannot author coach feedback'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);

select tests.set_actor('10000000-0000-0000-0000-000000000301');
select is(
  public.add_training_feedback(
    :'alone_participation_id',
    '20000000-0000-0000-0000-000000000301', null, '  Keep your base stable.  '
  ) ->> 'status',
  'saved', 'a group coach can add context-scoped feedback'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);

select tests.set_actor('10000000-0000-0000-0000-000000000305');
select public.schedule_personal_class(
  :'plan_version_id', '10000000-0000-0000-0000-000000000302',
  null, '40000000-0000-0000-0000-000000000302',
  '2026-09-28T18:00:00Z', '2026-09-28', 'Europe/Lisbon', true
) ->> 'schedule_id' as personal_schedule_id \gset
select public.complete_personal_class(
  :'personal_schedule_id', 50,
  '70000000-0000-0000-0000-000000000305', null, '2026-09-28T18:00:00Z'
) ->> 'occurrence_id' as personal_occurrence_id \gset
select is(
  (select count(*)::integer from public.training_occurrences where id = :'personal_occurrence_id'),
  1, 'a connected coach completes a personal class'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);

update public.coach_student_connections
   set state = 'ended', ended_at = now(), ended_by = coach_profile_id
 where id = '40000000-0000-0000-0000-000000000302';
select tests.set_actor('10000000-0000-0000-0000-000000000305');
select throws_ok(
  $$ select * from public.list_training_calendar(
       '2026-09-01', '2026-10-01',
       '10000000-0000-0000-0000-000000000302'
     ) $$,
  'PT403', 'not_authorized', 'an ended direct relationship revokes direct history access'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);

select tests.set_actor('10000000-0000-0000-0000-000000000302');
select ok(
  (public.get_training_day('2026-09-22', null)::text like '%Keep your base stable%'),
  'the practitioner retains received feedback after a connection ends'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);

select * from finish();
rollback;
