\set ON_ERROR_STOP on
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

\ir 0000_test_helpers.sql

select no_plan();

select has_function(
  'private',
  'is_active_group_member',
  array['uuid', 'uuid'],
  'active membership helper exists'
);
select has_function(
  'private',
  'is_group_coach',
  array['uuid', 'uuid'],
  'group coach helper exists'
);
select has_function(
  'private',
  'is_group_owner',
  array['uuid', 'uuid'],
  'group owner helper exists'
);
select has_function(
  'private',
  'is_direct_coach_of',
  array['uuid', 'uuid'],
  'direct coach helper exists'
);

select tests.create_user('10000000-0000-0000-0000-000000000011', 'owner@example.test', 'Owner');
select tests.create_user('10000000-0000-0000-0000-000000000012', 'member@example.test', 'Member');
select tests.create_user('10000000-0000-0000-0000-000000000013', 'coach@example.test', 'Coach');
select tests.create_user('10000000-0000-0000-0000-000000000014', 'outsider@example.test', 'Outsider');
select tests.create_user('10000000-0000-0000-0000-000000000015', 'parent@example.test', 'Parent Coach');
select tests.create_user('10000000-0000-0000-0000-000000000016', 'ancestor@example.test', 'Ancestor Coach');

update public.profiles
   set timezone_override = 'America/Sao_Paulo',
       leaderboard_visible = false,
       completed_at = now()
 where id = '10000000-0000-0000-0000-000000000012';

insert into public.coach_profiles (profile_id)
values
  ('10000000-0000-0000-0000-000000000011'),
  ('10000000-0000-0000-0000-000000000013'),
  ('10000000-0000-0000-0000-000000000015'),
  ('10000000-0000-0000-0000-000000000016');

insert into public.groups (
  id, owner_id, name, description, location, is_discoverable
)
values
  (
    '20000000-0000-0000-0000-000000000011',
    '10000000-0000-0000-0000-000000000011',
    'Grupo Local', 'Local training group', 'Salvador', true
  ),
  (
    '20000000-0000-0000-0000-000000000012',
    '10000000-0000-0000-0000-000000000011',
    'Grupo Oculto', 'Invitation only', 'Recife', false
  ),
  (
    '20000000-0000-0000-0000-000000000013',
    '10000000-0000-0000-0000-000000000011',
    'Grupo Arquivado', null, null, true
  ),
  (
    '20000000-0000-0000-0000-000000000014',
    '10000000-0000-0000-0000-000000000015',
    'Grupo Regional', 'Immediate umbrella', 'Bahia', true
  ),
  (
    '20000000-0000-0000-0000-000000000015',
    '10000000-0000-0000-0000-000000000016',
    'Grupo Global', 'Top umbrella', 'Brasil', true
  );

update public.groups
   set archived_at = now(),
       archived_by = '10000000-0000-0000-0000-000000000011'
 where id = '20000000-0000-0000-0000-000000000013';

insert into public.group_memberships (
  group_id, profile_id, access_level
)
values
  ('20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000011', 'coach'),
  ('20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000012', 'member'),
  ('20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000013', 'coach'),
  ('20000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000011', 'coach'),
  ('20000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000015', 'coach'),
  ('20000000-0000-0000-0000-000000000015', '10000000-0000-0000-0000-000000000016', 'coach');

insert into public.group_relationships (
  parent_group_id, child_group_id, state, decided_at, decided_by
)
values
  (
    '20000000-0000-0000-0000-000000000014',
    '20000000-0000-0000-0000-000000000011',
    'active', now(), '10000000-0000-0000-0000-000000000011'
  ),
  (
    '20000000-0000-0000-0000-000000000015',
    '20000000-0000-0000-0000-000000000014',
    'active', now(), '10000000-0000-0000-0000-000000000015'
  );

insert into public.group_member_invitations (
  group_id, email, token_hash, invited_by
)
values
  (
    '20000000-0000-0000-0000-000000000011',
    'member@example.test',
    decode(repeat('11', 32), 'hex'),
    '10000000-0000-0000-0000-000000000013'
  ),
  (
    '20000000-0000-0000-0000-000000000011',
    'outsider@example.test',
    decode(repeat('12', 32), 'hex'),
    '10000000-0000-0000-0000-000000000013'
  ),
  (
    '20000000-0000-0000-0000-000000000011',
    null,
    decode(repeat('13', 32), 'hex'),
    '10000000-0000-0000-0000-000000000013'
  );

select ok(
  private.is_active_group_member(
    '20000000-0000-0000-0000-000000000011',
    '10000000-0000-0000-0000-000000000012'
  ),
  'active member is recognized'
);
select ok(
  not private.is_active_group_member(
    '20000000-0000-0000-0000-000000000011',
    '10000000-0000-0000-0000-000000000014'
  ),
  'outsider is not recognized as a member'
);
select ok(
  private.is_group_coach(
    '20000000-0000-0000-0000-000000000011',
    '10000000-0000-0000-0000-000000000013'
  ),
  'active group coach is recognized'
);
select ok(
  private.is_group_owner(
    '20000000-0000-0000-0000-000000000011',
    '10000000-0000-0000-0000-000000000011'
  ),
  'active group owner is recognized'
);
select ok(
  private.is_direct_coach_of(
    '10000000-0000-0000-0000-000000000013',
    '10000000-0000-0000-0000-000000000012'
  ),
  'coach and practitioner sharing an active group are directly related'
);
select ok(
  not private.is_direct_coach_of(
    '10000000-0000-0000-0000-000000000015',
    '10000000-0000-0000-0000-000000000012'
  ),
  'an immediate-parent coach is not a direct coach'
);

select results_eq(
  $$
    select id, name, parent_name
      from private.search_groups('', 50, 0)
     order by name, id
  $$,
  $$ values
    ('20000000-0000-0000-0000-000000000015'::uuid, 'Grupo Global'::text, null::text),
    ('20000000-0000-0000-0000-000000000011'::uuid, 'Grupo Local'::text, 'Grupo Regional'::text),
    ('20000000-0000-0000-0000-000000000014'::uuid, 'Grupo Regional'::text, 'Grupo Global'::text)
  $$,
  'anonymous search exposes active discoverable groups and one public parent only'
);

select results_eq(
  $$
    select name
      from private.search_groups('salvador', 50, 0)
  $$,
  $$ values ('Grupo Local'::text) $$,
  'group search matches normalized location text'
);

select is(
  (select count(*)::integer
     from private.list_group_roster(
       '20000000-0000-0000-0000-000000000011',
       '10000000-0000-0000-0000-000000000013'
     )),
  3,
  'a direct coach can retrieve the active roster'
);

select is(
  (select count(*)::integer
     from private.list_group_roster(
       '20000000-0000-0000-0000-000000000011',
       '10000000-0000-0000-0000-000000000012'
     )),
  0,
  'an ordinary member cannot retrieve the coach roster projection'
);

select ok(
  not exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('private', 'public')
       and p.proname in (
         'search_groups', 'resolve_group_discovery_token',
         'list_group_roster', 'list_my_member_invitations'
       )
       and pg_catalog.pg_get_function_result(p.oid)
         ~ '(timezone_override|leaderboard_visible|token_hash)'
  ),
  'read projections do not expose profile preferences or token hashes'
);

select results_eq(
  $$
    select email, group_name
      from private.list_my_member_invitations(
        '10000000-0000-0000-0000-000000000012'
      )
  $$,
  $$ values ('member@example.test'::text, 'Grupo Local'::text) $$,
  'a signed-in recipient lists only invitations bound to their normalized email'
);

select is(
  (select count(*)::integer
     from private.resolve_group_discovery_token('not-a-token')),
  0,
  'an unknown discovery token reveals no group'
);

create temporary table task5_results (
  result_name text primary key,
  payload jsonb not null
) on commit drop;

insert into task5_results values (
  'complete_profile',
  private.complete_my_profile(
    '10000000-0000-0000-0000-000000000014',
    '  Practicing Outsider  ',
    null,
    true
  )
);

select is(
  (select payload ->> 'status' from task5_results where result_name = 'complete_profile'),
  'updated',
  'an authenticated practitioner completes their own profile'
);
select results_eq(
  $$
    select display_name, timezone_override, leaderboard_visible, completed_at is not null
      from public.profiles
     where id = '10000000-0000-0000-0000-000000000014'
  $$,
  $$ values ('Practicing Outsider'::text, null::text, true, true) $$,
  'profile completion trims the name and keeps automatic timezone null'
);

select is(
  private.register_as_coach('10000000-0000-0000-0000-000000000012') ->> 'status',
  'created',
  'a practitioner can add coaching capability to the same profile'
);
select is(
  private.register_as_coach('10000000-0000-0000-0000-000000000012') ->> 'status',
  'active',
  'coach registration is idempotent'
);

select throws_ok(
  $$
    select private.create_group(
      '10000000-0000-0000-0000-000000000014',
      'Unauthorized group', null, null, true
    )
  $$,
  'PT403',
  null,
  'a practitioner without coaching capability cannot create a group'
);

insert into task5_results values (
  'create_group',
  private.create_group(
    '10000000-0000-0000-0000-000000000013',
    'Grupo do Coach',
    'Created atomically',
    'Fortaleza',
    true
  )
);

select is(
  (select payload ->> 'status' from task5_results where result_name = 'create_group'),
  'created',
  'a registered coach creates a group'
);
select ok(
  exists (
    select 1
      from task5_results result
      join public.groups g on g.id = (result.payload ->> 'group_id')::uuid
      join public.group_memberships membership
        on membership.group_id = g.id
       and membership.profile_id = g.owner_id
       and membership.access_level = 'coach'
       and membership.state = 'active'
     where result.result_name = 'create_group'
       and g.owner_id = '10000000-0000-0000-0000-000000000013'
  ),
  'group creation atomically establishes the owner coach membership'
);

insert into task5_results values (
  'member_request',
  private.request_group_access(
    '10000000-0000-0000-0000-000000000014',
    '20000000-0000-0000-0000-000000000011',
    'member',
    null
  )
);

select is(
  (select payload ->> 'status' from task5_results where result_name = 'member_request'),
  'pending',
  'a practitioner requests member access to a discoverable group'
);

insert into task5_results values (
  'approve_member',
  private.decide_group_join_request(
    '10000000-0000-0000-0000-000000000013',
    (select (payload ->> 'request_id')::uuid from task5_results where result_name = 'member_request'),
    'approved'
  )
);

select is(
  (select payload ->> 'status' from task5_results where result_name = 'approve_member'),
  'approved',
  'a direct coach approves an ordinary member request'
);

select is(
  private.decide_group_join_request(
    '10000000-0000-0000-0000-000000000013',
    (select (payload ->> 'request_id')::uuid from task5_results where result_name = 'member_request'),
    'approved'
  ) ->> 'status',
  'already_approved',
  'retrying an approved request is idempotent'
);

insert into task5_results values (
  'coach_request',
  private.request_group_access(
    '10000000-0000-0000-0000-000000000015',
    '20000000-0000-0000-0000-000000000011',
    'coach',
    null
  )
);

select throws_ok(
  format(
    'select private.decide_group_join_request(%L::uuid, %L::uuid, %L)',
    '10000000-0000-0000-0000-000000000013',
    (select payload ->> 'request_id' from task5_results where result_name = 'coach_request'),
    'approved'
  ),
  'PT403',
  null,
  'a non-owner coach cannot approve another coach'
);

select is(
  private.decide_group_join_request(
    '10000000-0000-0000-0000-000000000011',
    (select (payload ->> 'request_id')::uuid from task5_results where result_name = 'coach_request'),
    'approved'
  ) ->> 'status',
  'approved',
  'only the owner approves coach access'
);

select is(
  private.remove_group_member(
    '10000000-0000-0000-0000-000000000013',
    '20000000-0000-0000-0000-000000000011',
    '10000000-0000-0000-0000-000000000014'
  ) ->> 'status',
  'removed',
  'a group coach removes an ordinary member'
);
select ok(
  not private.is_active_group_member(
    '20000000-0000-0000-0000-000000000011',
    '10000000-0000-0000-0000-000000000014'
  ),
  'removed membership loses access immediately'
);

select throws_ok(
  $$
    select private.remove_group_member(
      '10000000-0000-0000-0000-000000000013',
      '20000000-0000-0000-0000-000000000011',
      '10000000-0000-0000-0000-000000000015'
    )
  $$,
  'PT403',
  null,
  'a non-owner coach cannot remove another coach'
);

select is(
  private.transfer_group_ownership(
    '10000000-0000-0000-0000-000000000011',
    '20000000-0000-0000-0000-000000000011',
    '10000000-0000-0000-0000-000000000012'
  ) ->> 'status',
  'transferred',
  'the owner transfers ownership to another practitioner'
);
select ok(
  private.is_group_owner(
    '20000000-0000-0000-0000-000000000011',
    '10000000-0000-0000-0000-000000000012'
  ),
  'ownership transfer promotes the recipient to an active coach membership'
);
select is(
  (select count(*)::integer
     from private.group_ownership_audit
    where group_id = '20000000-0000-0000-0000-000000000011'
      and previous_owner_id = '10000000-0000-0000-0000-000000000011'
      and new_owner_id = '10000000-0000-0000-0000-000000000012'
      and changed_by = '10000000-0000-0000-0000-000000000011'),
  1,
  'ownership transfer records one immutable audit event'
);

select throws_ok(
  $$
    select private.leave_group(
      '10000000-0000-0000-0000-000000000012',
      '20000000-0000-0000-0000-000000000011'
    )
  $$,
  'P0001',
  'owner_must_transfer',
  'an owner cannot leave before transferring ownership'
);

select is(
  private.remove_group_member(
    '10000000-0000-0000-0000-000000000012',
    '20000000-0000-0000-0000-000000000011',
    '10000000-0000-0000-0000-000000000015'
  ) ->> 'status',
  'removed',
  'the new owner can remove a coach'
);

select is(
  private.update_group(
    '10000000-0000-0000-0000-000000000012',
    '20000000-0000-0000-0000-000000000011',
    'Grupo Local Atualizado',
    null,
    'Salvador',
    false
  ) ->> 'status',
  'updated',
  'only the current owner updates group settings'
);

select is(
  private.archive_group(
    '10000000-0000-0000-0000-000000000012',
    '20000000-0000-0000-0000-000000000011'
  ) ->> 'status',
  'archived',
  'only the current owner archives the group'
);
select ok(
  not private.is_group_coach(
    '20000000-0000-0000-0000-000000000011',
    '10000000-0000-0000-0000-000000000013'
  ),
  'archiving a group immediately closes coach access'
);

select ok(
  not exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and p.prosecdef
       and not ('search_path=""' = any(coalesce(p.proconfig, array[]::text[])))
  ),
  'every private definer function fixes an empty search path'
);

select ok(
  not exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'search_groups', 'resolve_group_discovery_token',
         'list_group_roster', 'list_my_member_invitations'
       )
       and p.prosecdef
  ),
  'public projection wrappers remain security invokers'
);

select * from finish();
rollback;
