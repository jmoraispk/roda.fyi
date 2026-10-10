-- supabase/tests/0011_practice_sequences.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_table('public', 'practice_sequences', 'repertoire table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.practice_sequences'::regclass),
  'repertoire has RLS');

select tests.create_user('10000000-0000-0000-0000-000000001101', 'owner11@example.test', 'Ana Onze');
select tests.create_user('10000000-0000-0000-0000-000000001102', 'other11@example.test', 'Bia Onze');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001101');
select public.save_practice_sequence(null, 'Armada flow', 'armada, au', '[]'::jsonb) ->> 'sequence_id' as sequence_id \gset
select is((select count(*)::integer from public.list_practice_sequences()), 1, 'owner lists own sequence');
select is(
  public.save_practice_sequence(:'sequence_id', 'Renamed', 'armada, au, ginga', '[]'::jsonb) ->> 'status',
  'saved', 'owner updates own sequence'
);
select is(
  public.import_practice_sequences('[
    {"import_ref":"local:abc","title":"From browser","source_text":"ginga, negativa","sequence":[]},
    {"import_ref":"local:abc","title":"Duplicate","source_text":"ginga, negativa","sequence":[]},
    {"import_ref":"local:def","title":"Second","source_text":"au","sequence":[]}
  ]'::jsonb) ->> 'imported',
  '2', 'import skips duplicate references inside one batch'
);
select is(
  public.import_practice_sequences('[{"import_ref":"local:abc","title":"Again","source_text":"ginga","sequence":[]}]'::jsonb) ->> 'imported',
  '0', 're-import of the same reference inserts nothing'
);
select throws_ok(
  $$select public.save_practice_sequence(null, 'Empty', '   ', '[]'::jsonb)$$,
  'P0001', 'invalid_sequence_text', 'empty text is rejected'
);
select throws_ok(
  $$insert into public.practice_sequences (profile_id, title, source_text)
    values ('10000000-0000-0000-0000-000000001101', 't', 'x')$$,
  '42501', null, 'clients cannot insert directly'
);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001102');
select is((select count(*)::integer from public.list_practice_sequences()), 0, 'other users see none');
select is((select count(*)::integer from public.practice_sequences), 0, 'RLS hides other repertoires');
select throws_ok(
  format($$select public.save_practice_sequence(%L, 'Hijack', 'au', '[]'::jsonb)$$, :'sequence_id'),
  'PT403', 'not_authorized', 'other users cannot update'
);
select throws_ok(
  format($$select public.delete_practice_sequence(%L)$$, :'sequence_id'),
  'PT403', 'not_authorized', 'other users cannot delete'
);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001101');
select is(public.delete_practice_sequence(:'sequence_id') ->> 'status', 'deleted', 'owner deletes');

reset role;
select tests.set_actor(null, 'anon');
select throws_ok($$select * from public.list_practice_sequences()$$, '42501', null, 'anonymous callers are refused');

reset role;
select * from finish();
rollback;
