\set ON_ERROR_STOP on
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED

select no_plan();

select has_type('public', 'workout_plan_state', 'workout plan state exists');
select has_type('public', 'scheduled_training_kind', 'scheduled training kind exists');
select has_type('public', 'scheduled_training_state', 'scheduled training state exists');
select has_type('public', 'training_kind', 'training kind exists');
select has_type('public', 'movement_difficulty', 'movement difficulty exists');

select has_table('public', 'workout_plans', 'workout plans exist');
select has_table('public', 'workout_plan_versions', 'workout plan versions exist');
select has_table('public', 'workout_plan_rounds', 'workout plan rounds exist');
select has_table('public', 'workout_plan_movements', 'workout plan movements exist');
select has_table('public', 'scheduled_trainings', 'scheduled trainings exist');
select has_table('public', 'training_occurrences', 'training occurrences exist');
select has_table('public', 'training_occurrence_rounds', 'occurrence rounds exist');
select has_table('public', 'training_occurrence_movements', 'occurrence movements exist');
select has_table('public', 'training_participations', 'training participation exists');
select has_table('public', 'training_movement_assessments', 'movement assessments exist');
select has_table('public', 'training_feedback', 'training feedback exists');

select col_is_fk('public', 'training_participations', 'profile_id', 'participation belongs to a profile');
select has_function('private', 'can_read_training', array['uuid', 'uuid']);
select has_function('private', 'can_manage_schedule', array['uuid', 'uuid']);
select has_function('private', 'can_write_training_feedback', array['uuid', 'uuid', 'uuid', 'uuid']);

select tests.create_user('10000000-0000-0000-0000-000000000201', 'coach@example.test', 'Mestre Lua');
select tests.create_user('10000000-0000-0000-0000-000000000202', 'student@example.test', 'Ana Sol');
select tests.create_user('10000000-0000-0000-0000-000000000203', 'groupcoach@example.test', 'Professora Mar');
select tests.create_user('10000000-0000-0000-0000-000000000204', 'peer@example.test', 'Bia Terra');
select tests.create_user('10000000-0000-0000-0000-000000000205', 'outsider@example.test', 'Caio Vento');
select tests.create_user('10000000-0000-0000-0000-000000000206', 'parent@example.test', 'Mestre Regional');
select tests.create_user('10000000-0000-0000-0000-000000000207', 'ancestor@example.test', 'Mestre Global');

insert into public.coach_profiles (profile_id)
values
  ('10000000-0000-0000-0000-000000000201'),
  ('10000000-0000-0000-0000-000000000203'),
  ('10000000-0000-0000-0000-000000000206'),
  ('10000000-0000-0000-0000-000000000207');

insert into public.groups (id, owner_id, name, timezone)
values
  ('20000000-0000-0000-0000-000000000201', '10000000-0000-0000-0000-000000000203', 'Grupo Local', 'Europe/Lisbon'),
  ('20000000-0000-0000-0000-000000000202', '10000000-0000-0000-0000-000000000206', 'Grupo Regional', 'Europe/Lisbon'),
  ('20000000-0000-0000-0000-000000000203', '10000000-0000-0000-0000-000000000207', 'Grupo Global', 'Europe/Lisbon');

insert into public.group_memberships (group_id, profile_id, access_level)
values
  ('20000000-0000-0000-0000-000000000201', '10000000-0000-0000-0000-000000000203', 'coach'),
  ('20000000-0000-0000-0000-000000000201', '10000000-0000-0000-0000-000000000202', 'member'),
  ('20000000-0000-0000-0000-000000000201', '10000000-0000-0000-0000-000000000204', 'member'),
  ('20000000-0000-0000-0000-000000000202', '10000000-0000-0000-0000-000000000206', 'coach'),
  ('20000000-0000-0000-0000-000000000203', '10000000-0000-0000-0000-000000000207', 'coach');

insert into public.group_relationships (
  id, parent_group_id, child_group_id, state, sharing_level,
  invited_by, decided_at, decided_by
) values
  (
    '30000000-0000-0000-0000-000000000201',
    '20000000-0000-0000-0000-000000000202',
    '20000000-0000-0000-0000-000000000201',
    'active', 'full_coaching',
    '10000000-0000-0000-0000-000000000206', now(),
    '10000000-0000-0000-0000-000000000203'
  ),
  (
    '30000000-0000-0000-0000-000000000202',
    '20000000-0000-0000-0000-000000000203',
    '20000000-0000-0000-0000-000000000202',
    'active', 'full_coaching',
    '10000000-0000-0000-0000-000000000207', now(),
    '10000000-0000-0000-0000-000000000206'
  );

insert into public.coach_student_connections (
  id, coach_profile_id, student_profile_id, state, initiated_by, decided_at, decided_by
) values (
  '40000000-0000-0000-0000-000000000201',
  '10000000-0000-0000-0000-000000000201',
  '10000000-0000-0000-0000-000000000202',
  'active', '10000000-0000-0000-0000-000000000202', now(),
  '10000000-0000-0000-0000-000000000201'
);

insert into public.workout_plans (
  id, creator_profile_id, source_group_id, title, description
) values (
  '50000000-0000-0000-0000-000000000201',
  '10000000-0000-0000-0000-000000000203',
  '20000000-0000-0000-0000-000000000201',
  'Armada foundations', 'Balance and control'
);
insert into public.workout_plan_versions (
  id, plan_id, version_number, expected_duration_minutes, instructions
) values (
  '51000000-0000-0000-0000-000000000201',
  '50000000-0000-0000-0000-000000000201', 1, 60, 'Move with control'
);
insert into public.workout_plan_rounds (
  id, plan_version_id, position, label, repetitions, rest_seconds
) values (
  '52000000-0000-0000-0000-000000000201',
  '51000000-0000-0000-0000-000000000201', 1, 'Round one', 3, 30
);
insert into public.workout_plan_movements (
  id, plan_round_id, position, movement_key, movement_name_snapshot, repetitions
) values (
  '53000000-0000-0000-0000-000000000201',
  '52000000-0000-0000-0000-000000000201', 1,
  ' Armada  ', 'Armada', 10
);

select is(
  (select movement_key from public.workout_plan_movements where id = '53000000-0000-0000-0000-000000000201'),
  'armada',
  'movement keys are normalized'
);

select throws_ok(
  $$ insert into public.scheduled_trainings (
       kind, plan_version_id, arranged_by, student_profile_id,
       starts_at, local_date, timezone
     ) values (
       'group', '51000000-0000-0000-0000-000000000201',
       '10000000-0000-0000-0000-000000000203',
       '10000000-0000-0000-0000-000000000202',
       now(), current_date, 'UTC'
     ) $$,
  '23514', null, 'group schedule requires group and forbids individual target'
);

select throws_ok(
  $$ insert into public.scheduled_trainings (
       kind, plan_version_id, arranged_by, student_profile_id, connection_id,
       starts_at, local_date, timezone
     ) values (
       'personal_class', '51000000-0000-0000-0000-000000000201',
       '10000000-0000-0000-0000-000000000201',
       '10000000-0000-0000-0000-000000000202',
       '40000000-0000-0000-0000-000000000201',
       now(), current_date, 'Mars/Olympus'
     ) $$,
  'P0001', 'invalid_timezone', 'schedule timezone must be a valid IANA name'
);

update public.workout_plan_versions
   set published_at = now(), published_by = '10000000-0000-0000-0000-000000000203'
 where id = '51000000-0000-0000-0000-000000000201';
select throws_ok(
  $$ update public.workout_plan_movements set repetitions = 20
      where id = '53000000-0000-0000-0000-000000000201' $$,
  'P0001', 'published_plan_immutable', 'published plan children are immutable'
);

insert into public.training_occurrences (
  id, kind, group_id, recorded_by, occurred_at, local_date, timezone,
  default_duration_minutes, idempotency_key
) values (
  '60000000-0000-0000-0000-000000000201', 'group',
  '20000000-0000-0000-0000-000000000201',
  '10000000-0000-0000-0000-000000000203', now(), current_date,
  'Europe/Lisbon', 60, '61000000-0000-0000-0000-000000000201'
);
insert into public.training_occurrence_rounds (
  id, occurrence_id, position, label
) values (
  '62000000-0000-0000-0000-000000000201',
  '60000000-0000-0000-0000-000000000201', 1, 'Actual round'
);
insert into public.training_occurrence_movements (
  id, occurrence_round_id, position, movement_key, movement_name_snapshot
) values (
  '63000000-0000-0000-0000-000000000201',
  '62000000-0000-0000-0000-000000000201', 1, 'Meia Lua', 'Meia Lua'
);
insert into public.training_participations (
  id, occurrence_id, profile_id, actual_duration_minutes,
  confirmed_at, confirmed_by
) values (
  '64000000-0000-0000-0000-000000000201',
  '60000000-0000-0000-0000-000000000201',
  '10000000-0000-0000-0000-000000000202', 55, now(),
  '10000000-0000-0000-0000-000000000203'
);

select throws_ok(
  $$ update public.training_occurrence_movements set movement_name_snapshot = 'Changed'
      where id = '63000000-0000-0000-0000-000000000201' $$,
  'P0001', 'completed_training_immutable', 'completed occurrence snapshots are immutable'
);
select throws_ok(
  $$ insert into public.training_participations (
       occurrence_id, profile_id, actual_duration_minutes, confirmed_at, confirmed_by
     ) values (
       '60000000-0000-0000-0000-000000000201',
       '10000000-0000-0000-0000-000000000202', 60, now(),
       '10000000-0000-0000-0000-000000000203'
     ) $$,
  '23505', null, 'one practitioner participates only once per occurrence'
);

select ok(
  private.can_read_training(
    '10000000-0000-0000-0000-000000000201',
    '10000000-0000-0000-0000-000000000202'
  ),
  'an active direct coach can read shared training'
);
select ok(
  private.can_read_training(
    '10000000-0000-0000-0000-000000000203',
    '10000000-0000-0000-0000-000000000202'
  ),
  'an active group coach can read shared training'
);
select ok(
  private.can_read_training(
    '10000000-0000-0000-0000-000000000206',
    '10000000-0000-0000-0000-000000000202'
  ),
  'an immediate parent with full coaching can read shared training'
);
select ok(
  not private.can_read_training(
    '10000000-0000-0000-0000-000000000207',
    '10000000-0000-0000-0000-000000000202'
  ),
  'a second-level ancestor cannot read identifiable training'
);
select ok(
  not private.can_read_training(
    '10000000-0000-0000-0000-000000000204',
    '10000000-0000-0000-0000-000000000202'
  ),
  'another student in the same group cannot read raw training'
);

select tests.set_actor('10000000-0000-0000-0000-000000000202');
select is(
  (select count(*)::integer from public.training_participations),
  1,
  'the practitioner reads their own participation through RLS'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);

select tests.set_actor('10000000-0000-0000-0000-000000000204');
select is(
  (select count(*)::integer from public.training_participations),
  0,
  'another student receives no raw participation rows'
);
select throws_ok(
  $$ update public.training_participations set personal_notes = 'peek' $$,
  '42501', null, 'authenticated users cannot mutate training tables directly'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);

select * from finish();
rollback;
