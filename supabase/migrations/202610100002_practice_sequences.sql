-- supabase/migrations/202610100002_practice_sequences.sql
create table public.practice_sequences (
  id uuid primary key default extensions.gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  source_text text not null,
  sequence jsonb,
  import_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint practice_sequences_title_check check (char_length(btrim(title)) between 1 and 120),
  constraint practice_sequences_text_check check (char_length(btrim(source_text)) between 1 and 4000),
  constraint practice_sequences_sequence_check check (sequence is null or jsonb_typeof(sequence) = 'array'),
  constraint practice_sequences_import_ref_check check (import_ref is null or char_length(import_ref) <= 200)
);
create unique index practice_sequences_import_ref_unique
  on public.practice_sequences (profile_id, import_ref) where import_ref is not null;
create index practice_sequences_profile_idx on public.practice_sequences (profile_id, updated_at desc);

create trigger practice_sequences_set_updated_at
before update on public.practice_sequences
for each row execute function private.set_updated_at();

alter table public.practice_sequences enable row level security;
create policy practice_sequences_select_own
on public.practice_sequences for select to authenticated
using (profile_id = auth.uid());
revoke all on table public.practice_sequences from public, anon, authenticated;
grant select on table public.practice_sequences to authenticated;

create function private.practice_sequence_title(new_title text, new_source_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(btrim(coalesce(new_title, '')), ''), left(btrim(new_source_text), 60));
$$;

create function private.save_practice_sequence(
  actor_id uuid, target_sequence_id uuid, new_title text, new_source_text text, new_sequence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare saved_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if char_length(btrim(coalesce(new_source_text, ''))) not between 1 and 4000 then
    raise exception using errcode = 'P0001', message = 'invalid_sequence_text';
  end if;
  if target_sequence_id is null then
    insert into public.practice_sequences (profile_id, title, source_text, sequence)
    values (
      actor_id, private.practice_sequence_title(new_title, new_source_text),
      btrim(new_source_text),
      case when jsonb_typeof(new_sequence) = 'array' then new_sequence end
    ) returning id into saved_id;
  else
    update public.practice_sequences
       set title = private.practice_sequence_title(new_title, new_source_text),
           source_text = btrim(new_source_text),
           sequence = case when jsonb_typeof(new_sequence) = 'array' then new_sequence end
     where id = target_sequence_id and profile_id = actor_id
     returning id into saved_id;
    if saved_id is null then
      raise exception using errcode = 'PT403', message = 'not_authorized';
    end if;
  end if;
  return jsonb_build_object('status', 'saved', 'sequence_id', saved_id);
end;
$$;

create function private.delete_practice_sequence(actor_id uuid, target_sequence_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.practice_sequences
   where id = target_sequence_id and profile_id = actor_id;
  if not found then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  return jsonb_build_object('status', 'deleted', 'sequence_id', target_sequence_id);
end;
$$;

create function private.import_practice_sequences(actor_id uuid, items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare inserted integer;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 100 then
    raise exception using errcode = 'P0001', message = 'invalid_import';
  end if;
  with candidates as (
    select distinct on (item ->> 'import_ref')
           item ->> 'import_ref' import_ref,
           private.practice_sequence_title(item ->> 'title', item ->> 'source_text') title,
           btrim(item ->> 'source_text') source_text,
           case when jsonb_typeof(item -> 'sequence') = 'array' then item -> 'sequence' end sequence
      from jsonb_array_elements(items) with ordinality as entries(item, position)
     where nullif(btrim(coalesce(item ->> 'import_ref', '')), '') is not null
       and char_length(btrim(coalesce(item ->> 'source_text', ''))) between 1 and 4000
     order by item ->> 'import_ref', position
  ), created as (
    insert into public.practice_sequences (profile_id, title, source_text, sequence, import_ref)
    select actor_id, title, source_text, sequence, import_ref from candidates
    on conflict (profile_id, import_ref) where import_ref is not null do nothing
    returning 1
  )
  select count(*)::integer into inserted from created;
  return jsonb_build_object('status', 'imported', 'imported', inserted);
end;
$$;

create function private.list_practice_sequences(actor_id uuid)
returns table (id uuid, title text, source_text text, sequence jsonb, updated_at timestamptz)
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
  select item.id, item.title, item.source_text, item.sequence, item.updated_at
    from public.practice_sequences item
   where item.profile_id = actor_id
   order by item.updated_at desc, item.id;
end;
$$;

create function public.save_practice_sequence(
  sequence_id uuid, title text, source_text text, sequence jsonb default null
)
returns jsonb language sql set search_path = ''
as $$ select private.save_practice_sequence(auth.uid(), sequence_id, title, source_text, sequence); $$;

create function public.delete_practice_sequence(sequence_id uuid)
returns jsonb language sql set search_path = ''
as $$ select private.delete_practice_sequence(auth.uid(), sequence_id); $$;

create function public.import_practice_sequences(items jsonb)
returns jsonb language sql set search_path = ''
as $$ select private.import_practice_sequences(auth.uid(), items); $$;

create function public.list_practice_sequences()
returns table (id uuid, title text, source_text text, sequence jsonb, updated_at timestamptz)
language sql stable set search_path = ''
as $$ select * from private.list_practice_sequences(auth.uid()); $$;

revoke execute on function private.practice_sequence_title(text, text) from public, anon, authenticated;
revoke execute on function private.save_practice_sequence(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function private.delete_practice_sequence(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.import_practice_sequences(uuid, jsonb) from public, anon, authenticated;
revoke execute on function private.list_practice_sequences(uuid) from public, anon, authenticated;
grant execute on function private.save_practice_sequence(uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function private.delete_practice_sequence(uuid, uuid) to authenticated;
grant execute on function private.import_practice_sequences(uuid, jsonb) to authenticated;
grant execute on function private.list_practice_sequences(uuid) to authenticated;
revoke execute on function public.save_practice_sequence(uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.delete_practice_sequence(uuid) from public, anon, authenticated;
revoke execute on function public.import_practice_sequences(jsonb) from public, anon, authenticated;
revoke execute on function public.list_practice_sequences() from public, anon, authenticated;
grant execute on function public.save_practice_sequence(uuid, text, text, jsonb) to authenticated;
grant execute on function public.delete_practice_sequence(uuid) to authenticated;
grant execute on function public.import_practice_sequences(jsonb) to authenticated;
grant execute on function public.list_practice_sequences() to authenticated;
