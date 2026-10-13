-- supabase/migrations/202610250004_coach_calendar_access.sql
-- Ruling 19: a coach's calendar lists only classes the coach can still open.
create or replace function private.list_my_calendar(actor_id uuid, range_start date, range_end_exclusive date)
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
  plan_title text,
  student_name text,
  role text,
  resource_kinds jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;

  return query
  select own.item_id, own.item_type, own.local_date, own.kind, own.status, own.starts_at,
         own.duration_minutes, own.group_id, own.group_name, own.coach_profile_id,
         own.coach_name, own.visible_in_advance, own.plan_title, null::text,
         case when own.item_type = 'scheduled' and own.coach_profile_id = actor_id
              then 'coach'::text else 'participant'::text end,
         case when own.item_type = 'completed'
              then private.occurrence_resource_kinds(own.item_id) else '[]'::jsonb end
    from private.list_training_calendar(actor_id, range_start, range_end_exclusive, null) own
  union all
  -- Classes the caller arranged that the own calendar does not list:
  -- personal classes, and group classes of groups the caller is not a member of.
  select schedule.id, 'scheduled'::text, schedule.local_date, schedule.kind::text,
         schedule.state::text, schedule.starts_at, schedule.expected_duration_minutes,
         schedule.group_id, target_group.name, schedule.arranged_by, coach.display_name,
         schedule.visible_in_advance, plan.title, student.display_name, 'coach'::text, '[]'::jsonb
    from public.scheduled_trainings schedule
    join public.workout_plan_versions version on version.id = schedule.plan_version_id
    join public.workout_plans plan on plan.id = version.plan_id
    left join public.groups target_group on target_group.id = schedule.group_id
    left join public.profiles coach on coach.id = schedule.arranged_by
    left join public.profiles student on student.id = schedule.student_profile_id
   where schedule.arranged_by = actor_id
     and schedule.state = 'scheduled'
     and schedule.local_date >= range_start
     and schedule.local_date < range_end_exclusive
     -- Added by 202610250004: only classes the caller can still open.
     and private.can_manage_schedule(actor_id, schedule.id)
     and not (schedule.kind = 'group' and exists (
       select 1 from public.group_memberships membership
        where membership.group_id = schedule.group_id
          and membership.profile_id = actor_id
          and membership.state = 'active'
     ))
  union all
  -- Classes the caller taught and recorded without attending them.
  select occurrence.id, 'completed'::text, occurrence.local_date, occurrence.kind::text,
         'completed'::text, occurrence.occurred_at, occurrence.default_duration_minutes,
         occurrence.group_id, target_group.name, occurrence.recorded_by, coach.display_name,
         true, plan.title, student.display_name, 'coach'::text, private.occurrence_resource_kinds(occurrence.id)
    from public.training_occurrences occurrence
    left join public.groups target_group on target_group.id = occurrence.group_id
    left join public.profiles coach on coach.id = occurrence.recorded_by
    left join public.profiles student on student.id = occurrence.student_profile_id
    left join public.scheduled_trainings schedule on schedule.id = occurrence.schedule_id
    left join public.workout_plan_versions version on version.id = schedule.plan_version_id
    left join public.workout_plans plan on plan.id = version.plan_id
   where occurrence.recorded_by = actor_id
     and occurrence.kind::text <> 'alone'
     and occurrence.local_date >= range_start
     and occurrence.local_date < range_end_exclusive
     and exists (
       select 1 from public.training_participations attendee
        where attendee.occurrence_id = occurrence.id
     )
     and not exists (
       select 1 from public.training_participations mine
        where mine.occurrence_id = occurrence.id and mine.profile_id = actor_id
     )
   order by 3, 6, 1;
end;
$$;
