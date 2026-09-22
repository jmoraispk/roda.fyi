create function private.can_read_named_group_statistics(
  actor_id uuid,
  target_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select actor_id is not null and (
    exists (
      select 1
        from public.group_memberships membership
        join public.groups target_group on target_group.id = membership.group_id
       where membership.group_id = target_group_id
         and membership.profile_id = actor_id
         and membership.state = 'active'
         and target_group.archived_at is null
    )
    or private.has_named_parent_progress(actor_id, target_group_id)
  );
$$;

create function private.can_read_group_statistics(
  actor_id uuid,
  target_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_read_named_group_statistics(actor_id, target_group_id)
      or exists (
        select 1
          from public.group_memberships membership
         where membership.profile_id = actor_id
           and membership.access_level = 'coach'
           and membership.state = 'active'
           and private.can_roll_up_anonymous_aggregate(
             target_group_id, membership.group_id
           )
      );
$$;

create function private.get_personal_training_statistics(
  actor_id uuid,
  range_start date,
  range_end_exclusive date,
  target_timezone text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if range_start is null or range_end_exclusive is null or range_start >= range_end_exclusive then
    raise exception using errcode = 'P0001', message = 'invalid_date_range';
  end if;
  if not private.is_valid_timezone(target_timezone) then
    raise exception using errcode = 'P0001', message = 'invalid_timezone';
  end if;

  with activity as (
    select participation.id participation_id,
           participation.actual_duration_minutes duration_minutes,
           occurrence.id occurrence_id, occurrence.kind::text kind,
           occurrence.local_date, occurrence.occurred_at
      from public.training_participations participation
      join public.training_occurrences occurrence
        on occurrence.id = participation.occurrence_id
     where participation.profile_id = actor_id
       and occurrence.local_date >= range_start
       and occurrence.local_date < range_end_exclusive
  ), totals as (
    select count(*)::bigint session_count,
           coalesce(sum(duration_minutes), 0)::bigint total_minutes
      from activity
  ), practiced_dates as (
    select distinct local_date from activity
  ), streak_islands as (
    select local_date,
           local_date - row_number() over (order by local_date)::integer island
      from practiced_dates
  ), streak as (
    select coalesce(max(day_count), 0)::bigint current_streak
      from (
        select island, count(*)::bigint day_count, max(local_date) last_date
          from streak_islands
         group by island
      ) islands
     where last_date = (select max(local_date) from practiced_dates)
  ), contexts as (
    select kind, count(*)::bigint session_count,
           sum(duration_minutes)::bigint total_minutes
      from activity
     group by kind
  ), movement_counts as (
    select movement.movement_key,
           max(movement.movement_name_snapshot) movement_name,
           count(distinct activity.occurrence_id)::bigint session_count
      from activity
      join public.training_occurrence_rounds round
        on round.occurrence_id = activity.occurrence_id
      join public.training_occurrence_movements movement
        on movement.occurrence_round_id = round.id
     group by movement.movement_key
  ), favorite_movements as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'movement_key', movement_key,
      'movement_name', movement_name,
      'session_count', session_count
    ) order by session_count desc, movement_name, movement_key) filter (
      where session_count = (select max(session_count) from movement_counts)
    ), '[]'::jsonb) value
      from movement_counts
  ), scored_assessments as (
    select movement.movement_key,
           movement.movement_name_snapshot movement_name,
           occurrence.occurred_at,
           assessment.id,
           case assessment.difficulty
             when 'hard' then 1 when 'okay' then 2 else 3
           end score,
           assessment.difficulty::text difficulty
      from public.training_movement_assessments assessment
      join activity on activity.participation_id = assessment.participation_id
      join public.training_occurrence_movements movement
        on movement.id = assessment.occurrence_movement_id
      join public.training_occurrence_rounds round
        on round.id = movement.occurrence_round_id
      join public.training_occurrences occurrence
        on occurrence.id = round.occurrence_id
  ), trends as (
    select movement_key, max(movement_name) movement_name,
           count(*)::bigint assessment_count,
           count(*) filter (where difficulty = 'easy')::bigint easy_count,
           count(*) filter (where difficulty = 'okay')::bigint okay_count,
           count(*) filter (where difficulty = 'hard')::bigint hard_count,
           (array_agg(score order by occurred_at, id))[1] first_score,
           (array_agg(score order by occurred_at desc, id desc))[1] last_score
      from scored_assessments
     group by movement_key
  ), difficulty_trends as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'movement_key', movement_key,
      'movement_name', movement_name,
      'assessment_count', assessment_count,
      'easy_count', easy_count,
      'okay_count', okay_count,
      'hard_count', hard_count,
      'first_score', first_score,
      'last_score', last_score,
      'improving', assessment_count > 1 and last_score > first_score
    ) order by assessment_count desc, movement_name, movement_key), '[]'::jsonb) value
      from trends
  )
  select jsonb_build_object(
    'range_start', range_start,
    'range_end_exclusive', range_end_exclusive,
    'timezone', target_timezone,
    'session_count', totals.session_count,
    'total_minutes', totals.total_minutes,
    'current_streak', streak.current_streak,
    'average_trainings_per_week', round(
      totals.session_count::numeric
        / greatest(1::numeric, (range_end_exclusive - range_start)::numeric / 7), 2
    ),
    'average_hours_per_month', round(
      (totals.total_minutes::numeric / 60)
        / greatest(1::numeric, (range_end_exclusive - range_start)::numeric / 30.4375), 2
    ),
    'context_distribution', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', kind, 'session_count', session_count, 'total_minutes', total_minutes
      ) order by kind) from contexts
    ), '[]'::jsonb),
    'favorite_movements', favorite_movements.value,
    'difficulty_trends', difficulty_trends.value
  ) into result
  from totals cross join streak cross join favorite_movements cross join difficulty_trends;

  return result;
end;
$$;

create function public.get_personal_training_statistics(
  range_start date,
  range_end_exclusive date,
  timezone text
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select private.get_personal_training_statistics(
    auth.uid(), range_start, range_end_exclusive, timezone
  );
$$;

create function private.get_group_training_leaderboard(
  actor_id uuid,
  target_group_id uuid,
  range_start date,
  range_end_exclusive date,
  selected_metric text
)
returns table (
  profile_id uuid,
  display_name text,
  avatar_path text,
  rank_position bigint,
  total_minutes bigint,
  session_count bigint,
  selected_value bigint,
  anonymous_member_count bigint,
  anonymous_minutes bigint,
  anonymous_sessions bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare group_timezone text;
declare show_names boolean;
declare range_start_instant timestamptz;
declare range_end_instant timestamptz;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if range_start is null or range_end_exclusive is null or range_start >= range_end_exclusive then
    raise exception using errcode = 'P0001', message = 'invalid_date_range';
  end if;
  if selected_metric not in ('time', 'sessions') then
    raise exception using errcode = 'P0001', message = 'invalid_metric';
  end if;
  select target.timezone into group_timezone
    from public.groups target
   where target.id = target_group_id and target.archived_at is null;
  if group_timezone is null or not private.can_read_group_statistics(actor_id, target_group_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  show_names := private.can_read_named_group_statistics(actor_id, target_group_id);
  range_start_instant := range_start::timestamp at time zone group_timezone;
  range_end_instant := range_end_exclusive::timestamp at time zone group_timezone;

  return query
  with eligible_memberships as (
    select membership.profile_id, membership.joined_at, membership.ended_at
      from public.group_memberships membership
     where membership.group_id = target_group_id
       and membership.access_level = 'member'
       and membership.joined_at < range_end_instant
       and (membership.ended_at is null or membership.ended_at > range_start_instant)
  ), member_totals as (
    select membership.profile_id,
           coalesce(sum(participation.actual_duration_minutes)
             filter (where occurrence.id is not null), 0)::bigint total_minutes,
           count(participation.id) filter (where occurrence.id is not null)::bigint session_count
      from eligible_memberships membership
      left join public.training_participations participation
        on participation.profile_id = membership.profile_id
      left join public.training_occurrences occurrence
        on occurrence.id = participation.occurrence_id
       and occurrence.occurred_at >= range_start_instant
       and occurrence.occurred_at < range_end_instant
       and occurrence.occurred_at >= membership.joined_at
       and (membership.ended_at is null or occurrence.occurred_at < membership.ended_at)
     group by membership.profile_id
  ), projected as (
    select totals.profile_id, profile.display_name, profile.avatar_path,
           totals.total_minutes, totals.session_count,
           case selected_metric when 'time' then totals.total_minutes
                else totals.session_count end selected_value,
           show_names and profile.leaderboard_visible visible
      from member_totals totals
      join public.profiles profile on profile.id = totals.profile_id
  ), anonymous as (
    select count(*) filter (where not projected.visible)::bigint anonymous_member_count,
           coalesce(sum(projected.total_minutes) filter (where not projected.visible), 0)::bigint anonymous_minutes,
           coalesce(sum(projected.session_count) filter (where not projected.visible), 0)::bigint anonymous_sessions
      from projected projected
  ), named as (
    select projected.*,
           dense_rank() over (order by projected.selected_value desc)::bigint rank_position
      from projected projected
     where projected.visible
  ), result_rows as (
    select named.profile_id, named.display_name, named.avatar_path,
           named.rank_position, named.total_minutes, named.session_count,
           named.selected_value, anonymous.anonymous_member_count,
           anonymous.anonymous_minutes, anonymous.anonymous_sessions
      from named cross join anonymous
    union all
    select null::uuid, null::text, null::text, null::bigint,
           0::bigint, 0::bigint, null::bigint,
           anonymous.anonymous_member_count, anonymous.anonymous_minutes,
           anonymous.anonymous_sessions
      from anonymous
     where not exists (select 1 from named)
  )
  select result_rows.profile_id, result_rows.display_name, result_rows.avatar_path,
         result_rows.rank_position, result_rows.total_minutes, result_rows.session_count,
         result_rows.selected_value, result_rows.anonymous_member_count,
         result_rows.anonymous_minutes, result_rows.anonymous_sessions
    from result_rows result_rows
   order by result_rows.rank_position nulls last,
            result_rows.display_name nulls last,
            result_rows.profile_id nulls last;
end;
$$;

create function public.get_group_training_leaderboard(
  group_id uuid,
  range_start date,
  range_end_exclusive date,
  metric text
)
returns table (
  profile_id uuid,
  display_name text,
  avatar_path text,
  rank_position bigint,
  total_minutes bigint,
  session_count bigint,
  selected_value bigint,
  anonymous_member_count bigint,
  anonymous_minutes bigint,
  anonymous_sessions bigint
)
language sql
stable
set search_path = ''
as $$
  select * from private.get_group_training_leaderboard(
    auth.uid(), group_id, range_start, range_end_exclusive, metric
  );
$$;

create function private.list_shared_group_members(
  actor_id uuid,
  target_group_id uuid,
  search_text text,
  result_limit integer,
  result_offset integer
)
returns table (
  profile_id uuid,
  display_name text,
  avatar_path text,
  graduation text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if not private.can_read_named_group_statistics(actor_id, target_group_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  if result_limit is null or result_limit < 1 or result_limit > 100
     or result_offset is null or result_offset < 0 then
    raise exception using errcode = 'P0001', message = 'invalid_pagination';
  end if;

  return query
  select profile.id, profile.display_name, profile.avatar_path, null::text
    from public.group_memberships membership
    join public.profiles profile on profile.id = membership.profile_id
   where membership.group_id = target_group_id
     and membership.access_level = 'member'
     and membership.state = 'active'
     and (
       nullif(btrim(coalesce(search_text, '')), '') is null
       or lower(profile.display_name) like '%' || lower(btrim(search_text)) || '%'
     )
   order by profile.display_name, profile.id
   limit result_limit offset result_offset;
end;
$$;

create function public.list_shared_group_members(
  group_id uuid,
  search_text text default '',
  result_limit integer default 20,
  result_offset integer default 0
)
returns table (
  profile_id uuid,
  display_name text,
  avatar_path text,
  graduation text
)
language sql
stable
set search_path = ''
as $$
  select * from private.list_shared_group_members(
    auth.uid(), group_id, search_text, result_limit, result_offset
  );
$$;

revoke execute on function private.can_read_named_group_statistics(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.can_read_group_statistics(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.get_personal_training_statistics(uuid, date, date, text) from public, anon, authenticated;
revoke execute on function private.get_group_training_leaderboard(uuid, uuid, date, date, text) from public, anon, authenticated;
revoke execute on function private.list_shared_group_members(uuid, uuid, text, integer, integer) from public, anon, authenticated;

revoke execute on function public.get_personal_training_statistics(date, date, text) from public, anon, authenticated;
revoke execute on function public.get_group_training_leaderboard(uuid, date, date, text) from public, anon, authenticated;
revoke execute on function public.list_shared_group_members(uuid, text, integer, integer) from public, anon, authenticated;

grant execute on function private.can_read_named_group_statistics(uuid, uuid) to authenticated;
grant execute on function private.can_read_group_statistics(uuid, uuid) to authenticated;
grant execute on function private.get_personal_training_statistics(uuid, date, date, text) to authenticated;
grant execute on function private.get_group_training_leaderboard(uuid, uuid, date, date, text) to authenticated;
grant execute on function private.list_shared_group_members(uuid, uuid, text, integer, integer) to authenticated;

grant execute on function public.get_personal_training_statistics(date, date, text) to authenticated;
grant execute on function public.get_group_training_leaderboard(uuid, date, date, text) to authenticated;
grant execute on function public.list_shared_group_members(uuid, text, integer, integer) to authenticated;
