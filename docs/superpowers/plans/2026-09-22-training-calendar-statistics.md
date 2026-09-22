# Training Calendar and Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a secure, bilingual, calendar-centered system for recording Alone training, arranging coach-led Group and Personal class training, tracking progress, and ranking active group members.

**Architecture:** Extend the existing Supabase foundation with explicit coaching connections, immutable plan versions, scheduled training, historical occurrence snapshots, and person-owned participation records. Keep database authorization and aggregation behind narrow RPCs, then compose focused relationship, calendar, coaching, and statistics controllers inside the existing dashboard shell.

**Tech Stack:** PostgreSQL/Supabase migrations and RLS, pgTAP, vanilla ES modules, `@supabase/supabase-js`, Vitest/jsdom, Playwright, HTML, and CSS.

**Spec:** `docs/superpowers/specs/2026-09-22-training-calendar-statistics-design.md`

## Global Constraints

- Use Node.js 22 for builds and JavaScript tests; the installed Playwright version requires Node.js 20 or newer.
- Add no runtime framework or calendar/chart dependency; use focused vanilla-JavaScript modules and semantic HTML.
- Preserve one profile per account with My Training and Coaching modes.
- Use exactly `alone`, `group`, and `personal_class` for persisted training kinds.
- Practitioners create Alone activity; authorized coaches arrange and confirm Group and Personal class activity.
- Store timestamps in UTC and preserve IANA timezone plus local date on schedules, occurrences, and participation.
- Weeks begin Monday; group ranking boundaries use the group's timezone.
- Published plan versions and completed occurrence snapshots are immutable.
- Statistics derive from confirmed participation; never accept totals calculated by the browser.
- Enforce privacy through database functions, grants, constraints, and RLS. Never place service-role credentials in browser code.
- Provide complete English and Portuguese strings for every new user-visible label, status, empty state, validation message, and accessible name.
- Preserve existing group hierarchy behavior: identifiable access applies only to the immediate parent at its configured sharing level and never cascades automatically.
- Run the production build after browser tests because the E2E build intentionally writes test-configured bundles to `assets/generated/`.

## Review Focus

1. **Mid-period membership changes:** a new member's earlier activity must remain absent from that group's ranking; Task 9 pins membership-interval filtering with a pgTAP result set.
2. **Timezone and daylight-saving boundaries:** calendar days and weekly ranges must remain stable across DST and midnight; Task 6 pins these cases in unit tests.
3. **Repeated completion submissions:** retries must not duplicate an occurrence or attendance; Task 4 pins schedule and participation uniqueness in pgTAP.
4. **Authorization revoked while a screen is open:** the next request must fail safely and clear private state; Tasks 2 and 8 pin the service error and controller clearing behavior.
5. **Partial group attendance writes:** one invalid attendee must roll back the entire completion; Task 4 pins the transactional failure and unchanged row counts.

---

## File Structure

### Database

- Create `supabase/migrations/202609220001_training_relationships.sql` for direct connections, group timezone, relationship helpers, RPCs, grants, and policies.
- Create `supabase/migrations/202609220002_training_schema.sql` for plans, versions, schedules, occurrences, rounds, movements, participation, assessments, feedback, constraints, triggers, grants, and base RLS.
- Create `supabase/migrations/202609220003_training_api.sql` for transactional mutation and calendar/history RPCs.
- Create `supabase/migrations/202609220004_training_statistics.sql` for personal summary and group leaderboard RPCs.
- Create `supabase/tests/0006_training_relationships.test.sql`, `0007_training_schema_authorization.test.sql`, `0008_training_lifecycle.test.sql`, and `0009_training_statistics.test.sql`.

### Application domain and services

- Create `src/app/dashboard-i18n.js` for English/Portuguese dashboard strings and locale formatting.
- Create `src/app/connection-service.js` for direct coaching connection RPC contracts.
- Create `src/app/training-service.js` for plans, schedules, calendar, completion, assessment, and feedback RPC contracts.
- Create `src/app/statistics-service.js` for summary and leaderboard RPC contracts.
- Create `src/app/training-calendar-state.js` for month math, selected day, stale-load protection, and local-date helpers.
- Create `src/app/training-plan-state.js` for plan-editor normalization and ordered round/movement editing.
- Create `src/app/statistics-state.js` for period/metric state and display formatting.

### Views and entry composition

- Create `src/app/ui/connection-view.js` for direct connection search, requests, decisions, and ended access.
- Create `src/app/ui/training-calendar-view.js` for My Training calendar, day details, and Alone entry.
- Create `src/app/ui/coaching-training-view.js` for plan authoring, scheduling, completion, attendance, and feedback.
- Create `src/app/ui/statistics-view.js` for personal cards and group rankings.
- Modify `src/app/entries/dashboard.js` to construct services/controllers and route mode/tab/group context.
- Modify `src/app/ui/dashboard-view.js` and `src/app/dashboard-state.js` to own mode/tab selection but not feature internals.
- Modify `src/app/testing/fake-services.js` to expose deterministic E2E connection, training, and statistics fakes.
- Modify `dashboard.html` to add tabs, feature workspaces, and accessible dialogs.
- Create `assets/training-calendar.css`, `assets/training-forms.css`, and `assets/training-statistics.css`; link them from `dashboard.html`.
- Modify `assets/dashboard.css` only for shared shell/tab behavior.

### Tests and operations

- Create unit tests matching each new domain, service, and view module under `tests/unit/`.
- Create `tests/e2e/training-calendar.spec.js`, `tests/e2e/coaching-training.spec.js`, and `tests/e2e/training-statistics.spec.js`.
- Modify `docs/auth-and-database-operations.md` and `docs/security-checklist.md` with migration, verification, and smoke-test instructions.

---

### Task 1: Direct Coaching Relationships and Group Timezone

**Files:**
- Create: `supabase/migrations/202609220001_training_relationships.sql`
- Create: `supabase/tests/0006_training_relationships.test.sql`
- Modify: `src/app/group-service.js`
- Modify: `tests/unit/group-service.test.js`
- Modify: `src/app/ui/group-view.js`
- Modify: `tests/unit/group-view.test.js`
- Modify: `dashboard.html`

**Interfaces:**
- Produces: `private.has_explicit_coaching_connection(coach_id uuid, student_id uuid) -> boolean`.
- Produces: `private.has_group_coaching_connection(coach_id uuid, student_id uuid, group_id uuid default null) -> boolean`.
- Produces: `private.can_coach_practitioner(coach_id uuid, student_id uuid, group_id uuid default null) -> boolean`.
- Produces public RPCs: `search_coaching_profiles`, `request_coach_connection`, `decide_coach_connection`, `end_coach_connection`, and `list_my_coach_connections`.
- Extends: `groups.timezone text not null` and group create/update RPC inputs.

- [ ] **Step 1: Write the failing pgTAP relationship and timezone tests**

Create users for a coach, student, same-group coach, unrelated coach, and outsider. Assert table/type/function existence, reciprocal request decisions, helper behavior, and timezone rejection:

```sql
select has_table('public', 'coach_student_connections');
select has_function(
  'private', 'can_coach_practitioner', array['uuid', 'uuid', 'uuid']
);
select is(
  public.request_coach_connection(
    '10000000-0000-0000-0000-000000000102'::uuid,
    '10000000-0000-0000-0000-000000000101'::uuid
  ) ->> 'status',
  'pending'
);
select throws_ok(
  $$ select public.set_group_timezone(
       '20000000-0000-0000-0000-000000000101'::uuid,
       'Mars/Olympus'
     ) $$,
  'P0001', null, 'invalid IANA timezone is rejected'
);
```

- [ ] **Step 2: Run the new database test and verify it fails**

Run:

```bash
npx --yes node@22 node_modules/supabase/dist/supabase.js test db supabase/tests/0006_training_relationships.test.sql
```

Expected: FAIL because the enum, table, helpers, and RPCs do not exist.

- [ ] **Step 3: Add relationship schema, integrity rules, and group timezone**

Create the enum/table and validate timezone against `pg_timezone_names`:

```sql
create type public.coach_connection_state as enum (
  'pending', 'active', 'declined', 'ended'
);

create table public.coach_student_connections (
  id uuid primary key default gen_random_uuid(),
  coach_profile_id uuid not null references public.coach_profiles(profile_id) on delete cascade,
  student_profile_id uuid not null references public.profiles(id) on delete cascade,
  state public.coach_connection_state not null default 'pending',
  initiated_by uuid not null references public.profiles(id) on delete restrict,
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  ended_at timestamptz,
  ended_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_student_connections_distinct_check
    check (coach_profile_id <> student_profile_id),
  constraint coach_student_connections_initiator_check
    check (initiated_by in (coach_profile_id, student_profile_id))
);

create unique index coach_student_connections_open_pair_idx
  on public.coach_student_connections (coach_profile_id, student_profile_id)
  where state in ('pending', 'active');

alter table public.groups add column timezone text not null default 'UTC';
```

Add a `private.is_valid_timezone(text)` stable helper and a trigger that rejects unknown IANA names. Recreate group create/update wrappers with a final `timezone text` argument; existing group rows remain `UTC` until edited.

- [ ] **Step 4: Add narrow relationship helpers and RPCs**

Keep the old `private.is_direct_coach_of` callable for existing storage policies, but define new unambiguous helpers and make the compatibility helper call `private.can_coach_practitioner`:

```sql
create function private.can_coach_practitioner(
  coach_id uuid,
  student_id uuid,
  context_group_id uuid default null
)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_explicit_coaching_connection(coach_id, student_id)
      or private.has_group_coaching_connection(coach_id, student_id, context_group_id);
$$;
```

Every mutation locks the target connection, verifies `auth.uid()` is one of the two participants, validates transitions, and returns stable JSON such as:

```json
{"status":"active","connection_id":"00000000-0000-0000-0000-000000000000"}
```

Grant authenticated users only the public wrappers; revoke direct table mutation.

- [ ] **Step 5: Run the relationship database test**

Run the Step 2 command.

Expected: PASS, including the unrelated-coach and invalid-timezone assertions.

- [ ] **Step 6: Add failing group-service timezone contract tests**

Extend the existing table-driven test:

```js
['createGroup', [{
  name: 'Grupo Sol', description: '', location: 'Lisboa', discoverable: true,
  timezone: 'Europe/Lisbon',
}], 'create_group', {
  name: 'Grupo Sol', description: null, location: 'Lisboa',
  is_discoverable: true, timezone: 'Europe/Lisbon',
}],
['setGroupTimezone', ['group-1', 'America/Sao_Paulo'], 'set_group_timezone', {
  group_id: 'group-1', timezone: 'America/Sao_Paulo',
}],
```

- [ ] **Step 7: Run the focused unit test and verify failure**

Run:

```bash
npx --yes node@22 node_modules/vitest/vitest.mjs run tests/unit/group-service.test.js
```

Expected: FAIL because `createGroup` omits timezone and `setGroupTimezone` is absent.

- [ ] **Step 8: Implement group timezone client wiring**

Change `createGroup` to accept and forward timezone, add `setGroupTimezone`, and have `group-view.js` call `Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'` when opening a new group. Add `#groupTimezone` to the create/edit dialog, prefill it with the detected IANA name, and render an owner-only **Change group timezone** action in group settings. Extend `group-view.test.js` to prove a non-owner cannot see the action and an owner submits `setGroupTimezone('group-1', 'Europe/Lisbon')`.

- [ ] **Step 9: Run database and unit tests, then commit**

Run:

```bash
npx --yes node@22 node_modules/supabase/dist/supabase.js test db supabase/tests/0006_training_relationships.test.sql
npx --yes node@22 node_modules/vitest/vitest.mjs run tests/unit/group-service.test.js tests/unit/group-view.test.js
git add supabase/migrations/202609220001_training_relationships.sql supabase/tests/0006_training_relationships.test.sql dashboard.html src/app/group-service.js src/app/ui/group-view.js tests/unit/group-service.test.js tests/unit/group-view.test.js
git commit -m "feat: add direct coaching relationships"
```

Expected: all selected tests PASS and the commit succeeds.

---

### Task 2: Bilingual Connection Experience

**Files:**
- Create: `src/app/dashboard-i18n.js`
- Create: `src/app/connection-service.js`
- Create: `src/app/ui/connection-view.js`
- Create: `tests/unit/dashboard-i18n.test.js`
- Create: `tests/unit/connection-service.test.js`
- Create: `tests/unit/connection-view.test.js`
- Modify: `dashboard.html`
- Modify: `src/app/entries/dashboard.js`
- Modify: `src/app/testing/fake-services.js`
- Create: `tests/e2e/coaching-connections.spec.js`

**Interfaces:**
- Produces: `createDashboardI18n({ document, storage, navigator })` with `t(key, vars)`, `locale()`, `setLocale(locale)`, `formatDate`, and `formatDuration`.
- Produces: `createConnectionService(client)` methods `searchCandidates`, `listMine`, `request`, `decide`, and `end`.
- Produces: `createConnectionView({ document, service, i18n, identity, onAccessRevoked })` with `load()`, `showSearch()`, and `clear()`.

- [ ] **Step 1: Write failing locale and service-contract tests**

Pin locale fallback, interpolation, Portuguese copy, normalized search, and RPC names:

```js
expect(i18n.t('training.alone')).toBe('Alone');
i18n.setLocale('pt');
expect(i18n.t('training.alone')).toBe('Sozinho');
expect(await service.searchCandidates('  Mestre Lua  ', 'coach')).toEqual(results);
expect(calls[0]).toEqual(['search_coaching_profiles', {
  search_text: 'Mestre Lua', candidate_role: 'coach', result_limit: 20,
}]);
```

- [ ] **Step 2: Run the new unit tests and verify failure**

Run:

```bash
npx --yes node@22 node_modules/vitest/vitest.mjs run tests/unit/dashboard-i18n.test.js tests/unit/connection-service.test.js
```

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement locale and connection service modules**

Use immutable dictionaries and reject unknown keys during tests:

```js
const STRINGS = Object.freeze({
  en: Object.freeze({
    'training.alone': 'Alone',
    'connections.title': 'Coaches and students',
    'connections.ended': 'This coaching connection has ended.',
  }),
  pt: Object.freeze({
    'training.alone': 'Sozinho',
    'connections.title': 'Treinadores e alunos',
    'connections.ended': 'Esta ligação de treino terminou.',
  }),
});
```

The service must call `toAppError` for every Supabase error and return only RPC data.

- [ ] **Step 4: Run locale and service tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Write failing connection-view tests**

Test search, request, accept/decline, direct versus group-derived labels, stale search response suppression, and revoked access:

```js
await view.load();
expect(document.querySelector('[data-connection-id="connection-1"]')).not.toBeNull();
service.listMine = async () => { throw new AppError('authorization', 'not_authorized'); };
await view.load();
expect(onAccessRevoked).toHaveBeenCalledOnce();
expect(document.querySelector('#connectionWorkspace').textContent).not.toContain('Student Ana');
```

- [ ] **Step 6: Run the view test and verify failure**

Run:

```bash
npx --yes node@22 node_modules/vitest/vitest.mjs run tests/unit/connection-view.test.js
```

Expected: FAIL because the controller is missing.

- [ ] **Step 7: Implement connection workspace and E2E fake**

Add `#connectionWorkspace` plus an accessible search dialog to `dashboard.html`. Render only safe candidate fields. Extend `fake-services.js` with `roda.e2e.connectionState`, deterministic IDs, and event recording. Construct the controller in `dashboard.js`; clearing an authorization failure must remove rendered names before showing the localized message.

- [ ] **Step 8: Write and run the browser connection flow**

Cover student request, coach acceptance, direct student visibility, and ended access in both desktop and mobile projects:

```js
await page.getByRole('button', { name: 'Find a coach' }).click();
await page.getByRole('searchbox', { name: 'Search coaches' }).fill('Lua');
await page.getByRole('button', { name: 'Request Mestre Lua' }).click();
await expect(page.getByText('Pending')).toBeVisible();
```

Run:

```bash
npx --yes node@22 scripts/build.mjs --test
npx --yes node@22 node_modules/@playwright/test/cli.js test tests/e2e/coaching-connections.spec.js
```

Expected: PASS in desktop and mobile.

- [ ] **Step 9: Restore production bundles and commit**

Run:

```bash
npx --yes node@22 scripts/build.mjs
git add dashboard.html src/app/dashboard-i18n.js src/app/connection-service.js src/app/ui/connection-view.js src/app/entries/dashboard.js src/app/testing/fake-services.js tests/unit/dashboard-i18n.test.js tests/unit/connection-service.test.js tests/unit/connection-view.test.js tests/e2e/coaching-connections.spec.js assets/generated
git commit -m "feat: add coaching connection experience"
```

---

### Task 3: Workout and Training Data Model

**Files:**
- Create: `supabase/migrations/202609220002_training_schema.sql`
- Create: `supabase/tests/0007_training_schema_authorization.test.sql`

**Interfaces:**
- Produces enums: `workout_plan_state`, `scheduled_training_kind`, `scheduled_training_state`, `training_kind`, and `movement_difficulty`.
- Produces tables named in the approved spec: plans, versions, plan rounds/movements, schedules, occurrences, occurrence rounds/movements, participation, assessments, and feedback.
- Produces helpers: `private.can_read_training`, `private.can_manage_schedule`, and `private.can_write_training_feedback`.

- [ ] **Step 1: Write failing schema and constraint assertions**

Assert every enum/table, foreign key, RLS flag, unique key, and core check. Include invalid context combinations and immutable published children:

```sql
select has_table('public', 'training_participations');
select col_is_fk('public', 'training_participations', 'profile_id');
select throws_ok(
  $$ insert into public.scheduled_trainings (
       kind, plan_version_id, arranged_by, student_profile_id,
       starts_at, local_date, timezone
     ) values (
       'group', :'plan_version', :'coach', :'student',
       now(), current_date, 'UTC'
     ) $$,
  '23514', null, 'group schedule requires group and forbids individual target'
);
```

- [ ] **Step 2: Run the schema test and verify failure**

Run:

```bash
npx --yes node@22 node_modules/supabase/dist/supabase.js test db supabase/tests/0007_training_schema_authorization.test.sql
```

Expected: FAIL because the training types and tables are absent.

- [ ] **Step 3: Create the schema with explicit context constraints**

Use normalized ordered child tables and local-date fields. The central participation shape is:

```sql
create table public.training_participations (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references public.training_occurrences(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  actual_duration_minutes integer not null,
  personal_notes text,
  confirmed_at timestamptz not null,
  confirmed_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_participations_unique unique (occurrence_id, profile_id),
  constraint training_participations_duration_check
    check (actual_duration_minutes between 1 and 1440),
  constraint training_participations_notes_check
    check (personal_notes is null or char_length(personal_notes) <= 4000)
);
```

Add ordered-position uniqueness per parent, text limits, valid timezone triggers, and `scheduled_trainings.schedule_id` uniqueness on occurrences.

- [ ] **Step 4: Add immutability and normalization triggers**

Reject updates/deletes to published plan-version content and completed occurrence snapshots with stable `P0001` messages `published_plan_immutable` and `completed_training_immutable`. Normalize movement keys to lowercase hyphenated keys and preserve a non-empty display-name snapshot.

- [ ] **Step 5: Add base RLS and grants**

Enable and force RLS on every table. Revoke anonymous and authenticated direct mutation. Allow narrowly scoped SELECT only where the approved helper permits it; all writes will go through Task 4 RPCs. Other students must not receive raw participation rows.

- [ ] **Step 6: Run the schema authorization test**

Run the Step 2 command.

Expected: PASS for owner, direct coach, group coach, same-group student, outsider, immediate parent, and second-level ancestor fixtures.

- [ ] **Step 7: Run all existing database tests and commit**

Run:

```bash
npx --yes node@22 node_modules/supabase/dist/supabase.js test db
git add supabase/migrations/202609220002_training_schema.sql supabase/tests/0007_training_schema_authorization.test.sql
git commit -m "feat(db): add workout and training records"
```

Expected: all database tests PASS.

---

### Task 4: Transactional Training Lifecycle API

**Files:**
- Create: `supabase/migrations/202609220003_training_api.sql`
- Create: `supabase/tests/0008_training_lifecycle.test.sql`
- Modify: `src/app/errors.js`
- Modify: `tests/unit/errors.test.js`

**Interfaces:**
- Produces RPCs: `create_workout_plan`, `save_workout_plan_draft`, `publish_workout_plan`, `list_workout_plans`, `schedule_group_training`, `schedule_personal_class`, `cancel_scheduled_training`, `record_alone_training`, `complete_group_training`, `complete_personal_class`, `save_training_assessment`, `save_training_notes`, `add_training_feedback`, `list_training_calendar`, and `get_training_day`.
- Consumes permission helpers from Tasks 1 and 3.

- [ ] **Step 1: Write failing lifecycle pgTAP tests**

Cover draft publication, stale draft-edit conflicts, future-plan visibility, solo ownership, coach authorization, schedule cancellation, idempotent completion, participant-specific duration, transactional attendance, relationship-ended history access, and context-scoped feedback. Use one invalid attendee in a multi-attendee call and assert no occurrence remains:

```sql
select throws_ok(
  $$ select public.complete_group_training(
       :'schedule_id'::uuid,
       '[{"profile_id":"10000000-0000-0000-0000-000000000201","duration_minutes":60},
         {"profile_id":"10000000-0000-0000-0000-000000000299","duration_minutes":60}]'::jsonb,
       60,
       :'idempotency_key'::uuid
     ) $$,
  'PT403', null, 'one invalid attendee rejects the full completion'
);
select is(
  (select count(*)::integer from public.training_occurrences where schedule_id = :'schedule_id'),
  0,
  'failed group completion leaves no partial occurrence'
);
```

- [ ] **Step 2: Run the lifecycle test and verify failure**

Run:

```bash
npx --yes node@22 node_modules/supabase/dist/supabase.js test db supabase/tests/0008_training_lifecycle.test.sql
```

Expected: FAIL because the RPCs are absent.

- [ ] **Step 3: Implement plan and schedule RPCs**

Private security-definer functions take `actor_id` first; public security-invoker wrappers pass `auth.uid()`. Accept round/movement payloads as validated JSONB arrays, assign positions server-side, and publish in one transaction. Scheduling requires a published version and an active relationship at call time.

- [ ] **Step 4: Implement record and completion RPCs**

`record_alone_training` creates occurrence snapshot and participation atomically. `complete_group_training` locks the schedule, validates every attendee before inserting anything, creates one occurrence, copies/overrides actual content, inserts unique participations, and marks the schedule completed. Persist the provided UUID idempotency key on the occurrence and return the existing result on retry.

Draft-saving accepts `expected_updated_at`. Lock the plan row and raise `P0001/edit_conflict` when the stored timestamp differs; never overwrite the newer draft. The service and plan editor retain the user's local edits while offering a reload after this response.

Use a stable response shape:

```json
{
  "status": "completed",
  "occurrence_id": "00000000-0000-0000-0000-000000000000",
  "participation_ids": ["00000000-0000-0000-0000-000000000000"]
}
```

- [ ] **Step 5: Implement history, assessment, notes, and feedback RPCs**

`list_training_calendar(month_start, month_end, profile_id)` returns summary rows only. `get_training_day(local_date, profile_id)` returns nested JSON with rounds, movements, assessments, and only feedback visible to the actor. Notes/assessments are practitioner-owned upserts. Feedback verifies its direct or group context at creation.

- [ ] **Step 6: Run lifecycle and all database tests**

Run:

```bash
npx --yes node@22 node_modules/supabase/dist/supabase.js test db supabase/tests/0008_training_lifecycle.test.sql
npx --yes node@22 node_modules/supabase/dist/supabase.js test db
```

Expected: all tests PASS, including retry and rollback cases.

- [ ] **Step 7: Add safe application error messages**

Extend `SAFE_MESSAGES` and its test with exact codes returned by the new API:

```js
const expected = {
  cancelled_training: 'This training was cancelled.',
  connection_ended: 'This coaching connection has ended.',
  duplicate_completion: 'This training was already completed.',
  edit_conflict: 'This plan changed elsewhere. Reload it before saving again.',
  invalid_attendee: 'One or more attendees are not active group members.',
  published_plan_immutable: 'Published plans cannot be changed.',
};
```

- [ ] **Step 8: Run error tests and commit**

Run:

```bash
npx --yes node@22 node_modules/vitest/vitest.mjs run tests/unit/errors.test.js
git add supabase/migrations/202609220003_training_api.sql supabase/tests/0008_training_lifecycle.test.sql src/app/errors.js tests/unit/errors.test.js
git commit -m "feat(db): add transactional training lifecycle"
```

---

### Task 5: Training Service, Plan State, and E2E Fake

**Files:**
- Create: `src/app/training-service.js`
- Create: `src/app/training-plan-state.js`
- Create: `tests/unit/training-service.test.js`
- Create: `tests/unit/training-plan-state.test.js`
- Modify: `src/app/testing/fake-services.js`

**Interfaces:**
- Produces: `createTrainingService(client, { randomUUID })` matching every Task 4 RPC.
- Produces: `createPlanDraft`, `addRound`, `moveRound`, `addMovement`, `moveMovement`, `removeMovement`, and `serializePlanDraft`.
- Produces: `createE2ETrainingService({ window })` backed by `roda.e2e.trainingState`.

- [ ] **Step 1: Write failing RPC contract and validation tests**

Pin trimming, null conversion, ISO/local-date preservation, and idempotency keys:

```js
await service.recordAloneTraining({
  localDate: '2026-09-22', timezone: 'Europe/Lisbon',
  durationMinutes: 45, notes: '  Armada practice  ', rounds,
});
expect(calls[0]).toEqual(['record_alone_training', {
  local_date: '2026-09-22', timezone: 'Europe/Lisbon',
  duration_minutes: 45, personal_notes: 'Armada practice', rounds,
  idempotency_key: 'request-uuid',
}]);
```

- [ ] **Step 2: Run service and state tests and verify failure**

Run:

```bash
npx --yes node@22 node_modules/vitest/vitest.mjs run tests/unit/training-service.test.js tests/unit/training-plan-state.test.js
```

Expected: FAIL because the modules are missing.

- [ ] **Step 3: Implement service validation and stable contracts**

Validate duration `1..1440`, ISO local dates, non-empty plan title, at least one round and movement, and difficulty in `easy|okay|hard` before network calls. Convert database failures with `toAppError` and generate a fresh idempotency UUID once per submitted action, not once per retry attempt.

- [ ] **Step 4: Implement immutable plan-state reducers**

Use stable client IDs for draft rows and return new objects on every change:

```js
export function addMovement(state, roundId, movement) {
  return {
    ...state,
    rounds: state.rounds.map((round) => round.id === roundId
      ? { ...round, movements: [...round.movements, normalizeMovement(movement)] }
      : round),
  };
}
```

Serialization strips client IDs and emits ordered server payloads.

- [ ] **Step 5: Implement deterministic E2E training state**

Persist plans, schedules, occurrences, and participation in localStorage. Enforce the same role rules needed by browser tests, record fake events, and support injected authorization and network errors. The fake must derive summaries from stored participation rather than keeping mutable totals.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npx --yes node@22 node_modules/vitest/vitest.mjs run tests/unit/training-service.test.js tests/unit/training-plan-state.test.js
git add src/app/training-service.js src/app/training-plan-state.js src/app/testing/fake-services.js tests/unit/training-service.test.js tests/unit/training-plan-state.test.js
git commit -m "feat: add training domain services"
```

Expected: PASS.

---

### Task 6: Calendar State and Alone Training Experience

**Files:**
- Create: `src/app/training-calendar-state.js`
- Create: `src/app/ui/training-calendar-view.js`
- Create: `tests/unit/training-calendar-state.test.js`
- Create: `tests/unit/training-calendar-view.test.js`
- Modify: `dashboard.html`
- Create: `assets/training-calendar.css`
- Create: `assets/training-forms.css`
- Modify: `assets/dashboard.css`
- Modify: `src/app/dashboard-state.js`
- Modify: `src/app/ui/dashboard-view.js`
- Modify: `src/app/entries/dashboard.js`
- Create: `tests/e2e/training-calendar.spec.js`

**Interfaces:**
- Consumes: training service, i18n, session profile, and detected timezone.
- Produces: `monthBounds`, `calendarGrid`, `mondayWeekBounds`, `reduceCalendarState`, and `createTrainingCalendarView` methods `loadMonth`, `selectDay`, `openAlone`, `refresh`, and `clear`.

- [ ] **Step 1: Write failing calendar-domain tests**

Pin Monday starts, leap month, DST, month navigation, selected-day retention, and stale-response protection:

```js
expect(mondayWeekBounds('2026-03-09', 'America/Los_Angeles')).toEqual({
  start: '2026-03-09', endExclusive: '2026-03-16',
});
expect(calendarGrid('2026-03', { weekStartsOn: 1 })).toHaveLength(42);
expect(localDateFromInstant('2026-11-01T08:30:00Z', 'America/Los_Angeles'))
  .toBe('2026-11-01');
```

- [ ] **Step 2: Run domain tests and verify failure**

Run:

```bash
npx --yes node@22 node_modules/vitest/vitest.mjs run tests/unit/training-calendar-state.test.js
```

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement calendar math without parsing local dates as UTC instants**

Represent calendar arithmetic as `{ year, month, day }` values and format ISO strings explicitly. Use `Intl.DateTimeFormat` only for instant-to-zone conversion and labels. The reducer carries `visibleMonth`, `selectedDate`, `summaryByDate`, `dayDetail`, `loadingToken`, and `error`.

- [ ] **Step 4: Write failing view tests**

Test semantic grid roles, markers for all three kinds, upcoming/completed distinction, keyboard navigation, empty state, form preservation after failure, and successful Alone refresh:

```js
await view.loadMonth('2026-09');
expect(document.querySelector('[data-date="2026-09-22"] [data-kind="alone"]'))
  .not.toBeNull();
await submitAlone({ serviceError: new TypeError('offline') });
expect(document.querySelector('#aloneNotes').value).toBe('Armada practice');
```

- [ ] **Step 5: Run view tests and verify failure**

Run:

```bash
npx --yes node@22 node_modules/vitest/vitest.mjs run tests/unit/training-calendar-view.test.js
```

Expected: FAIL because the view and markup are absent.

- [ ] **Step 6: Build the calendar and Alone dialog**

Add My Training tabs **Calendar**, **Upcoming**, and **Statistics**, with Calendar selected by default. Render a seven-column semantic grid, localized weekday headings, day buttons, accessible marker text, a day-detail panel, and a reusable round/movement editor in the Alone dialog. Keep failed values in place; disable only the active submission button.

- [ ] **Step 7: Integrate mode/tab state and controller lifetime**

Extend dashboard state with `activeTabByMode`. On mode changes, hide and clear unauthorized feature workspaces without destroying persisted calendar month. Construct `trainingCalendarView` after profile load and call `clear()` on sign-out or session expiry.

- [ ] **Step 8: Write and run browser calendar tests**

Cover recording Alone training, calendar marker/day details, mobile layout, Portuguese labels, and a retry that does not duplicate the fake participation:

```js
await page.getByRole('button', { name: 'Record Alone training' }).click();
await page.getByLabel('Duration in minutes').fill('45');
await page.getByRole('button', { name: 'Add movement' }).click();
await page.getByLabel('Movement').selectOption('armada');
await page.getByRole('button', { name: 'Save training' }).click();
await expect(page.getByRole('button', { name: /September 22.*Alone/ })).toBeVisible();
```

Run:

```bash
npx --yes node@22 scripts/build.mjs --test
npx --yes node@22 node_modules/@playwright/test/cli.js test tests/e2e/training-calendar.spec.js
```

Expected: PASS in desktop and mobile.

- [ ] **Step 9: Restore production bundle and commit**

Run:

```bash
npx --yes node@22 scripts/build.mjs
git add dashboard.html assets/dashboard.css assets/training-calendar.css assets/training-forms.css src/app/training-calendar-state.js src/app/ui/training-calendar-view.js src/app/dashboard-state.js src/app/ui/dashboard-view.js src/app/entries/dashboard.js tests/unit/training-calendar-state.test.js tests/unit/training-calendar-view.test.js tests/e2e/training-calendar.spec.js assets/generated
git commit -m "feat: add personal training calendar"
```

---

### Task 7: Workout Plan Editor and Coach Scheduling

**Files:**
- Create: `src/app/ui/coaching-training-view.js`
- Create: `tests/unit/coaching-training-view.test.js`
- Modify: `dashboard.html`
- Modify: `assets/training-forms.css`
- Modify: `src/app/entries/dashboard.js`
- Create: `tests/e2e/coaching-training.spec.js`

**Interfaces:**
- Consumes: `trainingService`, `connectionService`, active coached-group context, roster, plan-state functions, and i18n.
- Produces: `createCoachingTrainingView` methods `load`, `setContext`, `openPlanEditor`, `openGroupSchedule`, `openPersonalSchedule`, and `clear`.

- [ ] **Step 1: Write failing coach-view unit tests**

Cover coach-only controls, ordered round editing, publish immutability, group roster targets, direct/group-derived personal targets, hidden-plan setting, stale context loads, and revoked access clearing:

```js
view.setContext({ mode: 'coaching', groupId: 'group-1', isCoach: true });
await view.load();
expect(document.querySelector('[data-action="schedule-group"]')).not.toBeNull();
view.setContext({ mode: 'training', groupId: null, isCoach: true });
expect(document.querySelector('#coachingTrainingWorkspace').textContent).toBe('');
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
npx --yes node@22 node_modules/vitest/vitest.mjs run tests/unit/coaching-training-view.test.js
```

Expected: FAIL because the controller is absent.

- [ ] **Step 3: Implement plan editor and scheduling dialogs**

Render Coaching tabs **Schedule**, **Students**, and **Groups**. The plan editor supports title, instructions, expected duration, round ordering, movement ordering, repetition/time targets, side, rest, save draft, and publish. Published versions render read-only. Group schedule requires active group context; Personal class requires a selected connected student and records whether the context is direct or group-derived.

- [ ] **Step 4: Preserve form data and block invalid submissions**

Use native constraints plus training-service validation. Network failure leaves the dialog open with all rounds intact. Authorization failure closes the private dialog, clears student/roster data, and invokes the dashboard's existing access-revoked path.

- [ ] **Step 5: Add browser scheduling scenarios**

In `coaching-training.spec.js`, cover draft/publish, hidden group schedule, direct Personal class, group-derived Personal class, unauthorized member controls, and the student's upcoming calendar. Assert a hidden plan shows date/context but not round details before reveal.

- [ ] **Step 6: Run unit and browser tests**

Run:

```bash
npx --yes node@22 node_modules/vitest/vitest.mjs run tests/unit/coaching-training-view.test.js tests/unit/training-plan-state.test.js
npx --yes node@22 scripts/build.mjs --test
npx --yes node@22 node_modules/@playwright/test/cli.js test tests/e2e/coaching-training.spec.js
```

Expected: PASS in desktop and mobile.

- [ ] **Step 7: Restore production bundle and commit**

Run:

```bash
npx --yes node@22 scripts/build.mjs
git add dashboard.html assets/training-forms.css src/app/ui/coaching-training-view.js src/app/entries/dashboard.js tests/unit/coaching-training-view.test.js tests/e2e/coaching-training.spec.js assets/generated
git commit -m "feat: add coach plans and scheduling"
```

---

### Task 8: Completion, Attendance, Assessments, and Feedback

**Files:**
- Modify: `src/app/ui/coaching-training-view.js`
- Modify: `src/app/ui/training-calendar-view.js`
- Modify: `tests/unit/coaching-training-view.test.js`
- Modify: `tests/unit/training-calendar-view.test.js`
- Modify: `tests/e2e/coaching-training.spec.js`
- Modify: `tests/e2e/training-calendar.spec.js`

**Interfaces:**
- Consumes Task 4 completion, notes, assessment, and feedback RPC methods through `trainingService`.
- Produces completed day details and coach/student feedback interactions.

- [ ] **Step 1: Write failing attendance and feedback view tests**

Pin select-all/default attendance, participant duration overrides, no-statistics-before-confirmation, assessment ownership, feedback scoping, retry idempotency, and access revocation:

```js
await view.completeGroup({
  scheduleId: 'schedule-1',
  attendees: [{ profileId: 'student-1', durationMinutes: 45 }],
  durationMinutes: 60,
});
expect(service.completeGroupTraining).toHaveBeenCalledWith(expect.objectContaining({
  attendees: [{ profileId: 'student-1', durationMinutes: 45 }],
}));
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
npx --yes node@22 node_modules/vitest/vitest.mjs run tests/unit/coaching-training-view.test.js tests/unit/training-calendar-view.test.js
```

Expected: FAIL on missing completion and feedback behavior.

- [ ] **Step 3: Implement coach completion and transactional error handling**

Render actual duration/content, roster attendance checkboxes, and optional per-person duration. Reuse the service-generated idempotency key across retry. On `not_authorized`, clear roster/schedule detail and return to a safe dashboard state. On `invalid_attendee`, preserve selections and explain that membership changed.

- [ ] **Step 4: Implement practitioner assessments and notes**

For each occurrence movement, render one Easy/Okay/Hard radio group and optional note. Save personal notes separately so a failed assessment does not discard the day view. Refresh only the selected day after success.

- [ ] **Step 5: Implement context-scoped feedback display and authoring**

Coaches choose only contexts returned by the server for that participation. Students see author name, context label, timestamp, and body. Do not render coach-only controls for student mode.

- [ ] **Step 6: Extend browser flows**

Cover schedule not counted before completion, two-attendee confirmation, absent student exclusion, late-arrival duration, personal assessment, coach feedback, unrelated group feedback absence, retry without duplication, and revoked connection clearing an open student record.

- [ ] **Step 7: Run unit/browser/database regression and commit**

Run:

```bash
npx --yes node@22 node_modules/vitest/vitest.mjs run tests/unit/coaching-training-view.test.js tests/unit/training-calendar-view.test.js
npx --yes node@22 scripts/build.mjs --test
npx --yes node@22 node_modules/@playwright/test/cli.js test tests/e2e/coaching-training.spec.js tests/e2e/training-calendar.spec.js
npx --yes node@22 node_modules/supabase/dist/supabase.js test db supabase/tests/0008_training_lifecycle.test.sql
npx --yes node@22 scripts/build.mjs
git add src/app/ui/coaching-training-view.js src/app/ui/training-calendar-view.js tests/unit/coaching-training-view.test.js tests/unit/training-calendar-view.test.js tests/e2e/coaching-training.spec.js tests/e2e/training-calendar.spec.js assets/generated
git commit -m "feat: confirm training and collect feedback"
```

Expected: all selected suites PASS.

---

### Task 9: Personal Statistics and Group Leaderboard Queries

**Files:**
- Create: `supabase/migrations/202609220004_training_statistics.sql`
- Create: `supabase/tests/0009_training_statistics.test.sql`
- Create: `src/app/statistics-service.js`
- Create: `src/app/statistics-state.js`
- Create: `tests/unit/statistics-service.test.js`
- Create: `tests/unit/statistics-state.test.js`

**Interfaces:**
- Produces RPCs: `get_personal_training_statistics(range_start date, range_end_exclusive date, timezone text)`, `get_group_training_leaderboard(group_id uuid, range_start date, range_end_exclusive date, metric text)`, and `list_shared_group_members(group_id uuid, search_text text, result_limit integer, result_offset integer)`.
- Produces: `createStatisticsService(client)` and pure period/format functions `statisticsRange`, `formatDuration`, and `formatRankValue`.

- [ ] **Step 1: Write failing pgTAP aggregation tests**

Seed confirmed and unconfirmed activity across Alone, Group, and Personal class contexts, plus member join/end boundaries and opt-out. Assert current streak, session count, minutes, weekly/monthly averages, context distribution, favorite movement, difficulty trend, member ranks, anonymous totals, safe shared-member discovery, and tie ordering. Prove an immediate-parent coach receives named progress or full details according to the configured child relationship, while a second-level ancestor receives no identifiable rows.

Pin the mid-period membership case:

```sql
select results_eq(
  $$ select profile_id, total_minutes
       from public.get_group_training_leaderboard(
         :'group_id', '2026-09-01', '2026-10-01', 'time'
       )
      order by rank_position $$,
  $$ values
       (:'student_id'::uuid, 90::bigint) $$,
  'activity before joined_at is excluded from the group ranking'
);
```

- [ ] **Step 2: Run the statistics database test and verify failure**

Run:

```bash
npx --yes node@22 node_modules/supabase/dist/supabase.js test db supabase/tests/0009_training_statistics.test.sql
```

Expected: FAIL because the aggregate RPCs are absent.

- [ ] **Step 3: Implement database-owned summaries and ranking-safe projections**

Use confirmed participation joined to occurrence local date. For group rankings, intersect each participation instant with the membership's `[joined_at, ended_at)` interval and requested group-local range. Return named rows only for `leaderboard_visible = true`; return separate anonymous aggregate totals for hidden members. Use `dense_rank()` with a stable display-name/profile-ID tie order. `list_shared_group_members` returns display name, avatar path, and future graduation field only to an active member/coach of that group or an authorized immediate-parent coach; it never returns calendar, participation, notes, assessment, or feedback fields.

The leaderboard result exposes only:

```text
profile_id, display_name, avatar_path, rank_position,
total_minutes, session_count, selected_value,
anonymous_member_count, anonymous_minutes, anonymous_sessions
```

- [ ] **Step 4: Run the database test and full DB suite**

Run:

```bash
npx --yes node@22 node_modules/supabase/dist/supabase.js test db supabase/tests/0009_training_statistics.test.sql
npx --yes node@22 node_modules/supabase/dist/supabase.js test db
```

Expected: PASS.

- [ ] **Step 5: Write failing service/state tests**

Pin exact RPC parameters and week/month/year/all-time ranges in group timezone:

```js
expect(statisticsRange('week', '2026-09-22', 'Europe/Lisbon')).toEqual({
  start: '2026-09-21', endExclusive: '2026-09-28',
});
expect(formatRankValue({ metric: 'time', totalMinutes: 211, sessionCount: 4 }, 'en'))
  .toBe('3h 31m');
```

- [ ] **Step 6: Implement service and pure statistics state**

Accept only `week|month|year|all` and `time|sessions`; default to `month` and `time`. Keep the combined `3h 31m (4 sessions)` format absent from selectable metrics while retaining both values in service results.

- [ ] **Step 7: Run unit tests and commit**

Run:

```bash
npx --yes node@22 node_modules/vitest/vitest.mjs run tests/unit/statistics-service.test.js tests/unit/statistics-state.test.js
git add supabase/migrations/202609220004_training_statistics.sql supabase/tests/0009_training_statistics.test.sql src/app/statistics-service.js src/app/statistics-state.js tests/unit/statistics-service.test.js tests/unit/statistics-state.test.js
git commit -m "feat: calculate training statistics"
```

Expected: PASS.

---

### Task 10: Statistics and Ranking Interface

**Files:**
- Create: `src/app/ui/statistics-view.js`
- Create: `tests/unit/statistics-view.test.js`
- Create: `assets/training-statistics.css`
- Modify: `dashboard.html`
- Modify: `src/app/entries/dashboard.js`
- Modify: `src/app/testing/fake-services.js`
- Create: `tests/e2e/training-statistics.spec.js`

**Interfaces:**
- Consumes: statistics service, period/metric state, i18n, profile, memberships, and selected group.
- Produces: `createStatisticsView` methods `loadPersonal`, `loadGroup`, `setPeriod`, `setMetric`, `setGroup`, and `clear`.

- [ ] **Step 1: Write failing statistics-view tests**

Cover personal cards, period/metric selectors, loading/empty/error states, top-three cards, complete list, current member pinned position, opt-out projection, accessible selector state, stale group response suppression, safe shared-member search, and no raw-history access.

```js
await view.loadGroup('group-1');
expect(document.querySelectorAll('.ranking-podium-card')).toHaveLength(3);
expect(document.querySelector('[data-current-member="true"]')).not.toBeNull();
expect(document.body.textContent).not.toContain('private student note');
```

- [ ] **Step 2: Run the view test and verify failure**

Run:

```bash
npx --yes node@22 node_modules/vitest/vitest.mjs run tests/unit/statistics-view.test.js
```

Expected: FAIL because the view is absent.

- [ ] **Step 3: Implement personal and group statistics rendering**

Use semantic buttons for **This week / This month / This year / All time** and **Training time / Number of trainings**. Render personal summary cards without chart dependencies. Render a responsive podium plus ordered list inspired by the saved reference while using original roda.fyi styling. Add a group-member search that calls the safe projection and reveals no training details. Show anonymous aggregate contribution as a separate privacy note, never as a synthetic named member.

- [ ] **Step 4: Integrate selected group and loading cancellation**

Changing mode, tab, group, period, or metric increments a request token; discard stale responses. A group access failure clears names and rows before showing the localized safe message.

- [ ] **Step 5: Add fake statistics and browser scenarios**

The fake derives summaries from `roda.e2e.trainingState`. Browser tests switch all four periods and both metrics, verify `3h 31m` in time mode and `4 trainings` in session mode, pin the current member, confirm Portuguese copy, confirm mobile podium stacking, and prove opted-out members are unnamed.

- [ ] **Step 6: Run tests, restore production bundle, and commit**

Run:

```bash
npx --yes node@22 node_modules/vitest/vitest.mjs run tests/unit/statistics-view.test.js tests/unit/statistics-service.test.js tests/unit/statistics-state.test.js
npx --yes node@22 scripts/build.mjs --test
npx --yes node@22 node_modules/@playwright/test/cli.js test tests/e2e/training-statistics.spec.js
npx --yes node@22 scripts/build.mjs
git add dashboard.html assets/training-statistics.css src/app/ui/statistics-view.js src/app/entries/dashboard.js src/app/testing/fake-services.js tests/unit/statistics-view.test.js tests/e2e/training-statistics.spec.js assets/generated
git commit -m "feat: add personal and group training statistics"
```

Expected: all selected suites PASS.

---

### Task 11: Full Integration, Security Review, and Deployment Runbook

**Files:**
- Modify: `tests/e2e/auth-dashboard.spec.js`
- Modify: `tests/e2e/group-flows.spec.js`
- Modify: `docs/auth-and-database-operations.md`
- Modify: `docs/security-checklist.md`
- Modify: `.env.example` only if a genuinely new public environment key is required; the planned design requires none.

**Interfaces:**
- Verifies all interfaces from Tasks 1-10 together.
- Produces documented local, preview, and production migration/smoke commands.

- [ ] **Step 1: Add cross-feature regression scenarios**

Extend existing browser tests to assert sign-in still reaches the dashboard, profile completion still blocks private features until saved, group creation supplies timezone, switching modes preserves the correct tab, sign-out clears every training workspace, and old group flows remain usable with the new tabs.

- [ ] **Step 2: Run focused integration tests**

Run:

```bash
npx --yes node@22 scripts/build.mjs --test
npx --yes node@22 node_modules/@playwright/test/cli.js test tests/e2e/auth-dashboard.spec.js tests/e2e/group-flows.spec.js
```

Expected: PASS in desktop and mobile.

- [ ] **Step 3: Update operations and security documentation**

Document:

```bash
npx --yes node@22 node_modules/supabase/dist/supabase.js db reset
npx --yes node@22 node_modules/supabase/dist/supabase.js test db
npx --yes node@22 scripts/build.mjs
```

Add manual checks for connection revocation, hidden-plan visibility, context-scoped feedback, leaderboard opt-out, immediate-parent hierarchy access, HTTPS OAuth return, and absence of service-role credentials from generated bundles.

- [ ] **Step 4: Run the complete local verification suite**

Run:

```bash
npx --yes node@22 scripts/build.mjs
npx --yes node@22 node_modules/vitest/vitest.mjs run
npx --yes node@22 scripts/build.mjs --test
npx --yes node@22 node_modules/@playwright/test/cli.js test
npx --yes node@22 node_modules/supabase/dist/supabase.js test db
npx --yes node@22 scripts/build.mjs
git diff --check
git status --short
```

Expected: production build succeeds; all unit, browser, and database tests pass; `git diff --check` emits no output; only intentional documentation/generated-bundle changes remain.

- [ ] **Step 5: Inspect generated bundles for unsafe values**

Run:

```bash
rg -n "service_role|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|sb_publishable_e2e_test|__RODA_E2E_EVENTS__" assets/generated
```

Expected: no output.

- [ ] **Step 6: Commit integration documentation**

Run:

```bash
git add tests/e2e/auth-dashboard.spec.js tests/e2e/group-flows.spec.js docs/auth-and-database-operations.md docs/security-checklist.md assets/generated
git commit -m "docs: verify training platform rollout"
```

- [ ] **Step 7: Apply and verify a public HTTPS preview**

After explicit deployment authorization, link the Supabase project, apply migrations to the intended non-production target first, deploy a public HTTPS preview, add its exact `/auth/callback` URL to Supabase, and smoke-test with a real Google account:

1. Sign in and sign out.
2. Record Alone training.
3. Create and accept a direct coaching connection using two test accounts.
4. Arrange and complete Personal class and Group training.
5. Confirm calendars, feedback boundaries, personal statistics, and group rankings.
6. Confirm an unrelated account receives authorization errors from direct API calls.

Record the preview URL and results in the handoff. Do not deploy to the production domain or merge to `main` without separate confirmation.
