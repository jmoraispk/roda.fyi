\set ON_ERROR_STOP on
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED

select no_plan();

select has_function('public', 'get_personal_training_statistics', array['date','date','text']);
select has_function('public', 'get_group_training_leaderboard', array['uuid','date','date','text']);
select has_function('public', 'list_shared_group_members', array['uuid','text','integer','integer']);

select tests.create_user('10000000-0000-0000-0000-000000000401', 'coach4@example.test', 'Mestre Vida');
select tests.create_user('10000000-0000-0000-0000-000000000402', 'visible4@example.test', 'Ana Mar');
select tests.create_user('10000000-0000-0000-0000-000000000403', 'hidden4@example.test', 'Bia Lua');
select tests.create_user('10000000-0000-0000-0000-000000000404', 'former4@example.test', 'Caio Sol');
select tests.create_user('10000000-0000-0000-0000-000000000405', 'parent4@example.test', 'Professora Céu');
select tests.create_user('10000000-0000-0000-0000-000000000406', 'grand4@example.test', 'Mestre Norte');
select tests.create_user('10000000-0000-0000-0000-000000000407', 'outsider4@example.test', 'Pessoa Fora');

update public.profiles
   set avatar_path = case id
     when '10000000-0000-0000-0000-000000000402' then 'profiles/ana.webp'
     else avatar_path end,
       leaderboard_visible = id <> '10000000-0000-0000-0000-000000000403';

insert into public.coach_profiles (profile_id) values
  ('10000000-0000-0000-0000-000000000401'),
  ('10000000-0000-0000-0000-000000000405'),
  ('10000000-0000-0000-0000-000000000406');

insert into public.groups (id, owner_id, name, timezone) values
  ('20000000-0000-0000-0000-000000000401', '10000000-0000-0000-0000-000000000401', 'Grupo Vida', 'Europe/Lisbon'),
  ('20000000-0000-0000-0000-000000000402', '10000000-0000-0000-0000-000000000405', 'Grupo Regional', 'Europe/Lisbon'),
  ('20000000-0000-0000-0000-000000000403', '10000000-0000-0000-0000-000000000406', 'Grupo Global', 'Europe/Lisbon');

insert into public.group_memberships (
  group_id, profile_id, access_level, state, joined_at, ended_at, ended_by
) values
  ('20000000-0000-0000-0000-000000000401', '10000000-0000-0000-0000-000000000401', 'coach', 'active', '2026-01-01T00:00:00Z', null, null),
  ('20000000-0000-0000-0000-000000000401', '10000000-0000-0000-0000-000000000402', 'member', 'active', '2026-09-10T00:00:00Z', null, null),
  ('20000000-0000-0000-0000-000000000401', '10000000-0000-0000-0000-000000000403', 'member', 'active', '2026-09-01T00:00:00Z', null, null),
  ('20000000-0000-0000-0000-000000000401', '10000000-0000-0000-0000-000000000404', 'member', 'left', '2026-09-01T00:00:00Z', '2026-09-20T00:00:00Z', '10000000-0000-0000-0000-000000000401'),
  ('20000000-0000-0000-0000-000000000402', '10000000-0000-0000-0000-000000000405', 'coach', 'active', '2026-01-01T00:00:00Z', null, null),
  ('20000000-0000-0000-0000-000000000403', '10000000-0000-0000-0000-000000000406', 'coach', 'active', '2026-01-01T00:00:00Z', null, null);

insert into public.group_relationships (
  parent_group_id, child_group_id, state, sharing_level, invited_by,
  decided_at, decided_by
) values
  ('20000000-0000-0000-0000-000000000402', '20000000-0000-0000-0000-000000000401', 'active', 'named_progress', '10000000-0000-0000-0000-000000000405', now(), '10000000-0000-0000-0000-000000000401'),
  ('20000000-0000-0000-0000-000000000403', '20000000-0000-0000-0000-000000000402', 'active', 'full_coaching', '10000000-0000-0000-0000-000000000406', now(), '10000000-0000-0000-0000-000000000405');

insert into public.training_occurrences (
  id, kind, group_id, student_profile_id, recorded_by, occurred_at, local_date,
  timezone, default_duration_minutes, idempotency_key
) values
  ('60000000-0000-0000-0000-000000000401', 'alone', null, null, '10000000-0000-0000-0000-000000000402', '2026-09-05T10:00:00Z', '2026-09-05', 'Europe/Lisbon', 30, '70000000-0000-0000-0000-000000000401'),
  ('60000000-0000-0000-0000-000000000402', 'group', '20000000-0000-0000-0000-000000000401', null, '10000000-0000-0000-0000-000000000401', '2026-09-12T10:00:00Z', '2026-09-12', 'Europe/Lisbon', 60, '70000000-0000-0000-0000-000000000402'),
  ('60000000-0000-0000-0000-000000000403', 'personal_class', null, '10000000-0000-0000-0000-000000000402', '10000000-0000-0000-0000-000000000401', '2026-09-13T10:00:00Z', '2026-09-13', 'Europe/Lisbon', 30, '70000000-0000-0000-0000-000000000403'),
  ('60000000-0000-0000-0000-000000000404', 'alone', null, null, '10000000-0000-0000-0000-000000000403', '2026-09-12T11:00:00Z', '2026-09-12', 'Europe/Lisbon', 120, '70000000-0000-0000-0000-000000000404'),
  ('60000000-0000-0000-0000-000000000405', 'alone', null, null, '10000000-0000-0000-0000-000000000404', '2026-09-10T12:00:00Z', '2026-09-10', 'Europe/Lisbon', 50, '70000000-0000-0000-0000-000000000405'),
  ('60000000-0000-0000-0000-000000000406', 'alone', null, null, '10000000-0000-0000-0000-000000000404', '2026-09-22T12:00:00Z', '2026-09-22', 'Europe/Lisbon', 70, '70000000-0000-0000-0000-000000000406'),
  ('60000000-0000-0000-0000-000000000407', 'alone', null, null, '10000000-0000-0000-0000-000000000402', '2026-09-15T10:00:00Z', '2026-09-15', 'Europe/Lisbon', 99, '70000000-0000-0000-0000-000000000407');

insert into public.training_occurrence_rounds (id, occurrence_id, position) values
  ('90000000-0000-0000-0000-000000000401', '60000000-0000-0000-0000-000000000401', 1),
  ('90000000-0000-0000-0000-000000000402', '60000000-0000-0000-0000-000000000402', 1),
  ('90000000-0000-0000-0000-000000000403', '60000000-0000-0000-0000-000000000403', 1);
insert into public.training_occurrence_movements (
  id, occurrence_round_id, position, movement_key, movement_name_snapshot
) values
  ('91000000-0000-0000-0000-000000000401', '90000000-0000-0000-0000-000000000401', 1, 'ginga', 'Ginga'),
  ('91000000-0000-0000-0000-000000000402', '90000000-0000-0000-0000-000000000402', 1, 'armada', 'Armada'),
  ('91000000-0000-0000-0000-000000000403', '90000000-0000-0000-0000-000000000403', 1, 'armada', 'Armada');

-- The last occurrence has no participation and therefore must never count.
insert into public.training_participations (
  id, occurrence_id, profile_id, actual_duration_minutes, confirmed_at, confirmed_by
) values
  ('80000000-0000-0000-0000-000000000401', '60000000-0000-0000-0000-000000000401', '10000000-0000-0000-0000-000000000402', 30, '2026-09-05T10:00:00Z', '10000000-0000-0000-0000-000000000402'),
  ('80000000-0000-0000-0000-000000000402', '60000000-0000-0000-0000-000000000402', '10000000-0000-0000-0000-000000000402', 60, '2026-09-12T10:00:00Z', '10000000-0000-0000-0000-000000000401'),
  ('80000000-0000-0000-0000-000000000403', '60000000-0000-0000-0000-000000000403', '10000000-0000-0000-0000-000000000402', 30, '2026-09-13T10:00:00Z', '10000000-0000-0000-0000-000000000401'),
  ('80000000-0000-0000-0000-000000000404', '60000000-0000-0000-0000-000000000404', '10000000-0000-0000-0000-000000000403', 120, '2026-09-12T11:00:00Z', '10000000-0000-0000-0000-000000000403'),
  ('80000000-0000-0000-0000-000000000405', '60000000-0000-0000-0000-000000000405', '10000000-0000-0000-0000-000000000404', 50, '2026-09-10T12:00:00Z', '10000000-0000-0000-0000-000000000404'),
  ('80000000-0000-0000-0000-000000000406', '60000000-0000-0000-0000-000000000406', '10000000-0000-0000-0000-000000000404', 70, '2026-09-22T12:00:00Z', '10000000-0000-0000-0000-000000000404');

insert into public.training_movement_assessments (
  participation_id, occurrence_movement_id, difficulty
) values
  ('80000000-0000-0000-0000-000000000402', '91000000-0000-0000-0000-000000000402', 'hard'),
  ('80000000-0000-0000-0000-000000000403', '91000000-0000-0000-0000-000000000403', 'easy');

select tests.set_actor('10000000-0000-0000-0000-000000000402');
select is(
  public.get_personal_training_statistics('2026-09-01', '2026-10-01', 'Europe/Lisbon') ->> 'session_count',
  '3', 'personal statistics count only confirmed participations'
);
select is(
  public.get_personal_training_statistics('2026-09-01', '2026-10-01', 'Europe/Lisbon') ->> 'total_minutes',
  '120', 'personal statistics sum actual participant duration'
);
select is(
  public.get_personal_training_statistics('2026-09-01', '2026-10-01', 'Europe/Lisbon') ->> 'current_streak',
  '2', 'personal statistics calculate consecutive practiced days'
);
select is(
  public.get_personal_training_statistics('2026-09-01', '2026-10-01', 'Europe/Lisbon') #>> '{favorite_movements,0,movement_key}',
  'armada', 'the most-practiced movement is database-derived'
);
select is(
  public.get_personal_training_statistics('2026-09-01', '2026-10-01', 'Europe/Lisbon') #>> '{difficulty_trends,0,improving}',
  'true', 'difficulty trend recognizes movement progress'
);
select is(
  jsonb_array_length(public.get_personal_training_statistics('2026-09-01', '2026-10-01', 'Europe/Lisbon') -> 'context_distribution'),
  3, 'all three training contexts are summarized'
);
select ok(
  (public.get_personal_training_statistics('2026-09-01', '2026-10-01', 'Europe/Lisbon') ->> 'average_trainings_per_week')::numeric > 0
  and (public.get_personal_training_statistics('2026-09-01', '2026-10-01', 'Europe/Lisbon') ->> 'average_hours_per_month')::numeric > 0,
  'weekly and monthly averages are returned'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);

select tests.set_actor('10000000-0000-0000-0000-000000000401');
select results_eq(
  $$ select profile_id, total_minutes
       from public.get_group_training_leaderboard(
         '20000000-0000-0000-0000-000000000401', '2026-09-01', '2026-10-01', 'time'
       )
      where profile_id = '10000000-0000-0000-0000-000000000402' $$,
  $$ values ('10000000-0000-0000-0000-000000000402'::uuid, 90::bigint) $$,
  'activity before joined_at is excluded from the group ranking'
);
select results_eq(
  $$ select profile_id, total_minutes
       from public.get_group_training_leaderboard(
         '20000000-0000-0000-0000-000000000401', '2026-09-01', '2026-10-01', 'time'
       )
      where profile_id = '10000000-0000-0000-0000-000000000404' $$,
  $$ values ('10000000-0000-0000-0000-000000000404'::uuid, 50::bigint) $$,
  'activity after ended_at is excluded from the group ranking'
);
select is(
  (select count(*)::integer from public.get_group_training_leaderboard(
    '20000000-0000-0000-0000-000000000401', '2026-09-01', '2026-10-01', 'time'
  ) where profile_id = '10000000-0000-0000-0000-000000000403'),
  0, 'leaderboard opt-out hides the member identity'
);
select results_eq(
  $$ select anonymous_member_count, anonymous_minutes, anonymous_sessions
       from public.get_group_training_leaderboard(
         '20000000-0000-0000-0000-000000000401', '2026-09-01', '2026-10-01', 'time'
       ) limit 1 $$,
  $$ values (1::bigint, 120::bigint, 1::bigint) $$,
  'opted-out activity remains in anonymous aggregates'
);
select results_eq(
  $$ select display_name, rank_position, selected_value
       from public.get_group_training_leaderboard(
         '20000000-0000-0000-0000-000000000401', '2026-09-01', '2026-10-01', 'sessions'
       ) where profile_id is not null order by rank_position, display_name $$,
  $$ values ('Ana Mar'::text, 1::bigint, 2::bigint), ('Caio Sol'::text, 2::bigint, 1::bigint) $$,
  'session rankings use dense rank with stable display ordering'
);
select results_eq(
  $$ select profile_id, display_name, avatar_path, graduation
       from public.list_shared_group_members(
         '20000000-0000-0000-0000-000000000401', 'ana', 20, 0
       ) $$,
  $$ values ('10000000-0000-0000-0000-000000000402'::uuid, 'Ana Mar'::text, 'profiles/ana.webp'::text, null::text) $$,
  'shared member discovery returns only safe profile fields'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);

select tests.set_actor('10000000-0000-0000-0000-000000000405');
select is(
  (select count(*)::integer from public.get_group_training_leaderboard(
    '20000000-0000-0000-0000-000000000401', '2026-09-01', '2026-10-01', 'time'
  ) where profile_id is not null),
  2, 'an immediate-parent coach receives named progress'
);
select is(
  (select count(*)::integer from public.list_shared_group_members(
    '20000000-0000-0000-0000-000000000401', '', 20, 0
  )),
  2, 'an immediate-parent coach can discover active child-group members safely'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);

select tests.set_actor('10000000-0000-0000-0000-000000000406');
select is(
  (select count(*)::integer from public.get_group_training_leaderboard(
    '20000000-0000-0000-0000-000000000401', '2026-09-01', '2026-10-01', 'time'
  ) where profile_id is not null),
  0, 'a second-level ancestor receives no identifiable ranking rows'
);
select throws_ok(
  $$ select * from public.list_shared_group_members(
       '20000000-0000-0000-0000-000000000401', '', 20, 0
     ) $$,
  'PT403', 'not_authorized', 'a second-level ancestor cannot discover named members'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);

select tests.set_actor('10000000-0000-0000-0000-000000000407');
select throws_ok(
  $$ select * from public.get_group_training_leaderboard(
       '20000000-0000-0000-0000-000000000401', '2026-09-01', '2026-10-01', 'time'
     ) $$,
  'PT403', 'not_authorized', 'an unrelated account cannot read a group ranking'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);

select * from finish();
rollback;
