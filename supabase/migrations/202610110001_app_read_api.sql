-- supabase/migrations/202610110001_app_read_api.sql
create function private.can_view_occurrence(actor_id uuid, target_occurrence_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select actor_id is not null and exists (
    select 1 from public.training_occurrences occurrence
     where occurrence.id = target_occurrence_id
       and (
         occurrence.recorded_by = actor_id
         or (occurrence.group_id is not null and private.is_group_coach(occurrence.group_id, actor_id))
         or exists (
           select 1 from public.training_participations participation
            where participation.occurrence_id = occurrence.id
              and (participation.profile_id = actor_id
                or private.can_read_training(actor_id, participation.profile_id))
         )
       )
  );
$$;

create function private.list_recent_trainings(actor_id uuid, result_limit integer)
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
  select coalesce(jsonb_agg(entry order by entry ->> 'occurred_at' desc), '[]'::jsonb)
    into result
    from (
      select jsonb_build_object(
        'occurrence_id', occurrence.id,
        'kind', occurrence.kind::text,
        'local_date', occurrence.local_date,
        'occurred_at', occurrence.occurred_at,
        'duration_minutes', coalesce(mine.actual_duration_minutes, occurrence.default_duration_minutes),
        'group_name', target_group.name,
        'coach_name', coach.display_name,
        'attendee_count', (
          select count(*) from public.training_participations attendee
           where attendee.occurrence_id = occurrence.id
        ),
        'role', case when mine.id is not null then 'participant' else 'coach' end,
        'first_round_text', (
          select coalesce(round.source_text, (
            select string_agg(movement.movement_name_snapshot, ', ' order by movement.position)
              from public.training_occurrence_movements movement
             where movement.occurrence_round_id = round.id
          ))
            from public.training_occurrence_rounds round
           where round.occurrence_id = occurrence.id
           order by round.position
           limit 1
        ),
        'round_count', (
          select count(*) from public.training_occurrence_rounds round
           where round.occurrence_id = occurrence.id
        ),
        'felt', (
          select assessment.difficulty::text
            from public.training_segment_assessments assessment
            join public.training_occurrence_rounds round on round.id = assessment.occurrence_round_id
           where assessment.participation_id = mine.id and assessment.segment_key = 'r'
           order by round.position
           limit 1
        ),
        'has_rating', mine.id is not null and exists (
          select 1 from public.training_segment_assessments assessment
           where assessment.participation_id = mine.id
        ),
        'resource_kinds', coalesce((
          select jsonb_agg(distinct resource.kind order by resource.kind)
            from public.training_resources resource
           where resource.occurrence_id = occurrence.id
        ), '[]'::jsonb)
      ) entry
      from public.training_occurrences occurrence
      left join public.training_participations mine
        on mine.occurrence_id = occurrence.id and mine.profile_id = actor_id
      left join public.groups target_group on target_group.id = occurrence.group_id
      left join public.profiles coach on coach.id = occurrence.recorded_by
      where (mine.id is not null or occurrence.recorded_by = actor_id)
        and exists (
          select 1 from public.training_participations any_attendee
           where any_attendee.occurrence_id = occurrence.id
        )
      order by occurrence.occurred_at desc, occurrence.id
      limit least(greatest(coalesce(result_limit, 10), 1), 50)
    ) recent;
  return result;
end;
$$;

create function private.get_training(actor_id uuid, target_occurrence_id uuid)
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
  if not private.can_view_occurrence(actor_id, target_occurrence_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  select jsonb_build_object(
    'occurrence_id', occurrence.id,
    'kind', occurrence.kind::text,
    'local_date', occurrence.local_date,
    'timezone', occurrence.timezone,
    'occurred_at', occurrence.occurred_at,
    'duration_minutes', coalesce(mine.actual_duration_minutes, occurrence.default_duration_minutes),
    'group_id', occurrence.group_id,
    'group_name', target_group.name,
    'student_name', student.display_name,
    'coach_profile_id', occurrence.recorded_by,
    'coach_name', coach.display_name,
    'attendee_count', (
      select count(*) from public.training_participations attendee
       where attendee.occurrence_id = occurrence.id
    ),
    'role', case when mine.id is not null then 'participant' else 'coach' end,
    'participation', case when mine.id is null then null else jsonb_build_object(
      'id', mine.id, 'personal_notes', mine.personal_notes,
      'duration_minutes', mine.actual_duration_minutes
    ) end,
    'rounds', private.occurrence_rounds_json(actor_id, occurrence.id, mine.id),
    'feedback', case when mine.id is null then '[]'::jsonb
                     else private.feedback_json(actor_id, mine.id) end,
    'resources', private.resources_json(actor_id, occurrence.id),
    'can_add_resources', private.can_write_training_resources(actor_id, occurrence.id)
  ) into result
  from public.training_occurrences occurrence
  left join public.training_participations mine
    on mine.occurrence_id = occurrence.id and mine.profile_id = actor_id
  left join public.groups target_group on target_group.id = occurrence.group_id
  left join public.profiles coach on coach.id = occurrence.recorded_by
  left join public.profiles student on student.id = occurrence.student_profile_id
  where occurrence.id = target_occurrence_id;
  return result;
end;
$$;

create function public.list_recent_trainings(result_limit integer default 10)
returns jsonb language sql stable set search_path = ''
as $$ select private.list_recent_trainings(auth.uid(), result_limit); $$;

create function public.get_training(occurrence_id uuid)
returns jsonb language sql stable set search_path = ''
as $$ select private.get_training(auth.uid(), occurrence_id); $$;

revoke execute on function private.can_view_occurrence(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.list_recent_trainings(uuid, integer) from public, anon, authenticated;
revoke execute on function private.get_training(uuid, uuid) from public, anon, authenticated;
grant execute on function private.list_recent_trainings(uuid, integer) to authenticated;
grant execute on function private.get_training(uuid, uuid) to authenticated;
revoke execute on function public.list_recent_trainings(integer) from public, anon, authenticated;
revoke execute on function public.get_training(uuid) from public, anon, authenticated;
grant execute on function public.list_recent_trainings(integer) to authenticated;
grant execute on function public.get_training(uuid) to authenticated;
