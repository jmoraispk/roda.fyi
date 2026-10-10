-- supabase/tests/0010_training_text_rounds.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_column('public', 'workout_plan_rounds', 'source_text', 'plan rounds keep text');
select has_column('public', 'training_occurrence_rounds', 'sequence', 'occurrence rounds keep parsed sequence');
select has_column('public', 'training_occurrence_movements', 'catalogued', 'movements flag catalog matches');
select has_table('public', 'workout_plan_segment_expectations', 'plan expectations exist');
select has_table('public', 'training_segment_assessments', 'segment assessments exist');
select has_function('public', 'save_round_assessments', array['uuid', 'uuid', 'jsonb']);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.training_segment_assessments'::regclass),
  'segment assessments have RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.workout_plan_segment_expectations'::regclass),
  'plan expectations have RLS'
);

select tests.create_user('10000000-0000-0000-0000-000000001001', 'coach10@example.test', 'Mestre Dez');
select tests.create_user('10000000-0000-0000-0000-000000001002', 'student10@example.test', 'Ana Dez');
select tests.create_user('10000000-0000-0000-0000-000000001003', 'outsider10@example.test', 'Caio Dez');
insert into public.coach_profiles (profile_id) values ('10000000-0000-0000-0000-000000001001');

-- Coach creates a text plan with an uncatalogued move and expectations.
reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001001');
select public.create_workout_plan(
  'Text plan', null, null, 45, null,
  '[{"source_text":"3x (armada, galopanti)","sequence":[{"type":"group","path":"1","repeat":3,"steps":[]}],
     "movements":[
       {"movement_key":"Aú","movement_name":"Aú","catalogued":true,"segment_key":"m:1.1"},
       {"movement_key":"galopanti","movement_name":"galopanti","catalogued":false,"segment_key":"m:1.2"}],
     "ratings":[
       {"segment_key":"r","segment_kind":"round","difficulty":"hard"},
       {"segment_key":"t:1.1>1.2","segment_kind":"transition","difficulty":"hard",
        "from_movement_key":"au","to_movement_key":"galopanti","note":"spin late"}]}]'::jsonb
) ->> 'plan_id' as text_plan_id \gset
select is(
  (select movement_key from public.workout_plan_movements where segment_key = 'm:1.1'),
  'au', 'accented keys are normalized without losing letters'
);
select is(
  (select catalogued from public.workout_plan_movements where segment_key = 'm:1.2'),
  false, 'uncatalogued flag is stored'
);
select is(
  (select rounds -> 0 ->> 'source_text' from public.list_workout_plans(null) where plan_id = :'text_plan_id'),
  '3x (armada, galopanti)', 'plan listing returns round text'
);
select is(
  (select jsonb_array_length(rounds -> 0 -> 'ratings') from public.list_workout_plans(null) where plan_id = :'text_plan_id'),
  2, 'plan listing returns expectations'
);
select lives_ok(
  format($$select public.publish_workout_plan(%L)$$, :'text_plan_id'),
  'a text plan with movements publishes'
);
reset role;
select throws_ok(
  $$insert into public.workout_plan_segment_expectations (plan_round_id, segment_key, segment_kind, difficulty)
    select id, 's', 'setup', 'easy' from public.workout_plan_rounds
     where source_text = '3x (armada, galopanti)'$$,
  'P0001', 'published_plan_immutable', 'expectations freeze with the published version'
);

-- A plan whose only round is text with no moves cannot publish.
reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001001');
select public.create_workout_plan(
  'Stretch only', null, null, 20, null,
  '[{"source_text":"and, e","sequence":[],"movements":[]}]'::jsonb
) ->> 'plan_id' as empty_plan_id \gset
select throws_ok(
  format($$select public.publish_workout_plan(%L)$$, :'empty_plan_id'),
  'P0001', 'empty_plan', 'text without moves saves as draft but cannot publish'
);

-- Practitioner records Alone training with round and segment ratings.
reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001002');
select public.record_alone_training(
  '2026-10-01', 'Europe/Lisbon', 40, null,
  '[{"source_text":"armada, au","sequence":[],
     "movements":[{"movement_key":"armada","movement_name":"Armada","segment_key":"m:1"},
                  {"movement_key":"au","movement_name":"Aú","segment_key":"m:2"}],
     "ratings":[{"segment_key":"r","segment_kind":"round","difficulty":"okay"},
                {"segment_key":"m:2","segment_kind":"move","difficulty":"hard","note":"wobbly"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000001001', '2026-10-01T10:00:00Z'
) ->> 'participation_id' as participation_id \gset
select is(
  (select count(*)::integer from public.training_segment_assessments where participation_id = :'participation_id'),
  2, 'record_alone_training stores round ratings'
);
select is(
  (select public.get_training_day('2026-10-01', null) -> 0 -> 'rounds' -> 0 ->> 'source_text'),
  'armada, au', 'day detail returns round text'
);
select is(
  (select jsonb_array_length(public.get_training_day('2026-10-01', null) -> 0 -> 'rounds' -> 0 -> 'ratings')),
  2, 'day detail returns the caller ratings'
);
select (select id from public.training_occurrence_rounds round
         where round.occurrence_id = (select occurrence_id from public.training_participations where id = :'participation_id')) as round_id \gset
select is(
  public.save_round_assessments(
    :'participation_id', :'round_id',
    '[{"segment_key":"t:1>2","segment_kind":"transition","difficulty":"hard","from_movement_key":"armada","to_movement_key":"au"}]'::jsonb
  ) ->> 'status',
  'saved', 'the practitioner replaces round ratings'
);
select is(
  (select array_agg(segment_key order by segment_key) from public.training_segment_assessments where participation_id = :'participation_id'),
  array['t:1>2']::text[], 'save_round_assessments replaces the previous set'
);
select throws_ok(
  format($$select public.save_round_assessments(%L, %L, '[{"segment_key":"x:1","segment_kind":"move","difficulty":"hard"}]'::jsonb)$$,
    :'participation_id', :'round_id'),
  '23514', null, 'malformed segment keys are rejected'
);
select throws_ok(
  format($$insert into public.training_segment_assessments (participation_id, occurrence_round_id, segment_key, segment_kind, difficulty)
           values (%L, %L, 'r', 'round', 'easy')$$, :'participation_id', :'round_id'),
  '42501', null, 'clients cannot write assessments directly'
);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001003');
select throws_ok(
  format($$select public.save_round_assessments(%L, %L, '[]'::jsonb)$$, :'participation_id', :'round_id'),
  'PT403', 'not_authorized', 'another person cannot rate this training'
);
select is(
  (select count(*)::integer from public.training_segment_assessments),
  0, 'unrelated users cannot read assessments'
);

reset role;
select * from finish();
rollback;
