-- supabase/tests/0047_notification_due.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_function('public', 'claim_due_notifications', array['timestamp with time zone', 'integer'], 'the sender claims what is due');

select tests.create_user('10000000-0000-0000-0000-000000004701', 'lua47@example.test', 'Mestre Lua');
select tests.create_user('10000000-0000-0000-0000-000000004702', 'ana47@example.test', 'Ana Quarenta Sete');
select tests.create_user('10000000-0000-0000-0000-000000004703', 'bia47@example.test', 'Bia Quarenta Sete');
select tests.create_user('10000000-0000-0000-0000-000000004704', 'caio47@example.test', 'Caio Quarenta Sete');
select tests.create_user('10000000-0000-0000-0000-000000004705', 'dani47@example.test', 'Dani Quarenta Sete');
select tests.create_user('10000000-0000-0000-0000-000000004706', 'eve47@example.test', 'Eve Quarenta Sete');
select tests.create_user('10000000-0000-0000-0000-000000004707', 'fabio47@example.test', 'Fabio Quarenta Sete');
select tests.create_user('10000000-0000-0000-0000-000000004708', 'gil47@example.test', 'Gil Quarenta Sete');
select tests.create_user('10000000-0000-0000-0000-000000004709', 'hugo47@example.test', 'Hugo Quarenta Sete');
update public.profiles set completed_at = '2030-01-01T10:00:00Z', timezone_override = 'Europe/Lisbon'
 where id in ('10000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004702',
              '10000000-0000-0000-0000-000000004703', '10000000-0000-0000-0000-000000004705');
update public.profiles set completed_at = '2030-01-01T10:00:00Z' where id = '10000000-0000-0000-0000-000000004707';
update public.profiles set completed_at = '2030-02-01T10:00:00Z' where id = '10000000-0000-0000-0000-000000004706';
update public.profiles set completed_at = '2030-02-01T23:00:00Z' where id = '10000000-0000-0000-0000-000000004709';
insert into public.coach_profiles (profile_id) values ('10000000-0000-0000-0000-000000004701');
insert into public.groups (id, owner_id, name, timezone)
values ('20000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004701', 'Grupo Lua', 'Europe/Lisbon');
insert into public.group_memberships (group_id, profile_id, access_level) values
  ('20000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004701', 'coach'),
  ('20000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004702', 'member'),
  ('20000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004703', 'member'),
  ('20000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004705', 'member'),
  ('20000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004707', 'member');
-- Bia, Caio, and Gil have no device, so they never appear.
insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth, locale, timezone) values
  ('10000000-0000-0000-0000-000000004701', 'https://fcm.googleapis.com/fcm/send/lua47', repeat('B', 87), repeat('a', 22), 'pt', 'Europe/Lisbon'),
  ('10000000-0000-0000-0000-000000004702', 'https://fcm.googleapis.com/fcm/send/ana47', repeat('B', 87), repeat('a', 22), 'en', 'Europe/Lisbon'),
  ('10000000-0000-0000-0000-000000004705', 'https://web.push.apple.com/dani47', repeat('B', 87), repeat('a', 22), 'en', 'Europe/Lisbon'),
  ('10000000-0000-0000-0000-000000004706', 'https://fcm.googleapis.com/fcm/send/eve47', repeat('B', 87), repeat('a', 22), 'en', 'Europe/Lisbon'),
  ('10000000-0000-0000-0000-000000004707', 'https://fcm.googleapis.com/fcm/send/fabio47', repeat('B', 87), repeat('a', 22), 'en', 'America/New_York'),
  ('10000000-0000-0000-0000-000000004709', 'https://fcm.googleapis.com/fcm/send/hugo47', repeat('B', 87), repeat('a', 22), 'en', 'Europe/Lisbon');
-- Finish setting up is tested last, with Eve and Hugo; it is off for everyone else.
insert into public.notification_preferences (profile_id, setup, before_minutes) values
  ('10000000-0000-0000-0000-000000004701', false, 60), ('10000000-0000-0000-0000-000000004702', false, 60),
  ('10000000-0000-0000-0000-000000004705', false, 15), ('10000000-0000-0000-0000-000000004707', false, 60);

create temp table claimed (label text, delivery_id uuid, profile_id uuid, kind text, subject_key text, payload jsonb, devices jsonb);
create function pg_temp.claim(at_time timestamptz, label text)
returns void
language sql
as $$
  insert into claimed select label, due.* from public.claim_due_notifications(at_time, 50) due;
  -- Pretend the sender delivered everything, so each later run shows only new work.
  update public.notification_deliveries set status = 'sent', sent_at = claimed_at where status = 'pending';
$$;

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000004701');
select public.create_workout_plan(
  'Armada ladder', null, null, 60, null,
  '[{"source_text":"10x (armada, au)","movements":[{"movement_key":"armada","movement_name":"Armada","segment_key":"m:1"}]}]'::jsonb
) ->> 'plan_id' as plan_id \gset
select public.publish_workout_plan(:'plan_id') ->> 'version_id' as version_id \gset
reset role;
insert into public.scheduled_trainings (
  id, kind, plan_version_id, arranged_by, group_id, starts_at, local_date, timezone, expected_duration_minutes, visible_in_advance
) values
  ('50000000-0000-0000-0000-000000004701', 'group', :'version_id', '10000000-0000-0000-0000-000000004701',
   '20000000-0000-0000-0000-000000004701', '2030-01-15T19:00:00Z', '2030-01-15', 'Europe/Lisbon', 90, true),
  ('50000000-0000-0000-0000-000000004702', 'group', :'version_id', '10000000-0000-0000-0000-000000004701',
   '20000000-0000-0000-0000-000000004701', '2030-01-16T00:30:00Z', '2030-01-16', 'Europe/Lisbon', 60, true),
  ('50000000-0000-0000-0000-000000004703', 'group', :'version_id', '10000000-0000-0000-0000-000000004701',
   '20000000-0000-0000-0000-000000004701', '2030-01-17T19:00:00Z', '2030-01-17', 'Europe/Lisbon', 60, false),
  ('50000000-0000-0000-0000-000000004704', 'group', :'version_id', '10000000-0000-0000-0000-000000004701',
   '20000000-0000-0000-0000-000000004701', '2030-01-19T10:00:00Z', '2030-01-19', 'Europe/Lisbon', 60, true);

-- Before a class
select pg_temp.claim('2030-01-15T17:59:00Z', 'early');
select is((select count(*)::integer from claimed where label = 'early' and kind = 'before_class'), 0,
  'nothing before the reminder moment');
select pg_temp.claim('2030-01-15T18:00:30Z', 'moment');
select results_eq(
  $$ select profile_id::text, payload ->> 'role', payload ->> 'url' from claimed
      where label = 'moment' and kind = 'before_class' order by 2, 1 $$,
  $$ values ('10000000-0000-0000-0000-000000004701', 'coach', '/app#/class/50000000-0000-0000-0000-000000004701'),
            ('10000000-0000-0000-0000-000000004702', 'student', '/app#/calendar/2030-01-15'),
            ('10000000-0000-0000-0000-000000004707', 'student', '/app#/calendar/2030-01-15') $$,
  'an hour before, the coach and each member with a device and a one-hour lead are reminded');
select is((select payload ->> 'person_name' || ' · ' || (payload ->> 'lead_minutes') from claimed
            where label = 'moment' and profile_id = '10000000-0000-0000-0000-000000004702'),
  'Mestre Lua · 60', 'students learn who teaches and the lead');
select ok((select (payload ->> 'starts_at')::timestamptz = '2030-01-15T19:00:00Z' and payload ->> 'zone' = 'Europe/Lisbon'
             and payload ->> 'group_name' = 'Grupo Lua' and payload ->> 'class_kind' = 'group'
             from claimed where label = 'moment' and profile_id = '10000000-0000-0000-0000-000000004702'),
  'the payload carries what the text needs');
select is((select devices -> 0 ->> 'locale' from claimed
            where label = 'moment' and profile_id = '10000000-0000-0000-0000-000000004701'),
  'pt', 'each delivery lists the person''s devices with their language');
select pg_temp.claim('2030-01-15T18:05:00Z', 'again');
select is((select count(*)::integer from claimed where label = 'again' and kind = 'before_class'), 0,
  'a reminder is sent at most once');
select pg_temp.claim('2030-01-15T18:45:10Z', 'dani');
select results_eq($$ select profile_id::text from claimed where label = 'dani' and kind = 'before_class' $$,
  $$ values ('10000000-0000-0000-0000-000000004705') $$, 'each person''s own lead time is honored');
select pg_temp.claim('2030-01-15T23:30:30Z', 'late');
select results_eq(
  $$ select profile_id::text from claimed where label = 'late' and kind = 'before_class' $$,
  $$ values ('10000000-0000-0000-0000-000000004707') $$,
  'quiet hours follow each person''s zone: 23:30 in Lisbon is skipped, 18:30 in New York is not');
select pg_temp.claim('2030-01-17T18:00:30Z', 'hidden');
select results_eq($$ select profile_id::text from claimed where label = 'hidden' and kind = 'before_class' $$,
  $$ values ('10000000-0000-0000-0000-000000004701') $$, 'a class hidden from students reminds only its coach');

-- After a class
insert into public.training_occurrences (
  id, schedule_id, kind, group_id, recorded_by, occurred_at, local_date, timezone, default_duration_minutes, idempotency_key
) values
  ('60000000-0000-0000-0000-000000004701', '50000000-0000-0000-0000-000000004701', 'group', '20000000-0000-0000-0000-000000004701',
   '10000000-0000-0000-0000-000000004701', '2030-01-15T19:00:00Z', '2030-01-15', 'Europe/Lisbon', 90, '70000000-0000-0000-0000-000000004701'),
  ('60000000-0000-0000-0000-000000004702', null, 'group', '20000000-0000-0000-0000-000000004701',
   '10000000-0000-0000-0000-000000004701', '2030-01-20T20:30:00Z', '2030-01-20', 'Europe/Lisbon', 60, '70000000-0000-0000-0000-000000004702'),
  ('60000000-0000-0000-0000-000000004703', null, 'group', '20000000-0000-0000-0000-000000004701',
   '10000000-0000-0000-0000-000000004701', '2030-01-21T10:00:00Z', '2030-01-21', 'Europe/Lisbon', 60, '70000000-0000-0000-0000-000000004703');
insert into public.training_occurrence_rounds (id, occurrence_id, position)
values ('90000000-0000-0000-0000-000000004701', '60000000-0000-0000-0000-000000004701', 1);
insert into public.training_participations (id, occurrence_id, profile_id, actual_duration_minutes, confirmed_at, confirmed_by) values
  ('80000000-0000-0000-0000-000000004701', '60000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004702', 90, '2030-01-15T20:30:00Z', '10000000-0000-0000-0000-000000004701'),
  ('80000000-0000-0000-0000-000000004702', '60000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004705', 90, '2030-01-15T20:30:00Z', '10000000-0000-0000-0000-000000004701'),
  ('80000000-0000-0000-0000-000000004703', '60000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004701', 90, '2030-01-15T20:30:00Z', '10000000-0000-0000-0000-000000004701'),
  ('80000000-0000-0000-0000-000000004704', '60000000-0000-0000-0000-000000004702', '10000000-0000-0000-0000-000000004702', 60, '2030-01-20T21:30:00Z', '10000000-0000-0000-0000-000000004701'),
  ('80000000-0000-0000-0000-000000004705', '60000000-0000-0000-0000-000000004703', '10000000-0000-0000-0000-000000004702', 60, '2030-01-21T11:00:00Z', '10000000-0000-0000-0000-000000004701');
-- Dani already rated the class as a whole; the third class already has its video.
insert into public.training_segment_assessments (participation_id, occurrence_round_id, segment_key, segment_kind, difficulty)
values ('80000000-0000-0000-0000-000000004702', '90000000-0000-0000-0000-000000004701', 'r', 'round', 'okay');
insert into public.training_resources (occurrence_id, kind, url, added_by)
values ('60000000-0000-0000-0000-000000004703', 'video', 'https://youtu.be/abc', '10000000-0000-0000-0000-000000004701');

select pg_temp.claim('2030-01-15T21:29:00Z', 'after-early');
select is((select count(*)::integer from claimed where label = 'after-early' and kind = 'after_class'), 0,
  'not before the chosen time after the class ends');
select pg_temp.claim('2030-01-15T21:30:30Z', 'after');
select results_eq(
  $$ select profile_id::text, payload ->> 'url' from claimed where label = 'after' and kind = 'after_class' $$,
  $$ values ('10000000-0000-0000-0000-000000004702', '/app#/training/60000000-0000-0000-0000-000000004701') $$,
  'an hour after the class, attendees without a rating hear; the coach who recorded it and Dani, who rated it, do not');
select pg_temp.claim('2030-01-20T22:30:30Z', 'quiet');
select is((select count(*)::integer from claimed where label = 'quiet' and kind = 'after_class'), 0,
  'a reminder due in quiet hours waits');
select pg_temp.claim('2030-01-21T08:00:30Z', 'morning');
select results_eq(
  $$ select profile_id::text, payload ->> 'local_date' from claimed where label = 'morning' and kind = 'after_class' $$,
  $$ values ('10000000-0000-0000-0000-000000004702', '2030-01-20') $$,
  'and arrives when quiet hours end');
select pg_temp.claim('2030-01-21T12:00:30Z', 'video');
select is((select count(*)::integer from claimed where label = 'video' and kind = 'after_class'), 0,
  'a class that already has its video sends nothing');

-- Coach requests
select pg_temp.claim('2030-01-19T11:29:00Z', 'finish-early');
select is((select count(*)::integer from claimed where label = 'finish-early' and kind = 'coach'), 0,
  'an unfinished class waits 30 minutes after it ends');
select pg_temp.claim('2030-01-19T11:30:30Z', 'finish');
select results_eq(
  $$ select profile_id::text, payload ->> 'reason', payload ->> 'url' from claimed where label = 'finish' and kind = 'coach' $$,
  $$ values ('10000000-0000-0000-0000-000000004701', 'finish', '/app#/class/50000000-0000-0000-0000-000000004704') $$,
  'a class left unfinished reminds its coach');

insert into public.group_join_requests (id, group_id, profile_id, requested_access, created_at, expires_at) values
  ('30000000-0000-0000-0000-000000004701', '20000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004704',
   'member', '2030-01-22T12:00:00Z', '2030-02-22T12:00:00Z'),
  ('30000000-0000-0000-0000-000000004702', '20000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004708',
   'member', '2030-01-22T23:00:00Z', '2030-02-22T23:00:00Z');
select pg_temp.claim('2030-01-22T12:00:30Z', 'join');
select results_eq(
  $$ select profile_id::text, payload ->> 'reason', payload ->> 'person_name', payload ->> 'group_name', payload ->> 'url'
       from claimed where label = 'join' and kind = 'coach' $$,
  $$ values ('10000000-0000-0000-0000-000000004701', 'join', 'Caio Quarenta Sete', 'Grupo Lua',
             '/app#/group/20000000-0000-0000-0000-000000004701') $$,
  'a join request reaches the group''s coach within a minute, and members hear nothing');
select pg_temp.claim('2030-01-22T23:00:30Z', 'join-night');
select is((select count(*)::integer from claimed where label = 'join-night' and kind = 'coach'), 0, 'a request at night waits');
select pg_temp.claim('2030-01-23T08:00:30Z', 'join-morning');
select results_eq($$ select payload ->> 'person_name' from claimed where label = 'join-morning' and kind = 'coach' $$,
  $$ values ('Gil Quarenta Sete') $$, 'and reaches the coach in the morning');

insert into public.coach_student_connections (id, coach_profile_id, student_profile_id, initiated_by, created_at) values
  ('40000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004704',
   '10000000-0000-0000-0000-000000004704', '2030-01-24T15:00:00Z');
select pg_temp.claim('2030-01-24T15:00:30Z', 'coaching');
select results_eq(
  $$ select profile_id::text, payload ->> 'reason', payload ->> 'person_name', payload ->> 'url'
       from claimed where label = 'coaching' and kind = 'coach' $$,
  $$ values ('10000000-0000-0000-0000-000000004701', 'coaching', 'Caio Quarenta Sete', '/app#/me/teaching') $$,
  'a student asking to be coached reaches the coach');

update public.notification_preferences set coach = false where profile_id = '10000000-0000-0000-0000-000000004701';
insert into public.group_join_requests (group_id, profile_id, requested_access, created_at, expires_at) values
  ('20000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004703', 'member', '2030-01-25T12:00:00Z', '2030-02-25T12:00:00Z');
select pg_temp.claim('2030-01-25T12:00:30Z', 'coach-off');
select is((select count(*)::integer from claimed where label = 'coach-off' and kind = 'coach'), 0,
  'turning Coach requests off stops them');

-- Finish setting up
select pg_temp.claim('2030-02-03T09:59:00Z', 'setup-early');
select is((select count(*)::integer from claimed where label = 'setup-early' and kind = 'setup'), 0,
  'not before two days after sign-up');
select pg_temp.claim('2030-02-03T10:00:30Z', 'setup-1');
select results_eq($$ select profile_id::text, subject_key, payload ->> 'url' from claimed where label = 'setup-1' and kind = 'setup' $$,
  $$ values ('10000000-0000-0000-0000-000000004706', 'setup:1', '/app#/') $$, 'two days after sign-up, the first round');
select pg_temp.claim('2030-02-03T23:00:30Z', 'hugo-night');
select is((select count(*)::integer from claimed where label = 'hugo-night' and kind = 'setup'), 0, 'not in quiet hours');
select pg_temp.claim('2030-02-04T08:00:30Z', 'hugo-morning');
select results_eq($$ select profile_id::text from claimed where label = 'hugo-morning' and kind = 'setup' $$,
  $$ values ('10000000-0000-0000-0000-000000004709') $$, 'but as soon as they end');
select pg_temp.claim('2030-02-05T10:00:30Z', 'setup-wait');
select is((select count(*)::integer from claimed where label = 'setup-wait' and kind = 'setup'), 0, 'at most one round a week');

update public.profiles
   set place_city = 'Lisbon', place_region = 'Lisbon', place_country = 'Portugal', place_lat = 38.72, place_lng = -9.14
 where id = '10000000-0000-0000-0000-000000004709';
insert into public.group_memberships (group_id, profile_id, access_level)
values ('20000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004709', 'member');
insert into public.training_occurrences (kind, recorded_by, occurred_at, local_date, timezone, default_duration_minutes, idempotency_key)
values ('alone', '10000000-0000-0000-0000-000000004709', '2030-02-05T10:00:00Z', '2030-02-05', 'Europe/Lisbon', 30, '70000000-0000-0000-0000-000000004709');

select pg_temp.claim('2030-02-10T10:00:30Z', 'setup-2');
select results_eq($$ select subject_key from claimed where label = 'setup-2' and kind = 'setup' $$,
  $$ values ('setup:2') $$, 'a week later, the second round for Eve; Hugo has finished setting up');
select pg_temp.claim('2030-02-11T09:00:00Z', 'hugo-done');
select is((select count(*)::integer from claimed where label = 'hugo-done' and kind = 'setup'), 0, 'finishing setup stops the rounds');
select pg_temp.claim('2030-02-17T10:00:30Z', 'setup-3');
select results_eq($$ select subject_key from claimed where label = 'setup-3' and kind = 'setup' $$,
  $$ values ('setup:3') $$, 'the third round');
select pg_temp.claim('2030-02-24T10:00:30Z', 'setup-done');
select is((select count(*)::integer from claimed where label = 'setup-done' and kind = 'setup'), 0, 'and never a fourth');

-- Only the sender may claim.
select tests.set_actor('10000000-0000-0000-0000-000000004702');
select throws_ok($$ select * from public.claim_due_notifications() $$, '42501', null, 'a signed-in person cannot claim notifications');
reset role;
select tests.set_actor(null, 'anon');
select throws_ok($$ select * from public.claim_due_notifications() $$, '42501', null, 'nor can a visitor');
reset role;
select tests.set_actor(null, 'service_role');
select lives_ok($$ select * from public.claim_due_notifications('2031-01-01T12:00:00Z', 1) $$, 'the sender, as service role, can');

reset role;
select * from finish();
rollback;
