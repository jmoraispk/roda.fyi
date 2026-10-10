-- supabase/migrations/202610100003_catalog_curation.sql
create table public.catalog_curators (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default now()
);

create table public.catalog_term_mappings (
  term text primary key,
  action text,
  target_slug text,
  target_term text,
  needs_video boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint catalog_term_mappings_term_check check (term ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint catalog_term_mappings_action_check check (
    (action is null and target_slug is null and target_term is null)
    or (action = 'alias' and target_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and target_term is null)
    or (action = 'merge' and target_term ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and target_slug is null)
    or (action = 'ignore' and target_slug is null and target_term is null)
  )
);

alter table public.catalog_curators enable row level security;
alter table public.catalog_term_mappings enable row level security;
create policy catalog_curators_select_self on public.catalog_curators
for select to authenticated using (profile_id = auth.uid());
create policy catalog_term_mappings_select_all on public.catalog_term_mappings
for select to anon, authenticated using (true);
revoke all on table public.catalog_curators, public.catalog_term_mappings from public, anon, authenticated;
grant select on table public.catalog_curators to authenticated;
grant select on table public.catalog_term_mappings to anon, authenticated;

create function private.is_catalog_curator(actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select actor_id is not null
     and exists (select 1 from public.catalog_curators curator where curator.profile_id = actor_id);
$$;

create function private.require_catalog_curator(actor_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_catalog_curator(actor_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
end;
$$;

create function private.require_term(value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if value is null or value !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception using errcode = 'P0001', message = 'invalid_term';
  end if;
  return value;
end;
$$;

-- Allow the curator relink function, and only it, to change movement keys of immutable rows.
create or replace function private.protect_published_plan_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_round_id uuid;
begin
  if tg_op = 'UPDATE'
     and current_setting('roda.catalog_relink', true) = 'on'
     and (old.id, old.plan_round_id, old.position, old.movement_name_snapshot, old.side,
          old.repetitions, old.duration_seconds, old.instructions, old.segment_key)
         is not distinct from
         (new.id, new.plan_round_id, new.position, new.movement_name_snapshot, new.side,
          new.repetitions, new.duration_seconds, new.instructions, new.segment_key) then
    return new;
  end if;
  target_round_id := case when tg_op = 'DELETE' then old.plan_round_id else new.plan_round_id end;
  if exists (
    select 1
      from public.workout_plan_rounds round
      join public.workout_plan_versions version on version.id = round.plan_version_id
     where round.id = target_round_id and version.published_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'published_plan_immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function private.protect_completed_occurrence_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_round_id uuid;
declare target_occurrence_id uuid;
begin
  if tg_op = 'UPDATE'
     and current_setting('roda.catalog_relink', true) = 'on'
     and (old.id, old.occurrence_round_id, old.position, old.movement_name_snapshot, old.side,
          old.repetitions, old.duration_seconds, old.instructions, old.segment_key)
         is not distinct from
         (new.id, new.occurrence_round_id, new.position, new.movement_name_snapshot, new.side,
          new.repetitions, new.duration_seconds, new.instructions, new.segment_key) then
    return new;
  end if;
  target_round_id := case when tg_op = 'DELETE' then old.occurrence_round_id else new.occurrence_round_id end;
  select round.occurrence_id into target_occurrence_id
    from public.training_occurrence_rounds round where round.id = target_round_id;
  if private.occurrence_is_completed(target_occurrence_id) then
    raise exception using errcode = 'P0001', message = 'completed_training_immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function private.relink_uncatalogued(source_term text, target_key text, mark_catalogued boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare occurrence_count integer;
declare plan_count integer;
begin
  perform set_config('roda.catalog_relink', 'on', true);
  update public.training_occurrence_movements
     set movement_key = target_key, catalogued = mark_catalogued
   where movement_key = source_term and not catalogued;
  get diagnostics occurrence_count = row_count;
  update public.workout_plan_movements
     set movement_key = target_key, catalogued = mark_catalogued
   where movement_key = source_term and not catalogued;
  get diagnostics plan_count = row_count;
  perform set_config('roda.catalog_relink', 'off', true);
  return occurrence_count + plan_count;
end;
$$;

create function private.upsert_term_mapping(
  actor_id uuid, source_term text, new_action text, new_target_slug text, new_target_term text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.catalog_term_mappings (term, action, target_slug, target_term, updated_by, updated_at)
  values (source_term, new_action, new_target_slug, new_target_term, actor_id, now())
  on conflict (term) do update
     set action = excluded.action, target_slug = excluded.target_slug,
         target_term = excluded.target_term, updated_by = excluded.updated_by,
         updated_at = excluded.updated_at;
$$;

create function private.map_catalog_term(actor_id uuid, source_term text, new_target_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare relinked integer;
begin
  perform private.require_catalog_curator(actor_id);
  perform private.require_term(source_term);
  perform private.require_term(new_target_slug);
  perform private.upsert_term_mapping(actor_id, source_term, 'alias', new_target_slug, null);
  relinked := private.relink_uncatalogued(source_term, new_target_slug, true);
  return jsonb_build_object('status', 'saved', 'relinked', relinked);
end;
$$;

create function private.merge_catalog_term(actor_id uuid, source_term text, new_target_term text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare relinked integer;
begin
  perform private.require_catalog_curator(actor_id);
  perform private.require_term(source_term);
  perform private.require_term(new_target_term);
  if source_term = new_target_term then
    raise exception using errcode = 'P0001', message = 'invalid_term';
  end if;
  perform private.upsert_term_mapping(actor_id, source_term, 'merge', null, new_target_term);
  relinked := private.relink_uncatalogued(source_term, new_target_term, false);
  return jsonb_build_object('status', 'saved', 'relinked', relinked);
end;
$$;

create function private.ignore_catalog_term(actor_id uuid, source_term text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_catalog_curator(actor_id);
  perform private.require_term(source_term);
  perform private.upsert_term_mapping(actor_id, source_term, 'ignore', null, null);
  return jsonb_build_object('status', 'saved');
end;
$$;

create function private.set_catalog_term_needs_video(actor_id uuid, source_term text, flag boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_catalog_curator(actor_id);
  perform private.require_term(source_term);
  insert into public.catalog_term_mappings (term, needs_video, updated_by, updated_at)
  values (source_term, coalesce(flag, false), actor_id, now())
  on conflict (term) do update
     set needs_video = excluded.needs_video, updated_by = excluded.updated_by,
         updated_at = excluded.updated_at;
  return jsonb_build_object('status', 'saved');
end;
$$;

create function private.list_uncatalogued_terms(actor_id uuid)
returns table (
  term text, spelling text, people bigint, uses bigint,
  first_seen timestamptz, last_seen timestamptz, needs_video boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_catalog_curator(actor_id);
  return query
  with uses as (
    select movement.movement_key term, movement.movement_name_snapshot spelling,
           participation.profile_id person, movement.created_at seen
      from public.training_occurrence_movements movement
      join public.training_occurrence_rounds round on round.id = movement.occurrence_round_id
      join public.training_participations participation
        on participation.occurrence_id = round.occurrence_id
     where not movement.catalogued
    union all
    select movement.movement_key, movement.movement_name_snapshot,
           plan.creator_profile_id, movement.created_at
      from public.workout_plan_movements movement
      join public.workout_plan_rounds round on round.id = movement.plan_round_id
      join public.workout_plan_versions version on version.id = round.plan_version_id
      join public.workout_plans plan on plan.id = version.plan_id
     where not movement.catalogued
  )
  select uses.term,
         mode() within group (order by uses.spelling),
         count(distinct uses.person)::bigint,
         count(*)::bigint,
         min(uses.seen), max(uses.seen),
         coalesce(bool_or(mapping.needs_video), false)
    from uses
    left join public.catalog_term_mappings mapping on mapping.term = uses.term
   where mapping.action is null
   group by uses.term
   order by count(distinct uses.person) desc, count(*) desc, uses.term;
end;
$$;

create function public.am_i_catalog_curator()
returns boolean language sql stable set search_path = ''
as $$ select private.is_catalog_curator(auth.uid()); $$;
create function public.list_uncatalogued_terms()
returns table (
  term text, spelling text, people bigint, uses bigint,
  first_seen timestamptz, last_seen timestamptz, needs_video boolean
)
language sql stable set search_path = ''
as $$ select * from private.list_uncatalogued_terms(auth.uid()); $$;
create function public.map_catalog_term(term text, target_slug text)
returns jsonb language sql set search_path = ''
as $$ select private.map_catalog_term(auth.uid(), term, target_slug); $$;
create function public.merge_catalog_term(term text, target_term text)
returns jsonb language sql set search_path = ''
as $$ select private.merge_catalog_term(auth.uid(), term, target_term); $$;
create function public.ignore_catalog_term(term text)
returns jsonb language sql set search_path = ''
as $$ select private.ignore_catalog_term(auth.uid(), term); $$;
create function public.set_catalog_term_needs_video(term text, needs_video boolean)
returns jsonb language sql set search_path = ''
as $$ select private.set_catalog_term_needs_video(auth.uid(), term, needs_video); $$;

revoke execute on function private.is_catalog_curator(uuid) from public, anon, authenticated;
revoke execute on function private.require_catalog_curator(uuid) from public, anon, authenticated;
revoke execute on function private.require_term(text) from public, anon, authenticated;
revoke execute on function private.relink_uncatalogued(text, text, boolean) from public, anon, authenticated;
revoke execute on function private.upsert_term_mapping(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function private.map_catalog_term(uuid, text, text) from public, anon, authenticated;
revoke execute on function private.merge_catalog_term(uuid, text, text) from public, anon, authenticated;
revoke execute on function private.ignore_catalog_term(uuid, text) from public, anon, authenticated;
revoke execute on function private.set_catalog_term_needs_video(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function private.list_uncatalogued_terms(uuid) from public, anon, authenticated;
grant execute on function private.is_catalog_curator(uuid) to authenticated;
grant execute on function private.map_catalog_term(uuid, text, text) to authenticated;
grant execute on function private.merge_catalog_term(uuid, text, text) to authenticated;
grant execute on function private.ignore_catalog_term(uuid, text) to authenticated;
grant execute on function private.set_catalog_term_needs_video(uuid, text, boolean) to authenticated;
grant execute on function private.list_uncatalogued_terms(uuid) to authenticated;
revoke execute on function public.am_i_catalog_curator() from public, anon, authenticated;
revoke execute on function public.list_uncatalogued_terms() from public, anon, authenticated;
revoke execute on function public.map_catalog_term(text, text) from public, anon, authenticated;
revoke execute on function public.merge_catalog_term(text, text) from public, anon, authenticated;
revoke execute on function public.ignore_catalog_term(text) from public, anon, authenticated;
revoke execute on function public.set_catalog_term_needs_video(text, boolean) from public, anon, authenticated;
grant execute on function public.am_i_catalog_curator() to authenticated;
grant execute on function public.list_uncatalogued_terms() to authenticated;
grant execute on function public.map_catalog_term(text, text) to authenticated;
grant execute on function public.merge_catalog_term(text, text) to authenticated;
grant execute on function public.ignore_catalog_term(text) to authenticated;
grant execute on function public.set_catalog_term_needs_video(text, boolean) to authenticated;
