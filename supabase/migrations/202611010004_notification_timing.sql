-- Phone notifications, part 4: two fixes from the final review.
-- 1. A coach request or after-class reminder due just before quiet hours was
--    dropped; it now waits for quiet hours to end, like one due inside them.
-- 2. Finding recipients checked each person's time zone against the full list
--    of zones, once per person; the list is now read once per run.

-- When a reminder stops being worth sending: three hours after it is due, or,
-- if quiet hours begin before then, three hours after those quiet hours end.
create function private.notification_expiry(due_at timestamptz, zone text, quiet_start time, quiet_end time)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when quiet_start is null or quiet_end is null then due_at + interval '3 hours'
    when private.in_quiet_hours(due_at, zone, quiet_start, quiet_end)
      then private.after_quiet_hours(due_at, zone, quiet_start, quiet_end) + interval '3 hours'
    when next_quiet.starts_at < due_at + interval '3 hours'
      then private.after_quiet_hours(next_quiet.starts_at, zone, quiet_start, quiet_end) + interval '3 hours'
    else due_at + interval '3 hours'
  end
  from (
    select case
      when (due_at at time zone zone)::time < quiet_start
        then ((due_at at time zone zone)::date + quiet_start) at time zone zone
      else ((due_at at time zone zone)::date + 1 + quiet_start) at time zone zone
    end as starts_at
  ) next_quiet;
$$;

create or replace function private.can_deliver_now(at_time timestamptz, due_at timestamptz, zone text, quiet_start time, quiet_end time)
returns boolean
language sql
stable
set search_path = ''
as $$
  select at_time >= due_at
     and not private.in_quiet_hours(at_time, zone, quiet_start, quiet_end)
     and at_time < private.notification_expiry(due_at, zone, quiet_start, quiet_end);
$$;

create or replace function private.notification_recipients()
returns table (
  profile_id uuid, setup boolean, before_class boolean, before_minutes integer, after_class boolean,
  after_minutes integer, coach boolean, quiet_start time, quiet_end time, zone text
)
language sql
stable
security definer
set search_path = ''
as $$
  with zones as materialized (
    select zone_name.name from pg_catalog.pg_timezone_names zone_name
  )
  select person.id,
         coalesce(pref.setup, true), coalesce(pref.before_class, true), coalesce(pref.before_minutes, 60),
         coalesce(pref.after_class, true), coalesce(pref.after_minutes, 60), coalesce(pref.coach, true),
         case when pref.profile_id is null then time '22:00' else pref.quiet_start end,
         case when pref.profile_id is null then time '08:00' else pref.quiet_end end,
         coalesce(
           override_zone.name,
           (select device.timezone from public.push_subscriptions device
             where device.profile_id = person.id and device.timezone is not null
             order by device.updated_at desc, device.id limit 1),
           'UTC'
         )
    from public.profiles person
    left join public.notification_preferences pref on pref.profile_id = person.id
    left join zones override_zone on override_zone.name = btrim(person.timezone_override)
   where exists (select 1 from public.push_subscriptions device where device.profile_id = person.id);
$$;

revoke execute on function private.notification_expiry(timestamptz, text, time, time) from public, anon, authenticated;
