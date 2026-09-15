create or replace function private.assert_group_owner_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  affected_group_id uuid;
begin
  if tg_table_name = 'groups' then
    affected_group_id := coalesce(new.id, old.id);
  elsif tg_table_name = 'group_memberships' then
    affected_group_id := coalesce(new.group_id, old.group_id);
  else
    raise exception using
      errcode = 'P0001',
      message = 'unsupported_owner_integrity_table';
  end if;

  if exists (
    select 1
      from public.groups g
     where g.id = affected_group_id
       and g.archived_at is null
  ) and not exists (
    select 1
      from public.groups g
      join public.group_memberships gm
        on gm.group_id = g.id
       and gm.profile_id = g.owner_id
       and gm.access_level = 'coach'
       and gm.state = 'active'
     where g.id = affected_group_id
       and g.archived_at is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'group_owner_requires_active_coach_membership';
  end if;

  return coalesce(new, old);
end;
$$;

revoke execute on function private.assert_group_owner_integrity() from public, anon, authenticated;
