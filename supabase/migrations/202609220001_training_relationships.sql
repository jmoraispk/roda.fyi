create type public.coach_connection_state as enum (
  'pending', 'active', 'declined', 'ended'
);

create table public.coach_student_connections (
  id uuid primary key default extensions.gen_random_uuid(),
  coach_profile_id uuid not null references public.coach_profiles(profile_id) on delete cascade,
  student_profile_id uuid not null references public.profiles(id) on delete cascade,
  state public.coach_connection_state not null default 'pending',
  initiated_by uuid not null references public.profiles(id) on delete restrict,
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  ended_at timestamptz,
  ended_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_student_connections_distinct_check
    check (coach_profile_id <> student_profile_id),
  constraint coach_student_connections_initiator_check
    check (initiated_by in (coach_profile_id, student_profile_id)),
  constraint coach_student_connections_state_check check (
    (state = 'pending' and decided_at is null and decided_by is null and ended_at is null and ended_by is null)
    or (state in ('active', 'declined') and decided_at is not null and decided_by is not null and ended_at is null and ended_by is null)
    or (state = 'ended' and decided_at is not null and decided_by is not null and ended_at is not null and ended_by is not null)
  )
);

create unique index coach_student_connections_open_pair_idx
  on public.coach_student_connections (coach_profile_id, student_profile_id)
  where state in ('pending', 'active');
create index coach_student_connections_student_state_idx
  on public.coach_student_connections (student_profile_id, state, created_at desc);

create trigger coach_student_connections_set_updated_at
before update on public.coach_student_connections
for each row execute function private.set_updated_at();

alter table public.coach_student_connections enable row level security;
revoke all on table public.coach_student_connections from public, anon, authenticated;

create function private.is_valid_timezone(candidate text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from pg_catalog.pg_timezone_names timezone_name
     where timezone_name.name = btrim(candidate)
  ), false);
$$;

create function private.validate_group_timezone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.timezone := btrim(coalesce(new.timezone, ''));
  if not private.is_valid_timezone(new.timezone) then
    raise exception using errcode = 'P0001', message = 'invalid_timezone';
  end if;
  return new;
end;
$$;

alter table public.groups add column timezone text not null default 'UTC';

create trigger groups_validate_timezone
before insert or update of timezone on public.groups
for each row execute function private.validate_group_timezone();

create function private.has_explicit_coaching_connection(
  coach_id uuid,
  student_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from public.coach_student_connections connection
     where connection.coach_profile_id = coach_id
       and connection.student_profile_id = student_id
       and connection.state = 'active'
  ), false);
$$;

create function private.has_group_coaching_connection(
  coach_id uuid,
  student_id uuid,
  context_group_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from public.groups target_group
      join public.group_memberships coach_membership
        on coach_membership.group_id = target_group.id
       and coach_membership.profile_id = coach_id
       and coach_membership.access_level = 'coach'
       and coach_membership.state = 'active'
      join public.group_memberships student_membership
        on student_membership.group_id = target_group.id
       and student_membership.profile_id = student_id
       and student_membership.state = 'active'
     where target_group.archived_at is null
       and (context_group_id is null or target_group.id = context_group_id)
  ), false);
$$;

create function private.can_coach_practitioner(
  coach_id uuid,
  student_id uuid,
  context_group_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_explicit_coaching_connection(coach_id, student_id)
      or private.has_group_coaching_connection(coach_id, student_id, context_group_id);
$$;

create or replace function private.is_direct_coach_of(
  coach_id uuid,
  practitioner_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_coach_practitioner(coach_id, practitioner_id, null);
$$;

create function private.request_coach_connection(
  actor_id uuid,
  target_coach_id uuid,
  target_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection public.coach_student_connections;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if actor_id not in (target_coach_id, target_student_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  if target_coach_id = target_student_id
     or not exists (select 1 from public.coach_profiles where profile_id = target_coach_id)
     or not exists (select 1 from public.profiles where id = target_student_id) then
    raise exception using errcode = 'P0001', message = 'invalid_connection';
  end if;

  select * into connection
    from public.coach_student_connections existing
   where existing.coach_profile_id = target_coach_id
     and existing.student_profile_id = target_student_id
     and existing.state in ('pending', 'active')
   for update;

  if found then
    return jsonb_build_object('status', connection.state, 'connection_id', connection.id);
  end if;

  insert into public.coach_student_connections (
    coach_profile_id, student_profile_id, initiated_by
  ) values (target_coach_id, target_student_id, actor_id)
  returning * into connection;

  return jsonb_build_object('status', connection.state, 'connection_id', connection.id);
end;
$$;

create function private.decide_coach_connection(
  actor_id uuid,
  target_connection_id uuid,
  decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection public.coach_student_connections;
  next_state public.coach_connection_state;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;

  select * into connection
    from public.coach_student_connections existing
   where existing.id = target_connection_id
   for update;
  if not found or actor_id not in (connection.coach_profile_id, connection.student_profile_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  if actor_id = connection.initiated_by then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  if connection.state <> 'pending' then
    return jsonb_build_object('status', connection.state, 'connection_id', connection.id);
  end if;

  next_state := case decision
    when 'accepted' then 'active'::public.coach_connection_state
    when 'declined' then 'declined'::public.coach_connection_state
    else null
  end;
  if next_state is null then
    raise exception using errcode = 'P0001', message = 'invalid_decision';
  end if;

  update public.coach_student_connections
     set state = next_state, decided_at = now(), decided_by = actor_id
   where id = connection.id
  returning * into connection;

  return jsonb_build_object('status', connection.state, 'connection_id', connection.id);
end;
$$;

create function private.end_coach_connection(
  actor_id uuid,
  target_connection_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection public.coach_student_connections;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  select * into connection
    from public.coach_student_connections existing
   where existing.id = target_connection_id
   for update;
  if not found or actor_id not in (connection.coach_profile_id, connection.student_profile_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  if connection.state = 'ended' then
    return jsonb_build_object('status', connection.state, 'connection_id', connection.id);
  end if;
  if connection.state <> 'active' then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;

  update public.coach_student_connections
     set state = 'ended', ended_at = now(), ended_by = actor_id
   where id = connection.id
  returning * into connection;
  return jsonb_build_object('status', connection.state, 'connection_id', connection.id);
end;
$$;

create function public.search_coaching_profiles(
  search_text text default '',
  candidate_role text default 'coach',
  result_limit integer default 20
)
returns table (
  profile_id uuid,
  display_name text,
  avatar_path text,
  candidate_role text
)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id, profile.display_name, profile.avatar_path, candidate_role
    from public.profiles profile
   where auth.uid() is not null
     and profile.id <> auth.uid()
     and candidate_role in ('coach', 'student')
     and (candidate_role = 'student' or exists (
       select 1 from public.coach_profiles coach where coach.profile_id = profile.id
     ))
     and (
       nullif(btrim(coalesce(search_text, '')), '') is null
       or extensions.unaccent(lower(profile.display_name))
          like '%' || extensions.unaccent(lower(btrim(search_text))) || '%'
     )
   order by profile.display_name, profile.id
   limit least(greatest(coalesce(result_limit, 20), 1), 50);
$$;

create function public.request_coach_connection(
  coach_profile_id uuid,
  student_profile_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.request_coach_connection(auth.uid(), $1, $2); $$;

create function public.decide_coach_connection(connection_id uuid, decision text)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.decide_coach_connection(auth.uid(), $1, $2); $$;

create function public.end_coach_connection(connection_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.end_coach_connection(auth.uid(), $1); $$;

create function public.list_my_coach_connections()
returns table (
  connection_id uuid,
  connection_kind text,
  coach_profile_id uuid,
  coach_display_name text,
  coach_avatar_path text,
  student_profile_id uuid,
  student_display_name text,
  student_avatar_path text,
  group_id uuid,
  group_name text,
  state text,
  initiated_by uuid,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    connection.id,
    'direct'::text,
    coach.id,
    coach.display_name,
    coach.avatar_path,
    student.id,
    student.display_name,
    student.avatar_path,
    null::uuid,
    null::text,
    connection.state::text,
    connection.initiated_by,
    connection.created_at
  from public.coach_student_connections connection
  join public.profiles coach on coach.id = connection.coach_profile_id
  join public.profiles student on student.id = connection.student_profile_id
  where auth.uid() in (connection.coach_profile_id, connection.student_profile_id)
  union all
  select
    null::uuid,
    'group'::text,
    coach.id,
    coach.display_name,
    coach.avatar_path,
    student.id,
    student.display_name,
    student.avatar_path,
    target_group.id,
    target_group.name,
    'active'::text,
    null::uuid,
    greatest(coach_membership.joined_at, student_membership.joined_at)
  from public.groups target_group
  join public.group_memberships coach_membership
    on coach_membership.group_id = target_group.id
   and coach_membership.access_level = 'coach'
   and coach_membership.state = 'active'
  join public.profiles coach on coach.id = coach_membership.profile_id
  join public.group_memberships student_membership
    on student_membership.group_id = target_group.id
   and student_membership.access_level = 'member'
   and student_membership.state = 'active'
  join public.profiles student on student.id = student_membership.profile_id
  where target_group.archived_at is null
    and auth.uid() in (coach.id, student.id)
  order by 13 desc, 2, 4, 7;
$$;

drop function public.create_group(text, text, text, boolean);
drop function private.create_group(uuid, text, text, text, boolean);

create function private.create_group(
  actor_id uuid,
  new_name text,
  new_description text,
  new_location text,
  new_is_discoverable boolean,
  new_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_group public.groups;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if not exists (select 1 from public.coach_profiles where profile_id = actor_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  if not private.is_valid_timezone(new_timezone) then
    raise exception using errcode = 'P0001', message = 'invalid_timezone';
  end if;

  insert into public.groups (
    owner_id, name, description, location, is_discoverable, timezone
  ) values (
    actor_id, new_name, new_description, new_location,
    coalesce(new_is_discoverable, true), btrim(new_timezone)
  ) returning * into created_group;

  insert into public.group_memberships (group_id, profile_id, access_level, state)
  values (created_group.id, actor_id, 'coach', 'active');

  return jsonb_build_object(
    'status', 'created', 'group_id', created_group.id, 'slug', created_group.slug
  );
end;
$$;

create function public.create_group(
  name text,
  description text,
  location text,
  is_discoverable boolean,
  timezone text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.create_group(auth.uid(), $1, $2, $3, $4, $5); $$;

drop function public.update_group(uuid, text, text, text, boolean);
drop function private.update_group(uuid, uuid, text, text, text, boolean);

create function private.update_group(
  actor_id uuid,
  target_group_id uuid,
  new_name text,
  new_description text,
  new_location text,
  new_is_discoverable boolean,
  new_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if not private.is_group_owner(target_group_id, actor_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  if not private.is_valid_timezone(new_timezone) then
    raise exception using errcode = 'P0001', message = 'invalid_timezone';
  end if;

  update public.groups
     set name = new_name,
         description = new_description,
         location = new_location,
         is_discoverable = coalesce(new_is_discoverable, true),
         timezone = btrim(new_timezone)
   where id = target_group_id and archived_at is null;

  return jsonb_build_object('status', 'updated', 'group_id', target_group_id);
end;
$$;

create function public.update_group(
  group_id uuid,
  name text,
  description text,
  location text,
  is_discoverable boolean,
  timezone text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.update_group(auth.uid(), $1, $2, $3, $4, $5, $6); $$;

create function private.set_group_timezone(
  actor_id uuid,
  target_group_id uuid,
  new_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if not private.is_group_owner(target_group_id, actor_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  if not private.is_valid_timezone(new_timezone) then
    raise exception using errcode = 'P0001', message = 'invalid_timezone';
  end if;
  update public.groups set timezone = btrim(new_timezone)
   where id = target_group_id and archived_at is null;
  return jsonb_build_object('status', 'updated', 'group_id', target_group_id);
end;
$$;

create function public.set_group_timezone(group_id uuid, timezone text)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.set_group_timezone(auth.uid(), $1, $2); $$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.has_explicit_coaching_connection(uuid, uuid) to authenticated;
grant execute on function private.has_group_coaching_connection(uuid, uuid, uuid) to authenticated;
grant execute on function private.can_coach_practitioner(uuid, uuid, uuid) to authenticated;
grant execute on function private.is_direct_coach_of(uuid, uuid) to authenticated;

revoke execute on function public.search_coaching_profiles(text, text, integer) from public, anon, authenticated;
revoke execute on function public.request_coach_connection(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.decide_coach_connection(uuid, text) from public, anon, authenticated;
revoke execute on function public.end_coach_connection(uuid) from public, anon, authenticated;
revoke execute on function public.list_my_coach_connections() from public, anon, authenticated;
revoke execute on function public.create_group(text, text, text, boolean, text) from public, anon, authenticated;
revoke execute on function public.update_group(uuid, text, text, text, boolean, text) from public, anon, authenticated;
revoke execute on function public.set_group_timezone(uuid, text) from public, anon, authenticated;

grant execute on function public.search_coaching_profiles(text, text, integer) to authenticated;
grant execute on function public.request_coach_connection(uuid, uuid) to authenticated;
grant execute on function public.decide_coach_connection(uuid, text) to authenticated;
grant execute on function public.end_coach_connection(uuid) to authenticated;
grant execute on function public.list_my_coach_connections() to authenticated;
grant execute on function public.create_group(text, text, text, boolean, text) to authenticated;
grant execute on function public.update_group(uuid, text, text, text, boolean, text) to authenticated;
grant execute on function public.set_group_timezone(uuid, text) to authenticated;
