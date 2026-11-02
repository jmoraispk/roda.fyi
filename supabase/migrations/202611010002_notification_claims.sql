-- supabase/migrations/202611010002_notification_claims.sql
-- Phone notifications, part 2: what is due, and claiming it at most once.
-- Rulings 5, 7, 8, and 9 of docs/superpowers/plans/2026-11-01-notifications.md.

create index scheduled_trainings_upcoming_idx on public.scheduled_trainings (starts_at) where state = 'scheduled';
create index training_occurrences_occurred_idx on public.training_occurrences (occurred_at);

create function private.in_quiet_hours(at_time timestamptz, zone text, quiet_start time, quiet_end time)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when quiet_start is null or quiet_end is null then false
    when quiet_start < quiet_end then
      (at_time at time zone zone)::time >= quiet_start and (at_time at time zone zone)::time < quiet_end
    else
      (at_time at time zone zone)::time >= quiet_start or (at_time at time zone zone)::time < quiet_end
  end;
$$;

-- The first moment at or after at_time that is outside quiet hours.
create function private.after_quiet_hours(at_time timestamptz, zone text, quiet_start time, quiet_end time)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when not private.in_quiet_hours(at_time, zone, quiet_start, quiet_end) then at_time
    when (at_time at time zone zone)::time < quiet_end
      then ((at_time at time zone zone)::date + quiet_end) at time zone zone
    else ((at_time at time zone zone)::date + 1 + quiet_end) at time zone zone
  end;
$$;

-- Ruling 8: due, outside quiet hours, and at most 3 hours after quiet hours let it go.
create function private.can_deliver_now(at_time timestamptz, due_at timestamptz, zone text, quiet_start time, quiet_end time)
returns boolean
language sql
stable
set search_path = ''
as $$
  select at_time >= due_at
     and not private.in_quiet_hours(at_time, zone, quiet_start, quiet_end)
     and at_time < private.after_quiet_hours(due_at, zone, quiet_start, quiet_end) + interval '3 hours';
$$;

-- People with at least one device, with their effective preferences and zone (Ruling 7).
create function private.notification_recipients()
returns table (
  profile_id uuid, setup boolean, before_class boolean, before_minutes integer, after_class boolean,
  after_minutes integer, coach boolean, quiet_start time, quiet_end time, zone text
)
language sql
stable
security definer
set search_path = ''
as $$
  select person.id,
         coalesce(pref.setup, true), coalesce(pref.before_class, true), coalesce(pref.before_minutes, 60),
         coalesce(pref.after_class, true), coalesce(pref.after_minutes, 60), coalesce(pref.coach, true),
         case when pref.profile_id is null then time '22:00' else pref.quiet_start end,
         case when pref.profile_id is null then time '08:00' else pref.quiet_end end,
         coalesce(
           case when private.is_valid_timezone(person.timezone_override) then person.timezone_override end,
           (select device.timezone from public.push_subscriptions device
             where device.profile_id = person.id and device.timezone is not null
             order by device.updated_at desc, device.id limit 1),
           'UTC'
         )
    from public.profiles person
    left join public.notification_preferences pref on pref.profile_id = person.id
   where exists (select 1 from public.push_subscriptions device where device.profile_id = person.id);
$$;

create function private.due_notifications(at_time timestamptz)
returns table (profile_id uuid, kind text, subject_key text, due_at timestamptz, payload jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with recipients as materialized (
    select * from private.notification_recipients()
  ),
  upcoming as (
    select schedule.*
      from public.scheduled_trainings schedule
     where schedule.state = 'scheduled'
       and schedule.starts_at > at_time
       and schedule.starts_at <= at_time + interval '2 hours 10 minutes'
       and not exists (select 1 from public.training_occurrences occurrence where occurrence.schedule_id = schedule.id)
  ),
  audience as (
    select upcoming.id as schedule_id, upcoming.arranged_by as profile_id, 'coach'::text as role
      from upcoming
     where private.can_manage_schedule(upcoming.arranged_by, upcoming.id)
    union
    select upcoming.id, membership.profile_id, 'student'
      from upcoming
      join public.groups target_group on target_group.id = upcoming.group_id and target_group.archived_at is null
      join public.group_memberships membership
        on membership.group_id = upcoming.group_id and membership.state = 'active' and membership.access_level = 'member'
     where upcoming.kind = 'group' and upcoming.visible_in_advance and membership.profile_id <> upcoming.arranged_by
    union
    select upcoming.id, upcoming.student_profile_id, 'student'
      from upcoming
     where upcoming.kind = 'personal_class' and upcoming.visible_in_advance
  )
  -- Before a class
  select r.profile_id, 'before_class'::text,
         'class:' || schedule.id || ':' || extract(epoch from schedule.starts_at)::bigint,
         reminder.moment,
         jsonb_build_object(
           'url', case when audience.role = 'coach' then '/app#/class/' || schedule.id
                       else '/app#/calendar/' || to_char(schedule.local_date, 'YYYY-MM-DD') end,
           'role', audience.role, 'class_kind', schedule.kind::text, 'group_name', target_group.name,
           'person_name', case when audience.role = 'coach' then student.display_name else coach.display_name end,
           'starts_at', schedule.starts_at, 'lead_minutes', r.before_minutes, 'zone', r.zone)
    from audience
    join upcoming schedule on schedule.id = audience.schedule_id
    join recipients r on r.profile_id = audience.profile_id
    left join public.groups target_group on target_group.id = schedule.group_id
    left join public.profiles coach on coach.id = schedule.arranged_by
    left join public.profiles student on student.id = schedule.student_profile_id
    cross join lateral (select schedule.starts_at - make_interval(mins => r.before_minutes) as moment) reminder
   where r.before_class
     and at_time >= reminder.moment
     and at_time < reminder.moment + interval '10 minutes'
     and schedule.created_at <= reminder.moment
     and not private.in_quiet_hours(reminder.moment, r.zone, r.quiet_start, r.quiet_end)
  union all
  -- After a class
  select r.profile_id, 'after_class', 'training:' || occurrence.id, due.moment,
         jsonb_build_object(
           'url', '/app#/training/' || occurrence.id, 'occurrence_id', occurrence.id,
           'class_kind', occurrence.kind::text, 'group_name', target_group.name, 'person_name', coach.display_name,
           'local_date', to_char(occurrence.local_date, 'YYYY-MM-DD'), 'zone', r.zone)
    from public.training_occurrences occurrence
    join public.training_participations participation on participation.occurrence_id = occurrence.id
    join recipients r on r.profile_id = participation.profile_id
    left join public.groups target_group on target_group.id = occurrence.group_id
    left join public.profiles coach on coach.id = occurrence.recorded_by
    cross join lateral (
      select greatest(
        occurrence.occurred_at + make_interval(mins => occurrence.default_duration_minutes + r.after_minutes),
        occurrence.created_at
      ) as moment
    ) due
   where occurrence.kind in ('group', 'personal_class')
     and occurrence.occurred_at > at_time - interval '2 days'
     and occurrence.occurred_at <= at_time
     and participation.profile_id <> occurrence.recorded_by
     and r.after_class
     and private.can_deliver_now(at_time, due.moment, r.zone, r.quiet_start, r.quiet_end)
     and not exists (
       select 1 from public.training_segment_assessments assessment
        where assessment.participation_id = participation.id and assessment.segment_key = 'r'
     )
     and not exists (
       select 1 from public.training_resources resource
        where resource.occurrence_id = occurrence.id and resource.kind = 'video'
     )
  union all
  -- Coach requests: a join request for a group they coach (the owner decides coach access)
  select r.profile_id, 'coach', 'join:' || request.id, request.created_at,
         jsonb_build_object(
           'url', '/app#/group/' || request.group_id, 'reason', 'join',
           'person_name', requester.display_name, 'group_name', target_group.name, 'zone', r.zone)
    from public.group_join_requests request
    join public.groups target_group on target_group.id = request.group_id and target_group.archived_at is null
    join public.profiles requester on requester.id = request.profile_id
    join lateral (
      select membership.profile_id as reviewer_id
        from public.group_memberships membership
       where request.requested_access = 'member'
         and membership.group_id = request.group_id
         and membership.state = 'active'
         and membership.access_level = 'coach'
      union
      select target_group.owner_id where request.requested_access = 'coach'
    ) reviewer on true
    join recipients r on r.profile_id = reviewer.reviewer_id
   where request.state = 'pending'
     and request.created_at > at_time - interval '2 days'
     and reviewer.reviewer_id <> request.profile_id
     and r.coach
     and private.can_deliver_now(at_time, request.created_at, r.zone, r.quiet_start, r.quiet_end)
  union all
  -- Coach requests: a student asking to be coached
  select r.profile_id, 'coach', 'coaching:' || connection.id, connection.created_at,
         jsonb_build_object(
           'url', '/app#/me/teaching', 'reason', 'coaching', 'person_name', student.display_name, 'zone', r.zone)
    from public.coach_student_connections connection
    join public.profiles student on student.id = connection.student_profile_id
    join recipients r on r.profile_id = connection.coach_profile_id
   where connection.state = 'pending'
     and connection.initiated_by = connection.student_profile_id
     and connection.created_at > at_time - interval '2 days'
     and r.coach
     and private.can_deliver_now(at_time, connection.created_at, r.zone, r.quiet_start, r.quiet_end)
  union all
  -- Coach requests: a class they arranged, ended 30 minutes ago and not finished
  select r.profile_id, 'coach', 'finish:' || schedule.id, finish.moment,
         jsonb_build_object(
           'url', '/app#/class/' || schedule.id, 'reason', 'finish', 'class_kind', schedule.kind::text,
           'group_name', target_group.name, 'person_name', student.display_name,
           'local_date', to_char(schedule.local_date, 'YYYY-MM-DD'), 'zone', r.zone)
    from public.scheduled_trainings schedule
    join recipients r on r.profile_id = schedule.arranged_by
    left join public.groups target_group on target_group.id = schedule.group_id
    left join public.profiles student on student.id = schedule.student_profile_id
    cross join lateral (
      select schedule.starts_at + make_interval(mins => schedule.expected_duration_minutes + 30) as moment
    ) finish
   where schedule.state = 'scheduled'
     and schedule.starts_at > at_time - interval '2 days'
     and schedule.starts_at < at_time
     and r.coach
     and not exists (select 1 from public.training_occurrences occurrence where occurrence.schedule_id = schedule.id)
     and private.can_manage_schedule(schedule.arranged_by, schedule.id)
     and private.can_deliver_now(at_time, finish.moment, r.zone, r.quiet_start, r.quiet_end)
  union all
  -- Finish setting up: up to three rounds, a week apart
  select r.profile_id, 'setup', 'setup:' || (sent.rounds + 1), due.moment,
         jsonb_build_object('url', '/app#/', 'round', sent.rounds + 1, 'zone', r.zone)
    from recipients r
    join public.profiles person on person.id = r.profile_id
    cross join lateral (
      select count(*)::integer as rounds, max(delivery.created_at) as last_at
        from public.notification_deliveries delivery
       where delivery.profile_id = r.profile_id and delivery.kind = 'setup'
    ) sent
    cross join lateral (
      select greatest(person.completed_at + interval '2 days', sent.last_at + interval '7 days') as moment
    ) due
   where r.setup
     and person.completed_at is not null
     and sent.rounds < 3
     and at_time >= due.moment
     and not private.in_quiet_hours(at_time, r.zone, r.quiet_start, r.quiet_end)
     and (
       person.place_city is null
       or not (
         exists (
           select 1 from public.group_memberships membership
             join public.groups member_group on member_group.id = membership.group_id
            where membership.profile_id = person.id and membership.state = 'active' and member_group.archived_at is null
         )
         or exists (
           select 1 from public.coach_student_connections connection
            where connection.state = 'active' and person.id in (connection.coach_profile_id, connection.student_profile_id)
         )
       )
       or not (
         exists (select 1 from public.training_participations participation where participation.profile_id = person.id)
         or exists (select 1 from public.training_occurrences occurrence where occurrence.recorded_by = person.id)
       )
     );
$$;

-- Ruling 9: retries first, then new work, never the same subject twice.
create function private.claim_due_notifications(at_time timestamptz, batch_limit integer)
returns table (delivery_id uuid, profile_id uuid, kind text, subject_key text, payload jsonb, devices jsonb)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  room integer := least(greatest(coalesce(batch_limit, 50), 1), 200);
  retried uuid[];
  created uuid[];
begin
  if at_time is null then
    raise exception using errcode = 'P0001', message = 'invalid_time';
  end if;

  update public.notification_deliveries delivery
     set status = 'failed'
   where delivery.status = 'pending'
     and delivery.attempts >= 3
     and delivery.claimed_at <= at_time - interval '15 minutes';

  with stale as (
    select delivery.id
      from public.notification_deliveries delivery
     where delivery.status = 'pending'
       and delivery.claimed_at <= at_time - interval '15 minutes'
     order by delivery.claimed_at, delivery.id
     limit room
     for update skip locked
  ), touched as (
    update public.notification_deliveries delivery
       set claimed_at = at_time, attempts = delivery.attempts + 1
      from stale
     where delivery.id = stale.id
    returning delivery.id
  )
  select coalesce(array_agg(touched.id), '{}'::uuid[]) into retried from touched;

  with fresh as (
    insert into public.notification_deliveries (profile_id, kind, subject_key, due_at, payload, claimed_at, created_at)
    select due.profile_id, due.kind, due.subject_key, due.due_at, due.payload, at_time, at_time
      from private.due_notifications(at_time) due
     where not exists (
       select 1 from public.notification_deliveries logged
        where logged.profile_id = due.profile_id and logged.kind = due.kind and logged.subject_key = due.subject_key
     )
     order by due.due_at, due.profile_id, due.kind, due.subject_key
     limit greatest(room - cardinality(retried), 0)
    on conflict on constraint notification_deliveries_subject_key do nothing
    returning id
  )
  select coalesce(array_agg(fresh.id), '{}'::uuid[]) into created from fresh;

  return query
  select delivery.id, delivery.profile_id, delivery.kind, delivery.subject_key, delivery.payload,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'subscription_id', device.id, 'endpoint', device.endpoint, 'p256dh', device.p256dh,
             'auth', device.auth, 'locale', device.locale
           ) order by device.created_at, device.id)
             from public.push_subscriptions device
            where device.profile_id = delivery.profile_id
         ), '[]'::jsonb)
    from public.notification_deliveries delivery
   where delivery.id = any(retried || created)
   order by delivery.due_at, delivery.id;
end;
$$;

create function public.claim_due_notifications(at_time timestamptz default now(), batch_limit integer default 50)
returns table (delivery_id uuid, profile_id uuid, kind text, subject_key text, payload jsonb, devices jsonb)
language sql
set search_path = ''
as $$ select * from private.claim_due_notifications(at_time, batch_limit); $$;

-- Ruling 5: only the sender (service role) may claim.
grant usage on schema private to service_role;
revoke execute on function private.in_quiet_hours(timestamptz, text, time, time) from public, anon, authenticated;
revoke execute on function private.after_quiet_hours(timestamptz, text, time, time) from public, anon, authenticated;
revoke execute on function private.can_deliver_now(timestamptz, timestamptz, text, time, time) from public, anon, authenticated;
revoke execute on function private.notification_recipients() from public, anon, authenticated;
revoke execute on function private.due_notifications(timestamptz) from public, anon, authenticated;
revoke execute on function private.claim_due_notifications(timestamptz, integer) from public, anon, authenticated;
grant execute on function private.claim_due_notifications(timestamptz, integer) to service_role;
revoke execute on function public.claim_due_notifications(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_due_notifications(timestamptz, integer) to service_role;
