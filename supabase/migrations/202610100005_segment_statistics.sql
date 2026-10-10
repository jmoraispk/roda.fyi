-- Movement trends now include move-segment ratings; adds hardest transitions.
create or replace function private.get_personal_training_statistics(
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
    union all
    select movement.movement_key,
           movement.movement_name_snapshot,
           occurrence.occurred_at,
           segment.id,
           case segment.difficulty
             when 'hard' then 1 when 'okay' then 2 else 3
           end,
           segment.difficulty::text
      from public.training_segment_assessments segment
      join activity on activity.participation_id = segment.participation_id
      join public.training_occurrence_rounds round
        on round.id = segment.occurrence_round_id
      join public.training_occurrence_movements movement
        on movement.occurrence_round_id = round.id
       and movement.segment_key = segment.segment_key
      join public.training_occurrences occurrence
        on occurrence.id = round.occurrence_id
     where segment.segment_kind = 'move'
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
  ), transition_counts as (
    select segment.from_movement_key, segment.to_movement_key,
           count(*) filter (where segment.difficulty = 'hard')::bigint hard_count,
           count(*)::bigint rating_count
      from public.training_segment_assessments segment
      join activity on activity.participation_id = segment.participation_id
     where segment.segment_kind in ('transition', 'loop')
       and segment.from_movement_key is not null
       and segment.to_movement_key is not null
     group by segment.from_movement_key, segment.to_movement_key
  ), movement_names as (
    select movement.movement_key, max(movement.movement_name_snapshot) movement_name
      from activity
      join public.training_occurrence_rounds round on round.occurrence_id = activity.occurrence_id
      join public.training_occurrence_movements movement on movement.occurrence_round_id = round.id
     group by movement.movement_key
  ), hardest_transitions as (
    select coalesce(jsonb_agg(item order by (item ->> 'hard_count')::bigint desc,
                                         (item ->> 'rating_count')::bigint desc,
                                         item ->> 'from_movement_key', item ->> 'to_movement_key'), '[]'::jsonb) value
      from (
        select jsonb_build_object(
          'from_movement_key', counts.from_movement_key,
          'to_movement_key', counts.to_movement_key,
          'from_name', coalesce(from_name.movement_name, counts.from_movement_key),
          'to_name', coalesce(to_name.movement_name, counts.to_movement_key),
          'hard_count', counts.hard_count,
          'rating_count', counts.rating_count
        ) item
          from transition_counts counts
          left join movement_names from_name on from_name.movement_key = counts.from_movement_key
          left join movement_names to_name on to_name.movement_key = counts.to_movement_key
         where counts.hard_count > 0
         order by counts.hard_count desc, counts.rating_count desc,
                  counts.from_movement_key, counts.to_movement_key
         limit 5
      ) ranked
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
    'difficulty_trends', difficulty_trends.value,
    'hardest_transitions', hardest_transitions.value
  ) into result
  from totals cross join streak cross join favorite_movements cross join difficulty_trends
    cross join hardest_transitions;

  return result;
end;
$$;
