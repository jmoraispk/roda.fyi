# Mobile App Plan 1: Shell, Reading Screens, and Logging

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the new mobile-first app at `/app` with the shell (router, tab bar, sidebar, sheets, installable web app), Today, Calendar, the training page, and Log training — spec increments 1–3.

**Architecture:** A new `app.html` + `src/app/entries/app.js` entry renders a layout (bottom tab bar on phones, sidebar on desktop) and swaps screen modules on hash-route changes. Screens reuse existing services and components (round editor, round detail, move picker, resource view). Two new read RPCs (`list_recent_trainings`, `get_training`) feed Today and the training page. `/dashboard` is untouched.

**Tech Stack:** Vanilla ES modules + esbuild, Vitest + jsdom, Playwright, Supabase Postgres + pgTAP.

**Spec:** `docs/superpowers/specs/2026-10-11-mobile-first-app-design.md` (mockups in `docs/superpowers/specs/2026-10-11-mobile-first-app-mockups/`).

This is plan 1 of 4: plan 2 covers increments 4–5 (Teaching, Me subpages, onboarding, Train · Both · Teach), plan 3 increment 6 (Discover v1), plan 4 increment 7 (switch-over).

## Global Constraints

- Do not modify `tools/`, `assets/figure3d.js`, `assets/moves3d/`, `index.html`, or `/dashboard` behavior.
- Every new table/function follows the existing pattern: `private.*` security definer with `set search_path = ''`, called by `public` `language sql` wrappers passing `auth.uid()`; revoke from public/anon/authenticated, grant to authenticated.
- New migrations: `supabase/migrations/2026101100NN_*.sql`; never edit applied migrations. Apply locally with `npx supabase migration up --local`, never `supabase db reset` (the local database is shared with the main checkout).
- English copy in American spelling; every new `en` key in `src/app/dashboard-i18n.js` has a `pt` key.
- Hash routes under `/app` exactly as listed in the spec's Routes table.
- Phone first at 390 px; desktop layout from 900 px.
- No new runtime dependencies in this plan.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Deep link to a training the person may not read** (`#/training/<someone-else's id>`) — shows "This training isn't available" with a way back, never a blank page or crash. Pinned in Task 8.
2. **Double-tapping Save or reloading mid-save in Log training** — exactly one training is recorded (the draft keeps one idempotency key). Pinned in Task 9.
3. **Opening `/app` signed out or with an expired session** — goes to sign-in and returns to the same `/app#…` route afterwards. Pinned in Task 4.
4. **Very long round text on Today cards** — clipped to one line of at most 120 characters, never stretching the card. Pinned in Task 6.
5. **A resource that fails to save after Log training succeeds** — the training is kept, and the resource waits in the training page's "waiting to sync" queue instead of vanishing. Pinned in Task 9.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `supabase/migrations/202610110001_app_read_api.sql` | `list_recent_trainings`, `get_training` |
| `supabase/tests/0016_app_read_api.test.sql` | DB tests for both |
| `src/app/shell/router.js` | `parseRoute`, `tabFor`, `createRouter` |
| `src/app/shell/sheet.js` | `openSheet` bottom sheet |
| `src/app/shell/layout.js` | App frame: nav (tab bar / sidebar), main and detail panes |
| `src/app/shell/page.js` | `pageHeader`, `el` DOM helper, `initials` |
| `src/app/create-services.js` | Real or local services for the app entry |
| `src/app/entries/app.js` | Startup, auth gate, route → screen rendering, SW registration |
| `src/app/screens/today-state.js` | `weekDays`, `nowNextCard`, `clipText` |
| `src/app/screens/today.js` | Today screen |
| `src/app/screens/calendar.js` | Calendar screen + day sheet |
| `src/app/screens/youtube.js` | `youtubeId`, `youtubeEmbedUrl` |
| `src/app/screens/training.js` | Training page |
| `src/app/screens/log-draft.js` | Draft load/save/clear |
| `src/app/screens/chat-box.js` | Chat-style round input |
| `src/app/screens/log.js` | Log training composer |
| `src/app/screens/me.js` | Me and Settings |
| `src/app/screens/placeholder.js` | Screens arriving in later plans |
| `src/app/sw/cache-policy.js` | Pure SW caching decisions |
| `src/app/sw/service-worker.js` | Service worker |
| `scripts/build-icons.mjs` | Renders `favicon.svg` to PNG icons (run once, outputs committed) |
| `app.html`, `assets/app.css`, `manifest.webmanifest`, `assets/icons/*.png` | Page, styles, manifest, icons |

Modified: `scripts/build.mjs`, `.gitignore`, `src/app/training-service.js`, `src/app/testing/fake-services.js`, `src/app/dashboard-i18n.js`, `README.md`.

---

### Task 1: Read API for Today and the training page

**Files:**
- Create: `supabase/migrations/202610110001_app_read_api.sql`, `supabase/tests/0016_app_read_api.test.sql`
- Modify: `src/app/training-service.js`, `src/app/testing/fake-services.js`
- Test: `tests/unit/training-service.test.js`

**Interfaces:**
- Produces (SQL): `public.list_recent_trainings(result_limit integer default 10) → jsonb` array, newest first, of `{ occurrence_id, kind, local_date, occurred_at, duration_minutes, group_name, coach_name, attendee_count, role ('participant'|'coach'), first_round_text, round_count, felt, has_rating, resource_kinds text[] }`; limit clamped to 1–50.
- Produces (SQL): `public.get_training(occurrence_id uuid) → jsonb` `{ occurrence_id, kind, local_date, timezone, occurred_at, duration_minutes, group_id, group_name, student_name, coach_profile_id, coach_name, attendee_count, role, participation: { id, personal_notes, duration_minutes } | null, rounds, feedback, resources, can_add_resources }`; raises `PT403 not_authorized` unless the caller recorded it, coaches its group, attended it, or can read an attendee's training.
- Produces (JS, real and fake training service): `listRecentTrainings(limit = 10)`, `getTraining(occurrenceId)`. Fake `listCalendar` rows gain `coach_profile_id` (schedule `arranged_by` / occurrence `recorded_by`) and `group_name`.

- [ ] **Step 1: Write the failing DB test**

```sql
-- supabase/tests/0016_app_read_api.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_function('public', 'list_recent_trainings', array['integer']);
select has_function('public', 'get_training', array['uuid']);

select tests.create_user('10000000-0000-0000-0000-000000001601', 'coach16@example.test', 'Mestre Dezasseis');
select tests.create_user('10000000-0000-0000-0000-000000001602', 'ana16@example.test', 'Ana Dezasseis');
select tests.create_user('10000000-0000-0000-0000-000000001603', 'bia16@example.test', 'Bia Dezasseis');
select tests.create_user('10000000-0000-0000-0000-000000001604', 'out16@example.test', 'Caio Dezasseis');
insert into public.coach_profiles (profile_id) values ('10000000-0000-0000-0000-000000001601');
insert into public.groups (id, owner_id, name, timezone)
values ('20000000-0000-0000-0000-000000001601', '10000000-0000-0000-0000-000000001601', 'Grupo Dezasseis', 'Europe/Lisbon');
insert into public.group_memberships (group_id, profile_id, access_level) values
  ('20000000-0000-0000-0000-000000001601', '10000000-0000-0000-0000-000000001601', 'coach'),
  ('20000000-0000-0000-0000-000000001601', '10000000-0000-0000-0000-000000001602', 'member'),
  ('20000000-0000-0000-0000-000000001601', '10000000-0000-0000-0000-000000001603', 'member');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001601');
select public.record_past_class('group', '20000000-0000-0000-0000-000000001601', null, null,
  '2026-09-26T13:19:30Z', '2026-09-26', 'Europe/Lisbon', 56,
  '[{"profile_id":"10000000-0000-0000-0000-000000001602","duration_minutes":56}]'::jsonb,
  '[{"source_text":"ginga 10 min, 10x (armada, au)","movements":[{"movement_key":"ginga","movement_name":"Ginga","segment_key":"m:1"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000001601') ->> 'occurrence_id' as class_id \gset
select public.add_training_resource(:'class_id', 'video', 'Recording', 'https://youtu.be/VAI3JUKTwz0', null);
select is((public.list_recent_trainings(10) -> 0 ->> 'role'), 'coach', 'the coach sees the class they taught');
select is((public.get_training(:'class_id') ->> 'attendee_count')::integer, 1, 'the coach sees the attendee count');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001602');
select public.record_alone_training('2026-09-27', 'Europe/Lisbon', 45, 'Knees ok',
  ('[{"source_text":"' || repeat('armada, ', 30) || 'au","movements":[{"movement_key":"armada","movement_name":"Armada","segment_key":"m:1"}],
     "ratings":[{"segment_key":"r","segment_kind":"round","difficulty":"okay"}]}]')::jsonb,
  '50000000-0000-0000-0000-000000001602', '2026-09-27T08:00:00Z') ->> 'occurrence_id' as alone_id \gset
select is(jsonb_array_length(public.list_recent_trainings(10)), 2, 'the attendee sees the class and their own training');
select is(public.list_recent_trainings(10) -> 0 ->> 'occurrence_id', :'alone_id', 'newest first');
select is(public.list_recent_trainings(10) -> 0 ->> 'felt', 'okay', 'round rating appears as felt');
select is(public.list_recent_trainings(10) -> 1 -> 'resource_kinds', '["video"]'::jsonb, 'resource kinds are listed');
select is(public.list_recent_trainings(10) -> 1 ->> 'first_round_text', 'ginga 10 min, 10x (armada, au)', 'first round text is returned');
select is(jsonb_array_length(public.list_recent_trainings(1)), 1, 'the limit is applied');
select is(public.get_training(:'class_id') ->> 'role', 'participant', 'an attendee views as participant');
select is(public.get_training(:'class_id') -> 'participation' ->> 'duration_minutes', '56', 'participation duration is returned');
select is(jsonb_array_length(public.get_training(:'class_id') -> 'resources'), 1, 'resources are returned');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001603');
select throws_ok(format($$select public.get_training(%L)$$, :'class_id'), 'PT403', 'not_authorized',
  'a group member who did not attend cannot open the class');
select is(jsonb_array_length(public.list_recent_trainings(10)), 0, 'no unrelated trainings are listed');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001604');
select throws_ok(format($$select public.get_training(%L)$$, :'alone_id'), 'PT403', 'not_authorized',
  'outsiders cannot open a training');

reset role;
select tests.set_actor(null, 'anon');
select throws_ok($$select public.list_recent_trainings(10)$$, '42501', null, 'anonymous callers are refused');

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx supabase test db supabase/tests/0016_app_read_api.test.sql`
Expected: FAIL — `has_function` fails.

- [ ] **Step 3: Write the migration**

```sql
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
```

- [ ] **Step 4: Apply and run DB tests**

Run: `npx supabase migration up --local && npm run test:db`
Expected: PASS, including `0016_app_read_api.test.sql`.

- [ ] **Step 5: Write failing service tests**

Add to `tests/unit/training-service.test.js`:

```js
  it('reads recent trainings and one training by id', async () => {
    const { client, calls } = harness();
    const service = createTrainingService(client);
    await service.listRecentTrainings();
    await service.listRecentTrainings(3);
    await service.getTraining('o-1');
    expect(calls).toEqual([
      ['list_recent_trainings', { result_limit: 10 }],
      ['list_recent_trainings', { result_limit: 3 }],
      ['get_training', { occurrence_id: 'o-1' }],
    ]);
  });

  it('serves recent trainings and training pages from the local fake', async () => {
    const values = new Map([['roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1' } })]]);
    const window = { localStorage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) } };
    const service = createE2ETrainingService({ window });
    const older = await service.recordAloneTraining({
      localDate: '2026-10-01', timezone: 'UTC', durationMinutes: 30, idempotencyKey: 'a',
      occurredAt: '2026-10-01T08:00:00Z',
      rounds: [{ source_text: 'ginga 10 min', sequence: [], movements: [], ratings: [] }],
    });
    const newer = await service.recordAloneTraining({
      localDate: '2026-10-02', timezone: 'UTC', durationMinutes: 45, idempotencyKey: 'b',
      occurredAt: '2026-10-02T08:00:00Z',
      rounds: [{ source_text: '10x (armada, au)', sequence: [], movements: [],
        ratings: [{ segment_key: 'r', segment_kind: 'round', difficulty: 'hard' }] }],
    });
    await service.addResource({ occurrenceId: newer.occurrence_id, kind: 'video', url: 'https://youtu.be/x' });
    const recent = await service.listRecentTrainings(10);
    expect(recent.map(({ occurrence_id: id }) => id)).toEqual([newer.occurrence_id, older.occurrence_id]);
    expect(recent[0]).toMatchObject({
      kind: 'alone', role: 'participant', duration_minutes: 45, attendee_count: 1,
      first_round_text: '10x (armada, au)', felt: 'hard', has_rating: true, resource_kinds: ['video'],
    });
    const page = await service.getTraining(newer.occurrence_id);
    expect(page).toMatchObject({
      occurrence_id: newer.occurrence_id, role: 'participant', duration_minutes: 45,
      participation: { id: newer.participation_id }, can_add_resources: true,
    });
    expect(page.rounds[0].source_text).toBe('10x (armada, au)');
    await expect(service.getTraining('missing')).rejects.toMatchObject({ kind: 'authorization' });
  });
```

- [ ] **Step 6: Run to verify they fail**

Run: `npx vitest run tests/unit/training-service.test.js`
Expected: FAIL — `listRecentTrainings is not a function`.

- [ ] **Step 7: Implement in `src/app/training-service.js`**

Inside the returned object, before `listCalendar`:

```js
    async listRecentTrainings(limit = 10) {
      return call('list_recent_trainings', { result_limit: limit });
    },
    async getTraining(occurrenceId) {
      return call('get_training', { occurrence_id: occurrenceId });
    },
```

- [ ] **Step 8: Implement in the fake training service**

In `createE2ETrainingService`, extract the per-round mapping currently inside `getDay` into a local helper and reuse it:

```js
  function dayRounds(state, occurrence, participation) {
    const schedule = state.schedules.find(({ id }) => id === occurrence.schedule_id);
    const plan = state.plans.find(({ version_id: versionId }) => versionId === schedule?.plan_version_id);
    return structuredClone(occurrence.rounds ?? []).map((round, roundIndex) => {
      const roundId = round.id ?? `${occurrence.id}-round-${roundIndex + 1}`;
      return {
        ...round,
        id: roundId,
        source_text: round.source_text ?? null,
        sequence: round.sequence ?? null,
        ratings: participation ? state.roundRatings?.[participation.id]?.[roundId] ?? [] : [],
        planned: structuredClone(plan?.rounds?.[roundIndex]?.ratings ?? []),
        movements: (round.movements ?? []).map((movement, movementIndex) => {
          const movementId = movement.id
            ?? `${occurrence.id}-movement-${roundIndex + 1}-${movementIndex + 1}`;
          const assessment = participation && state.assessments.find((entry) => (
            entry.participation_id === participation.id && entry.movement_id === movementId
          ));
          return { ...movement, id: movementId, assessment: assessment ?? null };
        }),
      };
    });
  }

  function groupName(groupId) {
    const groups = JSON.parse(storage.getItem('roda.e2e.groupState') ?? '{}').groups ?? [];
    return groups.find(({ id }) => id === groupId)?.name ?? null;
  }

  function coachName(profileId) {
    const profile = JSON.parse(storage.getItem('roda.e2e.profile') ?? '{}');
    return profile.id === profileId ? profile.display_name ?? null : 'Coach';
  }
```

Replace the `const rounds = …` block in `getDay` with `const rounds = dayRounds(state, occurrence, participation);`. Add `coach_profile_id: occurrence.recorded_by, group_name: groupName(occurrence.group_id)` to each completed row and `coach_profile_id: schedule.arranged_by, group_name: groupName(schedule.group_id)` to each scheduled row in `listCalendar`. Add the methods:

```js
    async listRecentTrainings(limit = 10) {
      const state = readState();
      guard(state, 'listRecentTrainings', { read: true });
      const me = actorId();
      return state.occurrences
        .map((occurrence) => {
          const attendees = state.participations.filter(({ occurrence_id: id }) => id === occurrence.id);
          const mine = attendees.find(({ profile_id: id }) => id === me);
          if (!attendees.length || (!mine && occurrence.recorded_by !== me)) return null;
          const rounds = dayRounds(state, occurrence, mine);
          const first = rounds[0];
          return {
            occurrence_id: occurrence.id, kind: occurrence.kind, local_date: occurrence.local_date,
            occurred_at: occurrence.occurred_at,
            duration_minutes: mine?.actual_duration_minutes ?? occurrence.default_duration_minutes,
            group_name: groupName(occurrence.group_id), coach_name: coachName(occurrence.recorded_by),
            attendee_count: attendees.length, role: mine ? 'participant' : 'coach',
            first_round_text: first
              ? first.source_text ?? (first.movements ?? []).map((movement) => movement.movement_name).join(', ')
              : null,
            round_count: rounds.length,
            felt: rounds.flatMap(({ ratings }) => ratings).find(({ segment_key: key }) => key === 'r')?.difficulty ?? null,
            has_rating: rounds.some(({ ratings }) => ratings.length > 0),
            resource_kinds: [...new Set(state.resources
              .filter(({ occurrence_id: id }) => id === occurrence.id).map(({ kind }) => kind))].sort(),
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
        .slice(0, Math.min(Math.max(limit, 1), 50));
    },

    async getTraining(occurrenceId) {
      const state = readState();
      guard(state, 'getTraining', { read: true });
      const me = actorId();
      const occurrence = state.occurrences.find(({ id }) => id === occurrenceId);
      const attendees = state.participations.filter(({ occurrence_id: id }) => id === occurrenceId);
      const mine = attendees.find(({ profile_id: id }) => id === me);
      if (!occurrence || (!mine && occurrence.recorded_by !== me)) {
        throw new AppError('authorization', 'not_authorized');
      }
      return {
        occurrence_id: occurrence.id, kind: occurrence.kind, local_date: occurrence.local_date,
        timezone: occurrence.timezone, occurred_at: occurrence.occurred_at,
        duration_minutes: mine?.actual_duration_minutes ?? occurrence.default_duration_minutes,
        group_id: occurrence.group_id, group_name: groupName(occurrence.group_id),
        student_name: null, coach_profile_id: occurrence.recorded_by,
        coach_name: coachName(occurrence.recorded_by), attendee_count: attendees.length,
        role: mine ? 'participant' : 'coach',
        participation: mine ? {
          id: mine.id, personal_notes: mine.personal_notes ?? null,
          duration_minutes: mine.actual_duration_minutes,
        } : null,
        rounds: dayRounds(state, occurrence, mine),
        feedback: mine ? state.feedback.filter(({ participation_id: id }) => id === mine.id) : [],
        resources: state.resources
          .filter(({ occurrence_id: id }) => id === occurrence.id)
          .map((resource) => ({ ...resource, can_edit: resource.added_by === me })),
        can_add_resources: occurrence.recorded_by === me,
      };
    },
```

- [ ] **Step 9: Run tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/202610110001_app_read_api.sql supabase/tests/0016_app_read_api.test.sql src/app/training-service.js src/app/testing/fake-services.js tests/unit/training-service.test.js
git commit -m "feat: add recent-trainings and training-page read API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Router

**Files:**
- Create: `src/app/shell/router.js`
- Test: `tests/unit/router.test.js`

**Interfaces:**
- Produces: `parseRoute(hash) → { name, path, params, redirected? }` with names `today, calendar (params.month, params.day), log, training (id), class (id), discover, person (id), group (id), me, me-section (section), teaching-plan (id), teaching-student (id), welcome`; unknown → `today` with `redirected: true`. `tabFor(route) → 'today'|'calendar'|'discover'|'me'|null`. `isDetail(route) → boolean` (training, class, log, person, group, teaching-plan, teaching-student, me-section). `createRouter({ window, onRoute }) → { start(), navigate(path), back(fallbackPath), stop() }`.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/router.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createRouter, isDetail, parseRoute, tabFor } from '../../src/app/shell/router.js';

describe('router', () => {
  it.each([
    ['', 'today', {}],
    ['#/', 'today', {}],
    ['#/calendar', 'calendar', { month: null, day: null }],
    ['#/calendar/2026-10', 'calendar', { month: '2026-10', day: null }],
    ['#/calendar/2026-10-09', 'calendar', { month: '2026-10', day: '09' }],
    ['#/log', 'log', {}],
    ['#/training/abc-123', 'training', { id: 'abc-123' }],
    ['#/class/s1', 'class', { id: 's1' }],
    ['#/discover', 'discover', {}],
    ['#/person/p1', 'person', { id: 'p1' }],
    ['#/group/g1', 'group', { id: 'g1' }],
    ['#/me', 'me', {}],
    ['#/me/settings', 'me-section', { section: 'settings' }],
    ['#/me/teaching/plans/x', 'teaching-plan', { id: 'x' }],
    ['#/me/teaching/students/y', 'teaching-student', { id: 'y' }],
    ['#/welcome', 'welcome', {}],
    ['#/training/abc?from=today', 'training', { id: 'abc' }],
  ])('parses %s', (hash, name, params) => {
    expect(parseRoute(hash)).toMatchObject({ name, params });
  });

  it('sends unknown routes to Today', () => {
    expect(parseRoute('#/nope/../x')).toMatchObject({ name: 'today', redirected: true });
    expect(parseRoute('#/training/')).toMatchObject({ name: 'today', redirected: true });
  });

  it('maps routes to tabs and detail pages', () => {
    expect(tabFor(parseRoute('#/'))).toBe('today');
    expect(tabFor(parseRoute('#/person/p'))).toBe('discover');
    expect(tabFor(parseRoute('#/me/settings'))).toBe('me');
    expect(tabFor(parseRoute('#/training/t'))).toBeNull();
    expect(isDetail(parseRoute('#/training/t'))).toBe(true);
    expect(isDetail(parseRoute('#/calendar'))).toBe(false);
  });

  it('notifies on start and hash changes and rewrites unknown hashes', async () => {
    window.location.hash = '#/nope';
    const onRoute = vi.fn();
    const router = createRouter({ window, onRoute });
    router.start();
    expect(onRoute).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'today' }));
    expect(window.location.hash).toBe('#/');
    router.navigate('/calendar');
    await vi.waitFor(() => expect(onRoute).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'calendar' })));
    router.navigate('/calendar');
    expect(onRoute).toHaveBeenCalledTimes(3);
    router.stop();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/router.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// src/app/shell/router.js
const ID = '([A-Za-z0-9-]+)';
const ROUTES = [
  ['today', /^\/?$/, []],
  ['calendar', /^\/calendar(?:\/(\d{4}-\d{2})(?:-(\d{2}))?)?$/, ['month', 'day']],
  ['log', /^\/log$/, []],
  ['training', new RegExp(`^/training/${ID}$`), ['id']],
  ['class', new RegExp(`^/class/${ID}$`), ['id']],
  ['discover', /^\/discover$/, []],
  ['person', new RegExp(`^/person/${ID}$`), ['id']],
  ['group', new RegExp(`^/group/${ID}$`), ['id']],
  ['me', /^\/me$/, []],
  ['me-section', /^\/me\/(progress|repertoire|groups|catalog|settings|teaching)$/, ['section']],
  ['teaching-plan', new RegExp(`^/me/teaching/plans/${ID}$`), ['id']],
  ['teaching-student', new RegExp(`^/me/teaching/students/${ID}$`), ['id']],
  ['welcome', /^\/welcome$/, []],
];

const TABS = {
  today: 'today', calendar: 'calendar', discover: 'discover', person: 'discover', group: 'discover',
  me: 'me', 'me-section': 'me', 'teaching-plan': 'me', 'teaching-student': 'me', welcome: 'me',
};
const DETAIL = new Set([
  'training', 'class', 'log', 'person', 'group', 'me-section', 'teaching-plan', 'teaching-student',
]);

export function parseRoute(hash) {
  const path = String(hash ?? '').replace(/^#/, '').split('?')[0] || '/';
  for (const [name, pattern, keys] of ROUTES) {
    const match = pattern.exec(path);
    if (match) {
      return { name, path, params: Object.fromEntries(keys.map((key, index) => [key, match[index + 1] ?? null])) };
    }
  }
  return { name: 'today', path: '/', params: {}, redirected: true };
}

export function tabFor(route) {
  return TABS[route.name] ?? null;
}

export function isDetail(route) {
  return DETAIL.has(route.name);
}

export function createRouter({ window, onRoute }) {
  function handle() {
    const route = parseRoute(window.location.hash);
    if (route.redirected && window.location.hash && window.location.hash !== '#/') {
      window.history.replaceState(null, '', '#/');
    }
    onRoute(route);
  }
  return {
    start() {
      window.addEventListener('hashchange', handle);
      handle();
    },
    navigate(path) {
      if (window.location.hash === `#${path}`) handle();
      else window.location.hash = path;
    },
    back(fallbackPath = '/') {
      if (window.history.length > 1) window.history.back();
      else window.location.hash = fallbackPath;
    },
    stop() {
      window.removeEventListener('hashchange', handle);
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/router.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/shell/router.js tests/unit/router.test.js
git commit -m "feat: add hash router for the new app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Bottom sheet and page helpers

**Files:**
- Create: `src/app/shell/sheet.js`, `src/app/shell/page.js`
- Test: `tests/unit/sheet.test.js`

**Interfaces:**
- Produces: `openSheet({ document, title, content, closeLabel = 'Close', onClose }) → { element, body, close() }` — one sheet at a time; Escape, backdrop tap, close button, or a downward swipe of more than 80 px on the grab handle closes it; focus moves into the sheet and returns to the opener; Tab cycles inside.
- Produces: `el(document, tag, { className, text, attrs, dataset, on } = {}, children = [])`, `pageHeader({ document, title, backLabel, onBack, actions = [] }) → HTMLElement`, `initials(name) → string` (up to two uppercase letters).

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/sheet.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openSheet } from '../../src/app/shell/sheet.js';
import { el, initials, pageHeader } from '../../src/app/shell/page.js';

describe('sheet', () => {
  beforeEach(() => { document.body.innerHTML = '<button id="opener">Open</button>'; });

  function open(onClose = vi.fn()) {
    const opener = document.querySelector('#opener');
    opener.focus();
    const content = el(document, 'div', {}, [el(document, 'button', { text: 'Inside' })]);
    return { sheet: openSheet({ document, title: 'Thursday 9', content, onClose }), opener, onClose };
  }

  it('opens as a labelled dialog and moves focus inside', () => {
    const { sheet } = open();
    expect(sheet.element.getAttribute('role')).toBe('dialog');
    expect(sheet.element.getAttribute('aria-label')).toBe('Thursday 9');
    expect(sheet.element.contains(document.activeElement)).toBe(true);
  });

  it.each([
    ['Escape', (sheet) => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
    ['backdrop', () => document.querySelector('.sheet-backdrop').click()],
    ['close button', (sheet) => sheet.element.querySelector('[data-sheet-close]').click()],
    ['swipe', (sheet) => {
      const grab = sheet.element.querySelector('.sheet-grab');
      grab.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, bubbles: true }));
      grab.dispatchEvent(new PointerEvent('pointerup', { clientY: 220, bubbles: true }));
    }],
  ])('closes with %s and returns focus', (_label, act) => {
    const { sheet, opener, onClose } = open();
    act(sheet);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps only one sheet open', () => {
    open();
    open();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });

  it('builds headers and initials', () => {
    const onBack = vi.fn();
    const header = pageHeader({ document, title: 'Training', backLabel: 'Back', onBack });
    header.querySelector('button[aria-label="Back"]').click();
    expect(onBack).toHaveBeenCalled();
    expect(header.querySelector('h1').textContent).toBe('Training');
    expect(initials('João Morais')).toBe('JM');
    expect(initials('ana')).toBe('A');
    expect(initials('')).toBe('?');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/sheet.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// src/app/shell/page.js
export function el(document, tag, { className, text, attrs = {}, dataset = {}, on = {} } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null && value !== false) node.setAttribute(name, value === true ? '' : value);
  }
  for (const [name, value] of Object.entries(dataset)) node.dataset[name] = value;
  for (const [name, handler] of Object.entries(on)) node.addEventListener(name, handler);
  for (const child of children) if (child) node.append(child);
  return node;
}

export function initials(name) {
  const letters = String(name ?? '').trim().split(/\s+/).filter(Boolean)
    .slice(0, 2).map((word) => word[0].toUpperCase()).join('');
  return letters || '?';
}

export function pageHeader({ document, title, backLabel, onBack, actions = [] }) {
  const header = el(document, 'header', { className: 'page-header' });
  if (onBack) {
    header.append(el(document, 'button', {
      className: 'page-back', text: '‹', attrs: { type: 'button', 'aria-label': backLabel }, on: { click: onBack },
    }));
  }
  header.append(el(document, 'h1', { className: 'page-title', text: title }));
  const tools = el(document, 'div', { className: 'page-actions' }, actions);
  header.append(tools);
  return header;
}
```

```js
// src/app/shell/sheet.js
import { el } from './page.js';

let current = null;
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function openSheet({ document, title, content, closeLabel = 'Close', onClose = () => {} }) {
  current?.close();
  const opener = document.activeElement;
  const backdrop = el(document, 'div', { className: 'sheet-backdrop' });
  const grab = el(document, 'div', { className: 'sheet-grab', attrs: { 'aria-hidden': 'true' } });
  const closeButton = el(document, 'button', {
    className: 'sheet-close', text: '×', attrs: { type: 'button', 'aria-label': closeLabel }, dataset: { sheetClose: '' },
  });
  const heading = el(document, 'h2', { className: 'sheet-title', text: title });
  const body = el(document, 'div', { className: 'sheet-body' }, [content]);
  const panel = el(document, 'section', {
    className: 'sheet', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
  }, [grab, el(document, 'div', { className: 'sheet-head' }, [heading, closeButton]), body]);
  let startY = null;

  function close() {
    if (!panel.isConnected) return;
    backdrop.remove();
    panel.remove();
    document.removeEventListener('keydown', onKey);
    current = null;
    onClose();
    opener?.focus?.();
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...panel.querySelectorAll(FOCUSABLE)].filter((node) => !node.disabled);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  backdrop.addEventListener('click', close);
  closeButton.addEventListener('click', close);
  grab.addEventListener('pointerdown', (event) => { startY = event.clientY; });
  grab.addEventListener('pointerup', (event) => {
    if (startY !== null && event.clientY - startY > 80) close();
    startY = null;
  });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop, panel);
  (body.querySelector(FOCUSABLE) ?? panel).focus();
  current = { close };
  return { element: panel, body, close };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/sheet.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/shell/sheet.js src/app/shell/page.js tests/unit/sheet.test.js
git commit -m "feat: add bottom sheet and page helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: App frame, entry, Me and Settings

**Files:**
- Create: `src/app/shell/layout.js`, `src/app/create-services.js`, `src/app/entries/app.js`, `src/app/screens/me.js`, `src/app/screens/placeholder.js`, `app.html`, `assets/app.css`
- Modify: `scripts/build.mjs`, `src/app/dashboard-i18n.js`
- Test: `tests/unit/layout.test.js`, `tests/unit/me-screen.test.js`, `tests/e2e/app-shell.spec.js`

**Interfaces:**
- Consumes: router (Task 2), sheet/page (Task 3), `seedDemoData`, existing services.
- Produces:
  - `createLayout({ document, i18n, onPlus }) → { root, main, detail, setActive(tab|null), setDetailMode(boolean), refreshCopy() }`. The nav has links with `data-tab` for today/calendar/discover/me and a `button.app-plus` (aria-label "Create") plus a desktop-only `button.app-plus-side` ("Log training"). Body class `app-detail-open` hides the tab bar on phones.
  - `createServices({ window, localMode }) → { auth, profile, group, connection, training, statistics, repertoire, catalog }`.
  - Screen contract used by Tasks 6–9: `async render<Name>(ctx, route) → HTMLElement` where `ctx = { document, window, i18n, services, profile, timezone, navigate(path), back(fallback), today() → 'YYYY-MM-DD', now() → Date, getTermMappings(), openSheet(options) }`.
  - `renderMe(ctx)`, `renderSettings(ctx, { onLocaleChange, onSignOut })`, `renderPlaceholder(ctx, { title })`.
  - App startup: no session → `location.replace('/?next=' + encodeURIComponent('/app' + location.hash))`.

- [ ] **Step 1: Add i18n keys**

`en`:

```js
    'app.today': 'Today',
    'app.calendar': 'Calendar',
    'app.discover': 'Discover',
    'app.me': 'Me',
    'app.create': 'Create',
    'app.logTraining': 'Log training',
    'app.navigation': 'Main navigation',
    'app.back': 'Back',
    'app.close': 'Close',
    'app.loading': 'Loading…',
    'app.loadError': "We couldn't load this. Please try again.",
    'app.retry': 'Try again',
    'app.settings': 'Settings',
    'app.progress': 'Progress',
    'app.repertoire': 'Repertoire',
    'app.teaching': 'Teaching',
    'app.groups': 'Groups',
    'app.catalog': 'Catalog',
    'app.language': 'Language',
    'app.signOut': 'Sign out',
    'app.classic': 'Open the classic dashboard',
    'app.comingSoon': 'This part of the new app is coming soon. Everything still works in the classic dashboard.',
    'app.completeProfile': 'Finish setting up your profile in the classic dashboard first.',
    'app.offline': "You're offline. Changes will wait until you're back.",
```

`pt`:

```js
    'app.today': 'Hoje',
    'app.calendar': 'Calendário',
    'app.discover': 'Descobrir',
    'app.me': 'Eu',
    'app.create': 'Criar',
    'app.logTraining': 'Registar treino',
    'app.navigation': 'Navegação principal',
    'app.back': 'Voltar',
    'app.close': 'Fechar',
    'app.loading': 'A carregar…',
    'app.loadError': 'Não foi possível carregar. Tenta novamente.',
    'app.retry': 'Tentar novamente',
    'app.settings': 'Definições',
    'app.progress': 'Progresso',
    'app.repertoire': 'Repertório',
    'app.teaching': 'Ensino',
    'app.groups': 'Grupos',
    'app.catalog': 'Catálogo',
    'app.language': 'Idioma',
    'app.signOut': 'Sair',
    'app.classic': 'Abrir o painel clássico',
    'app.comingSoon': 'Esta parte da nova app chega em breve. Tudo continua a funcionar no painel clássico.',
    'app.completeProfile': 'Termina primeiro de configurar o teu perfil no painel clássico.',
    'app.offline': 'Estás offline. As alterações esperam até voltares.',
```

- [ ] **Step 2: Write the failing unit tests**

```js
// tests/unit/layout.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { createLayout } from '../../src/app/shell/layout.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

describe('layout', () => {
  it('renders the five destinations and marks the active tab', () => {
    const onPlus = vi.fn();
    const layout = createLayout({ document, i18n, onPlus });
    document.body.replaceChildren(layout.root);
    const nav = document.querySelector('nav[aria-label="Main navigation"]');
    expect([...nav.querySelectorAll('[data-tab]')].map((link) => [link.dataset.tab, link.getAttribute('href')])).toEqual([
      ['today', '#/'], ['calendar', '#/calendar'], ['discover', '#/discover'], ['me', '#/me'],
    ]);
    layout.setActive('calendar');
    expect(nav.querySelector('[data-tab="calendar"]').getAttribute('aria-current')).toBe('page');
    expect(nav.querySelector('[data-tab="today"]').hasAttribute('aria-current')).toBe(false);
    nav.querySelector('button[aria-label="Create"]').click();
    nav.querySelector('.app-plus-side').click();
    expect(onPlus).toHaveBeenCalledTimes(2);
  });

  it('toggles the detail mode body class', () => {
    const layout = createLayout({ document, i18n, onPlus() {} });
    document.body.replaceChildren(layout.root);
    layout.setDetailMode(true);
    expect(document.body.classList.contains('app-detail-open')).toBe(true);
    layout.setDetailMode(false);
    expect(document.body.classList.contains('app-detail-open')).toBe(false);
  });
});
```

```js
// tests/unit/me-screen.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { renderMe, renderSettings } from '../../src/app/screens/me.js';
import { renderPlaceholder } from '../../src/app/screens/placeholder.js';

function ctx(overrides = {}) {
  const values = new Map([['roda.dashboard.locale', 'en']]);
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  return {
    document, i18n: createDashboardI18n({ document, storage, navigator: { languages: ['en'] } }),
    profile: { id: 'p1', display_name: 'João Morais' },
    services: { catalog: { amICurator: vi.fn().mockResolvedValue(false) } },
    navigate: vi.fn(), back: vi.fn(),
    ...overrides,
  };
}

describe('me screen', () => {
  it('shows the profile and section rows', async () => {
    const view = await renderMe(ctx());
    expect(view.querySelector('.me-avatar').textContent).toBe('JM');
    expect(view.querySelector('.me-name').textContent).toBe('João Morais');
    expect([...view.querySelectorAll('.me-row')].map((row) => row.getAttribute('href'))).toEqual([
      '#/me/progress', '#/me/repertoire', '#/me/teaching', '#/me/groups', '#/me/settings',
    ]);
  });

  it('lists Catalog for curators', async () => {
    const view = await renderMe(ctx({ services: { catalog: { amICurator: vi.fn().mockResolvedValue(true) } } }));
    expect(view.querySelector('a[href="#/me/catalog"]')).not.toBeNull();
  });

  it('switches language and signs out from Settings', async () => {
    const onLocaleChange = vi.fn();
    const onSignOut = vi.fn();
    const context = ctx();
    const view = await renderSettings(context, { onLocaleChange, onSignOut });
    view.querySelector('button[data-locale="pt"]').click();
    expect(context.i18n.locale()).toBe('pt');
    expect(onLocaleChange).toHaveBeenCalled();
    view.querySelector('button[data-action="sign-out"]').click();
    expect(onSignOut).toHaveBeenCalled();
    expect(view.querySelector('a[href="/dashboard"]')).not.toBeNull();
  });

  it('renders placeholders with a link to the classic dashboard', async () => {
    const view = await renderPlaceholder(ctx(), { title: 'Discover' });
    expect(view.querySelector('h1').textContent).toBe('Discover');
    expect(view.querySelector('a[href="/dashboard"]').textContent).toBe('Open the classic dashboard');
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/unit/layout.test.js tests/unit/me-screen.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement layout, Me, Settings, placeholder**

```js
// src/app/shell/layout.js
import { el } from './page.js';

const TABS = [['today', '#/', 'app.today', '◉'], ['calendar', '#/calendar', 'app.calendar', '▦'],
  ['discover', '#/discover', 'app.discover', '⌖'], ['me', '#/me', 'app.me', '☺']];

export function createLayout({ document, i18n, onPlus }) {
  const links = TABS.map(([tab, href, key, icon]) => el(document, 'a', {
    className: 'app-tab', attrs: { href }, dataset: { tab },
  }, [el(document, 'span', { className: 'app-tab-icon', text: icon, attrs: { 'aria-hidden': 'true' } }),
    el(document, 'span', { className: 'app-tab-label', dataset: { label: key } })]));
  const plus = el(document, 'button', { className: 'app-plus', text: '+', attrs: { type: 'button' }, on: { click: () => onPlus() } });
  const plusSide = el(document, 'button', { className: 'app-plus-side', attrs: { type: 'button' }, on: { click: () => onPlus() } });
  const brand = el(document, 'a', { className: 'app-brand', text: 'RODA', attrs: { href: '#/' } });
  const nav = el(document, 'nav', { className: 'app-nav' },
    [brand, plusSide, links[0], links[1], el(document, 'div', { className: 'app-plus-slot' }, [plus]), links[2], links[3]]);
  const main = el(document, 'main', { className: 'app-main', attrs: { id: 'appMain', tabindex: '-1' } });
  const detail = el(document, 'aside', { className: 'app-detail', attrs: { id: 'appDetail' } });
  const offline = el(document, 'p', { className: 'app-offline', attrs: { role: 'status', hidden: true } });
  const root = el(document, 'div', { className: 'app' }, [nav, offline, el(document, 'div', { className: 'app-panes' }, [main, detail])]);

  function refreshCopy() {
    nav.setAttribute('aria-label', i18n.t('app.navigation'));
    plus.setAttribute('aria-label', i18n.t('app.create'));
    plusSide.textContent = `+ ${i18n.t('app.logTraining')}`;
    offline.textContent = i18n.t('app.offline');
    for (const label of nav.querySelectorAll('[data-label]')) label.textContent = i18n.t(label.dataset.label);
  }
  refreshCopy();

  return {
    root, main, detail,
    setActive(tab) {
      for (const link of links) {
        if (link.dataset.tab === tab) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
    },
    setDetailMode(open) {
      document.body.classList.toggle('app-detail-open', Boolean(open));
    },
    setOffline(isOffline) {
      offline.hidden = !isOffline;
    },
    refreshCopy,
  };
}
```

```js
// src/app/screens/placeholder.js
import { el, pageHeader } from '../shell/page.js';

export async function renderPlaceholder(ctx, { title }) {
  const { document, i18n } = ctx;
  return el(document, 'section', { className: 'screen screen-placeholder' }, [
    pageHeader({ document, title, backLabel: i18n.t('app.back'), onBack: () => ctx.back('/') }),
    el(document, 'p', { className: 'muted', text: i18n.t('app.comingSoon') }),
    el(document, 'a', { className: 'button-secondary', text: i18n.t('app.classic'), attrs: { href: '/dashboard' } }),
  ]);
}
```

```js
// src/app/screens/me.js
import { el, initials, pageHeader } from '../shell/page.js';

export async function renderMe(ctx) {
  const { document, i18n, profile, services } = ctx;
  let curator = false;
  try {
    curator = await services.catalog.amICurator();
  } catch {
    curator = false;
  }
  const rows = [
    ['progress', 'app.progress', '📈'], ['repertoire', 'app.repertoire', '📚'],
    ['teaching', 'app.teaching', '🧑‍🏫'], ['groups', 'app.groups', '👥'],
    ...(curator ? [['catalog', 'app.catalog', '🗂️']] : []),
    ['settings', 'app.settings', '⚙️'],
  ];
  return el(document, 'section', { className: 'screen screen-me' }, [
    pageHeader({ document, title: i18n.t('app.me') }),
    el(document, 'div', { className: 'me-top' }, [
      el(document, 'div', { className: 'me-avatar', text: initials(profile.display_name), attrs: { 'aria-hidden': 'true' } }),
      el(document, 'div', { className: 'me-name', text: profile.display_name }),
    ]),
    el(document, 'nav', { className: 'me-list' }, rows.map(([section, key, icon]) => el(document, 'a', {
      className: 'me-row', attrs: { href: `#/me/${section}` },
    }, [el(document, 'span', { text: `${icon} ${i18n.t(key)}` }), el(document, 'span', { className: 'muted', text: '›' })]))),
  ]);
}

export async function renderSettings(ctx, { onLocaleChange, onSignOut }) {
  const { document, i18n } = ctx;
  const languages = el(document, 'div', { className: 'segmented', attrs: { role: 'group', 'aria-label': i18n.t('app.language') } },
    [['en', 'English'], ['pt', 'Português']].map(([locale, label]) => el(document, 'button', {
      text: label, attrs: { type: 'button', 'aria-pressed': String(i18n.locale() === locale) }, dataset: { locale },
      on: { click: () => { i18n.setLocale(locale); onLocaleChange(); } },
    })));
  return el(document, 'section', { className: 'screen screen-settings' }, [
    pageHeader({ document, title: i18n.t('app.settings'), backLabel: i18n.t('app.back'), onBack: () => ctx.back('/me') }),
    el(document, 'h2', { className: 'section-label', text: i18n.t('app.language') }),
    languages,
    el(document, 'a', { className: 'button-secondary', text: i18n.t('app.classic'), attrs: { href: '/dashboard' } }),
    el(document, 'button', {
      className: 'button-danger', text: i18n.t('app.signOut'), attrs: { type: 'button' }, dataset: { action: 'sign-out' },
      on: { click: () => onSignOut() },
    }),
  ]);
}
```

- [ ] **Step 5: Run unit tests**

Run: `npx vitest run tests/unit/layout.test.js tests/unit/me-screen.test.js tests/unit/dashboard-i18n.test.js`
Expected: PASS.

- [ ] **Step 6: Create services factory, entry, page, styles, build entry**

```js
// src/app/create-services.js
import { createAuthService } from './auth-service.js';
import { createCatalogService } from './catalog-service.js';
import { createConnectionService } from './connection-service.js';
import { publicConfig } from './config.js';
import { createGroupService } from './group-service.js';
import { createProfileService } from './profile-service.js';
import { createRepertoireService } from './repertoire-service.js';
import { createStatisticsService } from './statistics-service.js';
import { createRodaClient } from './supabase-client.js';
import { createTrainingService } from './training-service.js';
import {
  createE2EAuthService, createE2ECatalogService, createE2EConnectionService, createE2EGroupService,
  createE2EProfileService, createE2ERepertoireService, createE2EStatisticsService, createE2ETrainingService,
} from './testing/fake-services.js';

export function createServices({ window, localMode }) {
  if (localMode) {
    return {
      auth: createE2EAuthService({ window }),
      profile: createE2EProfileService({ window }),
      group: createE2EGroupService({ window }),
      connection: createE2EConnectionService({ window }),
      training: createE2ETrainingService({ window }),
      statistics: createE2EStatisticsService({ window }),
      repertoire: createE2ERepertoireService({ window }),
      catalog: createE2ECatalogService({ window }),
    };
  }
  const client = createRodaClient(publicConfig);
  return {
    auth: createAuthService({ client, origin: window.location.origin, storage: window.localStorage }),
    profile: createProfileService(client),
    group: createGroupService(client),
    connection: createConnectionService(client),
    training: createTrainingService(client),
    statistics: createStatisticsService(client),
    repertoire: createRepertoireService(client),
    catalog: createCatalogService(client),
  };
}
```

```js
// src/app/entries/app.js
import { createServices } from '../create-services.js';
import { createDashboardI18n } from '../dashboard-i18n.js';
import { seedDemoData } from '../demo-data.js';
import { renderCalendar } from '../screens/calendar.js';
import { renderLog } from '../screens/log.js';
import { renderMe, renderSettings } from '../screens/me.js';
import { renderPlaceholder } from '../screens/placeholder.js';
import { renderToday } from '../screens/today.js';
import { renderTraining } from '../screens/training.js';
import { createLayout } from '../shell/layout.js';
import { el } from '../shell/page.js';
import { createRouter, isDetail, tabFor } from '../shell/router.js';
import { openSheet } from '../shell/sheet.js';

function localIsoDate(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

async function main() {
  const params = new URLSearchParams(location.search);
  const demoMode = params.get('demo') === '1';
  if (demoMode) seedDemoData(localStorage);
  const localMode = __RODA_E2E__ || demoMode;
  const services = createServices({ window, localMode });
  const i18n = createDashboardI18n({ document, storage: localStorage, navigator });
  const root = document.querySelector('#appRoot');

  const session = await services.auth.getSession();
  if (!session) {
    location.replace(`/?next=${encodeURIComponent(`/app${location.hash}`)}`);
    return;
  }
  const profile = await services.profile.loadProfile();
  const timezone = profile.timezone_override || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  let termMappings = [];
  services.catalog.listTermMappings().then((rows) => { termMappings = rows; }).catch(() => {});

  const desktop = window.matchMedia('(min-width: 900px)');
  let lastTopLevel = { name: 'today', path: '/', params: {} };
  let renderToken = 0;
  const layout = createLayout({ document, i18n, onPlus: () => router.navigate('/log') });
  root.replaceChildren(layout.root);
  layout.setOffline(!navigator.onLine);
  window.addEventListener('online', () => layout.setOffline(false));
  window.addEventListener('offline', () => layout.setOffline(true));

  const ctx = {
    document, window, i18n, services, profile, timezone,
    navigate: (path) => router.navigate(path),
    back: (fallback = '/') => router.back(fallback),
    today: () => localIsoDate(new Date(), timezone),
    now: () => new Date(),
    getTermMappings: () => termMappings,
    openSheet: (options) => openSheet({ document, closeLabel: i18n.t('app.close'), ...options }),
  };

  async function screenFor(route) {
    if (!profile.completed_at) {
      return el(document, 'section', { className: 'screen' }, [
        el(document, 'p', { text: i18n.t('app.completeProfile') }),
        el(document, 'a', { className: 'button-secondary', text: i18n.t('app.classic'), attrs: { href: '/dashboard' } }),
      ]);
    }
    switch (route.name) {
      case 'today': return renderToday(ctx, route);
      case 'calendar': return renderCalendar(ctx, route);
      case 'training': return renderTraining(ctx, route);
      case 'log': return renderLog(ctx, route);
      case 'me': return renderMe(ctx, route);
      case 'me-section':
        if (route.params.section === 'settings') {
          return renderSettings(ctx, {
            onLocaleChange: () => { layout.refreshCopy(); show(route); },
            onSignOut: async () => { await services.auth.signOut(); location.replace('/'); },
          });
        }
        return renderPlaceholder(ctx, { title: i18n.t(`app.${route.params.section}`) });
      case 'discover': return renderPlaceholder(ctx, { title: i18n.t('app.discover') });
      default: return renderPlaceholder(ctx, { title: i18n.t('app.today') });
    }
  }

  async function show(route) {
    const token = ++renderToken;
    const detailRoute = isDetail(route);
    const sideBySide = desktop.matches && route.name === 'training';
    layout.setActive(tabFor(route) ?? tabFor(lastTopLevel));
    layout.setDetailMode(detailRoute && !sideBySide);
    if (!detailRoute) lastTopLevel = route;
    const target = sideBySide ? layout.detail : layout.main;
    target.replaceChildren(el(document, 'p', { className: 'muted screen-loading', text: i18n.t('app.loading') }));
    if (sideBySide && !layout.main.firstElementChild?.dataset.screen) {
      const top = await screenFor(lastTopLevel);
      top.dataset.screen = lastTopLevel.name;
      if (token === renderToken) layout.main.replaceChildren(top);
    }
    if (!sideBySide) layout.detail.replaceChildren();
    const view = await screenFor(route);
    if (token !== renderToken) return;
    view.dataset.screen = route.name;
    target.replaceChildren(view);
    if (!sideBySide) layout.main.focus({ preventScroll: true });
  }

  const router = createRouter({ window, onRoute: (route) => { show(route); } });
  router.start();

  if (!__RODA_E2E__ && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/app-sw.js', { scope: '/app' }).catch(() => {});
  }
}

main();
```

`app.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <meta name="theme-color" content="#17120D">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Roda</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="apple-touch-icon" href="/assets/icons/app-180.png">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="stylesheet" href="/assets/training-forms.css">
  <link rel="stylesheet" href="/assets/app.css">
</head>
<body>
  <div id="appRoot"><p class="muted screen-loading">Opening your roda…</p></div>
  <script type="module" src="/assets/generated/app.js"></script>
</body>
</html>
```

`assets/app.css` (complete stylesheet for this plan; later tasks append screen sections):

```css
@font-face { font-family: Syne; font-style: normal; font-weight: 800; font-display: swap; src: url('/assets/fonts/syne-800-latin.woff2') format('woff2'); }
@font-face { font-family: 'Hanken Grotesk'; font-style: normal; font-weight: 400; font-display: swap; src: url('/assets/fonts/hanken-grotesk-400-latin.woff2') format('woff2'); }
@font-face { font-family: 'Hanken Grotesk'; font-style: normal; font-weight: 600; font-display: swap; src: url('/assets/fonts/hanken-grotesk-600-latin.woff2') format('woff2'); }
@font-face { font-family: 'Space Mono'; font-style: normal; font-weight: 700; font-display: swap; src: url('/assets/fonts/space-mono-700-latin.woff2') format('woff2'); }

:root {
  --bg: #17120d; --card: #231c15; --card-2: #2a2119; --line: #3a2f23; --gold: #eba63c; --clay: #d2502a;
  --cream: #f3e9d6; --sand: #e6d4b2; --muted: #a8977c; --green: #6fae6a; --teal: #4fb3a9; --violet: #b58ad8;
  --display: Syne, system-ui, sans-serif; --body: 'Hanken Grotesk', system-ui, sans-serif; --mono: 'Space Mono', ui-monospace, monospace;
  --tabbar: 64px; --safe-bottom: env(safe-area-inset-bottom, 0px);
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--cream); font: 15px/1.4 var(--body); }
a { color: inherit; }
button { font: inherit; color: inherit; }
.muted { color: var(--muted); font-size: .85rem; }
.screen { padding: 16px 16px calc(var(--tabbar) + var(--safe-bottom) + 24px); max-width: 720px; margin: 0 auto; }
.screen-loading { padding: 32px 16px; text-align: center; }
.page-header { display: flex; align-items: center; gap: 10px; margin: 4px 0 14px; }
.page-title { font: 800 1.5rem/1.1 var(--display); margin: 0; flex: 1; }
.page-back { border: 0; background: transparent; font-size: 1.8rem; line-height: 1; padding: 0 6px; cursor: pointer; }
.page-actions { display: flex; gap: 8px; }
.section-label { font: 700 .7rem/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); margin: 18px 0 8px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 12px 14px; }
.tag { display: inline-flex; gap: 4px; align-items: center; border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; font-size: .8rem; background: var(--card); }
.felt { font-size: .72rem; border-radius: 6px; padding: 1px 6px; background: var(--line); color: var(--sand); }
.button-primary, .button-secondary, .button-danger { display: inline-flex; justify-content: center; align-items: center; gap: 6px; border-radius: 999px; padding: 11px 18px; font-weight: 600; text-decoration: none; cursor: pointer; border: 1px solid var(--line); background: var(--card); margin: 8px 8px 0 0; }
.button-primary { background: var(--gold); color: var(--bg); border-color: var(--gold); }
.button-danger { border-color: var(--clay); color: var(--clay); background: transparent; }
.segmented { display: inline-grid; grid-auto-flow: column; background: var(--card); border: 1px solid var(--line); border-radius: 999px; padding: 3px; }
.segmented button { border: 0; background: transparent; border-radius: 999px; padding: 7px 14px; cursor: pointer; }
.segmented button[aria-pressed="true"] { background: var(--gold); color: var(--bg); font-weight: 700; }

/* navigation: phone tab bar */
.app-nav { position: fixed; z-index: 20; left: 0; right: 0; bottom: 0; height: calc(var(--tabbar) + var(--safe-bottom)); padding-bottom: var(--safe-bottom); display: grid; grid-template-columns: repeat(5, 1fr); align-items: center; background: #1b150f; border-top: 1px solid var(--line); }
.app-brand, .app-plus-side { display: none; }
.app-tab { display: grid; justify-items: center; gap: 2px; text-decoration: none; color: var(--muted); font-size: .7rem; }
.app-tab-icon { font-size: 1.1rem; }
.app-tab[aria-current="page"] { color: var(--gold); font-weight: 700; }
.app-plus-slot { display: grid; justify-items: center; }
.app-plus { width: 54px; height: 54px; margin-top: -26px; border-radius: 50%; border: 0; background: var(--gold); color: var(--bg); font-size: 2rem; font-weight: 700; box-shadow: 0 6px 18px #0009; cursor: pointer; }
.app-detail-open .app-nav { display: none; }
.app-offline { position: sticky; top: 0; z-index: 15; margin: 0; padding: 6px 12px; background: var(--clay); color: var(--cream); text-align: center; font-size: .8rem; }
.app-detail:empty { display: none; }

/* bottom sheet */
.sheet-backdrop { position: fixed; inset: 0; z-index: 40; background: #0009; }
.sheet { position: fixed; z-index: 41; left: 0; right: 0; bottom: 0; max-height: 85vh; overflow: auto; background: var(--card-2); border-radius: 20px 20px 0 0; padding: 8px 16px calc(16px + var(--safe-bottom)); box-shadow: 0 -10px 30px #0008; outline: none; }
.sheet-grab { width: 40px; height: 5px; border-radius: 3px; background: var(--line); margin: 4px auto 10px; touch-action: none; cursor: grab; }
.sheet-head { display: flex; align-items: center; justify-content: space-between; }
.sheet-title { font: 800 1.1rem/1.2 var(--display); margin: 0; }
.sheet-close { border: 0; background: transparent; font-size: 1.6rem; cursor: pointer; }

/* Me */
.me-top { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.me-avatar { width: 56px; height: 56px; border-radius: 50%; background: var(--gold); color: var(--bg); display: grid; place-items: center; font-weight: 800; font-size: 1.2rem; }
.me-name { font-weight: 700; font-size: 1.1rem; }
.me-list { display: grid; }
.me-row { display: flex; justify-content: space-between; padding: 14px 4px; border-bottom: 1px solid var(--line); text-decoration: none; }

/* desktop */
@media (min-width: 900px) {
  .app { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
  .app-nav { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; align-items: stretch; gap: 4px; padding: 20px 12px; border-top: 0; border-right: 1px solid var(--line); }
  .app-brand { display: block; font: 800 1.4rem var(--display); text-decoration: none; color: var(--gold); margin: 0 8px 16px; }
  .app-plus-side { display: block; border: 0; border-radius: 999px; background: var(--gold); color: var(--bg); font-weight: 700; padding: 11px; margin-bottom: 14px; cursor: pointer; }
  .app-plus-slot { display: none; }
  .app-tab { display: flex; gap: 10px; padding: 10px 12px; border-radius: 12px; font-size: .95rem; }
  .app-tab[aria-current="page"] { background: var(--card); }
  .app-detail-open .app-nav { display: flex; }
  .app-panes { display: grid; grid-template-columns: minmax(0, 1fr); }
  .app-panes:has(.app-detail:not(:empty)) { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .app-detail { border-left: 1px solid var(--line); max-height: 100vh; overflow: auto; position: sticky; top: 0; }
  .screen { padding-bottom: 32px; }
  .sheet { left: 50%; right: auto; width: 520px; transform: translateX(-50%); }
}
```

In `scripts/build.mjs`, add `app: 'src/app/entries/app.js',` to `entryPoints`, and after the existing `await build({...})` add the service worker build (implemented in Task 5):

```js
  await build({
    entryPoints: ['src/app/sw/service-worker.js'],
    outfile: 'app-sw.js',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: ['es2020'],
    minify: !test,
    legalComments: 'none',
    define: { __RODA_SW_VERSION__: JSON.stringify(String(Date.now())) },
  });
```

Add `app-sw.js` to `.gitignore` under the `assets/generated/` line.

Create stub screen modules so the entry bundles before Tasks 6–9 (each later task replaces its stub):

```js
// src/app/screens/today.js (stub replaced in Task 6)
import { renderPlaceholder } from './placeholder.js';

export async function renderToday(ctx) {
  return renderPlaceholder(ctx, { title: ctx.i18n.t('app.today') });
}
```

```js
// src/app/screens/calendar.js (stub replaced in Task 7)
import { renderPlaceholder } from './placeholder.js';

export async function renderCalendar(ctx) {
  return renderPlaceholder(ctx, { title: ctx.i18n.t('app.calendar') });
}
```

```js
// src/app/screens/training.js (stub replaced in Task 8)
import { renderPlaceholder } from './placeholder.js';

export async function renderTraining(ctx) {
  return renderPlaceholder(ctx, { title: ctx.i18n.t('app.today') });
}
```

```js
// src/app/screens/log.js (stub replaced in Task 9)
import { renderPlaceholder } from './placeholder.js';

export async function renderLog(ctx) {
  return renderPlaceholder(ctx, { title: ctx.i18n.t('app.logTraining') });
}
```

The service worker entry must exist for the build; create `src/app/sw/service-worker.js` with a single line `self.addEventListener('fetch', () => {});` here and replace it in Task 5.

- [ ] **Step 7: Write the browser test**

```js
// tests/e2e/app-shell.spec.js
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1', email: 'ana@example.com' } }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify({
      id: 'practitioner-1', display_name: 'Ana Silva', avatar_path: null,
      timezone_override: 'Europe/Lisbon', leaderboard_visible: true, completed_at: '2026-09-11T20:00:00Z',
    }));
  });
});

test('shows the navigation and moves between destinations', async ({ page }, testInfo) => {
  await page.goto('/app');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: 'Me' }).click();
  await expect(page).toHaveURL(/#\/me$/);
  await page.getByRole('link', { name: /Settings/ }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Português' }).click();
  await expect(nav.getByRole('link', { name: 'Hoje' })).toBeVisible();
  if (testInfo.project.name.includes('mobile')) {
    await expect(nav.getByRole('button', { name: 'Criar' })).toBeVisible();
  } else {
    await expect(nav.getByRole('button', { name: '+ Registar treino' })).toBeVisible();
  }
});

test('sends unknown routes to Today and placeholders to the classic dashboard', async ({ page }) => {
  await page.goto('/app#/does-not-exist');
  await expect(page).toHaveURL(/#\/$/);
  await page.goto('/app#/discover');
  await expect(page.getByRole('link', { name: 'Open the classic dashboard' })).toHaveAttribute('href', '/dashboard');
});

test('signed-out visitors go to sign-in and keep the route', async ({ page }) => {
  await page.evaluate(() => localStorage.removeItem('roda.e2e.session'));
  await page.goto('/app#/calendar');
  await expect(page).toHaveURL(/\/\?next=%2Fapp%23%2Fcalendar$/);
});

test('signs out from Settings', async ({ page }) => {
  await page.goto('/app#/me/settings');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => localStorage.getItem('roda.e2e.session'))).toBeNull();
});
```

- [ ] **Step 8: Run tests**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/shell/layout.js src/app/create-services.js src/app/entries/app.js src/app/screens app.html assets/app.css scripts/build.mjs .gitignore src/app/sw/service-worker.js src/app/dashboard-i18n.js tests/unit/layout.test.js tests/unit/me-screen.test.js tests/e2e/app-shell.spec.js
git commit -m "feat: add the mobile-first app shell at /app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Installable web app

**Files:**
- Create: `src/app/sw/cache-policy.js`, `scripts/build-icons.mjs`, `manifest.webmanifest`, `assets/icons/app-180.png`, `assets/icons/app-192.png`, `assets/icons/app-512.png`
- Modify: `src/app/sw/service-worker.js`
- Test: `tests/unit/cache-policy.test.js`, `tests/unit/manifest.test.js`

**Interfaces:**
- Produces: `APP_SHELL` (array of same-origin paths precached), `strategyFor({ url, method, mode, origin }) → 'network-first' | 'stale-while-revalidate' | 'bypass'`; `cacheName(version) → 'roda-app-<version>'`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/cache-policy.test.js
import { describe, expect, it } from 'vitest';

import { APP_SHELL, cacheName, strategyFor } from '../../src/app/sw/cache-policy.js';

const origin = 'https://roda.fyi';
const req = (path, extra = {}) => ({ url: new URL(path, origin).href, method: 'GET', mode: 'cors', origin, ...extra });

describe('cache policy', () => {
  it('precaches the app shell only', () => {
    expect(APP_SHELL).toEqual(expect.arrayContaining(['/app', '/assets/app.css', '/assets/generated/app.js', '/manifest.webmanifest']));
    expect(APP_SHELL.every((path) => path.startsWith('/'))).toBe(true);
  });

  it.each([
    [req('/app', { mode: 'navigate' }), 'network-first'],
    [req('/assets/app.css'), 'stale-while-revalidate'],
    [req('/assets/generated/app.js'), 'stale-while-revalidate'],
    [req('/assets/fonts/syne-800-latin.woff2'), 'stale-while-revalidate'],
    [{ ...req('/rest/v1/rpc/get_training'), url: 'https://cemtojrbroegisjpfxpz.supabase.co/rest/v1/rpc/get_training' }, 'bypass'],
    [req('/assets/app.css', { method: 'POST' }), 'bypass'],
    [req('/dashboard', { mode: 'navigate' }), 'bypass'],
    [req('/api/clip'), 'bypass'],
  ])('chooses %o → %s', (request, strategy) => {
    expect(strategyFor(request)).toBe(strategy);
  });

  it('names caches by version', () => {
    expect(cacheName('123')).toBe('roda-app-123');
  });
});
```

```js
// tests/unit/manifest.test.js
import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('web app manifest', () => {
  it('describes an installable standalone app', async () => {
    const manifest = JSON.parse(await readFile('manifest.webmanifest', 'utf8'));
    expect(manifest).toMatchObject({
      name: 'Roda', short_name: 'Roda', start_url: '/app', scope: '/app', display: 'standalone',
      background_color: '#17120d', theme_color: '#17120d',
    });
    const sizes = manifest.icons.map(({ sizes: value }) => value);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    for (const icon of manifest.icons) expect((await stat(icon.src.slice(1))).size).toBeGreaterThan(500);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/cache-policy.test.js tests/unit/manifest.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

```js
// src/app/sw/cache-policy.js
export const APP_SHELL = Object.freeze([
  '/app',
  '/assets/app.css',
  '/assets/training-forms.css',
  '/assets/generated/app.js',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/assets/fonts/syne-800-latin.woff2',
  '/assets/fonts/hanken-grotesk-400-latin.woff2',
  '/assets/fonts/hanken-grotesk-600-latin.woff2',
  '/assets/fonts/space-mono-700-latin.woff2',
]);

export function cacheName(version) {
  return `roda-app-${version}`;
}

export function strategyFor({ url, method, mode, origin }) {
  if (method !== 'GET') return 'bypass';
  const target = new URL(url);
  if (target.origin !== origin) return 'bypass';
  if (mode === 'navigate') return target.pathname === '/app' ? 'network-first' : 'bypass';
  if (target.pathname.startsWith('/assets/') || target.pathname === '/manifest.webmanifest'
    || target.pathname === '/favicon.svg') {
    return 'stale-while-revalidate';
  }
  return 'bypass';
}
```

```js
// src/app/sw/service-worker.js
import { APP_SHELL, cacheName, strategyFor } from './cache-policy.js';

const CACHE = cacheName(__RODA_SW_VERSION__);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith('roda-app-') && key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const strategy = strategyFor({ url: request.url, method: request.method, mode: request.mode, origin: self.location.origin });
  if (strategy === 'bypass') return;
  if (strategy === 'network-first') {
    event.respondWith(fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put('/app', copy));
        return response;
      })
      .catch(() => caches.match('/app')));
    return;
  }
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(request);
    const network = fetch(request).then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    }).catch(() => cached);
    return cached ?? network;
  }));
});
```

`manifest.webmanifest`:

```json
{
  "name": "Roda",
  "short_name": "Roda",
  "description": "Train, teach, and track capoeira.",
  "start_url": "/app",
  "scope": "/app",
  "display": "standalone",
  "background_color": "#17120d",
  "theme_color": "#17120d",
  "icons": [
    { "src": "/assets/icons/app-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/assets/icons/app-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

```js
// scripts/build-icons.mjs
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const svg = await readFile('favicon.svg', 'utf8');
await mkdir('assets/icons', { recursive: true });
const browser = await chromium.launch();
for (const size of [180, 192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:#17120d">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `assets/icons/app-${size}.png`, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
}
await browser.close();
console.log('Wrote assets/icons/app-{180,192,512}.png');
```

Run: `node scripts/build-icons.mjs`
Expected: `Wrote assets/icons/app-{180,192,512}.png`.

- [ ] **Step 4: Run tests and build**

Run: `npx vitest run tests/unit/cache-policy.test.js tests/unit/manifest.test.js && npm run build:test && ls app-sw.js`
Expected: PASS and `app-sw.js` exists.

- [ ] **Step 5: Commit**

```bash
git add src/app/sw scripts/build-icons.mjs manifest.webmanifest assets/icons tests/unit/cache-policy.test.js tests/unit/manifest.test.js
git commit -m "feat: make the new app installable with a service worker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Today

**Files:**
- Create: `src/app/screens/today-state.js`; replace `src/app/screens/today.js`
- Modify: `src/app/dashboard-i18n.js`, `assets/app.css`
- Test: `tests/unit/today-state.test.js`, `tests/unit/today-screen.test.js`, `tests/e2e/app-today.spec.js`

**Interfaces:**
- Consumes: `trainingService.listCalendar`, `listRecentTrainings` (Task 1), `resourceIcons`.
- Produces: `weekDays(todayIso) → [{ date, day, isToday }] ×7` (Monday first); `clipText(text, max = 120)`; `nowNextCard({ calendarItems, recent, profileId, now }) → null | { type: 'finish'|'rate'|'next', item?, training?, teaching? }`; `kindLabel(i18n, kind)`; `renderToday(ctx)`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/today-state.test.js
import { describe, expect, it } from 'vitest';

import { clipText, nowNextCard, weekDays } from '../../src/app/screens/today-state.js';

const now = new Date('2026-10-11T18:00:00Z');

describe('today state', () => {
  it('lists the Monday-first week containing today', () => {
    expect(weekDays('2026-10-11').map(({ date }) => date)).toEqual([
      '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11',
    ]);
    expect(weekDays('2026-10-11').find(({ isToday }) => isToday).day).toBe(11);
    expect(weekDays('2026-10-05')[0].date).toBe('2026-10-05');
  });

  it('clips long text to one line', () => {
    expect(clipText('a'.repeat(200))).toHaveLength(120);
    expect(clipText('a'.repeat(200)).endsWith('…')).toBe(true);
    expect(clipText('short')).toBe('short');
    expect(clipText(null)).toBe('');
  });

  it('asks a coach to finish a class that ended within 12 hours', () => {
    const item = { item_id: 's1', item_type: 'scheduled', status: 'scheduled', coach_profile_id: 'me',
      starts_at: '2026-10-11T15:00:00Z', duration_minutes: 60, local_date: '2026-10-11' };
    expect(nowNextCard({ calendarItems: [item], recent: [], profileId: 'me', now })).toEqual({ type: 'finish', item });
    const old = { ...item, starts_at: '2026-10-10T04:00:00Z' };
    expect(nowNextCard({ calendarItems: [old], recent: [], profileId: 'me', now })).toBeNull();
  });

  it('asks how a recent class went when it is not rated', () => {
    const training = { occurrence_id: 'o1', role: 'participant', kind: 'group', occurred_at: '2026-10-11T10:00:00Z', has_rating: false };
    expect(nowNextCard({ calendarItems: [], recent: [training], profileId: 'me', now })).toEqual({ type: 'rate', training });
    expect(nowNextCard({ calendarItems: [], recent: [{ ...training, has_rating: true }], profileId: 'me', now })).toBeNull();
    expect(nowNextCard({ calendarItems: [], recent: [{ ...training, kind: 'alone' }], profileId: 'me', now })).toBeNull();
  });

  it('shows the next class today or tomorrow', () => {
    const later = { item_id: 's2', item_type: 'scheduled', status: 'scheduled', coach_profile_id: 'other',
      starts_at: '2026-10-12T17:00:00Z', duration_minutes: 60, local_date: '2026-10-12' };
    const sooner = { ...later, item_id: 's3', starts_at: '2026-10-11T19:00:00Z', local_date: '2026-10-11', coach_profile_id: 'me' };
    const farAway = { ...later, item_id: 's4', starts_at: '2026-10-20T17:00:00Z', local_date: '2026-10-20' };
    expect(nowNextCard({ calendarItems: [later, sooner, farAway], recent: [], profileId: 'me', now }))
      .toEqual({ type: 'next', item: sooner, teaching: true });
    expect(nowNextCard({ calendarItems: [farAway], recent: [], profileId: 'me', now })).toBeNull();
  });
});
```

```js
// tests/unit/today-screen.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { renderToday } from '../../src/app/screens/today.js';

function ctx(training) {
  return {
    document, i18n: createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } }),
    profile: { id: 'me', display_name: 'Ana Silva' }, timezone: 'UTC',
    services: { training }, navigate: vi.fn(), today: () => '2026-10-11', now: () => new Date('2026-10-11T12:00:00Z'),
  };
}

describe('today screen', () => {
  it('renders the week strip, the next card, and recent trainings', async () => {
    const training = {
      listCalendar: vi.fn().mockResolvedValue([
        { item_id: 'o9', item_type: 'completed', status: 'completed', kind: 'alone', local_date: '2026-10-09', starts_at: '2026-10-09T07:00:00Z', duration_minutes: 45 },
        { item_id: 's1', item_type: 'scheduled', status: 'scheduled', kind: 'group', local_date: '2026-10-11', starts_at: '2026-10-11T19:00:00Z', duration_minutes: 60, group_name: 'Grupo Lua', coach_profile_id: 'me', plan_title: 'Armada ladder' },
      ]),
      listRecentTrainings: vi.fn().mockResolvedValue([{
        occurrence_id: 'o9', kind: 'alone', local_date: '2026-10-09', occurred_at: '2026-10-09T07:00:00Z',
        duration_minutes: 45, role: 'participant', first_round_text: `${'armada, '.repeat(30)}au`, felt: 'okay',
        has_rating: true, resource_kinds: ['video'], attendee_count: 1,
      }]),
    };
    const context = ctx(training);
    const view = await renderToday(context);
    expect(view.querySelectorAll('.week-day')).toHaveLength(7);
    expect(view.querySelector('.week-day[aria-current="date"]').textContent).toContain('11');
    expect(view.querySelector('[data-day="2026-10-09"] .week-dot')).not.toBeNull();
    const card = view.querySelector('.now-card');
    expect(card.textContent).toContain('Grupo Lua');
    expect(card.textContent).toContain('You teach');
    const recent = view.querySelector('.recent-card');
    expect(recent.querySelector('.recent-text').textContent.length).toBeLessThanOrEqual(120);
    expect(recent.querySelector('.resource-icons').textContent).toBe('🎥');
    expect(recent.querySelector('.felt').textContent).toBe('felt Okay');
    recent.click();
    expect(context.navigate).toHaveBeenCalledWith('/training/o9');
    view.querySelector('[data-day="2026-10-09"]').click();
    expect(context.navigate).toHaveBeenCalledWith('/calendar/2026-10-09');
  });

  it('explains the empty state', async () => {
    const view = await renderToday(ctx({ listCalendar: vi.fn().mockResolvedValue([]), listRecentTrainings: vi.fn().mockResolvedValue([]) }));
    expect(view.textContent).toContain('Nothing logged yet. Tap + to log your first training.');
    expect(view.querySelector('.now-card')).toBeNull();
  });

  it('shows a retry when loading fails', async () => {
    const training = { listCalendar: vi.fn().mockRejectedValue(new Error('offline')), listRecentTrainings: vi.fn().mockResolvedValue([]) };
    const view = await renderToday(ctx(training));
    expect(view.textContent).toContain('offline');
    expect(view.querySelector('button[data-action="retry"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/today-state.test.js tests/unit/today-screen.test.js`
Expected: FAIL.

- [ ] **Step 3: Add i18n keys**

`en`:

```js
    'today.recent': 'Recent',
    'today.empty': 'Nothing logged yet. Tap + to log your first training.',
    'today.finishClass': 'Finish class',
    'today.finishTitle': 'Your class just ended',
    'today.rateTitle': 'How did it go?',
    'today.rate': 'Rate it',
    'today.nextTitle': 'Next',
    'today.youTeach': 'You teach',
    'today.open': 'Open',
    'today.felt': 'felt {difficulty}',
    'today.attended': '{count} attended',
```

`pt`:

```js
    'today.recent': 'Recentes',
    'today.empty': 'Ainda não registaste nada. Toca em + para registar o primeiro treino.',
    'today.finishClass': 'Terminar aula',
    'today.finishTitle': 'A tua aula acabou de terminar',
    'today.rateTitle': 'Como correu?',
    'today.rate': 'Avaliar',
    'today.nextTitle': 'A seguir',
    'today.youTeach': 'Tu dás',
    'today.open': 'Abrir',
    'today.felt': 'pareceu {difficulty}',
    'today.attended': '{count} presentes',
```

- [ ] **Step 4: Implement state and screen**

```js
// src/app/screens/today-state.js
const HOUR = 3600000;

function addDaysIso(iso, amount) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function weekDays(todayIso) {
  const offset = (new Date(`${todayIso}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monday = addDaysIso(todayIso, -offset);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDaysIso(monday, index);
    return { date, day: Number(date.slice(8)), isToday: date === todayIso };
  });
}

export function weekRange(todayIso) {
  const days = weekDays(todayIso);
  const start = [days[0].date, addDaysIso(todayIso, -1)].sort()[0];
  const endExclusive = [addDaysIso(days[6].date, 1), addDaysIso(todayIso, 2)].sort().at(-1);
  return { start, endExclusive };
}

export function clipText(text, max = 120) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function endOf(item) {
  return new Date(item.starts_at).getTime() + (item.duration_minutes ?? 0) * 60000;
}

export function nowNextCard({ calendarItems, recent, profileId, now }) {
  const time = now.getTime();
  const scheduled = calendarItems.filter((item) => item.item_type === 'scheduled' && item.status === 'scheduled');
  const finish = scheduled
    .filter((item) => item.coach_profile_id === profileId && endOf(item) <= time && time - endOf(item) < 12 * HOUR)
    .sort((a, b) => endOf(b) - endOf(a))[0];
  if (finish) return { type: 'finish', item: finish };
  const rate = recent.find((training) => training.role === 'participant' && training.kind !== 'alone'
    && !training.has_rating && time - new Date(training.occurred_at).getTime() < 12 * HOUR);
  if (rate) return { type: 'rate', training: rate };
  const todayIso = now.toISOString().slice(0, 10);
  const tomorrowIso = addDaysIso(todayIso, 1);
  const next = scheduled
    .filter((item) => endOf(item) > time && item.local_date >= todayIso && item.local_date <= tomorrowIso)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  if (next) return { type: 'next', item: next, teaching: next.coach_profile_id === profileId };
  return null;
}

export function kindLabel(i18n, kind) {
  if (kind === 'personal_class') return i18n.t('training.personalClass');
  if (kind === 'group') return i18n.t('training.group');
  return i18n.t('training.alone');
}
```

```js
// src/app/screens/today.js
import { el, initials, pageHeader } from '../shell/page.js';
import { resourceIcons } from '../ui/resource-view.js';
import { clipText, kindLabel, nowNextCard, weekDays, weekRange } from './today-state.js';

function timeOf(ctx, iso) {
  return new Intl.DateTimeFormat(ctx.i18n.locale() === 'pt' ? 'pt-PT' : 'en-US', {
    hour: '2-digit', minute: '2-digit', timeZone: ctx.timezone,
  }).format(new Date(iso));
}

function nowCard(ctx, card) {
  const { document, i18n } = ctx;
  if (card.type === 'rate') {
    return el(document, 'article', { className: 'card now-card' }, [
      el(document, 'div', { className: 'section-label', text: i18n.t('today.rateTitle') }),
      el(document, 'h2', { text: card.training.group_name ?? kindLabel(i18n, card.training.kind) }),
      el(document, 'button', { className: 'button-primary', text: i18n.t('today.rate'), attrs: { type: 'button' },
        on: { click: () => ctx.navigate(`/training/${card.training.occurrence_id}`) } }),
    ]);
  }
  const { item } = card;
  const finishing = card.type === 'finish';
  const meta = [timeOf(ctx, item.starts_at), item.plan_title, (finishing || card.teaching) ? i18n.t('today.youTeach') : null]
    .filter(Boolean).join(' · ');
  const action = finishing || card.teaching
    ? el(document, 'button', { className: 'button-primary', text: i18n.t(finishing ? 'today.finishClass' : 'today.open'),
      attrs: { type: 'button' }, on: { click: () => ctx.navigate(`/class/${item.item_id}`) } })
    : null;
  return el(document, 'article', { className: 'card now-card' }, [
    el(document, 'div', { className: 'section-label', text: i18n.t(finishing ? 'today.finishTitle' : 'today.nextTitle') }),
    el(document, 'h2', { text: item.group_name ?? kindLabel(i18n, item.kind) }),
    el(document, 'p', { className: 'muted', text: meta }),
    action,
  ]);
}

function recentCard(ctx, training) {
  const { document, i18n } = ctx;
  const title = [kindLabel(i18n, training.kind), training.group_name].filter(Boolean).join(' · ');
  const meta = [i18n.formatDate(`${training.local_date}T12:00:00`, { weekday: 'short', day: 'numeric', month: 'short' }),
    i18n.formatDuration(training.duration_minutes),
    training.kind === 'group' ? i18n.t('today.attended', { count: training.attendee_count }) : null].filter(Boolean).join(' · ');
  const card = el(document, 'button', { className: 'card recent-card', attrs: { type: 'button' },
    on: { click: () => ctx.navigate(`/training/${training.occurrence_id}`) } }, [
    el(document, 'div', { className: 'recent-head' }, [el(document, 'strong', { text: title }),
      resourceIcons(document, i18n, training.resource_kinds ?? [])]),
    el(document, 'div', { className: 'muted', text: meta }),
    el(document, 'div', { className: 'recent-text', text: clipText(training.first_round_text) }),
  ]);
  if (training.felt) {
    card.append(el(document, 'span', { className: 'felt', text: i18n.t('today.felt', { difficulty: i18n.t(`training.${training.felt}`) }) }));
  }
  return card;
}

export async function renderToday(ctx) {
  const { document, i18n, profile } = ctx;
  const todayIso = ctx.today();
  const screen = el(document, 'section', { className: 'screen screen-today' });
  const avatar = el(document, 'a', { className: 'me-avatar small', text: initials(profile.display_name), attrs: { href: '#/me', 'aria-label': i18n.t('app.me') } });
  screen.append(pageHeader({ document, title: i18n.t('app.today'), actions: [avatar] }));
  let calendarItems;
  let recent;
  try {
    const range = weekRange(todayIso);
    [calendarItems, recent] = await Promise.all([
      ctx.services.training.listCalendar({ start: range.start, endExclusive: range.endExclusive }),
      ctx.services.training.listRecentTrainings(10),
    ]);
  } catch (error) {
    screen.append(el(document, 'p', { className: 'muted', text: error?.message || i18n.t('app.loadError') }),
      el(document, 'button', { className: 'button-secondary', text: i18n.t('app.retry'), attrs: { type: 'button' }, dataset: { action: 'retry' },
        on: { click: async () => screen.replaceWith(await renderToday(ctx)) } }));
    return screen;
  }
  const trainedDays = new Set(calendarItems.filter(({ item_type: type }) => type === 'completed').map(({ local_date: date }) => date));
  screen.append(el(document, 'div', { className: 'week-strip' }, weekDays(todayIso).map((day) => el(document, 'button', {
    className: 'week-day', attrs: { type: 'button', 'aria-current': day.isToday ? 'date' : null,
      'aria-label': i18n.formatDate(`${day.date}T12:00:00`, { weekday: 'long', day: 'numeric', month: 'long' }) },
    dataset: { day: day.date }, on: { click: () => ctx.navigate(`/calendar/${day.date}`) },
  }, [el(document, 'span', { className: 'week-name', text: i18n.formatDate(`${day.date}T12:00:00`, { weekday: 'narrow' }) }),
    el(document, 'span', { text: String(day.day) }),
    trainedDays.has(day.date) ? el(document, 'span', { className: 'week-dot', attrs: { 'aria-hidden': 'true' } }) : null]))));
  const card = nowNextCard({ calendarItems, recent, profileId: profile.id, now: ctx.now() });
  if (card) screen.append(nowCard(ctx, card));
  screen.append(el(document, 'h2', { className: 'section-label', text: i18n.t('today.recent') }));
  if (!recent.length) screen.append(el(document, 'p', { className: 'card muted empty-card', text: i18n.t('today.empty') }));
  else screen.append(el(document, 'div', { className: 'recent-list' }, recent.map((training) => recentCard(ctx, training))));
  return screen;
}
```

Append to `assets/app.css`:

```css
/* Today */
.me-avatar.small { width: 34px; height: 34px; font-size: .8rem; text-decoration: none; }
.week-strip { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; margin-bottom: 14px; }
.week-day { display: grid; justify-items: center; gap: 2px; padding: 6px 0; border: 0; border-radius: 12px; background: var(--card); cursor: pointer; }
.week-day[aria-current="date"] { background: var(--gold); color: var(--bg); font-weight: 700; }
.week-name { font-size: .65rem; opacity: .8; }
.week-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); }
.now-card { border-color: var(--gold); background: linear-gradient(135deg, #3a2a15, var(--card)); margin-bottom: 8px; }
.now-card h2 { margin: 2px 0 4px; font-size: 1.2rem; }
.recent-list { display: grid; gap: 8px; }
.recent-card { display: grid; gap: 4px; text-align: left; width: 100%; cursor: pointer; }
.recent-head { display: flex; justify-content: space-between; gap: 8px; }
.recent-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: .9rem; }
.recent-card .felt { justify-self: start; }
.empty-card { text-align: center; border-style: dashed; }
```

- [ ] **Step 5: Run unit tests**

Run: `npx vitest run tests/unit/today-state.test.js tests/unit/today-screen.test.js tests/unit/dashboard-i18n.test.js`
Expected: PASS.

- [ ] **Step 6: Write the browser test**

```js
// tests/e2e/app-today.spec.js
import { expect, test } from '@playwright/test';

test('Today shows the demo week, recent trainings, and opens one', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
  await page.goto('/app?demo=1');
  await expect(page.locator('.week-day')).toHaveCount(7);
  const first = page.locator('.recent-card').first();
  await expect(first).toBeVisible();
  const box = await first.boundingBox();
  expect(box.width).toBeLessThanOrEqual(page.viewportSize().width);
  await first.click();
  await expect(page).toHaveURL(/#\/training\//);
});
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/screens/today-state.js src/app/screens/today.js src/app/dashboard-i18n.js assets/app.css tests/unit/today-state.test.js tests/unit/today-screen.test.js tests/e2e/app-today.spec.js
git commit -m "feat: add the Today screen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Calendar

**Files:**
- Replace: `src/app/screens/calendar.js`
- Modify: `src/app/dashboard-i18n.js`, `assets/app.css`
- Test: `tests/unit/calendar-screen.test.js`, `tests/e2e/app-calendar.spec.js`

**Interfaces:**
- Consumes: `calendarGrid`, `monthBounds`, `shiftMonth` from `training-calendar-state.js`; `listCalendar`, `listResourceKinds`; `ctx.openSheet`; `kindLabel`.
- Produces: `renderCalendar(ctx, route)` — month from `route.params.month` (default the month of `ctx.today()`); when `route.params.day` is set, the day sheet opens after load.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/calendar-screen.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { renderCalendar } from '../../src/app/screens/calendar.js';
import { openSheet } from '../../src/app/shell/sheet.js';

function ctx(training) {
  return {
    document, i18n: createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } }),
    profile: { id: 'me' }, timezone: 'UTC', services: { training }, navigate: vi.fn(),
    today: () => '2026-10-11', openSheet: (options) => openSheet({ document, ...options }),
  };
}

const items = [
  { item_id: 'o1', item_type: 'completed', status: 'completed', kind: 'group', local_date: '2026-10-09', starts_at: '2026-10-09T19:00:00Z', duration_minutes: 86, group_name: 'Grupo Lua' },
  { item_id: 'o2', item_type: 'completed', status: 'completed', kind: 'alone', local_date: '2026-10-09', starts_at: '2026-10-09T07:30:00Z', duration_minutes: 45 },
  { item_id: 's1', item_type: 'scheduled', status: 'scheduled', kind: 'group', local_date: '2026-10-15', starts_at: '2026-10-15T19:00:00Z', duration_minutes: 60, coach_profile_id: 'other' },
];

describe('calendar screen', () => {
  it('shows the full month with typed dots and opens a day sheet', async () => {
    const training = {
      listCalendar: vi.fn().mockResolvedValue(items),
      listResourceKinds: vi.fn().mockResolvedValue([{ occurrence_id: 'o1', kinds: ['summary', 'video'] }]),
    };
    const context = ctx(training);
    const view = await renderCalendar(context, { name: 'calendar', params: { month: null, day: null } });
    document.body.replaceChildren(view);
    expect(view.querySelector('h1').textContent).toBe('October 2026');
    expect(view.querySelectorAll('.cal-day')).toHaveLength(35);
    expect(view.querySelectorAll('[data-date="2026-10-09"] .cal-dot')).toHaveLength(2);
    expect(view.querySelector('[data-date="2026-10-15"] .cal-dot.upcoming')).not.toBeNull();
    expect(view.querySelector('[data-date="2026-10-11"]').getAttribute('aria-current')).toBe('date');
    view.querySelector('[data-date="2026-10-09"]').click();
    const sheet = document.querySelector('[role="dialog"]');
    expect(sheet.getAttribute('aria-label')).toContain('October 9');
    expect(sheet.querySelectorAll('.day-item')).toHaveLength(2);
    expect(sheet.querySelectorAll('.day-item')[1].querySelector('.resource-icons').textContent).toBe('🎥📄');
    sheet.querySelector('.day-item').click();
    expect(context.navigate).toHaveBeenCalledWith('/training/o2');
  });

  it('opens the requested day and moves between months', async () => {
    const training = { listCalendar: vi.fn().mockResolvedValue(items), listResourceKinds: vi.fn().mockResolvedValue([]) };
    const context = ctx(training);
    const view = await renderCalendar(context, { name: 'calendar', params: { month: '2026-10', day: '09' } });
    document.body.replaceChildren(view);
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    view.querySelector('button[aria-label="Next month"]').click();
    expect(context.navigate).toHaveBeenCalledWith('/calendar/2026-11');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/calendar-screen.test.js`
Expected: FAIL — the stub renders a placeholder.

- [ ] **Step 3: Add i18n keys**

`en`: `'cal.previous': 'Previous month'`, `'cal.next': 'Next month'`, `'cal.empty': 'Nothing on this day.'`, `'cal.upcoming': 'Upcoming'`.
`pt`: `'cal.previous': 'Mês anterior'`, `'cal.next': 'Mês seguinte'`, `'cal.empty': 'Nada neste dia.'`, `'cal.upcoming': 'Próximo'`.

- [ ] **Step 4: Implement**

```js
// src/app/screens/calendar.js
import { calendarGrid, monthBounds, shiftMonth } from '../training-calendar-state.js';
import { el, pageHeader } from '../shell/page.js';
import { resourceIcons } from '../ui/resource-view.js';
import { kindLabel } from './today-state.js';

function dayItem(ctx, item, kinds) {
  const { document, i18n } = ctx;
  const upcoming = item.item_type !== 'completed';
  const time = new Intl.DateTimeFormat(i18n.locale() === 'pt' ? 'pt-PT' : 'en-US', {
    hour: '2-digit', minute: '2-digit', timeZone: ctx.timezone,
  }).format(new Date(item.starts_at));
  const title = [kindLabel(i18n, item.kind), item.group_name].filter(Boolean).join(' · ');
  const meta = [time, i18n.formatDuration(item.duration_minutes), upcoming ? i18n.t('cal.upcoming') : null].filter(Boolean).join(' · ');
  const target = upcoming
    ? (item.coach_profile_id === ctx.profile.id ? `/class/${item.item_id}` : null)
    : `/training/${item.item_id}`;
  const node = el(document, target ? 'button' : 'div', {
    className: `card day-item${upcoming ? ' upcoming' : ''}`, attrs: target ? { type: 'button' } : {},
    on: target ? { click: () => { ctx.navigate(target); } } : {},
  }, [el(document, 'div', {}, [el(document, 'strong', { text: title }), el(document, 'div', { className: 'muted', text: meta })]),
    resourceIcons(document, i18n, kinds.get(item.item_id) ?? [])]);
  return node;
}

export async function renderCalendar(ctx, route) {
  const { document, i18n } = ctx;
  const month = route.params.month ?? ctx.today().slice(0, 7);
  const bounds = monthBounds(month);
  const screen = el(document, 'section', { className: 'screen screen-calendar' });
  const title = i18n.formatDate(`${month}-15T12:00:00`, { month: 'long', year: 'numeric' });
  screen.append(pageHeader({ document, title, actions: [
    el(document, 'button', { className: 'icon-button', text: '‹', attrs: { type: 'button', 'aria-label': i18n.t('cal.previous') },
      on: { click: () => ctx.navigate(`/calendar/${shiftMonth(month, -1)}`) } }),
    el(document, 'button', { className: 'icon-button', text: '›', attrs: { type: 'button', 'aria-label': i18n.t('cal.next') },
      on: { click: () => ctx.navigate(`/calendar/${shiftMonth(month, 1)}`) } }),
  ] }));
  let items;
  let kinds;
  try {
    const [rows, kindRows] = await Promise.all([
      ctx.services.training.listCalendar({ start: bounds.start, endExclusive: bounds.endExclusive }),
      ctx.services.training.listResourceKinds({ start: bounds.start, endExclusive: bounds.endExclusive }).catch(() => []),
    ]);
    items = rows;
    kinds = new Map(kindRows.map((row) => [row.occurrence_id, row.kinds]));
  } catch (error) {
    screen.append(el(document, 'p', { className: 'muted', text: error?.message || i18n.t('app.loadError') }));
    return screen;
  }
  const byDate = new Map();
  for (const item of items) byDate.set(item.local_date, [...(byDate.get(item.local_date) ?? []), item]);
  const todayIso = ctx.today();

  function openDay(date) {
    const dayItems = (byDate.get(date) ?? []).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const content = el(document, 'div', { className: 'day-items' }, dayItems.length
      ? dayItems.map((item) => dayItem(ctx, item, kinds))
      : [el(document, 'p', { className: 'muted', text: i18n.t('cal.empty') })]);
    ctx.openSheet({ title: i18n.formatDate(`${date}T12:00:00`, { weekday: 'long', month: 'long', day: 'numeric' }), content });
  }

  const weekdayFormatter = new Intl.DateTimeFormat(i18n.locale() === 'pt' ? 'pt-PT' : 'en-US', { weekday: 'narrow', timeZone: 'UTC' });
  const grid = el(document, 'div', { className: 'cal-grid', attrs: { role: 'grid', 'aria-label': title } });
  for (let index = 0; index < 7; index += 1) {
    grid.append(el(document, 'span', { className: 'cal-weekday', text: weekdayFormatter.format(new Date(Date.UTC(2026, 5, 1 + index))), attrs: { role: 'columnheader' } }));
  }
  for (const day of calendarGrid(month)) {
    const dayItems = byDate.get(day.date) ?? [];
    const label = [i18n.formatDate(`${day.date}T12:00:00`, { dateStyle: 'long' }),
      ...dayItems.map((item) => kindLabel(i18n, item.kind))].join(' · ');
    grid.append(el(document, 'button', {
      className: `cal-day${day.inMonth ? '' : ' outside'}`,
      attrs: { type: 'button', role: 'gridcell', 'aria-label': label, 'aria-current': day.date === todayIso ? 'date' : null },
      dataset: { date: day.date }, on: { click: () => openDay(day.date) },
    }, [el(document, 'span', { text: String(day.day) }),
      el(document, 'span', { className: 'cal-dots' }, dayItems.map((item) => el(document, 'i', {
        className: `cal-dot ${item.kind}${item.item_type === 'completed' ? '' : ' upcoming'}`,
      })))]));
  }
  let startX = null;
  grid.addEventListener('pointerdown', (event) => { startX = event.clientX; });
  grid.addEventListener('pointerup', (event) => {
    if (startX !== null && Math.abs(event.clientX - startX) > 60) {
      ctx.navigate(`/calendar/${shiftMonth(month, event.clientX < startX ? 1 : -1)}`);
    }
    startX = null;
  });
  screen.append(grid, el(document, 'p', { className: 'cal-legend muted' }, [
    ['alone', 'training.alone'], ['group', 'training.group'], ['personal_class', 'training.personalClass'],
  ].map(([kind, key]) => el(document, 'span', {}, [el(document, 'i', { className: `cal-dot ${kind}` }), ` ${i18n.t(key)}`]))));
  if (route.params.day) setTimeout(() => { if (screen.isConnected) openDay(`${month}-${route.params.day}`); }, 0);
  return screen;
}
```

Append to `assets/app.css`:

```css
/* Calendar */
.icon-button { border: 1px solid var(--line); background: var(--card); border-radius: 50%; width: 38px; height: 38px; font-size: 1.3rem; cursor: pointer; }
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; touch-action: pan-y; }
.cal-weekday { text-align: center; color: var(--muted); font-size: .7rem; padding: 4px 0; }
.cal-day { aspect-ratio: 1 / 1.05; border: 0; border-radius: 10px; background: var(--card); display: grid; align-content: start; justify-items: center; padding-top: 6px; gap: 4px; cursor: pointer; }
.cal-day.outside { opacity: .3; }
.cal-day[aria-current="date"] { outline: 2px solid var(--gold); }
.cal-dots { display: flex; gap: 3px; flex-wrap: wrap; justify-content: center; }
.cal-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; }
.cal-dot.alone { background: var(--gold); } .cal-dot.group { background: var(--teal); } .cal-dot.personal_class { background: var(--violet); }
.cal-dot.upcoming { background: transparent; border: 1.5px solid var(--teal); }
.cal-legend { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 12px; }
.day-items { display: grid; gap: 8px; margin-top: 10px; }
.day-item { display: flex; justify-content: space-between; align-items: center; gap: 10px; text-align: left; width: 100%; }
button.day-item { cursor: pointer; }
.day-item.upcoming { border-style: dashed; }
```

- [ ] **Step 5: Write the browser test**

```js
// tests/e2e/app-calendar.spec.js
import { expect, test } from '@playwright/test';

test('Calendar shows the full month and opens a day', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
  await page.goto('/app?demo=1#/calendar');
  await expect(page.getByRole('heading', { name: 'October 2026' })).toBeVisible();
  await expect(page.locator('.cal-day')).toHaveCount(35);
  const day = page.locator('.cal-day:has(.cal-dot:not(.upcoming))').first();
  await day.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.locator('.day-item').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.getByRole('heading', { name: 'November 2026' })).toBeVisible();
});
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/screens/calendar.js src/app/dashboard-i18n.js assets/app.css tests/unit/calendar-screen.test.js tests/e2e/app-calendar.spec.js
git commit -m "feat: add the Calendar screen with day sheets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Training page

**Files:**
- Create: `src/app/screens/youtube.js`; replace `src/app/screens/training.js`
- Modify: `src/app/dashboard-i18n.js`, `assets/app.css`
- Test: `tests/unit/youtube.test.js`, `tests/unit/training-screen.test.js`, `tests/e2e/app-training.spec.js`

**Interfaces:**
- Consumes: `getTraining` (Task 1), `saveRoundAssessments`, `saveNotes`, `createRoundDetail`, `createResourceSection`, `renderMarkdown`, `ctx.openSheet`.
- Produces: `youtubeId(url) → string|null`, `youtubeEmbedUrl(url) → string|null` (`https://www.youtube-nocookie.com/embed/<id>`); `renderTraining(ctx, route)`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/youtube.test.js
import { describe, expect, it } from 'vitest';

import { youtubeEmbedUrl, youtubeId } from '../../src/app/screens/youtube.js';

describe('youtube links', () => {
  it.each([
    ['https://www.youtube.com/watch?v=oMmctHNRyBg', 'oMmctHNRyBg'],
    ['https://youtu.be/VAI3JUKTwz0', 'VAI3JUKTwz0'],
    ['https://youtube.com/shorts/VAI3JUKTwz0?feature=share', 'VAI3JUKTwz0'],
    ['https://www.youtube.com/embed/oMmctHNRyBg', 'oMmctHNRyBg'],
    ['https://m.youtube.com/watch?v=oMmctHNRyBg&t=30', 'oMmctHNRyBg'],
    ['https://vimeo.com/123', null],
    ['https://youtube.com/watch?v=bad', null],
    ['not a url', null],
  ])('reads %s', (url, id) => {
    expect(youtubeId(url)).toBe(id);
  });

  it('builds privacy-enhanced embed URLs', () => {
    expect(youtubeEmbedUrl('https://youtu.be/VAI3JUKTwz0')).toBe('https://www.youtube-nocookie.com/embed/VAI3JUKTwz0');
    expect(youtubeEmbedUrl('https://vimeo.com/1')).toBeNull();
  });
});
```

```js
// tests/unit/training-screen.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { renderTraining } from '../../src/app/screens/training.js';
import { openSheet } from '../../src/app/shell/sheet.js';
import { AppError } from '../../src/app/errors.js';

const base = {
  occurrence_id: 'o1', kind: 'group', local_date: '2026-09-26', timezone: 'Europe/Lisbon',
  occurred_at: '2026-09-26T13:19:30Z', duration_minutes: 86, group_name: 'Grupo Lua', coach_name: 'João',
  attendee_count: 6, role: 'participant', participation: { id: 'p1', personal_notes: 'Knees ok', duration_minutes: 86 },
  rounds: [
    { id: 'r1', source_text: 'ginga 10 min', sequence: [], ratings: [], planned: [], movements: [] },
    { id: 'r2', source_text: '10x (armada, au)', sequence: [], ratings: [{ segment_key: 'r', segment_kind: 'round', difficulty: 'hard' }], planned: [], movements: [] },
  ],
  feedback: [{ id: 'f1', coach_name: 'João', body: 'Loose shoulders.' }],
  resources: [
    { id: 'v', kind: 'video', title: 'Recording', url: 'https://youtu.be/VAI3JUKTwz0', body: null, can_edit: false },
    { id: 's', kind: 'summary', title: null, url: null, body: '# Class 1', can_edit: false },
  ],
  can_add_resources: false,
};

function ctx(training) {
  return {
    document, i18n: createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } }),
    profile: { id: 'me' }, timezone: 'Europe/Lisbon', services: { training }, navigate: vi.fn(), back: vi.fn(),
    getTermMappings: () => [], openSheet: (options) => openSheet({ document, ...options }),
  };
}

describe('training screen', () => {
  it('puts the video first and always shows time, duration, and attendees', async () => {
    const view = await renderTraining(ctx({ getTraining: vi.fn().mockResolvedValue(base) }), { params: { id: 'o1' } });
    document.body.replaceChildren(view);
    expect(view.querySelector('iframe').getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/VAI3JUKTwz0');
    expect(view.querySelector('h1').textContent).toBe('Group · Grupo Lua');
    expect(view.querySelector('.training-meta').textContent).toContain('João');
    expect([...view.querySelectorAll('.tag')].map((tag) => tag.textContent)).toEqual(['⏱ 1h 26m', '👥 6 attended']);
    expect([...view.querySelectorAll('.chapter')].map((row) => row.textContent)).toEqual(['1ginga 10 min', '210x (armada, au)felt Hard']);
    expect(view.textContent).toContain('Knees ok');
    expect(view.textContent).toContain('Loose shoulders.');
    view.querySelector('button[data-resource="s"]').click();
    expect(document.querySelector('[role="dialog"] .resource-markdown h1').textContent).toBe('Class 1');
  });

  it('works without a video', async () => {
    const training = { ...base, kind: 'alone', group_name: null, attendee_count: 1, resources: [] };
    const view = await renderTraining(ctx({ getTraining: vi.fn().mockResolvedValue(training) }), { params: { id: 'o1' } });
    expect(view.querySelector('iframe')).toBeNull();
    expect(view.querySelector('h1').textContent).toBe('Alone');
    expect([...view.querySelectorAll('.tag')].map((tag) => tag.textContent)).toEqual(['⏱ 1h 26m']);
  });

  it('rates rounds and saves notes from the bottom bar', async () => {
    const training = {
      getTraining: vi.fn().mockResolvedValue(base),
      saveRoundAssessments: vi.fn().mockResolvedValue({ status: 'saved' }),
      saveNotes: vi.fn().mockResolvedValue({ status: 'saved' }),
    };
    const view = await renderTraining(ctx(training), { params: { id: 'o1' } });
    document.body.replaceChildren(view);
    view.querySelector('button[data-action="rate"]').click();
    const form = document.querySelector('[role="dialog"] [data-round-rating-form="r1"]');
    form.querySelector('input[value="easy"]').click();
    form.requestSubmit();
    await vi.waitFor(() => expect(training.saveRoundAssessments).toHaveBeenCalledWith(expect.objectContaining({ participationId: 'p1', roundId: 'r1' })));
    view.querySelector('button[data-action="notes"]').click();
    const notes = document.querySelector('[role="dialog"] textarea');
    notes.value = 'Better hips';
    document.querySelector('[role="dialog"] form').requestSubmit();
    await vi.waitFor(() => expect(training.saveNotes).toHaveBeenCalledWith({ participationId: 'p1', notes: 'Better hips' }));
  });

  it('explains a training that is not available', async () => {
    const training = { getTraining: vi.fn().mockRejectedValue(new AppError('authorization', 'not_authorized')) };
    const context = ctx(training);
    const view = await renderTraining(context, { params: { id: 'someone-else' } });
    expect(view.textContent).toContain("This training isn't available.");
    view.querySelector('button[aria-label="Back"]').click();
    expect(context.back).toHaveBeenCalledWith('/');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/youtube.test.js tests/unit/training-screen.test.js`
Expected: FAIL.

- [ ] **Step 3: Add i18n keys**

`en`:

```js
    'trainingPage.unavailable': "This training isn't available.",
    'trainingPage.rounds': 'Rounds',
    'trainingPage.notes': 'Notes',
    'trainingPage.feedback': 'Coach feedback',
    'trainingPage.rate': 'Rate',
    'trainingPage.editNotes': 'Notes',
    'trainingPage.add': 'Add',
    'trainingPage.saveNotes': 'Save notes',
    'trainingPage.notesSaved': 'Notes saved.',
    'trainingPage.recording': 'Recording',
    'trainingPage.openVideo': 'Open video',
    'trainingPage.with': 'with {name}',
```

`pt`:

```js
    'trainingPage.unavailable': 'Este treino não está disponível.',
    'trainingPage.rounds': 'Rondas',
    'trainingPage.notes': 'Notas',
    'trainingPage.feedback': 'Feedback do treinador',
    'trainingPage.rate': 'Avaliar',
    'trainingPage.editNotes': 'Notas',
    'trainingPage.add': 'Adicionar',
    'trainingPage.saveNotes': 'Guardar notas',
    'trainingPage.notesSaved': 'Notas guardadas.',
    'trainingPage.recording': 'Gravação',
    'trainingPage.openVideo': 'Abrir vídeo',
    'trainingPage.with': 'com {name}',
```

- [ ] **Step 4: Implement**

```js
// src/app/screens/youtube.js
const ID = /^[A-Za-z0-9_-]{11}$/;

export function youtubeId(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^(www|m)\./, '');
  let id = null;
  if (host === 'youtu.be') id = parsed.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (parsed.pathname === '/watch') id = parsed.searchParams.get('v');
    else id = parsed.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/)?.[1] ?? null;
  }
  return id && ID.test(id) ? id : null;
}

export function youtubeEmbedUrl(url) {
  const id = youtubeId(url);
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}
```

```js
// src/app/screens/training.js
import { renderMarkdown } from '../markdown-lite.js';
import { el, pageHeader } from '../shell/page.js';
import { createResourceSection, RESOURCE_ICONS } from '../ui/resource-view.js';
import { createRoundDetail } from '../ui/round-detail.js';
import { kindLabel } from './today-state.js';
import { youtubeEmbedUrl } from './youtube.js';

function roundText(round) {
  return round.source_text || (round.movements ?? []).map((movement) => (
    movement.repetitions ? `${movement.repetitions}x ${movement.movement_name}` : movement.movement_name
  )).join(', ');
}

function titleFor(i18n, training) {
  const second = training.group_name
    ?? (training.student_name ? i18n.t('trainingPage.with', { name: training.student_name }) : null);
  return [kindLabel(i18n, training.kind), second].filter(Boolean).join(' · ');
}

export async function renderTraining(ctx, route) {
  const { document, i18n } = ctx;
  const screen = el(document, 'section', { className: 'screen screen-training' });
  const back = () => ctx.back('/');
  let training;
  try {
    training = await ctx.services.training.getTraining(route.params.id);
  } catch (error) {
    const unavailable = error?.kind === 'authorization' || error?.kind === 'validation';
    screen.append(pageHeader({ document, title: '', backLabel: i18n.t('app.back'), onBack: back }),
      el(document, 'p', { className: 'muted', text: unavailable ? i18n.t('trainingPage.unavailable') : (error?.message || i18n.t('app.loadError')) }));
    return screen;
  }
  const reload = async () => screen.replaceWith(await renderTraining(ctx, route));
  screen.append(pageHeader({ document, title: '', backLabel: i18n.t('app.back'), onBack: back }));

  const video = training.resources.find(({ kind, url }) => kind === 'video' && youtubeEmbedUrl(url));
  if (video) {
    screen.append(el(document, 'figure', { className: 'training-video' }, [
      el(document, 'iframe', { attrs: {
        src: youtubeEmbedUrl(video.url), title: video.title || i18n.t('trainingPage.recording'), loading: 'lazy',
        allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen', allowfullscreen: true,
        referrerpolicy: 'strict-origin-when-cross-origin',
      } }),
      el(document, 'figcaption', { className: 'muted', text: video.title || i18n.t('trainingPage.recording') }),
    ]));
  }
  const time = new Intl.DateTimeFormat(i18n.locale() === 'pt' ? 'pt-PT' : 'en-US', {
    hour: '2-digit', minute: '2-digit', timeZone: training.timezone || ctx.timezone,
  }).format(new Date(training.occurred_at));
  const meta = [i18n.formatDate(`${training.local_date}T12:00:00`, { weekday: 'short', day: 'numeric', month: 'short' }),
    time, training.kind === 'alone' ? null : training.coach_name].filter(Boolean).join(' · ');
  screen.append(el(document, 'h1', { className: 'training-title', text: titleFor(i18n, training) }),
    el(document, 'p', { className: 'training-meta muted', text: meta }));
  const tags = el(document, 'div', { className: 'training-tags' }, [
    el(document, 'span', { className: 'tag', text: `⏱ ${i18n.formatDuration(training.duration_minutes)}` }),
    training.kind === 'group' ? el(document, 'span', { className: 'tag', text: `👥 ${i18n.t('today.attended', { count: training.attendee_count })}` }) : null,
  ]);
  screen.append(tags);

  if (training.resources.length) {
    screen.append(el(document, 'div', { className: 'resource-buttons' }, training.resources.map((resource) => el(document, 'button', {
      className: 'button-secondary', text: `${RESOURCE_ICONS[resource.kind]} ${resource.title || i18n.t(`resources.${resource.kind}`)}`,
      attrs: { type: 'button' }, dataset: { resource: resource.id },
      on: { click: () => {
        if (resource.kind === 'video') {
          if (resource === video) screen.querySelector('.training-video')?.scrollIntoView({ behavior: 'smooth' });
          else ctx.window?.open?.(resource.url, '_blank', 'noopener,noreferrer');
          return;
        }
        const body = resource.kind === 'summary'
          ? el(document, 'div', { className: 'resource-markdown' }, [renderMarkdown(document, resource.body)])
          : el(document, 'pre', { className: 'resource-transcript', text: resource.body });
        ctx.openSheet({ title: resource.title || i18n.t(`resources.${resource.kind}`), content: body });
      } },
    }))));
  }

  screen.append(el(document, 'h2', { className: 'section-label', text: i18n.t('trainingPage.rounds') }));
  screen.append(el(document, 'ol', { className: 'chapters' }, training.rounds.map((round, index) => {
    const felt = (round.ratings ?? []).find(({ segment_key: key }) => key === 'r');
    return el(document, 'li', { className: 'chapter' }, [
      el(document, 'span', { className: 'chapter-number', text: String(index + 1) }),
      el(document, 'span', { className: 'chapter-text', text: roundText(round) }),
      felt ? el(document, 'span', { className: 'felt', text: i18n.t('today.felt', { difficulty: i18n.t(`training.${felt.difficulty}`) }) }) : null,
    ]);
  })));

  if (training.participation?.personal_notes) {
    screen.append(el(document, 'h2', { className: 'section-label', text: i18n.t('trainingPage.notes') }),
      el(document, 'p', { className: 'training-notes', text: training.participation.personal_notes }));
  }
  if (training.feedback.length) {
    screen.append(el(document, 'h2', { className: 'section-label', text: i18n.t('trainingPage.feedback') }),
      ...training.feedback.map((entry) => el(document, 'blockquote', { className: 'feedback' }, [
        el(document, 'p', { text: entry.body }), el(document, 'cite', { className: 'muted', text: entry.coach_name ?? '' }),
      ])));
  }

  const actions = [];
  if (training.participation) {
    actions.push(el(document, 'button', { className: 'bar-main', text: `★ ${i18n.t('trainingPage.rate')}`, attrs: { type: 'button' }, dataset: { action: 'rate' },
      on: { click: () => {
        const content = el(document, 'div', { className: 'rate-rounds' }, training.rounds.map((round, index) => createRoundDetail({
          document, i18n, round, index, editable: true, getTermMappings: ctx.getTermMappings,
          onSave: (ratings) => ctx.services.training.saveRoundAssessments({ participationId: training.participation.id, roundId: round.id, ratings }),
        })));
        ctx.openSheet({ title: i18n.t('trainingPage.rate'), content, onClose: reload });
      } } }));
    actions.push(el(document, 'button', { text: `📝 ${i18n.t('trainingPage.editNotes')}`, attrs: { type: 'button' }, dataset: { action: 'notes' },
      on: { click: () => {
        const textarea = el(document, 'textarea', { className: 'field-input field-textarea', attrs: { 'aria-label': i18n.t('trainingPage.notes'), maxlength: '4000' } });
        textarea.value = training.participation.personal_notes ?? '';
        const status = el(document, 'p', { attrs: { role: 'status' } });
        const form = el(document, 'form', {}, [textarea, el(document, 'button', { className: 'button-primary', text: i18n.t('trainingPage.saveNotes'), attrs: { type: 'submit' } }), status]);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          try {
            await ctx.services.training.saveNotes({ participationId: training.participation.id, notes: textarea.value });
            status.textContent = i18n.t('trainingPage.notesSaved');
          } catch (error) {
            status.textContent = error?.message || i18n.t('training.saveError');
          }
        });
        ctx.openSheet({ title: i18n.t('trainingPage.notes'), content: form, onClose: reload });
      } } }));
  }
  if (training.can_add_resources) {
    actions.push(el(document, 'button', { text: `📎 ${i18n.t('trainingPage.add')}`, attrs: { type: 'button' }, dataset: { action: 'add' },
      on: { click: () => {
        const section = createResourceSection({ document, i18n, item: { ...training, resources: [] }, service: ctx.services.training, onChanged: async () => {} });
        ctx.openSheet({ title: i18n.t('resources.add'), content: section, onClose: reload });
        section.querySelector('[data-action="open-resources"]')?.click();
      } } }));
  }
  if (actions.length) screen.append(el(document, 'div', { className: 'training-bar' }, actions));
  return screen;
}
```

Append to `assets/app.css`:

```css
/* Training page */
.training-video { margin: 0 -16px 12px; }
.training-video iframe { width: 100%; aspect-ratio: 16 / 9; border: 0; display: block; background: #000; }
.training-video figcaption { padding: 6px 16px 0; }
.training-title { font: 800 1.35rem/1.15 var(--display); margin: 4px 0; }
.training-meta { margin: 0 0 6px; }
.training-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.resource-buttons { display: flex; flex-wrap: wrap; }
.chapters { list-style: none; margin: 0; padding: 0; }
.chapter { display: flex; gap: 10px; align-items: baseline; padding: 10px 0; border-bottom: 1px solid var(--line); }
.chapter-number { color: var(--gold); font-family: var(--mono); font-size: .8rem; width: 18px; flex: none; }
.chapter-text { flex: 1; }
.training-notes { white-space: pre-wrap; }
.feedback { margin: 8px 0; padding-left: 10px; border-left: 3px solid var(--gold); }
.feedback p { margin: 0 0 4px; }
.training-bar { position: sticky; bottom: 0; margin: 18px -16px 0; display: grid; grid-auto-flow: column; background: #1b150f; border-top: 1px solid var(--line); padding-bottom: var(--safe-bottom); }
.training-bar button { border: 0; background: transparent; padding: 16px 0; cursor: pointer; }
.training-bar .bar-main { color: var(--gold); font-weight: 700; }
.resource-transcript { white-space: pre-wrap; font: inherit; }
```

- [ ] **Step 5: Write the browser test**

```js
// tests/e2e/app-training.spec.js
import { expect, test } from '@playwright/test';

test('a group class page plays its recording and shows time and attendees', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
  await page.goto('/app?demo=1#/training/demo-group-1');
  await expect(page.locator('.tag').first()).toContainText('⏱');
  await expect(page.locator('.tag', { hasText: 'attended' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Class recording/ })).toBeVisible();
});

test('an unavailable training explains itself', async ({ page }) => {
  await page.goto('/app?demo=1#/training/not-mine');
  await expect(page.getByText("This training isn't available.")).toBeVisible();
});
```

The demo video resource uses `https://www.youtube.com/`, which has no video id, so the page shows the resource button instead of an embedded player; the unit test covers embedding.

- [ ] **Step 6: Run tests**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/screens/youtube.js src/app/screens/training.js src/app/dashboard-i18n.js assets/app.css tests/unit/youtube.test.js tests/unit/training-screen.test.js tests/e2e/app-training.spec.js
git commit -m "feat: add the video-first training page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Log training

**Files:**
- Create: `src/app/screens/log-draft.js`, `src/app/screens/chat-box.js`; replace `src/app/screens/log.js`
- Modify: `src/app/dashboard-i18n.js`, `assets/app.css`
- Test: `tests/unit/log-draft.test.js`, `tests/unit/chat-box.test.js`, `tests/unit/log-screen.test.js`, `tests/e2e/app-log.spec.js`

**Interfaces:**
- Consumes: `createRoundEditor`, `createMovePicker`, `splitRounds`, `normalizeResource`, `recordAloneTraining`, `addResource`, `createIdempotencyKey`, `repertoire.list`.
- Produces:
  - `loadDraft(storage, profileId) → draft|null`, `saveDraft(storage, profileId, draft)`, `clearDraft(storage, profileId)`; key `roda.logDraft:<profileId>`; `draft = { localDate, durationMinutes, rounds: [{ sourceText, ratings }], notes, resources: [{ kind, title, url, body }], idempotencyKey }`.
  - `createChatBox({ document, i18n, onSubmit }) → { element, insert(text), focus() }` — Enter sends, Shift+Enter adds a line, empty input does nothing.
  - `renderLog(ctx)`; after saving navigates to `/training/<occurrence_id>`; unsynced resources go to `roda.pendingResources:<occurrence_id>` (the training page's retry queue).

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/log-draft.test.js
import { describe, expect, it } from 'vitest';

import { clearDraft, loadDraft, saveDraft } from '../../src/app/screens/log-draft.js';

function storage() {
  const values = new Map();
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k), values };
}

describe('log draft', () => {
  it('saves, loads, and clears per profile', () => {
    const local = storage();
    const draft = { localDate: '2026-10-11', durationMinutes: 45, rounds: [{ sourceText: 'ginga', ratings: [] }], notes: '', resources: [], idempotencyKey: 'k' };
    saveDraft(local, 'p1', draft);
    expect(loadDraft(local, 'p1')).toEqual(draft);
    expect(loadDraft(local, 'p2')).toBeNull();
    clearDraft(local, 'p1');
    expect(loadDraft(local, 'p1')).toBeNull();
  });

  it('ignores broken or blocked storage', () => {
    const broken = { getItem: () => '{nope', setItem() { throw new Error('quota'); }, removeItem() { throw new Error('blocked'); } };
    expect(loadDraft(broken, 'p1')).toBeNull();
    expect(() => saveDraft(broken, 'p1', {})).not.toThrow();
    expect(() => clearDraft(broken, 'p1')).not.toThrow();
  });
});
```

```js
// tests/unit/chat-box.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { createChatBox } from '../../src/app/screens/chat-box.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

describe('chat box', () => {
  it('sends on Enter, keeps Shift+Enter, and ignores empty input', () => {
    const onSubmit = vi.fn();
    const box = createChatBox({ document, i18n, onSubmit });
    document.body.replaceChildren(box.element);
    const input = document.querySelector('textarea[aria-label="Write a round"]');
    input.value = '   ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(onSubmit).not.toHaveBeenCalled();
    input.value = 'ginga 10 min';
    const shift = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(shift);
    expect(shift.defaultPrevented).toBe(false);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(onSubmit).toHaveBeenCalledWith('ginga 10 min');
    expect(input.value).toBe('');
    box.insert('Armada');
    box.insert('Aú');
    expect(input.value).toBe('Armada, Aú');
    document.querySelector('button[aria-label="Add round"]').click();
    expect(onSubmit).toHaveBeenLastCalledWith('Armada, Aú');
  });
});
```

```js
// tests/unit/log-screen.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { renderLog } from '../../src/app/screens/log.js';
import { openSheet } from '../../src/app/shell/sheet.js';

function ctx(training, extra = {}) {
  return {
    document, window, i18n: createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } }),
    profile: { id: 'p1' }, timezone: 'Europe/Lisbon', services: { training, repertoire: { list: vi.fn().mockResolvedValue([{ id: 's1', title: 'Flow', source_text: '10x (armada, au)' }]) } },
    navigate: vi.fn(), back: vi.fn(), today: () => '2026-10-11', getTermMappings: () => [],
    openSheet: (options) => openSheet({ document, ...options }), ...extra,
  };
}

function send(text) {
  const input = document.querySelector('textarea[aria-label="Write a round"]');
  input.value = text;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

describe('log screen', () => {
  beforeEach(() => { localStorage.clear(); });

  it('turns chat messages into rounds and saves once', async () => {
    let finish;
    const training = {
      createIdempotencyKey: vi.fn(() => 'key-1'),
      recordAloneTraining: vi.fn(() => new Promise((resolve) => { finish = resolve; })),
      addResource: vi.fn().mockResolvedValue({ status: 'saved' }),
    };
    const context = ctx(training);
    const view = await renderLog(context);
    document.body.replaceChildren(view);
    send('ginga 10 min');
    send('Round 2: 10x (armada, au)\nRound 3: 3x negativa');
    expect([...document.querySelectorAll('textarea[data-round-text]')].map((input) => input.value))
      .toEqual(['ginga 10 min', '10x (armada, au)', '3x negativa']);
    document.querySelector('button[data-chip="yesterday"]').click();
    const save = document.querySelector('button[data-action="save"]');
    save.click();
    save.click();
    finish({ status: 'completed', occurrence_id: 'o1', participation_id: 'p' });
    await vi.waitFor(() => expect(context.navigate).toHaveBeenCalledWith('/training/o1'));
    expect(training.recordAloneTraining).toHaveBeenCalledTimes(1);
    expect(training.recordAloneTraining).toHaveBeenCalledWith(expect.objectContaining({
      localDate: '2026-10-10', durationMinutes: 45, idempotencyKey: 'key-1', timezone: 'Europe/Lisbon',
      rounds: [expect.objectContaining({ source_text: 'ginga 10 min' }), expect.anything(), expect.anything()],
    }));
    expect(localStorage.getItem('roda.logDraft:p1')).toBeNull();
  });

  it('restores a draft after reload with the same request key', async () => {
    const training = { createIdempotencyKey: vi.fn(() => 'key-1'), recordAloneTraining: vi.fn().mockRejectedValue(new Error('offline')) };
    let view = await renderLog(ctx(training));
    document.body.replaceChildren(view);
    send('ginga 10 min');
    await vi.waitFor(() => expect(localStorage.getItem('roda.logDraft:p1')).not.toBeNull());
    training.createIdempotencyKey.mockReturnValue('key-2');
    view = await renderLog(ctx(training));
    document.body.replaceChildren(view);
    expect(document.querySelector('textarea[data-round-text]').value).toBe('ginga 10 min');
    document.querySelector('button[data-action="save"]').click();
    await vi.waitFor(() => expect(document.querySelector('.log-status').textContent).toBe('offline'));
    expect(training.recordAloneTraining).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'key-1' }));
    expect(document.querySelector('textarea[data-round-text]').value).toBe('ginga 10 min');
  });

  it('refuses to save without rounds', async () => {
    const training = { createIdempotencyKey: vi.fn(() => 'k'), recordAloneTraining: vi.fn() };
    const view = await renderLog(ctx(training));
    document.body.replaceChildren(view);
    document.querySelector('button[data-action="save"]').click();
    expect(document.querySelector('.log-status').textContent).toBe('Write what you trained in at least one round.');
    expect(training.recordAloneTraining).not.toHaveBeenCalled();
  });

  it('adds resources and queues the ones that fail after saving', async () => {
    const training = {
      createIdempotencyKey: vi.fn(() => 'k'),
      recordAloneTraining: vi.fn().mockResolvedValue({ status: 'completed', occurrence_id: 'o7' }),
      addResource: vi.fn().mockResolvedValueOnce({ status: 'saved' }).mockRejectedValueOnce(new Error('offline')),
    };
    const context = ctx(training);
    const view = await renderLog(context);
    document.body.replaceChildren(view);
    send('ginga');
    document.querySelector('button[data-chip="link"]').click();
    let sheet = document.querySelector('[role="dialog"]');
    sheet.querySelector('input[name="url"]').value = 'https://youtu.be/VAI3JUKTwz0';
    sheet.querySelector('form').requestSubmit();
    document.querySelector('button[data-chip="summary"]').click();
    sheet = document.querySelector('[role="dialog"]');
    sheet.querySelector('textarea[name="body"]').value = '# Notes';
    sheet.querySelector('form').requestSubmit();
    expect([...document.querySelectorAll('.log-resource')].map((chip) => chip.textContent)).toEqual(['🎥 Video ×', '📄 Summary ×']);
    document.querySelector('button[data-action="save"]').click();
    await vi.waitFor(() => expect(context.navigate).toHaveBeenCalledWith('/training/o7'));
    expect(JSON.parse(localStorage.getItem('roda.pendingResources:o7'))).toEqual([
      { occurrenceId: 'o7', kind: 'summary', title: '', url: null, body: '# Notes' },
    ]);
  });

  it('inserts a saved sequence as a round', async () => {
    const view = await renderLog(ctx({ createIdempotencyKey: () => 'k' }));
    document.body.replaceChildren(view);
    document.querySelector('button[data-chip="saved"]').click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"] button[data-sequence="s1"]')).not.toBeNull());
    document.querySelector('[role="dialog"] button[data-sequence="s1"]').click();
    expect(document.querySelector('textarea[data-round-text]').value).toBe('10x (armada, au)');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/log-draft.test.js tests/unit/chat-box.test.js tests/unit/log-screen.test.js`
Expected: FAIL.

- [ ] **Step 3: Add i18n keys**

`en`:

```js
    'log.title': 'Log training',
    'log.today': 'Today',
    'log.yesterday': 'Yesterday',
    'log.date': 'Training date',
    'log.duration': 'Duration',
    'log.writeRound': 'Write a round',
    'log.placeholder': 'e.g. 10x (armada, aú, 3x ginga)',
    'log.addRound': 'Add round',
    'log.hint': 'Type what you trained below. Each message is a round.',
    'log.moves': 'Moves',
    'log.saved': 'Saved',
    'log.notes': 'Notes',
    'log.link': 'Link',
    'log.transcript': 'Transcript',
    'log.summary': 'Summary',
    'log.add': 'Add',
    'log.remove': 'Remove {name}',
    'log.save': 'Save',
    'log.saving': 'Saving…',
    'log.noSaved': 'No saved sequences yet.',
```

`pt`:

```js
    'log.title': 'Registar treino',
    'log.today': 'Hoje',
    'log.yesterday': 'Ontem',
    'log.date': 'Data do treino',
    'log.duration': 'Duração',
    'log.writeRound': 'Escreve uma ronda',
    'log.placeholder': 'ex.: 10x (armada, aú, 3x ginga)',
    'log.addRound': 'Adicionar ronda',
    'log.hint': 'Escreve em baixo o que treinaste. Cada mensagem é uma ronda.',
    'log.moves': 'Movimentos',
    'log.saved': 'Guardadas',
    'log.notes': 'Notas',
    'log.link': 'Link',
    'log.transcript': 'Transcrição',
    'log.summary': 'Resumo',
    'log.add': 'Adicionar',
    'log.remove': 'Remover {name}',
    'log.save': 'Guardar',
    'log.saving': 'A guardar…',
    'log.noSaved': 'Ainda não tens sequências guardadas.',
```

- [ ] **Step 4: Implement**

```js
// src/app/screens/log-draft.js
const key = (profileId) => `roda.logDraft:${profileId}`;

export function loadDraft(storage, profileId) {
  try {
    const value = JSON.parse(storage.getItem(key(profileId)) ?? 'null');
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export function saveDraft(storage, profileId, draft) {
  try {
    storage.setItem(key(profileId), JSON.stringify(draft));
  } catch {
    // Storage is a convenience; the composer keeps working without it.
  }
}

export function clearDraft(storage, profileId) {
  try {
    storage.removeItem(key(profileId));
  } catch {
    // Nothing to clear when storage is blocked.
  }
}
```

```js
// src/app/screens/chat-box.js
import { el } from '../shell/page.js';

export function createChatBox({ document, i18n, onSubmit }) {
  const input = el(document, 'textarea', { className: 'chat-input', attrs: {
    rows: '1', 'aria-label': i18n.t('log.writeRound'), placeholder: i18n.t('log.placeholder'), maxlength: '4000',
  } });
  function submit() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    onSubmit(text);
  }
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });
  const send = el(document, 'button', { className: 'chat-send', text: '↑', attrs: { type: 'button', 'aria-label': i18n.t('log.addRound') }, on: { click: submit } });
  return {
    element: el(document, 'div', { className: 'chat-box' }, [input, send]),
    insert(text) {
      const current = input.value.trim();
      input.value = current ? `${current}, ${text}` : text;
    },
    focus() { input.focus(); },
  };
}
```

```js
// src/app/screens/log.js
import { normalizeResource } from '../training-service.js';
import { splitRounds } from '../training-text-parser.js';
import { el, pageHeader } from '../shell/page.js';
import { createMovePicker } from '../ui/move-picker.js';
import { RESOURCE_ICONS } from '../ui/resource-view.js';
import { createRoundEditor } from '../ui/round-editor.js';
import { createChatBox } from './chat-box.js';
import { clearDraft, loadDraft, saveDraft } from './log-draft.js';

function addDaysIso(iso, amount) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

const DURATIONS = [15, 30, 45, 60, 75, 90, 120, 150, 180];

export async function renderLog(ctx) {
  const { document, window, i18n, profile } = ctx;
  const storage = window.localStorage;
  const training = ctx.services.training;
  const todayIso = ctx.today();
  const saved = loadDraft(storage, profile.id);
  const state = {
    localDate: saved?.localDate ?? todayIso,
    durationMinutes: saved?.durationMinutes ?? 45,
    notes: saved?.notes ?? '',
    resources: saved?.resources ?? [],
    idempotencyKey: saved?.idempotencyKey ?? training.createIdempotencyKey(),
  };
  let saving = false;
  let finished = false;

  const editor = createRoundEditor({ document, i18n, mode: 'record', getTermMappings: ctx.getTermMappings, showAddButton: false });
  editor.setRounds(saved?.rounds ?? []);
  const screen = el(document, 'section', { className: 'screen screen-log' });
  const status = el(document, 'p', { className: 'log-status', attrs: { role: 'status' } });

  function currentRounds() {
    return editor.getRounds().map((round) => ({ sourceText: round.source_text, ratings: round.ratings }));
  }
  let timer = null;
  function persist() {
    if (finished) return;
    clearTimeout(timer);
    timer = setTimeout(() => saveDraft(storage, profile.id, { ...state, rounds: currentRounds() }), 250);
  }
  function persistNow() {
    if (finished) return;
    clearTimeout(timer);
    saveDraft(storage, profile.id, { ...state, rounds: currentRounds() });
  }
  function addRounds(texts) {
    editor.setRounds([...currentRounds(), ...texts.map((sourceText) => ({ sourceText }))]);
    hint.hidden = true;
    persistNow();
  }

  const dateInput = el(document, 'input', { className: 'chip-input', attrs: { type: 'date', 'aria-label': i18n.t('log.date'), max: todayIso } });
  dateInput.value = state.localDate;
  const dateChips = [['today', todayIso], ['yesterday', addDaysIso(todayIso, -1)]].map(([name, value]) => el(document, 'button', {
    className: 'chip', text: i18n.t(`log.${name}`), attrs: { type: 'button' }, dataset: { chip: name },
  }));
  function syncDate() {
    dateChips[0].setAttribute('aria-pressed', String(state.localDate === todayIso));
    dateChips[1].setAttribute('aria-pressed', String(state.localDate === addDaysIso(todayIso, -1)));
    dateInput.value = state.localDate;
  }
  dateChips[0].addEventListener('click', () => { state.localDate = todayIso; syncDate(); persist(); });
  dateChips[1].addEventListener('click', () => { state.localDate = addDaysIso(todayIso, -1); syncDate(); persist(); });
  dateInput.addEventListener('change', () => { if (dateInput.value) state.localDate = dateInput.value; syncDate(); persist(); });
  syncDate();
  const duration = el(document, 'select', { className: 'chip-input', attrs: { 'aria-label': i18n.t('log.duration') } },
    [...new Set([...DURATIONS, state.durationMinutes])].sort((a, b) => a - b).map((minutes) => {
      const option = el(document, 'option', { text: i18n.formatDuration(minutes), attrs: { value: String(minutes) } });
      option.selected = minutes === state.durationMinutes;
      return option;
    }));
  duration.addEventListener('change', () => { state.durationMinutes = Number(duration.value); persist(); });

  const hint = el(document, 'p', { className: 'muted log-hint', text: i18n.t('log.hint') });
  hint.hidden = currentRounds().length > 0;
  const chat = createChatBox({ document, i18n, onSubmit: (text) => {
    const parts = splitRounds(text);
    addRounds(parts.length ? parts : [text]);
  } });

  const resourceList = el(document, 'div', { className: 'log-resources' });
  function renderResources() {
    resourceList.replaceChildren(...state.resources.map((resource, index) => {
      const name = i18n.t(`resources.${resource.kind}`);
      return el(document, 'button', { className: 'chip log-resource', text: `${RESOURCE_ICONS[resource.kind]} ${name} ×`,
        attrs: { type: 'button', 'aria-label': i18n.t('log.remove', { name }) },
        on: { click: () => { state.resources.splice(index, 1); renderResources(); persistNow(); } } });
    }));
  }
  renderResources();

  function resourceSheet(kind) {
    const fields = kind === 'video'
      ? [el(document, 'input', { className: 'field-input', attrs: { name: 'url', type: 'url', 'aria-label': i18n.t('resources.link'), placeholder: 'https://' } })]
      : [el(document, 'textarea', { className: 'field-input field-textarea', attrs: { name: 'body', 'aria-label': i18n.t('resources.text') } })];
    const title = el(document, 'input', { className: 'field-input', attrs: { name: 'title', 'aria-label': i18n.t('resources.itemTitle'), placeholder: i18n.t('resources.itemTitle') } });
    const error = el(document, 'p', { attrs: { role: 'status' } });
    const form = el(document, 'form', { className: 'log-resource-form' }, [...fields, title,
      el(document, 'button', { className: 'button-primary', text: i18n.t('log.add'), attrs: { type: 'submit' } }), error]);
    const sheet = ctx.openSheet({ title: i18n.t(`resources.${kind}`), content: form });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const resource = { kind, title: title.value.trim(), url: form.elements.url?.value ?? null, body: form.elements.body?.value ?? null };
      try {
        normalizeResource(resource);
      } catch (problem) {
        error.textContent = problem.message;
        return;
      }
      state.resources.push(resource);
      renderResources();
      persistNow();
      sheet.close();
    });
  }

  function notesSheet() {
    const textarea = el(document, 'textarea', { className: 'field-input field-textarea', attrs: { 'aria-label': i18n.t('log.notes'), maxlength: '4000' } });
    textarea.value = state.notes;
    textarea.addEventListener('input', () => { state.notes = textarea.value; persist(); });
    ctx.openSheet({ title: i18n.t('log.notes'), content: textarea });
  }

  function movesSheet() {
    const picker = createMovePicker({ document, i18n, onPick: (entry) => chat.insert(entry.name) });
    ctx.openSheet({ title: i18n.t('log.moves'), content: picker.element, onClose: () => chat.focus() });
  }

  async function savedSheet() {
    const list = el(document, 'div', { className: 'day-items' }, [el(document, 'p', { className: 'muted', text: i18n.t('app.loading') })]);
    const sheet = ctx.openSheet({ title: i18n.t('log.saved'), content: list });
    try {
      const items = await ctx.services.repertoire.list();
      list.replaceChildren(...(items.length ? items.map((item) => el(document, 'button', {
        className: 'card day-item', attrs: { type: 'button' }, dataset: { sequence: item.id },
        on: { click: () => { addRounds([item.source_text]); sheet.close(); } },
      }, [el(document, 'div', {}, [el(document, 'strong', { text: item.title }), el(document, 'div', { className: 'muted', text: item.source_text })])]))
        : [el(document, 'p', { className: 'muted', text: i18n.t('log.noSaved') })]));
    } catch (error) {
      list.replaceChildren(el(document, 'p', { className: 'muted', text: error?.message || i18n.t('app.loadError') }));
    }
  }

  const chips = el(document, 'div', { className: 'chip-row log-tools' }, [
    ['moves', `🥋 ${i18n.t('log.moves')}`, movesSheet], ['saved', `📚 ${i18n.t('log.saved')}`, savedSheet],
    ['notes', `📝 ${i18n.t('log.notes')}`, notesSheet], ['link', `🎥 ${i18n.t('log.link')}`, () => resourceSheet('video')],
    ['transcript', `🎙️ ${i18n.t('log.transcript')}`, () => resourceSheet('voice')], ['summary', `📄 ${i18n.t('log.summary')}`, () => resourceSheet('summary')],
  ].map(([name, text, action]) => el(document, 'button', { className: 'chip', text, attrs: { type: 'button' }, dataset: { chip: name }, on: { click: action } })));

  const saveButton = el(document, 'button', { className: 'button-primary log-save', text: i18n.t('log.save'), attrs: { type: 'button' }, dataset: { action: 'save' } });
  saveButton.addEventListener('click', async () => {
    if (saving) return;
    const rounds = editor.getRounds();
    if (!rounds.length) {
      status.textContent = i18n.t('alone.needRound');
      return;
    }
    saving = true;
    saveButton.disabled = true;
    saveButton.textContent = i18n.t('log.saving');
    status.textContent = '';
    persistNow();
    try {
      const result = await training.recordAloneTraining({
        localDate: state.localDate, timezone: ctx.timezone, durationMinutes: state.durationMinutes,
        notes: state.notes, rounds, idempotencyKey: state.idempotencyKey,
      });
      const pending = state.resources.map((resource) => ({ occurrenceId: result.occurrence_id, ...resource }));
      while (pending.length) {
        try {
          await training.addResource(pending[0]);
          pending.shift();
        } catch {
          try {
            storage.setItem(`roda.pendingResources:${result.occurrence_id}`, JSON.stringify(pending));
          } catch {
            // The training page shows nothing to retry when storage is blocked.
          }
          break;
        }
      }
      finished = true;
      clearTimeout(timer);
      clearDraft(storage, profile.id);
      ctx.navigate(`/training/${result.occurrence_id}`);
    } catch (error) {
      status.textContent = error?.message || i18n.t('alone.saveError');
    } finally {
      saving = false;
      saveButton.disabled = false;
      saveButton.textContent = i18n.t('log.save');
    }
  });

  screen.addEventListener('input', persist);
  screen.addEventListener('change', persist);
  screen.addEventListener('click', persist);
  screen.append(
    pageHeader({ document, title: i18n.t('log.title'), backLabel: i18n.t('app.close'), onBack: () => ctx.back('/') }),
    el(document, 'div', { className: 'chip-row' }, [...dateChips, dateInput, duration]),
    hint, editor.element, resourceList, chips, status,
    el(document, 'div', { className: 'log-dock' }, [chat.element, saveButton]),
  );
  return screen;
}
```

Append to `assets/app.css`:

```css
/* Log training */
.chip-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.chip { border: 1px solid var(--line); background: var(--card); border-radius: 999px; padding: 6px 12px; cursor: pointer; font-size: .85rem; }
.chip[aria-pressed="true"] { background: var(--gold); color: var(--bg); border-color: var(--gold); font-weight: 700; }
.chip-input { border: 1px solid var(--line); background: var(--card); color: var(--cream); border-radius: 999px; padding: 5px 10px; font: inherit; font-size: .85rem; }
.log-hint { text-align: center; padding: 18px; border: 1px dashed var(--line); border-radius: 14px; }
.log-resources { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
.log-tools { margin-top: 10px; }
.log-status:empty { display: none; }
.log-status { color: var(--clay); }
.log-dock { position: sticky; bottom: 0; margin: 12px -16px 0; padding: 10px 16px calc(10px + var(--safe-bottom)); background: #1b150f; border-top: 1px solid var(--line); display: grid; gap: 8px; }
.chat-box { display: flex; gap: 8px; align-items: flex-end; }
.chat-input { flex: 1; resize: none; max-height: 120px; border: 1px solid var(--line); background: var(--card); color: var(--cream); border-radius: 18px; padding: 10px 14px; font: inherit; }
.chat-send { width: 42px; height: 42px; border-radius: 50%; border: 0; background: var(--gold); color: var(--bg); font-weight: 800; font-size: 1.2rem; cursor: pointer; }
.log-save { width: 100%; margin: 0; }
.log-resource-form { display: grid; gap: 8px; margin-top: 10px; }
```

- [ ] **Step 5: Write the browser test**

```js
// tests/e2e/app-log.spec.js
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1', email: 'ana@example.com' } }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify({
      id: 'practitioner-1', display_name: 'Ana Silva', avatar_path: null,
      timezone_override: 'Europe/Lisbon', leaderboard_visible: true, completed_at: '2026-09-11T20:00:00Z',
    }));
  });
});

test('logs a training from the chat box and opens it', async ({ page }, testInfo) => {
  await page.goto('/app');
  if (testInfo.project.name.includes('mobile')) await page.getByRole('button', { name: 'Create' }).click();
  else await page.getByRole('button', { name: '+ Log training' }).click();
  const box = page.getByLabel('Write a round');
  await box.fill('ginga 10 min');
  await box.press('Enter');
  await box.fill('10x (armada, au)');
  await box.press('Enter');
  await expect(page.locator('textarea[data-round-text]')).toHaveCount(2);
  await page.locator('[data-round-difficulty]').nth(1).getByRole('radio', { name: 'Hard' }).check();
  await page.getByRole('button', { name: '🎥 Link' }).click();
  await page.getByRole('dialog').getByLabel('Link').fill('https://youtu.be/VAI3JUKTwz0');
  await page.getByRole('dialog').getByRole('button', { name: 'Add' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/training\//);
  await expect(page.locator('.training-video iframe')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/VAI3JUKTwz0');
  await expect(page.locator('.chapter')).toHaveCount(2);
  await expect(page.locator('.chapter').nth(1)).toContainText('felt Hard');
  await page.goto('/app#/');
  await expect(page.locator('.recent-card').first()).toContainText('🎥');
});

test('keeps a draft across reloads', async ({ page }) => {
  await page.goto('/app#/log');
  const box = page.getByLabel('Write a round');
  await box.fill('ginga 10 min');
  await box.press('Enter');
  await page.reload();
  await expect(page.locator('textarea[data-round-text]').first()).toHaveValue('ginga 10 min');
});
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/screens/log-draft.js src/app/screens/chat-box.js src/app/screens/log.js src/app/dashboard-i18n.js assets/app.css tests/unit/log-draft.test.js tests/unit/chat-box.test.js tests/unit/log-screen.test.js tests/e2e/app-log.spec.js
git commit -m "feat: add the Log training composer with a chat box

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Verification and docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document `/app`**

Add to `README.md` under "Training input":

```markdown
### The new app (`/app`)

A mobile-first version of the dashboard is being built at `/app`: Today,
Calendar, Log training, and the training page, with a bottom tab bar on phones
and a sidebar on desktop. It can be added to a phone's home screen. Sections
not rebuilt yet link to the classic dashboard at `/dashboard`.
```

- [ ] **Step 2: Run the full suites**

Run:

```bash
npm run test:unit
npm run test:db
npm run test:e2e
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: describe the new /app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
