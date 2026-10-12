-- supabase/tests/0017_usage_mode.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_column('public', 'profiles', 'usage_mode', 'profiles have a usage mode');
select col_not_null('public', 'profiles', 'usage_mode', 'the usage mode is required');
select col_default_is('public', 'profiles', 'usage_mode', 'train', 'new profiles start in Train');
select has_function('public', 'set_usage_mode', array['text']);
select is(
  (select prosecdef from pg_proc where oid = 'private.set_usage_mode(uuid, text)'::regprocedure),
  true, 'the private function is security definer'
);
select is(
  (select proconfig from pg_proc where oid = 'private.set_usage_mode(uuid, text)'::regprocedure),
  array['search_path=""']::text[], 'the private function has an empty search path'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.set_usage_mode(text)'::regprocedure),
  false, 'the public wrapper is not security definer'
);

select tests.create_user('10000000-0000-0000-0000-000000001701', 'ana17@example.test', 'Ana Dezassete');
select tests.create_user('10000000-0000-0000-0000-000000001702', 'bia17@example.test', 'Bia Dezassete');
select is(
  (select usage_mode from public.profiles where id = '10000000-0000-0000-0000-000000001701'),
  'train', 'a new account starts in Train'
);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001701');
select is((select usage_mode from public.profiles), 'train', 'people read their own mode');
select is(public.set_usage_mode('both') ->> 'coach_profile_created', 'true', 'choosing Both creates the coach profile');
select is((select usage_mode from public.profiles), 'both', 'the mode is saved');
select is((select count(*)::integer from public.coach_profiles), 1, 'the coach profile exists');
select is(public.set_usage_mode('teach') ->> 'coach_profile_created', 'false', 'an existing coach profile is kept');
select public.create_workout_plan(
  'Ginga basics', null, null, 45, null,
  '[{"source_text":"ginga 10 min","movements":[{"movement_key":"ginga","movement_name":"Ginga","segment_key":"m:1"}]}]'::jsonb
) ->> 'plan_id' as plan_id \gset
select is(public.set_usage_mode('train') ->> 'usage_mode', 'train', 'choosing Train is allowed');
select is((select count(*)::integer from public.coach_profiles), 1, 'Train never deletes the coach profile');
select is((select count(*)::integer from public.list_workout_plans()), 1, 'Train never deletes plans');
select throws_ok($$select public.set_usage_mode('coach')$$, 'P0001', 'invalid_usage_mode', 'unknown modes are rejected');
select throws_ok($$select public.set_usage_mode(null)$$, 'P0001', 'invalid_usage_mode', 'a missing mode is rejected');
select throws_ok($$update public.profiles set usage_mode = 'teach'$$, '42501', null, 'clients cannot update the column directly');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001702');
select public.set_usage_mode('teach');

reset role;
select is(
  (select usage_mode from public.profiles where id = '10000000-0000-0000-0000-000000001701'),
  'train', 'one person cannot change another person''s mode'
);
select is(
  (select usage_mode from public.profiles where id = '10000000-0000-0000-0000-000000001702'),
  'teach', 'each person changes only their own mode'
);
select throws_ok(
  $$update public.profiles set usage_mode = 'coach' where id = '10000000-0000-0000-0000-000000001702'$$,
  '23514', null, 'the check constraint rejects unknown modes'
);

reset role;
select tests.set_actor(null, 'anon');
select throws_ok($$select public.set_usage_mode('both')$$, '42501', null, 'anonymous callers are refused');

reset role;
select * from finish();
rollback;
