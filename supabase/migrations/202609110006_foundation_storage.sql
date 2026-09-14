insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values
  (
    'profile-pictures',
    'profile-pictures',
    false,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']::text[]
  ),
  (
    'group-pictures',
    'group-pictures',
    false,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']::text[]
  )
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create function private.can_manage_group_picture(
  object_name text,
  actor_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from public.groups g
     where actor_id is not null
       and g.owner_id = actor_id
       and g.archived_at is null
       and object_name ~ (
         '^' || g.id::text ||
         '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
       )
  ), false);
$$;

create function private.can_read_profile_picture(
  object_name text,
  actor_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    actor_id is not null
    and (
      object_name ~ (
        '^' || actor_id::text ||
        '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
      )
      or exists (
        select 1
          from public.profiles profile
         where profile.avatar_path = object_name
           and (
             private.is_direct_coach_of(actor_id, profile.id)
             or exists (
               select 1
                 from public.group_memberships membership
                 join public.groups child_group
                   on child_group.id = membership.group_id
                  and child_group.archived_at is null
                where membership.profile_id = profile.id
                  and membership.state = 'active'
                  and private.has_named_parent_progress(actor_id, child_group.id)
             )
           )
      )
    ),
    false
  );
$$;

create function private.can_read_group_picture(
  object_name text,
  actor_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.can_manage_group_picture(object_name, actor_id)
    or exists (
      select 1
        from public.groups g
       where g.picture_path = object_name
         and g.archived_at is null
         and (
           g.is_discoverable
           or private.is_active_group_member(g.id, actor_id)
           or private.has_named_parent_progress(actor_id, g.id)
         )
    ),
    false
  );
$$;

create policy profile_pictures_select_visible
on storage.objects
for select
to authenticated
using (
  bucket_id = 'profile-pictures'
  and private.can_read_profile_picture(name, auth.uid())
);

create policy profile_pictures_insert_owner
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-pictures'
  and auth.uid() is not null
  and name ~ (
    '^' || auth.uid()::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
  )
);

create policy profile_pictures_update_owner
on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-pictures'
  and auth.uid() is not null
  and name ~ (
    '^' || auth.uid()::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
  )
)
with check (
  bucket_id = 'profile-pictures'
  and auth.uid() is not null
  and name ~ (
    '^' || auth.uid()::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
  )
);

create policy profile_pictures_delete_owner
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-pictures'
  and auth.uid() is not null
  and name ~ (
    '^' || auth.uid()::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
  )
);

create policy group_pictures_select_visible
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'group-pictures'
  and private.can_read_group_picture(name, auth.uid())
);

create policy group_pictures_insert_owner
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'group-pictures'
  and private.can_manage_group_picture(name, auth.uid())
);

create policy group_pictures_update_owner
on storage.objects
for update
to authenticated
using (
  bucket_id = 'group-pictures'
  and private.can_manage_group_picture(name, auth.uid())
)
with check (
  bucket_id = 'group-pictures'
  and private.can_manage_group_picture(name, auth.uid())
);

create policy group_pictures_delete_owner
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'group-pictures'
  and private.can_manage_group_picture(name, auth.uid())
);

revoke execute on function private.can_manage_group_picture(text, uuid) from public, anon, authenticated;
revoke execute on function private.can_read_profile_picture(text, uuid) from public, anon, authenticated;
revoke execute on function private.can_read_group_picture(text, uuid) from public, anon, authenticated;

grant execute on function private.can_manage_group_picture(text, uuid) to authenticated;
grant execute on function private.can_read_profile_picture(text, uuid) to authenticated;
grant execute on function private.can_read_group_picture(text, uuid) to anon, authenticated;
