create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create function private.insert_plan_rounds(target_version_id uuid, round_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  round_item jsonb;
  round_position bigint;
  created_round_id uuid;
  movement_item jsonb;
  movement_position bigint;
begin
  if round_payload is null then
    round_payload := '[]'::jsonb;
  end if;
  if jsonb_typeof(round_payload) <> 'array' then
    raise exception using errcode = 'P0001', message = 'invalid_rounds';
  end if;

  for round_item, round_position in
    select value, ordinality from jsonb_array_elements(round_payload) with ordinality
  loop
    if jsonb_typeof(coalesce(round_item -> 'movements', '[]'::jsonb)) <> 'array' then
      raise exception using errcode = 'P0001', message = 'invalid_rounds';
    end if;
    insert into public.workout_plan_rounds (
      plan_version_id, position, label, repetitions, duration_seconds,
      rest_seconds, instructions
    ) values (
      target_version_id, round_position,
      nullif(btrim(round_item ->> 'label'), ''),
      nullif(round_item ->> 'repetitions', '')::integer,
      nullif(round_item ->> 'duration_seconds', '')::integer,
      nullif(round_item ->> 'rest_seconds', '')::integer,
      nullif(btrim(round_item ->> 'instructions'), '')
    ) returning id into created_round_id;

    for movement_item, movement_position in
      select value, ordinality
        from jsonb_array_elements(coalesce(round_item -> 'movements', '[]'::jsonb))
             with ordinality
    loop
      insert into public.workout_plan_movements (
        plan_round_id, position, movement_key, movement_name_snapshot,
        side, repetitions, duration_seconds, instructions
      ) values (
        created_round_id, movement_position,
        movement_item ->> 'movement_key',
        coalesce(movement_item ->> 'movement_name', movement_item ->> 'movement_name_snapshot'),
        nullif(btrim(movement_item ->> 'side'), ''),
        nullif(movement_item ->> 'repetitions', '')::integer,
        nullif(movement_item ->> 'duration_seconds', '')::integer,
        nullif(btrim(movement_item ->> 'instructions'), '')
      );
    end loop;
  end loop;
end;
$$;

create function private.insert_occurrence_rounds(target_occurrence_id uuid, round_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  round_item jsonb;
  round_position bigint;
  created_round_id uuid;
  movement_item jsonb;
  movement_position bigint;
begin
  if round_payload is null then
    round_payload := '[]'::jsonb;
  end if;
  if jsonb_typeof(round_payload) <> 'array' then
    raise exception using errcode = 'P0001', message = 'invalid_rounds';
  end if;

  for round_item, round_position in
    select value, ordinality from jsonb_array_elements(round_payload) with ordinality
  loop
    if jsonb_typeof(coalesce(round_item -> 'movements', '[]'::jsonb)) <> 'array' then
      raise exception using errcode = 'P0001', message = 'invalid_rounds';
    end if;
    insert into public.training_occurrence_rounds (
      occurrence_id, position, label, repetitions, duration_seconds,
      rest_seconds, instructions
    ) values (
      target_occurrence_id, round_position,
      nullif(btrim(round_item ->> 'label'), ''),
      nullif(round_item ->> 'repetitions', '')::integer,
      nullif(round_item ->> 'duration_seconds', '')::integer,
      nullif(round_item ->> 'rest_seconds', '')::integer,
      nullif(btrim(round_item ->> 'instructions'), '')
    ) returning id into created_round_id;

    for movement_item, movement_position in
      select value, ordinality
        from jsonb_array_elements(coalesce(round_item -> 'movements', '[]'::jsonb))
             with ordinality
    loop
      insert into public.training_occurrence_movements (
        occurrence_round_id, position, movement_key, movement_name_snapshot,
        side, repetitions, duration_seconds, instructions
      ) values (
        created_round_id, movement_position,
        movement_item ->> 'movement_key',
        coalesce(movement_item ->> 'movement_name', movement_item ->> 'movement_name_snapshot'),
        nullif(btrim(movement_item ->> 'side'), ''),
        nullif(movement_item ->> 'repetitions', '')::integer,
        nullif(movement_item ->> 'duration_seconds', '')::integer,
        nullif(btrim(movement_item ->> 'instructions'), '')
      );
    end loop;
  end loop;
end;
$$;

create function private.copy_plan_to_occurrence(
  target_version_id uuid,
  target_occurrence_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_round public.workout_plan_rounds;
  created_round_id uuid;
begin
  for source_round in
    select * from public.workout_plan_rounds
     where plan_version_id = target_version_id order by position
  loop
    insert into public.training_occurrence_rounds (
      occurrence_id, position, label, repetitions, duration_seconds,
      rest_seconds, instructions
    ) values (
      target_occurrence_id, source_round.position, source_round.label,
      source_round.repetitions, source_round.duration_seconds,
      source_round.rest_seconds, source_round.instructions
    ) returning id into created_round_id;

    insert into public.training_occurrence_movements (
      occurrence_round_id, position, movement_key, movement_name_snapshot,
      side, repetitions, duration_seconds, instructions
    )
    select created_round_id, movement.position, movement.movement_key,
           movement.movement_name_snapshot, movement.side, movement.repetitions,
           movement.duration_seconds, movement.instructions
      from public.workout_plan_movements movement
     where movement.plan_round_id = source_round.id
     order by movement.position;
  end loop;
end;
$$;

create function private.create_workout_plan(
  actor_id uuid,
  new_title text,
  new_description text,
  new_source_group_id uuid,
  new_expected_duration_minutes integer,
  new_instructions text,
  new_rounds jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_plan public.workout_plans;
  created_version public.workout_plan_versions;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if not exists (select 1 from public.coach_profiles where profile_id = actor_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  if new_source_group_id is not null
     and not private.is_group_coach(new_source_group_id, actor_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;

  insert into public.workout_plans (
    creator_profile_id, source_group_id, title, description
  ) values (
    actor_id, new_source_group_id, btrim(new_title),
    nullif(btrim(coalesce(new_description, '')), '')
  ) returning * into created_plan;

  insert into public.workout_plan_versions (
    plan_id, version_number, expected_duration_minutes, instructions
  ) values (
    created_plan.id, 1, new_expected_duration_minutes,
    nullif(btrim(coalesce(new_instructions, '')), '')
  ) returning * into created_version;

  perform private.insert_plan_rounds(created_version.id, new_rounds);
  return jsonb_build_object(
    'status', 'created', 'plan_id', created_plan.id,
    'version_id', created_version.id, 'updated_at', created_plan.updated_at
  );
end;
$$;

create function public.create_workout_plan(
  title text,
  description text,
  source_group_id uuid,
  expected_duration_minutes integer,
  instructions text,
  rounds jsonb
)
returns jsonb
language sql
set search_path = ''
as $$
  select private.create_workout_plan(
    auth.uid(), title, description, source_group_id,
    expected_duration_minutes, instructions, rounds
  );
$$;

create function private.save_workout_plan_draft(
  actor_id uuid,
  target_plan_id uuid,
  new_title text,
  new_description text,
  new_expected_duration_minutes integer,
  new_instructions text,
  new_rounds jsonb,
  expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_plan public.workout_plans;
  target_version public.workout_plan_versions;
begin
  select * into target_plan from public.workout_plans
   where id = target_plan_id for update;
  if not found or actor_id is null then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  if target_plan.creator_profile_id <> actor_id
     and not (target_plan.source_group_id is not null
       and private.is_group_coach(target_plan.source_group_id, actor_id)) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  if expected_updated_at is null or target_plan.updated_at <> expected_updated_at then
    raise exception using errcode = 'P0001', message = 'edit_conflict';
  end if;

  select * into target_version from public.workout_plan_versions
   where plan_id = target_plan.id and published_at is null
   order by version_number desc limit 1 for update;
  if not found then
    insert into public.workout_plan_versions (
      plan_id, version_number, expected_duration_minutes, instructions
    )
    select target_plan.id, coalesce(max(version_number), 0) + 1,
           new_expected_duration_minutes,
           nullif(btrim(coalesce(new_instructions, '')), '')
      from public.workout_plan_versions where plan_id = target_plan.id
    returning * into target_version;
  else
    delete from public.workout_plan_rounds where plan_version_id = target_version.id;
    update public.workout_plan_versions
       set expected_duration_minutes = new_expected_duration_minutes,
           instructions = nullif(btrim(coalesce(new_instructions, '')), '')
     where id = target_version.id
    returning * into target_version;
  end if;

  perform private.insert_plan_rounds(target_version.id, new_rounds);
  update public.workout_plans
     set title = btrim(new_title),
         description = nullif(btrim(coalesce(new_description, '')), ''),
         state = 'draft'
   where id = target_plan.id
  returning * into target_plan;

  return jsonb_build_object(
    'status', 'saved', 'plan_id', target_plan.id,
    'version_id', target_version.id, 'updated_at', target_plan.updated_at
  );
end;
$$;

create function public.save_workout_plan_draft(
  plan_id uuid,
  title text,
  description text,
  expected_duration_minutes integer,
  instructions text,
  rounds jsonb,
  expected_updated_at timestamptz
)
returns jsonb
language sql
set search_path = ''
as $$
  select private.save_workout_plan_draft(
    auth.uid(), plan_id, title, description, expected_duration_minutes,
    instructions, rounds, expected_updated_at
  );
$$;

create function private.publish_workout_plan(actor_id uuid, target_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_plan public.workout_plans;
  target_version public.workout_plan_versions;
begin
  select * into target_plan from public.workout_plans
   where id = target_plan_id for update;
  if not found or actor_id is null
     or (target_plan.creator_profile_id <> actor_id
       and not (target_plan.source_group_id is not null
         and private.is_group_coach(target_plan.source_group_id, actor_id))) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;

  select * into target_version from public.workout_plan_versions
   where plan_id = target_plan.id and published_at is null
   order by version_number desc limit 1 for update;
  if not found then
    select * into target_version from public.workout_plan_versions
     where plan_id = target_plan.id and published_at is not null
     order by version_number desc limit 1;
    return jsonb_build_object(
      'status', 'published', 'plan_id', target_plan.id,
      'version_id', target_version.id
    );
  end if;
  if not exists (
    select 1 from public.workout_plan_rounds round
    join public.workout_plan_movements movement on movement.plan_round_id = round.id
    where round.plan_version_id = target_version.id
  ) then
    raise exception using errcode = 'P0001', message = 'empty_plan';
  end if;

  update public.workout_plan_versions
     set published_at = now(), published_by = actor_id
   where id = target_version.id;
  update public.workout_plans set state = 'published' where id = target_plan.id;

  return jsonb_build_object(
    'status', 'published', 'plan_id', target_plan.id,
    'version_id', target_version.id
  );
end;
$$;

create function public.publish_workout_plan(plan_id uuid)
returns jsonb
language sql
set search_path = ''
as $$ select private.publish_workout_plan(auth.uid(), plan_id); $$;

create function private.plan_rounds_json(target_version_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', round.id, 'position', round.position, 'label', round.label,
      'repetitions', round.repetitions, 'duration_seconds', round.duration_seconds,
      'rest_seconds', round.rest_seconds, 'instructions', round.instructions,
      'movements', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', movement.id, 'position', movement.position,
          'movement_key', movement.movement_key,
          'movement_name', movement.movement_name_snapshot,
          'side', movement.side, 'repetitions', movement.repetitions,
          'duration_seconds', movement.duration_seconds,
          'instructions', movement.instructions
        ) order by movement.position)
        from public.workout_plan_movements movement
        where movement.plan_round_id = round.id
      ), '[]'::jsonb)
    ) order by round.position
  ), '[]'::jsonb)
  from public.workout_plan_rounds round
  where round.plan_version_id = target_version_id;
$$;

create function private.list_workout_plans(actor_id uuid, target_group_id uuid default null)
returns table (
  plan_id uuid,
  version_id uuid,
  version_number integer,
  title text,
  description text,
  source_group_id uuid,
  state text,
  expected_duration_minutes integer,
  instructions text,
  published_at timestamptz,
  updated_at timestamptz,
  rounds jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select plan.id, version.id, version.version_number, plan.title,
         plan.description, plan.source_group_id, plan.state::text,
         version.expected_duration_minutes, version.instructions,
         version.published_at, plan.updated_at,
         private.plan_rounds_json(version.id)
    from public.workout_plans plan
    join lateral (
      select candidate.* from public.workout_plan_versions candidate
       where candidate.plan_id = plan.id
       order by candidate.version_number desc limit 1
    ) version on true
   where actor_id is not null
     and (target_group_id is null or plan.source_group_id = target_group_id)
     and (
       plan.creator_profile_id = actor_id
       or (plan.source_group_id is not null
         and private.is_group_coach(plan.source_group_id, actor_id))
     )
   order by plan.updated_at desc, plan.id;
$$;

create function public.list_workout_plans(group_id uuid default null)
returns table (
  plan_id uuid,
  version_id uuid,
  version_number integer,
  title text,
  description text,
  source_group_id uuid,
  state text,
  expected_duration_minutes integer,
  instructions text,
  published_at timestamptz,
  updated_at timestamptz,
  rounds jsonb
)
language sql
stable
set search_path = ''
as $$ select * from private.list_workout_plans(auth.uid(), group_id); $$;

create function private.require_published_version(target_version_id uuid)
returns public.workout_plan_versions
language plpgsql
stable
security definer
set search_path = ''
as $$
declare target_version public.workout_plan_versions;
begin
  select * into target_version from public.workout_plan_versions
   where id = target_version_id and published_at is not null;
  if not found then
    raise exception using errcode = 'P0001', message = 'plan_not_published';
  end if;
  return target_version;
end;
$$;

create function private.schedule_group_training(
  actor_id uuid,
  target_plan_version_id uuid,
  target_group_id uuid,
  target_starts_at timestamptz,
  target_local_date date,
  target_timezone text,
  target_visible_in_advance boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target_version public.workout_plan_versions;
declare created_schedule public.scheduled_trainings;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if not private.is_group_coach(target_group_id, actor_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  target_version := private.require_published_version(target_plan_version_id);
  insert into public.scheduled_trainings (
    kind, plan_version_id, arranged_by, group_id, starts_at, local_date,
    timezone, expected_duration_minutes, visible_in_advance
  ) values (
    'group', target_plan_version_id, actor_id, target_group_id,
    target_starts_at, target_local_date, target_timezone,
    target_version.expected_duration_minutes,
    coalesce(target_visible_in_advance, true)
  ) returning * into created_schedule;
  return jsonb_build_object('status', 'scheduled', 'schedule_id', created_schedule.id);
end;
$$;

create function public.schedule_group_training(
  plan_version_id uuid,
  group_id uuid,
  starts_at timestamptz,
  local_date date,
  timezone text,
  visible_in_advance boolean default true
)
returns jsonb
language sql
set search_path = ''
as $$
  select private.schedule_group_training(
    auth.uid(), plan_version_id, group_id, starts_at, local_date,
    timezone, visible_in_advance
  );
$$;

create function private.schedule_personal_class(
  actor_id uuid,
  target_plan_version_id uuid,
  target_student_profile_id uuid,
  target_group_id uuid,
  target_connection_id uuid,
  target_starts_at timestamptz,
  target_local_date date,
  target_timezone text,
  target_visible_in_advance boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target_version public.workout_plan_versions;
declare created_schedule public.scheduled_trainings;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if ((target_group_id is not null)::integer + (target_connection_id is not null)::integer) <> 1 then
    raise exception using errcode = 'P0001', message = 'invalid_coaching_context';
  end if;
  if target_group_id is not null then
    if not private.can_coach_practitioner(
      actor_id, target_student_profile_id, target_group_id
    ) then
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
  target_version := private.require_published_version(target_plan_version_id);
  insert into public.scheduled_trainings (
    kind, plan_version_id, arranged_by, group_id, student_profile_id,
    connection_id, starts_at, local_date, timezone,
    expected_duration_minutes, visible_in_advance
  ) values (
    'personal_class', target_plan_version_id, actor_id, target_group_id,
    target_student_profile_id, target_connection_id, target_starts_at,
    target_local_date, target_timezone, target_version.expected_duration_minutes,
    coalesce(target_visible_in_advance, true)
  ) returning * into created_schedule;
  return jsonb_build_object('status', 'scheduled', 'schedule_id', created_schedule.id);
end;
$$;

create function public.schedule_personal_class(
  plan_version_id uuid,
  student_profile_id uuid,
  group_id uuid,
  connection_id uuid,
  starts_at timestamptz,
  local_date date,
  timezone text,
  visible_in_advance boolean default true
)
returns jsonb
language sql
set search_path = ''
as $$
  select private.schedule_personal_class(
    auth.uid(), plan_version_id, student_profile_id, group_id, connection_id,
    starts_at, local_date, timezone, visible_in_advance
  );
$$;

create function private.cancel_scheduled_training(
  actor_id uuid,
  target_schedule_id uuid,
  reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target_schedule public.scheduled_trainings;
begin
  select * into target_schedule from public.scheduled_trainings
   where id = target_schedule_id for update;
  if not found or not private.can_manage_schedule(actor_id, target_schedule_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  if target_schedule.state = 'completed' then
    raise exception using errcode = 'P0001', message = 'duplicate_completion';
  end if;
  if target_schedule.state = 'cancelled' then
    return jsonb_build_object('status', 'cancelled', 'schedule_id', target_schedule.id);
  end if;
  update public.scheduled_trainings
     set state = 'cancelled', cancelled_at = now(), cancelled_by = actor_id,
         cancellation_reason = nullif(btrim(coalesce(reason, '')), '')
   where id = target_schedule.id;
  return jsonb_build_object('status', 'cancelled', 'schedule_id', target_schedule.id);
end;
$$;

create function public.cancel_scheduled_training(schedule_id uuid, reason text default null)
returns jsonb
language sql
set search_path = ''
as $$ select private.cancel_scheduled_training(auth.uid(), schedule_id, reason); $$;

create function private.record_alone_training(
  actor_id uuid,
  target_local_date date,
  target_timezone text,
  target_duration_minutes integer,
  target_personal_notes text,
  target_rounds jsonb,
  target_idempotency_key uuid,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare existing_occurrence public.training_occurrences;
declare created_occurrence public.training_occurrences;
declare created_participation public.training_participations;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  select * into existing_occurrence from public.training_occurrences occurrence
   where occurrence.idempotency_key = target_idempotency_key;
  if found then
    select * into created_participation from public.training_participations participation
     where participation.occurrence_id = existing_occurrence.id
       and participation.profile_id = actor_id;
    if found and existing_occurrence.kind = 'alone' then
      return jsonb_build_object(
        'status', 'completed', 'occurrence_id', existing_occurrence.id,
        'participation_id', created_participation.id,
        'participation_ids', jsonb_build_array(created_participation.id)
      );
    end if;
    raise exception using errcode = 'P0001', message = 'duplicate_completion';
  end if;

  insert into public.training_occurrences (
    kind, recorded_by, occurred_at, local_date, timezone,
    default_duration_minutes, idempotency_key
  ) values (
    'alone', actor_id, coalesce(target_occurred_at, now()), target_local_date,
    target_timezone, target_duration_minutes, target_idempotency_key
  ) returning * into created_occurrence;
  perform private.insert_occurrence_rounds(created_occurrence.id, target_rounds);
  insert into public.training_participations (
    occurrence_id, profile_id, actual_duration_minutes, personal_notes,
    confirmed_at, confirmed_by
  ) values (
    created_occurrence.id, actor_id, target_duration_minutes,
    nullif(btrim(coalesce(target_personal_notes, '')), ''),
    coalesce(target_occurred_at, now()), actor_id
  ) returning * into created_participation;
  return jsonb_build_object(
    'status', 'completed', 'occurrence_id', created_occurrence.id,
    'participation_id', created_participation.id,
    'participation_ids', jsonb_build_array(created_participation.id)
  );
end;
$$;

create function public.record_alone_training(
  local_date date,
  timezone text,
  duration_minutes integer,
  personal_notes text,
  rounds jsonb,
  idempotency_key uuid,
  occurred_at timestamptz default now()
)
returns jsonb
language sql
set search_path = ''
as $$
  select private.record_alone_training(
    auth.uid(), local_date, timezone, duration_minutes, personal_notes,
    rounds, idempotency_key, occurred_at
  );
$$;

create function private.completion_response(target_occurrence_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', 'completed', 'occurrence_id', target_occurrence_id,
    'participation_ids', coalesce((
      select jsonb_agg(participation.id order by participation.profile_id)
      from public.training_participations participation
      where participation.occurrence_id = target_occurrence_id
    ), '[]'::jsonb)
  );
$$;

create function private.complete_group_training(
  actor_id uuid,
  target_schedule_id uuid,
  attendees jsonb,
  target_duration_minutes integer,
  target_idempotency_key uuid,
  actual_rounds jsonb,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target_schedule public.scheduled_trainings;
declare existing_occurrence public.training_occurrences;
declare created_occurrence public.training_occurrences;
declare attendee jsonb;
begin
  select * into existing_occurrence from public.training_occurrences occurrence
   where occurrence.idempotency_key = target_idempotency_key;
  if found then
    if existing_occurrence.schedule_id = target_schedule_id
       and existing_occurrence.recorded_by = actor_id then
      return private.completion_response(existing_occurrence.id);
    end if;
    raise exception using errcode = 'P0001', message = 'duplicate_completion';
  end if;

  select * into target_schedule from public.scheduled_trainings schedule
   where schedule.id = target_schedule_id for update;
  if not found or target_schedule.kind <> 'group'
     or not private.can_manage_schedule(actor_id, target_schedule_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  if target_schedule.state = 'cancelled' then
    raise exception using errcode = 'P0001', message = 'cancelled_training';
  end if;
  if target_schedule.state = 'completed' then
    raise exception using errcode = 'P0001', message = 'duplicate_completion';
  end if;
  if jsonb_typeof(attendees) <> 'array' or jsonb_array_length(attendees) = 0 then
    raise exception using errcode = 'P0001', message = 'invalid_attendee';
  end if;
  for attendee in select value from jsonb_array_elements(attendees)
  loop
    if not private.is_active_group_member(
      target_schedule.group_id, (attendee ->> 'profile_id')::uuid
    ) or coalesce((attendee ->> 'duration_minutes')::integer, 0) not between 1 and 1440 then
      raise exception using errcode = 'P0001', message = 'invalid_attendee';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(attendees)) <>
     (select count(distinct value ->> 'profile_id') from jsonb_array_elements(attendees)) then
    raise exception using errcode = 'P0001', message = 'invalid_attendee';
  end if;

  insert into public.training_occurrences (
    schedule_id, kind, group_id, recorded_by, occurred_at, local_date,
    timezone, default_duration_minutes, idempotency_key
  ) values (
    target_schedule.id, 'group', target_schedule.group_id, actor_id,
    coalesce(target_occurred_at, target_schedule.starts_at),
    target_schedule.local_date, target_schedule.timezone,
    target_duration_minutes, target_idempotency_key
  ) returning * into created_occurrence;
  if actual_rounds is null then
    perform private.copy_plan_to_occurrence(
      target_schedule.plan_version_id, created_occurrence.id
    );
  else
    perform private.insert_occurrence_rounds(created_occurrence.id, actual_rounds);
  end if;
  insert into public.training_participations (
    occurrence_id, profile_id, actual_duration_minutes, confirmed_at, confirmed_by
  )
  select created_occurrence.id, (value ->> 'profile_id')::uuid,
         (value ->> 'duration_minutes')::integer,
         coalesce(target_occurred_at, target_schedule.starts_at), actor_id
    from jsonb_array_elements(attendees);
  update public.scheduled_trainings set state = 'completed'
   where id = target_schedule.id;
  return private.completion_response(created_occurrence.id);
end;
$$;

create function public.complete_group_training(
  schedule_id uuid,
  attendees jsonb,
  duration_minutes integer,
  idempotency_key uuid,
  rounds jsonb default null,
  occurred_at timestamptz default null
)
returns jsonb
language sql
set search_path = ''
as $$
  select private.complete_group_training(
    auth.uid(), schedule_id, attendees, duration_minutes,
    idempotency_key, rounds, occurred_at
  );
$$;

create function private.complete_personal_class(
  actor_id uuid,
  target_schedule_id uuid,
  target_duration_minutes integer,
  target_idempotency_key uuid,
  actual_rounds jsonb,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target_schedule public.scheduled_trainings;
declare existing_occurrence public.training_occurrences;
declare created_occurrence public.training_occurrences;
begin
  select * into existing_occurrence from public.training_occurrences occurrence
   where occurrence.idempotency_key = target_idempotency_key;
  if found then
    if existing_occurrence.schedule_id = target_schedule_id
       and existing_occurrence.recorded_by = actor_id then
      return private.completion_response(existing_occurrence.id);
    end if;
    raise exception using errcode = 'P0001', message = 'duplicate_completion';
  end if;
  select * into target_schedule from public.scheduled_trainings schedule
   where schedule.id = target_schedule_id for update;
  if not found or target_schedule.kind <> 'personal_class'
     or not private.can_manage_schedule(actor_id, target_schedule_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  if target_schedule.state = 'cancelled' then
    raise exception using errcode = 'P0001', message = 'cancelled_training';
  end if;
  if target_schedule.state = 'completed' then
    raise exception using errcode = 'P0001', message = 'duplicate_completion';
  end if;

  insert into public.training_occurrences (
    schedule_id, kind, group_id, student_profile_id, recorded_by,
    occurred_at, local_date, timezone, default_duration_minutes, idempotency_key
  ) values (
    target_schedule.id, 'personal_class', target_schedule.group_id,
    target_schedule.student_profile_id, actor_id,
    coalesce(target_occurred_at, target_schedule.starts_at),
    target_schedule.local_date, target_schedule.timezone,
    target_duration_minutes, target_idempotency_key
  ) returning * into created_occurrence;
  if actual_rounds is null then
    perform private.copy_plan_to_occurrence(
      target_schedule.plan_version_id, created_occurrence.id
    );
  else
    perform private.insert_occurrence_rounds(created_occurrence.id, actual_rounds);
  end if;
  insert into public.training_participations (
    occurrence_id, profile_id, actual_duration_minutes, confirmed_at, confirmed_by
  ) values (
    created_occurrence.id, target_schedule.student_profile_id,
    target_duration_minutes,
    coalesce(target_occurred_at, target_schedule.starts_at), actor_id
  );
  update public.scheduled_trainings set state = 'completed'
   where id = target_schedule.id;
  return private.completion_response(created_occurrence.id);
end;
$$;

create function public.complete_personal_class(
  schedule_id uuid,
  duration_minutes integer,
  idempotency_key uuid,
  rounds jsonb default null,
  occurred_at timestamptz default null
)
returns jsonb
language sql
set search_path = ''
as $$
  select private.complete_personal_class(
    auth.uid(), schedule_id, duration_minutes, idempotency_key, rounds, occurred_at
  );
$$;

create function private.save_training_notes(
  actor_id uuid,
  target_participation_id uuid,
  new_personal_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if actor_id is null or not exists (
    select 1 from public.training_participations participation
     where participation.id = target_participation_id
       and participation.profile_id = actor_id
  ) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  update public.training_participations
     set personal_notes = nullif(btrim(coalesce(new_personal_notes, '')), '')
   where id = target_participation_id;
  return jsonb_build_object('status', 'saved', 'participation_id', target_participation_id);
end;
$$;

create function public.save_training_notes(participation_id uuid, personal_notes text)
returns jsonb
language sql
set search_path = ''
as $$ select private.save_training_notes(auth.uid(), participation_id, personal_notes); $$;

create function private.save_training_assessment(
  actor_id uuid,
  target_participation_id uuid,
  target_occurrence_movement_id uuid,
  new_difficulty public.movement_difficulty,
  new_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare saved_assessment public.training_movement_assessments;
begin
  if actor_id is null or not exists (
    select 1
      from public.training_participations participation
      join public.training_occurrence_rounds round
        on round.occurrence_id = participation.occurrence_id
      join public.training_occurrence_movements movement
        on movement.occurrence_round_id = round.id
     where participation.id = target_participation_id
       and participation.profile_id = actor_id
       and movement.id = target_occurrence_movement_id
  ) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  insert into public.training_movement_assessments (
    participation_id, occurrence_movement_id, difficulty, note
  ) values (
    target_participation_id, target_occurrence_movement_id,
    new_difficulty, nullif(btrim(coalesce(new_note, '')), '')
  )
  on conflict (participation_id, occurrence_movement_id)
  do update set difficulty = excluded.difficulty, note = excluded.note
  returning * into saved_assessment;
  return jsonb_build_object('status', 'saved', 'assessment_id', saved_assessment.id);
end;
$$;

create function public.save_training_assessment(
  participation_id uuid,
  occurrence_movement_id uuid,
  difficulty public.movement_difficulty,
  note text default null
)
returns jsonb
language sql
set search_path = ''
as $$
  select private.save_training_assessment(
    auth.uid(), participation_id, occurrence_movement_id, difficulty, note
  );
$$;

create function private.add_training_feedback(
  actor_id uuid,
  target_participation_id uuid,
  context_group_id uuid,
  context_connection_id uuid,
  feedback_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare created_feedback public.training_feedback;
begin
  if not private.can_write_training_feedback(
    actor_id, target_participation_id, context_group_id, context_connection_id
  ) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  insert into public.training_feedback (
    participation_id, coach_profile_id, group_id, connection_id, body
  ) values (
    target_participation_id, actor_id, context_group_id,
    context_connection_id, btrim(feedback_body)
  ) returning * into created_feedback;
  return jsonb_build_object('status', 'saved', 'feedback_id', created_feedback.id);
end;
$$;

create function public.add_training_feedback(
  participation_id uuid,
  group_id uuid,
  connection_id uuid,
  body text
)
returns jsonb
language sql
set search_path = ''
as $$
  select private.add_training_feedback(
    auth.uid(), participation_id, group_id, connection_id, body
  );
$$;

create function private.list_training_calendar(
  actor_id uuid,
  range_start date,
  range_end_exclusive date,
  target_profile_id uuid
)
returns table (
  item_id uuid,
  item_type text,
  local_date date,
  kind text,
  status text,
  starts_at timestamptz,
  duration_minutes integer,
  group_id uuid,
  group_name text,
  coach_profile_id uuid,
  coach_name text,
  visible_in_advance boolean,
  plan_title text
)
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
  if range_start is null or range_end_exclusive is null
     or range_start >= range_end_exclusive then
    raise exception using errcode = 'P0001', message = 'invalid_date_range';
  end if;

  return query
  select occurrence.id, 'completed'::text, occurrence.local_date,
         occurrence.kind::text, 'completed'::text, occurrence.occurred_at,
         participation.actual_duration_minutes, occurrence.group_id,
         target_group.name, occurrence.recorded_by, coach.display_name,
         true, plan.title
    from public.training_participations participation
    join public.training_occurrences occurrence on occurrence.id = participation.occurrence_id
    left join public.groups target_group on target_group.id = occurrence.group_id
    left join public.profiles coach on coach.id = occurrence.recorded_by
    left join public.scheduled_trainings schedule on schedule.id = occurrence.schedule_id
    left join public.workout_plan_versions version on version.id = schedule.plan_version_id
    left join public.workout_plans plan on plan.id = version.plan_id
   where participation.profile_id = practitioner_id
     and occurrence.local_date >= range_start
     and occurrence.local_date < range_end_exclusive
  union all
  select schedule.id, 'scheduled'::text, schedule.local_date,
         schedule.kind::text, schedule.state::text, schedule.starts_at,
         schedule.expected_duration_minutes, schedule.group_id,
         target_group.name, schedule.arranged_by, coach.display_name,
         schedule.visible_in_advance,
         case when schedule.visible_in_advance
                    or schedule.arranged_by = actor_id
                    or (schedule.group_id is not null
                      and private.is_group_coach(schedule.group_id, actor_id))
              then plan.title else null end
    from public.scheduled_trainings schedule
    join public.workout_plan_versions version on version.id = schedule.plan_version_id
    join public.workout_plans plan on plan.id = version.plan_id
    left join public.groups target_group on target_group.id = schedule.group_id
    left join public.profiles coach on coach.id = schedule.arranged_by
   where schedule.state = 'scheduled'
     and schedule.local_date >= range_start
     and schedule.local_date < range_end_exclusive
     and (
       (schedule.kind = 'personal_class'
         and schedule.student_profile_id = practitioner_id
         and (practitioner_id = actor_id
           or schedule.arranged_by = actor_id
           or (schedule.group_id is not null
             and private.is_group_coach(schedule.group_id, actor_id))))
       or
       (schedule.kind = 'group' and exists (
         select 1 from public.group_memberships membership
          where membership.group_id = schedule.group_id
            and membership.profile_id = practitioner_id
            and membership.state = 'active'
       ) and (practitioner_id = actor_id
         or private.is_group_coach(schedule.group_id, actor_id)))
     )
   order by 3, 6, 1;
end;
$$;

create function public.list_training_calendar(
  month_start date,
  month_end date,
  profile_id uuid default null
)
returns table (
  item_id uuid,
  item_type text,
  local_date date,
  kind text,
  status text,
  starts_at timestamptz,
  duration_minutes integer,
  group_id uuid,
  group_name text,
  coach_profile_id uuid,
  coach_name text,
  visible_in_advance boolean,
  plan_title text
)
language sql
stable
set search_path = ''
as $$
  select * from private.list_training_calendar(
    auth.uid(), month_start, month_end, profile_id
  );
$$;

create function private.feedback_json(actor_id uuid, target_participation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', feedback.id, 'coach_profile_id', feedback.coach_profile_id,
    'coach_name', coach.display_name, 'group_id', feedback.group_id,
    'connection_id', feedback.connection_id, 'body', feedback.body,
    'created_at', feedback.created_at
  ) order by feedback.created_at), '[]'::jsonb)
  from public.training_feedback feedback
  join public.training_participations participation
    on participation.id = feedback.participation_id
  join public.profiles coach on coach.id = feedback.coach_profile_id
  where feedback.participation_id = target_participation_id
    and (
      participation.profile_id = actor_id
      or (feedback.group_id is not null
        and private.is_group_coach(feedback.group_id, actor_id))
      or (feedback.connection_id is not null
        and feedback.coach_profile_id = actor_id
        and private.has_explicit_coaching_connection(
          feedback.coach_profile_id, participation.profile_id
        ))
    );
$$;

create function private.occurrence_rounds_json(
  actor_id uuid,
  target_occurrence_id uuid,
  target_participation_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', round.id, 'position', round.position, 'label', round.label,
    'repetitions', round.repetitions, 'duration_seconds', round.duration_seconds,
    'rest_seconds', round.rest_seconds, 'instructions', round.instructions,
    'movements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', movement.id, 'position', movement.position,
        'movement_key', movement.movement_key,
        'movement_name', movement.movement_name_snapshot,
        'side', movement.side, 'repetitions', movement.repetitions,
        'duration_seconds', movement.duration_seconds,
        'instructions', movement.instructions,
        'assessment', case when assessment.id is null then null else jsonb_build_object(
          'difficulty', assessment.difficulty::text, 'note', assessment.note
        ) end
      ) order by movement.position)
      from public.training_occurrence_movements movement
      left join public.training_movement_assessments assessment
        on assessment.occurrence_movement_id = movement.id
       and assessment.participation_id = target_participation_id
      where movement.occurrence_round_id = round.id
    ), '[]'::jsonb)
  ) order by round.position), '[]'::jsonb)
  from public.training_occurrence_rounds round
  where round.occurrence_id = target_occurrence_id;
$$;

create function private.feedback_contexts_json(
  actor_id uuid,
  target_participation_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select participation.profile_id, occurrence.group_id
      from public.training_participations participation
      join public.training_occurrences occurrence
        on occurrence.id = participation.occurrence_id
     where participation.id = target_participation_id
  ), contexts as (
    select 'connection'::text kind, connection.id,
           'Direct coaching'::text label
      from target
      join public.coach_student_connections connection
        on connection.coach_profile_id = actor_id
       and connection.student_profile_id = target.profile_id
       and connection.state = 'active'
    union all
    select 'group'::text, target_group.id, target_group.name
      from target
      join public.groups target_group on target_group.id = target.group_id
     where private.is_group_coach(target_group.id, actor_id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', contexts.kind, 'id', contexts.id, 'label', contexts.label
  ) order by contexts.kind, contexts.label), '[]'::jsonb)
    from contexts;
$$;

create function private.get_training_day(
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
        'id', occurrence.id, 'item_type', 'completed',
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
        'feedback_contexts', private.feedback_contexts_json(actor_id, participation.id)
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

create function public.get_training_day(local_date date, profile_id uuid default null)
returns jsonb
language sql
stable
set search_path = ''
as $$ select private.get_training_day(auth.uid(), local_date, profile_id); $$;

revoke execute on function private.insert_plan_rounds(uuid, jsonb) from public, anon, authenticated;
revoke execute on function private.insert_occurrence_rounds(uuid, jsonb) from public, anon, authenticated;
revoke execute on function private.copy_plan_to_occurrence(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.create_workout_plan(uuid, text, text, uuid, integer, text, jsonb) from public, anon, authenticated;
revoke execute on function private.save_workout_plan_draft(uuid, uuid, text, text, integer, text, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function private.publish_workout_plan(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.plan_rounds_json(uuid) from public, anon, authenticated;
revoke execute on function private.list_workout_plans(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.require_published_version(uuid) from public, anon, authenticated;
revoke execute on function private.schedule_group_training(uuid, uuid, uuid, timestamptz, date, text, boolean) from public, anon, authenticated;
revoke execute on function private.schedule_personal_class(uuid, uuid, uuid, uuid, uuid, timestamptz, date, text, boolean) from public, anon, authenticated;
revoke execute on function private.cancel_scheduled_training(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function private.record_alone_training(uuid, date, text, integer, text, jsonb, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function private.completion_response(uuid) from public, anon, authenticated;
revoke execute on function private.complete_group_training(uuid, uuid, jsonb, integer, uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function private.complete_personal_class(uuid, uuid, integer, uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function private.save_training_notes(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function private.save_training_assessment(uuid, uuid, uuid, public.movement_difficulty, text) from public, anon, authenticated;
revoke execute on function private.add_training_feedback(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function private.list_training_calendar(uuid, date, date, uuid) from public, anon, authenticated;
revoke execute on function private.feedback_json(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.occurrence_rounds_json(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.feedback_contexts_json(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.get_training_day(uuid, date, uuid) from public, anon, authenticated;

grant execute on function private.create_workout_plan(uuid, text, text, uuid, integer, text, jsonb) to authenticated;
grant execute on function private.save_workout_plan_draft(uuid, uuid, text, text, integer, text, jsonb, timestamptz) to authenticated;
grant execute on function private.publish_workout_plan(uuid, uuid) to authenticated;
grant execute on function private.list_workout_plans(uuid, uuid) to authenticated;
grant execute on function private.schedule_group_training(uuid, uuid, uuid, timestamptz, date, text, boolean) to authenticated;
grant execute on function private.schedule_personal_class(uuid, uuid, uuid, uuid, uuid, timestamptz, date, text, boolean) to authenticated;
grant execute on function private.cancel_scheduled_training(uuid, uuid, text) to authenticated;
grant execute on function private.record_alone_training(uuid, date, text, integer, text, jsonb, uuid, timestamptz) to authenticated;
grant execute on function private.complete_group_training(uuid, uuid, jsonb, integer, uuid, jsonb, timestamptz) to authenticated;
grant execute on function private.complete_personal_class(uuid, uuid, integer, uuid, jsonb, timestamptz) to authenticated;
grant execute on function private.save_training_notes(uuid, uuid, text) to authenticated;
grant execute on function private.save_training_assessment(uuid, uuid, uuid, public.movement_difficulty, text) to authenticated;
grant execute on function private.add_training_feedback(uuid, uuid, uuid, uuid, text) to authenticated;
grant execute on function private.list_training_calendar(uuid, date, date, uuid) to authenticated;
grant execute on function private.get_training_day(uuid, date, uuid) to authenticated;
grant execute on function private.feedback_contexts_json(uuid, uuid) to authenticated;

revoke execute on function public.create_workout_plan(text, text, uuid, integer, text, jsonb) from public, anon, authenticated;
revoke execute on function public.save_workout_plan_draft(uuid, text, text, integer, text, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.publish_workout_plan(uuid) from public, anon, authenticated;
revoke execute on function public.list_workout_plans(uuid) from public, anon, authenticated;
revoke execute on function public.schedule_group_training(uuid, uuid, timestamptz, date, text, boolean) from public, anon, authenticated;
revoke execute on function public.schedule_personal_class(uuid, uuid, uuid, uuid, timestamptz, date, text, boolean) from public, anon, authenticated;
revoke execute on function public.cancel_scheduled_training(uuid, text) from public, anon, authenticated;
revoke execute on function public.record_alone_training(date, text, integer, text, jsonb, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.complete_group_training(uuid, jsonb, integer, uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.complete_personal_class(uuid, integer, uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.save_training_notes(uuid, text) from public, anon, authenticated;
revoke execute on function public.save_training_assessment(uuid, uuid, public.movement_difficulty, text) from public, anon, authenticated;
revoke execute on function public.add_training_feedback(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.list_training_calendar(date, date, uuid) from public, anon, authenticated;
revoke execute on function public.get_training_day(date, uuid) from public, anon, authenticated;

grant execute on function public.create_workout_plan(text, text, uuid, integer, text, jsonb) to authenticated;
grant execute on function public.save_workout_plan_draft(uuid, text, text, integer, text, jsonb, timestamptz) to authenticated;
grant execute on function public.publish_workout_plan(uuid) to authenticated;
grant execute on function public.list_workout_plans(uuid) to authenticated;
grant execute on function public.schedule_group_training(uuid, uuid, timestamptz, date, text, boolean) to authenticated;
grant execute on function public.schedule_personal_class(uuid, uuid, uuid, uuid, timestamptz, date, text, boolean) to authenticated;
grant execute on function public.cancel_scheduled_training(uuid, text) to authenticated;
grant execute on function public.record_alone_training(date, text, integer, text, jsonb, uuid, timestamptz) to authenticated;
grant execute on function public.complete_group_training(uuid, jsonb, integer, uuid, jsonb, timestamptz) to authenticated;
grant execute on function public.complete_personal_class(uuid, integer, uuid, jsonb, timestamptz) to authenticated;
grant execute on function public.save_training_notes(uuid, text) to authenticated;
grant execute on function public.save_training_assessment(uuid, uuid, public.movement_difficulty, text) to authenticated;
grant execute on function public.add_training_feedback(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.list_training_calendar(date, date, uuid) to authenticated;
grant execute on function public.get_training_day(date, uuid) to authenticated;
