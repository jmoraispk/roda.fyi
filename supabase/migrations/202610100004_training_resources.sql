-- supabase/migrations/202610100004_training_resources.sql
create table public.training_resources (
  id uuid primary key default extensions.gen_random_uuid(),
  occurrence_id uuid not null references public.training_occurrences(id) on delete cascade,
  kind text not null,
  title text,
  url text,
  body text,
  added_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_resources_kind_check check (kind in ('video', 'voice', 'summary')),
  constraint training_resources_title_check check (title is null or char_length(title) between 1 and 200),
  constraint training_resources_content_check check (
    (kind = 'video' and body is null and url ~ '^https://' and char_length(url) <= 2048)
    or (kind in ('voice', 'summary') and url is null
        and char_length(btrim(coalesce(body, ''))) between 1 and 262144)
  )
);
create index training_resources_occurrence_idx on public.training_resources (occurrence_id);
create trigger training_resources_set_updated_at
before update on public.training_resources
for each row execute function private.set_updated_at();

alter table public.training_resources enable row level security;
create policy training_resources_select_authorized
on public.training_resources for select to authenticated
using (exists (
  select 1 from public.training_occurrences occurrence
   where occurrence.id = training_resources.occurrence_id
     and (
       occurrence.recorded_by = auth.uid()
       or exists (
         select 1 from public.training_participations participation
          where participation.occurrence_id = occurrence.id
            and private.can_read_training(auth.uid(), participation.profile_id)
       )
     )
));
revoke all on table public.training_resources from public, anon, authenticated;
grant select on table public.training_resources to authenticated;

create function private.can_write_training_resources(actor_id uuid, target_occurrence_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select actor_id is not null and exists (
    select 1 from public.training_occurrences occurrence
     where occurrence.id = target_occurrence_id
       and (
         occurrence.recorded_by = actor_id
         or (occurrence.group_id is not null and private.is_group_coach(occurrence.group_id, actor_id))
       )
  );
$$;

create function private.add_training_resource(
  actor_id uuid, target_occurrence_id uuid, new_kind text, new_title text, new_url text, new_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare created_id uuid;
begin
  if not private.can_write_training_resources(actor_id, target_occurrence_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  insert into public.training_resources (occurrence_id, kind, title, url, body, added_by)
  values (
    target_occurrence_id, new_kind, nullif(btrim(coalesce(new_title, '')), ''),
    nullif(btrim(coalesce(new_url, '')), ''), new_body, actor_id
  ) returning id into created_id;
  return jsonb_build_object('status', 'saved', 'resource_id', created_id);
end;
$$;

create function private.update_training_resource(
  actor_id uuid, target_resource_id uuid, new_title text, new_url text, new_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target public.training_resources;
begin
  select * into target from public.training_resources where id = target_resource_id;
  if not found or target.added_by <> actor_id
     or not private.can_write_training_resources(actor_id, target.occurrence_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  update public.training_resources
     set title = nullif(btrim(coalesce(new_title, '')), ''),
         url = nullif(btrim(coalesce(new_url, '')), ''),
         body = new_body
   where id = target_resource_id;
  return jsonb_build_object('status', 'saved', 'resource_id', target_resource_id);
end;
$$;

create function private.delete_training_resource(actor_id uuid, target_resource_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target public.training_resources;
begin
  select * into target from public.training_resources where id = target_resource_id;
  if not found or target.added_by <> actor_id
     or not private.can_write_training_resources(actor_id, target.occurrence_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  delete from public.training_resources where id = target_resource_id;
  return jsonb_build_object('status', 'deleted', 'resource_id', target_resource_id);
end;
$$;

create function private.resources_json(actor_id uuid, target_occurrence_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', resource.id, 'kind', resource.kind, 'title', resource.title,
    'url', resource.url, 'body', resource.body, 'added_by', resource.added_by,
    'can_edit', resource.added_by = actor_id
  ) order by resource.created_at, resource.id), '[]'::jsonb)
  from public.training_resources resource
  where resource.occurrence_id = target_occurrence_id;
$$;

create function private.list_training_resource_kinds(
  actor_id uuid, range_start date, range_end_exclusive date, target_profile_id uuid
)
returns table (occurrence_id uuid, kinds text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare practitioner_id uuid := coalesce(target_profile_id, actor_id);
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if not private.can_read_training(actor_id, practitioner_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  return query
  select occurrence.id, array_agg(distinct resource.kind order by resource.kind)
    from public.training_participations participation
    join public.training_occurrences occurrence on occurrence.id = participation.occurrence_id
    join public.training_resources resource on resource.occurrence_id = occurrence.id
   where participation.profile_id = practitioner_id
     and occurrence.local_date >= range_start
     and occurrence.local_date < range_end_exclusive
   group by occurrence.id;
end;
$$;

create or replace function private.get_training_day(
  actor_id uuid,
  target_local_date date,
  target_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare practitioner_id uuid := coalesce(target_profile_id, actor_id);
declare result jsonb;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if not private.can_read_training(actor_id, practitioner_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  select coalesce(jsonb_agg(entry order by entry ->> 'starts_at'), '[]'::jsonb)
    into result
    from (
      select jsonb_build_object(
        'id', occurrence.id, 'occurrence_id', occurrence.id, 'item_type', 'completed',
        'kind', occurrence.kind::text, 'status', 'completed',
        'starts_at', occurrence.occurred_at,
        'duration_minutes', participation.actual_duration_minutes,
        'group_id', occurrence.group_id, 'group_name', target_group.name,
        'coach_profile_id', occurrence.recorded_by, 'coach_name', coach.display_name,
        'participation_id', participation.id,
        'personal_notes', participation.personal_notes,
        'rounds', private.occurrence_rounds_json(
          actor_id, occurrence.id, participation.id
        ),
        'feedback', private.feedback_json(actor_id, participation.id),
        'feedback_contexts', private.feedback_contexts_json(actor_id, participation.id),
        'resources', private.resources_json(actor_id, occurrence.id),
        'can_add_resources', private.can_write_training_resources(actor_id, occurrence.id)
      ) entry
      from public.training_participations participation
      join public.training_occurrences occurrence on occurrence.id = participation.occurrence_id
      left join public.groups target_group on target_group.id = occurrence.group_id
      left join public.profiles coach on coach.id = occurrence.recorded_by
      where participation.profile_id = practitioner_id
        and occurrence.local_date = target_local_date
    ) completed;
  return result;
end;
$$;

create function private.record_past_class(
  actor_id uuid,
  target_kind text,
  target_group_id uuid,
  target_student_profile_id uuid,
  target_connection_id uuid,
  target_occurred_at timestamptz,
  target_local_date date,
  target_timezone text,
  target_duration_minutes integer,
  attendees jsonb,
  actual_rounds jsonb,
  target_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare existing_occurrence public.training_occurrences;
declare created_occurrence public.training_occurrences;
declare attendee jsonb;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  select * into existing_occurrence from public.training_occurrences occurrence
   where occurrence.idempotency_key = target_idempotency_key;
  if found then
    if existing_occurrence.recorded_by = actor_id and existing_occurrence.schedule_id is null
       and existing_occurrence.kind::text = target_kind then
      return private.completion_response(existing_occurrence.id);
    end if;
    raise exception using errcode = 'P0001', message = 'duplicate_completion';
  end if;
  if target_occurred_at is null or target_occurred_at > now() then
    raise exception using errcode = 'P0001', message = 'past_class_in_future';
  end if;
  if target_duration_minutes is null or target_duration_minutes not between 1 and 1440 then
    raise exception using errcode = 'P0001', message = 'invalid_duration';
  end if;

  if target_kind = 'group' then
    if target_group_id is null or not private.is_group_coach(target_group_id, actor_id) then
      raise exception using errcode = 'PT403', message = 'not_authorized';
    end if;
    if jsonb_typeof(attendees) <> 'array' or jsonb_array_length(attendees) = 0 then
      raise exception using errcode = 'P0001', message = 'invalid_attendee';
    end if;
    for attendee in select value from jsonb_array_elements(attendees)
    loop
      if not private.is_active_group_member(target_group_id, (attendee ->> 'profile_id')::uuid)
         or coalesce((attendee ->> 'duration_minutes')::integer, 0) not between 1 and 1440 then
        raise exception using errcode = 'P0001', message = 'invalid_attendee';
      end if;
    end loop;
    if (select count(*) from jsonb_array_elements(attendees)) <>
       (select count(distinct value ->> 'profile_id') from jsonb_array_elements(attendees)) then
      raise exception using errcode = 'P0001', message = 'invalid_attendee';
    end if;
  elsif target_kind = 'personal_class' then
    if target_student_profile_id is null
       or ((target_group_id is not null)::integer + (target_connection_id is not null)::integer) <> 1 then
      raise exception using errcode = 'P0001', message = 'invalid_coaching_context';
    end if;
    if target_group_id is not null then
      if not private.can_coach_practitioner(actor_id, target_student_profile_id, target_group_id) then
        raise exception using errcode = 'PT403', message = 'not_authorized';
      end if;
    elsif not exists (
      select 1 from public.coach_student_connections connection
       where connection.id = target_connection_id
         and connection.coach_profile_id = actor_id
         and connection.student_profile_id = target_student_profile_id
         and connection.state = 'active'
    ) then
      raise exception using errcode = 'P0001', message = 'connection_ended';
    end if;
  else
    raise exception using errcode = 'P0001', message = 'invalid_training_kind';
  end if;

  insert into public.training_occurrences (
    kind, group_id, student_profile_id, recorded_by, occurred_at, local_date,
    timezone, default_duration_minutes, idempotency_key
  ) values (
    target_kind::public.training_kind, target_group_id,
    case when target_kind = 'personal_class' then target_student_profile_id end,
    actor_id, target_occurred_at, target_local_date, target_timezone,
    target_duration_minutes, target_idempotency_key
  ) returning * into created_occurrence;
  perform private.insert_occurrence_rounds(created_occurrence.id, actual_rounds);
  if target_kind = 'group' then
    insert into public.training_participations (
      occurrence_id, profile_id, actual_duration_minutes, confirmed_at, confirmed_by
    )
    select created_occurrence.id, (value ->> 'profile_id')::uuid,
           (value ->> 'duration_minutes')::integer, target_occurred_at, actor_id
      from jsonb_array_elements(attendees);
  else
    insert into public.training_participations (
      occurrence_id, profile_id, actual_duration_minutes, confirmed_at, confirmed_by
    ) values (
      created_occurrence.id, target_student_profile_id, target_duration_minutes,
      target_occurred_at, actor_id
    );
  end if;
  return private.completion_response(created_occurrence.id);
end;
$$;

create function public.add_training_resource(occurrence_id uuid, kind text, title text, url text, body text)
returns jsonb language sql set search_path = ''
as $$ select private.add_training_resource(auth.uid(), occurrence_id, kind, title, url, body); $$;
create function public.update_training_resource(resource_id uuid, title text, url text, body text)
returns jsonb language sql set search_path = ''
as $$ select private.update_training_resource(auth.uid(), resource_id, title, url, body); $$;
create function public.delete_training_resource(resource_id uuid)
returns jsonb language sql set search_path = ''
as $$ select private.delete_training_resource(auth.uid(), resource_id); $$;
create function public.list_training_resource_kinds(month_start date, month_end date, profile_id uuid default null)
returns table (occurrence_id uuid, kinds text[])
language sql stable set search_path = ''
as $$ select * from private.list_training_resource_kinds(auth.uid(), month_start, month_end, profile_id); $$;
create function public.record_past_class(
  kind text, group_id uuid, student_profile_id uuid, connection_id uuid,
  occurred_at timestamptz, local_date date, timezone text, duration_minutes integer,
  attendees jsonb, rounds jsonb, idempotency_key uuid
)
returns jsonb language sql set search_path = ''
as $$
  select private.record_past_class(
    auth.uid(), kind, group_id, student_profile_id, connection_id, occurred_at,
    local_date, timezone, duration_minutes, attendees, rounds, idempotency_key
  );
$$;

revoke execute on function private.can_write_training_resources(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.add_training_resource(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function private.update_training_resource(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function private.delete_training_resource(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.resources_json(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.list_training_resource_kinds(uuid, date, date, uuid) from public, anon, authenticated;
revoke execute on function private.record_past_class(uuid, text, uuid, uuid, uuid, timestamptz, date, text, integer, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function private.add_training_resource(uuid, uuid, text, text, text, text) to authenticated;
grant execute on function private.update_training_resource(uuid, uuid, text, text, text) to authenticated;
grant execute on function private.delete_training_resource(uuid, uuid) to authenticated;
grant execute on function private.list_training_resource_kinds(uuid, date, date, uuid) to authenticated;
grant execute on function private.record_past_class(uuid, text, uuid, uuid, uuid, timestamptz, date, text, integer, jsonb, jsonb, uuid) to authenticated;
revoke execute on function public.add_training_resource(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.update_training_resource(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.delete_training_resource(uuid) from public, anon, authenticated;
revoke execute on function public.list_training_resource_kinds(date, date, uuid) from public, anon, authenticated;
revoke execute on function public.record_past_class(text, uuid, uuid, uuid, timestamptz, date, text, integer, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.add_training_resource(uuid, text, text, text, text) to authenticated;
grant execute on function public.update_training_resource(uuid, text, text, text) to authenticated;
grant execute on function public.delete_training_resource(uuid) to authenticated;
grant execute on function public.list_training_resource_kinds(date, date, uuid) to authenticated;
grant execute on function public.record_past_class(text, uuid, uuid, uuid, timestamptz, date, text, integer, jsonb, jsonb, uuid) to authenticated;
