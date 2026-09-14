create function private.complete_my_profile(
  actor_id uuid,
  new_display_name text,
  new_timezone_override text,
  new_leaderboard_visible boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := btrim(coalesce(new_display_name, ''));
  normalized_timezone text := nullif(btrim(new_timezone_override), '');
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if char_length(normalized_name) not between 1 and 80 then
    raise exception using errcode = 'P0001', message = 'invalid_display_name';
  end if;
  if normalized_timezone is not null and char_length(normalized_timezone) > 64 then
    raise exception using errcode = 'P0001', message = 'invalid_timezone';
  end if;

  update public.profiles
     set display_name = normalized_name,
         timezone_override = normalized_timezone,
         leaderboard_visible = coalesce(new_leaderboard_visible, true),
         completed_at = coalesce(completed_at, now())
   where id = actor_id;

  if not found then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;

  return jsonb_build_object('status', 'updated', 'profile_id', actor_id);
end;
$$;

create function private.set_my_profile_picture(
  actor_id uuid,
  new_avatar_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_path text := btrim(coalesce(new_avatar_path, ''));
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if normalized_path !~ (
    '^' || actor_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_picture_path';
  end if;

  update public.profiles
     set avatar_path = normalized_path
   where id = actor_id;
  if not found then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;

  return jsonb_build_object('status', 'updated', 'profile_id', actor_id);
end;
$$;

create function private.register_as_coach(actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted boolean := false;
begin
  if actor_id is null or not exists (
    select 1 from public.profiles profile where profile.id = actor_id
  ) then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;

  insert into public.coach_profiles (profile_id)
  values (actor_id)
  on conflict (profile_id) do nothing;
  inserted := found;

  return jsonb_build_object(
    'status', case when inserted then 'created' else 'active' end,
    'profile_id', actor_id
  );
end;
$$;

create function private.create_group(
  actor_id uuid,
  new_name text,
  new_description text,
  new_location text,
  new_is_discoverable boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_group public.groups;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if not exists (
    select 1 from public.coach_profiles coach where coach.profile_id = actor_id
  ) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;

  insert into public.groups (
    owner_id, name, description, location, is_discoverable
  )
  values (
    actor_id,
    new_name,
    new_description,
    new_location,
    coalesce(new_is_discoverable, true)
  )
  returning * into created_group;

  insert into public.group_memberships (
    group_id, profile_id, access_level, state
  )
  values (created_group.id, actor_id, 'coach', 'active');

  return jsonb_build_object(
    'status', 'created',
    'group_id', created_group.id,
    'slug', created_group.slug
  );
end;
$$;

create function private.update_group(
  actor_id uuid,
  target_group_id uuid,
  new_name text,
  new_description text,
  new_location text,
  new_is_discoverable boolean
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
  if not private.is_group_owner(target_group_id, actor_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;

  update public.groups
     set name = new_name,
         description = new_description,
         location = new_location,
         is_discoverable = coalesce(new_is_discoverable, true)
   where id = target_group_id
     and archived_at is null;

  return jsonb_build_object('status', 'updated', 'group_id', target_group_id);
end;
$$;

create function private.set_group_picture(
  actor_id uuid,
  target_group_id uuid,
  new_picture_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_path text := btrim(coalesce(new_picture_path, ''));
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if not private.is_group_owner(target_group_id, actor_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  if normalized_path !~ (
    '^' || target_group_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_picture_path';
  end if;

  update public.groups
     set picture_path = normalized_path
   where id = target_group_id
     and archived_at is null;

  return jsonb_build_object('status', 'updated', 'group_id', target_group_id);
end;
$$;

create function private.transfer_group_ownership(
  actor_id uuid,
  target_group_id uuid,
  new_owner_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_owner_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;

  select g.owner_id
    into previous_owner_id
    from public.groups g
   where g.id = target_group_id
     and g.archived_at is null
   for update;

  if previous_owner_id is null or previous_owner_id <> actor_id then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  if new_owner_id is null or new_owner_id = previous_owner_id then
    return jsonb_build_object(
      'status', 'already_owner',
      'group_id', target_group_id,
      'profile_id', previous_owner_id
    );
  end if;
  if not exists (
    select 1 from public.profiles profile where profile.id = new_owner_id
  ) then
    raise exception using errcode = 'P0001', message = 'profile_not_found';
  end if;

  insert into public.coach_profiles (profile_id)
  values (new_owner_id)
  on conflict (profile_id) do nothing;

  insert into public.group_memberships (
    group_id, profile_id, access_level, state, joined_at, ended_at, ended_by
  )
  values (target_group_id, new_owner_id, 'coach', 'active', now(), null, null)
  on conflict (group_id, profile_id) do update
    set access_level = 'coach',
        state = 'active',
        joined_at = case
          when public.group_memberships.state = 'active'
            then public.group_memberships.joined_at
          else now()
        end,
        ended_at = null,
        ended_by = null;

  update public.groups
     set owner_id = new_owner_id
   where id = target_group_id;

  insert into private.group_ownership_audit (
    group_id, previous_owner_id, new_owner_id, changed_by
  )
  values (target_group_id, previous_owner_id, new_owner_id, actor_id);

  return jsonb_build_object(
    'status', 'transferred',
    'group_id', target_group_id,
    'profile_id', new_owner_id
  );
end;
$$;

create function private.archive_group(actor_id uuid, target_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_archive timestamptz;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;

  select g.archived_at
    into existing_archive
    from public.groups g
   where g.id = target_group_id
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'group_not_found';
  end if;
  if existing_archive is not null then
    return jsonb_build_object('status', 'archived', 'group_id', target_group_id);
  end if;
  if not private.is_group_owner(target_group_id, actor_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;

  update public.groups
     set archived_at = now(),
         archived_by = actor_id
   where id = target_group_id;

  return jsonb_build_object('status', 'archived', 'group_id', target_group_id);
end;
$$;

create function private.leave_group(actor_id uuid, target_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership public.group_memberships;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if exists (
    select 1
      from public.groups g
     where g.id = target_group_id
       and g.owner_id = actor_id
       and g.archived_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'owner_must_transfer';
  end if;

  select *
    into membership
    from public.group_memberships gm
   where gm.group_id = target_group_id
     and gm.profile_id = actor_id
   for update;

  if not found or membership.state <> 'active' then
    return jsonb_build_object('status', 'already_left', 'group_id', target_group_id);
  end if;

  update public.group_memberships
     set state = 'left',
         ended_at = now(),
         ended_by = actor_id
   where id = membership.id;

  return jsonb_build_object('status', 'left', 'group_id', target_group_id);
end;
$$;

create function private.remove_group_member(
  actor_id uuid,
  target_group_id uuid,
  target_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership public.group_memberships;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if not private.is_group_coach(target_group_id, actor_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  if exists (
    select 1 from public.groups g
     where g.id = target_group_id and g.owner_id = target_profile_id
  ) then
    raise exception using errcode = 'P0001', message = 'owner_must_transfer';
  end if;

  select *
    into membership
    from public.group_memberships gm
   where gm.group_id = target_group_id
     and gm.profile_id = target_profile_id
   for update;

  if not found or membership.state <> 'active' then
    return jsonb_build_object(
      'status', 'already_removed',
      'group_id', target_group_id,
      'profile_id', target_profile_id
    );
  end if;
  if membership.access_level = 'coach'
     and not private.is_group_owner(target_group_id, actor_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;

  update public.group_memberships
     set state = 'removed',
         ended_at = now(),
         ended_by = actor_id
   where id = membership.id;

  return jsonb_build_object(
    'status', 'removed',
    'group_id', target_group_id,
    'profile_id', target_profile_id
  );
end;
$$;

create function private.request_group_access(
  actor_id uuid,
  target_group_id uuid,
  target_access public.group_access_level,
  discovery_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  group_is_discoverable boolean;
  active_membership public.group_memberships;
  request_row public.group_join_requests;
begin
  if actor_id is null or not exists (
    select 1 from public.profiles profile where profile.id = actor_id
  ) then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if target_access = 'coach' and not exists (
    select 1 from public.coach_profiles coach where coach.profile_id = actor_id
  ) then
    raise exception using errcode = 'P0001', message = 'coach_registration_required';
  end if;

  select g.is_discoverable
    into group_is_discoverable
    from public.groups g
   where g.id = target_group_id
     and g.archived_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'group_not_found';
  end if;

  if not group_is_discoverable and not exists (
    select 1
      from public.group_discovery_links link
     where link.group_id = target_group_id
       and link.state = 'active'
       and link.token_hash = extensions.digest(
         convert_to(coalesce(discovery_token, ''), 'UTF8'),
         'sha256'
       )
  ) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;

  select *
    into active_membership
    from public.group_memberships membership
   where membership.group_id = target_group_id
     and membership.profile_id = actor_id
     and membership.state = 'active';
  if found and (
    active_membership.access_level = 'coach'
    or target_access = 'member'
  ) then
    return jsonb_build_object(
      'status', 'already_active',
      'membership_id', active_membership.id,
      'group_id', target_group_id
    );
  end if;

  select *
    into request_row
    from public.group_join_requests request
   where request.group_id = target_group_id
     and request.profile_id = actor_id
     and request.requested_access = target_access
     and request.state = 'pending'
   for update;
  if found then
    if request_row.expires_at <= now() then
      update public.group_join_requests
         set state = 'expired'
       where id = request_row.id;
    else
      return jsonb_build_object(
        'status', 'pending',
        'request_id', request_row.id,
        'group_id', target_group_id
      );
    end if;
  end if;

  select *
    into request_row
    from public.group_join_requests request
   where request.group_id = target_group_id
     and request.profile_id = actor_id
     and request.requested_access = target_access
     and request.state in ('declined', 'cancelled', 'expired')
   order by request.created_at desc, request.id desc
   limit 1
   for update;

  if found then
    update public.group_join_requests
       set state = 'pending',
           expires_at = now() + interval '30 days',
           decided_at = null,
           decided_by = null
     where id = request_row.id
     returning * into request_row;
  else
    insert into public.group_join_requests (
      group_id, profile_id, requested_access
    )
    values (target_group_id, actor_id, target_access)
    returning * into request_row;
  end if;

  return jsonb_build_object(
    'status', 'pending',
    'request_id', request_row.id,
    'group_id', target_group_id
  );
end;
$$;

create function private.cancel_group_join_request(
  actor_id uuid,
  target_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.group_join_requests;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;

  select *
    into request_row
    from public.group_join_requests request
   where request.id = target_request_id
   for update;
  if not found or request_row.profile_id <> actor_id then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  if request_row.state = 'cancelled' then
    return jsonb_build_object('status', 'cancelled', 'request_id', target_request_id);
  end if;
  if request_row.state <> 'pending' then
    return jsonb_build_object('status', request_row.state, 'request_id', target_request_id);
  end if;
  if request_row.expires_at <= now() then
    update public.group_join_requests set state = 'expired' where id = target_request_id;
    return jsonb_build_object('status', 'expired', 'request_id', target_request_id);
  end if;

  update public.group_join_requests
     set state = 'cancelled',
         decided_at = now(),
         decided_by = actor_id
   where id = target_request_id;
  return jsonb_build_object('status', 'cancelled', 'request_id', target_request_id);
end;
$$;

create function private.decide_group_join_request(
  actor_id uuid,
  target_request_id uuid,
  decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.group_join_requests;
  membership_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if decision not in ('approved', 'declined') then
    raise exception using errcode = 'P0001', message = 'invalid_decision';
  end if;

  select *
    into request_row
    from public.group_join_requests request
   where request.id = target_request_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'request_not_found';
  end if;

  if request_row.requested_access = 'coach' then
    if not private.is_group_owner(request_row.group_id, actor_id) then
      raise exception using errcode = 'PT403', message = 'not_authorized';
    end if;
  elsif not private.is_group_coach(request_row.group_id, actor_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;

  if request_row.state = 'approved' then
    select membership.id into membership_id
      from public.group_memberships membership
     where membership.group_id = request_row.group_id
       and membership.profile_id = request_row.profile_id;
    return jsonb_build_object(
      'status', 'already_approved',
      'request_id', target_request_id,
      'membership_id', membership_id
    );
  end if;
  if request_row.state = 'declined' then
    return jsonb_build_object('status', 'already_declined', 'request_id', target_request_id);
  end if;
  if request_row.state <> 'pending' then
    return jsonb_build_object('status', request_row.state, 'request_id', target_request_id);
  end if;
  if request_row.expires_at <= now() then
    update public.group_join_requests set state = 'expired' where id = target_request_id;
    return jsonb_build_object('status', 'expired', 'request_id', target_request_id);
  end if;

  if decision = 'declined' then
    update public.group_join_requests
       set state = 'declined',
           decided_at = now(),
           decided_by = actor_id
     where id = target_request_id;
    return jsonb_build_object('status', 'declined', 'request_id', target_request_id);
  end if;

  insert into public.group_memberships (
    group_id, profile_id, access_level, state, joined_at, ended_at, ended_by
  )
  values (
    request_row.group_id,
    request_row.profile_id,
    request_row.requested_access,
    'active',
    now(),
    null,
    null
  )
  on conflict (group_id, profile_id) do update
    set access_level = case
          when public.group_memberships.access_level = 'coach' then 'coach'::public.group_access_level
          else excluded.access_level
        end,
        state = 'active',
        joined_at = case
          when public.group_memberships.state = 'active'
            then public.group_memberships.joined_at
          else now()
        end,
        ended_at = null,
        ended_by = null
  returning id into membership_id;

  update public.group_join_requests
     set state = 'approved',
         decided_at = now(),
         decided_by = actor_id
   where id = target_request_id;

  return jsonb_build_object(
    'status', 'approved',
    'request_id', target_request_id,
    'membership_id', membership_id
  );
end;
$$;

create function private.new_url_token()
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select rtrim(
    translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'),
    '='
  );
$$;

create function private.create_member_invitation(
  actor_id uuid,
  target_group_id uuid,
  target_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_token text := private.new_url_token();
  normalized_email text := nullif(lower(btrim(target_email)), '');
  invitation_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if not private.is_group_coach(target_group_id, actor_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  if normalized_email is not null and (
    char_length(normalized_email) > 320 or position('@' in normalized_email) <= 1
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_email';
  end if;

  insert into public.group_member_invitations (
    group_id, email, token_hash, invited_by
  )
  values (
    target_group_id,
    normalized_email,
    extensions.digest(convert_to(raw_token, 'UTF8'), 'sha256'),
    actor_id
  )
  returning id into invitation_id;

  return jsonb_build_object(
    'status', 'created',
    'invitation_id', invitation_id,
    'group_id', target_group_id,
    'token', raw_token
  );
end;
$$;

create function private.accept_member_invitation(
  actor_id uuid,
  raw_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.group_member_invitations;
  actor_email text;
  membership_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;

  select invite.*
    into invitation
    from public.group_member_invitations invite
   where invite.token_hash = extensions.digest(
     convert_to(coalesce(raw_token, ''), 'UTF8'),
     'sha256'
   )
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'invitation_not_found';
  end if;
  if invitation.state = 'accepted' then
    if invitation.accepted_by = actor_id then
      return jsonb_build_object(
        'status', 'already_accepted',
        'invitation_id', invitation.id,
        'group_id', invitation.group_id
      );
    end if;
    raise exception using errcode = 'P0001', message = 'already_used';
  end if;
  if invitation.state = 'revoked' then
    raise exception using errcode = 'P0001', message = 'invitation_revoked';
  end if;
  if invitation.state = 'expired' or invitation.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'invitation_expired';
  end if;

  select lower(btrim(account.email))
    into actor_email
    from auth.users account
   where account.id = actor_id;
  if actor_email is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if invitation.email is not null and invitation.email <> actor_email then
    raise exception using errcode = 'P0001', message = 'invitation_email_mismatch';
  end if;

  insert into public.group_memberships (
    group_id, profile_id, access_level, state, joined_at, ended_at, ended_by
  )
  values (invitation.group_id, actor_id, 'member', 'active', now(), null, null)
  on conflict (group_id, profile_id) do update
    set access_level = case
          when public.group_memberships.access_level = 'coach' then 'coach'::public.group_access_level
          else 'member'::public.group_access_level
        end,
        state = 'active',
        joined_at = case
          when public.group_memberships.state = 'active'
            then public.group_memberships.joined_at
          else now()
        end,
        ended_at = null,
        ended_by = null
  returning id into membership_id;

  update public.group_member_invitations
     set state = 'accepted',
         accepted_at = now(),
         accepted_by = actor_id
   where id = invitation.id;

  return jsonb_build_object(
    'status', 'accepted',
    'invitation_id', invitation.id,
    'group_id', invitation.group_id,
    'membership_id', membership_id
  );
end;
$$;

create function private.revoke_member_invitation(
  actor_id uuid,
  target_invitation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.group_member_invitations;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  select *
    into invitation
    from public.group_member_invitations invite
   where invite.id = target_invitation_id
   for update;
  if not found or not private.is_group_coach(invitation.group_id, actor_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  if invitation.state = 'revoked' then
    return jsonb_build_object('status', 'revoked', 'invitation_id', invitation.id);
  end if;
  if invitation.state <> 'pending' then
    return jsonb_build_object('status', invitation.state, 'invitation_id', invitation.id);
  end if;

  update public.group_member_invitations
     set state = 'revoked',
         revoked_at = now(),
         revoked_by = actor_id
   where id = invitation.id;
  return jsonb_build_object('status', 'revoked', 'invitation_id', invitation.id);
end;
$$;

create function private.rotate_group_discovery_link(
  actor_id uuid,
  target_group_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_token text := private.new_url_token();
  link_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if not private.is_group_coach(target_group_id, actor_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;

  update public.group_discovery_links
     set state = 'revoked',
         revoked_at = now(),
         revoked_by = actor_id
   where group_id = target_group_id
     and state = 'active';

  insert into public.group_discovery_links (
    group_id, token_hash, created_by
  )
  values (
    target_group_id,
    extensions.digest(convert_to(raw_token, 'UTF8'), 'sha256'),
    actor_id
  )
  returning id into link_id;

  return jsonb_build_object(
    'status', 'created',
    'link_id', link_id,
    'group_id', target_group_id,
    'token', raw_token
  );
end;
$$;

create function private.revoke_group_discovery_link(
  actor_id uuid,
  target_group_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  revoked_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if not private.is_group_coach(target_group_id, actor_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;

  update public.group_discovery_links
     set state = 'revoked',
         revoked_at = now(),
         revoked_by = actor_id
   where group_id = target_group_id
     and state = 'active'
  returning id into revoked_id;

  return jsonb_build_object(
    'status', case when revoked_id is null then 'already_revoked' else 'revoked' end,
    'group_id', target_group_id,
    'link_id', revoked_id
  );
end;
$$;

create function private.list_group_join_requests(
  target_group_id uuid,
  actor_id uuid default auth.uid()
)
returns table (
  id uuid,
  group_id uuid,
  profile_id uuid,
  display_name text,
  picture_path text,
  requested_access public.group_access_level,
  state public.group_join_request_state,
  expires_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    request.id,
    request.group_id,
    request.profile_id,
    profile.display_name,
    profile.avatar_path,
    request.requested_access,
    request.state,
    request.expires_at,
    request.decided_at,
    request.created_at
  from public.group_join_requests request
  join public.profiles profile on profile.id = request.profile_id
  where request.group_id = target_group_id
    and (
      private.is_group_owner(target_group_id, actor_id)
      or (
        request.requested_access = 'member'
        and private.is_group_coach(target_group_id, actor_id)
      )
    )
  order by request.created_at desc, request.id;
$$;

create function private.list_group_member_invitations(
  target_group_id uuid,
  actor_id uuid default auth.uid()
)
returns table (
  id uuid,
  group_id uuid,
  email text,
  state public.group_member_invitation_state,
  invited_by uuid,
  expires_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at timestamptz,
  revoked_by uuid,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    invitation.id,
    invitation.group_id,
    invitation.email,
    invitation.state,
    invitation.invited_by,
    invitation.expires_at,
    invitation.accepted_at,
    invitation.accepted_by,
    invitation.revoked_at,
    invitation.revoked_by,
    invitation.created_at
  from public.group_member_invitations invitation
  where invitation.group_id = target_group_id
    and private.is_group_coach(target_group_id, actor_id)
  order by invitation.created_at desc, invitation.id;
$$;

create function public.complete_my_profile(
  display_name text,
  timezone_override text,
  leaderboard_visible boolean
)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.complete_my_profile(auth.uid(), $1, $2, $3); $$;

create function public.set_my_profile_picture(avatar_path text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.set_my_profile_picture(auth.uid(), $1); $$;

create function public.register_as_coach()
returns jsonb language sql security invoker set search_path = ''
as $$ select private.register_as_coach(auth.uid()); $$;

create function public.create_group(
  name text,
  description text,
  location text,
  is_discoverable boolean
)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.create_group(auth.uid(), $1, $2, $3, $4); $$;

create function public.update_group(
  group_id uuid,
  name text,
  description text,
  location text,
  is_discoverable boolean
)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.update_group(auth.uid(), $1, $2, $3, $4, $5); $$;

create function public.set_group_picture(group_id uuid, picture_path text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.set_group_picture(auth.uid(), $1, $2); $$;

create function public.transfer_group_ownership(group_id uuid, new_owner_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.transfer_group_ownership(auth.uid(), $1, $2); $$;

create function public.archive_group(group_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.archive_group(auth.uid(), $1); $$;

create function public.leave_group(group_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.leave_group(auth.uid(), $1); $$;

create function public.remove_group_member(group_id uuid, profile_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.remove_group_member(auth.uid(), $1, $2); $$;

create function public.request_group_access(
  group_id uuid,
  requested_access public.group_access_level,
  discovery_token text default null
)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.request_group_access(auth.uid(), $1, $2, $3); $$;

create function public.cancel_group_join_request(request_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.cancel_group_join_request(auth.uid(), $1); $$;

create function public.decide_group_join_request(request_id uuid, decision text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.decide_group_join_request(auth.uid(), $1, $2); $$;

create function public.create_member_invitation(group_id uuid, email text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.create_member_invitation(auth.uid(), $1, $2); $$;

create function public.accept_member_invitation(token text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.accept_member_invitation(auth.uid(), $1); $$;

create function public.revoke_member_invitation(invitation_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.revoke_member_invitation(auth.uid(), $1); $$;

create function public.rotate_group_discovery_link(group_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.rotate_group_discovery_link(auth.uid(), $1); $$;

create function public.revoke_group_discovery_link(group_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.revoke_group_discovery_link(auth.uid(), $1); $$;

create function public.list_group_join_requests(group_id uuid)
returns table (
  id uuid,
  group_id uuid,
  profile_id uuid,
  display_name text,
  picture_path text,
  requested_access public.group_access_level,
  state public.group_join_request_state,
  expires_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$ select * from private.list_group_join_requests($1, auth.uid()); $$;

create function public.list_group_member_invitations(group_id uuid)
returns table (
  id uuid,
  group_id uuid,
  email text,
  state public.group_member_invitation_state,
  invited_by uuid,
  expires_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at timestamptz,
  revoked_by uuid,
  created_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$ select * from private.list_group_member_invitations($1, auth.uid()); $$;

revoke execute on all functions in schema private from public, anon, authenticated;

revoke execute on function public.complete_my_profile(text, text, boolean) from public, anon, authenticated;
revoke execute on function public.set_my_profile_picture(text) from public, anon, authenticated;
revoke execute on function public.register_as_coach() from public, anon, authenticated;
revoke execute on function public.create_group(text, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.update_group(uuid, text, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.set_group_picture(uuid, text) from public, anon, authenticated;
revoke execute on function public.transfer_group_ownership(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.archive_group(uuid) from public, anon, authenticated;
revoke execute on function public.leave_group(uuid) from public, anon, authenticated;
revoke execute on function public.remove_group_member(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.request_group_access(uuid, public.group_access_level, text) from public, anon, authenticated;
revoke execute on function public.cancel_group_join_request(uuid) from public, anon, authenticated;
revoke execute on function public.decide_group_join_request(uuid, text) from public, anon, authenticated;
revoke execute on function public.create_member_invitation(uuid, text) from public, anon, authenticated;
revoke execute on function public.accept_member_invitation(text) from public, anon, authenticated;
revoke execute on function public.revoke_member_invitation(uuid) from public, anon, authenticated;
revoke execute on function public.rotate_group_discovery_link(uuid) from public, anon, authenticated;
revoke execute on function public.revoke_group_discovery_link(uuid) from public, anon, authenticated;
revoke execute on function public.list_group_join_requests(uuid) from public, anon, authenticated;
revoke execute on function public.list_group_member_invitations(uuid) from public, anon, authenticated;
