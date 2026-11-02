-- supabase/migrations/202611010001_notifications.sql
-- Phone notifications, part 1: devices, preferences, and the delivery log.
-- Spec: docs/superpowers/specs/2026-11-01-notifications-design.md. People
-- reach these tables only through the RPCs below; the sender reaches them
-- through the service-role functions of 202611010002 and 202611010003.

-- Ruling 12: only the push services of the browsers roda supports.
create function private.is_push_endpoint(candidate text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    char_length(candidate) <= 2048
    and candidate ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/[^[:space:]]+$',
    false
  );
$$;

create table public.push_subscriptions (
  id uuid primary key default extensions.gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  locale text not null default 'en',
  timezone text,
  failures integer not null default 0,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_key unique (endpoint),
  constraint push_subscriptions_endpoint_check check (private.is_push_endpoint(endpoint)),
  constraint push_subscriptions_keys_check check (
    p256dh ~ '^[A-Za-z0-9_-]{80,100}={0,2}$' and auth ~ '^[A-Za-z0-9_-]{16,44}={0,2}$'
  ),
  constraint push_subscriptions_locale_check check (locale in ('en', 'pt')),
  constraint push_subscriptions_timezone_check check (timezone is null or char_length(timezone) between 1 and 64),
  constraint push_subscriptions_failures_check check (failures >= 0)
);
create index push_subscriptions_profile_idx on public.push_subscriptions (profile_id, updated_at desc);
create trigger push_subscriptions_set_updated_at
before update on public.push_subscriptions
for each row execute function private.set_updated_at();

create table public.notification_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  setup boolean not null default true,
  before_class boolean not null default true,
  before_minutes integer not null default 60,
  after_class boolean not null default true,
  after_minutes integer not null default 60,
  coach boolean not null default true,
  quiet_start time default '22:00',
  quiet_end time default '08:00',
  updated_at timestamptz not null default now(),
  constraint notification_preferences_before_check check (before_minutes in (15, 30, 60, 120)),
  constraint notification_preferences_after_check check (after_minutes in (30, 60, 120)),
  constraint notification_preferences_quiet_check check (
    (quiet_start is null and quiet_end is null)
    or (
      quiet_start is not null and quiet_end is not null and quiet_start <> quiet_end
      and extract(minute from quiet_start) = 0 and extract(second from quiet_start) = 0
      and extract(minute from quiet_end) = 0 and extract(second from quiet_end) = 0
    )
  )
);

create table public.notification_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  subject_key text not null,
  due_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 1,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notification_deliveries_subject_key unique (profile_id, kind, subject_key),
  constraint notification_deliveries_kind_check check (kind in ('setup', 'before_class', 'after_class', 'coach')),
  constraint notification_deliveries_subject_check check (char_length(subject_key) between 1 and 200),
  constraint notification_deliveries_status_check check (status in ('pending', 'sent', 'failed')),
  constraint notification_deliveries_sent_check check ((status = 'sent') = (sent_at is not null)),
  constraint notification_deliveries_attempts_check check (attempts between 1 and 3)
);
create index notification_deliveries_pending_idx
  on public.notification_deliveries (claimed_at) where status = 'pending';

alter table public.push_subscriptions enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_deliveries enable row level security;
create policy push_subscriptions_select_own on public.push_subscriptions
for select to authenticated using (profile_id = (select auth.uid()));
create policy notification_preferences_select_own on public.notification_preferences
for select to authenticated using (profile_id = (select auth.uid()));
create policy notification_deliveries_select_own on public.notification_deliveries
for select to authenticated using (profile_id = (select auth.uid()));
revoke all on table public.push_subscriptions, public.notification_preferences, public.notification_deliveries
  from public, anon, authenticated;
grant select on table public.push_subscriptions, public.notification_preferences, public.notification_deliveries
  to authenticated;

create function private.save_push_subscription(
  actor_id uuid, new_endpoint text, new_p256dh text, new_auth text, new_locale text, new_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
  zone text := nullif(btrim(coalesce(new_timezone, '')), '');
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if not private.is_push_endpoint(new_endpoint)
     or coalesce(new_p256dh, '') !~ '^[A-Za-z0-9_-]{80,100}={0,2}$'
     or coalesce(new_auth, '') !~ '^[A-Za-z0-9_-]{16,44}={0,2}$'
     or coalesce(new_locale, '') not in ('en', 'pt') then
    raise exception using errcode = 'P0001', message = 'invalid_subscription';
  end if;
  -- Ruling 7: an unknown zone is dropped, not refused; the person's zone then
  -- falls back to their profile or another device.
  if zone is not null and not private.is_valid_timezone(zone) then
    zone := null;
  end if;
  -- Ruling 13: the same endpoint signing into another account moves there.
  insert into public.push_subscriptions as device (profile_id, endpoint, p256dh, auth, locale, timezone)
  values (actor_id, new_endpoint, new_p256dh, new_auth, new_locale, zone)
  on conflict on constraint push_subscriptions_endpoint_key do update
     set profile_id = excluded.profile_id, p256dh = excluded.p256dh, auth = excluded.auth,
         locale = excluded.locale, timezone = excluded.timezone, failures = 0
  returning device.id into saved_id;
  -- At most ten devices per person; the one just saved always stays.
  delete from public.push_subscriptions old
   where old.profile_id = actor_id
     and old.id not in (
       select recent.id from public.push_subscriptions recent
        where recent.profile_id = actor_id
        order by (recent.id = saved_id) desc, recent.updated_at desc, recent.id
        limit 10
     );
  return jsonb_build_object('status', 'saved', 'subscription_id', saved_id);
end;
$$;

create function private.delete_push_subscription(actor_id uuid, target_endpoint text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare removed integer;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  delete from public.push_subscriptions device
   where device.profile_id = actor_id and device.endpoint = target_endpoint;
  get diagnostics removed = row_count;
  return jsonb_build_object('status', case when removed > 0 then 'deleted' else 'missing' end);
end;
$$;

create function private.notification_preferences_json(target_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'setup', coalesce(pref.setup, true),
    'before_class', coalesce(pref.before_class, true),
    'before_minutes', coalesce(pref.before_minutes, 60),
    'after_class', coalesce(pref.after_class, true),
    'after_minutes', coalesce(pref.after_minutes, 60),
    'coach', coalesce(pref.coach, true),
    'quiet_start', case when pref.profile_id is null then '22:00' else left(pref.quiet_start::text, 5) end,
    'quiet_end', case when pref.profile_id is null then '08:00' else left(pref.quiet_end::text, 5) end
  )
  from (select target_profile_id as id) person
  left join public.notification_preferences pref on pref.profile_id = person.id;
$$;

create function private.get_notification_preferences(actor_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  return private.notification_preferences_json(actor_id);
end;
$$;

create function private.update_notification_preferences(
  actor_id uuid, new_setup boolean, new_before_class boolean, new_before_minutes integer,
  new_after_class boolean, new_after_minutes integer, new_coach boolean, new_quiet_start text, new_quiet_end text
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
  if new_setup is null or new_before_class is null or new_after_class is null or new_coach is null
     or new_before_minutes is null or new_before_minutes not in (15, 30, 60, 120)
     or new_after_minutes is null or new_after_minutes not in (30, 60, 120)
     or (new_quiet_start is null) <> (new_quiet_end is null)
     or coalesce(new_quiet_start, '00:00') !~ '^([01][0-9]|2[0-3]):00$'
     or coalesce(new_quiet_end, '00:00') !~ '^([01][0-9]|2[0-3]):00$'
     or (new_quiet_start is not null and new_quiet_start = new_quiet_end) then
    raise exception using errcode = 'P0001', message = 'invalid_preferences';
  end if;
  insert into public.notification_preferences (
    profile_id, setup, before_class, before_minutes, after_class, after_minutes, coach, quiet_start, quiet_end
  ) values (
    actor_id, new_setup, new_before_class, new_before_minutes, new_after_class, new_after_minutes, new_coach,
    new_quiet_start::time, new_quiet_end::time
  )
  on conflict (profile_id) do update
     set setup = excluded.setup, before_class = excluded.before_class, before_minutes = excluded.before_minutes,
         after_class = excluded.after_class, after_minutes = excluded.after_minutes, coach = excluded.coach,
         quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end, updated_at = now();
  return private.notification_preferences_json(actor_id);
end;
$$;

create function public.save_push_subscription(
  endpoint text, p256dh text, auth_key text, locale text, timezone text default null
)
returns jsonb
language sql
set search_path = ''
as $$ select private.save_push_subscription(auth.uid(), endpoint, p256dh, auth_key, locale, timezone); $$;

create function public.delete_push_subscription(endpoint text)
returns jsonb
language sql
set search_path = ''
as $$ select private.delete_push_subscription(auth.uid(), endpoint); $$;

create function public.get_notification_preferences()
returns jsonb
language sql
stable
set search_path = ''
as $$ select private.get_notification_preferences(auth.uid()); $$;

create function public.update_notification_preferences(
  setup boolean, before_class boolean, before_minutes integer, after_class boolean, after_minutes integer,
  coach boolean, quiet_start text default null, quiet_end text default null
)
returns jsonb
language sql
set search_path = ''
as $$
  select private.update_notification_preferences(
    auth.uid(), setup, before_class, before_minutes, after_class, after_minutes, coach, quiet_start, quiet_end
  );
$$;

revoke execute on function private.is_push_endpoint(text) from public, anon, authenticated;
revoke execute on function private.notification_preferences_json(uuid) from public, anon, authenticated;
revoke execute on function private.save_push_subscription(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function private.delete_push_subscription(uuid, text) from public, anon, authenticated;
revoke execute on function private.get_notification_preferences(uuid) from public, anon, authenticated;
revoke execute on function private.update_notification_preferences(uuid, boolean, boolean, integer, boolean, integer, boolean, text, text)
  from public, anon, authenticated;
grant execute on function private.save_push_subscription(uuid, text, text, text, text, text) to authenticated;
grant execute on function private.delete_push_subscription(uuid, text) to authenticated;
grant execute on function private.get_notification_preferences(uuid) to authenticated;
grant execute on function private.update_notification_preferences(uuid, boolean, boolean, integer, boolean, integer, boolean, text, text)
  to authenticated;
revoke execute on function public.save_push_subscription(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.delete_push_subscription(text) from public, anon, authenticated;
revoke execute on function public.get_notification_preferences() from public, anon, authenticated;
revoke execute on function public.update_notification_preferences(boolean, boolean, integer, boolean, integer, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.save_push_subscription(text, text, text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;
grant execute on function public.get_notification_preferences() to authenticated;
grant execute on function public.update_notification_preferences(boolean, boolean, integer, boolean, integer, boolean, text, text)
  to authenticated;
