-- supabase/migrations/202610120001_usage_mode.sql
-- Train · Both · Teach changes emphasis, never access (spec "Train · Both · Teach").
alter table public.profiles
  add column usage_mode text not null default 'train';

alter table public.profiles
  add constraint profiles_usage_mode_check check (usage_mode in ('train', 'both', 'teach'));

-- Ruling R2: people who already registered coaching start in Both.
update public.profiles profile
   set usage_mode = 'both'
 where exists (
   select 1 from public.coach_profiles coach where coach.profile_id = profile.id
 );

create function private.set_usage_mode(actor uuid, mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare coach_created boolean := false;
begin
  if actor is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if set_usage_mode.mode is null or set_usage_mode.mode not in ('train', 'both', 'teach') then
    raise exception using errcode = 'P0001', message = 'invalid_usage_mode';
  end if;

  update public.profiles
     set usage_mode = set_usage_mode.mode
   where id = actor;
  if not found then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;

  -- Both and Teach register coaching; Train never removes anything.
  if set_usage_mode.mode in ('both', 'teach') then
    insert into public.coach_profiles (profile_id)
    values (actor)
    on conflict (profile_id) do nothing;
    coach_created := found;
  end if;

  return jsonb_build_object(
    'status', 'updated',
    'usage_mode', set_usage_mode.mode,
    'coach_profile_created', coach_created
  );
end;
$$;

create function public.set_usage_mode(mode text)
returns jsonb
language sql
set search_path = ''
as $$ select private.set_usage_mode(auth.uid(), mode); $$;

revoke execute on function private.set_usage_mode(uuid, text) from public, anon, authenticated;
grant execute on function private.set_usage_mode(uuid, text) to authenticated;
revoke execute on function public.set_usage_mode(text) from public, anon, authenticated;
grant execute on function public.set_usage_mode(text) to authenticated;
