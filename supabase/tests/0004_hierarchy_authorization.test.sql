\set ON_ERROR_STOP on
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED

select no_plan();

select tests.create_user('10000000-0000-0000-0000-000000000031', 'local@example.test', 'Local Owner');
select tests.create_user('10000000-0000-0000-0000-000000000032', 'regional@example.test', 'Regional Owner');
select tests.create_user('10000000-0000-0000-0000-000000000033', 'global@example.test', 'Global Owner');
select tests.create_user('10000000-0000-0000-0000-000000000034', 'other@example.test', 'Other Coach');

insert into public.coach_profiles (profile_id)
values
  ('10000000-0000-0000-0000-000000000031'),
  ('10000000-0000-0000-0000-000000000032'),
  ('10000000-0000-0000-0000-000000000033'),
  ('10000000-0000-0000-0000-000000000034');

insert into public.groups (id, owner_id, name)
values
  ('20000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000031', 'Grupo Local'),
  ('20000000-0000-0000-0000-000000000032', '10000000-0000-0000-0000-000000000032', 'Grupo Regional'),
  ('20000000-0000-0000-0000-000000000033', '10000000-0000-0000-0000-000000000033', 'Grupo Global'),
  ('20000000-0000-0000-0000-000000000034', '10000000-0000-0000-0000-000000000034', 'Grupo Alternativo');

insert into public.group_memberships (group_id, profile_id, access_level)
values
  ('20000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000031', 'coach'),
  ('20000000-0000-0000-0000-000000000032', '10000000-0000-0000-0000-000000000032', 'coach'),
  ('20000000-0000-0000-0000-000000000033', '10000000-0000-0000-0000-000000000033', 'coach'),
  ('20000000-0000-0000-0000-000000000034', '10000000-0000-0000-0000-000000000034', 'coach');

create temporary table task6_results (
  result_name text primary key,
  payload jsonb not null
) on commit drop;

select throws_ok(
  $$
    select private.invite_child_group(
      '10000000-0000-0000-0000-000000000034',
      '20000000-0000-0000-0000-000000000032',
      '20000000-0000-0000-0000-000000000031'
    )
  $$,
  'PT403',
  null,
  'only the proposed parent owner can invite a child group'
);

insert into task6_results values (
  'regional_local',
  private.invite_child_group(
    '10000000-0000-0000-0000-000000000032',
    '20000000-0000-0000-0000-000000000032',
    '20000000-0000-0000-0000-000000000031'
  )
);

select results_eq(
  $$
    select state::text, sharing_level::text,
           expires_at between created_at + interval '29 days 23 hours'
                          and created_at + interval '30 days 1 hour'
      from public.group_relationships
     where id = (
       select (payload ->> 'relationship_id')::uuid
         from task6_results where result_name = 'regional_local'
     )
  $$,
  $$ values ('pending'::text, 'named_progress'::text, true) $$,
  'hierarchy invitations start pending with named progress and a thirty-day expiry'
);

select throws_ok(
  format(
    'select private.decide_group_relationship(%L::uuid, %L::uuid, %L)',
    '10000000-0000-0000-0000-000000000032',
    (select payload ->> 'relationship_id' from task6_results where result_name = 'regional_local'),
    'accepted'
  ),
  'PT403',
  null,
  'only the child owner accepts a parent invitation'
);

select is(
  private.decide_group_relationship(
    '10000000-0000-0000-0000-000000000031',
    (select (payload ->> 'relationship_id')::uuid from task6_results where result_name = 'regional_local'),
    'accepted'
  ) ->> 'status',
  'active',
  'the child owner activates the parent relationship'
);

select ok(
  private.has_named_parent_progress(
    '10000000-0000-0000-0000-000000000032',
    '20000000-0000-0000-0000-000000000031'
  ),
  'an immediate-parent coach receives named progress access'
);
select ok(
  not private.has_full_parent_coaching(
    '10000000-0000-0000-0000-000000000032',
    '20000000-0000-0000-0000-000000000031'
  ),
  'named progress does not grant full coaching access'
);

insert into task6_results values (
  'global_regional',
  private.invite_child_group(
    '10000000-0000-0000-0000-000000000033',
    '20000000-0000-0000-0000-000000000033',
    '20000000-0000-0000-0000-000000000032'
  )
);
select is(
  private.decide_group_relationship(
    '10000000-0000-0000-0000-000000000032',
    (select (payload ->> 'relationship_id')::uuid from task6_results where result_name = 'global_regional'),
    'accepted'
  ) ->> 'status',
  'active',
  'a second level creates a valid local-regional-global chain'
);

select ok(
  private.is_group_ancestor(
    '20000000-0000-0000-0000-000000000033',
    '20000000-0000-0000-0000-000000000031'
  ),
  'recursive ancestry recognizes a higher ancestor'
);
select ok(
  private.can_roll_up_anonymous_aggregate(
    '20000000-0000-0000-0000-000000000031',
    '20000000-0000-0000-0000-000000000033'
  ),
  'anonymous aggregate eligibility traverses the active hierarchy'
);
select ok(
  not private.has_named_parent_progress(
    '10000000-0000-0000-0000-000000000033',
    '20000000-0000-0000-0000-000000000031'
  ),
  'a grandparent coach receives no named raw-person access'
);
select ok(
  not private.has_full_parent_coaching(
    '10000000-0000-0000-0000-000000000033',
    '20000000-0000-0000-0000-000000000031'
  ),
  'a grandparent coach receives no full raw-person access'
);

select throws_ok(
  $$
    select private.invite_child_group(
      '10000000-0000-0000-0000-000000000031',
      '20000000-0000-0000-0000-000000000031',
      '20000000-0000-0000-0000-000000000033'
    )
  $$,
  'P0001',
  'relationship_cycle',
  'an indirect cycle is rejected'
);
select throws_ok(
  $$
    select private.invite_child_group(
      '10000000-0000-0000-0000-000000000031',
      '20000000-0000-0000-0000-000000000031',
      '20000000-0000-0000-0000-000000000031'
    )
  $$,
  'P0001',
  'relationship_cycle',
  'a self relationship is rejected'
);

insert into task6_results values (
  'alternate_local',
  private.invite_child_group(
    '10000000-0000-0000-0000-000000000034',
    '20000000-0000-0000-0000-000000000034',
    '20000000-0000-0000-0000-000000000031'
  )
);
select throws_ok(
  format(
    'select private.decide_group_relationship(%L::uuid, %L::uuid, %L)',
    '10000000-0000-0000-0000-000000000031',
    (select payload ->> 'relationship_id' from task6_results where result_name = 'alternate_local'),
    'accepted'
  ),
  'P0001',
  'active_parent_exists',
  'a child cannot activate a second parent'
);

select throws_ok(
  format(
    'select private.set_group_relationship_sharing(%L::uuid, %L::uuid, %L)',
    '10000000-0000-0000-0000-000000000032',
    (select payload ->> 'relationship_id' from task6_results where result_name = 'regional_local'),
    'full_coaching'
  ),
  'PT403',
  null,
  'the parent owner cannot change the child sharing choice'
);

select is(
  private.set_group_relationship_sharing(
    '10000000-0000-0000-0000-000000000031',
    (select (payload ->> 'relationship_id')::uuid from task6_results where result_name = 'regional_local'),
    'full_coaching'
  ) ->> 'status',
  'updated',
  'the child owner enables full coaching access'
);
select ok(
  private.has_full_parent_coaching(
    '10000000-0000-0000-0000-000000000032',
    '20000000-0000-0000-0000-000000000031'
  ),
  'the immediate-parent coach receives full access after the toggle'
);
select ok(
  not private.has_full_parent_coaching(
    '10000000-0000-0000-0000-000000000033',
    '20000000-0000-0000-0000-000000000031'
  ),
  'full coaching access still does not cascade to the grandparent'
);

select is(
  private.revoke_group_relationship(
    '10000000-0000-0000-0000-000000000032',
    (select (payload ->> 'relationship_id')::uuid from task6_results where result_name = 'regional_local')
  ) ->> 'status',
  'revoked',
  'either active relationship owner can revoke it'
);
select is(
  private.revoke_group_relationship(
    '10000000-0000-0000-0000-000000000032',
    (select (payload ->> 'relationship_id')::uuid from task6_results where result_name = 'regional_local')
  ) ->> 'status',
  'revoked',
  'retrying revocation returns the stable current state'
);
select ok(
  not private.has_named_parent_progress(
    '10000000-0000-0000-0000-000000000032',
    '20000000-0000-0000-0000-000000000031'
  ),
  'revocation removes named access immediately'
);
select ok(
  not private.can_roll_up_anonymous_aggregate(
    '20000000-0000-0000-0000-000000000031',
    '20000000-0000-0000-0000-000000000033'
  ),
  'revocation breaks the aggregate ancestor chain immediately'
);

select is(
  (select count(*)::integer
     from private.list_group_relationships(
       '20000000-0000-0000-0000-000000000031',
       '10000000-0000-0000-0000-000000000031'
     )),
  2,
  'a child owner can list its active and historical relationship rows'
);

select * from finish();
rollback;
