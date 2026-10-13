-- supabase/migrations/202610250001_resource_idempotency.sql
-- A reload right after Save can send the same resource again. Each resource
-- now carries the client's key, and a repeated key returns the first row.
alter table public.training_resources add column client_key uuid;
create unique index training_resources_client_key_idx
  on public.training_resources (added_by, client_key) where client_key is not null;

drop function public.add_training_resource(uuid, text, text, text, text);
drop function private.add_training_resource(uuid, uuid, text, text, text, text);

create function private.add_training_resource(
  actor_id uuid, target_occurrence_id uuid, new_kind text, new_title text, new_url text, new_body text,
  target_client_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare existing public.training_resources;
declare created_id uuid;
begin
  if not private.can_write_training_resources(actor_id, target_occurrence_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  insert into public.training_resources (occurrence_id, kind, title, url, body, added_by, client_key)
  values (
    target_occurrence_id, new_kind, nullif(btrim(coalesce(new_title, '')), ''),
    nullif(btrim(coalesce(new_url, '')), ''), new_body, actor_id, target_client_key
  )
  on conflict (added_by, client_key) where client_key is not null do nothing
  returning id into created_id;
  if created_id is null then
    select * into existing from public.training_resources resource
     where resource.added_by = actor_id and resource.client_key = target_client_key;
    if existing.occurrence_id <> target_occurrence_id then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;
    created_id := existing.id;
  end if;
  return jsonb_build_object('status', 'saved', 'resource_id', created_id);
end;
$$;

create function public.add_training_resource(
  occurrence_id uuid, kind text, title text, url text, body text, client_key uuid default null
)
returns jsonb language sql set search_path = ''
as $$ select private.add_training_resource(auth.uid(), occurrence_id, kind, title, url, body, client_key); $$;

revoke execute on function private.add_training_resource(uuid, uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function private.add_training_resource(uuid, uuid, text, text, text, text, uuid) to authenticated;
revoke execute on function public.add_training_resource(uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.add_training_resource(uuid, text, text, text, text, uuid) to authenticated;
