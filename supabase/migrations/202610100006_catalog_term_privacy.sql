-- Curators see uncatalogued terms, not sentence fragments from private notes.
create or replace function private.list_uncatalogued_terms(actor_id uuid)
returns table (
  term text, spelling text, people bigint, uses bigint,
  first_seen timestamptz, last_seen timestamptz, needs_video boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_catalog_curator(actor_id);
  return query
  with uses as (
    select movement.movement_key term, movement.movement_name_snapshot spelling,
           participation.profile_id person, movement.created_at seen
      from public.training_occurrence_movements movement
      join public.training_occurrence_rounds round on round.id = movement.occurrence_round_id
      join public.training_participations participation
        on participation.occurrence_id = round.occurrence_id
     where not movement.catalogued
    union all
    select movement.movement_key, movement.movement_name_snapshot,
           plan.creator_profile_id, movement.created_at
      from public.workout_plan_movements movement
      join public.workout_plan_rounds round on round.id = movement.plan_round_id
      join public.workout_plan_versions version on version.id = round.plan_version_id
      join public.workout_plans plan on plan.id = version.plan_id
     where not movement.catalogued
  )
  select uses.term,
         mode() within group (order by uses.spelling),
         count(distinct uses.person)::bigint,
         count(*)::bigint,
         min(uses.seen), max(uses.seen),
         coalesce(bool_or(mapping.needs_video), false)
    from uses
    left join public.catalog_term_mappings mapping on mapping.term = uses.term
   where mapping.action is null
     -- Only word-like terms: long fragments are sentences from private notes.
     and char_length(uses.term) <= 40
     and array_length(string_to_array(uses.term, '-'), 1) <= 4
   group by uses.term
   order by count(distinct uses.person) desc, count(*) desc, uses.term;
end;
$$;
