-- supabase/migrations/202610250002_schedule_idempotency.sql
-- A timed-out "Schedule a class" retried by the coach must not create a second
-- class. The existing private schedulers stay; a thin "once" layer remembers
-- the request key.
alter table public.scheduled_trainings add column idempotency_key uuid;
create unique index scheduled_trainings_idempotency_idx
  on public.scheduled_trainings (arranged_by, idempotency_key) where idempotency_key is not null;

create function private.scheduled_once(actor_id uuid, target_key uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('status', 'scheduled', 'schedule_id', schedule.id)
    from public.scheduled_trainings schedule
   where target_key is not null
     and schedule.arranged_by = actor_id
     and schedule.idempotency_key = target_key;
$$;

create function private.remember_schedule_key(target_schedule_id uuid, target_key uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.scheduled_trainings set idempotency_key = target_key
   where id = target_schedule_id and target_key is not null;
$$;

create function private.schedule_group_training_once(
  actor_id uuid, target_key uuid, target_plan_version_id uuid, target_group_id uuid,
  target_starts_at timestamptz, target_local_date date, target_timezone text, target_visible_in_advance boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if target_key is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text || target_key::text, 0));
    result := private.scheduled_once(actor_id, target_key);
    if result is not null then
      return result;
    end if;
  end if;
  result := private.schedule_group_training(
    actor_id, target_plan_version_id, target_group_id, target_starts_at, target_local_date,
    target_timezone, target_visible_in_advance
  );
  perform private.remember_schedule_key((result ->> 'schedule_id')::uuid, target_key);
  return result;
end;
$$;

create function private.schedule_personal_class_once(
  actor_id uuid, target_key uuid, target_plan_version_id uuid, target_student_profile_id uuid,
  target_group_id uuid, target_connection_id uuid, target_starts_at timestamptz, target_local_date date,
  target_timezone text, target_visible_in_advance boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if target_key is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text || target_key::text, 0));
    result := private.scheduled_once(actor_id, target_key);
    if result is not null then
      return result;
    end if;
  end if;
  result := private.schedule_personal_class(
    actor_id, target_plan_version_id, target_student_profile_id, target_group_id, target_connection_id,
    target_starts_at, target_local_date, target_timezone, target_visible_in_advance
  );
  perform private.remember_schedule_key((result ->> 'schedule_id')::uuid, target_key);
  return result;
end;
$$;

drop function public.schedule_group_training(uuid, uuid, timestamptz, date, text, boolean);
drop function public.schedule_personal_class(uuid, uuid, uuid, uuid, timestamptz, date, text, boolean);

create function public.schedule_group_training(
  plan_version_id uuid, group_id uuid, starts_at timestamptz, local_date date, timezone text,
  visible_in_advance boolean default true, idempotency_key uuid default null
)
returns jsonb language sql set search_path = ''
as $$
  select private.schedule_group_training_once(
    auth.uid(), idempotency_key, plan_version_id, group_id, starts_at, local_date, timezone, visible_in_advance
  );
$$;

create function public.schedule_personal_class(
  plan_version_id uuid, student_profile_id uuid, group_id uuid, connection_id uuid, starts_at timestamptz,
  local_date date, timezone text, visible_in_advance boolean default true, idempotency_key uuid default null
)
returns jsonb language sql set search_path = ''
as $$
  select private.schedule_personal_class_once(
    auth.uid(), idempotency_key, plan_version_id, student_profile_id, group_id, connection_id,
    starts_at, local_date, timezone, visible_in_advance
  );
$$;

revoke execute on function private.scheduled_once(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.remember_schedule_key(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.schedule_group_training_once(uuid, uuid, uuid, uuid, timestamptz, date, text, boolean) from public, anon, authenticated;
revoke execute on function private.schedule_personal_class_once(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, date, text, boolean) from public, anon, authenticated;
grant execute on function private.schedule_group_training_once(uuid, uuid, uuid, uuid, timestamptz, date, text, boolean) to authenticated;
grant execute on function private.schedule_personal_class_once(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, date, text, boolean) to authenticated;
revoke execute on function public.schedule_group_training(uuid, uuid, timestamptz, date, text, boolean, uuid) from public, anon, authenticated;
revoke execute on function public.schedule_personal_class(uuid, uuid, uuid, uuid, timestamptz, date, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.schedule_group_training(uuid, uuid, timestamptz, date, text, boolean, uuid) to authenticated;
grant execute on function public.schedule_personal_class(uuid, uuid, uuid, uuid, timestamptz, date, text, boolean, uuid) to authenticated;
