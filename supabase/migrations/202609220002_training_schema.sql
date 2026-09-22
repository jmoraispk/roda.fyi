create type public.workout_plan_state as enum ('draft', 'published', 'archived');
create type public.scheduled_training_kind as enum ('group', 'personal_class');
create type public.scheduled_training_state as enum ('scheduled', 'cancelled', 'completed');
create type public.training_kind as enum ('alone', 'group', 'personal_class');
create type public.movement_difficulty as enum ('easy', 'okay', 'hard');

create table public.workout_plans (
  id uuid primary key default extensions.gen_random_uuid(),
  creator_profile_id uuid not null references public.profiles(id) on delete restrict,
  source_group_id uuid references public.groups(id) on delete set null,
  title text not null,
  description text,
  state public.workout_plan_state not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workout_plans_title_check
    check (char_length(btrim(title)) between 1 and 200),
  constraint workout_plans_description_check
    check (description is null or char_length(description) <= 4000)
);

create table public.workout_plan_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  plan_id uuid not null references public.workout_plans(id) on delete cascade,
  version_number integer not null,
  expected_duration_minutes integer not null,
  instructions text,
  published_at timestamptz,
  published_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workout_plan_versions_unique unique (plan_id, version_number),
  constraint workout_plan_versions_number_check check (version_number > 0),
  constraint workout_plan_versions_duration_check
    check (expected_duration_minutes between 1 and 1440),
  constraint workout_plan_versions_instructions_check
    check (instructions is null or char_length(instructions) <= 4000),
  constraint workout_plan_versions_publication_check check (
    (published_at is null and published_by is null)
    or (published_at is not null and published_by is not null)
  )
);

create table public.workout_plan_rounds (
  id uuid primary key default extensions.gen_random_uuid(),
  plan_version_id uuid not null references public.workout_plan_versions(id) on delete cascade,
  position integer not null,
  label text,
  repetitions integer,
  duration_seconds integer,
  rest_seconds integer,
  instructions text,
  created_at timestamptz not null default now(),
  constraint workout_plan_rounds_unique unique (plan_version_id, position),
  constraint workout_plan_rounds_position_check check (position > 0),
  constraint workout_plan_rounds_label_check
    check (label is null or char_length(label) <= 200),
  constraint workout_plan_rounds_repetitions_check
    check (repetitions is null or repetitions > 0),
  constraint workout_plan_rounds_duration_check
    check (duration_seconds is null or duration_seconds > 0),
  constraint workout_plan_rounds_rest_check
    check (rest_seconds is null or rest_seconds >= 0),
  constraint workout_plan_rounds_instructions_check
    check (instructions is null or char_length(instructions) <= 2000)
);

create table public.workout_plan_movements (
  id uuid primary key default extensions.gen_random_uuid(),
  plan_round_id uuid not null references public.workout_plan_rounds(id) on delete cascade,
  position integer not null,
  movement_key text not null,
  movement_name_snapshot text not null,
  side text,
  repetitions integer,
  duration_seconds integer,
  instructions text,
  created_at timestamptz not null default now(),
  constraint workout_plan_movements_unique unique (plan_round_id, position),
  constraint workout_plan_movements_position_check check (position > 0),
  constraint workout_plan_movements_key_check
    check (movement_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint workout_plan_movements_name_check
    check (char_length(btrim(movement_name_snapshot)) between 1 and 200),
  constraint workout_plan_movements_side_check
    check (side is null or side in ('left', 'right', 'both')),
  constraint workout_plan_movements_repetitions_check
    check (repetitions is null or repetitions > 0),
  constraint workout_plan_movements_duration_check
    check (duration_seconds is null or duration_seconds > 0),
  constraint workout_plan_movements_instructions_check
    check (instructions is null or char_length(instructions) <= 2000)
);

create table public.scheduled_trainings (
  id uuid primary key default extensions.gen_random_uuid(),
  kind public.scheduled_training_kind not null,
  plan_version_id uuid not null references public.workout_plan_versions(id) on delete restrict,
  arranged_by uuid not null references public.coach_profiles(profile_id) on delete restrict,
  group_id uuid references public.groups(id) on delete restrict,
  student_profile_id uuid references public.profiles(id) on delete restrict,
  connection_id uuid references public.coach_student_connections(id) on delete restrict,
  starts_at timestamptz not null,
  local_date date not null,
  timezone text not null,
  expected_duration_minutes integer not null,
  visible_in_advance boolean not null default true,
  state public.scheduled_training_state not null default 'scheduled',
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete restrict,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_trainings_context_check check (
    (kind = 'group' and group_id is not null
      and student_profile_id is null and connection_id is null)
    or
    (kind = 'personal_class' and student_profile_id is not null
      and ((group_id is not null)::integer + (connection_id is not null)::integer) = 1)
  ),
  constraint scheduled_trainings_duration_check
    check (expected_duration_minutes between 1 and 1440),
  constraint scheduled_trainings_cancellation_reason_check
    check (cancellation_reason is null or char_length(cancellation_reason) <= 1000),
  constraint scheduled_trainings_state_check check (
    (state <> 'cancelled' and cancelled_at is null and cancelled_by is null
      and cancellation_reason is null)
    or (state = 'cancelled' and cancelled_at is not null and cancelled_by is not null)
  )
);

create table public.training_occurrences (
  id uuid primary key default extensions.gen_random_uuid(),
  schedule_id uuid unique references public.scheduled_trainings(id) on delete restrict,
  kind public.training_kind not null,
  group_id uuid references public.groups(id) on delete restrict,
  student_profile_id uuid references public.profiles(id) on delete restrict,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  occurred_at timestamptz not null,
  local_date date not null,
  timezone text not null,
  default_duration_minutes integer not null,
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now(),
  constraint training_occurrences_context_check check (
    (kind = 'alone' and group_id is null and student_profile_id is null)
    or (kind = 'group' and group_id is not null and student_profile_id is null)
    or (kind = 'personal_class' and student_profile_id is not null)
  ),
  constraint training_occurrences_schedule_check check (
    (kind = 'alone' and schedule_id is null)
    or kind <> 'alone'
  ),
  constraint training_occurrences_duration_check
    check (default_duration_minutes between 1 and 1440)
);

create table public.training_occurrence_rounds (
  id uuid primary key default extensions.gen_random_uuid(),
  occurrence_id uuid not null references public.training_occurrences(id) on delete cascade,
  position integer not null,
  label text,
  repetitions integer,
  duration_seconds integer,
  rest_seconds integer,
  instructions text,
  created_at timestamptz not null default now(),
  constraint training_occurrence_rounds_unique unique (occurrence_id, position),
  constraint training_occurrence_rounds_position_check check (position > 0),
  constraint training_occurrence_rounds_label_check
    check (label is null or char_length(label) <= 200),
  constraint training_occurrence_rounds_repetitions_check
    check (repetitions is null or repetitions > 0),
  constraint training_occurrence_rounds_duration_check
    check (duration_seconds is null or duration_seconds > 0),
  constraint training_occurrence_rounds_rest_check
    check (rest_seconds is null or rest_seconds >= 0),
  constraint training_occurrence_rounds_instructions_check
    check (instructions is null or char_length(instructions) <= 2000)
);

create table public.training_occurrence_movements (
  id uuid primary key default extensions.gen_random_uuid(),
  occurrence_round_id uuid not null references public.training_occurrence_rounds(id) on delete cascade,
  position integer not null,
  movement_key text not null,
  movement_name_snapshot text not null,
  side text,
  repetitions integer,
  duration_seconds integer,
  instructions text,
  created_at timestamptz not null default now(),
  constraint training_occurrence_movements_unique unique (occurrence_round_id, position),
  constraint training_occurrence_movements_position_check check (position > 0),
  constraint training_occurrence_movements_key_check
    check (movement_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint training_occurrence_movements_name_check
    check (char_length(btrim(movement_name_snapshot)) between 1 and 200),
  constraint training_occurrence_movements_side_check
    check (side is null or side in ('left', 'right', 'both')),
  constraint training_occurrence_movements_repetitions_check
    check (repetitions is null or repetitions > 0),
  constraint training_occurrence_movements_duration_check
    check (duration_seconds is null or duration_seconds > 0),
  constraint training_occurrence_movements_instructions_check
    check (instructions is null or char_length(instructions) <= 2000)
);

create table public.training_participations (
  id uuid primary key default extensions.gen_random_uuid(),
  occurrence_id uuid not null references public.training_occurrences(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  actual_duration_minutes integer not null,
  personal_notes text,
  confirmed_at timestamptz not null,
  confirmed_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_participations_unique unique (occurrence_id, profile_id),
  constraint training_participations_duration_check
    check (actual_duration_minutes between 1 and 1440),
  constraint training_participations_notes_check
    check (personal_notes is null or char_length(personal_notes) <= 4000)
);

create table public.training_movement_assessments (
  id uuid primary key default extensions.gen_random_uuid(),
  participation_id uuid not null references public.training_participations(id) on delete cascade,
  occurrence_movement_id uuid not null references public.training_occurrence_movements(id) on delete cascade,
  difficulty public.movement_difficulty not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_movement_assessments_unique
    unique (participation_id, occurrence_movement_id),
  constraint training_movement_assessments_note_check
    check (note is null or char_length(note) <= 2000)
);

create table public.training_feedback (
  id uuid primary key default extensions.gen_random_uuid(),
  participation_id uuid not null references public.training_participations(id) on delete cascade,
  coach_profile_id uuid not null references public.coach_profiles(profile_id) on delete restrict,
  group_id uuid references public.groups(id) on delete restrict,
  connection_id uuid references public.coach_student_connections(id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_feedback_context_check
    check (((group_id is not null)::integer + (connection_id is not null)::integer) = 1),
  constraint training_feedback_body_check
    check (char_length(btrim(body)) between 1 and 4000)
);

create index workout_plans_creator_idx
  on public.workout_plans (creator_profile_id, updated_at desc);
create index workout_plans_group_idx
  on public.workout_plans (source_group_id, updated_at desc) where source_group_id is not null;
create index scheduled_trainings_group_date_idx
  on public.scheduled_trainings (group_id, local_date, starts_at) where group_id is not null;
create index scheduled_trainings_student_date_idx
  on public.scheduled_trainings (student_profile_id, local_date, starts_at)
  where student_profile_id is not null;
create index training_occurrences_group_date_idx
  on public.training_occurrences (group_id, local_date, occurred_at) where group_id is not null;
create index training_participations_profile_idx
  on public.training_participations (profile_id, confirmed_at desc);
create index training_feedback_participation_idx
  on public.training_feedback (participation_id, created_at);

create trigger workout_plans_set_updated_at
before update on public.workout_plans
for each row execute function private.set_updated_at();
create trigger workout_plan_versions_set_updated_at
before update on public.workout_plan_versions
for each row execute function private.set_updated_at();
create trigger scheduled_trainings_set_updated_at
before update on public.scheduled_trainings
for each row execute function private.set_updated_at();
create trigger training_participations_set_updated_at
before update on public.training_participations
for each row execute function private.set_updated_at();
create trigger training_movement_assessments_set_updated_at
before update on public.training_movement_assessments
for each row execute function private.set_updated_at();
create trigger training_feedback_set_updated_at
before update on public.training_feedback
for each row execute function private.set_updated_at();

create function private.set_scheduled_training_duration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.expected_duration_minutes is null then
    select version.expected_duration_minutes into new.expected_duration_minutes
      from public.workout_plan_versions version
     where version.id = new.plan_version_id;
  end if;
  return new;
end;
$$;

create trigger scheduled_trainings_set_duration
before insert or update of plan_version_id, expected_duration_minutes
on public.scheduled_trainings
for each row execute function private.set_scheduled_training_duration();

create trigger scheduled_trainings_validate_timezone
before insert or update of timezone on public.scheduled_trainings
for each row execute function private.validate_group_timezone();
create trigger training_occurrences_validate_timezone
before insert or update of timezone on public.training_occurrences
for each row execute function private.validate_group_timezone();

create function private.normalize_training_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.movement_key := trim(both '-' from regexp_replace(
    lower(btrim(coalesce(new.movement_key, ''))), '[^a-z0-9]+', '-', 'g'
  ));
  new.movement_name_snapshot := btrim(coalesce(new.movement_name_snapshot, ''));
  if new.movement_key = '' or new.movement_name_snapshot = '' then
    raise exception using errcode = 'P0001', message = 'invalid_movement';
  end if;
  return new;
end;
$$;

create trigger workout_plan_movements_normalize
before insert or update of movement_key, movement_name_snapshot
on public.workout_plan_movements
for each row execute function private.normalize_training_movement();
create trigger training_occurrence_movements_normalize
before insert or update of movement_key, movement_name_snapshot
on public.training_occurrence_movements
for each row execute function private.normalize_training_movement();

create function private.protect_published_plan_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.published_at is not null then
    raise exception using errcode = 'P0001', message = 'published_plan_immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function private.protect_published_plan_round()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_version_id uuid;
begin
  target_version_id := case when tg_op = 'DELETE' then old.plan_version_id else new.plan_version_id end;
  if exists (
    select 1 from public.workout_plan_versions version
     where version.id = target_version_id and version.published_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'published_plan_immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function private.protect_published_plan_movement()
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

create trigger workout_plan_versions_protect_published
before update or delete on public.workout_plan_versions
for each row execute function private.protect_published_plan_version();
create trigger workout_plan_rounds_protect_published
before insert or update or delete on public.workout_plan_rounds
for each row execute function private.protect_published_plan_round();
create trigger workout_plan_movements_protect_published
before insert or update or delete on public.workout_plan_movements
for each row execute function private.protect_published_plan_movement();

create function private.occurrence_is_completed(target_occurrence_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1 from public.training_participations participation
     where participation.occurrence_id = target_occurrence_id
  ), false);
$$;

create function private.protect_completed_occurrence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_occurrence_id uuid;
begin
  target_occurrence_id := case when tg_op = 'DELETE' then old.id else new.id end;
  if private.occurrence_is_completed(target_occurrence_id) then
    raise exception using errcode = 'P0001', message = 'completed_training_immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function private.protect_completed_occurrence_round()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_occurrence_id uuid;
begin
  target_occurrence_id := case when tg_op = 'DELETE' then old.occurrence_id else new.occurrence_id end;
  if private.occurrence_is_completed(target_occurrence_id) then
    raise exception using errcode = 'P0001', message = 'completed_training_immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function private.protect_completed_occurrence_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_round_id uuid;
declare target_occurrence_id uuid;
begin
  target_round_id := case when tg_op = 'DELETE' then old.occurrence_round_id else new.occurrence_round_id end;
  select round.occurrence_id into target_occurrence_id
    from public.training_occurrence_rounds round where round.id = target_round_id;
  if private.occurrence_is_completed(target_occurrence_id) then
    raise exception using errcode = 'P0001', message = 'completed_training_immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger training_occurrences_protect_completed
before update or delete on public.training_occurrences
for each row execute function private.protect_completed_occurrence();
create trigger training_occurrence_rounds_protect_completed
before insert or update or delete on public.training_occurrence_rounds
for each row execute function private.protect_completed_occurrence_round();
create trigger training_occurrence_movements_protect_completed
before insert or update or delete on public.training_occurrence_movements
for each row execute function private.protect_completed_occurrence_movement();

create function private.can_read_training(actor_id uuid, practitioner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select actor_id is not null
     and practitioner_id is not null
     and (
       actor_id = practitioner_id
       or private.can_coach_practitioner(actor_id, practitioner_id, null)
       or exists (
         select 1
           from public.group_memberships membership
          where membership.profile_id = practitioner_id
            and membership.state = 'active'
            and private.has_full_parent_coaching(actor_id, membership.group_id)
       )
     );
$$;

create function private.can_manage_schedule(actor_id uuid, target_schedule_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from public.scheduled_trainings schedule
     where schedule.id = target_schedule_id
       and schedule.arranged_by = actor_id
       and (
         (schedule.kind = 'group' and private.is_group_coach(schedule.group_id, actor_id))
         or
         (schedule.kind = 'personal_class' and (
           (schedule.group_id is not null and private.can_coach_practitioner(
             actor_id, schedule.student_profile_id, schedule.group_id
           ))
           or
           (schedule.connection_id is not null and exists (
             select 1 from public.coach_student_connections connection
              where connection.id = schedule.connection_id
                and connection.coach_profile_id = actor_id
                and connection.student_profile_id = schedule.student_profile_id
                and connection.state = 'active'
           ))
         ))
       )
  ), false);
$$;

create function private.can_write_training_feedback(
  actor_id uuid,
  target_participation_id uuid,
  context_group_id uuid,
  context_connection_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from public.training_participations participation
     where participation.id = target_participation_id
       and (((context_group_id is not null)::integer
             + (context_connection_id is not null)::integer) = 1)
       and (
         (context_group_id is not null
           and private.is_group_coach(context_group_id, actor_id)
           and private.has_group_coaching_connection(
             actor_id, participation.profile_id, context_group_id
           ))
         or
         (context_connection_id is not null and exists (
           select 1 from public.coach_student_connections connection
            where connection.id = context_connection_id
              and connection.coach_profile_id = actor_id
              and connection.student_profile_id = participation.profile_id
              and connection.state = 'active'
         ))
       )
  ), false);
$$;

alter table public.workout_plans enable row level security;
alter table public.workout_plans force row level security;
alter table public.workout_plan_versions enable row level security;
alter table public.workout_plan_versions force row level security;
alter table public.workout_plan_rounds enable row level security;
alter table public.workout_plan_rounds force row level security;
alter table public.workout_plan_movements enable row level security;
alter table public.workout_plan_movements force row level security;
alter table public.scheduled_trainings enable row level security;
alter table public.scheduled_trainings force row level security;
alter table public.training_occurrences enable row level security;
alter table public.training_occurrences force row level security;
alter table public.training_occurrence_rounds enable row level security;
alter table public.training_occurrence_rounds force row level security;
alter table public.training_occurrence_movements enable row level security;
alter table public.training_occurrence_movements force row level security;
alter table public.training_participations enable row level security;
alter table public.training_participations force row level security;
alter table public.training_movement_assessments enable row level security;
alter table public.training_movement_assessments force row level security;
alter table public.training_feedback enable row level security;
alter table public.training_feedback force row level security;

create policy workout_plans_select_authorized
on public.workout_plans for select to authenticated
using (
  creator_profile_id = auth.uid()
  or (source_group_id is not null and private.is_group_coach(source_group_id, auth.uid()))
);

create policy workout_plan_versions_select_authorized
on public.workout_plan_versions for select to authenticated
using (exists (
  select 1 from public.workout_plans plan
   where plan.id = workout_plan_versions.plan_id
     and (plan.creator_profile_id = auth.uid()
       or (plan.source_group_id is not null and private.is_group_coach(plan.source_group_id, auth.uid())))
));

create policy workout_plan_rounds_select_authorized
on public.workout_plan_rounds for select to authenticated
using (exists (
  select 1
    from public.workout_plan_versions version
    join public.workout_plans plan on plan.id = version.plan_id
   where version.id = workout_plan_rounds.plan_version_id
     and (plan.creator_profile_id = auth.uid()
       or (plan.source_group_id is not null and private.is_group_coach(plan.source_group_id, auth.uid())))
));

create policy workout_plan_movements_select_authorized
on public.workout_plan_movements for select to authenticated
using (exists (
  select 1
    from public.workout_plan_rounds round
    join public.workout_plan_versions version on version.id = round.plan_version_id
    join public.workout_plans plan on plan.id = version.plan_id
   where round.id = workout_plan_movements.plan_round_id
     and (plan.creator_profile_id = auth.uid()
       or (plan.source_group_id is not null and private.is_group_coach(plan.source_group_id, auth.uid())))
));

create policy scheduled_trainings_select_authorized
on public.scheduled_trainings for select to authenticated
using (
  arranged_by = auth.uid()
  or (group_id is not null and private.is_group_coach(group_id, auth.uid()))
  or (student_profile_id = auth.uid() and (visible_in_advance or state = 'completed'))
  or (kind = 'group' and group_id is not null
      and private.is_active_group_member(group_id, auth.uid()))
);

create policy training_occurrences_select_authorized
on public.training_occurrences for select to authenticated
using (
  recorded_by = auth.uid()
  or exists (
    select 1 from public.training_participations participation
     where participation.occurrence_id = training_occurrences.id
       and private.can_read_training(auth.uid(), participation.profile_id)
  )
);

create policy training_occurrence_rounds_select_authorized
on public.training_occurrence_rounds for select to authenticated
using (exists (
  select 1 from public.training_occurrences occurrence
   where occurrence.id = training_occurrence_rounds.occurrence_id
     and (
       occurrence.recorded_by = auth.uid()
       or exists (
         select 1 from public.training_participations participation
          where participation.occurrence_id = occurrence.id
            and private.can_read_training(auth.uid(), participation.profile_id)
       )
     )
));

create policy training_occurrence_movements_select_authorized
on public.training_occurrence_movements for select to authenticated
using (exists (
  select 1
    from public.training_occurrence_rounds round
    join public.training_occurrences occurrence on occurrence.id = round.occurrence_id
   where round.id = training_occurrence_movements.occurrence_round_id
     and (
       occurrence.recorded_by = auth.uid()
       or exists (
         select 1 from public.training_participations participation
          where participation.occurrence_id = occurrence.id
            and private.can_read_training(auth.uid(), participation.profile_id)
       )
     )
));

create policy training_participations_select_authorized
on public.training_participations for select to authenticated
using (private.can_read_training(auth.uid(), profile_id));

create policy training_movement_assessments_select_authorized
on public.training_movement_assessments for select to authenticated
using (exists (
  select 1 from public.training_participations participation
   where participation.id = training_movement_assessments.participation_id
     and private.can_read_training(auth.uid(), participation.profile_id)
));

create policy training_feedback_select_authorized
on public.training_feedback for select to authenticated
using (exists (
  select 1 from public.training_participations participation
   where participation.id = training_feedback.participation_id
     and (
       participation.profile_id = auth.uid()
       or (training_feedback.group_id is not null
           and private.is_group_coach(training_feedback.group_id, auth.uid()))
       or (training_feedback.connection_id is not null
           and training_feedback.coach_profile_id = auth.uid()
           and private.has_explicit_coaching_connection(
             training_feedback.coach_profile_id, participation.profile_id
           ))
     )
));

revoke all on table
  public.workout_plans,
  public.workout_plan_versions,
  public.workout_plan_rounds,
  public.workout_plan_movements,
  public.scheduled_trainings,
  public.training_occurrences,
  public.training_occurrence_rounds,
  public.training_occurrence_movements,
  public.training_participations,
  public.training_movement_assessments,
  public.training_feedback
from public, anon, authenticated;

grant select on table
  public.workout_plans,
  public.workout_plan_versions,
  public.workout_plan_rounds,
  public.workout_plan_movements,
  public.scheduled_trainings,
  public.training_occurrences,
  public.training_occurrence_rounds,
  public.training_occurrence_movements,
  public.training_participations,
  public.training_movement_assessments,
  public.training_feedback
to authenticated;

revoke execute on function private.set_scheduled_training_duration() from public, anon, authenticated;
revoke execute on function private.normalize_training_movement() from public, anon, authenticated;
revoke execute on function private.protect_published_plan_version() from public, anon, authenticated;
revoke execute on function private.protect_published_plan_round() from public, anon, authenticated;
revoke execute on function private.protect_published_plan_movement() from public, anon, authenticated;
revoke execute on function private.occurrence_is_completed(uuid) from public, anon, authenticated;
revoke execute on function private.protect_completed_occurrence() from public, anon, authenticated;
revoke execute on function private.protect_completed_occurrence_round() from public, anon, authenticated;
revoke execute on function private.protect_completed_occurrence_movement() from public, anon, authenticated;
revoke execute on function private.can_read_training(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.can_manage_schedule(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.can_write_training_feedback(uuid, uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function private.can_read_training(uuid, uuid) to authenticated;
grant execute on function private.can_manage_schedule(uuid, uuid) to authenticated;
grant execute on function private.can_write_training_feedback(uuid, uuid, uuid, uuid) to authenticated;
