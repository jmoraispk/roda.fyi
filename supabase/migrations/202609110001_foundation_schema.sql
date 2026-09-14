create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Supabase's optional automatic-RLS guard creates this event-trigger function
-- in public. Keep the guard active, but move its definer out of the exposed
-- Data API schema when it is present on the hosted project.
do $migration$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'alter function public.rls_auto_enable() set schema private';
  end if;
end
$migration$;

do $migration$
begin
  if to_regprocedure('private.rls_auto_enable()') is not null then
    execute 'revoke all on function private.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$migration$;

create type public.group_access_level as enum ('member', 'coach');
create type public.group_membership_state as enum ('active', 'left', 'removed');
create type public.group_join_request_state as enum (
  'pending', 'approved', 'declined', 'cancelled', 'expired'
);
create type public.group_member_invitation_state as enum (
  'pending', 'accepted', 'revoked', 'expired'
);
create type public.group_discovery_link_state as enum ('active', 'revoked');
create type public.group_relationship_state as enum (
  'pending', 'active', 'declined', 'revoked', 'expired'
);
create type public.group_relationship_sharing as enum (
  'named_progress', 'full_coaching'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_path text,
  timezone_override text,
  leaderboard_visible boolean not null default true,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_check check (
    display_name = btrim(display_name)
    and char_length(display_name) between 1 and 80
  ),
  constraint profiles_avatar_path_check check (
    avatar_path is null
    or (
      avatar_path = btrim(avatar_path)
      and char_length(avatar_path) between 1 and 512
    )
  ),
  constraint profiles_timezone_override_check check (
    timezone_override is null
    or (
      timezone_override = btrim(timezone_override)
      and char_length(timezone_override) between 1 and 64
    )
  )
);

create table public.coach_profiles (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  activated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default extensions.gen_random_uuid(),
  slug text not null unique,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  name text not null,
  description text,
  location text,
  picture_path text,
  is_discoverable boolean not null default true,
  archived_at timestamptz,
  archived_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint groups_slug_check check (
    slug = btrim(slug)
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{8}$'
    and char_length(slug) <= 140
  ),
  constraint groups_name_check check (
    name = btrim(name)
    and char_length(name) between 1 and 120
  ),
  constraint groups_description_check check (
    description is null
    or (
      description = btrim(description)
      and char_length(description) between 1 and 2000
    )
  ),
  constraint groups_location_check check (
    location is null
    or (
      location = btrim(location)
      and char_length(location) between 1 and 160
    )
  ),
  constraint groups_picture_path_check check (
    picture_path is null
    or (
      picture_path = btrim(picture_path)
      and char_length(picture_path) between 1 and 512
    )
  ),
  constraint groups_archive_state_check check (
    archived_at is not null or archived_by is null
  )
);

create table public.group_memberships (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  access_level public.group_access_level not null default 'member',
  state public.group_membership_state not null default 'active',
  joined_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_memberships_group_profile_key unique (group_id, profile_id),
  constraint group_memberships_end_state_check check (
    (state = 'active' and ended_at is null)
    or (state <> 'active' and ended_at is not null)
  )
);

create table public.group_join_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  requested_access public.group_access_level not null default 'member',
  state public.group_join_request_state not null default 'pending',
  expires_at timestamptz not null default (now() + interval '30 days'),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_join_requests_expiry_check check (expires_at > created_at),
  constraint group_join_requests_decision_state_check check (
    (state = 'pending' and decided_at is null and decided_by is null)
    or (state in ('approved', 'declined', 'cancelled') and decided_at is not null)
    or state = 'expired'
  )
);

create unique index group_join_requests_one_pending_idx
  on public.group_join_requests (group_id, profile_id, requested_access)
  where state = 'pending';
create index group_join_requests_group_state_idx
  on public.group_join_requests (group_id, state, created_at desc);
create index group_join_requests_profile_state_idx
  on public.group_join_requests (profile_id, state, created_at desc);

create table public.group_member_invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  email text,
  token_hash bytea not null unique,
  state public.group_member_invitation_state not null default 'pending',
  invited_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_member_invitations_email_check check (
    email is null
    or (
      email = lower(btrim(email))
      and char_length(email) between 3 and 320
      and position('@' in email) > 1
    )
  ),
  constraint group_member_invitations_token_hash_check check (
    octet_length(token_hash) = 32
  ),
  constraint group_member_invitations_expiry_check check (expires_at > created_at),
  constraint group_member_invitations_state_check check (
    (
      state = 'pending'
      and accepted_at is null
      and revoked_at is null
    )
    or (
      state = 'accepted'
      and accepted_at is not null
      and revoked_at is null
    )
    or (
      state = 'revoked'
      and accepted_at is null
      and revoked_at is not null
    )
    or (
      state = 'expired'
      and accepted_at is null
      and revoked_at is null
    )
  )
);

create index group_member_invitations_group_state_idx
  on public.group_member_invitations (group_id, state, created_at desc);
create index group_member_invitations_email_state_idx
  on public.group_member_invitations (email, state, created_at desc)
  where email is not null;

create table public.group_discovery_links (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  token_hash bytea not null unique,
  state public.group_discovery_link_state not null default 'active',
  created_by uuid references public.profiles(id) on delete set null,
  revoked_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_discovery_links_token_hash_check check (
    octet_length(token_hash) = 32
  ),
  constraint group_discovery_links_state_check check (
    (state = 'active' and revoked_at is null)
    or (state = 'revoked' and revoked_at is not null)
  )
);

create unique index group_discovery_links_one_active_idx
  on public.group_discovery_links (group_id)
  where state = 'active';

create table public.group_relationships (
  id uuid primary key default extensions.gen_random_uuid(),
  parent_group_id uuid not null references public.groups(id) on delete cascade,
  child_group_id uuid not null references public.groups(id) on delete cascade,
  state public.group_relationship_state not null default 'pending',
  sharing_level public.group_relationship_sharing not null default 'named_progress',
  invited_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '30 days'),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_relationships_distinct_groups_check check (
    parent_group_id <> child_group_id
  ),
  constraint group_relationships_expiry_check check (expires_at > created_at),
  constraint group_relationships_state_check check (
    (
      state = 'pending'
      and decided_at is null
      and revoked_at is null
    )
    or (
      state in ('active', 'declined')
      and decided_at is not null
      and revoked_at is null
    )
    or (
      state = 'revoked'
      and decided_at is not null
      and revoked_at is not null
    )
    or (
      state = 'expired'
      and revoked_at is null
    )
  )
);

create unique index group_relationships_one_active_parent_idx
  on public.group_relationships (child_group_id)
  where state = 'active';
create unique index group_relationships_one_open_pair_idx
  on public.group_relationships (parent_group_id, child_group_id)
  where state in ('pending', 'active');
create index group_relationships_parent_state_idx
  on public.group_relationships (parent_group_id, state, created_at desc);

create table private.group_ownership_audit (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  previous_owner_id uuid references public.profiles(id) on delete set null,
  new_owner_id uuid references public.profiles(id) on delete set null,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate_name text;
begin
  candidate_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), ''),
    'Capoeirista'
  );

  insert into public.profiles (id, display_name)
  values (new.id, left(candidate_name, 80))
  on conflict (id) do nothing;

  return new;
end;
$$;

create function private.normalize_group()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  slug_base text;
begin
  new.name := btrim(new.name);
  new.description := nullif(btrim(new.description), '');
  new.location := nullif(btrim(new.location), '');
  new.picture_path := nullif(btrim(new.picture_path), '');

  if tg_op = 'UPDATE' and new.slug is distinct from old.slug then
    raise exception using
      errcode = '23514',
      message = 'group_slug_immutable';
  end if;

  if tg_op = 'INSERT' then
    slug_base := lower(extensions.unaccent(new.name));
    slug_base := regexp_replace(slug_base, '[^a-z0-9]+', '-', 'g');
    slug_base := btrim(slug_base, '-');
    slug_base := left(coalesce(nullif(slug_base, ''), 'group'), 120);
    new.slug := slug_base || '-' || left(replace(new.id::text, '-', ''), 8);
  end if;

  return new;
end;
$$;

create function private.assert_group_owner_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  affected_group_id uuid;
begin
  affected_group_id := case
    when tg_table_name = 'groups' then coalesce(new.id, old.id)
    else coalesce(new.group_id, old.group_id)
  end;

  if exists (
    select 1
      from public.groups g
     where g.id = affected_group_id
       and g.archived_at is null
  ) and not exists (
    select 1
      from public.groups g
      join public.group_memberships gm
        on gm.group_id = g.id
       and gm.profile_id = g.owner_id
       and gm.access_level = 'coach'
       and gm.state = 'active'
     where g.id = affected_group_id
       and g.archived_at is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'group_owner_requires_active_coach_membership';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger coach_profiles_set_updated_at
before update on public.coach_profiles
for each row execute function private.set_updated_at();

create trigger groups_normalize
before insert or update on public.groups
for each row execute function private.normalize_group();

create trigger groups_set_updated_at
before update on public.groups
for each row execute function private.set_updated_at();

create trigger group_memberships_set_updated_at
before update on public.group_memberships
for each row execute function private.set_updated_at();

create trigger group_join_requests_set_updated_at
before update on public.group_join_requests
for each row execute function private.set_updated_at();

create trigger group_member_invitations_set_updated_at
before update on public.group_member_invitations
for each row execute function private.set_updated_at();

create trigger group_discovery_links_set_updated_at
before update on public.group_discovery_links
for each row execute function private.set_updated_at();

create trigger group_relationships_set_updated_at
before update on public.group_relationships
for each row execute function private.set_updated_at();

create trigger auth_user_create_profile
after insert on auth.users
for each row execute function private.handle_new_user();

create constraint trigger groups_owner_integrity
after insert or update of owner_id, archived_at on public.groups
deferrable initially deferred
for each row execute function private.assert_group_owner_integrity();

create constraint trigger memberships_owner_integrity
after insert or update of group_id, profile_id, access_level, state or delete
on public.group_memberships
deferrable initially deferred
for each row execute function private.assert_group_owner_integrity();

alter table public.profiles enable row level security;
alter table public.coach_profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_memberships enable row level security;
alter table public.group_join_requests enable row level security;
alter table public.group_member_invitations enable row level security;
alter table public.group_discovery_links enable row level security;
alter table public.group_relationships enable row level security;

alter table public.profiles force row level security;
alter table public.coach_profiles force row level security;
alter table public.groups force row level security;
alter table public.group_memberships force row level security;
alter table public.group_join_requests force row level security;
alter table public.group_member_invitations force row level security;
alter table public.group_discovery_links force row level security;
alter table public.group_relationships force row level security;

revoke all on table
  public.profiles,
  public.coach_profiles,
  public.groups,
  public.group_memberships,
  public.group_join_requests,
  public.group_member_invitations,
  public.group_discovery_links,
  public.group_relationships
from anon, authenticated;

revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated;

revoke all on table private.group_ownership_audit from public, anon, authenticated;
