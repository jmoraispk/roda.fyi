\set ON_ERROR_STOP on
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED

select no_plan();

select tests.create_user('10000000-0000-0000-0000-000000000101', 'coach@example.test', 'Mestre Lua');
select tests.create_user('10000000-0000-0000-0000-000000000102', 'student@example.test', 'Ana Sol');
select tests.create_user('10000000-0000-0000-0000-000000000103', 'group-coach@example.test', 'Professora Mar');
select tests.create_user('10000000-0000-0000-0000-000000000104', 'other-coach@example.test', 'Professor Vento');
select tests.create_user('10000000-0000-0000-0000-000000000105', 'outsider@example.test', 'Bia Terra');

insert into public.coach_profiles (profile_id)
values
  ('10000000-0000-0000-0000-000000000101'),
  ('10000000-0000-0000-0000-000000000103'),
  ('10000000-0000-0000-0000-000000000104');

insert into public.groups (id, owner_id, name)
values (
  '20000000-0000-0000-0000-000000000101',
  '10000000-0000-0000-0000-000000000103',
  'Grupo Mar'
);

insert into public.group_memberships (group_id, profile_id, access_level)
values
  ('20000000-0000-0000-0000-000000000101', '10000000-0000-0000-0000-000000000103', 'coach'),
  ('20000000-0000-0000-0000-000000000101', '10000000-0000-0000-0000-000000000102', 'member');

select has_type('public', 'coach_connection_state', 'coach connection state exists');
select has_table('public', 'coach_student_connections', 'coach connections exist');
select has_column('public', 'groups', 'timezone', 'groups preserve an IANA timezone');
select has_function('private', 'has_explicit_coaching_connection', array['uuid', 'uuid']);
select has_function('private', 'has_group_coaching_connection', array['uuid', 'uuid', 'uuid']);
select has_function('private', 'can_coach_practitioner', array['uuid', 'uuid', 'uuid']);
select has_function('public', 'search_coaching_profiles', array['text', 'text', 'integer']);
select has_function('public', 'request_coach_connection', array['uuid', 'uuid']);
select has_function('public', 'decide_coach_connection', array['uuid', 'text']);
select has_function('public', 'end_coach_connection', array['uuid']);
select has_function('public', 'list_my_coach_connections', array[]::text[]);
select has_function('public', 'set_group_timezone', array['uuid', 'text']);

select ok(
  private.has_group_coaching_connection(
    '10000000-0000-0000-0000-000000000103',
    '10000000-0000-0000-0000-000000000102',
    '20000000-0000-0000-0000-000000000101'
  ),
  'an active group coach derives coaching access to an active student member'
);
select ok(
  not private.has_group_coaching_connection(
    '10000000-0000-0000-0000-000000000104',
    '10000000-0000-0000-0000-000000000102',
    null
  ),
  'an unrelated coach has no group-derived access'
);

select tests.set_actor('10000000-0000-0000-0000-000000000102');
select is(
  public.request_coach_connection(
    '10000000-0000-0000-0000-000000000101'::uuid,
    '10000000-0000-0000-0000-000000000102'::uuid
  ) ->> 'status',
  'pending',
  'a practitioner can request a connection with a registered coach'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
select id as direct_connection_id
  from public.coach_student_connections
 where coach_profile_id = '10000000-0000-0000-0000-000000000101'
   and student_profile_id = '10000000-0000-0000-0000-000000000102'
   and state = 'pending'
\gset
select ok(
  not private.has_explicit_coaching_connection(
    '10000000-0000-0000-0000-000000000101',
    '10000000-0000-0000-0000-000000000102'
  ),
  'a pending connection does not grant coaching access'
);

select tests.set_actor('10000000-0000-0000-0000-000000000101');
select is(
  public.decide_coach_connection(
    :'direct_connection_id'::uuid,
    'accepted'
  ) ->> 'status',
  'active',
  'the recipient can accept the reciprocal request'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
select ok(
  private.has_explicit_coaching_connection(
    '10000000-0000-0000-0000-000000000101',
    '10000000-0000-0000-0000-000000000102'
  ),
  'an accepted direct connection grants explicit access'
);
select ok(
  private.can_coach_practitioner(
    '10000000-0000-0000-0000-000000000101',
    '10000000-0000-0000-0000-000000000102',
    null
  ),
  'the combined helper accepts an explicit connection'
);
select ok(
  private.is_direct_coach_of(
    '10000000-0000-0000-0000-000000000101',
    '10000000-0000-0000-0000-000000000102'
  ),
  'the compatibility helper includes explicit coaching connections'
);

select tests.set_actor('10000000-0000-0000-0000-000000000105');
select throws_ok(
  format(
    'select public.end_coach_connection(%L::uuid)',
    :'direct_connection_id'
  ),
  'PT403', null, 'an outsider cannot end another pair connection'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
select throws_ok(
  $$ select private.set_group_timezone(
       '10000000-0000-0000-0000-000000000103'::uuid,
       '20000000-0000-0000-0000-000000000101'::uuid,
       'Mars/Olympus'
     ) $$,
  'P0001', 'invalid_timezone', 'invalid IANA timezone is rejected'
);
select is(
  private.set_group_timezone(
    '10000000-0000-0000-0000-000000000103'::uuid,
    '20000000-0000-0000-0000-000000000101'::uuid,
    'Europe/Lisbon'
  ) ->> 'status',
  'updated',
  'a group owner can set a valid IANA timezone'
);
select is(
  (select timezone from public.groups where id = '20000000-0000-0000-0000-000000000101'),
  'Europe/Lisbon',
  'the valid timezone is persisted'
);

select tests.set_actor('10000000-0000-0000-0000-000000000102');
select results_eq(
  $$ select display_name, candidate_role
       from public.search_coaching_profiles('Mestre', 'coach', 20) $$,
  $$ values ('Mestre Lua'::text, 'coach'::text) $$,
  'coach discovery exposes only safe matching profile fields'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
select * from finish();
rollback;
