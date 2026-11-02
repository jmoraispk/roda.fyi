-- supabase/tests/0046_notification_settings.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_table('public', 'push_subscriptions', 'devices are stored');
select has_table('public', 'notification_preferences', 'preferences are stored');
select has_table('public', 'notification_deliveries', 'deliveries are logged');
select ok((
  select bool_and(relation.relrowsecurity) from pg_catalog.pg_class relation
   where relation.oid in ('public.push_subscriptions'::regclass, 'public.notification_preferences'::regclass,
                          'public.notification_deliveries'::regclass)
), 'every notification table has RLS');

select tests.create_user('10000000-0000-0000-0000-000000004601', 'ana46@example.test', 'Ana Quarenta Seis');
select tests.create_user('10000000-0000-0000-0000-000000004602', 'bia46@example.test', 'Bia Quarenta Seis');

-- This device
reset role;
select tests.set_actor('10000000-0000-0000-0000-000000004601');
select is(public.save_push_subscription('https://fcm.googleapis.com/fcm/send/ana-phone', repeat('B', 87), repeat('a', 22), 'pt', 'Europe/Lisbon') ->> 'status',
  'saved', 'a person saves this device');
select is((select locale || ' ' || timezone from public.push_subscriptions), 'pt Europe/Lisbon', 'the device keeps its language and zone');
select is(public.save_push_subscription('https://fcm.googleapis.com/fcm/send/ana-phone', repeat('B', 87), repeat('a', 22), 'en', 'Not/AZone') ->> 'status',
  'saved', 'saving the same device again updates it');
select is((select locale || ' ' || coalesce(timezone, 'none') from public.push_subscriptions), 'en none', 'an unknown zone is dropped, not refused');
select is((select count(*)::integer from public.push_subscriptions), 1, 'one row per device');
select throws_ok($$ select public.save_push_subscription('https://attacker.example/push', repeat('B', 87), repeat('a', 22), 'en', null) $$,
  'P0001', 'invalid_subscription', 'endpoints outside the known push services are refused');
select throws_ok($$ select public.save_push_subscription('http://fcm.googleapis.com/fcm/send/x', repeat('B', 87), repeat('a', 22), 'en', null) $$,
  'P0001', 'invalid_subscription', 'plain http is refused');
select throws_ok($$ select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/x', 'short', repeat('a', 22), 'en', null) $$,
  'P0001', 'invalid_subscription', 'malformed keys are refused');
select throws_ok($$ select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/x', repeat('B', 87), repeat('a', 22), 'fr', null) $$,
  'P0001', 'invalid_subscription', 'only English and Portuguese');
select throws_ok($$ insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth)
  values ('10000000-0000-0000-0000-000000004601', 'https://fcm.googleapis.com/fcm/send/direct', repeat('B', 87), repeat('a', 22)) $$,
  '42501', null, 'clients cannot write devices directly');
select throws_ok($$ update public.notification_preferences set setup = false $$, '42501', null, 'clients cannot write preferences directly');
select throws_ok($$ delete from public.notification_deliveries $$, '42501', null, 'clients cannot change the delivery log');

-- What to send
select is(public.get_notification_preferences(), '{"setup": true, "before_class": true, "before_minutes": 60, "after_class": true,
  "after_minutes": 60, "coach": true, "quiet_start": "22:00", "quiet_end": "08:00"}'::jsonb, 'a missing row means the defaults');
select is(public.update_notification_preferences(true, false, 30, true, 120, false, '23:00', '07:00'),
  '{"setup": true, "before_class": false, "before_minutes": 30, "after_class": true, "after_minutes": 120, "coach": false,
    "quiet_start": "23:00", "quiet_end": "07:00"}'::jsonb, 'choices are saved and returned');
select is(public.get_notification_preferences() ->> 'before_minutes', '30', 'and read back');
select is(public.update_notification_preferences(true, true, 60, true, 60, true, null, null) -> 'quiet_start', 'null'::jsonb,
  'quiet hours can be turned off');
select throws_ok($$ select public.update_notification_preferences(true, true, 45, true, 60, true, '22:00', '08:00') $$,
  'P0001', 'invalid_preferences', 'only the offered lead times');
select throws_ok($$ select public.update_notification_preferences(true, true, 60, true, 15, true, '22:00', '08:00') $$,
  'P0001', 'invalid_preferences', 'only the offered delays');
select throws_ok($$ select public.update_notification_preferences(true, true, 60, true, 60, true, '22:00', null) $$,
  'P0001', 'invalid_preferences', 'quiet hours need both ends');
select throws_ok($$ select public.update_notification_preferences(true, true, 60, true, 60, true, '22:00', '22:00') $$,
  'P0001', 'invalid_preferences', 'quiet hours need two different times');
select throws_ok($$ select public.update_notification_preferences(true, true, 60, true, 60, true, '22:30', '08:00') $$,
  'P0001', 'invalid_preferences', 'quiet hours are whole hours');
select throws_ok($$ select public.update_notification_preferences(null, true, 60, true, 60, true, '22:00', '08:00') $$,
  'P0001', 'invalid_preferences', 'every switch is on or off');

-- Other people
reset role;
insert into public.notification_deliveries (profile_id, kind, subject_key, due_at)
values ('10000000-0000-0000-0000-000000004601', 'setup', 'setup:1', '2030-01-01T10:00:00Z');
select tests.set_actor('10000000-0000-0000-0000-000000004601');
select is((select count(*)::integer from public.notification_deliveries), 1, 'a person sees their own deliveries');
reset role;
select tests.set_actor('10000000-0000-0000-0000-000000004602');
select is((select count(*)::integer from public.push_subscriptions), 0, 'another person sees none of Ana''s devices');
select is((select count(*)::integer from public.notification_preferences), 0, 'nor her preferences');
select is((select count(*)::integer from public.notification_deliveries), 0, 'nor her deliveries');
select is(public.delete_push_subscription('https://fcm.googleapis.com/fcm/send/ana-phone') ->> 'status', 'missing',
  'nobody deletes another person''s device');
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/ana-phone', repeat('C', 87), repeat('b', 22), 'en', null);
reset role;
select is((select profile_id::text from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/ana-phone'),
  '10000000-0000-0000-0000-000000004602', 'a phone that signs into another account moves there, so Ana stops receiving on it');

select tests.set_actor('10000000-0000-0000-0000-000000004601');
-- Ruling 13: at most ten devices, the newest kept.
select count(saved.result) from (
  select public.save_push_subscription('https://updates.push.services.mozilla.com/wpush/v2/ana-' || n, repeat('B', 87), repeat('a', 22), 'en', null) as result
    from generate_series(1, 11) n
) saved;
select is((select count(*)::integer from public.push_subscriptions), 10, 'a person keeps at most ten devices');
select is(public.delete_push_subscription('https://updates.push.services.mozilla.com/wpush/v2/ana-11') ->> 'status', 'deleted',
  'the newest device is kept, and turning it off deletes it');

reset role;
-- Visitors
select tests.set_actor(null, 'anon');
select throws_ok($$ select public.get_notification_preferences() $$, '42501', null, 'visitors cannot read preferences');
select throws_ok($$ select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/x', repeat('B', 87), repeat('a', 22), 'en', null) $$,
  '42501', null, 'visitors cannot save devices');

reset role;
select * from finish();
rollback;
