create function private.is_group_ancestor(
  ancestor_group_id uuid,
  descendant_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive descendants(group_id) as (
    select relationship.child_group_id
      from public.group_relationships relationship
      join public.groups parent_group
        on parent_group.id = relationship.parent_group_id
       and parent_group.archived_at is null
      join public.groups child_group
        on child_group.id = relationship.child_group_id
       and child_group.archived_at is null
     where relationship.parent_group_id = ancestor_group_id
       and relationship.state = 'active'

    union

    select relationship.child_group_id
      from public.group_relationships relationship
      join descendants current_level
        on current_level.group_id = relationship.parent_group_id
      join public.groups child_group
        on child_group.id = relationship.child_group_id
       and child_group.archived_at is null
     where relationship.state = 'active'
  )
  select ancestor_group_id is not null
     and descendant_group_id is not null
     and ancestor_group_id <> descendant_group_id
     and exists (
       select 1 from descendants
        where group_id = descendant_group_id
     );
$$;

create function private.can_roll_up_anonymous_aggregate(
  source_group_id uuid,
  ancestor_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.is_group_ancestor(ancestor_group_id, source_group_id),
    false
  );
$$;

create function private.has_named_parent_progress(
  target_coach_id uuid,
  target_child_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from public.group_relationships relationship
     where relationship.child_group_id = target_child_group_id
       and relationship.state = 'active'
       and private.is_group_coach(relationship.parent_group_id, target_coach_id)
  ), false);
$$;

create function private.has_full_parent_coaching(
  target_coach_id uuid,
  target_child_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from public.group_relationships relationship
     where relationship.child_group_id = target_child_group_id
       and relationship.state = 'active'
       and relationship.sharing_level = 'full_coaching'
       and private.is_group_coach(relationship.parent_group_id, target_coach_id)
  ), false);
$$;

create function private.invite_child_group(
  actor_id uuid,
  target_parent_group_id uuid,
  target_child_group_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  relationship public.group_relationships;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if not private.is_group_owner(target_parent_group_id, actor_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  if not exists (
    select 1 from public.groups g
     where g.id = target_child_group_id and g.archived_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'group_not_found';
  end if;
  if target_parent_group_id = target_child_group_id
     or private.is_group_ancestor(target_child_group_id, target_parent_group_id) then
    raise exception using errcode = 'P0001', message = 'relationship_cycle';
  end if;

  select *
    into relationship
    from public.group_relationships existing
   where existing.parent_group_id = target_parent_group_id
     and existing.child_group_id = target_child_group_id
     and existing.state in ('pending', 'active')
   for update;
  if found and relationship.state = 'active' then
    return jsonb_build_object(
      'status', 'active',
      'relationship_id', relationship.id
    );
  end if;
  if found and relationship.expires_at > now() then
    return jsonb_build_object(
      'status', 'pending',
      'relationship_id', relationship.id
    );
  end if;
  if found then
    update public.group_relationships
       set state = 'expired'
     where id = relationship.id;
  end if;

  insert into public.group_relationships (
    parent_group_id,
    child_group_id,
    invited_by
  )
  values (
    target_parent_group_id,
    target_child_group_id,
    actor_id
  )
  returning * into relationship;

  return jsonb_build_object(
    'status', 'pending',
    'relationship_id', relationship.id,
    'parent_group_id', target_parent_group_id,
    'child_group_id', target_child_group_id
  );
end;
$$;

create function private.decide_group_relationship(
  actor_id uuid,
  target_relationship_id uuid,
  decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  relationship public.group_relationships;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if decision not in ('accepted', 'declined') then
    raise exception using errcode = 'P0001', message = 'invalid_decision';
  end if;

  select *
    into relationship
    from public.group_relationships existing
   where existing.id = target_relationship_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'relationship_not_found';
  end if;
  if not private.is_group_owner(relationship.child_group_id, actor_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;

  if relationship.state = 'active' and decision = 'accepted' then
    return jsonb_build_object('status', 'active', 'relationship_id', relationship.id);
  end if;
  if relationship.state = 'declined' and decision = 'declined' then
    return jsonb_build_object('status', 'declined', 'relationship_id', relationship.id);
  end if;
  if relationship.state <> 'pending' then
    return jsonb_build_object('status', relationship.state, 'relationship_id', relationship.id);
  end if;
  if relationship.expires_at <= now() then
    update public.group_relationships
       set state = 'expired'
     where id = relationship.id;
    return jsonb_build_object('status', 'expired', 'relationship_id', relationship.id);
  end if;

  perform 1
    from public.groups child_group
   where child_group.id = relationship.child_group_id
     and child_group.archived_at is null
   for update;
  if not found or not exists (
    select 1 from public.groups parent_group
     where parent_group.id = relationship.parent_group_id
       and parent_group.archived_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'group_not_found';
  end if;

  perform 1
    from public.group_relationships active_relationship
   where active_relationship.child_group_id = relationship.child_group_id
     and active_relationship.state = 'active'
   for update;

  if decision = 'declined' then
    update public.group_relationships
       set state = 'declined',
           decided_at = now(),
           decided_by = actor_id
     where id = relationship.id;
    return jsonb_build_object('status', 'declined', 'relationship_id', relationship.id);
  end if;

  if exists (
    select 1
      from public.group_relationships active_relationship
     where active_relationship.child_group_id = relationship.child_group_id
       and active_relationship.state = 'active'
       and active_relationship.id <> relationship.id
  ) then
    raise exception using errcode = 'P0001', message = 'active_parent_exists';
  end if;
  if relationship.parent_group_id = relationship.child_group_id
     or private.is_group_ancestor(
       relationship.child_group_id,
       relationship.parent_group_id
     ) then
    raise exception using errcode = 'P0001', message = 'relationship_cycle';
  end if;

  update public.group_relationships
     set state = 'active',
         sharing_level = 'named_progress',
         decided_at = now(),
         decided_by = actor_id
   where id = relationship.id;

  return jsonb_build_object('status', 'active', 'relationship_id', relationship.id);
end;
$$;

create function private.set_group_relationship_sharing(
  actor_id uuid,
  target_relationship_id uuid,
  new_sharing_level public.group_relationship_sharing
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  relationship public.group_relationships;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  select *
    into relationship
    from public.group_relationships existing
   where existing.id = target_relationship_id
   for update;
  if not found or relationship.state <> 'active' then
    raise exception using errcode = 'P0001', message = 'relationship_not_active';
  end if;
  if not private.is_group_owner(relationship.child_group_id, actor_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;

  update public.group_relationships
     set sharing_level = new_sharing_level
   where id = relationship.id;

  return jsonb_build_object(
    'status', 'updated',
    'relationship_id', relationship.id,
    'sharing_level', new_sharing_level
  );
end;
$$;

create function private.revoke_group_relationship(
  actor_id uuid,
  target_relationship_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  relationship public.group_relationships;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  select *
    into relationship
    from public.group_relationships existing
   where existing.id = target_relationship_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'relationship_not_found';
  end if;
  if not (
    private.is_group_owner(relationship.parent_group_id, actor_id)
    or private.is_group_owner(relationship.child_group_id, actor_id)
  ) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  if relationship.state = 'revoked' then
    return jsonb_build_object('status', 'revoked', 'relationship_id', relationship.id);
  end if;
  if relationship.state not in ('pending', 'active') then
    return jsonb_build_object('status', relationship.state, 'relationship_id', relationship.id);
  end if;

  update public.group_relationships
     set state = 'revoked',
         decided_at = coalesce(decided_at, now()),
         revoked_at = now(),
         revoked_by = actor_id
   where id = relationship.id;

  return jsonb_build_object('status', 'revoked', 'relationship_id', relationship.id);
end;
$$;

create function private.list_group_relationships(
  target_group_id uuid,
  actor_id uuid default auth.uid()
)
returns table (
  id uuid,
  parent_group_id uuid,
  child_group_id uuid,
  state public.group_relationship_state,
  sharing_level public.group_relationship_sharing,
  parent_name text,
  child_name text,
  expires_at timestamptz,
  decided_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    relationship.id,
    relationship.parent_group_id,
    relationship.child_group_id,
    relationship.state,
    relationship.sharing_level,
    parent_group.name,
    child_group.name,
    relationship.expires_at,
    relationship.decided_at,
    relationship.revoked_at,
    relationship.created_at
  from public.group_relationships relationship
  join public.groups parent_group on parent_group.id = relationship.parent_group_id
  join public.groups child_group on child_group.id = relationship.child_group_id
  where target_group_id in (
      relationship.parent_group_id,
      relationship.child_group_id
    )
    and private.is_group_coach(target_group_id, actor_id)
    and (
      relationship.state <> 'pending'
      or private.is_group_owner(relationship.parent_group_id, actor_id)
      or private.is_group_owner(relationship.child_group_id, actor_id)
    )
  order by relationship.created_at desc, relationship.id;
$$;

create function public.invite_child_group(
  parent_group_id uuid,
  child_group_id uuid
)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.invite_child_group(auth.uid(), $1, $2); $$;

create function public.decide_group_relationship(
  relationship_id uuid,
  decision text
)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.decide_group_relationship(auth.uid(), $1, $2); $$;

create function public.set_group_relationship_sharing(
  relationship_id uuid,
  sharing_level public.group_relationship_sharing
)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.set_group_relationship_sharing(auth.uid(), $1, $2); $$;

create function public.revoke_group_relationship(relationship_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.revoke_group_relationship(auth.uid(), $1); $$;

create function public.list_group_relationships(group_id uuid)
returns table (
  id uuid,
  parent_group_id uuid,
  child_group_id uuid,
  state public.group_relationship_state,
  sharing_level public.group_relationship_sharing,
  parent_name text,
  child_name text,
  expires_at timestamptz,
  decided_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$ select * from private.list_group_relationships($1, auth.uid()); $$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.invite_child_group(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.decide_group_relationship(uuid, text) from public, anon, authenticated;
revoke execute on function public.set_group_relationship_sharing(uuid, public.group_relationship_sharing) from public, anon, authenticated;
revoke execute on function public.revoke_group_relationship(uuid) from public, anon, authenticated;
revoke execute on function public.list_group_relationships(uuid) from public, anon, authenticated;
