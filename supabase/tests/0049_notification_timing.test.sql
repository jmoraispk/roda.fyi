\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

-- Quiet hours 22:00–08:00 in New York (UTC−5 in January).
select ok(private.can_deliver_now('2030-01-16T13:00:30Z', '2030-01-16T02:59:30Z', 'America/New_York', '22:00', '08:00'),
  'a request due a minute before quiet hours is held until they end, not dropped');
select ok(not private.can_deliver_now('2030-01-16T03:00:30Z', '2030-01-16T02:59:30Z', 'America/New_York', '22:00', '08:00'),
  'and nothing is sent once quiet hours have begun');
select ok(private.can_deliver_now('2030-01-16T13:00:30Z', '2030-01-16T03:30:00Z', 'America/New_York', '22:00', '08:00'),
  'a reminder due inside quiet hours arrives when they end');
select ok(not private.can_deliver_now('2030-01-16T16:00:30Z', '2030-01-16T03:30:00Z', 'America/New_York', '22:00', '08:00'),
  'and is dropped three hours after they end');
select ok(private.can_deliver_now('2030-01-15T17:59:00Z', '2030-01-15T15:00:00Z', 'America/New_York', '22:00', '08:00'),
  'during the day a reminder may wait up to three hours');
select ok(not private.can_deliver_now('2030-01-15T18:00:30Z', '2030-01-15T15:00:00Z', 'America/New_York', '22:00', '08:00'),
  'but no longer');
select ok(not private.can_deliver_now('2030-01-16T13:00:30Z', '2030-01-15T15:00:00Z', 'America/New_York', '22:00', '08:00'),
  'a daytime reminder that expired is not sent the next morning');
select ok(private.can_deliver_now('2030-01-16T05:00:00Z', '2030-01-16T02:30:00Z', 'America/New_York', null, null),
  'without quiet hours a reminder may wait three hours');
select ok(not private.can_deliver_now('2030-01-16T05:30:30Z', '2030-01-16T02:30:00Z', 'America/New_York', null, null),
  'and no longer');

-- Finding who to notify stays cheap as people join: the zone check must not
-- scan the list of time zones once per person.
select tests.create_user(('10000000-0000-0000-0000-' || lpad((4900 + n)::text, 12, '0'))::uuid, 'p' || n || '@example49.test', 'Person ' || n)
  from generate_series(1, 120) n;
update public.profiles set timezone_override = 'Europe/Lisbon'
 where id::text like '10000000-0000-0000-0000-0000000049%' or id::text like '10000000-0000-0000-0000-0000000050%';
insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth)
select id, 'https://fcm.googleapis.com/fcm/send/p49-' || id, repeat('B', 87), repeat('a', 22)
  from public.profiles where id::text like '10000000-0000-0000-0000-0000000049%' or id::text like '10000000-0000-0000-0000-0000000050%';
create temp table timing as select clock_timestamp() as started;
select count(*) as recipients from private.notification_recipients() \gset
select is(:recipients::integer, 120, 'every person with a device is listed');
select ok((select clock_timestamp() - started from timing) < interval '1 second',
  'listing 120 recipients takes well under a second');
select is((select zone from private.notification_recipients() limit 1), 'Europe/Lisbon', 'and still uses each person''s zone');

reset role;
select * from finish();
rollback;
