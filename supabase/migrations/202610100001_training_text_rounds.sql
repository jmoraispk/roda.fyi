-- supabase/migrations/202610100001_training_text_rounds.sql
create extension if not exists unaccent with schema extensions;

create type public.training_segment_kind as enum ('round', 'setup', 'move', 'transition', 'loop');

alter table public.workout_plan_rounds
  add column source_text text,
  add column sequence jsonb,
  add constraint workout_plan_rounds_source_text_check
    check (source_text is null or char_length(source_text) <= 4000),
  add constraint workout_plan_rounds_sequence_check
    check (sequence is null or jsonb_typeof(sequence) = 'array');
alter table public.training_occurrence_rounds
  add column source_text text,
  add column sequence jsonb,
  add constraint training_occurrence_rounds_source_text_check
    check (source_text is null or char_length(source_text) <= 4000),
  add constraint training_occurrence_rounds_sequence_check
    check (sequence is null or jsonb_typeof(sequence) = 'array');

alter table public.workout_plan_movements
  add column catalogued boolean not null default true,
  add column segment_key text,
  add constraint workout_plan_movements_segment_key_check
    check (segment_key is null or segment_key ~ '^m:[0-9]+(\.[0-9]+)*$');
alter table public.training_occurrence_movements
  add column catalogued boolean not null default true,
  add column segment_key text,
  add constraint training_occurrence_movements_segment_key_check
    check (segment_key is null or segment_key ~ '^m:[0-9]+(\.[0-9]+)*$');

create or replace function private.normalize_training_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.movement_key := trim(both '-' from regexp_replace(
    lower(extensions.unaccent(
      'extensions.unaccent'::regdictionary, btrim(coalesce(new.movement_key, ''))
    )),
    '[^a-z0-9]+', '-', 'g'
  ));
  new.movement_name_snapshot := btrim(coalesce(new.movement_name_snapshot, ''));
  if new.movement_key = '' or new.movement_name_snapshot = '' then
    raise exception using errcode = 'P0001', message = 'invalid_movement';
  end if;
  return new;
end;
$$;

create table public.workout_plan_segment_expectations (
  id uuid primary key default extensions.gen_random_uuid(),
  plan_round_id uuid not null references public.workout_plan_rounds(id) on delete cascade,
  segment_key text not null,
  segment_kind public.training_segment_kind not null,
  difficulty public.movement_difficulty not null,
  note text,
  from_movement_key text,
  to_movement_key text,
  created_at timestamptz not null default now(),
  constraint workout_plan_segment_expectations_unique unique (plan_round_id, segment_key),
  constraint workout_plan_segment_expectations_key_check check (
    (segment_kind = 'round' and segment_key = 'r')
    or (segment_kind = 'setup' and segment_key = 's')
    or (segment_kind = 'move' and segment_key ~ '^m:[0-9]+(\.[0-9]+)*$')
    or (segment_kind = 'transition' and segment_key ~ '^t:[0-9]+(\.[0-9]+)*>[0-9]+(\.[0-9]+)*$')
    or (segment_kind = 'loop' and segment_key ~ '^l:[0-9]+(\.[0-9]+)*$')
  ),
  constraint workout_plan_segment_expectations_note_check
    check (note is null or char_length(note) <= 2000),
  constraint workout_plan_segment_expectations_moves_check check (
    (from_movement_key is null or from_movement_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
    and (to_movement_key is null or to_movement_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
  )
);

create table public.training_segment_assessments (
  id uuid primary key default extensions.gen_random_uuid(),
  participation_id uuid not null references public.training_participations(id) on delete cascade,
  occurrence_round_id uuid not null references public.training_occurrence_rounds(id) on delete cascade,
  segment_key text not null,
  segment_kind public.training_segment_kind not null,
  difficulty public.movement_difficulty not null,
  note text,
  from_movement_key text,
  to_movement_key text,
  created_at timestamptz not null default now(),
  constraint training_segment_assessments_unique
    unique (participation_id, occurrence_round_id, segment_key),
  constraint training_segment_assessments_key_check check (
    (segment_kind = 'round' and segment_key = 'r')
    or (segment_kind = 'setup' and segment_key = 's')
    or (segment_kind = 'move' and segment_key ~ '^m:[0-9]+(\.[0-9]+)*$')
    or (segment_kind = 'transition' and segment_key ~ '^t:[0-9]+(\.[0-9]+)*>[0-9]+(\.[0-9]+)*$')
    or (segment_kind = 'loop' and segment_key ~ '^l:[0-9]+(\.[0-9]+)*$')
  ),
  constraint training_segment_assessments_note_check
    check (note is null or char_length(note) <= 2000),
  constraint training_segment_assessments_moves_check check (
    (from_movement_key is null or from_movement_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
    and (to_movement_key is null or to_movement_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
  )
);
create index training_segment_assessments_round_idx
  on public.training_segment_assessments (occurrence_round_id);

create function private.protect_published_plan_expectation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_round_id uuid;
begin
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

create trigger workout_plan_segment_expectations_protect_published
before insert or update or delete on public.workout_plan_segment_expectations
for each row execute function private.protect_published_plan_expectation();

alter table public.workout_plan_segment_expectations enable row level security;
alter table public.training_segment_assessments enable row level security;

create policy workout_plan_segment_expectations_select_authorized
on public.workout_plan_segment_expectations for select to authenticated
using (exists (
  select 1
    from public.workout_plan_rounds round
    join public.workout_plan_versions version on version.id = round.plan_version_id
    join public.workout_plans plan on plan.id = version.plan_id
   where round.id = workout_plan_segment_expectations.plan_round_id
     and (plan.creator_profile_id = auth.uid()
       or (plan.source_group_id is not null and private.is_group_coach(plan.source_group_id, auth.uid())))
));

create policy training_segment_assessments_select_authorized
on public.training_segment_assessments for select to authenticated
using (exists (
  select 1 from public.training_participations participation
   where participation.id = training_segment_assessments.participation_id
     and private.can_read_training(auth.uid(), participation.profile_id)
));

revoke all on table public.workout_plan_segment_expectations, public.training_segment_assessments
from public, anon, authenticated;
grant select on table public.workout_plan_segment_expectations, public.training_segment_assessments
to authenticated;

create function private.ratings_rows(ratings jsonb)
returns table (
  segment_key text, segment_kind public.training_segment_kind,
  difficulty public.movement_difficulty, note text,
  from_movement_key text, to_movement_key text
)
language sql
stable
set search_path = ''
as $$
  select item ->> 'segment_key',
         (item ->> 'segment_kind')::public.training_segment_kind,
         (item ->> 'difficulty')::public.movement_difficulty,
         nullif(btrim(coalesce(item ->> 'note', '')), ''),
         nullif(item ->> 'from_movement_key', ''),
         nullif(item ->> 'to_movement_key', '')
    from jsonb_array_elements(
      case when jsonb_typeof(ratings) = 'array' then ratings else '[]'::jsonb end
    ) item;
$$;

create or replace function private.insert_plan_rounds(target_version_id uuid, round_payload jsonb)
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
      rest_seconds, instructions, source_text, sequence
    ) values (
      target_version_id, round_position,
      nullif(btrim(round_item ->> 'label'), ''),
      nullif(round_item ->> 'repetitions', '')::integer,
      nullif(round_item ->> 'duration_seconds', '')::integer,
      nullif(round_item ->> 'rest_seconds', '')::integer,
      nullif(btrim(round_item ->> 'instructions'), ''),
      nullif(btrim(round_item ->> 'source_text'), ''),
      case when jsonb_typeof(round_item -> 'sequence') = 'array' then round_item -> 'sequence' end
    ) returning id into created_round_id;

    for movement_item, movement_position in
      select value, ordinality
        from jsonb_array_elements(coalesce(round_item -> 'movements', '[]'::jsonb))
             with ordinality
    loop
      insert into public.workout_plan_movements (
        plan_round_id, position, movement_key, movement_name_snapshot,
        side, repetitions, duration_seconds, instructions, catalogued, segment_key
      ) values (
        created_round_id, movement_position,
        movement_item ->> 'movement_key',
        coalesce(movement_item ->> 'movement_name', movement_item ->> 'movement_name_snapshot'),
        nullif(btrim(movement_item ->> 'side'), ''),
        nullif(movement_item ->> 'repetitions', '')::integer,
        nullif(movement_item ->> 'duration_seconds', '')::integer,
        nullif(btrim(movement_item ->> 'instructions'), ''),
        coalesce((movement_item ->> 'catalogued')::boolean, true),
        nullif(movement_item ->> 'segment_key', '')
      );
    end loop;

    insert into public.workout_plan_segment_expectations (
      plan_round_id, segment_key, segment_kind, difficulty, note,
      from_movement_key, to_movement_key
    )
    select created_round_id, rating.segment_key, rating.segment_kind, rating.difficulty,
           rating.note, rating.from_movement_key, rating.to_movement_key
      from private.ratings_rows(round_item -> 'ratings') rating;
  end loop;
end;
$$;

create or replace function private.insert_occurrence_rounds(target_occurrence_id uuid, round_payload jsonb)
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
      rest_seconds, instructions, source_text, sequence
    ) values (
      target_occurrence_id, round_position,
      nullif(btrim(round_item ->> 'label'), ''),
      nullif(round_item ->> 'repetitions', '')::integer,
      nullif(round_item ->> 'duration_seconds', '')::integer,
      nullif(round_item ->> 'rest_seconds', '')::integer,
      nullif(btrim(round_item ->> 'instructions'), ''),
      nullif(btrim(round_item ->> 'source_text'), ''),
      case when jsonb_typeof(round_item -> 'sequence') = 'array' then round_item -> 'sequence' end
    ) returning id into created_round_id;

    for movement_item, movement_position in
      select value, ordinality
        from jsonb_array_elements(coalesce(round_item -> 'movements', '[]'::jsonb))
             with ordinality
    loop
      insert into public.training_occurrence_movements (
        occurrence_round_id, position, movement_key, movement_name_snapshot,
        side, repetitions, duration_seconds, instructions, catalogued, segment_key
      ) values (
        created_round_id, movement_position,
        movement_item ->> 'movement_key',
        coalesce(movement_item ->> 'movement_name', movement_item ->> 'movement_name_snapshot'),
        nullif(btrim(movement_item ->> 'side'), ''),
        nullif(movement_item ->> 'repetitions', '')::integer,
        nullif(movement_item ->> 'duration_seconds', '')::integer,
        nullif(btrim(movement_item ->> 'instructions'), ''),
        coalesce((movement_item ->> 'catalogued')::boolean, true),
        nullif(movement_item ->> 'segment_key', '')
      );
    end loop;
  end loop;
end;
$$;

create function private.insert_round_assessments(
  target_participation_id uuid,
  target_occurrence_id uuid,
  round_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  round_item jsonb;
  round_position bigint;
begin
  if round_payload is null or jsonb_typeof(round_payload) <> 'array' then
    return;
  end if;
  for round_item, round_position in
    select value, ordinality from jsonb_array_elements(round_payload) with ordinality
  loop
    insert into public.training_segment_assessments (
      participation_id, occurrence_round_id, segment_key, segment_kind,
      difficulty, note, from_movement_key, to_movement_key
    )
    select target_participation_id, round.id, rating.segment_key, rating.segment_kind,
           rating.difficulty, rating.note, rating.from_movement_key, rating.to_movement_key
      from public.training_occurrence_rounds round
      cross join private.ratings_rows(round_item -> 'ratings') rating
     where round.occurrence_id = target_occurrence_id
       and round.position = round_position;
  end loop;
end;
$$;

create or replace function private.copy_plan_to_occurrence(
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
      rest_seconds, instructions, source_text, sequence
    ) values (
      target_occurrence_id, source_round.position, source_round.label,
      source_round.repetitions, source_round.duration_seconds,
      source_round.rest_seconds, source_round.instructions,
      source_round.source_text, source_round.sequence
    ) returning id into created_round_id;

    insert into public.training_occurrence_movements (
      occurrence_round_id, position, movement_key, movement_name_snapshot,
      side, repetitions, duration_seconds, instructions, catalogued, segment_key
    )
    select created_round_id, movement.position, movement.movement_key,
           movement.movement_name_snapshot, movement.side, movement.repetitions,
           movement.duration_seconds, movement.instructions,
           movement.catalogued, movement.segment_key
      from public.workout_plan_movements movement
     where movement.plan_round_id = source_round.id
     order by movement.position;
  end loop;
end;
$$;

create function private.ratings_json(ratings_source text, target_round_id uuid, target_participation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'segment_key', rating.segment_key, 'segment_kind', rating.segment_kind::text,
    'difficulty', rating.difficulty::text, 'note', rating.note,
    'from_movement_key', rating.from_movement_key, 'to_movement_key', rating.to_movement_key
  ) order by rating.segment_key), '[]'::jsonb)
  from (
    select expectation.segment_key, expectation.segment_kind, expectation.difficulty,
           expectation.note, expectation.from_movement_key, expectation.to_movement_key
      from public.workout_plan_segment_expectations expectation
     where ratings_source = 'plan' and expectation.plan_round_id = target_round_id
    union all
    select assessment.segment_key, assessment.segment_kind, assessment.difficulty,
           assessment.note, assessment.from_movement_key, assessment.to_movement_key
      from public.training_segment_assessments assessment
     where ratings_source = 'occurrence'
       and assessment.occurrence_round_id = target_round_id
       and assessment.participation_id = target_participation_id
  ) rating;
$$;

create or replace function private.plan_rounds_json(target_version_id uuid)
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
      'source_text', round.source_text, 'sequence', round.sequence,
      'ratings', private.ratings_json('plan', round.id, null),
      'movements', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', movement.id, 'position', movement.position,
          'movement_key', movement.movement_key,
          'movement_name', movement.movement_name_snapshot,
          'catalogued', movement.catalogued, 'segment_key', movement.segment_key,
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

create or replace function private.occurrence_rounds_json(
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
    'source_text', round.source_text, 'sequence', round.sequence,
    'ratings', private.ratings_json('occurrence', round.id, target_participation_id),
    'planned', coalesce((
      select private.ratings_json('plan', plan_round.id, null)
        from public.training_occurrences occurrence
        join public.scheduled_trainings schedule on schedule.id = occurrence.schedule_id
        join public.workout_plan_rounds plan_round
          on plan_round.plan_version_id = schedule.plan_version_id
         and plan_round.position = round.position
       where occurrence.id = round.occurrence_id
    ), '[]'::jsonb),
    'movements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', movement.id, 'position', movement.position,
        'movement_key', movement.movement_key,
        'movement_name', movement.movement_name_snapshot,
        'catalogued', movement.catalogued, 'segment_key', movement.segment_key,
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

create or replace function private.record_alone_training(
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
  perform private.insert_round_assessments(
    created_participation.id, created_occurrence.id, target_rounds
  );
  return jsonb_build_object(
    'status', 'completed', 'occurrence_id', created_occurrence.id,
    'participation_id', created_participation.id,
    'participation_ids', jsonb_build_array(created_participation.id)
  );
end;
$$;

create function private.save_round_assessments(
  actor_id uuid,
  target_participation_id uuid,
  target_round_id uuid,
  ratings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if actor_id is null or not exists (
    select 1
      from public.training_participations participation
      join public.training_occurrence_rounds round
        on round.occurrence_id = participation.occurrence_id
     where participation.id = target_participation_id
       and participation.profile_id = actor_id
       and round.id = target_round_id
  ) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  delete from public.training_segment_assessments
   where participation_id = target_participation_id
     and occurrence_round_id = target_round_id;
  insert into public.training_segment_assessments (
    participation_id, occurrence_round_id, segment_key, segment_kind,
    difficulty, note, from_movement_key, to_movement_key
  )
  select target_participation_id, target_round_id, rating.segment_key, rating.segment_kind,
         rating.difficulty, rating.note, rating.from_movement_key, rating.to_movement_key
    from private.ratings_rows(ratings) rating;
  return jsonb_build_object('status', 'saved', 'round_id', target_round_id);
end;
$$;

create function public.save_round_assessments(
  participation_id uuid,
  round_id uuid,
  ratings jsonb
)
returns jsonb
language sql
set search_path = ''
as $$
  select private.save_round_assessments(auth.uid(), participation_id, round_id, ratings);
$$;

revoke execute on function private.protect_published_plan_expectation() from public, anon, authenticated;
revoke execute on function private.ratings_rows(jsonb) from public, anon, authenticated;
revoke execute on function private.insert_round_assessments(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function private.ratings_json(text, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.save_round_assessments(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function private.save_round_assessments(uuid, uuid, uuid, jsonb) to authenticated;
revoke execute on function public.save_round_assessments(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_round_assessments(uuid, uuid, jsonb) to authenticated;
