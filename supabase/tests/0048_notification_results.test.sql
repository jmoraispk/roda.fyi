-- supabase/tests/0048_notification_results.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_function('public', 'report_notification_results', array['jsonb'], 'the sender reports what happened');

select tests.create_user('10000000-0000-0000-0000-000000004801', 'ana48@example.test', 'Ana Quarenta Oito');
select tests.create_user('10000000-0000-0000-0000-000000004802', 'bia48@example.test', 'Bia Quarenta Oito');
select tests.create_user('10000000-0000-0000-0000-000000004803', 'caio48@example.test', 'Caio Quarenta Oito');
select tests.create_user('10000000-0000-0000-0000-000000004804', 'dani48@example.test', 'Dani Quarenta Oito');
select tests.create_user('10000000-0000-0000-0000-000000004805', 'eve48@example.test', 'Eve Quarenta Oito');
select tests.create_user('10000000-0000-0000-0000-000000004806', 'fabio48@example.test', 'Fabio Quarenta Oito');
-- Nobody has a city yet, so "Finish setting up" is due two days after sign-up.
update public.profiles set timezone_override = 'Europe/Lisbon', completed_at = '2030-03-01T10:00:00Z'
 where id in ('10000000-0000-0000-0000-000000004801', '10000000-0000-0000-0000-000000004802',
              '10000000-0000-0000-0000-000000004803', '10000000-0000-0000-0000-000000004804');
update public.profiles set timezone_override = 'Europe/Lisbon', completed_at = '2030-02-01T10:00:00Z'
 where id in ('10000000-0000-0000-0000-000000004805', '10000000-0000-0000-0000-000000004806');
insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth, locale, failures) values
  ('10000000-0000-0000-0000-000000004801', 'https://fcm.googleapis.com/fcm/send/ana48-phone', repeat('B', 87), repeat('a', 22), 'en', 3),
  ('10000000-0000-0000-0000-000000004801', 'https://updates.push.services.mozilla.com/wpush/v2/ana48-laptop', repeat('B', 87), repeat('a', 22), 'en', 0),
  ('10000000-0000-0000-0000-000000004802', 'https://fcm.googleapis.com/fcm/send/bia48', repeat('B', 87), repeat('a', 22), 'en', 0),
  ('10000000-0000-0000-0000-000000004803', 'https://fcm.googleapis.com/fcm/send/caio48', repeat('B', 87), repeat('a', 22), 'en', 0),
  ('10000000-0000-0000-0000-000000004804', 'https://fcm.googleapis.com/fcm/send/dani48', repeat('B', 87), repeat('a', 22), 'en', 9),
  ('10000000-0000-0000-0000-000000004805', 'https://fcm.googleapis.com/fcm/send/eve48', repeat('B', 87), repeat('a', 22), 'en', 0),
  ('10000000-0000-0000-0000-000000004806', 'https://fcm.googleapis.com/fcm/send/fabio48', repeat('B', 87), repeat('a', 22), 'en', 0);

-- Batches (Eve and Fábio)
create temp table batch1 as select * from public.claim_due_notifications('2030-02-03T10:00:30Z', 1);
select is((select count(*)::integer from batch1), 1, 'a run never claims more than its batch');
create temp table batch2 as select * from public.claim_due_notifications('2030-02-03T10:01:30Z', 1);
select is((select count(*)::integer from batch2 where profile_id not in (select profile_id from batch1)), 1,
  'the rest go in the next run');
create temp table batch3 as select * from public.claim_due_notifications('2030-02-03T10:02:30Z', 50);
select is((select count(*)::integer from batch3), 0, 'and nothing is claimed twice by overlapping runs');
update public.notification_deliveries set status = 'sent', sent_at = claimed_at
 where profile_id in ('10000000-0000-0000-0000-000000004805', '10000000-0000-0000-0000-000000004806');
delete from public.push_subscriptions
 where profile_id in ('10000000-0000-0000-0000-000000004805', '10000000-0000-0000-0000-000000004806');

-- One run, four outcomes
create temp table claimed as select * from public.claim_due_notifications('2030-03-03T10:00:30Z', 50);
select is((select count(*)::integer from claimed), 4, 'four people are due');
select is((select jsonb_array_length(devices) from claimed where profile_id = '10000000-0000-0000-0000-000000004801'), 2,
  'Ana''s delivery lists both her devices');
select jsonb_build_array(
  jsonb_build_object('delivery_id', (select delivery_id from claimed where profile_id = '10000000-0000-0000-0000-000000004801'),
    'outcomes', jsonb_build_array(
      jsonb_build_object('subscription_id', (select id from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/ana48-phone'), 'status', 'sent'),
      jsonb_build_object('subscription_id', (select id from public.push_subscriptions where endpoint = 'https://updates.push.services.mozilla.com/wpush/v2/ana48-laptop'), 'status', 'gone'))),
  jsonb_build_object('delivery_id', (select delivery_id from claimed where profile_id = '10000000-0000-0000-0000-000000004802'),
    'outcomes', jsonb_build_array(
      jsonb_build_object('subscription_id', (select id from public.push_subscriptions where profile_id = '10000000-0000-0000-0000-000000004802'), 'status', 'failed'))),
  jsonb_build_object('delivery_id', (select delivery_id from claimed where profile_id = '10000000-0000-0000-0000-000000004803'),
    'outcomes', jsonb_build_array(
      jsonb_build_object('subscription_id', (select id from public.push_subscriptions where profile_id = '10000000-0000-0000-0000-000000004803'), 'status', 'gone'))),
  jsonb_build_object('delivery_id', (select delivery_id from claimed where profile_id = '10000000-0000-0000-0000-000000004804'),
    'outcomes', jsonb_build_array(
      jsonb_build_object('subscription_id', (select id from public.push_subscriptions where profile_id = '10000000-0000-0000-0000-000000004804'), 'status', 'failed')))
)::text as report_one \gset
select tests.set_actor(null, 'service_role');
select is(public.report_notification_results(:'report_one'::jsonb) ->> 'removed_devices', '3',
  'the sender reports results; the laptop, Caio''s device, and Dani''s tenth failure are removed');
reset role;
select results_eq(
  $$ select profile_id::text, status, sent_at is not null from public.notification_deliveries
      where profile_id in ('10000000-0000-0000-0000-000000004801', '10000000-0000-0000-0000-000000004802',
                           '10000000-0000-0000-0000-000000004803', '10000000-0000-0000-0000-000000004804')
      order by 1 $$,
  $$ values ('10000000-0000-0000-0000-000000004801', 'sent', true), ('10000000-0000-0000-0000-000000004802', 'pending', false),
            ('10000000-0000-0000-0000-000000004803', 'failed', false), ('10000000-0000-0000-0000-000000004804', 'pending', false) $$,
  'sent when one device took it, retried after a passing failure, failed when no device is left');
select results_eq(
  $$ select endpoint, failures, last_sent_at is not null from public.push_subscriptions order by 1 $$,
  $$ values ('https://fcm.googleapis.com/fcm/send/ana48-phone', 0, true), ('https://fcm.googleapis.com/fcm/send/bia48', 1, false) $$,
  'a success resets the failure count; 404, 410, and ten failures in a row remove the device');

-- Retries
create temp table retry1 as select * from public.claim_due_notifications('2030-03-03T10:10:00Z', 50);
select is((select count(*)::integer from retry1), 0, 'nothing is retried before 15 minutes');
create temp table retry2 as select * from public.claim_due_notifications('2030-03-03T10:16:00Z', 50);
select results_eq($$ select profile_id::text, jsonb_array_length(devices) from retry2 order by 1 $$,
  $$ values ('10000000-0000-0000-0000-000000004802', 1), ('10000000-0000-0000-0000-000000004804', 0) $$,
  'after 15 minutes a pending delivery is claimed again, with the devices still on the account');
select is((select attempts from public.notification_deliveries where profile_id = '10000000-0000-0000-0000-000000004802'), 2,
  'the second try is counted');
select jsonb_build_array(
  jsonb_build_object('delivery_id', (select delivery_id from retry2 where profile_id = '10000000-0000-0000-0000-000000004802'),
    'outcomes', jsonb_build_array(jsonb_build_object('subscription_id',
      (select id from public.push_subscriptions where profile_id = '10000000-0000-0000-0000-000000004802'), 'status', 'failed'))),
  jsonb_build_object('delivery_id', (select delivery_id from retry2 where profile_id = '10000000-0000-0000-0000-000000004804'),
    'outcomes', '[]'::jsonb),
  -- A late report about a delivery that was already sent changes nothing.
  jsonb_build_object('delivery_id', (select delivery_id from claimed where profile_id = '10000000-0000-0000-0000-000000004801'),
    'outcomes', '[]'::jsonb)
)::text as report_two \gset
select public.report_notification_results(:'report_two'::jsonb);
select results_eq(
  $$ select profile_id::text, status from public.notification_deliveries
      where profile_id in ('10000000-0000-0000-0000-000000004801', '10000000-0000-0000-0000-000000004804') order by 1 $$,
  $$ values ('10000000-0000-0000-0000-000000004801', 'sent'), ('10000000-0000-0000-0000-000000004804', 'failed') $$,
  'a delivery with no device left is given up, and a sent one stays sent');
create temp table retry3 as select * from public.claim_due_notifications('2030-03-03T10:32:00Z', 50);
select is((select attempts from public.notification_deliveries where profile_id = '10000000-0000-0000-0000-000000004802'), 3,
  'the third try is the last');
select jsonb_build_array(
  jsonb_build_object('delivery_id', (select delivery_id from retry3 where profile_id = '10000000-0000-0000-0000-000000004802'),
    'outcomes', jsonb_build_array(jsonb_build_object('subscription_id',
      (select id from public.push_subscriptions where profile_id = '10000000-0000-0000-0000-000000004802'), 'status', 'failed')))
)::text as report_three \gset
select public.report_notification_results(:'report_three'::jsonb);
create temp table retry4 as select * from public.claim_due_notifications('2030-03-03T10:48:00Z', 50);
select is((select count(*)::integer from retry4), 0, 'after three tries nothing is claimed again');
select is((select status from public.notification_deliveries where profile_id = '10000000-0000-0000-0000-000000004802'), 'failed',
  'and the delivery is given up');

select throws_ok($$ select public.report_notification_results('{}'::jsonb) $$, 'P0001', 'invalid_results', 'results must be a list');

-- Only the sender may report.
select tests.set_actor('10000000-0000-0000-0000-000000004801');
select throws_ok($$ select public.report_notification_results('[]'::jsonb) $$, '42501', null, 'a signed-in person cannot report results');
reset role;
select tests.set_actor(null, 'anon');
select throws_ok($$ select public.report_notification_results('[]'::jsonb) $$, '42501', null, 'nor can a visitor');

reset role;
select * from finish();
rollback;
