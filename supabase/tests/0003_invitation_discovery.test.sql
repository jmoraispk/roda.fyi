\set ON_ERROR_STOP on
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED

select no_plan();

select tests.create_user('10000000-0000-0000-0000-000000000021', 'owner@example.test', 'Owner');
select tests.create_user('10000000-0000-0000-0000-000000000022', 'student@example.test', 'Student');
select tests.create_user('10000000-0000-0000-0000-000000000023', 'other@example.test', 'Other');

insert into public.coach_profiles (profile_id)
values ('10000000-0000-0000-0000-000000000021');

insert into public.groups (id, owner_id, name, is_discoverable)
values (
  '20000000-0000-0000-0000-000000000021',
  '10000000-0000-0000-0000-000000000021',
  'Grupo Oculto',
  false
);

insert into public.group_memberships (group_id, profile_id, access_level)
values (
  '20000000-0000-0000-0000-000000000021',
  '10000000-0000-0000-0000-000000000021',
  'coach'
);

create temporary table task5_invitation_results (
  result_name text primary key,
  payload jsonb not null
) on commit drop;

insert into task5_invitation_results values (
  'discovery_one',
  private.rotate_group_discovery_link(
    '10000000-0000-0000-0000-000000000021',
    '20000000-0000-0000-0000-000000000021'
  )
);

select is(
  (select payload ->> 'status' from task5_invitation_results where result_name = 'discovery_one'),
  'created',
  'a coach creates a discovery link'
);
select is(
  (select count(*)::integer
     from private.resolve_group_discovery_token(
       (select payload ->> 'token' from task5_invitation_results where result_name = 'discovery_one')
     )),
  1,
  'the discovery token resolves an unlisted group without granting membership'
);
select ok(
  not private.is_active_group_member(
    '20000000-0000-0000-0000-000000000021',
    '10000000-0000-0000-0000-000000000022'
  ),
  'resolving a discovery link never grants membership'
);

select throws_ok(
  $$
    select private.request_group_access(
      '10000000-0000-0000-0000-000000000022',
      '20000000-0000-0000-0000-000000000021',
      'member',
      null
    )
  $$,
  'PT403',
  null,
  'an unlisted group rejects a request without its discovery token'
);

insert into task5_invitation_results values (
  'join_request',
  private.request_group_access(
    '10000000-0000-0000-0000-000000000022',
    '20000000-0000-0000-0000-000000000021',
    'member',
    (select payload ->> 'token' from task5_invitation_results where result_name = 'discovery_one')
  )
);

select is(
  private.request_group_access(
    '10000000-0000-0000-0000-000000000022',
    '20000000-0000-0000-0000-000000000021',
    'member',
    (select payload ->> 'token' from task5_invitation_results where result_name = 'discovery_one')
  ) ->> 'request_id',
  (select payload ->> 'request_id' from task5_invitation_results where result_name = 'join_request'),
  'retrying a pending access request returns the existing request'
);

select is(
  private.cancel_group_join_request(
    '10000000-0000-0000-0000-000000000022',
    (select (payload ->> 'request_id')::uuid from task5_invitation_results where result_name = 'join_request')
  ) ->> 'status',
  'cancelled',
  'a requester can cancel their pending request'
);

select throws_ok(
  $$
    select private.request_group_access(
      '10000000-0000-0000-0000-000000000023',
      '20000000-0000-0000-0000-000000000021',
      'coach',
      (select payload ->> 'token' from task5_invitation_results where result_name = 'discovery_one')
    )
  $$,
  'P0001',
  'coach_registration_required',
  'coach access requires prior coach registration'
);

insert into task5_invitation_results values (
  'member_invitation',
  private.create_member_invitation(
    '10000000-0000-0000-0000-000000000021',
    '20000000-0000-0000-0000-000000000021',
    '  STUDENT@example.test '
  )
);

select is(
  (select email from public.group_member_invitations
    where id = (
      select (payload ->> 'invitation_id')::uuid
        from task5_invitation_results
       where result_name = 'member_invitation'
    )),
  'student@example.test',
  'email-bound invitations are normalized before storage'
);
select ok(
  exists (
    select 1
      from public.group_member_invitations invitation
      join task5_invitation_results result
        on result.result_name = 'member_invitation'
     where invitation.id = (result.payload ->> 'invitation_id')::uuid
       and invitation.token_hash = extensions.digest(
         convert_to(result.payload ->> 'token', 'UTF8'),
         'sha256'
       )
       and encode(invitation.token_hash, 'hex') <> result.payload ->> 'token'
  ),
  'only the invitation token hash is stored'
);

select throws_ok(
  $$
    select private.accept_member_invitation(
      '10000000-0000-0000-0000-000000000023',
      (select payload ->> 'token' from task5_invitation_results where result_name = 'member_invitation')
    )
  $$,
  'P0001',
  'invitation_email_mismatch',
  'an email-bound invitation rejects another account'
);

select is(
  private.accept_member_invitation(
    '10000000-0000-0000-0000-000000000022',
    (select payload ->> 'token' from task5_invitation_results where result_name = 'member_invitation')
  ) ->> 'status',
  'accepted',
  'the intended student accepts the invitation atomically'
);
select ok(
  private.is_active_group_member(
    '20000000-0000-0000-0000-000000000021',
    '10000000-0000-0000-0000-000000000022'
  ),
  'invitation acceptance creates an active membership'
);
select is(
  private.accept_member_invitation(
    '10000000-0000-0000-0000-000000000022',
    (select payload ->> 'token' from task5_invitation_results where result_name = 'member_invitation')
  ) ->> 'status',
  'already_accepted',
  'the accepting student can retry safely'
);
select throws_ok(
  $$
    select private.accept_member_invitation(
      '10000000-0000-0000-0000-000000000023',
      (select payload ->> 'token' from task5_invitation_results where result_name = 'member_invitation')
    )
  $$,
  'P0001',
  'already_used',
  'another account cannot reuse an accepted invitation'
);

insert into task5_invitation_results values (
  'revoked_invitation',
  private.create_member_invitation(
    '10000000-0000-0000-0000-000000000021',
    '20000000-0000-0000-0000-000000000021',
    null
  )
);
select is(
  private.revoke_member_invitation(
    '10000000-0000-0000-0000-000000000021',
    (select (payload ->> 'invitation_id')::uuid from task5_invitation_results where result_name = 'revoked_invitation')
  ) ->> 'status',
  'revoked',
  'a group coach revokes a pending invitation'
);
select throws_ok(
  $$
    select private.accept_member_invitation(
      '10000000-0000-0000-0000-000000000023',
      (select payload ->> 'token' from task5_invitation_results where result_name = 'revoked_invitation')
    )
  $$,
  'P0001',
  'invitation_revoked',
  'a revoked invitation cannot be accepted'
);

insert into task5_invitation_results values (
  'discovery_two',
  private.rotate_group_discovery_link(
    '10000000-0000-0000-0000-000000000021',
    '20000000-0000-0000-0000-000000000021'
  )
);
select is(
  (select count(*)::integer
     from private.resolve_group_discovery_token(
       (select payload ->> 'token' from task5_invitation_results where result_name = 'discovery_one')
     )),
  0,
  'rotating a discovery link immediately invalidates the old token'
);

select is(
  private.revoke_group_discovery_link(
    '10000000-0000-0000-0000-000000000021',
    '20000000-0000-0000-0000-000000000021'
  ) ->> 'status',
  'revoked',
  'a coach revokes the active discovery link'
);
select is(
  (select count(*)::integer
     from private.resolve_group_discovery_token(
       (select payload ->> 'token' from task5_invitation_results where result_name = 'discovery_two')
     )),
  0,
  'revocation makes discovery resolution fail immediately'
);

select ok(
  not exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('private', 'public')
       and p.proname in (
         'list_group_join_requests', 'list_group_member_invitations'
       )
       and pg_catalog.pg_get_function_result(p.oid) ~ '(token_hash|owner_id)'
  ),
  'management projections never return token hashes or unrelated owner IDs'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000021', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (select count(*)::integer
     from public.list_group_member_invitations(
       '20000000-0000-0000-0000-000000000021'
     )),
  2,
  'a group coach reaches invitation history through the narrow management projection'
);
select throws_ok(
  $$ select * from public.group_member_invitations $$,
  '42501',
  null,
  'a group coach cannot read invitation token hashes from the base table'
);
select throws_ok(
  $$ select * from public.group_discovery_links $$,
  '42501',
  null,
  'a group coach cannot read discovery token hashes from the base table'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000023', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (select count(*)::integer
     from public.list_group_member_invitations(
       '20000000-0000-0000-0000-000000000021'
     )),
  0,
  'an outsider receives no group invitation management rows'
);

reset role;

select * from finish();
rollback;
