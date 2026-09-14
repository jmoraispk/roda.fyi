\set ON_ERROR_STOP on
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED

select no_plan();

select has_schema('private', 'private schema exists');

select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'coach_profiles', 'coach_profiles exists');
select has_table('public', 'groups', 'groups exists');
select has_table('public', 'group_memberships', 'group_memberships exists');
select has_table('public', 'group_join_requests', 'group_join_requests exists');
select has_table('public', 'group_member_invitations', 'group_member_invitations exists');
select has_table('public', 'group_discovery_links', 'group_discovery_links exists');
select has_table('public', 'group_relationships', 'group_relationships exists');
select has_table('private', 'group_ownership_audit', 'ownership audit exists');

select columns_are(
  'public',
  'profiles',
  array[
    'id', 'display_name', 'avatar_path', 'timezone_override',
    'leaderboard_visible', 'completed_at', 'created_at', 'updated_at'
  ],
  'profiles exposes only the contracted columns'
);

select columns_are(
  'public',
  'coach_profiles',
  array['profile_id', 'activated_at', 'created_at', 'updated_at'],
  'coach_profiles exposes only the contracted columns'
);

select columns_are(
  'public',
  'groups',
  array[
    'id', 'slug', 'owner_id', 'name', 'description', 'location',
    'picture_path', 'is_discoverable', 'archived_at', 'archived_by',
    'created_at', 'updated_at'
  ],
  'groups exposes only the contracted columns'
);

select columns_are(
  'public',
  'group_memberships',
  array[
    'id', 'group_id', 'profile_id', 'access_level', 'state', 'joined_at',
    'ended_at', 'ended_by', 'created_at', 'updated_at'
  ],
  'group_memberships exposes only the contracted columns'
);

select columns_are(
  'public',
  'group_join_requests',
  array[
    'id', 'group_id', 'profile_id', 'requested_access', 'state',
    'expires_at', 'decided_at', 'decided_by', 'created_at', 'updated_at'
  ],
  'group_join_requests exposes only the contracted columns'
);

select columns_are(
  'public',
  'group_member_invitations',
  array[
    'id', 'group_id', 'email', 'token_hash', 'state', 'invited_by',
    'expires_at', 'accepted_at', 'accepted_by', 'revoked_at', 'revoked_by',
    'created_at', 'updated_at'
  ],
  'group_member_invitations exposes only the contracted columns'
);

select columns_are(
  'public',
  'group_discovery_links',
  array[
    'id', 'group_id', 'token_hash', 'state', 'created_by', 'revoked_by',
    'revoked_at', 'created_at', 'updated_at'
  ],
  'group_discovery_links exposes only the contracted columns'
);

select columns_are(
  'public',
  'group_relationships',
  array[
    'id', 'parent_group_id', 'child_group_id', 'state', 'sharing_level',
    'invited_by', 'expires_at', 'decided_at', 'decided_by', 'revoked_at',
    'revoked_by', 'created_at', 'updated_at'
  ],
  'group_relationships exposes only the contracted columns'
);

select col_default_is(
  'public', 'profiles', 'leaderboard_visible', 'true',
  'leaderboard visibility defaults on'
);
select col_hasnt_default(
  'public', 'profiles', 'timezone_override',
  'automatic timezone has no non-null database default'
);

select ok(
  (select count(*) = 8
     from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'profiles', 'coach_profiles', 'groups', 'group_memberships',
        'group_join_requests', 'group_member_invitations',
        'group_discovery_links', 'group_relationships'
      )
      and c.relrowsecurity),
  'all eight public application tables have RLS enabled'
);

select is(
  (select count(*)::integer
     from information_schema.table_privileges
    where table_schema = 'public'
      and table_name in (
        'profiles', 'coach_profiles', 'groups', 'group_memberships',
        'group_join_requests', 'group_member_invitations',
        'group_discovery_links', 'group_relationships'
      )
      and grantee in ('anon', 'authenticated')),
  0,
  'anon and authenticated start without direct application-table privileges'
);

select tests.create_user(
  '10000000-0000-0000-0000-000000000001',
  'owner@example.test',
  '  Owner Name  '
);

select is(
  (select display_name from public.profiles
    where id = '10000000-0000-0000-0000-000000000001'),
  'Owner Name',
  'new auth users receive a trimmed practitioner profile'
);
select is(
  (select leaderboard_visible from public.profiles
    where id = '10000000-0000-0000-0000-000000000001'),
  true,
  'generated profiles default to leaderboard visibility'
);
select is(
  (select timezone_override from public.profiles
    where id = '10000000-0000-0000-0000-000000000001'),
  null,
  'generated profiles keep timezone automatic'
);

select tests.create_user(
  '10000000-0000-0000-0000-000000000002',
  'member@example.test',
  'Member Name'
);

insert into public.coach_profiles (profile_id)
values ('10000000-0000-0000-0000-000000000001');

insert into public.groups (id, owner_id, name)
values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '  Grupo Regional  '
);

insert into public.group_memberships (group_id, profile_id, access_level)
values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'coach'
);

select is(
  (select slug from public.groups
    where id = '20000000-0000-0000-0000-000000000001'),
  'grupo-regional-20000000',
  'group slug is generated from normalized name and ID prefix'
);

select throws_ok(
  $$
    insert into public.group_memberships (group_id, profile_id, access_level)
    values (
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'coach'
    )
  $$,
  '23505',
  null,
  'one membership row exists per group and person'
);

insert into public.group_join_requests (group_id, profile_id, requested_access)
values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  'member'
);

select throws_ok(
  $$
    insert into public.group_join_requests (group_id, profile_id, requested_access)
    values (
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002',
      'member'
    )
  $$,
  '23505',
  null,
  'only one pending request exists per person, group, and access level'
);

select ok(
  (select expires_at between created_at + interval '29 days 23 hours'
                         and created_at + interval '30 days 1 hour'
     from public.group_join_requests
    where group_id = '20000000-0000-0000-0000-000000000001'
      and profile_id = '10000000-0000-0000-0000-000000000002'),
  'join requests expire after thirty days by default'
);

insert into public.group_member_invitations (
  group_id, token_hash, invited_by
)
values (
  '20000000-0000-0000-0000-000000000001',
  decode(repeat('ab', 32), 'hex'),
  '10000000-0000-0000-0000-000000000001'
);

select ok(
  (select expires_at between created_at + interval '6 days 23 hours'
                         and created_at + interval '7 days 1 hour'
     from public.group_member_invitations
    where token_hash = decode(repeat('ab', 32), 'hex')),
  'member invitations expire after seven days by default'
);

insert into public.group_discovery_links (
  group_id, token_hash, created_by
)
values (
  '20000000-0000-0000-0000-000000000001',
  decode(repeat('cd', 32), 'hex'),
  '10000000-0000-0000-0000-000000000001'
);

select throws_ok(
  $$
    insert into public.group_discovery_links (group_id, token_hash, created_by)
    values (
      '20000000-0000-0000-0000-000000000001',
      decode(repeat('ef', 32), 'hex'),
      '10000000-0000-0000-0000-000000000001'
    )
  $$,
  '23505',
  null,
  'only one active discovery link exists per group'
);

select throws_ok(
  $$
    insert into public.group_relationships (
      parent_group_id, child_group_id, invited_by
    )
    values (
      '20000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001'
    )
  $$,
  '23514',
  null,
  'a group cannot be related to itself'
);

select ok(
  not exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
  ),
  'no security-definer function remains in the exposed public schema'
);

select * from finish();
rollback;
