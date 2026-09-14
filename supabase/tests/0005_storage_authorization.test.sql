\set ON_ERROR_STOP on
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED

select no_plan();
select set_config('storage.allow_delete_query', 'true', true);

select results_eq(
  $$
    select id, public, file_size_limit, allowed_mime_types
      from storage.buckets
     where id in ('group-pictures', 'profile-pictures')
     order by id
  $$,
  $$ values
    (
      'group-pictures'::text,
      false,
      5242880::bigint,
      array['image/jpeg', 'image/png', 'image/webp']::text[]
    ),
    (
      'profile-pictures'::text,
      false,
      5242880::bigint,
      array['image/jpeg', 'image/png', 'image/webp']::text[]
    )
  $$,
  'profile and group picture buckets are private with a five-megabyte image allowlist'
);

select has_function(
  'private',
  'can_read_profile_picture',
  array['text', 'uuid'],
  'profile-picture visibility helper exists'
);
select has_function(
  'private',
  'can_read_group_picture',
  array['text', 'uuid'],
  'group-picture visibility helper exists'
);

select tests.create_user('10000000-0000-0000-0000-000000000041', 'local-owner@example.test', 'Local Owner');
select tests.create_user('10000000-0000-0000-0000-000000000042', 'member@example.test', 'Member');
select tests.create_user('10000000-0000-0000-0000-000000000043', 'coach@example.test', 'Direct Coach');
select tests.create_user('10000000-0000-0000-0000-000000000044', 'parent@example.test', 'Parent Coach');
select tests.create_user('10000000-0000-0000-0000-000000000045', 'grandparent@example.test', 'Grandparent Coach');
select tests.create_user('10000000-0000-0000-0000-000000000046', 'outsider@example.test', 'Outsider');

insert into public.coach_profiles (profile_id)
values
  ('10000000-0000-0000-0000-000000000041'),
  ('10000000-0000-0000-0000-000000000043'),
  ('10000000-0000-0000-0000-000000000044'),
  ('10000000-0000-0000-0000-000000000045');

insert into public.groups (id, owner_id, name, is_discoverable, picture_path)
values
  (
    '20000000-0000-0000-0000-000000000041',
    '10000000-0000-0000-0000-000000000041',
    'Grupo Local',
    false,
    '20000000-0000-0000-0000-000000000041/51000000-0000-0000-0000-000000000041.png'
  ),
  (
    '20000000-0000-0000-0000-000000000042',
    '10000000-0000-0000-0000-000000000044',
    'Grupo Regional',
    false,
    null
  ),
  (
    '20000000-0000-0000-0000-000000000043',
    '10000000-0000-0000-0000-000000000045',
    'Grupo Global',
    false,
    null
  ),
  (
    '20000000-0000-0000-0000-000000000044',
    '10000000-0000-0000-0000-000000000041',
    'Grupo Publico',
    true,
    '20000000-0000-0000-0000-000000000044/51000000-0000-0000-0000-000000000044.webp'
  );

insert into public.group_memberships (group_id, profile_id, access_level)
values
  ('20000000-0000-0000-0000-000000000041', '10000000-0000-0000-0000-000000000041', 'coach'),
  ('20000000-0000-0000-0000-000000000041', '10000000-0000-0000-0000-000000000042', 'member'),
  ('20000000-0000-0000-0000-000000000041', '10000000-0000-0000-0000-000000000043', 'coach'),
  ('20000000-0000-0000-0000-000000000042', '10000000-0000-0000-0000-000000000044', 'coach'),
  ('20000000-0000-0000-0000-000000000043', '10000000-0000-0000-0000-000000000045', 'coach'),
  ('20000000-0000-0000-0000-000000000044', '10000000-0000-0000-0000-000000000041', 'coach');

insert into public.group_relationships (
  parent_group_id, child_group_id, state, sharing_level,
  decided_at, decided_by
)
values
  (
    '20000000-0000-0000-0000-000000000042',
    '20000000-0000-0000-0000-000000000041',
    'active', 'named_progress', now(),
    '10000000-0000-0000-0000-000000000041'
  ),
  (
    '20000000-0000-0000-0000-000000000043',
    '20000000-0000-0000-0000-000000000042',
    'active', 'full_coaching', now(),
    '10000000-0000-0000-0000-000000000044'
  );

update public.profiles
   set avatar_path = case id
     when '10000000-0000-0000-0000-000000000041'::uuid
       then '10000000-0000-0000-0000-000000000041/41000000-0000-0000-0000-000000000041.jpg'
     when '10000000-0000-0000-0000-000000000042'::uuid
       then '10000000-0000-0000-0000-000000000042/41000000-0000-0000-0000-000000000042.webp'
     else avatar_path
   end
 where id in (
   '10000000-0000-0000-0000-000000000041',
   '10000000-0000-0000-0000-000000000042'
 );

insert into storage.objects (bucket_id, name, owner_id)
values
  (
    'profile-pictures',
    '10000000-0000-0000-0000-000000000041/41000000-0000-0000-0000-000000000041.jpg',
    '10000000-0000-0000-0000-000000000041'
  ),
  (
    'profile-pictures',
    '10000000-0000-0000-0000-000000000042/41000000-0000-0000-0000-000000000042.webp',
    '10000000-0000-0000-0000-000000000042'
  ),
  (
    'group-pictures',
    '20000000-0000-0000-0000-000000000041/51000000-0000-0000-0000-000000000041.png',
    '10000000-0000-0000-0000-000000000041'
  ),
  (
    'group-pictures',
    '20000000-0000-0000-0000-000000000044/51000000-0000-0000-0000-000000000044.webp',
    '10000000-0000-0000-0000-000000000041'
  );

set local role anon;

select is(
  (select count(*)::integer
     from storage.objects
    where bucket_id = 'group-pictures'),
  1,
  'anonymous readers see only the discoverable group picture'
);
select is(
  (select count(*)::integer
     from storage.objects
    where bucket_id = 'profile-pictures'),
  0,
  'anonymous readers see no profile pictures'
);
select throws_ok(
  $$
    insert into storage.objects (bucket_id, name)
    values (
      'profile-pictures',
      '10000000-0000-0000-0000-000000000042/42000000-0000-0000-0000-000000000040.png'
    )
  $$,
  '42501',
  null,
  'anonymous users cannot upload pictures'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000042', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'profile-pictures',
      '10000000-0000-0000-0000-000000000042/42000000-0000-0000-0000-000000000042.png',
      '10000000-0000-0000-0000-000000000042'
    )
  $$,
  'a profile owner uploads beneath their own UUID prefix'
);
select is(
  public.set_my_profile_picture(
    '10000000-0000-0000-0000-000000000042/42000000-0000-0000-0000-000000000042.png'
  ) ->> 'status',
  'updated',
  'the checked profile RPC accepts the authorized uploaded path'
);
select lives_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'profile-pictures',
      '10000000-0000-0000-0000-000000000042/42000000-0000-0000-0000-000000000099.jpeg',
      '10000000-0000-0000-0000-000000000042'
    )
  $$,
  'a profile owner can create a second fresh object without overwriting the active picture'
);
with changed as (
  update storage.objects
     set metadata = jsonb_build_object('owner-update', true)
   where bucket_id = 'profile-pictures'
     and name = '10000000-0000-0000-0000-000000000042/42000000-0000-0000-0000-000000000099.jpeg'
   returning 1
)
select is(
  (select count(*)::integer from changed),
  1,
  'a profile owner can update an object under their own prefix'
);
with removed as (
  delete from storage.objects
   where bucket_id = 'profile-pictures'
     and name = '10000000-0000-0000-0000-000000000042/42000000-0000-0000-0000-000000000099.jpeg'
   returning 1
)
select is(
  (select count(*)::integer from removed),
  1,
  'a profile owner can delete an object under their own prefix'
);
select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'profile-pictures',
      '10000000-0000-0000-0000-000000000041/42000000-0000-0000-0000-000000000041.png',
      '10000000-0000-0000-0000-000000000042'
    )
  $$,
  '42501',
  null,
  'a profile owner cannot upload beneath another profile prefix'
);
select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'profile-pictures',
      '10000000-0000-0000-0000-000000000042/not-a-uuid.png',
      '10000000-0000-0000-0000-000000000042'
    )
  $$,
  '42501',
  null,
  'profile-picture filenames must be fresh UUIDs with approved extensions'
);
select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'group-pictures',
      '20000000-0000-0000-0000-000000000041/52000000-0000-0000-0000-000000000042.png',
      '10000000-0000-0000-0000-000000000042'
    )
  $$,
  '42501',
  null,
  'an ordinary member cannot upload a group picture'
);
with changed as (
  update storage.objects
     set metadata = jsonb_build_object('member-attempt', true)
   where bucket_id = 'group-pictures'
     and name = '20000000-0000-0000-0000-000000000041/51000000-0000-0000-0000-000000000041.png'
   returning 1
)
select is(
  (select count(*)::integer from changed),
  0,
  'an ordinary member cannot overwrite a group picture they can read'
);
select is(
  (select count(*)::integer
     from storage.objects
    where bucket_id = 'group-pictures'
      and name like '20000000-0000-0000-0000-000000000041/%'),
  1,
  'an active member reads their unlisted group picture'
);
select is(
  (select count(*)::integer
     from storage.objects
    where bucket_id = 'profile-pictures'
      and name = '10000000-0000-0000-0000-000000000041/41000000-0000-0000-0000-000000000041.jpg'),
  0,
  'an ordinary member cannot read another member profile picture through raw storage'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000043', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (select count(*)::integer
     from storage.objects
    where bucket_id = 'profile-pictures'
      and name = '10000000-0000-0000-0000-000000000042/42000000-0000-0000-0000-000000000042.png'),
  1,
  'a direct coach reads an active member profile picture'
);
select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'group-pictures',
      '20000000-0000-0000-0000-000000000041/52000000-0000-0000-0000-000000000043.png',
      '10000000-0000-0000-0000-000000000043'
    )
  $$,
  '42501',
  null,
  'a non-owner coach cannot upload a group picture'
);
with removed as (
  delete from storage.objects
   where bucket_id = 'group-pictures'
     and name = '20000000-0000-0000-0000-000000000041/51000000-0000-0000-0000-000000000041.png'
   returning 1
)
select is(
  (select count(*)::integer from removed),
  0,
  'a non-owner coach cannot delete a group picture they can read'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000044', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (select count(*)::integer
     from storage.objects
    where bucket_id = 'group-pictures'
      and name like '20000000-0000-0000-0000-000000000041/%'),
  1,
  'an authorized immediate-parent coach reads the unlisted child-group picture'
);
select is(
  (select count(*)::integer
     from storage.objects
    where bucket_id = 'profile-pictures'
      and name = '10000000-0000-0000-0000-000000000042/42000000-0000-0000-0000-000000000042.png'),
  1,
  'named immediate-parent progress includes the member profile picture'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000045', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (select count(*)::integer
     from storage.objects
    where bucket_id = 'group-pictures'
      and name like '20000000-0000-0000-0000-000000000041/%'),
  0,
  'a grandparent coach receives no raw child-group picture'
);
select is(
  (select count(*)::integer
     from storage.objects
    where bucket_id = 'profile-pictures'
      and name = '10000000-0000-0000-0000-000000000042/42000000-0000-0000-0000-000000000042.png'),
  0,
  'a grandparent coach receives no raw member profile picture'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000046', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (select count(*)::integer
     from storage.objects
    where bucket_id = 'profile-pictures'),
  0,
  'an outsider reads no private profile pictures'
);
with changed as (
  update storage.objects
     set metadata = jsonb_build_object('attempt', true)
   where bucket_id = 'profile-pictures'
     and name = '10000000-0000-0000-0000-000000000042/42000000-0000-0000-0000-000000000042.png'
   returning 1
)
select is(
  (select count(*)::integer from changed),
  0,
  'an unrelated account cannot overwrite another profile object'
);
with removed as (
  delete from storage.objects
   where bucket_id = 'profile-pictures'
     and name = '10000000-0000-0000-0000-000000000042/42000000-0000-0000-0000-000000000042.png'
   returning 1
)
select is(
  (select count(*)::integer from removed),
  0,
  'an unrelated account cannot delete another profile object'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000041', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'group-pictures',
      '20000000-0000-0000-0000-000000000041/52000000-0000-0000-0000-000000000041.webp',
      '10000000-0000-0000-0000-000000000041'
    )
  $$,
  'a group owner uploads beneath the owned group UUID prefix'
);
select is(
  public.set_group_picture(
    '20000000-0000-0000-0000-000000000041',
    '20000000-0000-0000-0000-000000000041/52000000-0000-0000-0000-000000000041.webp'
  ) ->> 'status',
  'updated',
  'the checked group RPC accepts the owned uploaded path'
);
select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'group-pictures',
      '20000000-0000-0000-0000-000000000042/52000000-0000-0000-0000-000000000044.webp',
      '10000000-0000-0000-0000-000000000041'
    )
  $$,
  '42501',
  null,
  'a group owner cannot upload beneath an unowned group prefix'
);
with changed as (
  update storage.objects
     set metadata = jsonb_build_object('owner-update', true)
   where bucket_id = 'group-pictures'
     and name = '20000000-0000-0000-0000-000000000041/52000000-0000-0000-0000-000000000041.webp'
   returning 1
)
select is(
  (select count(*)::integer from changed),
  1,
  'the current group owner can update an owned group object'
);
with removed as (
  delete from storage.objects
   where bucket_id = 'group-pictures'
     and name = '20000000-0000-0000-0000-000000000041/52000000-0000-0000-0000-000000000041.webp'
   returning 1
)
select is(
  (select count(*)::integer from removed),
  1,
  'the current group owner can delete an owned group object'
);

reset role;

select * from finish();
rollback;
