create function private.is_active_group_member(
  target_group_id uuid,
  target_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from public.groups g
      join public.group_memberships gm on gm.group_id = g.id
     where g.id = target_group_id
       and g.archived_at is null
       and gm.profile_id = target_profile_id
       and gm.state = 'active'
  ), false);
$$;

create function private.is_group_coach(
  target_group_id uuid,
  target_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from public.groups g
      join public.group_memberships gm on gm.group_id = g.id
     where g.id = target_group_id
       and g.archived_at is null
       and gm.profile_id = target_profile_id
       and gm.access_level = 'coach'
       and gm.state = 'active'
  ), false);
$$;

create function private.is_group_owner(
  target_group_id uuid,
  target_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from public.groups g
      join public.group_memberships gm
        on gm.group_id = g.id
       and gm.profile_id = g.owner_id
       and gm.access_level = 'coach'
       and gm.state = 'active'
     where g.id = target_group_id
       and g.owner_id = target_profile_id
       and g.archived_at is null
  ), false);
$$;

create function private.is_direct_coach_of(
  coach_id uuid,
  practitioner_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from public.groups g
      join public.group_memberships coach_membership
        on coach_membership.group_id = g.id
       and coach_membership.profile_id = coach_id
       and coach_membership.access_level = 'coach'
       and coach_membership.state = 'active'
      join public.group_memberships practitioner_membership
        on practitioner_membership.group_id = g.id
       and practitioner_membership.profile_id = practitioner_id
       and practitioner_membership.state = 'active'
     where g.archived_at is null
  ), false);
$$;

create function private.search_groups(
  search_text text default '',
  result_limit integer default 20,
  result_offset integer default 0
)
returns table (
  id uuid,
  slug text,
  name text,
  picture_path text,
  location text,
  description text,
  parent_name text,
  parent_slug text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    g.id,
    g.slug,
    g.name,
    g.picture_path,
    g.location,
    g.description,
    parent_group.name as parent_name,
    parent_group.slug as parent_slug
  from public.groups g
  left join public.group_relationships relationship
    on relationship.child_group_id = g.id
   and relationship.state = 'active'
  left join public.groups parent_group
    on parent_group.id = relationship.parent_group_id
   and parent_group.archived_at is null
   and parent_group.is_discoverable
  where g.archived_at is null
    and g.is_discoverable
    and (
      nullif(btrim(coalesce(search_text, '')), '') is null
      or extensions.unaccent(lower(g.name || ' ' || coalesce(g.location, '')))
        like '%' || extensions.unaccent(lower(btrim(search_text))) || '%'
    )
  order by g.name, g.id
  limit least(greatest(coalesce(result_limit, 20), 1), 50)
  offset greatest(coalesce(result_offset, 0), 0);
$$;

create function private.resolve_group_discovery_token(token text)
returns table (
  id uuid,
  slug text,
  name text,
  picture_path text,
  location text,
  description text,
  parent_name text,
  parent_slug text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    g.id,
    g.slug,
    g.name,
    g.picture_path,
    g.location,
    g.description,
    case when g.is_discoverable then parent_group.name end as parent_name,
    case when g.is_discoverable then parent_group.slug end as parent_slug
  from public.group_discovery_links link
  join public.groups g
    on g.id = link.group_id
   and g.archived_at is null
  left join public.group_relationships relationship
    on relationship.child_group_id = g.id
   and relationship.state = 'active'
  left join public.groups parent_group
    on parent_group.id = relationship.parent_group_id
   and parent_group.archived_at is null
   and parent_group.is_discoverable
  where link.state = 'active'
    and link.token_hash = extensions.digest(
      convert_to(coalesce(token, ''), 'UTF8'),
      'sha256'
    )
  limit 1;
$$;

create function private.list_group_roster(
  target_group_id uuid,
  actor_id uuid default auth.uid()
)
returns table (
  profile_id uuid,
  display_name text,
  picture_path text,
  access_level public.group_access_level,
  membership_state public.group_membership_state,
  joined_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.id,
    profile.display_name,
    profile.avatar_path,
    membership.access_level,
    membership.state,
    membership.joined_at
  from public.group_memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  where membership.group_id = target_group_id
    and private.is_group_coach(target_group_id, actor_id)
  order by
    case membership.access_level when 'coach' then 0 else 1 end,
    profile.display_name,
    profile.id;
$$;

create function private.list_my_member_invitations(
  actor_id uuid default auth.uid()
)
returns table (
  id uuid,
  group_id uuid,
  group_slug text,
  group_name text,
  picture_path text,
  email text,
  state public.group_member_invitation_state,
  expires_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    invitation.id,
    invitation.group_id,
    g.slug,
    g.name,
    g.picture_path,
    invitation.email,
    invitation.state,
    invitation.expires_at,
    invitation.created_at
  from auth.users account
  join public.group_member_invitations invitation
    on invitation.email = lower(btrim(account.email))
  join public.groups g
    on g.id = invitation.group_id
   and g.archived_at is null
  where account.id = actor_id
    and invitation.email is not null
  order by invitation.created_at desc, invitation.id;
$$;

create function public.search_groups(
  search_text text default '',
  result_limit integer default 20,
  result_offset integer default 0
)
returns table (
  id uuid,
  slug text,
  name text,
  picture_path text,
  location text,
  description text,
  parent_name text,
  parent_slug text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
    from private.search_groups(search_text, result_limit, result_offset);
$$;

create function public.resolve_group_discovery_token(token text)
returns table (
  id uuid,
  slug text,
  name text,
  picture_path text,
  location text,
  description text,
  parent_name text,
  parent_slug text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.resolve_group_discovery_token(token);
$$;

create function public.list_group_roster(group_id uuid)
returns table (
  profile_id uuid,
  display_name text,
  picture_path text,
  access_level public.group_access_level,
  membership_state public.group_membership_state,
  joined_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.list_group_roster(group_id, auth.uid());
$$;

create function public.list_my_member_invitations()
returns table (
  id uuid,
  group_id uuid,
  group_slug text,
  group_name text,
  picture_path text,
  email text,
  state public.group_member_invitation_state,
  expires_at timestamptz,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.list_my_member_invitations(auth.uid());
$$;

revoke execute on function private.is_active_group_member(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.is_group_coach(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.is_group_owner(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.is_direct_coach_of(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.search_groups(text, integer, integer) from public, anon, authenticated;
revoke execute on function private.resolve_group_discovery_token(text) from public, anon, authenticated;
revoke execute on function private.list_group_roster(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.list_my_member_invitations(uuid) from public, anon, authenticated;

revoke execute on function public.search_groups(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.resolve_group_discovery_token(text) from public, anon, authenticated;
revoke execute on function public.list_group_roster(uuid) from public, anon, authenticated;
revoke execute on function public.list_my_member_invitations() from public, anon, authenticated;
