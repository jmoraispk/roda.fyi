create policy profiles_select_self
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy coach_profiles_select_self
on public.coach_profiles
for select
to authenticated
using (profile_id = auth.uid());

create policy groups_select_connected
on public.groups
for select
to authenticated
using (
  archived_at is null
  and (
    private.is_active_group_member(id, auth.uid())
    or exists (
      select 1
        from public.group_join_requests request
       where request.group_id = groups.id
         and request.profile_id = auth.uid()
         and request.state = 'pending'
         and request.expires_at > now()
    )
  )
);

create policy group_memberships_select_self
on public.group_memberships
for select
to authenticated
using (
  profile_id = auth.uid()
  and private.is_active_group_member(group_id, auth.uid())
);

create policy group_join_requests_select_self
on public.group_join_requests
for select
to authenticated
using (profile_id = auth.uid());

grant select on table
  public.profiles,
  public.coach_profiles,
  public.groups,
  public.group_memberships,
  public.group_join_requests
to authenticated;

revoke all on table
  public.group_member_invitations,
  public.group_discovery_links,
  public.group_relationships
from anon, authenticated;

grant usage on schema private to anon, authenticated;

grant execute on function private.search_groups(text, integer, integer) to anon, authenticated;
grant execute on function private.resolve_group_discovery_token(text) to anon, authenticated;
grant execute on function public.search_groups(text, integer, integer) to anon, authenticated;
grant execute on function public.resolve_group_discovery_token(text) to anon, authenticated;

grant execute on function private.is_active_group_member(uuid, uuid) to authenticated;
grant execute on function private.is_group_coach(uuid, uuid) to authenticated;
grant execute on function private.is_group_owner(uuid, uuid) to authenticated;
grant execute on function private.is_direct_coach_of(uuid, uuid) to authenticated;
grant execute on function private.is_group_ancestor(uuid, uuid) to authenticated;
grant execute on function private.can_roll_up_anonymous_aggregate(uuid, uuid) to authenticated;
grant execute on function private.has_named_parent_progress(uuid, uuid) to authenticated;
grant execute on function private.has_full_parent_coaching(uuid, uuid) to authenticated;

grant execute on function private.list_group_roster(uuid, uuid) to authenticated;
grant execute on function private.list_my_member_invitations(uuid) to authenticated;
grant execute on function private.list_group_join_requests(uuid, uuid) to authenticated;
grant execute on function private.list_group_member_invitations(uuid, uuid) to authenticated;
grant execute on function private.list_group_relationships(uuid, uuid) to authenticated;

grant execute on function private.complete_my_profile(uuid, text, text, boolean) to authenticated;
grant execute on function private.set_my_profile_picture(uuid, text) to authenticated;
grant execute on function private.register_as_coach(uuid) to authenticated;
grant execute on function private.create_group(uuid, text, text, text, boolean) to authenticated;
grant execute on function private.update_group(uuid, uuid, text, text, text, boolean) to authenticated;
grant execute on function private.set_group_picture(uuid, uuid, text) to authenticated;
grant execute on function private.transfer_group_ownership(uuid, uuid, uuid) to authenticated;
grant execute on function private.archive_group(uuid, uuid) to authenticated;
grant execute on function private.leave_group(uuid, uuid) to authenticated;
grant execute on function private.remove_group_member(uuid, uuid, uuid) to authenticated;
grant execute on function private.request_group_access(uuid, uuid, public.group_access_level, text) to authenticated;
grant execute on function private.cancel_group_join_request(uuid, uuid) to authenticated;
grant execute on function private.decide_group_join_request(uuid, uuid, text) to authenticated;
grant execute on function private.create_member_invitation(uuid, uuid, text) to authenticated;
grant execute on function private.accept_member_invitation(uuid, text) to authenticated;
grant execute on function private.revoke_member_invitation(uuid, uuid) to authenticated;
grant execute on function private.rotate_group_discovery_link(uuid, uuid) to authenticated;
grant execute on function private.revoke_group_discovery_link(uuid, uuid) to authenticated;
grant execute on function private.invite_child_group(uuid, uuid, uuid) to authenticated;
grant execute on function private.decide_group_relationship(uuid, uuid, text) to authenticated;
grant execute on function private.set_group_relationship_sharing(uuid, uuid, public.group_relationship_sharing) to authenticated;
grant execute on function private.revoke_group_relationship(uuid, uuid) to authenticated;

grant execute on function public.list_group_roster(uuid) to authenticated;
grant execute on function public.list_my_member_invitations() to authenticated;
grant execute on function public.list_group_join_requests(uuid) to authenticated;
grant execute on function public.list_group_member_invitations(uuid) to authenticated;
grant execute on function public.list_group_relationships(uuid) to authenticated;

grant execute on function public.complete_my_profile(text, text, boolean) to authenticated;
grant execute on function public.set_my_profile_picture(text) to authenticated;
grant execute on function public.register_as_coach() to authenticated;
grant execute on function public.create_group(text, text, text, boolean) to authenticated;
grant execute on function public.update_group(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.set_group_picture(uuid, text) to authenticated;
grant execute on function public.transfer_group_ownership(uuid, uuid) to authenticated;
grant execute on function public.archive_group(uuid) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.request_group_access(uuid, public.group_access_level, text) to authenticated;
grant execute on function public.cancel_group_join_request(uuid) to authenticated;
grant execute on function public.decide_group_join_request(uuid, text) to authenticated;
grant execute on function public.create_member_invitation(uuid, text) to authenticated;
grant execute on function public.accept_member_invitation(text) to authenticated;
grant execute on function public.revoke_member_invitation(uuid) to authenticated;
grant execute on function public.rotate_group_discovery_link(uuid) to authenticated;
grant execute on function public.revoke_group_discovery_link(uuid) to authenticated;
grant execute on function public.invite_child_group(uuid, uuid) to authenticated;
grant execute on function public.decide_group_relationship(uuid, text) to authenticated;
grant execute on function public.set_group_relationship_sharing(uuid, public.group_relationship_sharing) to authenticated;
grant execute on function public.revoke_group_relationship(uuid) to authenticated;

revoke execute on all functions in schema private from public;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated;
