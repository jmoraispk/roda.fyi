# Mobile App Plan 2: Teaching, Me, Onboarding, and Mode

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/app` placeholders with the coach's class page, scheduling, past-class recording, plans, students, Teaching, Progress, Repertoire, Groups, and Catalog, and add the first-sign-in welcome and the Train · Both · Teach setting — spec increments 4 and 5.

**Architecture:** One migration stores `profiles.usage_mode` and exposes `set_usage_mode`; a second adds two read RPCs (`list_my_calendar`, `get_scheduled_class`) so a coach's own classes reach Today, Calendar, and the class page without changing the classic dashboard's `list_training_calendar`. New screens live in `src/app/screens/` and reuse the existing services, the round editor, the resource section, and (through an injected root element) the classic statistics, repertoire, and catalog views. A pure `shell/access.js` decides redirects (welcome, Teaching, Catalog) and what **+** does per mode.

**Tech Stack:** Vanilla ES modules + esbuild, Vitest + jsdom, Playwright (phone 390 px and desktop projects), Supabase Postgres + pgTAP.

**Spec:** `docs/superpowers/specs/2026-10-11-mobile-first-app-design.md` (mockups in `docs/superpowers/specs/2026-10-11-mobile-first-app-mockups/`, especially `calendar-me-v2-coach.html` for the Me slider and the coach's class page).

This is plan 2 of 4. Plan 1 (`docs/superpowers/plans/2026-10-11-mobile-app-plan-1-shell-reading-logging.md`) shipped the shell, Today, Calendar, the training page, and Log training. Plan 3 is Discover v1 (increment 6); plan 4 is the switch-over (increment 7).

## Global Constraints

- Keep `npm run test:unit`, `npm run test:e2e`, and `npm run test:db` passing; every task adds coverage for what it builds.
- Every new table has RLS enabled (this plan adds no tables). Follow `docs/security-checklist.md`: every mutation goes through an RPC that rechecks authorization server-side; hidden buttons are never security.
- Database functions follow the existing pattern: `private.*` `security definer` with `set search_path = ''` and fully qualified names, exposed through `public` `language sql` wrappers that pass `auth.uid()`; revoke execute from `public, anon, authenticated`, then grant execute to `authenticated` (private function and public wrapper).
- New migrations: `supabase/migrations/2026101200NN_*.sql`; never edit applied migrations. Apply locally with `npx supabase migration up --local`, **never** `supabase db reset` (the local database is shared with the main checkout), then `npm run test:db`. New pgTAP files continue the numbering (`0017`, `0018`). In pgTAP tests use `reset role;` before every `tests.set_actor(...)` when switching actors.
- Deploy order: apply `202610120001_usage_mode.sql` before deploying the JavaScript from Task 1, because `loadProfile` starts selecting `usage_mode` (the classic dashboard uses the same profile service).
- Do not modify `tools/`, `assets/figure3d.js`, `assets/moves3d/`. `index.html` changes only inside its Sequences section (none are needed in this plan).
- The classic `/dashboard` must keep working unchanged. Changes to `src/app/ui/*-view.js` are limited to an optional injected root element that defaults to the current `document.querySelector(...)` lookup.
- Copy is American English; every new `en` key in `src/app/dashboard-i18n.js` has a `pt` (pt-PT, informal "tu" like the existing `app.*` keys) key. Append new `en` keys after `'log.noSaved'` in the `en` block and new `pt` keys after `'log.noSaved'` in the `pt` block.
- Both Playwright projects run (`chromium-desktop`, `chromium-mobile` at 390 × 840). Form controls are at least 16 px (`font-size: 16px`) so iOS does not zoom. Sheets close on route change (the shell already does this; screens never keep a sheet open across `ctx.navigate`).
- Hash routes stay as listed in the spec's Routes table, plus the one route added by Ruling R7 (`#/me/teaching/record`) and an optional `?add=1` query on `#/training/<id>` (Ruling R6).
- No new runtime dependencies.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Rulings

Decisions made where the spec is silent or disagrees with the code. Each is restated in the task that implements it.

- **R1 — Welcome steps.** `#/welcome` shows steps 1–2 (name and photo; Train · Both · Teach). City and "Who can find you" need Plan 3's Discover columns, so the welcome is built from an exported, ordered step list (`welcomeSteps()`); each step may define `validate(state)` and an async `save(state, ctx)` hook that runs before the profile is completed. Plan 3 appends its step to that list.
- **R2 — Backfill.** Coach profiles are rows in `public.coach_profiles`. Existing profiles with a row there get `usage_mode = 'both'`; all others keep the default `'train'`.
- **R3 — Coach's own classes.** `list_training_calendar` misses personal classes a coach arranged and completed classes the coach taught but did not attend. Instead of changing that function (the classic dashboard and its tests depend on its exact shape), a new `public.list_my_calendar(month_start, month_end)` returns the caller's own calendar plus those coaching items, with a `role` (`participant` | `coach`) and `resource_kinds` column. `/app` Today, Calendar, and Teaching use it.
- **R4 — Class page data.** A new `public.get_scheduled_class(schedule_id)` returns the schedule, plan, plan rounds, and the people who may attend. Only the coach who arranged it may read it (the same rule as `private.can_manage_schedule`); everyone else gets "This class isn't available."
- **R5 — Finishing rules.** Finish class is enabled once the class has started. Everyone checked is recorded with the planned duration. A group class needs at least one checked person; a personal class whose student is unchecked cannot be finished (the page suggests Cancel class).
- **R6 — Add resources after Finish.** Finishing replaces the class page with `#/training/<occurrence-id>?add=1` (so Back skips the finished class); the training page opens its Add resources sheet once and strips the query. The router gains query parsing and `replace(path)`.
- **R7 — Record a past class** is a full-screen page at `#/me/teaching/record` (too tall for a sheet; the spec forbids dialogs).
- **R8 — Schedule a class** is a bottom sheet opened from **+**, Teaching, a plan, or a student. Its start must be in the future. After scheduling it opens the new class page.
- **R9 — Desktop sidebar button** reads "+ Log training" in Train and "+ Create" in Both and Teach, and behaves like the phone **+**.
- **R10 — Today ordering per mode.** Both keeps the spec order (finish → rate → next class). Train: rate → next class I attend → finish → next class I teach. Teach: finish → next class I teach → rate → next class I attend.
- **R11 — Start-time chip.** Log training gets a start-time chip. It defaults to the current local time minus the duration, rounded down to 5 minutes and never before 00:00, and follows the duration until the person edits it. A start in the future is refused with a message. `.chip-input` controls move to 16 px.
- **R12 — Coach actions on the training page.** "Edit" is dropped (completed occurrences are immutable in the database). Coach feedback is written from the student page (`#/me/teaching/students/<id>`), which already has the needed participation and feedback contexts.
- **R13 — Progress, Repertoire, Catalog** reuse `createStatisticsView`, `createRepertoireView`, and `createCatalogView` by passing an injected root element; `/app` links `assets/training-statistics.css`. Repertoire's Log adds the sequence as a round to the Log training draft and opens Log training.
- **R14 — Group page.** `#/group/<id>` serves members, coaches, and owners of the group in this plan. Non-members see "This group isn't available." until Plan 3 replaces that branch with the Discover group card. The tab highlight for `#/group/*` stays Discover (router unchanged).
- **R15 — Links.** Member-invitation and discovery links keep pointing at `/dashboard?member_invite=…` and `/dashboard?group_link=…`; the classic dashboard handles them until Plan 4 makes `/dashboard` serve the new app (Plan 4 ports the handling).
- **R16 — Join requests I sent** (list and cancel) move to Plan 3 with request-to-join on the group card.
- **R17 — Coaching connections.** Student side ("Coaches": find a coach, accept or decline a coach's request, end) lives in Me → Groups. Coach side (requests from students, Find a student) lives in Teaching.
- **R18 — Photos.** Welcome and Settings upload a profile photo with a local preview; avatars elsewhere stay initials in this plan.
- **R19 — Settings → Profile.** Settings gains a Profile section (name, photo, timezone, leaderboard visibility) because tapping the Me header opens profile settings. A timezone change applies to the running app immediately.
- **R20 — Teaching access.** Teaching routes redirect to Me only when the mode is Train **and** the person has no coach profile. Me lists Teaching only in Both and Teach.
- **R21 — Students** are active coaching connections where the person is the coach (direct or through a group) plus active members of groups the person coaches, without the person themself. A personal class uses the direct connection when there is one, otherwise the group.
- **R22 — Welcome is a detail screen**: the tab bar is hidden on phones and there is no back button.

## Review Focus

1. **Changing mode while offline or when `set_usage_mode` fails** — the slider snaps back to the saved mode, the reason is shown, and the Teaching row and **+** stay as they were. Pinned in Task 5.
2. **Finish class tapped twice, or the class was already finished on another device** — exactly one occurrence is recorded; a finished class shows "This class was already finished" with a link to it instead of the Finish bar. Pinned in Task 9.
3. **A coach unchecks everyone and taps Finish class** — nothing is recorded and the page says to mark at least one person. Pinned in Task 9.
4. **A start time that is in the future or does not exist (DST gap)** in Log training or Record a past class — the save is refused with a readable reason and the draft is kept. Pinned in Tasks 6 and 8.
5. **Welcome fails after the photo uploaded** (for example `complete_my_profile` times out) — the person stays on the welcome with the reason; Finish again does not upload the photo twice and still completes. Pinned in Task 4.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `supabase/migrations/202610120001_usage_mode.sql` | `profiles.usage_mode`, backfill, `set_usage_mode` |
| `supabase/migrations/202610120002_teaching_read_api.sql` | `list_my_calendar`, `get_scheduled_class`, `occurrence_resource_kinds` helper |
| `supabase/tests/0017_usage_mode.test.sql`, `supabase/tests/0018_teaching_read_api.test.sql` | DB tests |
| `src/app/shell/access.js` | `MODES`, `modeOf`, `listsTeaching`, `isTeachingRoute`, `redirectFor`, `plusActions` |
| `src/app/screens/mode-slider.js` | Train · Both · Teach control (Me and Welcome) |
| `src/app/screens/profile-form.js` | Name, photo, timezone, leaderboard fields; `nameProblem`, `saveProfile` |
| `src/app/screens/welcome.js` | `#/welcome`, `welcomeSteps()` |
| `src/app/screens/start-time.js` | `localClock`, `defaultStartTime`, `startInstant` |
| `src/app/screens/resource-queue.js` | Save resources after a training or queue them for the training page |
| `src/app/screens/teaching-state.js` | `coachGroups`, `coachStudents`, `studentContext`, `pendingStudentRequests`, `loadTeaching` |
| `src/app/screens/schedule-sheet.js` | Schedule a class sheet |
| `src/app/screens/plus-menu.js` | **+** sheet for Both and Teach |
| `src/app/screens/record-class.js` | Record a past class page |
| `src/app/screens/class.js` | Coach's class page |
| `src/app/screens/teaching.js` | `#/me/teaching` |
| `src/app/screens/plan.js` | `#/me/teaching/plans/<id>` |
| `src/app/screens/confirm-button.js` | Second-tap confirmation for destructive buttons |
| `src/app/screens/people-search.js` | Find a coach / Find a student sheet |
| `src/app/screens/student.js` | `#/me/teaching/students/<id>` |
| `src/app/screens/progress.js`, `repertoire.js`, `catalog.js` | Me subpages wrapping the classic views |
| `src/app/screens/group-form.js` | Create / edit group sheet |
| `src/app/screens/groups.js` | `#/me/groups` (groups and coaches) |
| `src/app/screens/group.js` | `#/group/<id>` (info, coach tools, leave) |
| `src/app/screens/link-box.js` | Read-only link with Copy and email share |
| `src/app/screens/group-owner.js` | Owner tools on the group page |
| `tests/unit/app-test-context.js`, `tests/e2e/app-helpers.js` | Shared test helpers |

Modified: `src/app/profile-service.js`, `src/app/training-service.js`, `src/app/testing/fake-services.js`, `src/app/demo-data.js`, `src/app/app-startup.js`, `src/app/shell/router.js`, `src/app/shell/layout.js`, `src/app/entries/app.js`, `src/app/screens/me.js`, `today.js`, `today-state.js`, `calendar.js`, `log.js`, `training.js`, `src/app/ui/statistics-view.js`, `repertoire-view.js`, `catalog-view.js`, `src/app/sw/cache-policy.js`, `src/app/dashboard-i18n.js`, `app.html`, `assets/app.css`, `README.md`.

Screen contract (unchanged from Plan 1, extended in Task 3): `async render<Name>(ctx, route) → HTMLElement`, where `ctx = { document, window, i18n, services, profile, timezone, user, navigate(path), replace(path), back(fallback), today() → 'YYYY-MM-DD', now() → Date, getTermMappings(), refreshTermMappings(), isCoach() → boolean, markCoach(), openSheet(options) }`. `ctx.profile` is a live object: screens that change the profile assign into it.

---

### Task 1: Usage mode in the database and the profile service

**Files:**
- Create: `supabase/migrations/202610120001_usage_mode.sql`, `supabase/tests/0017_usage_mode.test.sql`
- Modify: `src/app/profile-service.js`, `src/app/testing/fake-services.js` (`createE2EProfileService`), `src/app/demo-data.js`
- Test: `tests/unit/profile-service.test.js`, `tests/unit/demo-data.test.js`

**Interfaces:**
- Produces (SQL): column `public.profiles.usage_mode text not null default 'train'` with check `usage_mode in ('train','both','teach')`; `private.set_usage_mode(actor uuid, mode text) → jsonb` and `public.set_usage_mode(mode text) → jsonb` returning `{ status: 'updated', usage_mode, coach_profile_created boolean }`; raises `PT401 not_authenticated` without a caller and `P0001 invalid_usage_mode` for anything else than the three modes. Both/Teach insert `public.coach_profiles` when missing; Train never deletes anything.
- Produces (JS): `USAGE_MODES` (`['train','both','teach']`), `requireUsageMode(mode) → mode` (throws `AppError('validation','invalid_usage_mode')`), `profileService.setUsageMode(mode)`; `loadProfile()` rows include `usage_mode`. Fake: same `setUsageMode(mode)`, records `{ type: 'set-usage-mode', mode }`, writes `roda.e2e.profile.usage_mode`, creates `roda.e2e.coachProfile` for Both/Teach; fake `loadProfile()` fills a missing `usage_mode` with `'train'`.
- Produces (demo): the demo profile has `usage_mode: 'both'`; `DEMO_VERSION` becomes `'3'` so existing demo browsers reseed.

- [ ] **Step 1: Write the failing DB test**

```sql
-- supabase/tests/0017_usage_mode.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_column('public', 'profiles', 'usage_mode', 'profiles have a usage mode');
select col_not_null('public', 'profiles', 'usage_mode', 'the usage mode is required');
select col_default_is('public', 'profiles', 'usage_mode', 'train', 'new profiles start in Train');
select has_function('public', 'set_usage_mode', array['text']);
select is(
  (select prosecdef from pg_proc where oid = 'private.set_usage_mode(uuid, text)'::regprocedure),
  true, 'the private function is security definer'
);
select is(
  (select proconfig from pg_proc where oid = 'private.set_usage_mode(uuid, text)'::regprocedure),
  array['search_path=""']::text[], 'the private function has an empty search path'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.set_usage_mode(text)'::regprocedure),
  false, 'the public wrapper is not security definer'
);

select tests.create_user('10000000-0000-0000-0000-000000001701', 'ana17@example.test', 'Ana Dezassete');
select tests.create_user('10000000-0000-0000-0000-000000001702', 'bia17@example.test', 'Bia Dezassete');
select is(
  (select usage_mode from public.profiles where id = '10000000-0000-0000-0000-000000001701'),
  'train', 'a new account starts in Train'
);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001701');
select is((select usage_mode from public.profiles), 'train', 'people read their own mode');
select is(public.set_usage_mode('both') ->> 'coach_profile_created', 'true', 'choosing Both creates the coach profile');
select is((select usage_mode from public.profiles), 'both', 'the mode is saved');
select is((select count(*)::integer from public.coach_profiles), 1, 'the coach profile exists');
select is(public.set_usage_mode('teach') ->> 'coach_profile_created', 'false', 'an existing coach profile is kept');
select public.create_workout_plan(
  'Ginga basics', null, null, 45, null,
  '[{"source_text":"ginga 10 min","movements":[{"movement_key":"ginga","movement_name":"Ginga","segment_key":"m:1"}]}]'::jsonb
) ->> 'plan_id' as plan_id \gset
select is(public.set_usage_mode('train') ->> 'usage_mode', 'train', 'choosing Train is allowed');
select is((select count(*)::integer from public.coach_profiles), 1, 'Train never deletes the coach profile');
select is((select count(*)::integer from public.list_workout_plans()), 1, 'Train never deletes plans');
select throws_ok($$select public.set_usage_mode('coach')$$, 'P0001', 'invalid_usage_mode', 'unknown modes are rejected');
select throws_ok($$select public.set_usage_mode(null)$$, 'P0001', 'invalid_usage_mode', 'a missing mode is rejected');
select throws_ok($$update public.profiles set usage_mode = 'teach'$$, '42501', null, 'clients cannot update the column directly');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001702');
select public.set_usage_mode('teach');

reset role;
select is(
  (select usage_mode from public.profiles where id = '10000000-0000-0000-0000-000000001701'),
  'train', 'one person cannot change another person''s mode'
);
select is(
  (select usage_mode from public.profiles where id = '10000000-0000-0000-0000-000000001702'),
  'teach', 'each person changes only their own mode'
);
select throws_ok(
  $$update public.profiles set usage_mode = 'coach' where id = '10000000-0000-0000-0000-000000001702'$$,
  '23514', null, 'the check constraint rejects unknown modes'
);

reset role;
select tests.set_actor(null, 'anon');
select throws_ok($$select public.set_usage_mode('both')$$, '42501', null, 'anonymous callers are refused');

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx supabase test db supabase/tests/0017_usage_mode.test.sql`
Expected: FAIL — `has_column` fails ("profiles have a usage mode").

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/202610120001_usage_mode.sql
-- Train · Both · Teach changes emphasis, never access (spec "Train · Both · Teach").
alter table public.profiles
  add column usage_mode text not null default 'train';

alter table public.profiles
  add constraint profiles_usage_mode_check check (usage_mode in ('train', 'both', 'teach'));

-- Ruling R2: people who already registered coaching start in Both.
update public.profiles profile
   set usage_mode = 'both'
 where exists (
   select 1 from public.coach_profiles coach where coach.profile_id = profile.id
 );

create function private.set_usage_mode(actor uuid, mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare coach_created boolean := false;
begin
  if actor is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if set_usage_mode.mode is null or set_usage_mode.mode not in ('train', 'both', 'teach') then
    raise exception using errcode = 'P0001', message = 'invalid_usage_mode';
  end if;

  update public.profiles
     set usage_mode = set_usage_mode.mode
   where id = actor;
  if not found then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;

  -- Both and Teach register coaching; Train never removes anything.
  if set_usage_mode.mode in ('both', 'teach') then
    insert into public.coach_profiles (profile_id)
    values (actor)
    on conflict (profile_id) do nothing;
    coach_created := found;
  end if;

  return jsonb_build_object(
    'status', 'updated',
    'usage_mode', set_usage_mode.mode,
    'coach_profile_created', coach_created
  );
end;
$$;

create function public.set_usage_mode(mode text)
returns jsonb
language sql
set search_path = ''
as $$ select private.set_usage_mode(auth.uid(), mode); $$;

revoke execute on function private.set_usage_mode(uuid, text) from public, anon, authenticated;
grant execute on function private.set_usage_mode(uuid, text) to authenticated;
revoke execute on function public.set_usage_mode(text) from public, anon, authenticated;
grant execute on function public.set_usage_mode(text) to authenticated;
```

- [ ] **Step 4: Apply and run the DB tests**

Run: `npx supabase migration up --local && npm run test:db`
Expected: PASS, including `0017_usage_mode.test.sql`.

Then check the backfill once against the local data (expect `0`):

Run: `docker exec supabase_db_roda-fyi psql -U postgres -tAc "select count(*) from public.profiles p where exists (select 1 from public.coach_profiles c where c.profile_id = p.id) and p.usage_mode <> 'both'"`
Expected: `0` (read-only query; it changes nothing).

- [ ] **Step 5: Write the failing service tests**

In `tests/unit/profile-service.test.js`, change the expected select columns on the line that lists `'id, display_name, avatar_path, timezone_override, leaderboard_visible, completed_at, created_at, updated_at'` to:

```js
      ['select', 'profiles', 'id, display_name, avatar_path, timezone_override, leaderboard_visible, usage_mode, completed_at, created_at, updated_at'],
```

Add at the top of the file the imports:

```js
import { createE2EProfileService } from '../../src/app/testing/fake-services.js';
```

and extend the existing `import { createProfileService, detectBrowserTimezone, profilePrefill, resolveTimezoneOverride } ...` with `requireUsageMode, USAGE_MODES`. Then append:

```js
describe('usage mode', () => {
  it('sets the usage mode through the RPC', async () => {
    const { client, calls } = rpcClient({ set_usage_mode: { data: { status: 'updated', usage_mode: 'both' }, error: null } });
    const service = createProfileService(client);
    expect(await service.setUsageMode('both')).toEqual({ status: 'updated', usage_mode: 'both' });
    expect(calls).toEqual([['set_usage_mode', { mode: 'both' }]]);
  });

  it('rejects unknown modes before calling Supabase', async () => {
    const { client, calls } = rpcClient();
    await expect(createProfileService(client).setUsageMode('coach')).rejects.toMatchObject({ code: 'invalid_usage_mode' });
    expect(calls).toEqual([]);
    expect(USAGE_MODES).toEqual(['train', 'both', 'teach']);
    expect(requireUsageMode('teach')).toBe('teach');
  });

  it('stores the mode and registers coaching in the local fake', async () => {
    const values = new Map([['roda.e2e.profile', JSON.stringify({ id: 'practitioner-1', display_name: 'Ana', completed_at: null })]]);
    const window = {
      localStorage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) },
      __RODA_E2E_EVENTS__: [],
    };
    const service = createE2EProfileService({ window });
    expect((await service.loadProfile()).usage_mode).toBe('train');
    expect(await service.setUsageMode('teach')).toEqual({ status: 'updated', usage_mode: 'teach', coach_profile_created: true });
    expect((await service.loadProfile()).usage_mode).toBe('teach');
    expect(await service.loadCoachProfile()).toMatchObject({ profile_id: 'practitioner-1' });
    expect(await service.setUsageMode('train')).toMatchObject({ coach_profile_created: false });
    expect(await service.loadCoachProfile()).not.toBeNull();
    expect(window.__RODA_E2E_EVENTS__).toContainEqual({ type: 'set-usage-mode', mode: 'train' });
  });
});
```

In `tests/unit/demo-data.test.js`, change the first profile expectation to:

```js
    expect(profile).toMatchObject({ id: 'practitioner-1', usage_mode: 'both', completed_at: expect.any(String) });
```

- [ ] **Step 6: Run to verify they fail**

Run: `npx vitest run tests/unit/profile-service.test.js tests/unit/demo-data.test.js`
Expected: FAIL — `setUsageMode is not a function`, the columns differ, and `usage_mode` is missing from the demo profile.

- [ ] **Step 7: Implement**

In `src/app/profile-service.js`, below `resolveTimezoneOverride`, add:

```js
export const USAGE_MODES = Object.freeze(['train', 'both', 'teach']);

export function requireUsageMode(mode) {
  if (!USAGE_MODES.includes(mode)) {
    throw new AppError('validation', 'invalid_usage_mode', 'Choose Train, Both, or Teach.');
  }
  return mode;
}
```

Replace the `PROFILE_COLUMNS` constant with:

```js
const PROFILE_COLUMNS = 'id, display_name, avatar_path, timezone_override, leaderboard_visible, usage_mode, completed_at, created_at, updated_at';
```

Inside the object returned by `createProfileService`, after `registerAsCoach()`, add:

```js
    async setUsageMode(mode) {
      return unwrap(await client.rpc('set_usage_mode', { mode: requireUsageMode(mode) }));
    },
```

In `src/app/testing/fake-services.js`, change the profile-service import line to:

```js
import { requireUsageMode, resolveTimezoneOverride } from '../profile-service.js';
```

In `createE2EProfileService`, replace `if (saved) return saved;` with `if (saved) return { usage_mode: 'train', ...saved };`, add `usage_mode: 'train',` to the default profile object after `leaderboard_visible: true,`, and add after `registerAsCoach()`:

```js
    async setUsageMode(mode) {
      requireUsageMode(mode);
      const current = JSON.parse(storage.getItem('roda.e2e.profile') ?? '{}');
      storage.setItem('roda.e2e.profile', JSON.stringify({ ...current, usage_mode: mode }));
      let created = false;
      if (mode !== 'train' && !JSON.parse(storage.getItem('roda.e2e.coachProfile') ?? 'null')) {
        storage.setItem('roda.e2e.coachProfile', JSON.stringify({
          profile_id: current.id ?? 'practitioner-1', activated_at: '2026-10-12T12:00:00Z',
        }));
        created = true;
      }
      record({ type: 'set-usage-mode', mode });
      return { status: 'updated', usage_mode: mode, coach_profile_created: created };
    },
```

In `src/app/demo-data.js`, change `const DEMO_VERSION = '2';` to `const DEMO_VERSION = '3';` and add `usage_mode: 'both',` to the demo `profile` object after `graduation: 'Aluno',`.

- [ ] **Step 8: Run the unit tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/202610120001_usage_mode.sql supabase/tests/0017_usage_mode.test.sql \
  src/app/profile-service.js src/app/testing/fake-services.js src/app/demo-data.js \
  tests/unit/profile-service.test.js tests/unit/demo-data.test.js
git commit -m "feat: store Train, Both, or Teach on the profile

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Teaching read API (coach's classes in the calendar, class page data)

**Files:**
- Create: `supabase/migrations/202610120002_teaching_read_api.sql`, `supabase/tests/0018_teaching_read_api.test.sql`
- Modify: `src/app/training-service.js`, `src/app/testing/fake-services.js` (`createE2ETrainingService`)
- Test: `tests/unit/training-service.test.js`

**Interfaces:**
- Produces (SQL): `public.list_my_calendar(month_start date, month_end date)` returning the 13 columns of `list_training_calendar` (`item_id, item_type, local_date, kind, status, starts_at, duration_minutes, group_id, group_name, coach_profile_id, coach_name, visible_in_advance, plan_title`) plus `role text` (`'participant'|'coach'`) and `resource_kinds jsonb` (sorted kinds for completed items, `[]` for scheduled). Rows: the caller's own calendar, plus scheduled classes the caller arranged that the own calendar does not already list, plus completed non-alone occurrences the caller recorded but did not attend. Ordered by `local_date, starts_at, item_id`.
- Produces (SQL): `public.get_scheduled_class(schedule_id uuid) → jsonb` `{ schedule_id, kind, state, local_date, timezone, starts_at, duration_minutes, visible_in_advance, group_id, group_name, student_profile_id, student_name, plan_id, plan_title, plan_version_id, instructions, rounds, people: [{ profile_id, display_name }], occurrence_id }`; `PT403 not_authorized` unless `private.can_manage_schedule(caller, schedule)`. `people` = active `member` memberships of the group without the caller, or the one student.
- Produces (JS, real and fake): `training.listMyCalendar({ start, endExclusive })`, `training.getScheduledClass(scheduleId)`.

- [ ] **Step 1: Write the failing DB test**

```sql
-- supabase/tests/0018_teaching_read_api.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_function('public', 'list_my_calendar', array['date', 'date']);
select has_function('public', 'get_scheduled_class', array['uuid']);

select tests.create_user('10000000-0000-0000-0000-000000001801', 'coach18@example.test', 'Mestre Dezoito');
select tests.create_user('10000000-0000-0000-0000-000000001802', 'ana18@example.test', 'Ana Dezoito');
select tests.create_user('10000000-0000-0000-0000-000000001803', 'bia18@example.test', 'Bia Dezoito');
select tests.create_user('10000000-0000-0000-0000-000000001804', 'caio18@example.test', 'Caio Dezoito');
insert into public.coach_profiles (profile_id) values ('10000000-0000-0000-0000-000000001801');
insert into public.groups (id, owner_id, name, timezone)
values ('20000000-0000-0000-0000-000000001801', '10000000-0000-0000-0000-000000001801', 'Grupo Dezoito', 'Europe/Lisbon');
insert into public.group_memberships (group_id, profile_id, access_level) values
  ('20000000-0000-0000-0000-000000001801', '10000000-0000-0000-0000-000000001801', 'coach'),
  ('20000000-0000-0000-0000-000000001801', '10000000-0000-0000-0000-000000001802', 'member'),
  ('20000000-0000-0000-0000-000000001801', '10000000-0000-0000-0000-000000001803', 'member');
insert into public.coach_student_connections (
  id, coach_profile_id, student_profile_id, state, initiated_by, decided_at, decided_by
) values (
  '40000000-0000-0000-0000-000000001801', '10000000-0000-0000-0000-000000001801',
  '10000000-0000-0000-0000-000000001802', 'active', '10000000-0000-0000-0000-000000001802',
  now(), '10000000-0000-0000-0000-000000001801'
);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001801');
select public.create_workout_plan(
  'Armada ladder', null, null, 60, 'Stay loose',
  '[{"source_text":"10x (armada, au)","movements":[{"movement_key":"armada","movement_name":"Armada","segment_key":"m:1"}]}]'::jsonb
) ->> 'plan_id' as plan_id \gset
select public.publish_workout_plan(:'plan_id') ->> 'version_id' as version_id \gset
select public.schedule_personal_class(
  :'version_id', '10000000-0000-0000-0000-000000001802', null, '40000000-0000-0000-0000-000000001801',
  '2026-10-20T18:00:00Z', '2026-10-20', 'Europe/Lisbon', true
) ->> 'schedule_id' as personal_id \gset
select public.schedule_group_training(
  :'version_id', '20000000-0000-0000-0000-000000001801',
  '2026-10-21T18:00:00Z', '2026-10-21', 'Europe/Lisbon', true
) ->> 'schedule_id' as group_schedule_id \gset
select public.record_past_class('group', '20000000-0000-0000-0000-000000001801', null, null,
  '2026-10-05T18:00:00Z', '2026-10-05', 'Europe/Lisbon', 60,
  '[{"profile_id":"10000000-0000-0000-0000-000000001802","duration_minutes":60}]'::jsonb,
  '[{"source_text":"ginga 10 min","movements":[{"movement_key":"ginga","movement_name":"Ginga","segment_key":"m:1"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000001801') ->> 'occurrence_id' as class_id \gset
select public.add_training_resource(:'class_id', 'video', 'Recording', 'https://youtu.be/VAI3JUKTwz0', null);

select is((select count(*)::integer from public.list_my_calendar('2026-10-01', '2026-11-01')), 3,
  'the coach sees the personal class, the group class, and the class they taught');
select is((select role from public.list_my_calendar('2026-10-01', '2026-11-01') where item_id = :'personal_id'),
  'coach', 'the personal class they arranged is listed as coaching');
select is((select count(*)::integer from public.list_my_calendar('2026-10-01', '2026-11-01') where item_id = :'group_schedule_id'),
  1, 'a group class appears once even though the coach is a member');
select is((select role from public.list_my_calendar('2026-10-01', '2026-11-01') where item_id = :'group_schedule_id'),
  'coach', 'the group class they arranged is listed as coaching');
select is((select plan_title from public.list_my_calendar('2026-10-01', '2026-11-01') where item_id = :'personal_id'),
  'Armada ladder', 'coaching items carry the plan title');
select is((select item_type from public.list_my_calendar('2026-10-01', '2026-11-01') where item_id = :'class_id'),
  'completed', 'the taught class is a completed item');
select is((select resource_kinds from public.list_my_calendar('2026-10-01', '2026-11-01') where item_id = :'class_id'),
  '["video"]'::jsonb, 'taught classes list their resource kinds');
select is(public.get_scheduled_class(:'group_schedule_id') ->> 'plan_title', 'Armada ladder', 'the class page has the plan title');
select is(jsonb_array_length(public.get_scheduled_class(:'group_schedule_id') -> 'rounds'), 1, 'the plan rounds are included');
select is(jsonb_array_length(public.get_scheduled_class(:'group_schedule_id') -> 'people'), 2,
  'a group class lists its members but not the coach');
select is(public.get_scheduled_class(:'personal_id') -> 'people' -> 0 ->> 'display_name', 'Ana Dezoito',
  'a personal class lists its student');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001802');
select is((select count(*)::integer from public.list_my_calendar('2026-10-01', '2026-11-01')), 3,
  'the student sees their personal class, the group class, and the class they attended');
select is((select role from public.list_my_calendar('2026-10-01', '2026-11-01') where item_id = :'personal_id'),
  'participant', 'students see their classes as participants');
select is((select resource_kinds from public.list_my_calendar('2026-10-01', '2026-11-01') where item_id = :'class_id'),
  '["video"]'::jsonb, 'attended classes list their resource kinds');
select throws_ok(format($$select public.get_scheduled_class(%L)$$, :'group_schedule_id'), 'PT403', 'not_authorized',
  'students cannot open the coach''s class page');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001804');
select is((select count(*)::integer from public.list_my_calendar('2026-10-01', '2026-11-01')), 0, 'outsiders see nothing');
select throws_ok(format($$select public.get_scheduled_class(%L)$$, :'personal_id'), 'PT403', 'not_authorized',
  'outsiders cannot open a class page');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000001801');
select public.cancel_scheduled_training(:'personal_id', null);
select is(public.get_scheduled_class(:'personal_id') ->> 'state', 'cancelled', 'a cancelled class reports its state');
select is((select count(*)::integer from public.list_my_calendar('2026-10-01', '2026-11-01') where item_id = :'personal_id'),
  0, 'cancelled classes leave the calendar');

reset role;
select tests.set_actor(null, 'anon');
select throws_ok($$select * from public.list_my_calendar('2026-10-01', '2026-11-01')$$, '42501', null, 'anonymous callers are refused');

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx supabase test db supabase/tests/0018_teaching_read_api.test.sql`
Expected: FAIL — `has_function` fails for `list_my_calendar`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/202610120002_teaching_read_api.sql
-- Ruling R3: the app's calendar includes classes the caller teaches, without
-- changing list_training_calendar, which the classic dashboard depends on.
create function private.occurrence_resource_kinds(target_occurrence_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(distinct resource.kind order by resource.kind), '[]'::jsonb)
    from public.training_resources resource
   where resource.occurrence_id = target_occurrence_id;
$$;

create function private.list_my_calendar(actor_id uuid, range_start date, range_end_exclusive date)
returns table (
  item_id uuid,
  item_type text,
  local_date date,
  kind text,
  status text,
  starts_at timestamptz,
  duration_minutes integer,
  group_id uuid,
  group_name text,
  coach_profile_id uuid,
  coach_name text,
  visible_in_advance boolean,
  plan_title text,
  role text,
  resource_kinds jsonb
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

  return query
  select own.item_id, own.item_type, own.local_date, own.kind, own.status, own.starts_at,
         own.duration_minutes, own.group_id, own.group_name, own.coach_profile_id,
         own.coach_name, own.visible_in_advance, own.plan_title,
         case when own.item_type = 'scheduled' and own.coach_profile_id = actor_id
              then 'coach'::text else 'participant'::text end,
         case when own.item_type = 'completed'
              then private.occurrence_resource_kinds(own.item_id) else '[]'::jsonb end
    from private.list_training_calendar(actor_id, range_start, range_end_exclusive, null) own
  union all
  -- Classes the caller arranged that the own calendar does not list:
  -- personal classes, and group classes of groups the caller is not a member of.
  select schedule.id, 'scheduled'::text, schedule.local_date, schedule.kind::text,
         schedule.state::text, schedule.starts_at, schedule.expected_duration_minutes,
         schedule.group_id, target_group.name, schedule.arranged_by, coach.display_name,
         schedule.visible_in_advance, plan.title, 'coach'::text, '[]'::jsonb
    from public.scheduled_trainings schedule
    join public.workout_plan_versions version on version.id = schedule.plan_version_id
    join public.workout_plans plan on plan.id = version.plan_id
    left join public.groups target_group on target_group.id = schedule.group_id
    left join public.profiles coach on coach.id = schedule.arranged_by
   where schedule.arranged_by = actor_id
     and schedule.state = 'scheduled'
     and schedule.local_date >= range_start
     and schedule.local_date < range_end_exclusive
     and not (schedule.kind = 'group' and exists (
       select 1 from public.group_memberships membership
        where membership.group_id = schedule.group_id
          and membership.profile_id = actor_id
          and membership.state = 'active'
     ))
  union all
  -- Classes the caller taught and recorded without attending them.
  select occurrence.id, 'completed'::text, occurrence.local_date, occurrence.kind::text,
         'completed'::text, occurrence.occurred_at, occurrence.default_duration_minutes,
         occurrence.group_id, target_group.name, occurrence.recorded_by, coach.display_name,
         true, plan.title, 'coach'::text, private.occurrence_resource_kinds(occurrence.id)
    from public.training_occurrences occurrence
    left join public.groups target_group on target_group.id = occurrence.group_id
    left join public.profiles coach on coach.id = occurrence.recorded_by
    left join public.scheduled_trainings schedule on schedule.id = occurrence.schedule_id
    left join public.workout_plan_versions version on version.id = schedule.plan_version_id
    left join public.workout_plans plan on plan.id = version.plan_id
   where occurrence.recorded_by = actor_id
     and occurrence.kind::text <> 'alone'
     and occurrence.local_date >= range_start
     and occurrence.local_date < range_end_exclusive
     and exists (
       select 1 from public.training_participations attendee
        where attendee.occurrence_id = occurrence.id
     )
     and not exists (
       select 1 from public.training_participations mine
        where mine.occurrence_id = occurrence.id and mine.profile_id = actor_id
     )
   order by 3, 6, 1;
end;
$$;

-- Ruling R4: only the coach who arranged a class reads its class page.
create function private.get_scheduled_class(actor_id uuid, target_schedule_id uuid)
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
  if not private.can_manage_schedule(actor_id, target_schedule_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;

  select jsonb_build_object(
    'schedule_id', schedule.id,
    'kind', schedule.kind::text,
    'state', schedule.state::text,
    'local_date', schedule.local_date,
    'timezone', schedule.timezone,
    'starts_at', schedule.starts_at,
    'duration_minutes', schedule.expected_duration_minutes,
    'visible_in_advance', schedule.visible_in_advance,
    'group_id', schedule.group_id,
    'group_name', target_group.name,
    'student_profile_id', schedule.student_profile_id,
    'student_name', student.display_name,
    'plan_id', plan.id,
    'plan_title', plan.title,
    'plan_version_id', version.id,
    'instructions', version.instructions,
    'rounds', private.plan_rounds_json(version.id),
    'people', case
      when schedule.kind::text = 'group' then (
        select coalesce(jsonb_agg(jsonb_build_object(
          'profile_id', membership.profile_id, 'display_name', person.display_name
        ) order by person.display_name, membership.profile_id), '[]'::jsonb)
          from public.group_memberships membership
          join public.profiles person on person.id = membership.profile_id
         where membership.group_id = schedule.group_id
           and membership.state = 'active'
           and membership.access_level = 'member'
           and membership.profile_id <> actor_id
      )
      else jsonb_build_array(jsonb_build_object(
        'profile_id', schedule.student_profile_id, 'display_name', student.display_name
      ))
    end,
    'occurrence_id', (
      select occurrence.id from public.training_occurrences occurrence
       where occurrence.schedule_id = schedule.id
       limit 1
    )
  ) into result
  from public.scheduled_trainings schedule
  join public.workout_plan_versions version on version.id = schedule.plan_version_id
  join public.workout_plans plan on plan.id = version.plan_id
  left join public.groups target_group on target_group.id = schedule.group_id
  left join public.profiles student on student.id = schedule.student_profile_id
  where schedule.id = target_schedule_id;
  return result;
end;
$$;

create function public.list_my_calendar(month_start date, month_end date)
returns table (
  item_id uuid,
  item_type text,
  local_date date,
  kind text,
  status text,
  starts_at timestamptz,
  duration_minutes integer,
  group_id uuid,
  group_name text,
  coach_profile_id uuid,
  coach_name text,
  visible_in_advance boolean,
  plan_title text,
  role text,
  resource_kinds jsonb
)
language sql
stable
set search_path = ''
as $$ select * from private.list_my_calendar(auth.uid(), month_start, month_end); $$;

create function public.get_scheduled_class(schedule_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$ select private.get_scheduled_class(auth.uid(), schedule_id); $$;

revoke execute on function private.occurrence_resource_kinds(uuid) from public, anon, authenticated;
revoke execute on function private.list_my_calendar(uuid, date, date) from public, anon, authenticated;
revoke execute on function private.get_scheduled_class(uuid, uuid) from public, anon, authenticated;
grant execute on function private.list_my_calendar(uuid, date, date) to authenticated;
grant execute on function private.get_scheduled_class(uuid, uuid) to authenticated;
revoke execute on function public.list_my_calendar(date, date) from public, anon, authenticated;
revoke execute on function public.get_scheduled_class(uuid) from public, anon, authenticated;
grant execute on function public.list_my_calendar(date, date) to authenticated;
grant execute on function public.get_scheduled_class(uuid) to authenticated;
```

- [ ] **Step 4: Apply and run the DB tests**

Run: `npx supabase migration up --local && npm run test:db`
Expected: PASS, including `0018_teaching_read_api.test.sql` and the unchanged `0008_training_lifecycle.test.sql`.

- [ ] **Step 5: Write the failing service tests**

Add to `tests/unit/training-service.test.js` (inside the top-level `describe`; `harness()` and `createE2ETrainingService` are already imported there):

```js
  it('reads my calendar and one scheduled class', async () => {
    const { client, calls } = harness();
    const service = createTrainingService(client);
    await service.listMyCalendar({ start: '2026-10-01', endExclusive: '2026-11-01' });
    await service.getScheduledClass('s-1');
    expect(calls).toEqual([
      ['list_my_calendar', { month_start: '2026-10-01', month_end: '2026-11-01' }],
      ['get_scheduled_class', { schedule_id: 's-1' }],
    ]);
    await expect(service.listMyCalendar({ start: 'soon', endExclusive: '2026-11-01' }))
      .rejects.toMatchObject({ code: 'invalid_local_date' });
  });

  it('lists the classes a coach arranged and serves the class page from the local fake', async () => {
    const values = new Map([
      ['roda.e2e.session', JSON.stringify({ user: { id: 'coach-1' } })],
      ['roda.e2e.coachProfile', JSON.stringify({ profile_id: 'coach-1' })],
      ['roda.e2e.groupState', JSON.stringify({
        groups: [{ id: 'g1', name: 'Grupo Lua' }],
        rosters: { g1: [
          { profile_id: 'coach-1', display_name: 'Mestre', access_level: 'coach', membership_state: 'active' },
          { profile_id: 'ana', display_name: 'Ana', access_level: 'member', membership_state: 'active' },
        ] },
      })],
      ['roda.e2e.connectionState', JSON.stringify({ people: { bia: 'Bia' } })],
    ]);
    const window = { localStorage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) } };
    const service = createE2ETrainingService({ window });
    const plan = await service.createPlan({ title: 'Ladder', durationMinutes: 60, rounds: [{ source_text: 'ginga', movements: [] }] });
    await service.publishPlan(plan.plan_id);
    const personal = await service.schedulePersonalClass({
      planVersionId: plan.version_id, studentProfileId: 'bia', connectionId: 'c1',
      startsAt: '2026-10-20T18:00:00Z', localDate: '2026-10-20', timezone: 'UTC',
    });
    const group = await service.scheduleGroupTraining({
      planVersionId: plan.version_id, groupId: 'g1', startsAt: '2026-10-21T18:00:00Z', localDate: '2026-10-21', timezone: 'UTC',
    });
    const rows = await service.listMyCalendar({ start: '2026-10-01', endExclusive: '2026-11-01' });
    expect(rows.map(({ item_id: id, role }) => [id, role])).toEqual([
      [personal.schedule_id, 'coach'], [group.schedule_id, 'coach'],
    ]);
    expect(rows[0]).toMatchObject({ plan_title: 'Ladder', resource_kinds: [] });
    const page = await service.getScheduledClass(group.schedule_id);
    expect(page).toMatchObject({ kind: 'group', state: 'scheduled', plan_title: 'Ladder', group_name: 'Grupo Lua' });
    expect(page.people).toEqual([{ profile_id: 'ana', display_name: 'Ana' }]);
    expect((await service.getScheduledClass(personal.schedule_id)).people).toEqual([{ profile_id: 'bia', display_name: 'Bia' }]);
    values.set('roda.e2e.session', JSON.stringify({ user: { id: 'ana' } }));
    await expect(service.getScheduledClass(group.schedule_id)).rejects.toMatchObject({ kind: 'authorization' });
  });
```

- [ ] **Step 6: Run to verify they fail**

Run: `npx vitest run tests/unit/training-service.test.js`
Expected: FAIL — `service.listMyCalendar is not a function`.

- [ ] **Step 7: Implement the real service**

In `src/app/training-service.js`, inside the returned object after `listCalendar`, add:

```js
    async listMyCalendar(input) {
      return call('list_my_calendar', {
        month_start: requireLocalDate(input.start),
        month_end: requireLocalDate(input.endExclusive),
      });
    },
    async getScheduledClass(scheduleId) {
      return call('get_scheduled_class', { schedule_id: scheduleId });
    },
```

- [ ] **Step 8: Implement the fake**

In `createE2ETrainingService` in `src/app/testing/fake-services.js`, add these helpers after `coachName`:

```js
  function personName(profileId) {
    const people = JSON.parse(storage.getItem('roda.e2e.connectionState') ?? '{}').people ?? {};
    if (people[profileId]) return people[profileId];
    const rosters = JSON.parse(storage.getItem('roda.e2e.groupState') ?? '{}').rosters ?? {};
    const member = Object.values(rosters).flat().find(({ profile_id: id }) => id === profileId);
    return member?.display_name ?? null;
  }

  function resourceKinds(state, occurrenceId) {
    return [...new Set(state.resources
      .filter(({ occurrence_id: id }) => id === occurrenceId).map(({ kind }) => kind))].sort();
  }

  function calendarRows(state, profileId, input) {
    const completed = state.participations
      .filter(({ profile_id: id }) => id === profileId)
      .map((participation) => {
        const occurrence = state.occurrences.find(({ id }) => id === participation.occurrence_id);
        return {
          item_id: occurrence.id, item_type: 'completed',
          local_date: occurrence.local_date, kind: occurrence.kind,
          status: 'completed', starts_at: occurrence.occurred_at,
          duration_minutes: participation.actual_duration_minutes,
          group_id: occurrence.group_id,
          coach_profile_id: occurrence.recorded_by,
          group_name: groupName(occurrence.group_id),
        };
      });
    const upcoming = state.schedules
      .filter(({ state: status }) => status === 'scheduled')
      .filter((schedule) => schedule.student_profile_id === profileId
        || (schedule.kind === 'group' && groupRoster(schedule.group_id)
          .some(({ profile_id: id }) => id === profileId)))
      .map((schedule) => ({
        item_id: schedule.id, item_type: 'scheduled',
        local_date: schedule.local_date, kind: schedule.kind,
        status: schedule.state, starts_at: schedule.starts_at,
        duration_minutes: schedule.duration_minutes,
        group_id: schedule.group_id,
        visible_in_advance: schedule.visible_in_advance,
        coach_profile_id: schedule.arranged_by,
        group_name: groupName(schedule.group_id),
        plan_title: state.plans.find(({ version_id: id }) => id === schedule.plan_version_id)?.title ?? null,
      }));
    return [...completed, ...upcoming]
      .filter(({ local_date: date }) => date >= input.start && date < input.endExclusive)
      .sort((left, right) => left.starts_at.localeCompare(right.starts_at));
  }
```

Replace the whole body of the existing `async listCalendar(input) { ... }` with:

```js
    async listCalendar(input) {
      const state = readState();
      guard(state, 'listCalendar', { read: true });
      return calendarRows(state, input.profileId ?? actorId(), input);
    },

    async listMyCalendar(input) {
      const state = readState();
      guard(state, 'listMyCalendar', { read: true });
      const me = actorId();
      const inRange = (date) => date >= input.start && date < input.endExclusive;
      const own = calendarRows(state, me, input).map((row) => ({
        ...row,
        role: row.item_type === 'scheduled' && row.coach_profile_id === me ? 'coach' : 'participant',
        resource_kinds: row.item_type === 'completed' ? resourceKinds(state, row.item_id) : [],
      }));
      const listed = new Set(own.map(({ item_id: id }) => id));
      const arranged = state.schedules
        .filter((schedule) => schedule.state === 'scheduled' && schedule.arranged_by === me
          && !listed.has(schedule.id) && inRange(schedule.local_date))
        .map((schedule) => ({
          item_id: schedule.id, item_type: 'scheduled', local_date: schedule.local_date,
          kind: schedule.kind, status: 'scheduled', starts_at: schedule.starts_at,
          duration_minutes: schedule.duration_minutes, group_id: schedule.group_id,
          group_name: groupName(schedule.group_id), coach_profile_id: me, coach_name: coachName(me),
          visible_in_advance: schedule.visible_in_advance,
          plan_title: state.plans.find(({ version_id: id }) => id === schedule.plan_version_id)?.title ?? null,
          role: 'coach', resource_kinds: [],
        }));
      const taught = state.occurrences
        .filter((occurrence) => occurrence.recorded_by === me && occurrence.kind !== 'alone'
          && !listed.has(occurrence.id) && inRange(occurrence.local_date)
          && state.participations.some(({ occurrence_id: id }) => id === occurrence.id)
          && !state.participations.some(({ occurrence_id: id, profile_id: who }) => id === occurrence.id && who === me))
        .map((occurrence) => ({
          item_id: occurrence.id, item_type: 'completed', local_date: occurrence.local_date,
          kind: occurrence.kind, status: 'completed', starts_at: occurrence.occurred_at,
          duration_minutes: occurrence.default_duration_minutes, group_id: occurrence.group_id,
          group_name: groupName(occurrence.group_id), coach_profile_id: me, coach_name: coachName(me),
          visible_in_advance: true, plan_title: null, role: 'coach',
          resource_kinds: resourceKinds(state, occurrence.id),
        }));
      return [...own, ...arranged, ...taught].sort((left, right) => left.starts_at.localeCompare(right.starts_at));
    },

    async getScheduledClass(scheduleId) {
      const state = readState();
      guard(state, 'getScheduledClass', { read: true });
      const schedule = state.schedules.find(({ id }) => id === scheduleId);
      if (!schedule || schedule.arranged_by !== actorId()) throw new AppError('authorization', 'not_authorized');
      const plan = state.plans.find(({ version_id: id }) => id === schedule.plan_version_id);
      const people = schedule.kind === 'group'
        ? groupRoster(schedule.group_id)
          .filter((member) => member.access_level === 'member' && member.profile_id !== actorId()
            && (member.membership_state ?? 'active') === 'active')
          .map(({ profile_id: profileId, display_name: displayName }) => ({ profile_id: profileId, display_name: displayName }))
        : [{ profile_id: schedule.student_profile_id, display_name: personName(schedule.student_profile_id) }];
      return {
        schedule_id: schedule.id, kind: schedule.kind, state: schedule.state,
        local_date: schedule.local_date, timezone: schedule.timezone, starts_at: schedule.starts_at,
        duration_minutes: schedule.duration_minutes, visible_in_advance: schedule.visible_in_advance,
        group_id: schedule.group_id, group_name: groupName(schedule.group_id),
        student_profile_id: schedule.student_profile_id, student_name: personName(schedule.student_profile_id),
        plan_id: plan?.plan_id ?? null, plan_title: plan?.title ?? null, plan_version_id: schedule.plan_version_id,
        instructions: plan?.instructions ?? null, rounds: structuredClone(plan?.rounds ?? []), people,
        occurrence_id: state.occurrences.find(({ schedule_id: id }) => id === schedule.id)?.id ?? null,
      };
    },
```

- [ ] **Step 9: Run the unit tests**

Run: `npx vitest run`
Expected: PASS (the existing fake-calendar tests still pass because `listCalendar` returns the same rows plus `plan_title` on scheduled items).

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/202610120002_teaching_read_api.sql supabase/tests/0018_teaching_read_api.test.sql \
  src/app/training-service.js src/app/testing/fake-services.js tests/unit/training-service.test.js
git commit -m "feat: list a coach's own classes and read one scheduled class

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Access rules, router queries, and startup with the coach profile

**Files:**
- Create: `src/app/shell/access.js`, `tests/unit/access.test.js`, `tests/unit/app-test-context.js`, `tests/e2e/app-helpers.js`, `tests/e2e/app-access.spec.js`
- Modify: `src/app/shell/router.js`, `src/app/app-startup.js`, `src/app/entries/app.js`
- Test: `tests/unit/router.test.js`, `tests/unit/app-startup.test.js`

**Interfaces:**
- Consumes: `profile.usage_mode` (Task 1), `profile.loadCoachProfile()` (existing).
- Produces (`src/app/shell/access.js`): `MODES`, `modeOf(profile) → 'train'|'both'|'teach'` (missing or unknown → `'train'`), `listsTeaching(mode) → boolean` (Both/Teach), `isTeachingRoute(route) → boolean`, `redirectFor(route, { profile, isCoach }) → string|null`, `plusActions(mode) → Array<'log'|'schedule'|'record'>`.
- Produces (router): `parseRoute(hash)` results gain `query` (object of string values); new route name `'teaching-record'` for `#/me/teaching/record` (detail, Me tab); `'welcome'` becomes a detail route (Ruling R22); `router.replace(path)` replaces the history entry and renders.
- Produces (startup): `loadStartup()` → `{ status: 'ready', session, profile, coachProfile }` (`coachProfile` is `null` when missing or when its load fails).
- Produces (entry): the screen context gains `user`, `replace(path)`, `refreshTermMappings()`, `isCoach()`, `markCoach()`; `ctx.timezone` is a writable property; every route passes through `redirectFor` before rendering.
- Produces (tests): `appCtx(overrides)` in `tests/unit/app-test-context.js`; `ANA`, `seedAccount(page, { profile, coachProfile, extra })`, `openCreate(page, testInfo)` in `tests/e2e/app-helpers.js`.

Ruling R20: Teaching routes redirect to Me only when the mode is Train and the person has no coach profile. Ruling R22: the welcome is a detail screen.

- [ ] **Step 1: Write the failing unit tests**

```js
// tests/unit/access.test.js
import { describe, expect, it } from 'vitest';

import { isTeachingRoute, listsTeaching, modeOf, plusActions, redirectFor } from '../../src/app/shell/access.js';
import { parseRoute } from '../../src/app/shell/router.js';

const done = { id: 'me', completed_at: '2026-09-11T20:00:00Z' };

describe('access rules', () => {
  it('reads the mode with Train as the fallback', () => {
    expect(modeOf({ usage_mode: 'teach' })).toBe('teach');
    expect(modeOf({ usage_mode: 'coach' })).toBe('train');
    expect(modeOf({})).toBe('train');
    expect([listsTeaching('train'), listsTeaching('both'), listsTeaching('teach')]).toEqual([false, true, true]);
  });

  it('recognizes every Teaching route', () => {
    for (const hash of ['#/me/teaching', '#/me/teaching/plans/p', '#/me/teaching/students/s', '#/me/teaching/record']) {
      expect(isTeachingRoute(parseRoute(hash))).toBe(true);
    }
    expect(isTeachingRoute(parseRoute('#/me/groups'))).toBe(false);
  });

  it('sends unfinished profiles to the welcome and finished ones away from it', () => {
    expect(redirectFor(parseRoute('#/calendar'), { profile: { id: 'me' }, isCoach: false })).toBe('/welcome');
    expect(redirectFor(parseRoute('#/welcome'), { profile: { id: 'me' }, isCoach: false })).toBeNull();
    expect(redirectFor(parseRoute('#/welcome'), { profile: done, isCoach: false })).toBe('/');
    expect(redirectFor(parseRoute('#/calendar'), { profile: done, isCoach: false })).toBeNull();
  });

  it('opens Teaching in Both and Teach, and in Train only for coaches', () => {
    const route = parseRoute('#/me/teaching/plans/p1');
    expect(redirectFor(route, { profile: { ...done, usage_mode: 'train' }, isCoach: false })).toBe('/me');
    expect(redirectFor(route, { profile: { ...done, usage_mode: 'train' }, isCoach: true })).toBeNull();
    expect(redirectFor(route, { profile: { ...done, usage_mode: 'both' }, isCoach: false })).toBeNull();
    expect(redirectFor(route, { profile: { ...done, usage_mode: 'teach' }, isCoach: false })).toBeNull();
  });

  it('decides what + offers per mode', () => {
    expect(plusActions('train')).toEqual(['log']);
    expect(plusActions('both')).toEqual(['log', 'schedule', 'record']);
    expect(plusActions('teach')).toEqual(['schedule', 'record']);
  });
});
```

Add to `tests/unit/router.test.js` (inside `describe('router', ...)`):

```js
  it('parses the query and the record route', () => {
    expect(parseRoute('#/training/abc?add=1')).toMatchObject({ name: 'training', params: { id: 'abc' }, query: { add: '1' } });
    expect(parseRoute('#/me/teaching/record')).toMatchObject({ name: 'teaching-record', query: {} });
    expect(tabFor(parseRoute('#/me/teaching/record'))).toBe('me');
    expect(isDetail(parseRoute('#/me/teaching/record'))).toBe(true);
    expect(isDetail(parseRoute('#/welcome'))).toBe(true);
  });

  it('replaces the current entry without adding history', () => {
    window.location.hash = '#/me/teaching';
    const onRoute = vi.fn();
    const router = createRouter({ window, onRoute });
    const before = window.history.length;
    router.replace('/me');
    expect(window.location.hash).toBe('#/me');
    expect(window.history.length).toBe(before);
    expect(onRoute).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'me' }));
  });
```

In `tests/unit/app-startup.test.js`, replace the last test with:

```js
  it('returns the session, profile, and coach profile when ready', async () => {
    const session = { user: { id: 'u' } };
    const profile = { id: 'u' };
    expect(await loadStartup({
      auth: { getSession: vi.fn().mockResolvedValue(session) },
      profile: { loadProfile: vi.fn().mockResolvedValue(profile), loadCoachProfile: vi.fn().mockResolvedValue({ profile_id: 'u' }) },
    })).toEqual({ status: 'ready', session, profile, coachProfile: { profile_id: 'u' } });
  });

  it('treats a failing coach profile load as no coaching', async () => {
    const session = { user: { id: 'u' } };
    expect(await loadStartup({
      auth: { getSession: vi.fn().mockResolvedValue(session) },
      profile: { loadProfile: vi.fn().mockResolvedValue({ id: 'u' }), loadCoachProfile: vi.fn().mockRejectedValue(new Error('offline')) },
    })).toEqual({ status: 'ready', session, profile: { id: 'u' }, coachProfile: null });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/access.test.js tests/unit/router.test.js tests/unit/app-startup.test.js`
Expected: FAIL — `access.js` not found, `query` missing, `router.replace is not a function`, `coachProfile` missing.

- [ ] **Step 3: Implement access rules**

```js
// src/app/shell/access.js
export const MODES = Object.freeze(['train', 'both', 'teach']);
const TEACHING_ROUTES = new Set(['teaching-plan', 'teaching-student', 'teaching-record']);

export function modeOf(profile) {
  return MODES.includes(profile?.usage_mode) ? profile.usage_mode : 'train';
}

export function listsTeaching(mode) {
  return mode === 'both' || mode === 'teach';
}

export function isTeachingRoute(route) {
  return TEACHING_ROUTES.has(route.name)
    || (route.name === 'me-section' && route.params.section === 'teaching');
}

// The path to replace the route with, or null to render the route.
export function redirectFor(route, { profile, isCoach }) {
  if (!profile.completed_at) return route.name === 'welcome' ? null : '/welcome';
  if (route.name === 'welcome') return '/';
  if (isTeachingRoute(route) && !listsTeaching(modeOf(profile)) && !isCoach) return '/me';
  return null;
}

export function plusActions(mode) {
  if (mode === 'teach') return ['schedule', 'record'];
  if (mode === 'both') return ['log', 'schedule', 'record'];
  return ['log'];
}
```

- [ ] **Step 4: Extend the router**

In `src/app/shell/router.js`:

1. In `ROUTES`, insert after the `'me-section'` entry:

```js
  ['teaching-record', /^\/me\/teaching\/record$/, []],
```

2. Replace `TABS` and `DETAIL` with:

```js
const TABS = {
  today: 'today', calendar: 'calendar', discover: 'discover', person: 'discover', group: 'discover',
  me: 'me', 'me-section': 'me', 'teaching-plan': 'me', 'teaching-student': 'me', 'teaching-record': 'me', welcome: 'me',
};
const DETAIL = new Set([
  'training', 'class', 'log', 'person', 'group', 'me-section', 'teaching-plan', 'teaching-student',
  'teaching-record', 'welcome',
]);
```

3. Replace `parseRoute` with:

```js
export function parseRoute(hash) {
  const [rawPath, rawQuery = ''] = String(hash ?? '').replace(/^#/, '').split('?');
  const path = rawPath || '/';
  const query = Object.fromEntries(new URLSearchParams(rawQuery));
  for (const [name, pattern, keys] of ROUTES) {
    const match = pattern.exec(path);
    if (match) {
      return { name, path, params: Object.fromEntries(keys.map((key, index) => [key, match[index + 1] ?? null])), query };
    }
  }
  return { name: 'today', path: '/', params: {}, query: {}, redirected: true };
}
```

4. In the object returned by `createRouter`, add after `navigate`:

```js
    replace(path) {
      window.history.replaceState(null, '', `#${path}`);
      handle();
    },
```

- [ ] **Step 5: Load the coach profile at startup**

```js
// src/app/app-startup.js
// Startup never hangs: a failing session counts as signed out, a failing
// profile load is reported so the app can show a retry, and a failing coach
// profile load only means "no coaching" until the next start.
export async function loadStartup({ auth, profile }) {
  let session;
  try {
    session = await auth.getSession();
  } catch {
    return { status: 'signed-out' };
  }
  if (!session) return { status: 'signed-out' };
  try {
    const [loaded, coachProfile] = await Promise.all([
      profile.loadProfile(),
      Promise.resolve().then(() => profile.loadCoachProfile?.() ?? null).catch(() => null),
    ]);
    return { status: 'ready', session, profile: loaded, coachProfile: coachProfile ?? null };
  } catch (error) {
    return { status: 'error', error };
  }
}
```

- [ ] **Step 6: Run the unit tests**

Run: `npx vitest run tests/unit/access.test.js tests/unit/router.test.js tests/unit/app-startup.test.js`
Expected: PASS.

- [ ] **Step 7: Route every screen through the access rules**

Replace `src/app/entries/app.js` with:

```js
// src/app/entries/app.js
import { loadStartup } from '../app-startup.js';
import { createServices } from '../create-services.js';
import { createDashboardI18n } from '../dashboard-i18n.js';
import { seedDemoData } from '../demo-data.js';
import { renderCalendar } from '../screens/calendar.js';
import { renderLog } from '../screens/log.js';
import { renderMe, renderSettings } from '../screens/me.js';
import { renderPlaceholder } from '../screens/placeholder.js';
import { renderToday } from '../screens/today.js';
import { renderTraining } from '../screens/training.js';
import { redirectFor } from '../shell/access.js';
import { createLayout } from '../shell/layout.js';
import { el } from '../shell/page.js';
import { createRouter, isDetail, tabFor } from '../shell/router.js';
import { closeSheet, openSheet } from '../shell/sheet.js';

function localIsoDate(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function zoneFor(profile) {
  return profile.timezone_override || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

async function main() {
  const params = new URLSearchParams(location.search);
  const demoMode = params.get('demo') === '1';
  if (demoMode) seedDemoData(localStorage);
  const localMode = __RODA_E2E__ || demoMode;
  const services = createServices({ window, localMode });
  const i18n = createDashboardI18n({ document, storage: localStorage, navigator });
  const root = document.querySelector('#appRoot');

  const toSignIn = () => location.replace(`/?next=${encodeURIComponent(`/app${location.hash}`)}`);
  const startup = await loadStartup({ auth: services.auth, profile: services.profile });
  if (startup.status === 'signed-out') {
    toSignIn();
    return;
  }
  if (startup.status === 'error') {
    root.replaceChildren(el(document, 'section', { className: 'screen' }, [
      el(document, 'p', { text: navigator.onLine ? (startup.error?.message || i18n.t('app.loadError')) : i18n.t('app.offline') }),
      el(document, 'button', { className: 'button-primary', text: i18n.t('app.retry'), attrs: { type: 'button' }, on: { click: () => location.reload() } }),
    ]));
    return;
  }
  const { profile, session } = startup;
  let isCoach = Boolean(startup.coachProfile);
  services.auth.onAuthStateChange((_event, nextSession) => {
    if (!nextSession) toSignIn();
  });
  let termMappings = [];
  async function refreshTermMappings() {
    try {
      termMappings = await services.catalog.listTermMappings();
    } catch {
      // Keep the last mappings; recognition still works with the built-in catalog.
    }
  }
  refreshTermMappings();

  const desktop = window.matchMedia('(min-width: 900px)');
  let lastTopLevel = { name: 'today', path: '/', params: {}, query: {} };
  let renderToken = 0;
  const layout = createLayout({ document, i18n, onPlus: () => router.navigate('/log') });
  root.replaceChildren(layout.root);
  layout.setOffline(!navigator.onLine);
  window.addEventListener('online', () => layout.setOffline(false));
  window.addEventListener('offline', () => layout.setOffline(true));

  const ctx = {
    document, window, i18n, services, profile, timezone: zoneFor(profile), user: session.user,
    navigate: (path) => router.navigate(path),
    replace: (path) => router.replace(path),
    back: (fallback = '/') => router.back(fallback),
    today: () => localIsoDate(new Date(), ctx.timezone),
    now: () => new Date(),
    getTermMappings: () => termMappings,
    refreshTermMappings,
    isCoach: () => isCoach,
    markCoach: () => { isCoach = true; },
    openSheet: (options) => openSheet({ document, closeLabel: i18n.t('app.close'), ...options }),
  };

  async function meSection(route) {
    const { section } = route.params;
    if (section === 'settings') {
      return renderSettings(ctx, {
        onLocaleChange: () => { layout.refreshCopy(); show(route); },
        onSignOut: async () => { await services.auth.signOut(); location.replace('/'); },
      });
    }
    return renderPlaceholder(ctx, { title: i18n.t(`app.${section}`) });
  }

  async function screenFor(route) {
    switch (route.name) {
      case 'today': return renderToday(ctx, route);
      case 'calendar': return renderCalendar(ctx, route);
      case 'training': return renderTraining(ctx, route);
      case 'log': return renderLog(ctx, route);
      case 'me': return renderMe(ctx, route);
      case 'me-section': return meSection(route);
      case 'welcome':
        return el(document, 'section', { className: 'screen' }, [
          el(document, 'p', { text: i18n.t('app.completeProfile') }),
          el(document, 'a', { className: 'button-secondary', text: i18n.t('app.classic'), attrs: { href: '/dashboard' } }),
        ]);
      case 'discover': return renderPlaceholder(ctx, { title: i18n.t('app.discover') });
      default: return renderPlaceholder(ctx, { title: i18n.t('app.today') });
    }
  }

  async function show(route) {
    const redirect = redirectFor(route, { profile, isCoach });
    if (redirect) {
      router.replace(redirect);
      return;
    }
    const token = ++renderToken;
    closeSheet();
    const detailRoute = isDetail(route);
    const sideBySide = desktop.matches && route.name === 'training';
    layout.setActive(tabFor(route) ?? tabFor(lastTopLevel));
    layout.setDetailMode(detailRoute && !sideBySide);
    if (!detailRoute) lastTopLevel = route;
    const target = sideBySide ? layout.detail : layout.main;
    target.replaceChildren(el(document, 'p', { className: 'muted screen-loading', text: i18n.t('app.loading') }));
    if (sideBySide && layout.main.firstElementChild?.dataset.screen !== lastTopLevel.name) {
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

- [ ] **Step 8: Add the shared test helpers**

```js
// tests/unit/app-test-context.js
// A screen context for jsdom tests; pass overrides for services and profile.
import { vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { openSheet } from '../../src/app/shell/sheet.js';

export function appCtx(overrides = {}) {
  const values = new Map([['roda.dashboard.locale', 'en']]);
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let coach = overrides.coach ?? false;
  return {
    document,
    window,
    i18n: createDashboardI18n({ document, storage, navigator: { languages: ['en'] } }),
    profile: {
      id: 'me', display_name: 'Ana Silva', usage_mode: 'both', avatar_path: null,
      timezone_override: null, leaderboard_visible: true, completed_at: '2026-09-11T20:00:00Z',
    },
    user: { id: 'me', email: 'ana@example.com', user_metadata: {} },
    timezone: 'Europe/Lisbon',
    services: {},
    navigate: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    today: () => '2026-10-11',
    now: () => new Date('2026-10-11T12:00:00Z'),
    getTermMappings: () => [],
    refreshTermMappings: vi.fn(),
    isCoach: () => coach,
    markCoach: () => { coach = true; },
    openSheet: (options) => openSheet({ document, ...options }),
    ...overrides,
  };
}
```

```js
// tests/e2e/app-helpers.js
export const ANA = {
  id: 'practitioner-1', display_name: 'Ana Silva', avatar_path: null,
  timezone_override: 'Europe/Lisbon', leaderboard_visible: true, completed_at: '2026-09-11T20:00:00Z',
};

// Seeds a signed-in local account; `extra` maps localStorage keys to JSON values.
export async function seedAccount(page, { profile = {}, coachProfile = null, extra = {} } = {}) {
  await page.goto('/');
  await page.evaluate(({ values, coach, more }) => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1', email: 'ana@example.com' } }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify(values));
    if (coach) localStorage.setItem('roda.e2e.coachProfile', JSON.stringify(coach));
    for (const [key, value] of Object.entries(more)) localStorage.setItem(key, JSON.stringify(value));
  }, { values: { ...ANA, ...profile }, coach: coachProfile, more: extra });
}

// The phone + sits in the tab bar; desktop has a sidebar button.
export async function openCreate(page, testInfo) {
  if (testInfo.project.name.includes('mobile')) await page.getByRole('button', { name: 'Create', exact: true }).click();
  else await page.locator('.app-plus-side').click();
}
```

- [ ] **Step 9: Write the browser test**

```js
// tests/e2e/app-access.spec.js
import { expect, test } from '@playwright/test';

import { seedAccount } from './app-helpers.js';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
});

test('Teaching sends Train people without coaching back to Me', async ({ page }) => {
  await seedAccount(page);
  await page.goto('/app#/me/teaching');
  await expect(page).toHaveURL(/#\/me$/);
  await page.goto('/app#/me/teaching/plans/new');
  await expect(page).toHaveURL(/#\/me$/);
});

test('Teaching stays reachable in Train for people who coach', async ({ page }) => {
  await seedAccount(page, { coachProfile: { profile_id: 'practitioner-1' } });
  await page.goto('/app#/me/teaching');
  await expect(page).toHaveURL(/#\/me\/teaching$/);
});

test('finished profiles never see the welcome, unfinished ones always do', async ({ page }) => {
  await seedAccount(page);
  await page.goto('/app#/welcome');
  await expect(page).toHaveURL(/#\/$/);
  await seedAccount(page, { profile: { completed_at: null } });
  await page.goto('/app#/calendar');
  await expect(page).toHaveURL(/#\/welcome$/);
});
```

- [ ] **Step 10: Run all suites**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/app/shell/access.js src/app/shell/router.js src/app/app-startup.js src/app/entries/app.js \
  tests/unit/access.test.js tests/unit/router.test.js tests/unit/app-startup.test.js tests/unit/app-test-context.js \
  tests/e2e/app-helpers.js tests/e2e/app-access.spec.js
git commit -m "feat: route /app through welcome, Teaching, and mode rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: First sign-in welcome and Settings → Profile

**Files:**
- Create: `src/app/screens/mode-slider.js`, `src/app/screens/profile-form.js`, `src/app/screens/welcome.js`, `tests/unit/mode-slider.test.js`, `tests/unit/welcome-screen.test.js`, `tests/e2e/app-welcome.spec.js`
- Modify: `src/app/screens/me.js` (`renderSettings`), `src/app/entries/app.js`, `src/app/dashboard-i18n.js`, `assets/app.css`
- Test: `tests/unit/me-screen.test.js`

**Interfaces:**
- Consumes: `MODES`, `modeOf` (Task 3); `profileService.setUsageMode` (Task 1); existing `profilePrefill`, `completeProfile`, `uploadProfilePicture`, `loadProfile`.
- Produces: `createModeSlider({ document, i18n, value, onChange }) → { element, value(), set(mode) }` — a `role="radiogroup"` labelled "How I use roda" with three `role="radio"` buttons (`data-mode`), arrow-key navigation, and the hints "log my training" / "teach classes".
- Produces: `createProfileForm({ document, i18n, user, profile, withSettings }) → { element, values() }` where `values()` is `{ displayName, file, timezoneChoice, leaderboardVisible }`; inputs are named `displayName`, `photo`, and (with settings) `timezone`, `leaderboardVisible`. `nameProblem(value) → i18n key | null`. `saveProfile(ctx, values, memo) → fresh profile` (uploads the photo once per chosen file using `memo.uploaded`, then `completeProfile`, then `loadProfile`).
- Produces: `welcomeSteps() → [profileStep, modeStep]`, each `{ id, title, render(state, ctx), validate?(state, ctx), save?(state, ctx) }`; `renderWelcome(ctx, route, { steps = welcomeSteps(), onDone(freshProfile, mode) })`. Finish order: `setUsageMode(mode)` → every step's `save` → `saveProfile` (which sets `completed_at`).
- Produces: `renderSettings(ctx, { onLocaleChange, onSignOut, onProfileSaved })` with a Profile section (`button[data-action="save-profile"]`, status `[data-profile-status]`).

Ruling R1: the welcome shows steps 1–2 and Plan 3 appends its city and visibility step to `welcomeSteps()`. Ruling R18: photos get a local preview only. Ruling R19: Settings gains Profile and a timezone change applies immediately.

- [ ] **Step 1: Add i18n keys**

`en`:

```js
    'mode.label': 'How I use roda',
    'mode.train': 'Train',
    'mode.both': 'Both',
    'mode.teach': 'Teach',
    'mode.trainHint': 'log my training',
    'mode.teachHint': 'teach classes',
    'mode.saveError': "We couldn't change how you use roda. Please try again.",
    'welcome.title': 'Welcome to roda',
    'welcome.step': 'Step {number} of {total}',
    'welcome.profileTitle': 'Your name and photo',
    'welcome.modeTitle': 'How will you use roda?',
    'welcome.modeNote': 'Choosing Both or Teach adds coaching to your profile. You can change this any time in Me.',
    'welcome.next': 'Next',
    'welcome.back': 'Back',
    'welcome.finish': 'Finish',
    'welcome.saving': 'Saving…',
    'welcome.saveError': "We couldn't finish setting up. Your answers are still here.",
    'profileForm.title': 'Profile',
    'profileForm.name': 'Name',
    'profileForm.photo': 'Photo',
    'profileForm.timezone': 'Timezone',
    'profileForm.automatic': 'Automatic',
    'profileForm.leaderboard': 'Show me in group rankings',
    'profileForm.nameRequired': 'Enter a name of up to 80 characters.',
    'profileForm.save': 'Save profile',
    'profileForm.saved': 'Profile saved.',
    'profileForm.saveError': "We couldn't save your profile. Your changes are still here.",
```

`pt`:

```js
    'mode.label': 'Como uso a roda',
    'mode.train': 'Treinar',
    'mode.both': 'Ambos',
    'mode.teach': 'Ensinar',
    'mode.trainHint': 'registar o meu treino',
    'mode.teachHint': 'dar aulas',
    'mode.saveError': 'Não foi possível mudar a forma como usas a roda. Tenta novamente.',
    'welcome.title': 'Bem-vindo à roda',
    'welcome.step': 'Passo {number} de {total}',
    'welcome.profileTitle': 'O teu nome e foto',
    'welcome.modeTitle': 'Como vais usar a roda?',
    'welcome.modeNote': 'Escolher Ambos ou Ensinar acrescenta a função de treinador ao teu perfil. Podes mudar isto a qualquer momento em Eu.',
    'welcome.next': 'Seguinte',
    'welcome.back': 'Voltar',
    'welcome.finish': 'Concluir',
    'welcome.saving': 'A guardar…',
    'welcome.saveError': 'Não foi possível concluir a configuração. As tuas respostas continuam aqui.',
    'profileForm.title': 'Perfil',
    'profileForm.name': 'Nome',
    'profileForm.photo': 'Foto',
    'profileForm.timezone': 'Fuso horário',
    'profileForm.automatic': 'Automático',
    'profileForm.leaderboard': 'Mostrar-me nas classificações do grupo',
    'profileForm.nameRequired': 'Escreve um nome com até 80 caracteres.',
    'profileForm.save': 'Guardar perfil',
    'profileForm.saved': 'Perfil guardado.',
    'profileForm.saveError': 'Não foi possível guardar o perfil. As alterações continuam aqui.',
```

- [ ] **Step 2: Write the failing unit tests**

```js
// tests/unit/mode-slider.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { createModeSlider } from '../../src/app/screens/mode-slider.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

describe('mode slider', () => {
  it('shows three choices with hints and reports changes', () => {
    const onChange = vi.fn();
    const slider = createModeSlider({ document, i18n, value: 'both', onChange });
    document.body.replaceChildren(slider.element);
    const group = document.querySelector('[role="radiogroup"]');
    expect(group.getAttribute('aria-label')).toBe('How I use roda');
    expect([...group.querySelectorAll('[role="radio"]')].map((button) => [button.textContent, button.getAttribute('aria-checked')]))
      .toEqual([['Train', 'false'], ['Both', 'true'], ['Teach', 'false']]);
    expect(slider.element.textContent).toContain('log my training');
    expect(slider.element.textContent).toContain('teach classes');
    group.querySelector('[data-mode="teach"]').click();
    expect(onChange).toHaveBeenCalledWith('teach');
    group.querySelector('[data-mode="teach"]').click();
    expect(onChange).toHaveBeenCalledTimes(1);
    group.querySelector('[data-mode="teach"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(slider.value()).toBe('both');
    expect(document.activeElement.dataset.mode).toBe('both');
    slider.set('train');
    expect(group.querySelector('[data-mode="train"]').getAttribute('aria-checked')).toBe('true');
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
```

```js
// tests/unit/welcome-screen.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { renderWelcome, welcomeSteps } from '../../src/app/screens/welcome.js';
import { appCtx } from './app-test-context.js';

function profileService(overrides = {}) {
  return {
    setUsageMode: vi.fn().mockResolvedValue({ status: 'updated' }),
    uploadProfilePicture: vi.fn().mockResolvedValue({ status: 'updated' }),
    completeProfile: vi.fn().mockResolvedValue({ status: 'updated' }),
    loadProfile: vi.fn().mockResolvedValue({ id: 'me', display_name: 'Ana Silva', usage_mode: 'teach', completed_at: '2026-10-12T10:00:00Z' }),
    ...overrides,
  };
}

function setup(services, options = {}) {
  const ctx = appCtx({
    profile: { id: 'me', display_name: 'Capoeirista', usage_mode: 'train', completed_at: null, timezone_override: null, leaderboard_visible: true },
    user: { id: 'me', email: 'ana@example.com', user_metadata: { full_name: 'Ana Silva' } },
    services: { profile: services },
  });
  const onDone = vi.fn();
  return { onDone, render: () => renderWelcome(ctx, { name: 'welcome', params: {}, query: {} }, { onDone, ...options }) };
}

const press = (view, action) => view.querySelector(`[data-action="${action}"]`).click();

describe('welcome', () => {
  it('walks through name and mode, then finishes', async () => {
    const services = profileService();
    const { onDone, render } = setup(services);
    const view = await render();
    document.body.replaceChildren(view);
    expect(view.querySelector('.welcome-progress').textContent).toBe('Step 1 of 2');
    const name = view.querySelector('input[name="displayName"]');
    expect(name.value).toBe('Ana Silva');
    name.value = '   ';
    press(view, 'welcome-next');
    expect(view.querySelector('[role="status"]').textContent).toBe('Enter a name of up to 80 characters.');
    name.value = 'Ana Silva';
    press(view, 'welcome-next');
    expect(view.querySelector('.welcome-progress').textContent).toBe('Step 2 of 2');
    view.querySelector('[data-mode="teach"]').click();
    press(view, 'welcome-next');
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ usage_mode: 'teach' }), 'teach'));
    expect(services.setUsageMode).toHaveBeenCalledWith('teach');
    expect(services.completeProfile).toHaveBeenCalledWith({ displayName: 'Ana Silva', timezoneChoice: 'Automatic', leaderboardVisible: true });
    expect(services.uploadProfilePicture).not.toHaveBeenCalled();
  });

  it('keeps the answers and never uploads the same photo twice after a failure', async () => {
    const services = profileService({
      completeProfile: vi.fn().mockRejectedValueOnce(new Error('Timed out')).mockResolvedValue({ status: 'updated' }),
    });
    const { onDone, render } = setup(services);
    const view = await render();
    document.body.replaceChildren(view);
    const file = new File(['x'], 'me.png', { type: 'image/png' });
    Object.defineProperty(view.querySelector('input[name="photo"]'), 'files', { value: [file] });
    press(view, 'welcome-next');
    press(view, 'welcome-next');
    await vi.waitFor(() => expect(view.querySelector('[role="status"]').textContent).toBe('Timed out'));
    expect(onDone).not.toHaveBeenCalled();
    expect(view.querySelector('[data-action="welcome-next"]').textContent).toBe('Finish');
    press(view, 'welcome-next');
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(services.uploadProfilePicture).toHaveBeenCalledTimes(1);
    expect(services.uploadProfilePicture).toHaveBeenCalledWith('me', file);
  });

  it('runs extra steps and their save hooks before completing the profile', async () => {
    const services = profileService();
    const order = [];
    services.completeProfile.mockImplementation(async () => { order.push('complete'); return {}; });
    const extra = {
      id: 'extra', title: 'welcome.modeTitle',
      render: (_state, ctx) => ctx.document.createElement('div'),
      save: async () => { order.push('extra'); },
    };
    const { onDone, render } = setup(services, { steps: [...welcomeSteps(), extra] });
    const view = await render();
    document.body.replaceChildren(view);
    press(view, 'welcome-next');
    press(view, 'welcome-next');
    expect(view.querySelector('.welcome-progress').textContent).toBe('Step 3 of 3');
    press(view, 'welcome-next');
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(order).toEqual(['extra', 'complete']);
  });
});
```

Add to `tests/unit/me-screen.test.js` (inside `describe('me screen', ...)`):

```js
  it('saves the profile from Settings', async () => {
    const profile = {
      completeProfile: vi.fn().mockResolvedValue({ status: 'updated' }),
      uploadProfilePicture: vi.fn(),
      loadProfile: vi.fn().mockResolvedValue({ id: 'p1', display_name: 'Ana Morais', completed_at: 'x' }),
    };
    const onProfileSaved = vi.fn();
    const context = ctx({
      profile: { id: 'p1', display_name: 'João Morais', completed_at: 'x', timezone_override: 'Europe/Lisbon', leaderboard_visible: false },
      services: { catalog: { amICurator: vi.fn().mockResolvedValue(false) }, profile },
    });
    const view = await renderSettings(context, { onLocaleChange() {}, onSignOut() {}, onProfileSaved });
    expect(view.querySelector('input[name="timezone"]').value).toBe('Europe/Lisbon');
    expect(view.querySelector('input[name="leaderboardVisible"]').checked).toBe(false);
    view.querySelector('input[name="displayName"]').value = 'Ana Morais';
    view.querySelector('button[data-action="save-profile"]').click();
    await vi.waitFor(() => expect(onProfileSaved).toHaveBeenCalledWith(expect.objectContaining({ display_name: 'Ana Morais' })));
    expect(profile.completeProfile).toHaveBeenCalledWith({ displayName: 'Ana Morais', timezoneChoice: 'Europe/Lisbon', leaderboardVisible: false });
    expect(view.querySelector('[data-profile-status]').textContent).toBe('Profile saved.');
  });
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/unit/mode-slider.test.js tests/unit/welcome-screen.test.js tests/unit/me-screen.test.js`
Expected: FAIL — modules not found; Settings has no profile inputs.

- [ ] **Step 4: Implement the mode slider and the profile form**

```js
// src/app/screens/mode-slider.js
import { MODES } from '../shell/access.js';
import { el } from '../shell/page.js';

export function createModeSlider({ document, i18n, value = 'train', onChange = () => {} }) {
  let current = value;
  const buttons = MODES.map((mode) => el(document, 'button', {
    className: 'mode-option', text: i18n.t(`mode.${mode}`), attrs: { type: 'button', role: 'radio' }, dataset: { mode },
    on: { click: () => choose(mode) },
  }));
  const group = el(document, 'div', { className: 'mode-slider', attrs: { role: 'radiogroup', 'aria-label': i18n.t('mode.label') } }, buttons);

  function sync() {
    for (const button of buttons) {
      const on = button.dataset.mode === current;
      button.setAttribute('aria-checked', String(on));
      button.tabIndex = on ? 0 : -1;
    }
  }
  function choose(mode) {
    if (mode === current) return;
    current = mode;
    sync();
    onChange(mode);
  }
  group.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = MODES[(MODES.indexOf(current) + step + MODES.length) % MODES.length];
    choose(next);
    buttons[MODES.indexOf(next)].focus();
  });
  sync();

  return {
    element: el(document, 'div', { className: 'mode-field' }, [
      el(document, 'div', { className: 'muted', text: i18n.t('mode.label') }),
      group,
      el(document, 'div', { className: 'mode-hints muted', attrs: { 'aria-hidden': 'true' } }, [
        el(document, 'span', { text: i18n.t('mode.trainHint') }),
        el(document, 'span', { text: i18n.t('mode.teachHint') }),
      ]),
    ]),
    value: () => current,
    set(mode) {
      current = mode;
      sync();
    },
  };
}
```

```js
// src/app/screens/profile-form.js
import { AppError } from '../errors.js';
import { profilePrefill } from '../profile-service.js';
import { el, initials } from '../shell/page.js';

function field(document, label, control) {
  return el(document, 'label', { className: 'field-label' }, [label, control]);
}

export function nameProblem(value) {
  const name = String(value ?? '').trim();
  return name && name.length <= 80 ? null : 'profileForm.nameRequired';
}

export function createProfileForm({ document, i18n, user = null, profile, withSettings = false }) {
  const prefill = profilePrefill(user, profile);
  const name = el(document, 'input', { className: 'field-input', attrs: { name: 'displayName', maxlength: '80', autocomplete: 'name' } });
  name.value = prefill.displayName;
  const preview = el(document, 'div', { className: 'me-avatar profile-preview', text: initials(name.value), attrs: { 'aria-hidden': 'true' } });
  const photo = el(document, 'input', { className: 'field-input', attrs: { type: 'file', name: 'photo', accept: 'image/jpeg,image/png,image/webp' } });
  const url = document.defaultView?.URL;
  let previewUrl = null;
  name.addEventListener('input', () => { if (!previewUrl) preview.textContent = initials(name.value); });
  photo.addEventListener('change', () => {
    const file = photo.files?.[0];
    if (previewUrl) url?.revokeObjectURL?.(previewUrl);
    previewUrl = file ? url?.createObjectURL?.(file) ?? null : null;
    preview.style.backgroundImage = previewUrl ? `url("${previewUrl}")` : '';
    preview.textContent = previewUrl ? '' : initials(name.value);
  });
  const children = [
    el(document, 'div', { className: 'profile-photo-row' }, [preview, field(document, i18n.t('profileForm.photo'), photo)]),
    field(document, i18n.t('profileForm.name'), name),
  ];
  let timezone = null;
  let leaderboard = null;
  if (withSettings) {
    timezone = el(document, 'input', { className: 'field-input', attrs: { name: 'timezone', placeholder: i18n.t('profileForm.automatic'), autocomplete: 'off' } });
    timezone.value = prefill.timezoneChoice === 'Automatic' ? '' : prefill.timezoneChoice;
    leaderboard = el(document, 'input', { attrs: { type: 'checkbox', name: 'leaderboardVisible' } });
    leaderboard.checked = prefill.leaderboardVisible;
    children.push(
      field(document, i18n.t('profileForm.timezone'), timezone),
      el(document, 'label', { className: 'check-row' }, [leaderboard, ` ${i18n.t('profileForm.leaderboard')}`]),
    );
  }
  return {
    element: el(document, 'div', { className: 'profile-form' }, children),
    values() {
      return {
        displayName: name.value,
        file: photo.files?.[0] ?? null,
        timezoneChoice: timezone ? (timezone.value.trim() || 'Automatic') : prefill.timezoneChoice,
        leaderboardVisible: leaderboard ? leaderboard.checked : prefill.leaderboardVisible,
      };
    },
  };
}

// Uploads a newly chosen photo once (memo remembers it across retries), then
// completes the profile, which also sets completed_at the first time.
export async function saveProfile(ctx, values, memo = {}) {
  const problem = nameProblem(values.displayName);
  if (problem) throw new AppError('validation', 'invalid_display_name', ctx.i18n.t(problem));
  if (values.file && memo.uploaded !== values.file) {
    await ctx.services.profile.uploadProfilePicture(ctx.profile.id, values.file);
    memo.uploaded = values.file;
  }
  await ctx.services.profile.completeProfile({
    displayName: values.displayName.trim(),
    timezoneChoice: values.timezoneChoice,
    leaderboardVisible: values.leaderboardVisible,
  });
  return ctx.services.profile.loadProfile();
}
```

- [ ] **Step 5: Implement the welcome**

```js
// src/app/screens/welcome.js
import { modeOf } from '../shell/access.js';
import { el } from '../shell/page.js';
import { createModeSlider } from './mode-slider.js';
import { createProfileForm, nameProblem, saveProfile } from './profile-form.js';

const profileStep = {
  id: 'profile',
  title: 'welcome.profileTitle',
  render(state, ctx) {
    state.form ??= createProfileForm({ document: ctx.document, i18n: ctx.i18n, user: ctx.user, profile: ctx.profile });
    return state.form.element;
  },
  validate(state) {
    return nameProblem(state.form.values().displayName);
  },
};

const modeStep = {
  id: 'mode',
  title: 'welcome.modeTitle',
  render(state, ctx) {
    state.slider ??= createModeSlider({
      document: ctx.document, i18n: ctx.i18n, value: state.mode, onChange: (mode) => { state.mode = mode; },
    });
    return el(ctx.document, 'div', {}, [
      state.slider.element,
      el(ctx.document, 'p', { className: 'muted', text: ctx.i18n.t('welcome.modeNote') }),
    ]);
  },
};

// Ruling R1: Plan 3 appends its city and "Who can find you" step to this list.
export function welcomeSteps() {
  return [profileStep, modeStep];
}

export async function renderWelcome(ctx, _route, { steps = welcomeSteps(), onDone }) {
  const { document, i18n } = ctx;
  const state = { mode: modeOf(ctx.profile), memo: {} };
  let index = 0;
  let saving = false;
  const progress = el(document, 'p', { className: 'muted welcome-progress' });
  const heading = el(document, 'h2', { className: 'welcome-step-title' });
  const body = el(document, 'div', { className: 'welcome-body' });
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  const back = el(document, 'button', { className: 'button-secondary', text: i18n.t('welcome.back'), attrs: { type: 'button' }, dataset: { action: 'welcome-back' } });
  const next = el(document, 'button', { className: 'button-primary', attrs: { type: 'button' }, dataset: { action: 'welcome-next' } });
  const isLast = () => index === steps.length - 1;

  function show() {
    const step = steps[index];
    progress.textContent = i18n.t('welcome.step', { number: index + 1, total: steps.length });
    heading.textContent = i18n.t(step.title);
    body.replaceChildren(step.render(state, ctx));
    back.hidden = index === 0;
    next.textContent = i18n.t(isLast() ? 'welcome.finish' : 'welcome.next');
    status.textContent = '';
  }

  async function finish() {
    saving = true;
    next.disabled = true;
    next.textContent = i18n.t('welcome.saving');
    status.textContent = '';
    try {
      await ctx.services.profile.setUsageMode(state.mode);
      for (const step of steps) await step.save?.(state, ctx);
      const fresh = await saveProfile(ctx, state.form.values(), state.memo);
      onDone(fresh, state.mode);
    } catch (error) {
      status.textContent = error?.message || i18n.t('welcome.saveError');
    } finally {
      saving = false;
      next.disabled = false;
      next.textContent = i18n.t(isLast() ? 'welcome.finish' : 'welcome.next');
    }
  }

  back.addEventListener('click', () => {
    if (saving || index === 0) return;
    index -= 1;
    show();
  });
  next.addEventListener('click', () => {
    if (saving) return;
    const problem = steps[index].validate?.(state, ctx);
    if (problem) {
      status.textContent = i18n.t(problem);
      return;
    }
    if (!isLast()) {
      index += 1;
      show();
      return;
    }
    finish();
  });

  const screen = el(document, 'section', { className: 'screen screen-welcome' }, [
    el(document, 'h1', { className: 'page-title', text: i18n.t('welcome.title') }),
    progress, heading, body, status,
    el(document, 'div', { className: 'welcome-actions' }, [back, next]),
  ]);
  show();
  return screen;
}
```


- [ ] **Step 6: Add Profile to Settings**

In `src/app/screens/me.js`, add the import:

```js
import { createProfileForm, saveProfile } from './profile-form.js';
```

and replace `renderSettings` with:

```js
export async function renderSettings(ctx, { onLocaleChange, onSignOut, onProfileSaved = () => {} }) {
  const { document, i18n } = ctx;
  const form = createProfileForm({ document, i18n, user: ctx.user, profile: ctx.profile, withSettings: true });
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' }, dataset: { profileStatus: '' } });
  const memo = {};
  let saving = false;
  const save = el(document, 'button', {
    className: 'button-primary', text: i18n.t('profileForm.save'), attrs: { type: 'button' }, dataset: { action: 'save-profile' },
  });
  save.addEventListener('click', async () => {
    if (saving) return;
    saving = true;
    save.disabled = true;
    status.textContent = '';
    try {
      const fresh = await saveProfile(ctx, form.values(), memo);
      status.textContent = i18n.t('profileForm.saved');
      onProfileSaved(fresh);
    } catch (error) {
      status.textContent = error?.message || i18n.t('profileForm.saveError');
    } finally {
      saving = false;
      save.disabled = false;
    }
  });
  const languages = el(document, 'div', { className: 'segmented', attrs: { role: 'group', 'aria-label': i18n.t('app.language') } },
    [['en', 'English'], ['pt', 'Português']].map(([locale, label]) => el(document, 'button', {
      text: label, attrs: { type: 'button', 'aria-pressed': String(i18n.locale() === locale) }, dataset: { locale },
      on: { click: () => { i18n.setLocale(locale); onLocaleChange(); } },
    })));
  return el(document, 'section', { className: 'screen screen-settings' }, [
    pageHeader({ document, title: i18n.t('app.settings'), backLabel: i18n.t('app.back'), onBack: () => ctx.back('/me') }),
    el(document, 'h2', { className: 'section-label', text: i18n.t('profileForm.title') }),
    form.element, save, status,
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

- [ ] **Step 7: Wire the welcome and profile saving into the entry**

In `src/app/entries/app.js`:

1. Add `import { renderWelcome } from '../screens/welcome.js';` with the other screen imports.
2. After the `ctx` object, add:

```js
  function profileSaved(fresh) {
    Object.assign(profile, fresh);
    ctx.timezone = zoneFor(profile);
    layout.refreshCopy();
  }
```

3. In `meSection`, pass `onProfileSaved: profileSaved` to `renderSettings` (next to `onSignOut`).
4. Replace the whole `case 'welcome':` branch in `screenFor` with:

```js
      case 'welcome':
        return renderWelcome(ctx, route, {
          onDone: (fresh, mode) => {
            if (mode !== 'train') isCoach = true;
            profileSaved(fresh);
            router.replace('/');
          },
        });
```

- [ ] **Step 8: Style the new controls**

Append to `assets/app.css`:

```css
/* Welcome, profile form, Train · Both · Teach */
.screen-welcome { display: grid; gap: 8px; }
.welcome-step-title { font: 800 1.1rem/1.2 var(--display); margin: 8px 0 4px; }
.welcome-actions { display: flex; justify-content: space-between; gap: 8px; margin-top: 12px; }
.form-status:empty { display: none; }
.form-status { color: var(--sand); }
.profile-photo-row { display: flex; align-items: center; gap: 12px; }
.profile-preview { flex: none; background-size: cover; background-position: center; }
.check-row { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
.mode-field { display: grid; gap: 6px; margin: 8px 0 14px; }
.mode-slider { display: grid; grid-template-columns: repeat(3, 1fr); background: var(--card); border: 1px solid var(--line); border-radius: 999px; padding: 3px; }
.mode-option { border: 0; background: transparent; border-radius: 999px; padding: 9px 0; cursor: pointer; }
.mode-option[aria-checked="true"] { background: var(--gold); color: var(--bg); font-weight: 700; }
.mode-hints { display: flex; justify-content: space-between; }
```

- [ ] **Step 9: Run unit tests**

Run: `npx vitest run tests/unit/mode-slider.test.js tests/unit/welcome-screen.test.js tests/unit/me-screen.test.js tests/unit/dashboard-i18n.test.js`
Expected: PASS.

- [ ] **Step 10: Write the browser test**

```js
// tests/e2e/app-welcome.spec.js
import { expect, test } from '@playwright/test';

import { seedAccount } from './app-helpers.js';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
});

test('a new person sets name and mode, then lands on Today', async ({ page }) => {
  await seedAccount(page, { profile: { display_name: 'Capoeirista', completed_at: null } });
  await page.goto('/app');
  await expect(page).toHaveURL(/#\/welcome$/);
  await page.getByLabel('Name', { exact: true }).fill('Ana Silva');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: 'Both' }).click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('.week-day')).toHaveCount(7);
  const stored = await page.evaluate(() => ({
    profile: JSON.parse(localStorage.getItem('roda.e2e.profile')),
    coach: JSON.parse(localStorage.getItem('roda.e2e.coachProfile')),
  }));
  expect(stored.profile).toMatchObject({ display_name: 'Ana Silva', usage_mode: 'both', completed_at: expect.any(String) });
  expect(stored.coach).not.toBeNull();
});

test('Settings saves a new name', async ({ page }) => {
  await seedAccount(page);
  await page.goto('/app#/me/settings');
  await page.getByLabel('Name', { exact: true }).fill('Ana Morais');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();
  await page.goto('/app#/me');
  await expect(page.locator('.me-name')).toHaveText('Ana Morais');
});
```

- [ ] **Step 11: Run all suites**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/app/screens/mode-slider.js src/app/screens/profile-form.js src/app/screens/welcome.js src/app/screens/me.js \
  src/app/entries/app.js src/app/dashboard-i18n.js assets/app.css \
  tests/unit/mode-slider.test.js tests/unit/welcome-screen.test.js tests/unit/me-screen.test.js tests/e2e/app-welcome.spec.js
git commit -m "feat: add the first sign-in welcome and profile settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Me slider, Teaching row, and mode-aware Today and Calendar

**Files:**
- Modify: `src/app/screens/me.js` (`renderMe`), `src/app/screens/today-state.js`, `src/app/screens/today.js`, `src/app/screens/calendar.js`, `src/app/entries/app.js`, `assets/app.css`
- Test: `tests/unit/me-screen.test.js`, `tests/unit/today-state.test.js`, `tests/unit/today-screen.test.js`, `tests/unit/calendar-screen.test.js`, `tests/e2e/app-coach-calendar.spec.js` (create)

**Interfaces:**
- Consumes: `createModeSlider` (Task 4), `modeOf`, `listsTeaching` (Task 3), `training.listMyCalendar` rows with `role` and `resource_kinds` (Task 2), `ctx.markCoach()`.
- Produces: `renderMe(ctx, route, { onModeChange })` — the header (`a.me-top`) links to `#/me/settings`; the slider saves through `services.profile.setUsageMode`, assigns `ctx.profile.usage_mode` only after success, calls `ctx.markCoach()` for Both/Teach, re-renders the rows, and calls `onModeChange(mode)`; on failure it snaps back and shows the reason in `[role="status"]`.
- Produces: `nowNextCard({ calendarItems, recent, profileId, now, todayIso, mode = 'both' })` (Ruling R10).
- Produces: Today and Calendar read `training.listMyCalendar`; Calendar items use `item.resource_kinds` and open `#/class/<id>` for upcoming items with `role === 'coach'`.

Ruling R10: Today ordering per mode. Ruling R20: Me lists Teaching only in Both and Teach.

- [ ] **Step 1: Write the failing unit tests**

In `tests/unit/me-screen.test.js`, change the default profile in the `ctx()` helper to `profile: { id: 'p1', display_name: 'João Morais', usage_mode: 'both' },` (so the existing row test keeps listing Teaching) and add:

```js
  it('hides Teaching in Train and switches mode from the slider', async () => {
    const setUsageMode = vi.fn().mockResolvedValue({ status: 'updated' });
    const onModeChange = vi.fn();
    const context = ctx({
      profile: { id: 'p1', display_name: 'João Morais', usage_mode: 'train' },
      services: { catalog: { amICurator: vi.fn().mockResolvedValue(false) }, profile: { setUsageMode } },
      markCoach: vi.fn(),
    });
    const view = await renderMe(context, {}, { onModeChange });
    expect(view.querySelector('a.me-top').getAttribute('href')).toBe('#/me/settings');
    expect(view.querySelector('a[href="#/me/teaching"]')).toBeNull();
    view.querySelector('[data-mode="both"]').click();
    await vi.waitFor(() => expect(view.querySelector('a[href="#/me/teaching"]')).not.toBeNull());
    expect(setUsageMode).toHaveBeenCalledWith('both');
    expect(context.profile.usage_mode).toBe('both');
    expect(context.markCoach).toHaveBeenCalled();
    expect(onModeChange).toHaveBeenCalledWith('both');
  });

  it('snaps back and explains when the mode cannot be saved', async () => {
    const setUsageMode = vi.fn().mockRejectedValue(new Error('You are offline.'));
    const onModeChange = vi.fn();
    const context = ctx({
      profile: { id: 'p1', display_name: 'João Morais', usage_mode: 'both' },
      services: { catalog: { amICurator: vi.fn().mockResolvedValue(false) }, profile: { setUsageMode } },
      markCoach: vi.fn(),
    });
    const view = await renderMe(context, {}, { onModeChange });
    view.querySelector('[data-mode="train"]').click();
    await vi.waitFor(() => expect(view.querySelector('[role="status"]').textContent).toBe('You are offline.'));
    expect(view.querySelector('[data-mode="both"]').getAttribute('aria-checked')).toBe('true');
    expect(view.querySelector('a[href="#/me/teaching"]')).not.toBeNull();
    expect(context.profile.usage_mode).toBe('both');
    expect(onModeChange).not.toHaveBeenCalled();
  });
```

Add to `tests/unit/today-state.test.js`:

```js
  it('orders the cards by mode', () => {
    const finishItem = { item_id: 'f', item_type: 'scheduled', status: 'scheduled', coach_profile_id: 'me',
      starts_at: '2026-10-11T15:00:00Z', duration_minutes: 60, local_date: '2026-10-11' };
    const teachNext = { item_id: 't', item_type: 'scheduled', status: 'scheduled', coach_profile_id: 'me',
      starts_at: '2026-10-11T20:00:00Z', duration_minutes: 60, local_date: '2026-10-11' };
    const attendNext = { ...teachNext, item_id: 'a', coach_profile_id: 'other', starts_at: '2026-10-11T19:00:00Z' };
    const rate = { occurrence_id: 'o1', role: 'participant', kind: 'group', occurred_at: '2026-10-11T10:00:00Z', has_rating: false };
    const input = { calendarItems: [finishItem, teachNext, attendNext], recent: [rate], profileId: 'me', now };
    expect(nowNextCard({ ...input, mode: 'both' })).toMatchObject({ type: 'finish' });
    expect(nowNextCard({ ...input, mode: 'train' })).toMatchObject({ type: 'rate' });
    expect(nowNextCard({ ...input, mode: 'train', recent: [] })).toEqual({ type: 'next', item: attendNext, teaching: false });
    expect(nowNextCard({ ...input, mode: 'teach', calendarItems: [teachNext, attendNext] }))
      .toEqual({ type: 'next', item: teachNext, teaching: true });
    expect(nowNextCard({ ...input, mode: 'teach', calendarItems: [attendNext] })).toMatchObject({ type: 'rate' });
    expect(nowNextCard({ ...input, mode: 'teach', calendarItems: [attendNext], recent: [] }))
      .toEqual({ type: 'next', item: attendNext, teaching: false });
  });
```

In `tests/unit/today-screen.test.js`, rename every `listCalendar:` mock to `listMyCalendar:` (three places) and add to the first test, after `const view = await renderToday(context);`:

```js
    expect(training.listMyCalendar).toHaveBeenCalledWith({ start: '2026-10-05', endExclusive: '2026-10-13' });
```

In `tests/unit/calendar-screen.test.js`, replace the `items` constant and both tests' service mocks:

```js
const items = [
  { item_id: 'o1', item_type: 'completed', status: 'completed', kind: 'group', local_date: '2026-10-09', starts_at: '2026-10-09T19:00:00Z',
    duration_minutes: 86, group_name: 'Grupo Lua', role: 'participant', resource_kinds: ['summary', 'video'] },
  { item_id: 'o2', item_type: 'completed', status: 'completed', kind: 'alone', local_date: '2026-10-09', starts_at: '2026-10-09T07:30:00Z',
    duration_minutes: 45, role: 'participant', resource_kinds: [] },
  { item_id: 's1', item_type: 'scheduled', status: 'scheduled', kind: 'group', local_date: '2026-10-15', starts_at: '2026-10-15T19:00:00Z',
    duration_minutes: 60, coach_profile_id: 'other', role: 'participant', resource_kinds: [] },
  { item_id: 's2', item_type: 'scheduled', status: 'scheduled', kind: 'personal_class', local_date: '2026-10-16', starts_at: '2026-10-16T19:00:00Z',
    duration_minutes: 60, coach_profile_id: 'me', role: 'coach', resource_kinds: [] },
];
```

In the first test use `const training = { listMyCalendar: vi.fn().mockResolvedValue(items) };`, in the second `const training = { listMyCalendar: vi.fn().mockResolvedValue(items) };`, and add a third test:

```js
  it('opens the class page for a class I teach', async () => {
    const context = ctx({ listMyCalendar: vi.fn().mockResolvedValue(items) });
    const view = await renderCalendar(context, { name: 'calendar', params: { month: null, day: null } });
    document.body.replaceChildren(view);
    view.querySelector('[data-date="2026-10-16"]').click();
    document.querySelector('[role="dialog"] .day-item').click();
    expect(context.navigate).toHaveBeenCalledWith('/class/s2');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/me-screen.test.js tests/unit/today-state.test.js tests/unit/today-screen.test.js tests/unit/calendar-screen.test.js`
Expected: FAIL — no slider on Me, `listMyCalendar` not called, cards not ordered by mode.

- [ ] **Step 3: Implement Me**

Replace `renderMe` in `src/app/screens/me.js` (keep `renderSettings` from Task 4) and update the imports at the top of the file to:

```js
import { listsTeaching, modeOf } from '../shell/access.js';
import { el, initials, pageHeader } from '../shell/page.js';
import { createModeSlider } from './mode-slider.js';
import { createProfileForm, saveProfile } from './profile-form.js';

const ROWS = [
  ['progress', 'app.progress', '📈'], ['repertoire', 'app.repertoire', '📚'], ['teaching', 'app.teaching', '🧑‍🏫'],
  ['groups', 'app.groups', '👥'], ['catalog', 'app.catalog', '🗂️'], ['settings', 'app.settings', '⚙️'],
];

export async function renderMe(ctx, _route = {}, { onModeChange = () => {} } = {}) {
  const { document, i18n, profile, services } = ctx;
  let curator = false;
  try {
    curator = await services.catalog.amICurator();
  } catch {
    curator = false;
  }
  const list = el(document, 'nav', { className: 'me-list', attrs: { 'aria-label': i18n.t('app.me') } });
  function renderRows(mode) {
    list.replaceChildren(...ROWS
      .filter(([section]) => (section !== 'teaching' || listsTeaching(mode)) && (section !== 'catalog' || curator))
      .map(([section, key, icon]) => el(document, 'a', { className: 'me-row', attrs: { href: `#/me/${section}` } }, [
        el(document, 'span', { text: `${icon} ${i18n.t(key)}` }),
        el(document, 'span', { className: 'muted', text: '›' }),
      ])));
  }
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  let saved = modeOf(profile);
  let request = 0;
  const slider = createModeSlider({
    document, i18n, value: saved,
    onChange: async (mode) => {
      const mine = ++request;
      status.textContent = '';
      try {
        await services.profile.setUsageMode(mode);
        if (mine !== request) return;
        saved = mode;
        profile.usage_mode = mode;
        if (mode !== 'train') ctx.markCoach();
        renderRows(mode);
        onModeChange(mode);
      } catch (error) {
        if (mine !== request) return;
        slider.set(saved);
        status.textContent = error?.message || i18n.t('mode.saveError');
      }
    },
  });
  renderRows(saved);
  return el(document, 'section', { className: 'screen screen-me' }, [
    pageHeader({ document, title: i18n.t('app.me') }),
    el(document, 'a', { className: 'me-top', attrs: { href: '#/me/settings', 'aria-label': `${profile.display_name} · ${i18n.t('profileForm.title')}` } }, [
      el(document, 'div', { className: 'me-avatar', text: initials(profile.display_name), attrs: { 'aria-hidden': 'true' } }),
      el(document, 'div', { className: 'me-name', text: profile.display_name }),
    ]),
    slider.element,
    status,
    list,
  ]);
}
```

In `src/app/entries/app.js`, change the Me case to:

```js
      case 'me': return renderMe(ctx, route, { onModeChange: () => layout.refreshCopy() });
```

Append to `assets/app.css`:

```css
.me-top { text-decoration: none; }
```

- [ ] **Step 4: Order Today's card by mode**

In `src/app/screens/today-state.js`, replace `nowNextCard` with:

```js
// Ruling R10: which card wins depends on how the person uses roda.
const ORDER = {
  train: ['rate', 'nextAttend', 'finish', 'nextTeach'],
  both: ['finish', 'rate', 'next'],
  teach: ['finish', 'nextTeach', 'rate', 'nextAttend'],
};

export function nowNextCard({ calendarItems, recent, profileId, now, todayIso: localToday = null, mode = 'both' }) {
  const time = now.getTime();
  const teaches = (item) => item.coach_profile_id === profileId;
  const scheduled = calendarItems.filter((item) => item.item_type === 'scheduled' && item.status === 'scheduled');
  const todayIso = localToday ?? now.toISOString().slice(0, 10);
  const tomorrowIso = addDaysIso(todayIso, 1);
  const upcoming = scheduled
    .filter((item) => endOf(item) > time && item.local_date >= todayIso && item.local_date <= tomorrowIso)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const nextOf = (items) => (items[0] ? { type: 'next', item: items[0], teaching: teaches(items[0]) } : null);
  const cards = {
    finish() {
      const item = scheduled
        .filter((entry) => teaches(entry) && endOf(entry) <= time && time - endOf(entry) < 12 * HOUR)
        .sort((a, b) => endOf(b) - endOf(a))[0];
      return item ? { type: 'finish', item } : null;
    },
    rate() {
      const training = recent.find((entry) => entry.role === 'participant' && entry.kind !== 'alone'
        && !entry.has_rating && time - new Date(entry.occurred_at).getTime() < 12 * HOUR);
      return training ? { type: 'rate', training } : null;
    },
    next: () => nextOf(upcoming),
    nextTeach: () => nextOf(upcoming.filter(teaches)),
    nextAttend: () => nextOf(upcoming.filter((item) => !teaches(item))),
  };
  for (const key of ORDER[mode] ?? ORDER.both) {
    const card = cards[key]();
    if (card) return card;
  }
  return null;
}
```

In `src/app/screens/today.js`:

1. Add `import { modeOf } from '../shell/access.js';`.
2. Replace `ctx.services.training.listCalendar({ start: range.start, endExclusive: range.endExclusive })` with `ctx.services.training.listMyCalendar({ start: range.start, endExclusive: range.endExclusive })`.
3. Replace the `nowNextCard(...)` call with:

```js
  const card = nowNextCard({ calendarItems, recent, profileId: profile.id, now: ctx.now(), todayIso, mode: modeOf(profile) });
```

- [ ] **Step 5: Read the calendar with coaching items**

In `src/app/screens/calendar.js`:

1. Replace the `dayItem` function with:

```js
function dayItem(ctx, item) {
  const { document, i18n } = ctx;
  const upcoming = item.item_type !== 'completed';
  const time = new Intl.DateTimeFormat(i18n.locale() === 'pt' ? 'pt-PT' : 'en-US', {
    hour: '2-digit', minute: '2-digit', timeZone: ctx.timezone,
  }).format(new Date(item.starts_at));
  const title = [kindLabel(i18n, item.kind), item.group_name].filter(Boolean).join(' · ');
  const meta = [time, i18n.formatDuration(item.duration_minutes), upcoming ? i18n.t('cal.upcoming') : null].filter(Boolean).join(' · ');
  const target = upcoming
    ? (item.role === 'coach' ? `/class/${item.item_id}` : null)
    : `/training/${item.item_id}`;
  return el(document, target ? 'button' : 'div', {
    className: `card day-item${upcoming ? ' upcoming' : ''}`, attrs: target ? { type: 'button' } : {},
    on: target ? { click: () => { ctx.navigate(target); } } : {},
  }, [el(document, 'div', {}, [el(document, 'strong', { text: title }), el(document, 'div', { className: 'muted', text: meta })]),
    resourceIcons(document, i18n, item.resource_kinds ?? [])]);
}
```

2. Replace the `let items; let kinds; try { ... } catch ...` block in `renderCalendar` with:

```js
  let items;
  try {
    items = await ctx.services.training.listMyCalendar({ start: bounds.start, endExclusive: bounds.endExclusive });
  } catch (error) {
    screen.append(el(document, 'p', { className: 'muted', text: error?.message || i18n.t('app.loadError') }));
    return screen;
  }
```

3. In `openDay`, replace `dayItems.map((item) => dayItem(ctx, item, kinds))` with `dayItems.map((item) => dayItem(ctx, item))`.

- [ ] **Step 6: Run the unit tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 7: Write the browser test for a coach's own classes**

```js
// tests/e2e/app-coach-calendar.spec.js
import { expect, test } from '@playwright/test';

import { seedAccount } from './app-helpers.js';

const trainingState = {
  plans: [{
    plan_id: 'plan-1', version_id: 'version-1', title: 'Armada ladder', state: 'published', expected_duration_minutes: 60,
    rounds: [{ source_text: 'ginga 10 min', movements: [] }], updated_at: '2026-10-01T12:00:00Z',
  }],
  schedules: [{
    id: 'schedule-bia', kind: 'personal_class', state: 'scheduled', plan_version_id: 'version-1', group_id: null,
    student_profile_id: 'student-bia', connection_id: 'connection-bia', arranged_by: 'practitioner-1',
    starts_at: '2026-10-14T18:00:00Z', local_date: '2026-10-14', timezone: 'Europe/Lisbon',
    duration_minutes: 60, visible_in_advance: true,
  }],
  occurrences: [], participations: [], counter: 10,
};

test.beforeEach(async ({ page }) => {
  await seedAccount(page, {
    profile: { usage_mode: 'both' },
    coachProfile: { profile_id: 'practitioner-1' },
    extra: {
      'roda.e2e.trainingState': trainingState,
      'roda.e2e.connectionState': { people: { 'student-bia': 'Bia Santos' }, connections: [] },
    },
  });
});

test('Calendar shows a personal class the coach arranged and opens its class page', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
  await page.goto('/app#/calendar/2026-10');
  await page.locator('[data-date="2026-10-14"]').click();
  await page.getByRole('dialog').locator('.day-item').click();
  await expect(page).toHaveURL(/#\/class\/schedule-bia$/);
});

test('Today offers to finish a personal class that just ended', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-14T19:30:00Z'));
  await page.goto('/app');
  await expect(page.locator('.now-card')).toContainText('Your class just ended');
  await page.locator('.now-card').getByRole('button', { name: 'Finish class' }).click();
  await expect(page).toHaveURL(/#\/class\/schedule-bia$/);
});
```

- [ ] **Step 8: Run all suites**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/screens/me.js src/app/screens/today-state.js src/app/screens/today.js src/app/screens/calendar.js \
  src/app/entries/app.js assets/app.css tests/unit/me-screen.test.js tests/unit/today-state.test.js \
  tests/unit/today-screen.test.js tests/unit/calendar-screen.test.js tests/e2e/app-coach-calendar.spec.js
git commit -m "feat: switch mode from Me and show a coach's own classes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Start-time chip in Log training

**Files:**
- Create: `src/app/screens/start-time.js`, `tests/unit/start-time.test.js`
- Modify: `src/app/screens/log.js`, `src/app/dashboard-i18n.js`, `assets/app.css`
- Test: `tests/unit/log-screen.test.js`, `tests/unit/app-css.test.js`, `tests/e2e/app-log.spec.js`

**Interfaces:**
- Consumes: `scheduledInstant(date, time, timezone)` from `src/app/time-zones.js`.
- Produces: `localClock(date, timezone) → 'HH:MM'`; `defaultStartTime({ now, timezone, durationMinutes }) → 'HH:MM'`; `startInstant({ localDate, startTime, timezone, now }) → { occurredAt } | { error: i18nKey }` with keys `'coach.invalidDateTime'`, `'coach.nonexistentTime'`, `'log.futureStart'`. Task 8 reuses all three.
- Produces: Log training sends `occurredAt` to `recordAloneTraining`; the draft stores `startTime` and `startTouched`; the chip is `input[type="time"][data-chip="start"]` labelled "Start time".

Ruling R11: the default is now minus the duration, rounded down to 5 minutes and never before 00:00; it follows the duration until edited; a future start is refused. `.chip-input` controls move to 16 px (Global Constraints).

- [ ] **Step 1: Add i18n keys**

`en`:

```js
    'log.startTime': 'Start time',
    'log.futureStart': 'That start time is still ahead. Choose a time that has passed.',
```

`pt`:

```js
    'log.startTime': 'Hora de início',
    'log.futureStart': 'Essa hora de início ainda não chegou. Escolhe uma hora que já passou.',
```

- [ ] **Step 2: Write the failing tests**

```js
// tests/unit/start-time.test.js
import { describe, expect, it } from 'vitest';

import { defaultStartTime, localClock, startInstant } from '../../src/app/screens/start-time.js';

describe('start time', () => {
  it('defaults to now minus the duration, rounded down, never before midnight', () => {
    expect(localClock(new Date('2026-10-11T12:07:00Z'), 'UTC')).toBe('12:07');
    expect(defaultStartTime({ now: new Date('2026-10-11T12:07:00Z'), timezone: 'Europe/Lisbon', durationMinutes: 45 })).toBe('12:20');
    expect(defaultStartTime({ now: new Date('2026-10-11T23:20:00Z'), timezone: 'Europe/Lisbon', durationMinutes: 60 })).toBe('00:00');
  });

  it('turns a date and time into an instant and refuses future or impossible times', () => {
    const now = new Date('2026-10-11T12:00:00Z');
    expect(startInstant({ localDate: '2026-10-10', startTime: '19:00', timezone: 'Europe/Lisbon', now }))
      .toEqual({ occurredAt: '2026-10-10T18:00:00.000Z' });
    expect(startInstant({ localDate: '2026-10-11', startTime: '13:30', timezone: 'Europe/Lisbon', now }))
      .toEqual({ error: 'log.futureStart' });
    expect(startInstant({ localDate: '2026-03-29', startTime: '01:30', timezone: 'Europe/Lisbon', now }))
      .toEqual({ error: 'coach.nonexistentTime' });
    expect(startInstant({ localDate: '2026-10-10', startTime: '', timezone: 'UTC', now }))
      .toEqual({ error: 'coach.invalidDateTime' });
  });
});
```

In `tests/unit/log-screen.test.js`, add `now: () => new Date('2026-10-11T12:00:00Z'),` to the object returned by `ctx()` (before `...extra`), add `occurredAt: '2026-10-10T11:15:00.000Z',` to the `expect.objectContaining({...})` in the first test, and append these tests:

```js
  it('sends the start-time chip, which follows the duration until edited', async () => {
    const training = {
      createIdempotencyKey: vi.fn(() => 'k'),
      recordAloneTraining: vi.fn().mockResolvedValue({ status: 'completed', occurrence_id: 'o2' }),
      addResource: vi.fn(),
    };
    const view = await renderLog(ctx(training));
    document.body.replaceChildren(view);
    const start = document.querySelector('input[data-chip="start"]');
    expect(start.getAttribute('aria-label')).toBe('Start time');
    expect(start.value).toBe('12:15');
    const duration = document.querySelector('select[aria-label="Duration"]');
    duration.value = '90';
    duration.dispatchEvent(new Event('change', { bubbles: true }));
    expect(start.value).toBe('11:30');
    start.value = '07:30';
    start.dispatchEvent(new Event('change', { bubbles: true }));
    duration.value = '60';
    duration.dispatchEvent(new Event('change', { bubbles: true }));
    expect(start.value).toBe('07:30');
    const date = document.querySelector('input[aria-label="Training date"]');
    date.value = '2026-10-09';
    date.dispatchEvent(new Event('change', { bubbles: true }));
    send('ginga 10 min');
    document.querySelector('button[data-action="save"]').click();
    await vi.waitFor(() => expect(training.recordAloneTraining).toHaveBeenCalledWith(expect.objectContaining({
      localDate: '2026-10-09', durationMinutes: 60, occurredAt: '2026-10-09T06:30:00.000Z',
    })));
  });

  it('refuses a start time later than now and keeps the draft', async () => {
    const training = { createIdempotencyKey: vi.fn(() => 'k'), recordAloneTraining: vi.fn() };
    const view = await renderLog(ctx(training));
    document.body.replaceChildren(view);
    const start = document.querySelector('input[data-chip="start"]');
    start.value = '23:30';
    start.dispatchEvent(new Event('change', { bubbles: true }));
    send('ginga 10 min');
    document.querySelector('button[data-action="save"]').click();
    expect(document.querySelector('.log-status').textContent).toBe('That start time is still ahead. Choose a time that has passed.');
    expect(training.recordAloneTraining).not.toHaveBeenCalled();
    expect(document.querySelector('textarea[data-round-text]').value).toBe('ginga 10 min');
  });
```

In `tests/unit/app-css.test.js`, add to the 16 px test:

```js
    expect(css).toMatch(/\.chip-input\s*\{[^}]*font-size:\s*16px/);
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/unit/start-time.test.js tests/unit/log-screen.test.js tests/unit/app-css.test.js`
Expected: FAIL — `start-time.js` not found, no start chip, `.chip-input` is `.85rem`.

- [ ] **Step 4: Implement the helpers**

```js
// src/app/screens/start-time.js
import { scheduledInstant } from '../time-zones.js';

export function localClock(date, timezone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
}

// Ruling R11: "I just finished" — now minus the duration, rounded down to
// five minutes, and never before midnight of today.
export function defaultStartTime({ now, timezone, durationMinutes }) {
  const [hours, minutes] = localClock(now, timezone).split(':').map(Number);
  const start = Math.max(0, hours * 60 + minutes - (Number(durationMinutes) || 0));
  const rounded = start - (start % 5);
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
}

export function startInstant({ localDate, startTime, timezone, now }) {
  let occurredAt;
  try {
    occurredAt = scheduledInstant(localDate, startTime, timezone);
  } catch (error) {
    return { error: String(error?.message).includes('does not exist') ? 'coach.nonexistentTime' : 'coach.invalidDateTime' };
  }
  if (new Date(occurredAt) > now) return { error: 'log.futureStart' };
  return { occurredAt };
}
```

- [ ] **Step 5: Add the chip to Log training**

In `src/app/screens/log.js`:

1. Add `import { defaultStartTime, startInstant } from './start-time.js';`.
2. Add to the `state` object after `idempotencyKey`:

```js
    startTime: saved?.startTime ?? null,
    startTouched: saved?.startTouched ?? false,
```

3. Right after the `state` object, add:

```js
  const now = () => ctx.now?.() ?? new Date();
  const startFor = () => defaultStartTime({ now: now(), timezone: ctx.timezone, durationMinutes: state.durationMinutes });
  if (!state.startTime) state.startTime = startFor();
```

4. Replace the line `duration.addEventListener('change', () => { state.durationMinutes = Number(duration.value); persist(); });` with:

```js
  const startInput = el(document, 'input', {
    className: 'chip-input', attrs: { type: 'time', step: '300', 'aria-label': i18n.t('log.startTime') }, dataset: { chip: 'start' },
  });
  startInput.value = state.startTime;
  startInput.addEventListener('change', () => {
    if (startInput.value) {
      state.startTime = startInput.value;
      state.startTouched = true;
    } else {
      startInput.value = state.startTime;
    }
    persist();
  });
  duration.addEventListener('change', () => {
    state.durationMinutes = Number(duration.value);
    if (!state.startTouched) {
      state.startTime = startFor();
      startInput.value = state.startTime;
    }
    persist();
  });
```

5. In the save handler, directly after the `if (!rounds.length) { ... return; }` block, add:

```js
    const start = startInstant({ localDate: state.localDate, startTime: state.startTime, timezone: ctx.timezone, now: now() });
    if (start.error) {
      status.textContent = i18n.t(start.error);
      return;
    }
```

and add `occurredAt: start.occurredAt,` to the object passed to `training.recordAloneTraining(...)`.

6. In `screen.append(...)`, replace `el(document, 'div', { className: 'chip-row' }, [...dateChips, dateInput, duration])` with `el(document, 'div', { className: 'chip-row' }, [...dateChips, dateInput, startInput, duration])`.

In `assets/app.css`, in the `.chip-input { ... }` rule, change `font-size: .85rem;` to `font-size: 16px;`.

- [ ] **Step 6: Run the unit tests**

Run: `npx vitest run tests/unit/start-time.test.js tests/unit/log-screen.test.js tests/unit/app-css.test.js tests/unit/dashboard-i18n.test.js`
Expected: PASS.

- [ ] **Step 7: Add the browser check**

Append to `tests/e2e/app-log.spec.js`:

```js
test('a back-dated log keeps the start time it was given', async ({ page }) => {
  await page.goto('/app#/log');
  await page.getByRole('button', { name: 'Yesterday' }).click();
  await page.getByLabel('Start time').fill('07:30');
  const box = page.getByLabel('Write a round');
  await box.fill('ginga 10 min');
  await box.press('Enter');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/training\//);
  await expect(page.locator('.training-meta')).toContainText('07:30');
});
```

- [ ] **Step 8: Run all suites**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/screens/start-time.js src/app/screens/log.js src/app/dashboard-i18n.js assets/app.css \
  tests/unit/start-time.test.js tests/unit/log-screen.test.js tests/unit/app-css.test.js tests/e2e/app-log.spec.js
git commit -m "feat: add a start-time chip to Log training

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Teaching data and the Schedule a class sheet

**Files:**
- Create: `src/app/screens/teaching-state.js`, `src/app/screens/schedule-sheet.js`, `tests/unit/teaching-state.test.js`, `tests/unit/schedule-sheet.test.js`
- Modify: `src/app/dashboard-i18n.js`, `assets/app.css`

**Interfaces:**
- Consumes: `training.listPlans(null)`, `connection.listMine()`, `group.listMyMemberships()`, `group.listRoster(groupId)`, `training.scheduleGroupTraining(...)`, `training.schedulePersonalClass(...)`, `scheduledInstant`.
- Produces (`teaching-state.js`):
  - `coachGroups(memberships) → [{ id, name, timezone, ownerId }]` (active `coach` memberships of non-archived groups);
  - `coachStudents({ profileId, connections, rosters }) → [{ profileId, name, connectionId, groupId }]` sorted by name (Ruling R21);
  - `studentContext(student) → { groupId, connectionId }` with exactly one set (direct connection first);
  - `pendingStudentRequests({ profileId, connections }) → connection rows` (direct, pending, I am the coach, the student asked);
  - `loadTeaching(ctx) → { plans, connections, memberships, groups, rosters, students }`.
- Produces (`schedule-sheet.js`): `openScheduleSheet(ctx, { teaching?, planVersionId?, target?, onScheduled? }) → sheet` where `target` is `'group:<id>'` or `'student:<profileId>'`; the form is `form.sheet-form` with `select[name="plan"]` (published plans only), `select[name="who"]`, `input[name="date"]`, `input[name="time"]`, `input[name="visible"]`. Default `onScheduled(result)` navigates to `/class/<schedule_id>`.

Ruling R8: scheduling is a sheet, the start must be in the future, and scheduling opens the new class page. Ruling R21: who counts as a student.

- [ ] **Step 1: Add i18n keys**

`en`:

```js
    'schedule.title': 'Schedule a class',
    'schedule.plan': 'Plan',
    'schedule.who': 'Who',
    'schedule.groupOption': 'Group class · {name}',
    'schedule.studentOption': 'Personal class · {name}',
    'schedule.date': 'Date',
    'schedule.time': 'Start time',
    'schedule.visible': 'Show the plan to students before class',
    'schedule.submit': 'Schedule',
    'schedule.past': 'Choose a start time that is still ahead.',
    'schedule.needPlan': 'Publish a plan first, then schedule it.',
    'schedule.needPeople': 'Create a group or connect with a student first.',
    'teaching.newPlan': 'New plan',
```

`pt`:

```js
    'schedule.title': 'Agendar uma aula',
    'schedule.plan': 'Plano',
    'schedule.who': 'Quem',
    'schedule.groupOption': 'Aula de grupo · {name}',
    'schedule.studentOption': 'Aula pessoal · {name}',
    'schedule.date': 'Data',
    'schedule.time': 'Hora de início',
    'schedule.visible': 'Mostrar o plano aos alunos antes da aula',
    'schedule.submit': 'Agendar',
    'schedule.past': 'Escolhe uma hora de início que ainda não passou.',
    'schedule.needPlan': 'Publica primeiro um plano e depois agenda-o.',
    'schedule.needPeople': 'Cria primeiro um grupo ou liga-te a um aluno.',
    'teaching.newPlan': 'Novo plano',
```

- [ ] **Step 2: Write the failing tests**

```js
// tests/unit/teaching-state.test.js
import { describe, expect, it, vi } from 'vitest';

import {
  coachGroups, coachStudents, loadTeaching, pendingStudentRequests, studentContext,
} from '../../src/app/screens/teaching-state.js';

const connections = [
  { connection_id: 'c1', connection_kind: 'direct', state: 'active', coach_profile_id: 'me', student_profile_id: 'bia', student_display_name: 'Bia Santos' },
  { connection_id: null, connection_kind: 'group', state: 'active', coach_profile_id: 'me', student_profile_id: 'bia', student_display_name: 'Bia Santos', group_id: 'g1' },
  { connection_id: 'c2', connection_kind: 'direct', state: 'pending', coach_profile_id: 'me', student_profile_id: 'eva', student_display_name: 'Eva Costa', initiated_by: 'eva' },
  { connection_id: 'c3', connection_kind: 'direct', state: 'active', coach_profile_id: 'mestre', student_profile_id: 'me', student_display_name: 'Ana' },
];
const rosters = {
  g1: [
    { profile_id: 'me', display_name: 'Ana', access_level: 'coach', membership_state: 'active' },
    { profile_id: 'caio', display_name: 'Caio Lima', access_level: 'member', membership_state: 'active' },
    { profile_id: 'duda', display_name: 'Duda Reis', access_level: 'member', membership_state: 'removed' },
  ],
};

describe('teaching state', () => {
  it('merges connections and coached rosters into one student list', () => {
    expect(coachStudents({ profileId: 'me', connections, rosters })).toEqual([
      { profileId: 'bia', name: 'Bia Santos', connectionId: 'c1', groupId: 'g1' },
      { profileId: 'caio', name: 'Caio Lima', connectionId: null, groupId: 'g1' },
    ]);
  });

  it('uses the direct connection for personal classes when there is one', () => {
    expect(studentContext({ connectionId: 'c1', groupId: 'g1' })).toEqual({ groupId: null, connectionId: 'c1' });
    expect(studentContext({ connectionId: null, groupId: 'g1' })).toEqual({ groupId: 'g1', connectionId: null });
  });

  it('lists coached groups and pending student requests', () => {
    const memberships = [
      { group_id: 'g1', state: 'active', access_level: 'coach', group: { name: 'Grupo Lua', timezone: 'Europe/Lisbon', owner_id: 'me', archived_at: null } },
      { group_id: 'g2', state: 'active', access_level: 'member', group: { name: 'Other', archived_at: null } },
      { group_id: 'g3', state: 'left', access_level: 'coach', group: { name: 'Old', archived_at: null } },
      { group_id: 'g4', state: 'active', access_level: 'coach', group: { name: 'Archived', archived_at: '2026-01-01T00:00:00Z' } },
    ];
    expect(coachGroups(memberships)).toEqual([{ id: 'g1', name: 'Grupo Lua', timezone: 'Europe/Lisbon', ownerId: 'me' }]);
    expect(pendingStudentRequests({ profileId: 'me', connections }).map(({ connection_id: id }) => id)).toEqual(['c2']);
  });

  it('loads everything a coach needs at once', async () => {
    const services = {
      training: { listPlans: vi.fn().mockResolvedValue([{ plan_id: 'p1' }]) },
      connection: { listMine: vi.fn().mockResolvedValue(connections) },
      group: {
        listMyMemberships: vi.fn().mockResolvedValue([{ group_id: 'g1', state: 'active', access_level: 'coach', group: { name: 'Grupo Lua' } }]),
        listRoster: vi.fn().mockResolvedValue(rosters.g1),
      },
    };
    const teaching = await loadTeaching({ services, profile: { id: 'me' } });
    expect(services.training.listPlans).toHaveBeenCalledWith(null);
    expect(services.group.listRoster).toHaveBeenCalledWith('g1');
    expect(teaching.groups.map(({ id }) => id)).toEqual(['g1']);
    expect(teaching.students.map(({ profileId }) => profileId)).toEqual(['bia', 'caio']);
    expect(teaching.plans).toEqual([{ plan_id: 'p1' }]);
  });
});
```

```js
// tests/unit/schedule-sheet.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openScheduleSheet } from '../../src/app/screens/schedule-sheet.js';
import { closeSheet } from '../../src/app/shell/sheet.js';
import { appCtx } from './app-test-context.js';

const teaching = {
  plans: [
    { plan_id: 'p1', version_id: 'v1', title: 'Armada ladder', state: 'published' },
    { plan_id: 'p2', version_id: 'v2', title: 'Still a draft', state: 'draft' },
  ],
  groups: [{ id: 'g1', name: 'Grupo Lua' }],
  students: [{ profileId: 'bia', name: 'Bia Santos', connectionId: 'c1', groupId: 'g1' }],
};

async function sheetForm() {
  await vi.waitFor(() => expect(document.querySelector('form.sheet-form')).not.toBeNull());
  return document.querySelector('form.sheet-form');
}

describe('schedule sheet', () => {
  beforeEach(() => { closeSheet(); document.body.replaceChildren(); });

  it('schedules a group class in the local timezone and opens it', async () => {
    const training = { scheduleGroupTraining: vi.fn().mockResolvedValue({ status: 'scheduled', schedule_id: 's9' }) };
    const ctx = appCtx({ services: { training } });
    openScheduleSheet(ctx, { teaching });
    const form = await sheetForm();
    expect([...form.querySelector('select[name="plan"]').options].map((option) => option.textContent)).toEqual(['Armada ladder']);
    expect([...form.querySelector('select[name="who"]').options].map((option) => option.textContent))
      .toEqual(['Group class · Grupo Lua', 'Personal class · Bia Santos']);
    form.querySelector('input[name="date"]').value = '2026-10-14';
    form.querySelector('input[name="time"]').value = '19:00';
    form.requestSubmit();
    await vi.waitFor(() => expect(ctx.navigate).toHaveBeenCalledWith('/class/s9'));
    expect(training.scheduleGroupTraining).toHaveBeenCalledWith({
      planVersionId: 'v1', groupId: 'g1', localDate: '2026-10-14', startsAt: '2026-10-14T18:00:00.000Z',
      timezone: 'Europe/Lisbon', visibleInAdvance: true,
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('schedules a personal class through the direct connection', async () => {
    const training = { schedulePersonalClass: vi.fn().mockResolvedValue({ schedule_id: 's10' }) };
    const ctx = appCtx({ services: { training } });
    const onScheduled = vi.fn();
    openScheduleSheet(ctx, { teaching, target: 'student:bia', onScheduled });
    const form = await sheetForm();
    expect(form.querySelector('select[name="who"]').value).toBe('student:bia');
    form.querySelector('input[name="date"]').value = '2026-10-15';
    form.querySelector('input[name="time"]').value = '08:00';
    form.querySelector('input[name="visible"]').checked = false;
    form.requestSubmit();
    await vi.waitFor(() => expect(onScheduled).toHaveBeenCalledWith({ schedule_id: 's10' }));
    expect(training.schedulePersonalClass).toHaveBeenCalledWith({
      planVersionId: 'v1', localDate: '2026-10-15', startsAt: '2026-10-15T07:00:00.000Z', timezone: 'Europe/Lisbon',
      visibleInAdvance: false, studentProfileId: 'bia', groupId: null, connectionId: 'c1',
    });
  });

  it('refuses a start in the past', async () => {
    const training = { scheduleGroupTraining: vi.fn() };
    const ctx = appCtx({ services: { training } });
    openScheduleSheet(ctx, { teaching });
    const form = await sheetForm();
    form.querySelector('input[name="date"]').value = '2026-10-11';
    form.querySelector('input[name="time"]').value = '09:00';
    form.requestSubmit();
    expect(form.querySelector('[role="status"]').textContent).toBe('Choose a start time that is still ahead.');
    expect(training.scheduleGroupTraining).not.toHaveBeenCalled();
  });

  it('explains a missing plan and loads the teaching data itself when none is given', async () => {
    const services = {
      training: { listPlans: vi.fn().mockResolvedValue([]) },
      connection: { listMine: vi.fn().mockResolvedValue([]) },
      group: { listMyMemberships: vi.fn().mockResolvedValue([]), listRoster: vi.fn() },
    };
    const ctx = appCtx({ services });
    openScheduleSheet(ctx);
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]').textContent).toContain('Publish a plan first, then schedule it.'));
    document.querySelector('[role="dialog"] [data-action="schedule-help"]').click();
    expect(ctx.navigate).toHaveBeenCalledWith('/me/teaching/plans/new');
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/unit/teaching-state.test.js tests/unit/schedule-sheet.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement the teaching state**

```js
// src/app/screens/teaching-state.js
export function coachGroups(memberships = []) {
  return memberships
    .filter((membership) => membership.state === 'active' && membership.access_level === 'coach'
      && membership.group && !membership.group.archived_at)
    .map((membership) => ({
      id: membership.group_id,
      name: membership.group.name,
      timezone: membership.group.timezone ?? null,
      ownerId: membership.group.owner_id ?? null,
    }));
}

// Ruling R21: active coaching connections (direct or through a group) plus the
// active members of groups I coach, never myself.
export function coachStudents({ profileId, connections = [], rosters = {} }) {
  const byId = new Map();
  const entry = (id, name) => byId.get(id) ?? { profileId: id, name, connectionId: null, groupId: null };
  for (const connection of connections) {
    if (connection.state !== 'active' || connection.coach_profile_id !== profileId) continue;
    if (connection.student_profile_id === profileId) continue;
    const student = entry(connection.student_profile_id, connection.student_display_name);
    if (connection.connection_kind === 'direct') student.connectionId ??= connection.connection_id;
    else student.groupId ??= connection.group_id ?? null;
    byId.set(student.profileId, student);
  }
  for (const [groupId, roster] of Object.entries(rosters)) {
    for (const member of roster ?? []) {
      if (member.access_level !== 'member' || (member.membership_state ?? 'active') !== 'active') continue;
      if (member.profile_id === profileId) continue;
      const student = entry(member.profile_id, member.display_name);
      student.groupId ??= groupId;
      byId.set(student.profileId, student);
    }
  }
  return [...byId.values()].sort((left, right) => String(left.name).localeCompare(String(right.name)));
}

export function studentContext(student) {
  return student?.connectionId
    ? { groupId: null, connectionId: student.connectionId }
    : { groupId: student?.groupId ?? null, connectionId: null };
}

export function pendingStudentRequests({ profileId, connections = [] }) {
  return connections.filter((connection) => connection.connection_kind === 'direct'
    && connection.state === 'pending' && connection.coach_profile_id === profileId
    && connection.initiated_by !== profileId);
}

export async function loadTeaching(ctx) {
  const { services, profile } = ctx;
  const [plans, connections, memberships] = await Promise.all([
    services.training.listPlans(null),
    services.connection.listMine(),
    services.group.listMyMemberships(),
  ]);
  const groups = coachGroups(memberships);
  const rosters = Object.fromEntries(await Promise.all(groups.map(async (group) => [
    group.id, await services.group.listRoster(group.id).catch(() => []),
  ])));
  return {
    plans, connections, memberships, groups, rosters,
    students: coachStudents({ profileId: profile.id, connections, rosters }),
  };
}
```

- [ ] **Step 5: Implement the sheet**

```js
// src/app/screens/schedule-sheet.js
import { scheduledInstant } from '../time-zones.js';
import { el } from '../shell/page.js';
import { loadTeaching, studentContext } from './teaching-state.js';

function field(document, label, control) {
  return el(document, 'label', { className: 'field-label' }, [label, control]);
}

function timeProblem(error) {
  return String(error?.message).includes('does not exist') ? 'coach.nonexistentTime' : 'coach.invalidDateTime';
}

function help(ctx, { messageKey, buttonKey, path, close }) {
  const { document, i18n } = ctx;
  return el(document, 'div', {}, [
    el(document, 'p', { className: 'muted', text: i18n.t(messageKey) }),
    el(document, 'button', {
      className: 'button-secondary', text: i18n.t(buttonKey), attrs: { type: 'button' }, dataset: { action: 'schedule-help' },
      on: { click: () => { close(); ctx.navigate(path); } },
    }),
  ]);
}

function buildForm(ctx, teaching, { planVersionId, target, onScheduled, close }) {
  const { document, i18n } = ctx;
  const plans = teaching.plans.filter((plan) => plan.state === 'published');
  const targets = [
    ...teaching.groups.map((group) => [`group:${group.id}`, i18n.t('schedule.groupOption', { name: group.name })]),
    ...teaching.students.map((student) => [`student:${student.profileId}`, i18n.t('schedule.studentOption', { name: student.name })]),
  ];
  if (!plans.length) return help(ctx, { messageKey: 'schedule.needPlan', buttonKey: 'teaching.newPlan', path: '/me/teaching/plans/new', close });
  if (!targets.length) return help(ctx, { messageKey: 'schedule.needPeople', buttonKey: 'app.groups', path: '/me/groups', close });

  const option = ([value, text]) => el(document, 'option', { text, attrs: { value } });
  const plan = el(document, 'select', { className: 'field-input', attrs: { name: 'plan' } },
    plans.map(({ version_id: id, title }) => option([id, title])));
  if (planVersionId && plans.some(({ version_id: id }) => id === planVersionId)) plan.value = planVersionId;
  const who = el(document, 'select', { className: 'field-input', attrs: { name: 'who' } }, targets.map(option));
  if (target && targets.some(([value]) => value === target)) who.value = target;
  const date = el(document, 'input', { className: 'field-input', attrs: { type: 'date', name: 'date', min: ctx.today(), required: true } });
  date.value = ctx.today();
  const time = el(document, 'input', { className: 'field-input', attrs: { type: 'time', name: 'time', step: '300', required: true } });
  time.value = '19:00';
  const visible = el(document, 'input', { attrs: { type: 'checkbox', name: 'visible' } });
  visible.checked = true;
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  const submit = el(document, 'button', { className: 'button-primary', text: i18n.t('schedule.submit'), attrs: { type: 'submit' } });
  const form = el(document, 'form', { className: 'sheet-form', attrs: { novalidate: true } }, [
    field(document, i18n.t('schedule.plan'), plan),
    field(document, i18n.t('schedule.who'), who),
    field(document, i18n.t('schedule.date'), date),
    field(document, i18n.t('schedule.time'), time),
    el(document, 'label', { className: 'check-row' }, [visible, ` ${i18n.t('schedule.visible')}`]),
    status, submit,
  ]);
  let busy = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    status.textContent = '';
    let startsAt;
    try {
      startsAt = scheduledInstant(date.value, time.value, ctx.timezone);
    } catch (error) {
      status.textContent = i18n.t(timeProblem(error));
      return;
    }
    if (new Date(startsAt) <= ctx.now()) {
      status.textContent = i18n.t('schedule.past');
      return;
    }
    busy = true;
    submit.disabled = true;
    const [kind, id] = who.value.split(':');
    const common = {
      planVersionId: plan.value, localDate: date.value, startsAt, timezone: ctx.timezone, visibleInAdvance: visible.checked,
    };
    try {
      const result = kind === 'group'
        ? await ctx.services.training.scheduleGroupTraining({ ...common, groupId: id })
        : await ctx.services.training.schedulePersonalClass({
          ...common, studentProfileId: id,
          ...studentContext(teaching.students.find(({ profileId }) => profileId === id)),
        });
      close();
      onScheduled(result);
    } catch (error) {
      status.textContent = error?.message || i18n.t('coach.scheduleSaveError');
    } finally {
      busy = false;
      submit.disabled = false;
    }
  });
  return form;
}

// Ruling R8: a bottom sheet; with no `teaching` given it loads the data itself.
export function openScheduleSheet(ctx, {
  teaching = null, planVersionId = null, target = null,
  onScheduled = (result) => ctx.navigate(`/class/${result.schedule_id}`),
} = {}) {
  const { document, i18n } = ctx;
  const body = el(document, 'div', { className: 'schedule-sheet' }, [
    el(document, 'p', { className: 'muted', text: i18n.t('app.loading') }),
  ]);
  const sheet = ctx.openSheet({ title: i18n.t('schedule.title'), content: body });
  Promise.resolve(teaching ?? loadTeaching(ctx)).then((data) => {
    if (!body.isConnected) return;
    body.replaceChildren(buildForm(ctx, data, { planVersionId, target, onScheduled, close: () => sheet.close() }));
    body.querySelector('select, button')?.focus();
  }).catch((error) => {
    if (body.isConnected) body.replaceChildren(el(document, 'p', { className: 'muted', text: error?.message || i18n.t('app.loadError') }));
  });
  return sheet;
}
```

Append to `assets/app.css`:

```css
/* Sheets with forms */
.sheet-form { display: grid; gap: 4px; margin-top: 10px; }
```

- [ ] **Step 6: Run the unit tests**

Run: `npx vitest run tests/unit/teaching-state.test.js tests/unit/schedule-sheet.test.js tests/unit/dashboard-i18n.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/screens/teaching-state.js src/app/screens/schedule-sheet.js src/app/dashboard-i18n.js assets/app.css \
  tests/unit/teaching-state.test.js tests/unit/schedule-sheet.test.js
git commit -m "feat: add teaching data and the Schedule a class sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Record a past class and + per mode

**Files:**
- Create: `src/app/screens/resource-queue.js`, `src/app/screens/record-class.js`, `src/app/screens/plus-menu.js`, `tests/unit/resource-queue.test.js`, `tests/unit/record-class.test.js`, `tests/unit/plus-menu.test.js`, `tests/e2e/app-mode.spec.js`
- Modify: `src/app/screens/log.js`, `src/app/shell/layout.js`, `src/app/entries/app.js`, `src/app/dashboard-i18n.js`, `assets/app.css`
- Test: `tests/unit/layout.test.js`, `tests/unit/log-screen.test.js` (must still pass unchanged)

**Interfaces:**
- Consumes: `loadTeaching`, `studentContext` (Task 7), `openScheduleSheet` (Task 7), `defaultStartTime`, `startInstant` (Task 6), `plusActions`, `modeOf` (Task 3), `training.recordPastClass(input, now)`, `createRoundEditor`, `createChatBox`, `splitRounds`.
- Produces: `saveResourcesOrQueue({ storage, service, occurrenceId, resources }) → number of queued resources` (failures go to `roda.pendingResources:<occurrenceId>`, the queue the training page already retries).
- Produces: `renderRecordClass(ctx, route)` at `#/me/teaching/record`; save button `button[data-action="save"]` ("Save class"); kind buttons `[data-kind="group"|"personal_class"]`; fields `select[name="group"]`, `select[name="student"]`, `input[name="attendee"]`, `input[name="date"]`, `input[name="time"]`, `input[name="duration"]`, `input[name="videoLink"]`, `textarea[name="summary"]`, `textarea[name="transcript"]`.
- Produces: `openPlusMenu(ctx, actions)` — a sheet titled "Create" with `button[data-plus="log"|"schedule"|"record"]`.
- Produces: `createLayout({ document, i18n, onPlus, plusLabel = () => 'app.logTraining' })` — `refreshCopy()` renders the desktop button as `+ ${i18n.t(plusLabel())}`.

Ruling R7: Record a past class is the page `#/me/teaching/record`. Ruling R9: the desktop button reads "+ Log training" in Train and "+ Create" in Both and Teach.

- [ ] **Step 1: Add i18n keys**

`en`:

```js
    'record.title': 'Record a past class',
    'record.kind': 'Class type',
    'record.group': 'Group',
    'record.student': 'Student',
    'record.attendees': 'Who came',
    'record.save': 'Save class',
    'record.saveError': "We couldn't save this class. Your entries are still here.",
    'classPage.nobody': 'Mark at least one person who came.',
    'plus.log': 'Log my training',
    'plus.schedule': 'Schedule a class',
    'plus.record': 'Record a past class',
```

`pt`:

```js
    'record.title': 'Registar uma aula passada',
    'record.kind': 'Tipo de aula',
    'record.group': 'Grupo',
    'record.student': 'Aluno',
    'record.attendees': 'Quem veio',
    'record.save': 'Guardar aula',
    'record.saveError': 'Não foi possível guardar esta aula. Os dados continuam aqui.',
    'classPage.nobody': 'Marca pelo menos uma pessoa que veio.',
    'plus.log': 'Registar o meu treino',
    'plus.schedule': 'Agendar uma aula',
    'plus.record': 'Registar uma aula passada',
```

- [ ] **Step 2: Write the failing unit tests**

```js
// tests/unit/resource-queue.test.js
import { describe, expect, it, vi } from 'vitest';

import { saveResourcesOrQueue } from '../../src/app/screens/resource-queue.js';

function memoryStorage() {
  const values = new Map();
  return { values, getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
}

describe('resource queue', () => {
  it('saves every resource when the network works', async () => {
    const storage = memoryStorage();
    const service = { addResource: vi.fn().mockResolvedValue({}) };
    const queued = await saveResourcesOrQueue({ storage, service, occurrenceId: 'o1', resources: [{ kind: 'video', title: '', url: 'https://x', body: null }] });
    expect(queued).toBe(0);
    expect(service.addResource).toHaveBeenCalledWith({ occurrenceId: 'o1', kind: 'video', title: '', url: 'https://x', body: null });
    expect(storage.values.size).toBe(0);
  });

  it('queues the failed resource and everything after it', async () => {
    const storage = memoryStorage();
    const service = { addResource: vi.fn().mockResolvedValueOnce({}).mockRejectedValue(new Error('offline')) };
    const resources = [
      { kind: 'video', title: '', url: 'https://x', body: null },
      { kind: 'summary', title: '', url: null, body: '# A' },
      { kind: 'voice', title: '', url: null, body: 'B' },
    ];
    expect(await saveResourcesOrQueue({ storage, service, occurrenceId: 'o2', resources })).toBe(2);
    expect(JSON.parse(storage.values.get('roda.pendingResources:o2'))).toEqual([
      { occurrenceId: 'o2', ...resources[1] }, { occurrenceId: 'o2', ...resources[2] },
    ]);
  });
});
```

```js
// tests/unit/record-class.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderRecordClass } from '../../src/app/screens/record-class.js';
import { closeSheet } from '../../src/app/shell/sheet.js';
import { appCtx } from './app-test-context.js';

function services({ recordPastClass = vi.fn().mockResolvedValue({ status: 'completed', occurrence_id: 'o5' }), connections, memberships } = {}) {
  return {
    training: {
      createIdempotencyKey: vi.fn(() => 'key-r'), recordPastClass,
      addResource: vi.fn().mockResolvedValue({ status: 'saved' }), listPlans: vi.fn().mockResolvedValue([]),
    },
    connection: { listMine: vi.fn().mockResolvedValue(connections ?? [{
      connection_id: 'c1', connection_kind: 'direct', state: 'active', coach_profile_id: 'me',
      student_profile_id: 'bia', student_display_name: 'Bia Santos',
    }]) },
    group: {
      listMyMemberships: vi.fn().mockResolvedValue(memberships ?? [{ group_id: 'g1', state: 'active', access_level: 'coach', group: { name: 'Grupo Lua' } }]),
      listRoster: vi.fn().mockResolvedValue([
        { profile_id: 'me', display_name: 'Ana Silva', access_level: 'coach', membership_state: 'active' },
        { profile_id: 'caio', display_name: 'Caio Lima', access_level: 'member', membership_state: 'active' },
        { profile_id: 'duda', display_name: 'Duda Reis', access_level: 'member', membership_state: 'active' },
      ]),
    },
  };
}

function send(text) {
  const input = document.querySelector('textarea[aria-label="Write a round"]');
  input.value = text;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

const save = () => document.querySelector('button[data-action="save"]').click();
const status = () => document.querySelector('.log-status').textContent;

describe('record a past class', () => {
  beforeEach(() => { localStorage.clear(); closeSheet(); });

  it('records a group class for the checked people with its rounds and resources', async () => {
    const s = services();
    const ctx = appCtx({ services: s });
    document.body.replaceChildren(await renderRecordClass(ctx));
    const boxes = document.querySelectorAll('input[name="attendee"]');
    expect([...boxes].map((box) => box.value)).toEqual(['caio', 'duda']);
    boxes[1].checked = false;
    document.querySelector('input[name="date"]').value = '2026-10-09';
    document.querySelector('input[name="time"]').value = '19:00';
    document.querySelector('input[name="duration"]').value = '90';
    send('ginga 10 min');
    document.querySelector('input[name="videoLink"]').value = 'https://youtu.be/VAI3JUKTwz0';
    save();
    await vi.waitFor(() => expect(ctx.navigate).toHaveBeenCalledWith('/training/o5'));
    expect(s.training.recordPastClass).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'group', groupId: 'g1', connectionId: null, studentProfileId: null, localDate: '2026-10-09',
      occurredAt: '2026-10-09T18:00:00.000Z', timezone: 'Europe/Lisbon', durationMinutes: 90, idempotencyKey: 'key-r',
      attendees: [{ profileId: 'caio', durationMinutes: 90 }],
      rounds: [expect.objectContaining({ source_text: 'ginga 10 min' })],
    }), expect.any(Date));
    expect(s.training.addResource).toHaveBeenCalledWith({
      occurrenceId: 'o5', kind: 'video', title: '', url: 'https://youtu.be/VAI3JUKTwz0', body: null,
    });
  });

  it('records a personal class through the direct connection', async () => {
    const s = services();
    const ctx = appCtx({ services: s });
    document.body.replaceChildren(await renderRecordClass(ctx));
    document.querySelector('[data-kind="personal_class"]').click();
    expect(document.querySelector('select[name="student"]').closest('label').hidden).toBe(false);
    send('10x (armada, au)');
    save();
    await vi.waitFor(() => expect(ctx.navigate).toHaveBeenCalledWith('/training/o5'));
    expect(s.training.recordPastClass).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'personal_class', studentProfileId: 'bia', connectionId: 'c1', groupId: null, attendees: [],
    }), expect.any(Date));
  });

  it('refuses a future start and an empty class, and keeps one request key across retries', async () => {
    const recordPastClass = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ occurrence_id: 'o6' });
    const ctx = appCtx({ services: services({ recordPastClass }) });
    document.body.replaceChildren(await renderRecordClass(ctx));
    send('ginga');
    document.querySelector('input[name="time"]').value = '23:00';
    save();
    expect(status()).toBe('That start time is still ahead. Choose a time that has passed.');
    document.querySelector('input[name="time"]').value = '10:00';
    document.querySelectorAll('input[name="attendee"]').forEach((box) => { box.checked = false; });
    save();
    expect(status()).toBe('Mark at least one person who came.');
    document.querySelector('input[name="attendee"]').checked = true;
    save();
    await vi.waitFor(() => expect(status()).toBe('offline'));
    save();
    await vi.waitFor(() => expect(ctx.navigate).toHaveBeenCalledWith('/training/o6'));
    expect(recordPastClass.mock.calls.map(([input]) => input.idempotencyKey)).toEqual(['key-r', 'key-r']);
  });

  it('explains when there is nobody to record a class for', async () => {
    const ctx = appCtx({ services: services({ connections: [], memberships: [] }) });
    const view = await renderRecordClass(ctx);
    expect(view.textContent).toContain('Create a group or connect with a student first.');
    expect(view.querySelector('a[href="#/me/groups"]')).not.toBeNull();
  });
});
```

```js
// tests/unit/plus-menu.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { openPlusMenu } from '../../src/app/screens/plus-menu.js';
import { closeSheet } from '../../src/app/shell/sheet.js';
import { appCtx } from './app-test-context.js';

describe('+ menu', () => {
  beforeEach(() => { closeSheet(); document.body.replaceChildren(); });

  it('offers the actions for the mode and runs the chosen one', () => {
    const ctx = appCtx();
    openPlusMenu(ctx, ['log', 'schedule', 'record']);
    const sheet = document.querySelector('[role="dialog"]');
    expect(sheet.getAttribute('aria-label')).toBe('Create');
    expect([...sheet.querySelectorAll('[data-plus]')].map((button) => button.textContent))
      .toEqual(['📝 Log my training', '📅 Schedule a class', '🧾 Record a past class']);
    sheet.querySelector('[data-plus="record"]').click();
    expect(ctx.navigate).toHaveBeenCalledWith('/me/teaching/record');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows only what Teach offers', () => {
    openPlusMenu(appCtx(), ['schedule', 'record']);
    expect(document.querySelectorAll('[role="dialog"] [data-plus]')).toHaveLength(2);
  });
});
```

Add to `tests/unit/layout.test.js`:

```js
  it('labels the desktop + from the mode', () => {
    let label = 'app.logTraining';
    const layout = createLayout({ document, i18n, onPlus() {}, plusLabel: () => label });
    document.body.replaceChildren(layout.root);
    expect(document.querySelector('.app-plus-side').textContent).toBe('+ Log training');
    label = 'app.create';
    layout.refreshCopy();
    expect(document.querySelector('.app-plus-side').textContent).toBe('+ Create');
  });
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/unit/resource-queue.test.js tests/unit/record-class.test.js tests/unit/plus-menu.test.js tests/unit/layout.test.js`
Expected: FAIL — modules not found; the layout ignores `plusLabel`.

- [ ] **Step 4: Implement the resource queue and use it in Log training**

```js
// src/app/screens/resource-queue.js
// Saves resources one by one after a training is recorded. Whatever fails
// waits in the training page's "waiting to sync" queue instead of vanishing.
export async function saveResourcesOrQueue({ storage, service, occurrenceId, resources }) {
  const pending = resources.map((resource) => ({ occurrenceId, ...resource }));
  while (pending.length) {
    try {
      await service.addResource(pending[0]);
      pending.shift();
    } catch {
      try {
        storage.setItem(`roda.pendingResources:${occurrenceId}`, JSON.stringify(pending));
      } catch {
        // The training page shows nothing to retry when storage is blocked.
      }
      return pending.length;
    }
  }
  return 0;
}
```

In `src/app/screens/log.js`, add `import { saveResourcesOrQueue } from './resource-queue.js';` and replace the block that starts with `const pending = state.resources.map(` and ends with the closing brace of its `while (pending.length) { ... }` loop with:

```js
      await saveResourcesOrQueue({ storage, service: training, occurrenceId: result.occurrence_id, resources: state.resources });
```

- [ ] **Step 5: Implement Record a past class**

```js
// src/app/screens/record-class.js
import { normalizeResource } from '../training-service.js';
import { splitRounds } from '../training-text-parser.js';
import { el, pageHeader } from '../shell/page.js';
import { createRoundEditor } from '../ui/round-editor.js';
import { createChatBox } from './chat-box.js';
import { saveResourcesOrQueue } from './resource-queue.js';
import { defaultStartTime, startInstant } from './start-time.js';
import { loadTeaching, studentContext } from './teaching-state.js';

function field(document, label, control) {
  return el(document, 'label', { className: 'field-label' }, [label, control]);
}

function choice(document, name, label, options) {
  const node = el(document, 'select', { className: 'field-input', attrs: { name } },
    options.map(([value, text]) => el(document, 'option', { text, attrs: { value } })));
  return { node, field: field(document, label, node) };
}

// Ruling R7: a full page; resources that fail to save wait on the training page.
export async function renderRecordClass(ctx) {
  const { document, i18n } = ctx;
  const training = ctx.services.training;
  const screen = el(document, 'section', { className: 'screen screen-record' }, [
    pageHeader({ document, title: i18n.t('record.title'), backLabel: i18n.t('app.back'), onBack: () => ctx.back('/me/teaching') }),
  ]);
  let teaching;
  try {
    teaching = await loadTeaching(ctx);
  } catch (error) {
    screen.append(el(document, 'p', { className: 'muted', text: error?.message || i18n.t('app.loadError') }));
    return screen;
  }
  const kinds = [...(teaching.groups.length ? ['group'] : []), ...(teaching.students.length ? ['personal_class'] : [])];
  if (!kinds.length) {
    screen.append(
      el(document, 'p', { className: 'muted', text: i18n.t('schedule.needPeople') }),
      el(document, 'a', { className: 'button-secondary', text: i18n.t('app.groups'), attrs: { href: '#/me/groups' } }),
    );
    return screen;
  }
  let kind = kinds[0];
  let saving = false;
  const idempotencyKey = training.createIdempotencyKey();

  const kindButtons = kinds.map((value) => el(document, 'button', {
    text: i18n.t(value === 'group' ? 'training.group' : 'training.personalClass'),
    attrs: { type: 'button' }, dataset: { kind: value }, on: { click: () => { kind = value; sync(); } },
  }));
  const group = choice(document, 'group', i18n.t('record.group'), teaching.groups.map(({ id, name }) => [id, name]));
  const student = choice(document, 'student', i18n.t('record.student'), teaching.students.map(({ profileId, name }) => [profileId, name]));
  const attendees = el(document, 'fieldset', { className: 'attendance-list' });
  function renderAttendees() {
    const members = (teaching.rosters[group.node.value] ?? []).filter((member) => member.access_level === 'member'
      && (member.membership_state ?? 'active') === 'active' && member.profile_id !== ctx.profile.id);
    attendees.replaceChildren(el(document, 'legend', { text: i18n.t('record.attendees') }), ...members.map((member) => {
      const box = el(document, 'input', { attrs: { type: 'checkbox', name: 'attendee', value: member.profile_id } });
      box.checked = true;
      return el(document, 'label', { className: 'check-row' }, [box, ` ${member.display_name}`]);
    }));
  }
  function sync() {
    for (const button of kindButtons) button.setAttribute('aria-pressed', String(button.dataset.kind === kind));
    group.field.hidden = kind !== 'group';
    attendees.hidden = kind !== 'group';
    student.field.hidden = kind !== 'personal_class';
  }
  group.node.addEventListener('change', renderAttendees);
  renderAttendees();
  sync();

  const date = el(document, 'input', { className: 'field-input', attrs: { type: 'date', name: 'date', max: ctx.today() } });
  date.value = ctx.today();
  const time = el(document, 'input', { className: 'field-input', attrs: { type: 'time', name: 'time', step: '300' } });
  time.value = defaultStartTime({ now: ctx.now(), timezone: ctx.timezone, durationMinutes: 60 });
  const duration = el(document, 'input', { className: 'field-input', attrs: { type: 'number', name: 'duration', min: '1', max: '1440', inputmode: 'numeric' } });
  duration.value = '60';

  const editor = createRoundEditor({ document, i18n, mode: 'record', getTermMappings: ctx.getTermMappings, ratings: false, showAddButton: false });
  const chat = createChatBox({ document, i18n, onSubmit: (text) => {
    const parts = splitRounds(text);
    editor.setRounds([
      ...editor.getRounds().map((round) => ({ sourceText: round.source_text })),
      ...(parts.length ? parts : [text]).map((sourceText) => ({ sourceText })),
    ]);
  } });

  const video = el(document, 'input', { className: 'field-input', attrs: { type: 'url', name: 'videoLink', placeholder: 'https://' } });
  const summary = el(document, 'textarea', { className: 'field-input field-textarea', attrs: { name: 'summary' } });
  const transcript = el(document, 'textarea', { className: 'field-input field-textarea', attrs: { name: 'transcript' } });
  const resources = el(document, 'details', { className: 'record-resources' }, [
    el(document, 'summary', { text: `📎 ${i18n.t('resources.add')}` }),
    field(document, i18n.t('pastClass.videoLink'), video),
    field(document, i18n.t('pastClass.summary'), summary),
    field(document, i18n.t('pastClass.transcript'), transcript),
  ]);
  const status = el(document, 'p', { className: 'log-status', attrs: { role: 'status' } });
  const save = el(document, 'button', { className: 'button-primary log-save', text: i18n.t('record.save'), attrs: { type: 'button' }, dataset: { action: 'save' } });

  save.addEventListener('click', async () => {
    if (saving) return;
    status.textContent = '';
    const rounds = editor.getRounds();
    if (!rounds.length) {
      status.textContent = i18n.t('alone.needRound');
      return;
    }
    const start = startInstant({ localDate: date.value, startTime: time.value, timezone: ctx.timezone, now: ctx.now() });
    if (start.error) {
      status.textContent = i18n.t(start.error);
      return;
    }
    const minutes = Number(duration.value);
    const extras = [['video', video.value, null], ['summary', null, summary.value], ['voice', null, transcript.value]]
      .filter(([, url, body]) => (url ?? body ?? '').trim())
      .map(([resourceKind, url, body]) => ({ kind: resourceKind, title: '', url, body }));
    try {
      extras.forEach((resource) => normalizeResource(resource));
    } catch (problem) {
      status.textContent = problem.message;
      return;
    }
    const checked = [...attendees.querySelectorAll('input[name="attendee"]:checked')]
      .map((box) => ({ profileId: box.value, durationMinutes: minutes }));
    if (kind === 'group' && !checked.length) {
      status.textContent = i18n.t('classPage.nobody');
      return;
    }
    const chosen = teaching.students.find(({ profileId }) => profileId === student.node.value);
    const context = kind === 'group' ? { groupId: group.node.value, connectionId: null } : studentContext(chosen);
    saving = true;
    save.disabled = true;
    save.textContent = i18n.t('pastClass.saving');
    try {
      const result = await training.recordPastClass({
        kind, groupId: context.groupId, connectionId: context.connectionId,
        studentProfileId: kind === 'personal_class' ? chosen.profileId : null,
        occurredAt: start.occurredAt, localDate: date.value, timezone: ctx.timezone, durationMinutes: minutes,
        attendees: kind === 'group' ? checked : [], rounds, idempotencyKey,
      }, ctx.now());
      await saveResourcesOrQueue({ storage: ctx.window.localStorage, service: training, occurrenceId: result.occurrence_id, resources: extras });
      ctx.navigate(`/training/${result.occurrence_id}`);
    } catch (error) {
      status.textContent = error?.message || i18n.t('record.saveError');
    } finally {
      saving = false;
      save.disabled = false;
      save.textContent = i18n.t('record.save');
    }
  });

  screen.append(
    el(document, 'div', { className: 'segmented', attrs: { role: 'group', 'aria-label': i18n.t('record.kind') } }, kindButtons),
    group.field, attendees, student.field,
    el(document, 'div', { className: 'record-when' }, [
      field(document, i18n.t('pastClass.date'), date),
      field(document, i18n.t('log.startTime'), time),
      field(document, i18n.t('pastClass.duration'), duration),
    ]),
    el(document, 'h2', { className: 'section-label', text: i18n.t('trainingPage.rounds') }),
    editor.element, resources, status,
    el(document, 'div', { className: 'log-dock' }, [chat.element, save]),
  );
  return screen;
}
```

- [ ] **Step 6: Implement the + menu and the layout label**

```js
// src/app/screens/plus-menu.js
import { el } from '../shell/page.js';
import { openScheduleSheet } from './schedule-sheet.js';

const ITEMS = {
  log: ['📝', 'plus.log', (ctx) => ctx.navigate('/log')],
  schedule: ['📅', 'plus.schedule', (ctx) => openScheduleSheet(ctx)],
  record: ['🧾', 'plus.record', (ctx) => ctx.navigate('/me/teaching/record')],
};

export function openPlusMenu(ctx, actions) {
  const { document, i18n } = ctx;
  let sheet = null;
  const content = el(document, 'div', { className: 'plus-menu' }, actions.map((action) => {
    const [icon, key, run] = ITEMS[action];
    return el(document, 'button', {
      className: 'card plus-item', text: `${icon} ${i18n.t(key)}`, attrs: { type: 'button' }, dataset: { plus: action },
      on: { click: () => { sheet.close(); run(ctx); } },
    });
  }));
  sheet = ctx.openSheet({ title: i18n.t('app.create'), content });
  return sheet;
}
```

In `src/app/shell/layout.js`, change the signature to `export function createLayout({ document, i18n, onPlus, plusLabel = () => 'app.logTraining' })` and in `refreshCopy()` replace `plusSide.textContent = `+ ${i18n.t('app.logTraining')}`;` with:

```js
    plusSide.textContent = `+ ${i18n.t(plusLabel())}`;
```

- [ ] **Step 7: Wire + and the record page into the entry**

In `src/app/entries/app.js`:

1. Change the access import to `import { modeOf, plusActions, redirectFor } from '../shell/access.js';` and add:

```js
import { openPlusMenu } from '../screens/plus-menu.js';
import { renderRecordClass } from '../screens/record-class.js';
```

2. Replace `const layout = createLayout({ document, i18n, onPlus: () => router.navigate('/log') });` with:

```js
  // Ruling R9: + follows the mode on phones and on the desktop sidebar.
  const layout = createLayout({
    document, i18n,
    onPlus: () => {
      const actions = plusActions(modeOf(profile));
      if (actions.length === 1) router.navigate('/log');
      else openPlusMenu(ctx, actions);
    },
    plusLabel: () => (plusActions(modeOf(profile)).length === 1 ? 'app.logTraining' : 'app.create'),
  });
```

3. In `screenFor`, add before `case 'discover':`:

```js
      case 'teaching-record': return renderRecordClass(ctx, route);
```

Append to `assets/app.css`:

```css
/* + menu and Record a past class */
.plus-menu { display: grid; gap: 8px; margin-top: 10px; }
.plus-item { text-align: left; font-size: 1rem; cursor: pointer; }
.attendance-list { border: 1px solid var(--line); border-radius: 12px; padding: 8px 12px; margin: 0 0 10px; }
.record-when { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.record-resources { margin: 10px 0; }
.record-resources summary { cursor: pointer; padding: 6px 0; }
```

- [ ] **Step 8: Run the unit tests**

Run: `npx vitest run`
Expected: PASS (including the unchanged Log training tests).

- [ ] **Step 9: Write the browser test**

```js
// tests/e2e/app-mode.spec.js
import { expect, test } from '@playwright/test';

import { openCreate, seedAccount } from './app-helpers.js';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
});

test('the mode changes + and Teaching in Me without removing coaching', async ({ page }, testInfo) => {
  await seedAccount(page);
  await page.goto('/app');
  await openCreate(page, testInfo);
  await expect(page).toHaveURL(/#\/log$/);
  await page.goto('/app#/me');
  await expect(page.getByRole('link', { name: /Teaching/ })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Both' }).click();
  await expect(page.getByRole('link', { name: /Teaching/ })).toBeVisible();
  await openCreate(page, testInfo);
  await expect(page.getByRole('dialog').locator('[data-plus]'))
    .toHaveText(['📝 Log my training', '📅 Schedule a class', '🧾 Record a past class']);
  await page.keyboard.press('Escape');
  await page.getByRole('radio', { name: 'Teach' }).click();
  await openCreate(page, testInfo);
  await expect(page.getByRole('dialog').locator('[data-plus]')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.getByRole('radio', { name: 'Train' }).click();
  await expect(page.getByRole('link', { name: /Teaching/ })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('roda.e2e.coachProfile')))).not.toBeNull();
  await page.goto('/app#/me/teaching');
  await expect(page).toHaveURL(/#\/me\/teaching$/);
});

test('a coach records a past class from +', async ({ page }, testInfo) => {
  await page.goto('/app?demo=1');
  await openCreate(page, testInfo);
  await page.getByRole('dialog').getByRole('button', { name: /Record a past class/ }).click();
  await expect(page).toHaveURL(/#\/me\/teaching\/record$/);
  await expect(page.locator('input[name="attendee"]')).toHaveCount(3);
  await page.locator('input[name="attendee"]').nth(2).uncheck();
  const box = page.getByLabel('Write a round');
  await box.fill('ginga 10 min');
  await box.press('Enter');
  await page.getByRole('button', { name: 'Save class' }).click();
  await expect(page).toHaveURL(/#\/training\//);
  await expect(page.locator('.tag', { hasText: 'attended' })).toContainText('2 attended');
});
```

- [ ] **Step 10: Run all suites**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/app/screens/resource-queue.js src/app/screens/record-class.js src/app/screens/plus-menu.js src/app/screens/log.js \
  src/app/shell/layout.js src/app/entries/app.js src/app/dashboard-i18n.js assets/app.css \
  tests/unit/resource-queue.test.js tests/unit/record-class.test.js tests/unit/plus-menu.test.js tests/unit/layout.test.js \
  tests/e2e/app-mode.spec.js
git commit -m "feat: record past classes and make + follow the mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Coach's class page

**Files:**
- Create: `src/app/screens/class.js`, `tests/unit/class-screen.test.js`, `tests/e2e/app-class.spec.js`
- Modify: `src/app/screens/training.js`, `src/app/entries/app.js`, `src/app/dashboard-i18n.js`, `assets/app.css`
- Test: `tests/unit/training-screen.test.js`

**Interfaces:**
- Consumes: `training.getScheduledClass` (Task 2), `training.completeGroupTraining`, `training.completePersonalClass`, `training.cancelScheduledTraining`, `training.createIdempotencyKey`, `roundText` (`src/app/training-plan-state.js`), `kindLabel` (`today-state.js`), `route.query` (Task 3).
- Produces: `renderClass(ctx, route)` at `#/class/<schedule-id>`: title, small text (date, time, "You teach", "plan: …"), tags (`⏱`, `👥 N coming`), the plan's rounds as `.chapter`s, "Who's here" rows (`button[role="checkbox"][data-person]`, all checked), a bar with `button[data-action="cancel"]` and `button[data-action="finish"]`, and an "Edit plan" link to `#/me/teaching/plans/<plan-id>`. Finishing replaces the route with `/training/<occurrence-id>?add=1`.
- Produces: `renderTraining` honors `route.query.add === '1'` once: it strips the query with `history.replaceState` and opens its Add resources sheet when `can_add_resources`.

Ruling R4: only the arranging coach reads the page. Ruling R5: Finish after start, planned duration for everyone checked, a group needs one person, a personal class needs its student. Ruling R6: Add resources opens on the training page.

- [ ] **Step 1: Add i18n keys**

`en`:

```js
    'classPage.unavailable': "This class isn't available.",
    'classPage.editPlan': 'Edit plan',
    'classPage.plan': 'plan: {title}',
    'classPage.planLabel': 'Plan',
    'classPage.coming': '{count} coming',
    'classPage.whosHere': "Who's here · tap to mark",
    'classPage.finish': 'Finish class',
    'classPage.finishing': 'Finishing…',
    'classPage.finishError': "We couldn't finish this class. Your marks are still here.",
    'classPage.cancel': 'Cancel class',
    'classPage.reason': 'Reason (optional)',
    'classPage.confirmCancel': 'Cancel this class',
    'classPage.cancelError': "We couldn't cancel this class.",
    'classPage.notStarted': 'You can finish the class once it starts.',
    'classPage.studentAbsent': "Cancel the class if {name} didn't come.",
    'classPage.finished': 'This class was already finished.',
    'classPage.cancelled': 'This class was cancelled.',
    'classPage.openClass': 'Open the class',
```

`pt`:

```js
    'classPage.unavailable': 'Esta aula não está disponível.',
    'classPage.editPlan': 'Editar plano',
    'classPage.plan': 'plano: {title}',
    'classPage.planLabel': 'Plano',
    'classPage.coming': '{count} vêm',
    'classPage.whosHere': 'Quem está · toca para marcar',
    'classPage.finish': 'Terminar aula',
    'classPage.finishing': 'A terminar…',
    'classPage.finishError': 'Não foi possível terminar esta aula. As marcações continuam aqui.',
    'classPage.cancel': 'Cancelar aula',
    'classPage.reason': 'Motivo (opcional)',
    'classPage.confirmCancel': 'Cancelar esta aula',
    'classPage.cancelError': 'Não foi possível cancelar esta aula.',
    'classPage.notStarted': 'Podes terminar a aula quando ela começar.',
    'classPage.studentAbsent': 'Cancela a aula se {name} não veio.',
    'classPage.finished': 'Esta aula já foi terminada.',
    'classPage.cancelled': 'Esta aula foi cancelada.',
    'classPage.openClass': 'Abrir a aula',
```

- [ ] **Step 2: Write the failing unit tests**

```js
// tests/unit/class-screen.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../src/app/errors.js';
import { renderClass } from '../../src/app/screens/class.js';
import { closeSheet } from '../../src/app/shell/sheet.js';
import { appCtx } from './app-test-context.js';

const base = {
  schedule_id: 's1', kind: 'group', state: 'scheduled', local_date: '2026-10-11', timezone: 'Europe/Lisbon',
  starts_at: '2026-10-11T10:00:00Z', duration_minutes: 60, group_name: 'Grupo Lua', student_name: null,
  plan_id: 'p1', plan_title: 'Armada ladder', instructions: 'Stay loose', occurrence_id: null,
  rounds: [{ source_text: 'ginga 10 min' }, { source_text: '10x (armada, au)' }],
  people: [
    { profile_id: 'bia', display_name: 'Bia Santos' },
    { profile_id: 'caio', display_name: 'Caio Lima' },
    { profile_id: 'duda', display_name: 'Duda Reis' },
  ],
};

async function open(training, data = base) {
  training.getScheduledClass ??= vi.fn().mockResolvedValue(data);
  training.createIdempotencyKey ??= vi.fn(() => 'k1');
  const ctx = appCtx({ services: { training } });
  const view = await renderClass(ctx, { name: 'class', params: { id: data.schedule_id }, query: {} });
  document.body.replaceChildren(view);
  return { ctx, view };
}

describe('class page', () => {
  beforeEach(() => { closeSheet(); });

  it('shows the plan and finishes once for the people marked here', async () => {
    let resolve;
    const training = { completeGroupTraining: vi.fn(() => new Promise((done) => { resolve = done; })) };
    const { ctx, view } = await open(training);
    expect(view.querySelector('h1').textContent).toBe('Group · Grupo Lua');
    expect(view.querySelector('.training-meta').textContent).toContain('You teach · plan: Armada ladder');
    expect([...view.querySelectorAll('.chapter-text')].map((node) => node.textContent)).toEqual(['ginga 10 min', '10x (armada, au)']);
    expect(view.querySelector('a[href="#/me/teaching/plans/p1"]').textContent).toBe('Edit plan');
    expect(view.textContent).toContain('👥 3 coming');
    view.querySelector('[data-person="duda"]').click();
    expect(view.querySelector('[data-person="duda"]').getAttribute('aria-checked')).toBe('false');
    expect(view.textContent).toContain('👥 2 coming');
    view.querySelector('[data-action="finish"]').click();
    view.querySelector('[data-action="finish"]').click();
    resolve({ status: 'completed', occurrence_id: 'o9' });
    await vi.waitFor(() => expect(ctx.replace).toHaveBeenCalledWith('/training/o9?add=1'));
    expect(training.completeGroupTraining).toHaveBeenCalledTimes(1);
    expect(training.completeGroupTraining).toHaveBeenCalledWith({
      scheduleId: 's1', durationMinutes: 60, idempotencyKey: 'k1',
      attendees: [{ profileId: 'bia', durationMinutes: 60 }, { profileId: 'caio', durationMinutes: 60 }],
    });
  });

  it('refuses to finish a group class with nobody marked', async () => {
    const training = { completeGroupTraining: vi.fn() };
    const { view } = await open(training);
    for (const row of view.querySelectorAll('[data-person]')) row.click();
    view.querySelector('[data-action="finish"]').click();
    expect(view.querySelector('.log-status').textContent).toBe('Mark at least one person who came.');
    expect(training.completeGroupTraining).not.toHaveBeenCalled();
  });

  it('waits for the start, and a personal class needs its student', async () => {
    const later = await open({}, { ...base, starts_at: '2026-10-11T19:00:00Z' });
    expect(later.view.querySelector('[data-action="finish"]').disabled).toBe(true);
    expect(later.view.textContent).toContain('You can finish the class once it starts.');
    const personal = { ...base, kind: 'personal_class', group_name: null, student_name: 'Bia Santos', people: [{ profile_id: 'bia', display_name: 'Bia Santos' }] };
    const training = { completePersonalClass: vi.fn().mockResolvedValue({ occurrence_id: 'o2' }) };
    const { ctx, view } = await open(training, personal);
    expect(view.querySelector('h1').textContent).toBe('Personal class · with Bia Santos');
    view.querySelector('[data-person="bia"]').click();
    expect(view.querySelector('[data-action="finish"]').disabled).toBe(true);
    expect(view.textContent).toContain("Cancel the class if Bia Santos didn't come.");
    view.querySelector('[data-person="bia"]').click();
    view.querySelector('[data-action="finish"]').click();
    await vi.waitFor(() => expect(ctx.replace).toHaveBeenCalledWith('/training/o2?add=1'));
    expect(training.completePersonalClass).toHaveBeenCalledWith({ scheduleId: 's1', durationMinutes: 60, idempotencyKey: 'k1' });
  });

  it('shows a finished class with a link, and refuses classes that are not mine', async () => {
    const { view } = await open({}, { ...base, state: 'completed', occurrence_id: 'o3' });
    expect(view.textContent).toContain('This class was already finished.');
    expect(view.querySelector('a[href="#/training/o3"]')).not.toBeNull();
    expect(view.querySelector('[data-action="finish"]')).toBeNull();
    const denied = await open({ getScheduledClass: vi.fn().mockRejectedValue(new AppError('authorization', 'not_authorized')) });
    expect(denied.view.textContent).toContain("This class isn't available.");
  });

  it('switches to the finished state when another device finished first', async () => {
    const getScheduledClass = vi.fn()
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce({ ...base, state: 'completed', occurrence_id: 'o4' });
    const training = {
      getScheduledClass,
      completeGroupTraining: vi.fn().mockRejectedValue(new AppError('validation', 'duplicate_completion')),
    };
    const { view } = await open(training);
    view.querySelector('[data-action="finish"]').click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('This class was already finished.'));
    expect(document.querySelector('a[href="#/training/o4"]')).not.toBeNull();
  });

  it('cancels with a reason', async () => {
    const training = { cancelScheduledTraining: vi.fn().mockResolvedValue({ status: 'cancelled' }) };
    const { ctx, view } = await open(training);
    view.querySelector('[data-action="cancel"]').click();
    const sheet = document.querySelector('[role="dialog"]');
    sheet.querySelector('textarea[name="reason"]').value = 'Rain';
    sheet.querySelector('form').requestSubmit();
    await vi.waitFor(() => expect(ctx.navigate).toHaveBeenCalledWith('/'));
    expect(training.cancelScheduledTraining).toHaveBeenCalledWith('s1', 'Rain');
  });
});
```

Add to `tests/unit/training-screen.test.js` (inside its `describe`):

```js
  it('opens Add resources once when it arrives with ?add=1', async () => {
    const training = { getTraining: vi.fn().mockResolvedValue({ ...base, role: 'coach', participation: null, can_add_resources: true, resources: [] }) };
    const context = { ...ctx(training), window: { history: { replaceState: vi.fn() } } };
    const view = await renderTraining(context, { name: 'training', params: { id: 'o1' }, query: { add: '1' } });
    document.body.replaceChildren(view);
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    expect(document.querySelector('[role="dialog"]').getAttribute('aria-label')).toBe('Add resources');
    expect(context.window.history.replaceState).toHaveBeenCalledWith(null, '', '#/training/o1');
  });
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/unit/class-screen.test.js tests/unit/training-screen.test.js`
Expected: FAIL — `class.js` not found; no sheet opens on `?add=1`.

- [ ] **Step 4: Implement the class page**

```js
// src/app/screens/class.js
import { roundText } from '../training-plan-state.js';
import { el, pageHeader } from '../shell/page.js';
import { kindLabel } from './today-state.js';

function timeOf(ctx, iso, timezone) {
  return new Intl.DateTimeFormat(ctx.i18n.locale() === 'pt' ? 'pt-PT' : 'en-US', {
    hour: '2-digit', minute: '2-digit', timeZone: timezone || ctx.timezone,
  }).format(new Date(iso));
}

function cancelSheet(ctx, data) {
  const { document, i18n } = ctx;
  const reason = el(document, 'textarea', { className: 'field-input field-textarea', attrs: { name: 'reason', maxlength: '500' } });
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  const confirm = el(document, 'button', { className: 'button-danger', text: i18n.t('classPage.confirmCancel'), attrs: { type: 'submit' } });
  const form = el(document, 'form', { className: 'sheet-form' }, [
    el(document, 'label', { className: 'field-label' }, [i18n.t('classPage.reason'), reason]), status, confirm,
  ]);
  const sheet = ctx.openSheet({ title: i18n.t('classPage.cancel'), content: form });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    confirm.disabled = true;
    try {
      await ctx.services.training.cancelScheduledTraining(data.schedule_id, reason.value);
      sheet.close();
      ctx.navigate('/');
    } catch (error) {
      status.textContent = error?.message || i18n.t('classPage.cancelError');
      confirm.disabled = false;
    }
  });
}

export async function renderClass(ctx, route) {
  const { document, i18n } = ctx;
  const training = ctx.services.training;
  const screen = el(document, 'section', { className: 'screen screen-class' });
  const back = () => ctx.back('/');
  let data;
  try {
    data = await training.getScheduledClass(route.params.id);
  } catch (error) {
    const unavailable = error?.kind === 'authorization' || error?.kind === 'validation';
    screen.append(
      pageHeader({ document, title: '', backLabel: i18n.t('app.back'), onBack: back }),
      el(document, 'p', { className: 'muted', text: unavailable ? i18n.t('classPage.unavailable') : (error?.message || i18n.t('app.loadError')) }),
    );
    return screen;
  }
  const editPlan = data.plan_id
    ? [el(document, 'a', { className: 'button-secondary small', text: i18n.t('classPage.editPlan'), attrs: { href: `#/me/teaching/plans/${data.plan_id}` } })]
    : [];
  screen.append(pageHeader({ document, title: '', backLabel: i18n.t('app.back'), onBack: back, actions: editPlan }));
  const second = data.group_name ?? (data.student_name ? i18n.t('trainingPage.with', { name: data.student_name }) : null);
  const meta = [
    i18n.formatDate(`${data.local_date}T12:00:00`, { weekday: 'short', day: 'numeric', month: 'short' }),
    timeOf(ctx, data.starts_at, data.timezone), i18n.t('today.youTeach'),
    data.plan_title ? i18n.t('classPage.plan', { title: data.plan_title }) : null,
  ].filter(Boolean).join(' · ');
  const coming = el(document, 'span', { className: 'tag' });
  screen.append(
    el(document, 'h1', { className: 'training-title', text: [kindLabel(i18n, data.kind), second].filter(Boolean).join(' · ') }),
    el(document, 'p', { className: 'training-meta muted', text: meta }),
    el(document, 'div', { className: 'training-tags' }, [
      el(document, 'span', { className: 'tag', text: `⏱ ${i18n.formatDuration(data.duration_minutes)}` }), coming,
    ]),
  );

  if (data.state !== 'scheduled') {
    coming.remove();
    screen.append(el(document, 'p', { className: 'card muted', text: i18n.t(data.state === 'cancelled' ? 'classPage.cancelled' : 'classPage.finished') }));
    if (data.occurrence_id) {
      screen.append(el(document, 'a', { className: 'button-primary', text: i18n.t('classPage.openClass'), attrs: { href: `#/training/${data.occurrence_id}` } }));
    }
    return screen;
  }

  screen.append(
    el(document, 'h2', { className: 'section-label', text: i18n.t('classPage.planLabel') }),
    el(document, 'ol', { className: 'chapters' }, (data.rounds ?? []).map((round, index) => el(document, 'li', { className: 'chapter' }, [
      el(document, 'span', { className: 'chapter-number', text: String(index + 1) }),
      el(document, 'span', { className: 'chapter-text', text: roundText(round) }),
    ]))),
  );
  if (data.instructions) screen.append(el(document, 'p', { className: 'training-notes', text: data.instructions }));

  const here = new Set(data.people.map(({ profile_id: id }) => id));
  const started = new Date(data.starts_at) <= ctx.now();
  const hint = el(document, 'p', { className: 'muted class-hint' });
  const status = el(document, 'p', { className: 'log-status', attrs: { role: 'status' } });
  const finish = el(document, 'button', { className: 'bar-main', text: i18n.t('classPage.finish'), attrs: { type: 'button' }, dataset: { action: 'finish' } });
  const cancel = el(document, 'button', { text: i18n.t('classPage.cancel'), attrs: { type: 'button' }, dataset: { action: 'cancel' } });
  let busy = false;
  function refresh() {
    coming.textContent = `👥 ${i18n.t('classPage.coming', { count: here.size })}`;
    const studentAbsent = data.kind === 'personal_class' && !here.size;
    finish.disabled = busy || !started || studentAbsent;
    hint.textContent = !started ? i18n.t('classPage.notStarted')
      : studentAbsent ? i18n.t('classPage.studentAbsent', { name: data.student_name ?? '' }) : '';
  }
  const people = el(document, 'div', { className: 'attendance' }, data.people.map((person) => {
    const row = el(document, 'button', {
      className: 'attendance-row', attrs: { type: 'button', role: 'checkbox', 'aria-checked': 'true' }, dataset: { person: person.profile_id },
    }, [
      el(document, 'span', { text: person.display_name ?? '' }),
      el(document, 'span', { className: 'attendance-check', text: '✓', attrs: { 'aria-hidden': 'true' } }),
    ]);
    row.addEventListener('click', () => {
      if (here.has(person.profile_id)) here.delete(person.profile_id);
      else here.add(person.profile_id);
      row.setAttribute('aria-checked', String(here.has(person.profile_id)));
      refresh();
    });
    return row;
  }));
  screen.append(el(document, 'h2', { className: 'section-label', text: i18n.t('classPage.whosHere') }), people, hint, status);

  const idempotencyKey = training.createIdempotencyKey();
  finish.addEventListener('click', async () => {
    if (busy || finish.disabled) return;
    if (data.kind === 'group' && !here.size) {
      status.textContent = i18n.t('classPage.nobody');
      return;
    }
    busy = true;
    refresh();
    finish.textContent = i18n.t('classPage.finishing');
    status.textContent = '';
    try {
      const minutes = data.duration_minutes;
      const result = data.kind === 'group'
        ? await training.completeGroupTraining({
          scheduleId: data.schedule_id, durationMinutes: minutes, idempotencyKey,
          attendees: [...here].map((profileId) => ({ profileId, durationMinutes: minutes })),
        })
        : await training.completePersonalClass({ scheduleId: data.schedule_id, durationMinutes: minutes, idempotencyKey });
      ctx.replace(`/training/${result.occurrence_id}?add=1`);
    } catch (error) {
      if (['duplicate_completion', 'cancelled_training'].includes(error?.code)) {
        screen.replaceWith(await renderClass(ctx, route));
        return;
      }
      status.textContent = error?.code === 'invalid_attendee'
        ? i18n.t('coach.membershipChanged')
        : (error?.message || i18n.t('classPage.finishError'));
      busy = false;
      finish.textContent = i18n.t('classPage.finish');
      refresh();
    }
  });
  cancel.addEventListener('click', () => cancelSheet(ctx, data));
  refresh();
  screen.append(el(document, 'div', { className: 'training-bar' }, [cancel, finish]));
  return screen;
}
```

- [ ] **Step 5: Open Add resources after finishing**

In `src/app/screens/training.js`:

1. At the start of `renderTraining`, add:

```js
  // Ruling R6: `?add=1` (set after Finish class) opens Add resources once.
  const wantsAdd = route.query?.add === '1';
  const plainRoute = { ...route, query: {} };
```

2. Change `const reload = async () => screen.replaceWith(await renderTraining(ctx, route));` to `const reload = async () => screen.replaceWith(await renderTraining(ctx, plainRoute));`.
3. Directly before the final `return screen;`, add:

```js
  if (wantsAdd && training.can_add_resources) {
    ctx.window?.history?.replaceState?.(null, '', `#/training/${training.occurrence_id}`);
    setTimeout(() => {
      if (screen.isConnected) screen.querySelector('[data-action="add"]')?.click();
    }, 0);
  }
```

- [ ] **Step 6: Route `#/class/<id>` to the page**

In `src/app/entries/app.js`, add `import { renderClass } from '../screens/class.js';` and, in `screenFor`, before `case 'discover':`:

```js
      case 'class': return renderClass(ctx, route);
```

Append to `assets/app.css`:

```css
/* Coach's class page */
.attendance { display: grid; }
.attendance-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 4px; border: 0; border-bottom: 1px solid var(--line); background: transparent; text-align: left; cursor: pointer; font-size: 1rem; }
.attendance-check { width: 24px; height: 24px; border-radius: 6px; border: 1.5px solid var(--line); display: grid; place-items: center; color: transparent; }
.attendance-row[aria-checked="true"] .attendance-check { background: var(--green); border-color: var(--green); color: var(--bg); }
.class-hint:empty { display: none; }
.training-bar button:disabled { opacity: .45; cursor: default; }
.button-secondary.small, .button-primary.small { padding: 6px 12px; font-size: .85rem; }
```

- [ ] **Step 7: Run the unit tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Write the browser test**

```js
// tests/e2e/app-class.spec.js
import { expect, test } from '@playwright/test';

test('a coach finishes a class from Today with tap-to-mark attendance', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-26T19:30:00Z'));
  await page.goto('/app?demo=1');
  await page.locator('.now-card').getByRole('button', { name: 'Finish class' }).click();
  await expect(page).toHaveURL(/#\/class\/demo-schedule$/);
  await expect(page.locator('.chapter')).toHaveCount(1);
  await expect(page.locator('.chapter')).toContainText('8x Armada');
  await expect(page.getByRole('checkbox')).toHaveCount(3);
  await page.getByRole('checkbox', { name: /Duda Reis/ }).click();
  await expect(page.getByText('👥 2 coming')).toBeVisible();
  await page.getByRole('button', { name: 'Finish class' }).click();
  await expect(page).toHaveURL(/#\/training\/[^?]+$/);
  await expect(page.getByRole('dialog', { name: 'Add resources' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.tag', { hasText: 'attended' })).toContainText('2 attended');
});

test('a class someone else arranged is not available', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
  await page.goto('/app?demo=1#/class/not-mine');
  await expect(page.getByText("This class isn't available.")).toBeVisible();
});
```

- [ ] **Step 9: Run all suites**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/app/screens/class.js src/app/screens/training.js src/app/entries/app.js src/app/dashboard-i18n.js assets/app.css \
  tests/unit/class-screen.test.js tests/unit/training-screen.test.js tests/e2e/app-class.spec.js
git commit -m "feat: add the coach's class page with tap-to-mark attendance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Teaching home and the plan page

**Files:**
- Create: `src/app/screens/teaching.js`, `src/app/screens/plan.js`, `tests/unit/teaching-screen.test.js`, `tests/unit/plan-screen.test.js`, `tests/e2e/app-teaching.spec.js`
- Modify: `src/app/entries/app.js`, `src/app/dashboard-i18n.js`, `assets/app.css`

**Interfaces:**
- Consumes: `loadTeaching` (Task 7), `openScheduleSheet` (Task 7), `training.listMyCalendar` (Task 2), `training.listPlans`, `createPlan`, `savePlanDraft`, `publishPlan`, `createPlanDraft`, `serializePlanDraft`, `roundText` (`src/app/training-plan-state.js`), `createRoundEditor`.
- Produces: `renderTeaching(ctx)` at `#/me/teaching` — `button[data-action="schedule"]`, a link to `#/me/teaching/record`, a `p.form-status[role="status"]` under the actions, upcoming classes I teach for the next 60 days (`a[href="#/class/<id>"]`), plans (`a[href="#/me/teaching/plans/<plan-id>"]` plus "New plan" → `#/me/teaching/plans/new`), students (`a[href="#/me/teaching/students/<profile-id>"]`).
- Produces: `renderPlan(ctx, route)` at `#/me/teaching/plans/<plan-id|new>` — editable drafts (`input[name="title"]`, `textarea[name="description"]`, `input[name="duration"]`, `textarea[name="instructions"]`, the round editor, `button[data-action="save-plan"]`, `button[data-action="publish-plan"]`), read-only published plans with `button[data-action="schedule-plan"]`. Saving a new plan replaces the route with its id; Publish saves first.

- [ ] **Step 1: Add i18n keys**

`en`:

```js
    'teaching.upcoming': 'Upcoming classes',
    'teaching.noUpcoming': 'No classes scheduled in the next 60 days.',
    'teaching.plans': 'Plans',
    'teaching.students': 'Students',
    'plan.unavailable': "This plan isn't available.",
    'plan.saved': 'Plan saved.',
    'plan.needRound': 'Add at least one round.',
    'plan.schedule': 'Schedule this plan',
```

`pt`:

```js
    'teaching.upcoming': 'Próximas aulas',
    'teaching.noUpcoming': 'Sem aulas agendadas nos próximos 60 dias.',
    'teaching.plans': 'Planos',
    'teaching.students': 'Alunos',
    'plan.unavailable': 'Este plano não está disponível.',
    'plan.saved': 'Plano guardado.',
    'plan.needRound': 'Acrescenta pelo menos uma ronda.',
    'plan.schedule': 'Agendar este plano',
```

- [ ] **Step 2: Write the failing unit tests**

```js
// tests/unit/teaching-screen.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderTeaching } from '../../src/app/screens/teaching.js';
import { closeSheet } from '../../src/app/shell/sheet.js';
import { appCtx } from './app-test-context.js';

function teachingServices(extra = {}) {
  return {
    training: {
      listPlans: vi.fn().mockResolvedValue([
        { plan_id: 'p1', version_id: 'v1', title: 'Armada ladder', state: 'published', expected_duration_minutes: 60 },
        { plan_id: 'p2', version_id: 'v2', title: 'Ginga drills', state: 'draft', expected_duration_minutes: 45 },
      ]),
      listMyCalendar: vi.fn().mockResolvedValue([
        { item_id: 's1', item_type: 'scheduled', role: 'coach', kind: 'group', group_name: 'Grupo Lua', starts_at: '2026-10-14T18:00:00Z', local_date: '2026-10-14', plan_title: 'Armada ladder' },
        { item_id: 's2', item_type: 'scheduled', role: 'participant', kind: 'group', group_name: 'Other', starts_at: '2026-10-15T18:00:00Z', local_date: '2026-10-15' },
        { item_id: 'o1', item_type: 'completed', role: 'coach', kind: 'group', starts_at: '2026-10-11T08:00:00Z', local_date: '2026-10-11' },
      ]),
    },
    connection: {
      listMine: vi.fn().mockResolvedValue([{
        connection_id: 'c1', connection_kind: 'direct', state: 'active', coach_profile_id: 'me', student_profile_id: 'bia', student_display_name: 'Bia Santos',
      }]),
    },
    group: { listMyMemberships: vi.fn().mockResolvedValue([]), listRoster: vi.fn() },
    ...extra,
  };
}

describe('teaching screen', () => {
  beforeEach(() => { closeSheet(); document.body.replaceChildren(); });

  it('lists the classes I teach next, my plans, and my students', async () => {
    const services = teachingServices();
    const view = await renderTeaching(appCtx({ services }));
    document.body.replaceChildren(view);
    expect(services.training.listMyCalendar).toHaveBeenCalledWith({ start: '2026-10-11', endExclusive: '2026-12-10' });
    expect([...view.querySelectorAll('a[href^="#/class/"]')].map((link) => link.getAttribute('href'))).toEqual(['#/class/s1']);
    expect([...view.querySelectorAll('a[href^="#/me/teaching/plans/"]')].map((link) => link.getAttribute('href')))
      .toEqual(['#/me/teaching/plans/new', '#/me/teaching/plans/p1', '#/me/teaching/plans/p2']);
    expect(view.querySelector('a[href="#/me/teaching/plans/p2"]').textContent).toContain('Draft');
    expect(view.querySelector('a[href="#/me/teaching/students/bia"]').textContent).toContain('Bia Santos');
    expect(view.querySelector('a[href="#/me/teaching/record"]')).not.toBeNull();
    view.querySelector('[data-action="schedule"]').click();
    await vi.waitFor(() => expect(document.querySelector('form.sheet-form')).not.toBeNull());
  });

  it('shows the reason when Teaching cannot load', async () => {
    const services = teachingServices();
    services.training.listPlans.mockRejectedValue(new Error('offline'));
    const view = await renderTeaching(appCtx({ services }));
    expect(view.textContent).toContain('offline');
  });
});
```

```js
// tests/unit/plan-screen.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderPlan } from '../../src/app/screens/plan.js';
import { closeSheet } from '../../src/app/shell/sheet.js';
import { appCtx } from './app-test-context.js';

const draft = {
  plan_id: 'p2', version_id: 'v2', title: 'Ginga drills', state: 'draft', expected_duration_minutes: 45,
  description: null, instructions: null, updated_at: 't0', source_group_id: null, rounds: [{ source_text: 'ginga 10 min' }],
};

function typeRound(view, text) {
  const round = view.querySelector('textarea[data-round-text]');
  round.value = text;
  round.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('plan page', () => {
  beforeEach(() => { closeSheet(); document.body.replaceChildren(); });

  it('creates a draft and moves to its page', async () => {
    const training = { listPlans: vi.fn(), createPlan: vi.fn().mockResolvedValue({ status: 'created', plan_id: 'p9', version_id: 'v9', updated_at: 't1' }) };
    const ctx = appCtx({ services: { training, repertoire: { list: vi.fn().mockResolvedValue([]) } } });
    const view = await renderPlan(ctx, { name: 'teaching-plan', params: { id: 'new' }, query: {} });
    document.body.replaceChildren(view);
    expect(training.listPlans).not.toHaveBeenCalled();
    expect(view.querySelector('[data-action="publish-plan"]').hidden).toBe(true);
    view.querySelector('[data-action="save-plan"]').click();
    await vi.waitFor(() => expect(view.querySelector('[role="status"]').textContent).toBe('Add at least one round.'));
    view.querySelector('input[name="title"]').value = 'Armada ladder';
    typeRound(view, 'ginga 10 min');
    view.querySelector('[data-action="save-plan"]').click();
    await vi.waitFor(() => expect(ctx.replace).toHaveBeenCalledWith('/me/teaching/plans/p9'));
    expect(training.createPlan).toHaveBeenCalledWith({
      title: 'Armada ladder', description: null, durationMinutes: 60, instructions: null,
      rounds: [expect.objectContaining({ source_text: 'ginga 10 min' })], groupId: null,
    });
  });

  it('saves before publishing and then shows the plan read-only', async () => {
    const training = {
      listPlans: vi.fn().mockResolvedValueOnce([draft]).mockResolvedValue([{ ...draft, title: 'Ginga drills 2', state: 'published' }]),
      savePlanDraft: vi.fn().mockResolvedValue({ status: 'saved', plan_id: 'p2', version_id: 'v2', updated_at: 't1' }),
      publishPlan: vi.fn().mockResolvedValue({ status: 'published' }),
    };
    const ctx = appCtx({ services: { training } });
    const view = await renderPlan(ctx, { name: 'teaching-plan', params: { id: 'p2' }, query: {} });
    document.body.replaceChildren(view);
    expect(view.querySelector('input[name="title"]').value).toBe('Ginga drills');
    view.querySelector('input[name="title"]').value = 'Ginga drills 2';
    view.querySelector('[data-action="publish-plan"]').click();
    await vi.waitFor(() => expect(document.querySelector('[data-action="schedule-plan"]')).not.toBeNull());
    expect(training.savePlanDraft).toHaveBeenCalledWith(expect.objectContaining({ planId: 'p2', expectedUpdatedAt: 't0', title: 'Ginga drills 2' }));
    expect(training.publishPlan).toHaveBeenCalledWith('p2');
    expect(document.querySelector('input[name="title"]')).toBeNull();
    expect(document.querySelector('h1').textContent).toBe('Ginga drills 2');
    expect(document.querySelector('.chapter-text').textContent).toBe('ginga 10 min');
  });

  it('explains a plan that is not mine', async () => {
    const ctx = appCtx({ services: { training: { listPlans: vi.fn().mockResolvedValue([]) } } });
    const view = await renderPlan(ctx, { name: 'teaching-plan', params: { id: 'nope' }, query: {} });
    expect(view.textContent).toContain("This plan isn't available.");
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/unit/teaching-screen.test.js tests/unit/plan-screen.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement Teaching**

```js
// src/app/screens/teaching.js
import { el, pageHeader } from '../shell/page.js';
import { openScheduleSheet } from './schedule-sheet.js';
import { loadTeaching } from './teaching-state.js';
import { kindLabel } from './today-state.js';

function addDaysIso(iso, amount) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function row(document, { href, title, meta = null }) {
  return el(document, 'a', { className: 'card list-row', attrs: { href } }, [
    el(document, 'div', {}, [el(document, 'strong', { text: title }), meta ? el(document, 'div', { className: 'muted', text: meta }) : null]),
    el(document, 'span', { className: 'muted', text: '›', attrs: { 'aria-hidden': 'true' } }),
  ]);
}

function listOrEmpty(document, rows, emptyText) {
  return rows.length
    ? el(document, 'div', { className: 'day-items' }, rows)
    : el(document, 'p', { className: 'muted', text: emptyText });
}

export async function renderTeaching(ctx) {
  const { document, i18n } = ctx;
  const screen = el(document, 'section', { className: 'screen screen-teaching' }, [
    pageHeader({ document, title: i18n.t('app.teaching'), backLabel: i18n.t('app.back'), onBack: () => ctx.back('/me') }),
  ]);
  let teaching;
  let calendar;
  try {
    const todayIso = ctx.today();
    [teaching, calendar] = await Promise.all([
      loadTeaching(ctx),
      ctx.services.training.listMyCalendar({ start: todayIso, endExclusive: addDaysIso(todayIso, 60) }),
    ]);
  } catch (error) {
    screen.append(el(document, 'p', { className: 'muted', text: error?.message || i18n.t('app.loadError') }));
    return screen;
  }
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });

  screen.append(el(document, 'div', { className: 'chip-row' }, [
    el(document, 'button', {
      className: 'button-primary', text: `📅 ${i18n.t('plus.schedule')}`, attrs: { type: 'button' }, dataset: { action: 'schedule' },
      on: { click: () => openScheduleSheet(ctx, { teaching }) },
    }),
    el(document, 'a', { className: 'button-secondary', text: `🧾 ${i18n.t('plus.record')}`, attrs: { href: '#/me/teaching/record' } }),
  ]), status);

  const classes = calendar.filter((item) => item.item_type === 'scheduled' && item.role === 'coach');
  screen.append(
    el(document, 'h2', { className: 'section-label', text: i18n.t('teaching.upcoming') }),
    listOrEmpty(document, classes.map((item) => row(document, {
      href: `#/class/${item.item_id}`,
      title: [kindLabel(i18n, item.kind), item.group_name].filter(Boolean).join(' · '),
      meta: [i18n.formatDate(item.starts_at, {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: ctx.timezone,
      }), item.plan_title].filter(Boolean).join(' · '),
    })), i18n.t('teaching.noUpcoming')),
  );

  screen.append(
    el(document, 'div', { className: 'section-head' }, [
      el(document, 'h2', { className: 'section-label', text: i18n.t('teaching.plans') }),
      el(document, 'a', { className: 'button-secondary small', text: `+ ${i18n.t('teaching.newPlan')}`, attrs: { href: '#/me/teaching/plans/new' } }),
    ]),
    listOrEmpty(document, teaching.plans.map((plan) => row(document, {
      href: `#/me/teaching/plans/${plan.plan_id}`,
      title: plan.title,
      meta: `${i18n.formatDuration(plan.expected_duration_minutes)} · ${i18n.t(plan.state === 'published' ? 'coach.published' : 'coach.draft')}`,
    })), i18n.t('coach.noPlans')),
  );

  screen.append(
    el(document, 'h2', { className: 'section-label', text: i18n.t('teaching.students') }),
    listOrEmpty(document, teaching.students.map((student) => row(document, {
      href: `#/me/teaching/students/${student.profileId}`, title: student.name,
    })), i18n.t('coach.noStudents')),
  );
  return screen;
}
```

- [ ] **Step 5: Implement the plan page**

```js
// src/app/screens/plan.js
import { createPlanDraft, roundText, serializePlanDraft } from '../training-plan-state.js';
import { el, pageHeader } from '../shell/page.js';
import { createRoundEditor } from '../ui/round-editor.js';
import { openScheduleSheet } from './schedule-sheet.js';

function draftFrom(plan) {
  return createPlanDraft({
    id: plan.plan_id, versionId: plan.version_id, expectedUpdatedAt: plan.updated_at, title: plan.title,
    description: plan.description, groupId: plan.source_group_id, durationMinutes: plan.expected_duration_minutes,
    instructions: plan.instructions, published: plan.state === 'published', rounds: plan.rounds ?? [],
  });
}

function field(document, label, control) {
  return el(document, 'label', { className: 'field-label' }, [label, control]);
}

function readOnly(ctx, screen, header, draft) {
  const { document, i18n } = ctx;
  screen.append(...[
    header(draft.title),
    el(document, 'p', { className: 'muted', text: `${i18n.formatDuration(draft.durationMinutes)} · ${i18n.t('coach.published')}` }),
    draft.description ? el(document, 'p', { text: draft.description }) : null,
    draft.instructions ? el(document, 'p', { className: 'training-notes', text: draft.instructions }) : null,
    el(document, 'h2', { className: 'section-label', text: i18n.t('trainingPage.rounds') }),
    el(document, 'ol', { className: 'chapters' }, draft.rounds.map((round, index) => el(document, 'li', { className: 'chapter' }, [
      el(document, 'span', { className: 'chapter-number', text: String(index + 1) }),
      el(document, 'span', { className: 'chapter-text', text: roundText(round) }),
    ]))),
    el(document, 'button', {
      className: 'button-primary', text: `📅 ${i18n.t('plan.schedule')}`, attrs: { type: 'button' }, dataset: { action: 'schedule-plan' },
      on: { click: () => openScheduleSheet(ctx, { planVersionId: draft.versionId }) },
    }),
  ].filter(Boolean));
  return screen;
}

function editable(ctx, screen, header, initial, route) {
  const { document, i18n } = ctx;
  const training = ctx.services.training;
  let draft = initial;
  const title = el(document, 'input', { className: 'field-input', attrs: { name: 'title', maxlength: '120' } });
  title.value = draft.title;
  const description = el(document, 'textarea', { className: 'field-input field-textarea', attrs: { name: 'description' } });
  description.value = draft.description;
  const duration = el(document, 'input', { className: 'field-input', attrs: { type: 'number', name: 'duration', min: '1', max: '1440', inputmode: 'numeric' } });
  duration.value = String(draft.durationMinutes);
  const instructions = el(document, 'textarea', { className: 'field-input field-textarea', attrs: { name: 'instructions' } });
  instructions.value = draft.instructions;
  const editor = createRoundEditor({ document, i18n, mode: 'plan', getTermMappings: ctx.getTermMappings, repertoire: ctx.services.repertoire ?? null });
  editor.setRounds(draft.rounds.length ? draft.rounds : [{ sourceText: '' }]);
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  const save = el(document, 'button', { className: 'button-primary', text: i18n.t('coach.saveDraft'), attrs: { type: 'button' }, dataset: { action: 'save-plan' } });
  const publish = el(document, 'button', { className: 'button-secondary', text: i18n.t('coach.publishPlan'), attrs: { type: 'button' }, dataset: { action: 'publish-plan' } });
  publish.hidden = !draft.id;
  let busy = false;

  async function persist() {
    const rounds = editor.getRounds();
    if (!rounds.length) {
      status.textContent = i18n.t('plan.needRound');
      return false;
    }
    const values = { ...draft, title: title.value, description: description.value, durationMinutes: duration.value, instructions: instructions.value };
    const serialized = { ...serializePlanDraft(values, rounds), groupId: draft.groupId };
    const result = draft.id
      ? await training.savePlanDraft({ ...serialized, planId: draft.id, expectedUpdatedAt: draft.expectedUpdatedAt })
      : await training.createPlan(serialized);
    draft = {
      ...values,
      rounds: rounds.map((round) => ({ sourceText: round.source_text, ratings: round.ratings })),
      id: result.plan_id ?? draft.id,
      versionId: result.version_id ?? draft.versionId,
      expectedUpdatedAt: result.updated_at ?? draft.expectedUpdatedAt,
    };
    return true;
  }

  async function run(action) {
    if (busy) return;
    busy = true;
    save.disabled = true;
    publish.disabled = true;
    status.textContent = '';
    try {
      await action();
    } catch (error) {
      status.textContent = error?.message || i18n.t('coach.planSaveError');
    } finally {
      busy = false;
      save.disabled = false;
      publish.disabled = false;
    }
  }

  save.addEventListener('click', () => run(async () => {
    const wasNew = !draft.id;
    if (!(await persist())) return;
    status.textContent = i18n.t('plan.saved');
    publish.hidden = false;
    if (wasNew) ctx.replace(`/me/teaching/plans/${draft.id}`);
  }));
  publish.addEventListener('click', () => run(async () => {
    if (!(await persist())) return;
    await training.publishPlan(draft.id);
    screen.replaceWith(await renderPlan(ctx, { ...route, params: { id: draft.id } }));
  }));

  screen.append(
    header(i18n.t(draft.id ? 'coach.editPlan' : 'teaching.newPlan')),
    field(document, i18n.t('coach.planTitle'), title),
    field(document, i18n.t('coach.description'), description),
    field(document, i18n.t('coach.expectedDuration'), duration),
    field(document, i18n.t('coach.instructions'), instructions),
    el(document, 'h2', { className: 'section-label', text: i18n.t('trainingPage.rounds') }),
    editor.element, status,
    el(document, 'div', { className: 'chip-row' }, [save, publish]),
  );
  return screen;
}

export async function renderPlan(ctx, route) {
  const { document, i18n } = ctx;
  const screen = el(document, 'section', { className: 'screen screen-plan' });
  const header = (title) => pageHeader({ document, title, backLabel: i18n.t('app.back'), onBack: () => ctx.back('/me/teaching') });
  if (route.params.id === 'new') return editable(ctx, screen, header, createPlanDraft({ durationMinutes: 60 }), route);
  let plan;
  try {
    plan = (await ctx.services.training.listPlans(null)).find(({ plan_id: id }) => id === route.params.id);
  } catch (error) {
    screen.append(header(''), el(document, 'p', { className: 'muted', text: error?.message || i18n.t('app.loadError') }));
    return screen;
  }
  if (!plan) {
    screen.append(header(''), el(document, 'p', { className: 'muted', text: i18n.t('plan.unavailable') }));
    return screen;
  }
  const draft = draftFrom(plan);
  return draft.published ? readOnly(ctx, screen, header, draft) : editable(ctx, screen, header, draft, route);
}
```

- [ ] **Step 6: Route Teaching and plans**

In `src/app/entries/app.js`, add:

```js
import { renderPlan } from '../screens/plan.js';
import { renderTeaching } from '../screens/teaching.js';
```

In `meSection`, after the Settings branch, add:

```js
    if (section === 'teaching') return renderTeaching(ctx, route);
```

In `screenFor`, before `case 'discover':`, add:

```js
      case 'teaching-plan': return renderPlan(ctx, route);
```

Append to `assets/app.css`:

```css
/* Teaching */
.list-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; text-decoration: none; }
.section-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.row-actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
```

- [ ] **Step 7: Run the unit tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Write the browser test**

```js
// tests/e2e/app-teaching.spec.js
import { expect, test } from '@playwright/test';

test('a coach writes and publishes a plan, then schedules it', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
  await page.goto('/app?demo=1#/me/teaching');
  await expect(page.locator('a[href="#/class/demo-schedule"]')).toBeVisible();
  await expect(page.getByRole('link', { name: /Ginga and counter-flow/ })).toBeVisible();
  await page.getByRole('link', { name: /New plan/ }).click();
  await page.getByLabel('Plan title').fill('Armada ladder');
  await page.locator('textarea[data-round-text]').first().fill('10x (armada, au)');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL(/#\/me\/teaching\/plans\/plan-\d+$/);
  await page.getByRole('button', { name: 'Publish plan' }).click();
  await page.getByRole('button', { name: /Schedule this plan/ }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Date').fill('2026-10-24');
  await sheet.getByLabel('Start time').fill('19:00');
  await sheet.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(page).toHaveURL(/#\/class\/schedule-\d+$/);
  await expect(page.locator('h1.training-title')).toHaveText('Group · Roda da Lua');
});
```

- [ ] **Step 9: Run all suites**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/app/screens/teaching.js src/app/screens/plan.js src/app/entries/app.js src/app/dashboard-i18n.js assets/app.css \
  tests/unit/teaching-screen.test.js tests/unit/plan-screen.test.js tests/e2e/app-teaching.spec.js
git commit -m "feat: add Teaching with upcoming classes, plans, and students

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Students, feedback, and coaching requests

**Files:**
- Create: `src/app/screens/confirm-button.js`, `src/app/screens/people-search.js`, `src/app/screens/student.js`, `tests/unit/people-search.test.js`, `tests/unit/student-screen.test.js`
- Modify: `src/app/screens/teaching.js`, `src/app/entries/app.js`, `src/app/dashboard-i18n.js`, `assets/app.css`
- Test: `tests/unit/teaching-screen.test.js`, `tests/e2e/app-teaching.spec.js`

**Interfaces:**
- Consumes: `loadTeaching`, `pendingStudentRequests` (Task 7), `openScheduleSheet` (Task 7), `training.listCalendar({ start, endExclusive, profileId })`, `training.getDay({ localDate, profileId })`, `training.addFeedback({ participationId, groupId, connectionId, body })`, `connection.searchCandidates(text, role)`, `connection.request(coachId, studentId)`, `connection.decide(id, decision)`, `connection.end(id)`, `roundText`, `kindLabel`.
- Produces: `confirmButton(document, { text, confirmText, className?, label?, dataset?, onConfirm }) → HTMLButtonElement` — the first tap arms it (text becomes `confirmText`), the second runs `onConfirm`. Tasks 13–15 reuse it.
- Produces: `openPeopleSearch(ctx, { role: 'coach'|'student', onRequested? })` — a sheet with `input[type="search"]` (debounced 250 ms), result rows with `button[data-candidate="<profile-id>"]`; a coach search requests `request(candidate, me)`, a student search `request(me, candidate)`. Task 13 reuses it.
- Produces: `renderStudent(ctx, route)` at `#/me/teaching/students/<profile-id>` — history of the last 365 days (`button[data-occurrence]`), a day sheet with rounds, feedback (`.feedback`), and `form[data-feedback]`; `button[data-action="schedule"]` (sheet preselects the student); `button[data-action="end-coaching"]` for direct connections.
- Produces: Teaching lists student requests (`[data-request="<connection-id>"]` with `button[data-decision="accepted"|"declined"]`) and a `button[data-action="find-student"]`.

Ruling R12: coaches write feedback from the student page. Ruling R17: the coach side of coaching connections lives in Teaching.

- [ ] **Step 1: Add i18n keys**

`en`:

```js
    'student.unavailable': "This student isn't available.",
    'student.history': 'Training in the last year',
    'student.dayEmpty': 'Nothing recorded on this day.',
    'student.end': 'End coaching',
    'student.confirmEnd': 'Tap again to end coaching',
    'teaching.wantsCoaching': '{name} asked you to coach them',
    'teaching.accept': 'Accept',
    'teaching.decline': 'Decline',
    'peopleSearch.request': 'Request',
    'groupPage.actionError': "That didn't work. Please try again.",
```

`pt`:

```js
    'student.unavailable': 'Este aluno não está disponível.',
    'student.history': 'Treinos no último ano',
    'student.dayEmpty': 'Nada registado neste dia.',
    'student.end': 'Terminar acompanhamento',
    'student.confirmEnd': 'Toca outra vez para terminar',
    'teaching.wantsCoaching': '{name} pediu-te para ser treinador',
    'teaching.accept': 'Aceitar',
    'teaching.decline': 'Recusar',
    'peopleSearch.request': 'Pedir',
    'groupPage.actionError': 'Não resultou. Tenta novamente.',
```

- [ ] **Step 2: Write the failing unit tests**

```js
// tests/unit/people-search.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openPeopleSearch } from '../../src/app/screens/people-search.js';
import { closeSheet } from '../../src/app/shell/sheet.js';
import { appCtx } from './app-test-context.js';

describe('people search', () => {
  beforeEach(() => { closeSheet(); document.body.replaceChildren(); });

  it('searches coaches as I type and asks one to coach me', async () => {
    const connection = {
      searchCandidates: vi.fn(async (text) => (text ? [] : [{ profile_id: 'lua', display_name: 'Professora Lua' }])),
      request: vi.fn().mockResolvedValue({ status: 'pending' }),
    };
    const onRequested = vi.fn();
    openPeopleSearch(appCtx({ services: { connection } }), { role: 'coach', onRequested });
    await vi.waitFor(() => expect(document.querySelector('[data-candidate="lua"]')).not.toBeNull());
    expect(document.querySelector('[role="dialog"]').getAttribute('aria-label')).toBe('Find a coach');
    document.querySelector('[data-candidate="lua"]').click();
    await vi.waitFor(() => expect(connection.request).toHaveBeenCalledWith('lua', 'me'));
    expect(onRequested).toHaveBeenCalledWith(expect.objectContaining({ profile_id: 'lua' }));
    expect(document.querySelector('[role="dialog"] [role="status"]').textContent).toBe('Request sent to Professora Lua.');
    const input = document.querySelector('input[type="search"]');
    input.value = 'zz';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]').textContent).toContain('No matching people found.'));
    expect(connection.searchCandidates).toHaveBeenLastCalledWith('zz', 'coach');
  });
});
```

```js
// tests/unit/student-screen.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderStudent } from '../../src/app/screens/student.js';
import { closeSheet } from '../../src/app/shell/sheet.js';
import { appCtx } from './app-test-context.js';

function services(connections) {
  return {
    training: {
      listPlans: vi.fn().mockResolvedValue([{ plan_id: 'p1', version_id: 'v1', title: 'Armada ladder', state: 'published' }]),
      listCalendar: vi.fn().mockResolvedValue([
        { item_id: 'o1', item_type: 'completed', kind: 'alone', local_date: '2026-10-09', starts_at: '2026-10-09T07:00:00Z', duration_minutes: 45 },
        { item_id: 's9', item_type: 'scheduled', kind: 'personal_class', local_date: '2026-10-20', starts_at: '2026-10-20T18:00:00Z', duration_minutes: 60 },
      ]),
      getDay: vi.fn().mockResolvedValue([{
        id: 'o1', occurrence_id: 'o1', kind: 'alone', duration_minutes: 45, participation_id: 'pp1',
        rounds: [{ source_text: 'ginga 10 min' }], feedback: [],
        feedback_contexts: [{ kind: 'connection', id: 'c1', label: 'Direct coaching' }],
      }]),
      addFeedback: vi.fn().mockResolvedValue({ status: 'saved' }),
    },
    connection: {
      listMine: vi.fn().mockResolvedValue(connections ?? [{
        connection_id: 'c1', connection_kind: 'direct', state: 'active', coach_profile_id: 'me', student_profile_id: 'bia', student_display_name: 'Bia Santos',
      }]),
      end: vi.fn().mockResolvedValue({ status: 'ended' }),
    },
    group: { listMyMemberships: vi.fn().mockResolvedValue([]), listRoster: vi.fn() },
  };
}

const route = { name: 'teaching-student', params: { id: 'bia' }, query: {} };

describe('student page', () => {
  beforeEach(() => { closeSheet(); document.body.replaceChildren(); });

  it('shows the last year of training and saves feedback on a day', async () => {
    const s = services();
    const view = await renderStudent(appCtx({ services: s }), route);
    document.body.replaceChildren(view);
    expect(view.querySelector('h1').textContent).toBe('Bia Santos');
    expect(s.training.listCalendar).toHaveBeenCalledWith({ start: '2025-10-11', endExclusive: '2026-10-12', profileId: 'bia' });
    const items = view.querySelectorAll('[data-occurrence]');
    expect(items).toHaveLength(1);
    items[0].click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"] form[data-feedback]')).not.toBeNull());
    const sheet = document.querySelector('[role="dialog"]');
    expect(s.training.getDay).toHaveBeenCalledWith({ localDate: '2026-10-09', profileId: 'bia' });
    expect(sheet.textContent).toContain('ginga 10 min');
    sheet.querySelector('textarea[name="body"]').value = 'Loose shoulders.';
    sheet.querySelector('form[data-feedback]').requestSubmit();
    await vi.waitFor(() => expect(sheet.querySelector('[role="status"]').textContent).toBe('Feedback saved.'));
    expect(s.training.addFeedback).toHaveBeenCalledWith({ participationId: 'pp1', groupId: null, connectionId: 'c1', body: 'Loose shoulders.' });
    expect(sheet.querySelector('.feedback').textContent).toContain('Loose shoulders.');
  });

  it('schedules for this student and ends coaching after a second tap', async () => {
    const s = services();
    const ctx = appCtx({ services: s });
    const view = await renderStudent(ctx, route);
    document.body.replaceChildren(view);
    view.querySelector('[data-action="schedule"]').click();
    await vi.waitFor(() => expect(document.querySelector('select[name="who"]')?.value).toBe('student:bia'));
    closeSheet();
    const end = view.querySelector('[data-action="end-coaching"]');
    end.click();
    expect(s.connection.end).not.toHaveBeenCalled();
    expect(end.textContent).toBe('Tap again to end coaching');
    end.click();
    await vi.waitFor(() => expect(s.connection.end).toHaveBeenCalledWith('c1'));
    expect(ctx.navigate).toHaveBeenCalledWith('/me/teaching');
  });

  it('explains a person who is not my student', async () => {
    const view = await renderStudent(appCtx({ services: services([]) }), route);
    expect(view.textContent).toContain("This student isn't available.");
  });
});
```

Add to `tests/unit/teaching-screen.test.js`:

```js
  it('accepts a student request and finds a student to coach', async () => {
    const connections = [{
      connection_id: 'c2', connection_kind: 'direct', state: 'pending', coach_profile_id: 'me',
      student_profile_id: 'eva', student_display_name: 'Eva Costa', initiated_by: 'eva',
    }];
    const services = teachingServices({
      connection: {
        listMine: vi.fn().mockResolvedValue(connections),
        decide: vi.fn().mockResolvedValue({ status: 'active' }),
        searchCandidates: vi.fn().mockResolvedValue([{ profile_id: 'gil', display_name: 'Gil Mota' }]),
        request: vi.fn().mockResolvedValue({ status: 'pending' }),
      },
    });
    const view = await renderTeaching(appCtx({ services }));
    document.body.replaceChildren(view);
    expect(view.querySelector('[data-request="c2"]').textContent).toContain('Eva Costa asked you to coach them');
    view.querySelector('[data-request="c2"] [data-decision="accepted"]').click();
    await vi.waitFor(() => expect(services.connection.decide).toHaveBeenCalledWith('c2', 'accepted'));
    await vi.waitFor(() => expect(services.connection.listMine).toHaveBeenCalledTimes(2));
    document.querySelector('[data-action="find-student"]').click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"] [data-candidate="gil"]')).not.toBeNull());
    expect(services.connection.searchCandidates).toHaveBeenCalledWith('', 'student');
    document.querySelector('[data-candidate="gil"]').click();
    await vi.waitFor(() => expect(services.connection.request).toHaveBeenCalledWith('me', 'gil'));
  });
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/unit/people-search.test.js tests/unit/student-screen.test.js tests/unit/teaching-screen.test.js`
Expected: FAIL — modules not found; Teaching has no requests.

- [ ] **Step 4: Implement the confirm button and people search**

```js
// src/app/screens/confirm-button.js
import { el } from '../shell/page.js';

// A destructive action that needs a second tap; it disarms when focus leaves.
export function confirmButton(document, { text, confirmText, className = 'button-secondary small', label = null, dataset = {}, onConfirm }) {
  let armed = false;
  const button = el(document, 'button', { className, text, attrs: { type: 'button', 'aria-label': label }, dataset });
  function disarm() {
    armed = false;
    button.textContent = text;
    if (label) button.setAttribute('aria-label', label);
    else button.removeAttribute('aria-label');
  }
  button.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      button.textContent = confirmText;
      button.setAttribute('aria-label', confirmText);
      return;
    }
    button.disabled = true;
    try {
      await onConfirm();
    } finally {
      button.disabled = false;
      disarm();
    }
  });
  button.addEventListener('blur', () => { if (armed && !button.disabled) disarm(); });
  return button;
}
```

```js
// src/app/screens/people-search.js
import { el } from '../shell/page.js';

// role 'coach': find someone to coach me. role 'student': find someone I coach.
export function openPeopleSearch(ctx, { role, onRequested = () => {} }) {
  const { document, i18n } = ctx;
  const connection = ctx.services.connection;
  const input = el(document, 'input', {
    className: 'field-input',
    attrs: { type: 'search', name: 'search', autocomplete: 'off', 'aria-label': i18n.t(role === 'coach' ? 'connections.searchCoaches' : 'connections.searchStudents') },
  });
  const results = el(document, 'div', { className: 'day-items' });
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  let token = 0;
  let timer = null;

  function candidateRow(person) {
    const button = el(document, 'button', {
      className: 'button-secondary small', text: i18n.t('peopleSearch.request'),
      attrs: { type: 'button', 'aria-label': i18n.t('connections.request', { name: person.display_name }) },
      dataset: { candidate: person.profile_id },
    });
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = '';
      try {
        if (role === 'coach') await connection.request(person.profile_id, ctx.profile.id);
        else await connection.request(ctx.profile.id, person.profile_id);
        status.textContent = i18n.t('connections.requested', { name: person.display_name });
        onRequested(person);
      } catch (error) {
        status.textContent = error?.message || i18n.t('groupPage.actionError');
        button.disabled = false;
      }
    });
    return el(document, 'div', { className: 'card list-row' }, [el(document, 'span', { text: person.display_name }), button]);
  }

  async function search() {
    const mine = ++token;
    try {
      const people = await connection.searchCandidates(input.value, role);
      if (mine !== token) return;
      results.replaceChildren(...(people.length
        ? people.map(candidateRow)
        : [el(document, 'p', { className: 'muted', text: i18n.t('connections.noResults') })]));
    } catch (error) {
      if (mine === token) status.textContent = error?.message || i18n.t('app.loadError');
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(search, 250);
  });
  const sheet = ctx.openSheet({
    title: i18n.t(role === 'coach' ? 'connections.findCoach' : 'connections.findStudent'),
    content: el(document, 'div', { className: 'sheet-form' }, [input, status, results]),
    onClose: () => clearTimeout(timer),
  });
  search();
  return sheet;
}
```

- [ ] **Step 5: Implement the student page**

```js
// src/app/screens/student.js
import { roundText } from '../training-plan-state.js';
import { el, pageHeader } from '../shell/page.js';
import { confirmButton } from './confirm-button.js';
import { openScheduleSheet } from './schedule-sheet.js';
import { loadTeaching } from './teaching-state.js';
import { kindLabel } from './today-state.js';

function addDaysIso(iso, amount) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function feedbackQuote(document, entry) {
  return el(document, 'blockquote', { className: 'feedback' }, [
    el(document, 'p', { text: entry.body }),
    el(document, 'cite', { className: 'muted', text: entry.coach_name ?? '' }),
  ]);
}

function feedbackForm(ctx, entry, list) {
  const { document, i18n } = ctx;
  const context = el(document, 'select', { className: 'field-input', attrs: { name: 'context' } },
    entry.feedback_contexts.map((option) => el(document, 'option', { text: option.label, attrs: { value: `${option.kind}:${option.id}` } })));
  const body = el(document, 'textarea', { className: 'field-input field-textarea', attrs: { name: 'body', maxlength: '4000' } });
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  const submit = el(document, 'button', { className: 'button-primary', text: i18n.t('training.addFeedback'), attrs: { type: 'submit' } });
  const form = el(document, 'form', { className: 'sheet-form', dataset: { feedback: entry.participation_id } }, [
    entry.feedback_contexts.length > 1 ? el(document, 'label', { className: 'field-label' }, [i18n.t('training.feedbackContext'), context]) : null,
    el(document, 'label', { className: 'field-label' }, [i18n.t('training.feedbackBody'), body]),
    status, submit,
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!body.value.trim()) return;
    const [kind, id] = context.value.split(':');
    submit.disabled = true;
    status.textContent = '';
    try {
      await ctx.services.training.addFeedback({
        participationId: entry.participation_id,
        groupId: kind === 'group' ? id : null,
        connectionId: kind === 'connection' ? id : null,
        body: body.value,
      });
      list.append(feedbackQuote(document, { body: body.value.trim(), coach_name: ctx.profile.display_name }));
      body.value = '';
      status.textContent = i18n.t('coach.feedbackSaved');
    } catch (error) {
      status.textContent = error?.message || i18n.t('coach.feedbackSaveError');
    } finally {
      submit.disabled = false;
    }
  });
  return form;
}

async function openDay(ctx, studentId, item) {
  const { document, i18n } = ctx;
  const content = el(document, 'div', { className: 'student-day' }, [el(document, 'p', { className: 'muted', text: i18n.t('app.loading') })]);
  ctx.openSheet({ title: i18n.formatDate(`${item.local_date}T12:00:00`, { weekday: 'long', day: 'numeric', month: 'long' }), content });
  try {
    const day = await ctx.services.training.getDay({ localDate: item.local_date, profileId: studentId });
    const entry = day.find((candidate) => (candidate.occurrence_id ?? candidate.id) === item.item_id);
    if (!entry) {
      content.replaceChildren(el(document, 'p', { className: 'muted', text: i18n.t('student.dayEmpty') }));
      return;
    }
    const list = el(document, 'div', { className: 'feedback-list' }, (entry.feedback ?? []).map((feedback) => feedbackQuote(document, feedback)));
    content.replaceChildren(...[
      el(document, 'p', { className: 'muted', text: `${kindLabel(i18n, entry.kind)} · ${i18n.formatDuration(entry.duration_minutes)}` }),
      el(document, 'ol', { className: 'chapters' }, (entry.rounds ?? []).map((round, index) => el(document, 'li', { className: 'chapter' }, [
        el(document, 'span', { className: 'chapter-number', text: String(index + 1) }),
        el(document, 'span', { className: 'chapter-text', text: roundText(round) }),
      ]))),
      el(document, 'h3', { className: 'section-label', text: i18n.t('trainingPage.feedback') }),
      list,
      (entry.feedback_contexts ?? []).length ? feedbackForm(ctx, entry, list) : null,
    ].filter(Boolean));
  } catch (error) {
    content.replaceChildren(el(document, 'p', { className: 'muted', text: error?.message || i18n.t('coach.detailsLoadError') }));
  }
}

export async function renderStudent(ctx, route) {
  const { document, i18n } = ctx;
  const studentId = route.params.id;
  const screen = el(document, 'section', { className: 'screen screen-student' });
  const back = () => ctx.back('/me/teaching');
  const unavailable = (text) => {
    screen.append(
      pageHeader({ document, title: '', backLabel: i18n.t('app.back'), onBack: back }),
      el(document, 'p', { className: 'muted', text }),
    );
    return screen;
  };
  let teaching;
  let items;
  try {
    const todayIso = ctx.today();
    [teaching, items] = await Promise.all([
      loadTeaching(ctx),
      ctx.services.training.listCalendar({ start: addDaysIso(todayIso, -365), endExclusive: addDaysIso(todayIso, 1), profileId: studentId }),
    ]);
  } catch (error) {
    return unavailable(error?.kind === 'authorization' ? i18n.t('student.unavailable') : (error?.message || i18n.t('app.loadError')));
  }
  const student = teaching.students.find(({ profileId }) => profileId === studentId);
  if (!student) return unavailable(i18n.t('student.unavailable'));

  const actions = [el(document, 'button', {
    className: 'button-primary', text: `📅 ${i18n.t('plus.schedule')}`, attrs: { type: 'button' }, dataset: { action: 'schedule' },
    on: { click: () => openScheduleSheet(ctx, { teaching, target: `student:${studentId}` }) },
  })];
  if (student.connectionId) {
    actions.push(confirmButton(document, {
      text: i18n.t('student.end'), confirmText: i18n.t('student.confirmEnd'), dataset: { action: 'end-coaching' },
      onConfirm: async () => {
        await ctx.services.connection.end(student.connectionId);
        ctx.navigate('/me/teaching');
      },
    }));
  }
  const done = items.filter(({ item_type: type }) => type === 'completed')
    .sort((left, right) => right.starts_at.localeCompare(left.starts_at));
  screen.append(
    pageHeader({ document, title: student.name, backLabel: i18n.t('app.back'), onBack: back }),
    el(document, 'div', { className: 'chip-row' }, actions),
    el(document, 'h2', { className: 'section-label', text: i18n.t('student.history') }),
    done.length
      ? el(document, 'div', { className: 'day-items' }, done.map((item) => el(document, 'button', {
        className: 'card day-item', attrs: { type: 'button' }, dataset: { occurrence: item.item_id },
        on: { click: () => openDay(ctx, studentId, item) },
      }, [el(document, 'div', {}, [
        el(document, 'strong', { text: [kindLabel(i18n, item.kind), item.group_name].filter(Boolean).join(' · ') }),
        el(document, 'div', { className: 'muted', text: `${i18n.formatDate(`${item.local_date}T12:00:00`, { weekday: 'short', day: 'numeric', month: 'short' })} · ${i18n.formatDuration(item.duration_minutes)}` }),
      ])])))
      : el(document, 'p', { className: 'muted', text: i18n.t('coach.noCompleted') }),
  );
  return screen;
}
```

- [ ] **Step 6: Add requests and Find a student to Teaching**

In `src/app/screens/teaching.js`:

1. Add `import { openPeopleSearch } from './people-search.js';` and change the `teaching-state.js` import to `import { loadTeaching, pendingStudentRequests } from './teaching-state.js';`.

2. After `const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });`, add:

```js
  const reload = async () => screen.replaceWith(await renderTeaching(ctx));
```

3. Replace the final `screen.append(` block that renders the Students heading and list with:

```js
  const requests = pendingStudentRequests({ profileId: ctx.profile.id, connections: teaching.connections });
  screen.append(
    el(document, 'div', { className: 'section-head' }, [
      el(document, 'h2', { className: 'section-label', text: i18n.t('teaching.students') }),
      el(document, 'button', {
        className: 'button-secondary small', text: i18n.t('connections.findStudent'), attrs: { type: 'button' }, dataset: { action: 'find-student' },
        on: { click: () => openPeopleSearch(ctx, { role: 'student' }) },
      }),
    ]),
    ...(requests.length ? [el(document, 'div', { className: 'day-items' }, requests.map((connection) => el(document, 'div', {
      className: 'card list-row', dataset: { request: connection.connection_id },
    }, [
      el(document, 'span', { text: i18n.t('teaching.wantsCoaching', { name: connection.student_display_name }) }),
      el(document, 'div', { className: 'row-actions' }, [
        ['accepted', 'teaching.accept', 'connections.accept', 'button-primary small'],
        ['declined', 'teaching.decline', 'connections.decline', 'button-secondary small'],
      ].map(([decision, key, label, className]) => el(document, 'button', {
        className, text: i18n.t(key), dataset: { decision },
        attrs: { type: 'button', 'aria-label': i18n.t(label, { name: connection.student_display_name }) },
        on: { click: async () => {
          try {
            await ctx.services.connection.decide(connection.connection_id, decision);
            await reload();
          } catch (error) {
            status.textContent = error?.message || i18n.t('groupPage.actionError');
          }
        } },
      }))),
    ])))] : []),
    listOrEmpty(document, teaching.students.map((student) => row(document, {
      href: `#/me/teaching/students/${student.profileId}`, title: student.name,
    })), i18n.t('coach.noStudents')),
  );
```

- [ ] **Step 7: Route the student page**

In `src/app/entries/app.js`, add `import { renderStudent } from '../screens/student.js';` and, in `screenFor` before `case 'discover':`:

```js
      case 'teaching-student': return renderStudent(ctx, route);
```

Append to `assets/app.css`:

```css
/* Students */
.student-day { display: grid; gap: 6px; }
.feedback-list:empty { display: none; }
```

- [ ] **Step 8: Run the unit tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 9: Extend the browser test**

Append to `tests/e2e/app-teaching.spec.js`:

```js
test('a coach opens a student and leaves feedback on a training', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
  await page.goto('/app?demo=1#/me/teaching');
  await page.getByRole('link', { name: /Bia Santos/ }).click();
  await expect(page).toHaveURL(/#\/me\/teaching\/students\/student-bia$/);
  await page.locator('[data-occurrence]').first().click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Coach feedback').fill('Keep the base low.');
  await sheet.getByRole('button', { name: 'Add feedback' }).click();
  await expect(sheet.getByText('Feedback saved.')).toBeVisible();
});
```

- [ ] **Step 10: Run all suites**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/app/screens/confirm-button.js src/app/screens/people-search.js src/app/screens/student.js src/app/screens/teaching.js \
  src/app/entries/app.js src/app/dashboard-i18n.js assets/app.css \
  tests/unit/people-search.test.js tests/unit/student-screen.test.js tests/unit/teaching-screen.test.js tests/e2e/app-teaching.spec.js
git commit -m "feat: add student pages, coach feedback, and coaching requests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Progress, Repertoire, and Catalog

**Files:**
- Create: `src/app/screens/progress.js`, `src/app/screens/repertoire.js`, `src/app/screens/catalog.js`, `tests/unit/me-subpages.test.js`, `tests/e2e/app-me-pages.spec.js`
- Modify: `src/app/ui/statistics-view.js`, `src/app/ui/repertoire-view.js`, `src/app/ui/catalog-view.js`, `src/app/entries/app.js`, `src/app/sw/cache-policy.js`, `app.html`, `src/app/dashboard-i18n.js`, `assets/app.css`
- Test: `tests/unit/statistics-view.test.js`, `tests/unit/repertoire-view.test.js`, `tests/unit/catalog-view.test.js` (must still pass unchanged)

**Interfaces:**
- Consumes: `createStatisticsView`, `createRepertoireView`, `createCatalogView`, `importLocalRepertoire`, `loadDraft`/`saveDraft` (`log-draft.js`), `ctx.refreshTermMappings()` (Task 3).
- Produces: `createStatisticsView({ ..., root })`, `createRepertoireView({ ..., panel })`, `createCatalogView({ ..., panel })` — an optional element; when omitted they keep using `#trainingStatisticsPanel`, `#trainingRepertoirePanel`, `#trainingCatalogPanel` (the classic dashboard is unchanged).
- Produces: `renderProgress(ctx)` (personal statistics plus the ranking of one of my groups, `select[name="rankingGroup"]` when I have more than one), `renderRepertoire(ctx)` (Log adds the sequence as a round to the Log training draft and opens `#/log`), `renderCatalog(ctx)`; the entry redirects `#/me/catalog` to `#/me` for non-curators.

Ruling R13: the Me subpages reuse the classic views through an injected root.

- [ ] **Step 1: Add i18n keys**

`en`:

```js
    'progress.rankingGroup': 'Group for the ranking',
```

`pt`:

```js
    'progress.rankingGroup': 'Grupo da classificação',
```

- [ ] **Step 2: Write the failing unit tests**

```js
// tests/unit/me-subpages.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderCatalog } from '../../src/app/screens/catalog.js';
import { loadDraft } from '../../src/app/screens/log-draft.js';
import { renderProgress } from '../../src/app/screens/progress.js';
import { renderRepertoire } from '../../src/app/screens/repertoire.js';
import { appCtx } from './app-test-context.js';

describe('Me subpages', () => {
  beforeEach(() => { localStorage.clear(); document.body.replaceChildren(); });

  it('shows personal statistics and the ranking of the chosen group', async () => {
    const statistics = {
      getPersonal: vi.fn().mockResolvedValue({
        session_count: 3, total_minutes: 150, current_streak: 2, average_trainings_per_week: 1, average_hours_per_month: 2,
        favorite_movements: [], context_distribution: [], difficulty_trends: [], hardest_transitions: [],
      }),
      getGroup: vi.fn().mockResolvedValue([]),
      searchMembers: vi.fn(),
    };
    const group = {
      listMyMemberships: vi.fn().mockResolvedValue([
        { group_id: 'g1', state: 'active', group: { name: 'Grupo Lua', archived_at: null } },
        { group_id: 'g2', state: 'active', group: { name: 'Roda Sul', archived_at: null } },
      ]),
    };
    const view = await renderProgress(appCtx({ services: { statistics, group } }));
    document.body.replaceChildren(view);
    await vi.waitFor(() => expect(view.querySelectorAll('.statistics-card')).toHaveLength(5));
    expect(statistics.getGroup).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'g1' }));
    const picker = view.querySelector('select[name="rankingGroup"]');
    picker.value = 'g2';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(statistics.getGroup).toHaveBeenLastCalledWith(expect.objectContaining({ groupId: 'g2' })));
  });

  it('logs a saved sequence by adding it to the Log training draft', async () => {
    const repertoire = {
      list: vi.fn().mockResolvedValue([{ id: 's1', title: 'Flow', source_text: '10x (armada, au)' }]),
      importItems: vi.fn().mockResolvedValue({ imported: 0 }),
    };
    const ctx = appCtx({ services: { repertoire } });
    const view = await renderRepertoire(ctx);
    document.body.replaceChildren(view);
    view.querySelector('button[data-action="log"]').click();
    expect(loadDraft(localStorage, 'me').rounds).toEqual([{ sourceText: '10x (armada, au)' }]);
    expect(ctx.navigate).toHaveBeenCalledWith('/log');
  });

  it('lets curators handle uncatalogued words and refreshes recognition', async () => {
    const catalog = {
      listUncataloguedTerms: vi.fn().mockResolvedValue([{ term: 'armadinha', spelling: 'armadinha', people: 2, uses: 3, first_seen: null, last_seen: null, needs_video: false }]),
      ignoreTerm: vi.fn().mockResolvedValue({ status: 'saved' }),
    };
    const ctx = appCtx({ services: { catalog } });
    const view = await renderCatalog(ctx);
    document.body.replaceChildren(view);
    view.querySelector('[data-term="armadinha"] [data-action="ignore"]').click();
    await vi.waitFor(() => expect(catalog.ignoreTerm).toHaveBeenCalledWith('armadinha'));
    await vi.waitFor(() => expect(ctx.refreshTermMappings).toHaveBeenCalled());
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/unit/me-subpages.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 4: Let the classic views render into a given element**

In `src/app/ui/statistics-view.js`, add `root: rootElement = null,` to the destructured parameters of `createStatisticsView` (after `onAccessRevoked = () => {},`) and replace `const root = document.querySelector('#trainingStatisticsPanel');` with:

```js
  const root = rootElement ?? document.querySelector('#trainingStatisticsPanel');
```

In `src/app/ui/repertoire-view.js`, change the signature to `export function createRepertoireView({ document, i18n, repertoire, onLog, panel: panelElement = null })` and replace `const panel = document.querySelector('#trainingRepertoirePanel');` with:

```js
  const panel = panelElement ?? document.querySelector('#trainingRepertoirePanel');
```

In `src/app/ui/catalog-view.js`, change the signature to `export function createCatalogView({ document, i18n, catalog, onMappingsChanged, panel: panelElement = null })` and replace `const panel = document.querySelector('#trainingCatalogPanel');` with:

```js
  const panel = panelElement ?? document.querySelector('#trainingCatalogPanel');
```

- [ ] **Step 5: Implement the three screens**

```js
// src/app/screens/progress.js
import { el, pageHeader } from '../shell/page.js';
import { createStatisticsView } from '../ui/statistics-view.js';

export async function renderProgress(ctx) {
  const { document, i18n, services } = ctx;
  const screen = el(document, 'section', { className: 'screen screen-progress' }, [
    pageHeader({ document, title: i18n.t('app.progress'), backLabel: i18n.t('app.back'), onBack: () => ctx.back('/me') }),
  ]);
  let memberships = [];
  try {
    memberships = await services.group.listMyMemberships();
  } catch {
    memberships = [];
  }
  const groups = memberships.filter((membership) => membership.state === 'active' && membership.group && !membership.group.archived_at);
  const root = el(document, 'div', { className: 'progress-panel' });
  const view = createStatisticsView({
    document, service: services.statistics, i18n, profile: ctx.profile, timezone: ctx.timezone, today: ctx.now(), root,
  });
  if (groups.length > 1) {
    const picker = el(document, 'select', { className: 'field-input', attrs: { name: 'rankingGroup' } },
      groups.map((membership) => el(document, 'option', { text: membership.group.name, attrs: { value: membership.group_id } })));
    picker.addEventListener('change', () => view.setGroup(picker.value));
    screen.append(el(document, 'label', { className: 'field-label' }, [i18n.t('progress.rankingGroup'), picker]));
  }
  screen.append(root);
  view.loadPersonal();
  view.setGroup(groups[0]?.group_id ?? null);
  return screen;
}
```

```js
// src/app/screens/repertoire.js
import { importLocalRepertoire } from '../repertoire-import.js';
import { el, pageHeader } from '../shell/page.js';
import { createRepertoireView } from '../ui/repertoire-view.js';
import { loadDraft, saveDraft } from './log-draft.js';

export async function renderRepertoire(ctx) {
  const { document, i18n, services, profile } = ctx;
  const storage = ctx.window.localStorage;
  const panel = el(document, 'div', { className: 'repertoire-panel' });
  const view = createRepertoireView({
    document, i18n, repertoire: services.repertoire, panel,
    onLog: (item) => {
      const draft = loadDraft(storage, profile.id) ?? {};
      saveDraft(storage, profile.id, { ...draft, rounds: [...(draft.rounds ?? []), { sourceText: item.source_text }] });
      ctx.navigate('/log');
    },
  });
  try {
    await importLocalRepertoire({ storage, repertoire: services.repertoire, userId: profile.id });
  } catch {
    // The one-time browser import retries on the next visit.
  }
  await view.load();
  return el(document, 'section', { className: 'screen screen-repertoire' }, [
    pageHeader({ document, title: i18n.t('app.repertoire'), backLabel: i18n.t('app.back'), onBack: () => ctx.back('/me') }),
    panel,
  ]);
}
```

```js
// src/app/screens/catalog.js
import { el, pageHeader } from '../shell/page.js';
import { createCatalogView } from '../ui/catalog-view.js';

export async function renderCatalog(ctx) {
  const { document, i18n, services } = ctx;
  const panel = el(document, 'div', { className: 'catalog-panel' });
  const view = createCatalogView({ document, i18n, catalog: services.catalog, panel, onMappingsChanged: () => ctx.refreshTermMappings() });
  await view.load();
  return el(document, 'section', { className: 'screen screen-catalog' }, [
    pageHeader({ document, title: i18n.t('app.catalog'), backLabel: i18n.t('app.back'), onBack: () => ctx.back('/me') }),
    panel,
  ]);
}
```

- [ ] **Step 6: Route the subpages and guard Catalog**

In `src/app/entries/app.js`:

1. Add:

```js
import { renderCatalog } from '../screens/catalog.js';
import { renderProgress } from '../screens/progress.js';
import { renderRepertoire } from '../screens/repertoire.js';
```

2. In `meSection`, after the Teaching branch, add:

```js
    if (section === 'progress') return renderProgress(ctx, route);
    if (section === 'repertoire') return renderRepertoire(ctx, route);
    if (section === 'catalog') {
      let curator = false;
      try {
        curator = await services.catalog.amICurator();
      } catch {
        curator = false;
      }
      if (!curator) {
        router.replace('/me');
        return null;
      }
      return renderCatalog(ctx, route);
    }
```

3. In `show`, change `if (token !== renderToken) return;` (the line right after `const view = await screenFor(route);`) to:

```js
    if (!view || token !== renderToken) return;
```

In `app.html`, add after the `training-forms.css` link:

```html
  <link rel="stylesheet" href="/assets/training-statistics.css">
```

In `src/app/sw/cache-policy.js`, add `'/assets/training-statistics.css',` to `APP_SHELL` after `'/assets/training-forms.css',`.

Append to `assets/app.css`:

```css
/* Me subpages that reuse classic views */
.repertoire-list { display: grid; gap: 8px; }
.repertoire-card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 12px 14px; }
.repertoire-card h3 { margin: 0 0 4px; font-size: 1rem; }
.repertoire-text { white-space: pre-wrap; margin: 0 0 8px; }
.dashboard-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.calendar-empty { color: var(--muted); }
.catalog-panel { overflow-x: auto; }
.catalog-table { border-collapse: collapse; min-width: 640px; }
.catalog-table th, .catalog-table td { text-align: left; padding: 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
```

- [ ] **Step 7: Run the unit tests**

Run: `npx vitest run`
Expected: PASS, including the unchanged classic view tests.

- [ ] **Step 8: Write the browser test**

```js
// tests/e2e/app-me-pages.spec.js
import { expect, test } from '@playwright/test';

import { seedAccount } from './app-helpers.js';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
});

test('Progress and Repertoire open from Me, and Catalog is for curators only', async ({ page }) => {
  await page.goto('/app?demo=1#/me/progress');
  await expect(page.locator('.statistics-card').first()).toBeVisible();
  await page.goto('/app?demo=1#/me/repertoire');
  await page.getByRole('button', { name: 'Log', exact: true }).first().click();
  await expect(page).toHaveURL(/#\/log$/);
  await expect(page.locator('textarea[data-round-text]').first()).toHaveValue('10x (armada, aú)');
  await page.goto('/app?demo=1#/me/catalog');
  await expect(page).toHaveURL(/#\/me$/);
});

test('curators open the Catalog from Me', async ({ page }) => {
  await seedAccount(page, { extra: { 'roda.e2e.catalogCurator': true } });
  await page.goto('/app#/me');
  await page.getByRole('link', { name: /Catalog/ }).click();
  await expect(page).toHaveURL(/#\/me\/catalog$/);
  await expect(page.locator('h1.page-title')).toHaveText('Catalog');
});
```

- [ ] **Step 9: Run all suites**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/app/screens/progress.js src/app/screens/repertoire.js src/app/screens/catalog.js \
  src/app/ui/statistics-view.js src/app/ui/repertoire-view.js src/app/ui/catalog-view.js \
  src/app/entries/app.js src/app/sw/cache-policy.js app.html src/app/dashboard-i18n.js assets/app.css \
  tests/unit/me-subpages.test.js tests/e2e/app-me-pages.spec.js
git commit -m "feat: add Progress, Repertoire, and curator Catalog to Me

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Me → Groups and my coaches

**Files:**
- Create: `src/app/screens/group-form.js`, `src/app/screens/groups.js`, `tests/unit/groups-screen.test.js`, `tests/e2e/app-groups.spec.js`
- Modify: `src/app/entries/app.js`, `src/app/dashboard-i18n.js`

**Interfaces:**
- Consumes: `group.listMyMemberships()`, `group.createGroup(values)`, `group.updateGroup(id, values)`, `connection.listMine()`, `connection.decide(id, decision)`, `connection.end(id)`, `openPeopleSearch` and `confirmButton` (Task 11), `ctx.isCoach()`.
- Produces: `openGroupForm(ctx, { group = null, onSaved(groupId) })` — create or edit sheet with `input[name="name"]`, `textarea[name="description"]`, `input[name="location"]`, `input[name="timezone"]`, `input[name="discoverable"]`; values passed as `{ name, description, location, timezone, discoverable }`. Task 15 reuses it for Edit group.
- Produces: `renderGroups(ctx)` at `#/me/groups` — my active groups (`a[href="#/group/<id>"]` with Owner/Coach/Member), `button[data-action="create-group"]` for coaches (others see how to become one), and "My coaches" rows (`[data-coach="<profile-id>"]`) with accept/decline (`[data-decision]`) for a coach's pending request, End (`[data-action="end-coach"]`) for active direct connections, and `button[data-action="find-coach"]`.

Ruling R16: my own pending join requests move to Plan 3. Ruling R17: the student side of coaching connections lives here.

- [ ] **Step 1: Add i18n keys**

`en`:

```js
    'groupsPage.mine': 'My groups',
    'groupsPage.create': 'Create a group',
    'groupsPage.createHint': 'To create a group, choose Both or Teach in Me.',
    'groupsPage.empty': "You're not in any group yet. Ask your coach for an invitation link.",
    'groupsPage.owner': 'Owner',
    'groupsPage.coach': 'Coach',
    'groupsPage.member': 'Member',
    'groupsPage.coaches': 'My coaches',
    'groupsPage.end': 'End',
    'groupsPage.confirmEnd': 'Tap again to end',
    'groupForm.createTitle': 'Create a group',
    'groupForm.editTitle': 'Edit group',
    'groupForm.name': 'Name',
    'groupForm.description': 'Description',
    'groupForm.location': 'Location',
    'groupForm.timezone': 'Timezone',
    'groupForm.discoverable': 'People can find this group',
    'groupForm.create': 'Create group',
    'groupForm.save': 'Save group',
    'groupForm.nameRequired': 'Give the group a name.',
    'groupForm.saveError': "We couldn't save this group. Your entries are still here.",
```

`pt`:

```js
    'groupsPage.mine': 'Os meus grupos',
    'groupsPage.create': 'Criar grupo',
    'groupsPage.createHint': 'Para criar um grupo, escolhe Ambos ou Ensinar em Eu.',
    'groupsPage.empty': 'Ainda não estás em nenhum grupo. Pede ao teu treinador um link de convite.',
    'groupsPage.owner': 'Responsável',
    'groupsPage.coach': 'Treinador',
    'groupsPage.member': 'Membro',
    'groupsPage.coaches': 'Os meus treinadores',
    'groupsPage.end': 'Terminar',
    'groupsPage.confirmEnd': 'Toca outra vez para terminar',
    'groupForm.createTitle': 'Criar grupo',
    'groupForm.editTitle': 'Editar grupo',
    'groupForm.name': 'Nome',
    'groupForm.description': 'Descrição',
    'groupForm.location': 'Localização',
    'groupForm.timezone': 'Fuso horário',
    'groupForm.discoverable': 'As pessoas podem encontrar este grupo',
    'groupForm.create': 'Criar grupo',
    'groupForm.save': 'Guardar grupo',
    'groupForm.nameRequired': 'Dá um nome ao grupo.',
    'groupForm.saveError': 'Não foi possível guardar o grupo. Os dados continuam aqui.',
```

- [ ] **Step 2: Write the failing unit tests**

```js
// tests/unit/groups-screen.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderGroups } from '../../src/app/screens/groups.js';
import { closeSheet } from '../../src/app/shell/sheet.js';
import { appCtx } from './app-test-context.js';

function services() {
  return {
    group: {
      listMyMemberships: vi.fn().mockResolvedValue([
        { group_id: 'g1', state: 'active', access_level: 'coach', group: { id: 'g1', name: 'Grupo Lua', owner_id: 'me', location: 'Lisbon', archived_at: null } },
        { group_id: 'g2', state: 'active', access_level: 'member', group: { id: 'g2', name: 'Roda Sul', owner_id: 'x', location: null, archived_at: null } },
        { group_id: 'g3', state: 'left', access_level: 'member', group: { id: 'g3', name: 'Old', owner_id: 'x', archived_at: null } },
      ]),
      createGroup: vi.fn().mockResolvedValue({ status: 'created', group_id: 'g9' }),
    },
    connection: {
      listMine: vi.fn().mockResolvedValue([
        { connection_id: 'c1', connection_kind: 'direct', state: 'pending', coach_profile_id: 'lua', coach_display_name: 'Professora Lua', student_profile_id: 'me', initiated_by: 'lua' },
        { connection_id: 'c2', connection_kind: 'direct', state: 'active', coach_profile_id: 'sol', coach_display_name: 'Mestre Sol', student_profile_id: 'me', initiated_by: 'me' },
        { connection_id: null, connection_kind: 'group', state: 'active', coach_profile_id: 'rio', coach_display_name: 'Contramestre Rio', student_profile_id: 'me', group_name: 'Roda Sul' },
        { connection_id: 'c4', connection_kind: 'direct', state: 'active', coach_profile_id: 'me', coach_display_name: 'Ana Silva', student_profile_id: 'bia' },
      ]),
      decide: vi.fn().mockResolvedValue({ status: 'active' }),
      end: vi.fn().mockResolvedValue({ status: 'ended' }),
    },
  };
}

describe('groups screen', () => {
  beforeEach(() => { closeSheet(); document.body.replaceChildren(); });

  it('lists my groups with my role and my coaches', async () => {
    const s = services();
    document.body.replaceChildren(await renderGroups(appCtx({ services: s, coach: true })));
    expect([...document.querySelectorAll('a[href^="#/group/"]')].map((link) => link.getAttribute('href'))).toEqual(['#/group/g1', '#/group/g2']);
    expect(document.querySelector('a[href="#/group/g1"]').textContent).toContain('Owner · Lisbon');
    expect(document.querySelector('a[href="#/group/g2"]').textContent).toContain('Member');
    expect([...document.querySelectorAll('[data-coach]')].map((row) => row.dataset.coach)).toEqual(['lua', 'sol', 'rio']);
    expect(document.querySelector('[data-coach="rio"]').textContent).toContain('Through Roda Sul');
    expect(document.querySelector('[data-coach="rio"] button')).toBeNull();
    document.querySelector('[data-coach="lua"] [data-decision="accepted"]').click();
    await vi.waitFor(() => expect(s.connection.decide).toHaveBeenCalledWith('c1', 'accepted'));
    await vi.waitFor(() => expect(s.connection.listMine).toHaveBeenCalledTimes(2));
  });

  it('ends coaching with a coach after a second tap', async () => {
    const s = services();
    document.body.replaceChildren(await renderGroups(appCtx({ services: s, coach: true })));
    const end = document.querySelector('[data-coach="sol"] [data-action="end-coach"]');
    end.click();
    expect(s.connection.end).not.toHaveBeenCalled();
    end.click();
    await vi.waitFor(() => expect(s.connection.end).toHaveBeenCalledWith('c2'));
  });

  it('lets coaches create a group and tells others how', async () => {
    const s = services();
    const ctx = appCtx({ services: s, coach: true });
    document.body.replaceChildren(await renderGroups(ctx));
    document.querySelector('[data-action="create-group"]').click();
    const form = document.querySelector('[role="dialog"] form');
    form.requestSubmit();
    expect(form.querySelector('[role="status"]').textContent).toBe('Give the group a name.');
    form.querySelector('input[name="name"]').value = 'Roda Norte';
    form.querySelector('input[name="timezone"]').value = 'Europe/Lisbon';
    form.requestSubmit();
    await vi.waitFor(() => expect(ctx.navigate).toHaveBeenCalledWith('/group/g9'));
    expect(s.group.createGroup).toHaveBeenCalledWith({ name: 'Roda Norte', description: '', location: '', timezone: 'Europe/Lisbon', discoverable: false });
    const other = await renderGroups(appCtx({ services: services(), coach: false }));
    expect(other.querySelector('[data-action="create-group"]')).toBeNull();
    expect(other.textContent).toContain('To create a group, choose Both or Teach in Me.');
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/unit/groups-screen.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement the group form**

```js
// src/app/screens/group-form.js
import { el } from '../shell/page.js';

function field(document, label, control) {
  return el(document, 'label', { className: 'field-label' }, [label, control]);
}

export function openGroupForm(ctx, { group = null, onSaved }) {
  const { document, i18n } = ctx;
  const input = (name, value, attrs = {}) => {
    const node = el(document, 'input', { className: 'field-input', attrs: { name, ...attrs } });
    node.value = value ?? '';
    return node;
  };
  const name = input('name', group?.name, { maxlength: '80' });
  const description = el(document, 'textarea', { className: 'field-input field-textarea', attrs: { name: 'description', maxlength: '1000' } });
  description.value = group?.description ?? '';
  const location = input('location', group?.location, { maxlength: '120' });
  const timezone = input('timezone', group?.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'), { autocomplete: 'off' });
  const discoverable = el(document, 'input', { attrs: { type: 'checkbox', name: 'discoverable' } });
  discoverable.checked = Boolean(group?.is_discoverable);
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  const submit = el(document, 'button', { className: 'button-primary', text: i18n.t(group ? 'groupForm.save' : 'groupForm.create'), attrs: { type: 'submit' } });
  const form = el(document, 'form', { className: 'sheet-form', attrs: { novalidate: true } }, [
    field(document, i18n.t('groupForm.name'), name),
    field(document, i18n.t('groupForm.description'), description),
    field(document, i18n.t('groupForm.location'), location),
    field(document, i18n.t('groupForm.timezone'), timezone),
    el(document, 'label', { className: 'check-row' }, [discoverable, ` ${i18n.t('groupForm.discoverable')}`]),
    status, submit,
  ]);
  const sheet = ctx.openSheet({ title: i18n.t(group ? 'groupForm.editTitle' : 'groupForm.createTitle'), content: form });
  let busy = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!name.value.trim()) {
      status.textContent = i18n.t('groupForm.nameRequired');
      return;
    }
    busy = true;
    submit.disabled = true;
    status.textContent = '';
    const values = {
      name: name.value, description: description.value, location: location.value,
      timezone: timezone.value, discoverable: discoverable.checked,
    };
    try {
      const result = group
        ? await ctx.services.group.updateGroup(group.id, values)
        : await ctx.services.group.createGroup(values);
      sheet.close();
      onSaved(group?.id ?? result.group_id ?? result.id);
    } catch (error) {
      status.textContent = error?.message || i18n.t('groupForm.saveError');
    } finally {
      busy = false;
      submit.disabled = false;
    }
  });
  return sheet;
}
```

- [ ] **Step 5: Implement Me → Groups**

```js
// src/app/screens/groups.js
import { el, pageHeader } from '../shell/page.js';
import { confirmButton } from './confirm-button.js';
import { openGroupForm } from './group-form.js';
import { openPeopleSearch } from './people-search.js';

function roleKey(membership, profileId) {
  if (membership.group.owner_id === profileId) return 'groupsPage.owner';
  return membership.access_level === 'coach' ? 'groupsPage.coach' : 'groupsPage.member';
}

export async function renderGroups(ctx) {
  const { document, i18n, services, profile } = ctx;
  const screen = el(document, 'section', { className: 'screen screen-groups' }, [
    pageHeader({ document, title: i18n.t('app.groups'), backLabel: i18n.t('app.back'), onBack: () => ctx.back('/me') }),
  ]);
  let memberships;
  let connections;
  try {
    [memberships, connections] = await Promise.all([services.group.listMyMemberships(), services.connection.listMine()]);
  } catch (error) {
    screen.append(el(document, 'p', { className: 'muted', text: error?.message || i18n.t('app.loadError') }));
    return screen;
  }
  const reload = async () => screen.replaceWith(await renderGroups(ctx));
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  const act = async (run) => {
    status.textContent = '';
    try {
      await run();
    } catch (error) {
      status.textContent = error?.message || i18n.t('groupPage.actionError');
    }
  };

  const groups = memberships.filter((membership) => membership.state === 'active' && membership.group && !membership.group.archived_at);
  screen.append(el(document, 'div', { className: 'section-head' }, [
    el(document, 'h2', { className: 'section-label', text: i18n.t('groupsPage.mine') }),
    ctx.isCoach() ? el(document, 'button', {
      className: 'button-secondary small', text: `+ ${i18n.t('groupsPage.create')}`, attrs: { type: 'button' }, dataset: { action: 'create-group' },
      on: { click: () => openGroupForm(ctx, { onSaved: (groupId) => ctx.navigate(`/group/${groupId}`) }) },
    }) : null,
  ]));
  screen.append(groups.length
    ? el(document, 'div', { className: 'day-items' }, groups.map((membership) => el(document, 'a', {
      className: 'card list-row', attrs: { href: `#/group/${membership.group_id}` },
    }, [
      el(document, 'div', {}, [
        el(document, 'strong', { text: membership.group.name }),
        el(document, 'div', { className: 'muted', text: [i18n.t(roleKey(membership, profile.id)), membership.group.location].filter(Boolean).join(' · ') }),
      ]),
      el(document, 'span', { className: 'muted', text: '›', attrs: { 'aria-hidden': 'true' } }),
    ])))
    : el(document, 'p', { className: 'muted', text: i18n.t('groupsPage.empty') }));
  if (!ctx.isCoach()) screen.append(el(document, 'p', { className: 'muted', text: i18n.t('groupsPage.createHint') }));

  function coachRow(connection) {
    const name = connection.coach_display_name;
    const how = connection.connection_kind === 'group'
      ? i18n.t('connections.group', { group: connection.group_name })
      : i18n.t('connections.direct');
    const actions = [];
    if (connection.connection_kind === 'direct' && connection.state === 'pending' && connection.initiated_by !== profile.id) {
      for (const [decision, key, label, className] of [
        ['accepted', 'teaching.accept', 'connections.accept', 'button-primary small'],
        ['declined', 'teaching.decline', 'connections.decline', 'button-secondary small'],
      ]) {
        actions.push(el(document, 'button', {
          className, text: i18n.t(key), dataset: { decision }, attrs: { type: 'button', 'aria-label': i18n.t(label, { name }) },
          on: { click: () => act(async () => { await services.connection.decide(connection.connection_id, decision); await reload(); }) },
        }));
      }
    } else if (connection.connection_kind === 'direct' && connection.state === 'active') {
      actions.push(confirmButton(document, {
        text: i18n.t('groupsPage.end'), confirmText: i18n.t('groupsPage.confirmEnd'),
        label: i18n.t('connections.end', { name }), dataset: { action: 'end-coach' },
        onConfirm: () => act(async () => { await services.connection.end(connection.connection_id); await reload(); }),
      }));
    }
    return el(document, 'div', { className: 'card list-row', dataset: { coach: connection.coach_profile_id } }, [
      el(document, 'div', {}, [
        el(document, 'strong', { text: name }),
        el(document, 'div', { className: 'muted', text: `${how} · ${i18n.t(`connections.${connection.state}`)}` }),
      ]),
      el(document, 'div', { className: 'row-actions' }, actions),
    ]);
  }

  const coaches = connections.filter((connection) => connection.student_profile_id === profile.id
    && ['pending', 'active'].includes(connection.state));
  screen.append(
    el(document, 'div', { className: 'section-head' }, [
      el(document, 'h2', { className: 'section-label', text: i18n.t('groupsPage.coaches') }),
      el(document, 'button', {
        className: 'button-secondary small', text: i18n.t('connections.findCoach'), attrs: { type: 'button' }, dataset: { action: 'find-coach' },
        on: { click: () => openPeopleSearch(ctx, { role: 'coach', onRequested: () => reload() }) },
      }),
    ]),
    coaches.length
      ? el(document, 'div', { className: 'day-items' }, coaches.map(coachRow))
      : el(document, 'p', { className: 'muted', text: i18n.t('connections.empty') }),
    status,
  );
  return screen;
}
```

- [ ] **Step 6: Route Me → Groups**

In `src/app/entries/app.js`, add `import { renderGroups } from '../screens/groups.js';` and in `meSection`, after the Repertoire branch:

```js
    if (section === 'groups') return renderGroups(ctx, route);
```

- [ ] **Step 7: Run the unit tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Write the browser test**

```js
// tests/e2e/app-groups.spec.js
import { expect, test } from '@playwright/test';

import { seedAccount } from './app-helpers.js';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
});

test('a coach creates a group and opens it', async ({ page }) => {
  await seedAccount(page, { profile: { usage_mode: 'both' }, coachProfile: { profile_id: 'practitioner-1' } });
  await page.goto('/app#/me/groups');
  await page.getByRole('button', { name: /Create a group/ }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Name', { exact: true }).fill('Roda Norte');
  await sheet.getByRole('button', { name: 'Create group' }).click();
  await expect(page).toHaveURL(/#\/group\/group-1$/);
});

test('a student asks a coach to coach them', async ({ page }) => {
  await seedAccount(page, {
    extra: {
      'roda.e2e.connectionState': {
        candidates: [{ profile_id: 'coach-lua', display_name: 'Professora Lua', candidate_role: 'coach' }], connections: [],
      },
    },
  });
  await page.goto('/app#/me/groups');
  await page.getByRole('button', { name: 'Find a coach' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Request Professora Lua' }).click();
  await expect(page.getByRole('dialog').getByText('Request sent to Professora Lua.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-coach="coach-lua"]')).toContainText('Pending');
});
```

- [ ] **Step 9: Run all suites**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/app/screens/group-form.js src/app/screens/groups.js src/app/entries/app.js src/app/dashboard-i18n.js \
  tests/unit/groups-screen.test.js tests/e2e/app-groups.spec.js
git commit -m "feat: add Me > Groups with group creation and my coaches

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Group page for members and coaches

**Files:**
- Create: `src/app/screens/link-box.js`, `src/app/screens/group.js`, `tests/unit/group-screen.test.js`
- Modify: `src/app/testing/fake-services.js` (`createE2EGroupService`), `src/app/entries/app.js`, `src/app/dashboard-i18n.js`, `assets/app.css`
- Test: `tests/e2e/app-groups.spec.js`

**Interfaces:**
- Consumes: `group.listMyMemberships()`, `listRoster`, `listJoinRequests`, `listRelationships`, `createInvitation(groupId, email)`, `decideJoinRequest(id, decision)`, `removeMember(groupId, profileId)`, `leaveGroup(groupId)`; `confirmButton` (Task 11).
- Produces: `linkBox(ctx, { link, label, note, mailSubject?, status }) → Node[]` (read-only `input[aria-label=label]`, `button[data-action="copy-link"]`, optional email share link, note). Task 15 reuses it.
- Produces: `inviteLink(origin, token) → '<origin>/dashboard?member_invite=<token>'` (Ruling R15).
- Produces: `renderGroup(ctx, route)` at `#/group/<id>` — header with role, location, timezone; for coaches `input[name="inviteEmail"]` + `button[data-action="create-invite"]`, join requests `[data-join-request="<id>"]` with `button[data-decision="approved"|"declined"]` (approve for coach requests only when I own the group), members `[data-member="<profile-id>"]` with `button[data-action="remove-member"]` (never myself; coaches only when I own the group); for non-owners `button[data-action="leave-group"]`; a status `p[data-group-status]`. Non-members get "This group isn't available." (Ruling R14).
- Produces (fake): `group.leaveGroup(groupId)` marks my membership `left` and records `{ type: 'leave-group', groupId }`.

- [ ] **Step 1: Add i18n keys**

`en`:

```js
    'groupPage.unavailable': "This group isn't available.",
    'groupPage.invite': 'Invite a student',
    'groupPage.inviteEmail': 'Student email (optional)',
    'groupPage.createInvite': 'Create invitation link',
    'groupPage.inviteLink': 'Invitation link',
    'groupPage.inviteSubject': 'Join {name} on Roda',
    'groupPage.inviteExpiry': 'Expires in 7 days · one-time use',
    'groupPage.copy': 'Copy',
    'groupPage.copied': 'Link copied.',
    'groupPage.shareEmail': 'Share by email',
    'groupPage.requests': 'Requests to join',
    'groupPage.noRequests': 'No pending requests.',
    'groupPage.wantsMember': '{name} · wants to join',
    'groupPage.wantsCoach': '{name} · wants to coach',
    'groupPage.approve': 'Approve',
    'groupPage.approveName': 'Approve {name}',
    'groupPage.decline': 'Decline',
    'groupPage.declineName': 'Decline {name}',
    'groupPage.roster': 'Members',
    'groupPage.remove': 'Remove',
    'groupPage.removeName': 'Remove {name}',
    'groupPage.confirmRemove': 'Tap again to remove',
    'groupPage.leave': 'Leave group',
    'groupPage.confirmLeave': 'Tap again to leave',
```

`pt`:

```js
    'groupPage.unavailable': 'Este grupo não está disponível.',
    'groupPage.invite': 'Convidar um aluno',
    'groupPage.inviteEmail': 'Email do aluno (opcional)',
    'groupPage.createInvite': 'Criar link de convite',
    'groupPage.inviteLink': 'Link de convite',
    'groupPage.inviteSubject': 'Junta-te a {name} na Roda',
    'groupPage.inviteExpiry': 'Expira em 7 dias · uso único',
    'groupPage.copy': 'Copiar',
    'groupPage.copied': 'Link copiado.',
    'groupPage.shareEmail': 'Partilhar por email',
    'groupPage.requests': 'Pedidos de entrada',
    'groupPage.noRequests': 'Sem pedidos pendentes.',
    'groupPage.wantsMember': '{name} · quer entrar',
    'groupPage.wantsCoach': '{name} · quer ser treinador',
    'groupPage.approve': 'Aprovar',
    'groupPage.approveName': 'Aprovar {name}',
    'groupPage.decline': 'Recusar',
    'groupPage.declineName': 'Recusar {name}',
    'groupPage.roster': 'Membros',
    'groupPage.remove': 'Remover',
    'groupPage.removeName': 'Remover {name}',
    'groupPage.confirmRemove': 'Toca outra vez para remover',
    'groupPage.leave': 'Sair do grupo',
    'groupPage.confirmLeave': 'Toca outra vez para sair',
```

(`groupPage.actionError` already exists from Task 11.)

- [ ] **Step 2: Write the failing unit tests**

```js
// tests/unit/group-screen.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderGroup } from '../../src/app/screens/group.js';
import { closeSheet } from '../../src/app/shell/sheet.js';
import { appCtx } from './app-test-context.js';

function groupServices(overrides = {}) {
  return {
    listMyMemberships: vi.fn().mockResolvedValue([{
      group_id: 'g1', state: 'active', access_level: 'coach',
      group: { id: 'g1', name: 'Grupo Lua', owner_id: 'other', location: 'Lisbon', timezone: 'Europe/Lisbon', description: 'Tuesdays and Thursdays', is_discoverable: true, archived_at: null },
    }]),
    listRoster: vi.fn().mockResolvedValue([
      { profile_id: 'me', display_name: 'Ana Silva', access_level: 'coach', membership_state: 'active' },
      { profile_id: 'other', display_name: 'Mestre Sol', access_level: 'coach', membership_state: 'active' },
      { profile_id: 'bia', display_name: 'Bia Santos', access_level: 'member', membership_state: 'active' },
    ]),
    listJoinRequests: vi.fn().mockResolvedValue([
      { id: 'r1', display_name: 'Caio Lima', requested_access: 'member', state: 'pending' },
      { id: 'r2', display_name: 'Duda Reis', requested_access: 'coach', state: 'pending' },
    ]),
    listRelationships: vi.fn().mockResolvedValue([]),
    createInvitation: vi.fn().mockResolvedValue({ id: 'i1', token: 'invite-1' }),
    decideJoinRequest: vi.fn().mockResolvedValue({ status: 'approved' }),
    removeMember: vi.fn().mockResolvedValue({ status: 'removed' }),
    leaveGroup: vi.fn().mockResolvedValue({ status: 'left' }),
    ...overrides,
  };
}

const route = { name: 'group', params: { id: 'g1' }, query: {} };

describe('group page', () => {
  beforeEach(() => { closeSheet(); document.body.replaceChildren(); });

  it('lets a coach invite, answer requests, and remove members', async () => {
    const group = groupServices();
    document.body.replaceChildren(await renderGroup(appCtx({ services: { group } }), route));
    expect(document.querySelector('h1').textContent).toBe('Grupo Lua');
    expect(document.body.textContent).toContain('Coach · Lisbon · Europe/Lisbon');
    document.querySelector('input[name="inviteEmail"]').value = 'caio@example.com';
    document.querySelector('[data-action="create-invite"]').click();
    await vi.waitFor(() => expect(document.querySelector('input[aria-label="Invitation link"]').value).toMatch(/\/dashboard\?member_invite=invite-1$/));
    expect(group.createInvitation).toHaveBeenCalledWith('g1', 'caio@example.com');
    expect(document.querySelector('[data-join-request="r2"] [data-decision="approved"]')).toBeNull();
    document.querySelector('[data-join-request="r1"] [data-decision="approved"]').click();
    await vi.waitFor(() => expect(group.decideJoinRequest).toHaveBeenCalledWith('r1', 'approved'));
    await vi.waitFor(() => expect(group.listMyMemberships).toHaveBeenCalledTimes(2));
    expect(document.querySelector('[data-member="me"] [data-action="remove-member"]')).toBeNull();
    expect(document.querySelector('[data-member="other"] [data-action="remove-member"]')).toBeNull();
    const remove = document.querySelector('[data-member="bia"] [data-action="remove-member"]');
    remove.click();
    remove.click();
    await vi.waitFor(() => expect(group.removeMember).toHaveBeenCalledWith('g1', 'bia'));
  });

  it('lets a member leave after a second tap', async () => {
    const group = groupServices({
      listMyMemberships: vi.fn().mockResolvedValue([{
        group_id: 'g1', state: 'active', access_level: 'member', group: { id: 'g1', name: 'Grupo Lua', owner_id: 'other', archived_at: null },
      }]),
    });
    const ctx = appCtx({ services: { group } });
    document.body.replaceChildren(await renderGroup(ctx, route));
    expect(group.listRoster).not.toHaveBeenCalled();
    expect(document.querySelector('[data-action="create-invite"]')).toBeNull();
    const leave = document.querySelector('[data-action="leave-group"]');
    leave.click();
    leave.click();
    await vi.waitFor(() => expect(group.leaveGroup).toHaveBeenCalledWith('g1'));
    expect(ctx.navigate).toHaveBeenCalledWith('/me/groups');
  });

  it('explains a group I am not in', async () => {
    const group = groupServices({ listMyMemberships: vi.fn().mockResolvedValue([]) });
    const view = await renderGroup(appCtx({ services: { group } }), route);
    expect(view.textContent).toContain("This group isn't available.");
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/unit/group-screen.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement the link box and the group page**

```js
// src/app/screens/link-box.js
import { el } from '../shell/page.js';

// A read-only link with Copy, an optional email share, and a short note.
export function linkBox(ctx, { link, label, note, mailSubject = null, status }) {
  const { document, i18n } = ctx;
  const input = el(document, 'input', { className: 'field-input', attrs: { readonly: true, 'aria-label': label } });
  input.value = link;
  const copy = el(document, 'button', {
    className: 'button-secondary small', text: i18n.t('groupPage.copy'), attrs: { type: 'button' }, dataset: { action: 'copy-link' },
    on: { click: async () => {
      try {
        await ctx.window.navigator.clipboard.writeText(link);
        status.textContent = i18n.t('groupPage.copied');
      } catch {
        input.select();
      }
    } },
  });
  const share = mailSubject
    ? el(document, 'a', {
      className: 'button-secondary small', text: i18n.t('groupPage.shareEmail'),
      attrs: { href: `mailto:?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(link)}` },
    })
    : null;
  return [input, el(document, 'div', { className: 'row-actions' }, [copy, share]), el(document, 'p', { className: 'muted', text: note })];
}
```

```js
// src/app/screens/group.js
import { el, pageHeader } from '../shell/page.js';
import { confirmButton } from './confirm-button.js';
import { linkBox } from './link-box.js';

// Ruling R15: links keep pointing at /dashboard until the switch-over.
export function inviteLink(origin, token) {
  return `${origin}/dashboard?member_invite=${encodeURIComponent(token)}`;
}

function section(document, title, children) {
  return el(document, 'section', { className: 'group-section' }, [
    el(document, 'h2', { className: 'section-label', text: title }), ...children,
  ]);
}

export async function renderGroup(ctx, route) {
  const { document, i18n, services, profile } = ctx;
  const t = (key, values) => i18n.t(key, values);
  const groupId = route.params.id;
  const screen = el(document, 'section', { className: 'screen screen-group' });
  const back = () => ctx.back('/me/groups');
  const notAvailable = (text) => {
    screen.append(pageHeader({ document, title: '', backLabel: t('app.back'), onBack: back }), el(document, 'p', { className: 'muted', text }));
    return screen;
  };
  let memberships;
  try {
    memberships = await services.group.listMyMemberships();
  } catch (error) {
    return notAvailable(error?.message || t('app.loadError'));
  }
  const membership = memberships.find((item) => item.group_id === groupId && item.state === 'active' && item.group && !item.group.archived_at);
  // Ruling R14: Plan 3 replaces this branch with the Discover group card.
  if (!membership) return notAvailable(t('groupPage.unavailable'));
  const { group } = membership;
  const isOwner = group.owner_id === profile.id;
  const isCoach = membership.access_level === 'coach';
  let roster = [];
  let requests = [];
  let relationships = [];
  try {
    [roster, requests, relationships] = await Promise.all([
      isCoach ? services.group.listRoster(groupId) : [],
      isCoach ? services.group.listJoinRequests(groupId) : [],
      isOwner ? services.group.listRelationships(groupId) : [],
    ]);
  } catch (error) {
    return notAvailable(error?.kind === 'authorization' ? t('groupPage.unavailable') : (error?.message || t('app.loadError')));
  }
  const reload = async () => screen.replaceWith(await renderGroup(ctx, route));
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' }, dataset: { groupStatus: '' } });
  const act = async (run) => {
    status.textContent = '';
    try {
      await run();
    } catch (error) {
      status.textContent = error?.message || t('groupPage.actionError');
    }
  };

  function inviteSection() {
    const email = el(document, 'input', {
      className: 'field-input', attrs: { type: 'email', name: 'inviteEmail', autocomplete: 'off', 'aria-label': t('groupPage.inviteEmail'), placeholder: t('groupPage.inviteEmail') },
    });
    const result = el(document, 'div', { className: 'link-box' });
    const create = el(document, 'button', {
      className: 'button-secondary', text: t('groupPage.createInvite'), attrs: { type: 'button' }, dataset: { action: 'create-invite' },
    });
    create.addEventListener('click', () => act(async () => {
      const invitation = await services.group.createInvitation(groupId, email.value);
      result.replaceChildren(...linkBox(ctx, {
        link: inviteLink(ctx.window.location.origin, invitation.token), label: t('groupPage.inviteLink'),
        note: t('groupPage.inviteExpiry'), mailSubject: t('groupPage.inviteSubject', { name: group.name }), status,
      }));
    }));
    return section(document, t('groupPage.invite'), [email, create, result]);
  }

  function requestsSection() {
    const pending = requests.filter((request) => request.state === 'pending');
    if (!pending.length) return section(document, t('groupPage.requests'), [el(document, 'p', { className: 'muted', text: t('groupPage.noRequests') })]);
    return section(document, t('groupPage.requests'), pending.map((request) => {
      const decisions = [
        ...(request.requested_access === 'member' || isOwner ? [['approved', 'groupPage.approve', 'groupPage.approveName', 'button-primary small']] : []),
        ['declined', 'groupPage.decline', 'groupPage.declineName', 'button-secondary small'],
      ];
      return el(document, 'div', { className: 'card list-row', dataset: { joinRequest: request.id } }, [
        el(document, 'span', { text: t(request.requested_access === 'coach' ? 'groupPage.wantsCoach' : 'groupPage.wantsMember', { name: request.display_name }) }),
        el(document, 'div', { className: 'row-actions' }, decisions.map(([decision, key, label, className]) => el(document, 'button', {
          className, text: t(key), dataset: { decision }, attrs: { type: 'button', 'aria-label': t(label, { name: request.display_name }) },
          on: { click: () => act(async () => { await services.group.decideJoinRequest(request.id, decision); await reload(); }) },
        }))),
      ]);
    }));
  }

  function rosterSection() {
    const active = roster.filter((member) => (member.membership_state ?? 'active') === 'active');
    return section(document, t('groupPage.roster'), active.map((member) => {
      const canRemove = member.profile_id !== profile.id && (member.access_level === 'member' || isOwner);
      return el(document, 'div', { className: 'card list-row', dataset: { member: member.profile_id } }, [
        el(document, 'div', {}, [
          el(document, 'strong', { text: member.display_name }),
          el(document, 'div', { className: 'muted', text: t(member.access_level === 'coach' ? 'groupsPage.coach' : 'groupsPage.member') }),
        ]),
        canRemove ? confirmButton(document, {
          text: t('groupPage.remove'), confirmText: t('groupPage.confirmRemove'),
          label: t('groupPage.removeName', { name: member.display_name }), dataset: { action: 'remove-member' },
          onConfirm: () => act(async () => { await services.group.removeMember(groupId, member.profile_id); await reload(); }),
        }) : null,
      ]);
    }));
  }

  const role = t(isOwner ? 'groupsPage.owner' : isCoach ? 'groupsPage.coach' : 'groupsPage.member');
  screen.append(...[
    pageHeader({ document, title: group.name, backLabel: t('app.back'), onBack: back }),
    el(document, 'p', { className: 'muted', text: [role, group.location, group.timezone].filter(Boolean).join(' · ') }),
    group.description ? el(document, 'p', { text: group.description }) : null,
    status,
    ...(isCoach ? [inviteSection(), requestsSection(), rosterSection()] : []),
    isOwner ? null : confirmButton(document, {
      text: t('groupPage.leave'), confirmText: t('groupPage.confirmLeave'), className: 'button-danger', dataset: { action: 'leave-group' },
      onConfirm: () => act(async () => { await services.group.leaveGroup(groupId); ctx.navigate('/me/groups'); }),
    }),
  ].filter(Boolean));
  return screen;
}
```

- [ ] **Step 5: Add `leaveGroup` to the fake group service**

In `createE2EGroupService` in `src/app/testing/fake-services.js`, add after `removeMember`:

```js
    async leaveGroup(groupId) {
      const state = readState();
      state.memberships = state.memberships.map((item) => (item.group_id === groupId ? { ...item, state: 'left' } : item));
      state.rosters[groupId] = (state.rosters[groupId] ?? []).map((item) => (
        item.profile_id === 'practitioner-1' ? { ...item, membership_state: 'left' } : item));
      writeState(state);
      record({ type: 'leave-group', groupId });
      return { status: 'left', group_id: groupId };
    },
```

- [ ] **Step 6: Route `#/group/<id>`**

In `src/app/entries/app.js`, add `import { renderGroup } from '../screens/group.js';` and in `screenFor`, before `case 'discover':`:

```js
      case 'group': return renderGroup(ctx, route);
```

Append to `assets/app.css`:

```css
/* Group page */
.group-section { margin-top: 6px; }
.link-box { display: grid; gap: 6px; margin-top: 8px; }
.link-box:empty { display: none; }
.screen-group .button-danger { margin-top: 18px; }
```

- [ ] **Step 7: Run the unit tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Extend the browser test**

Append to `tests/e2e/app-groups.spec.js`:

```js
test('a coach invites a student from the group page', async ({ page }) => {
  await page.goto('/app?demo=1#/me/groups');
  await page.getByRole('link', { name: /Roda da Lua/ }).click();
  await expect(page).toHaveURL(/#\/group\/demo-group$/);
  await page.getByRole('button', { name: 'Create invitation link' }).click();
  await expect(page.getByLabel('Invitation link')).toHaveValue(/\/dashboard\?member_invite=invite-1$/);
  await expect(page.locator('[data-member="student-bia"]')).toBeVisible();
});
```

- [ ] **Step 9: Run all suites**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/app/screens/link-box.js src/app/screens/group.js src/app/testing/fake-services.js src/app/entries/app.js \
  src/app/dashboard-i18n.js assets/app.css tests/unit/group-screen.test.js tests/e2e/app-groups.spec.js
git commit -m "feat: add the group page with invitations, requests, and members

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Owner tools on the group page

**Files:**
- Create: `src/app/screens/group-owner.js`
- Modify: `src/app/screens/group.js`, `src/app/dashboard-i18n.js`, `assets/app.css`
- Test: `tests/unit/group-screen.test.js`, `tests/e2e/app-groups.spec.js`

**Interfaces:**
- Consumes: `openGroupForm` (Task 13), `linkBox` and `renderGroup`'s `reload`/`status` (Task 14), `confirmButton` (Task 11); `group.rotateDiscoveryLink`, `revokeDiscoveryLink`, `transferOwnership`, `archiveGroup`, `searchGroups('')`, `inviteChildGroup`, `decideRelationship`, `revokeRelationship`, `setRelationshipSharing`.
- Produces: `discoveryLink(origin, token) → '<origin>/dashboard?group_link=<token>'`; `renderOwnerTools(ctx, { group, roster, relationships, reload, status }) → HTMLElement` with `button[data-action="edit-group"|"discovery-link"|"transfer"|"invite-child"]`, `button[data-action="revoke-link"]` after a link exists, hierarchy rows `[data-relationship="<id>"]` (pending and active only) with `[data-relation-decision="accepted"|"declined"]` when this group is the invited child, `[data-action="revoke-relation"]` for active ones, `select[name="sharing"]` when this group is the active child, and `button[data-action="archive-group"]`.

- [ ] **Step 1: Add i18n keys**

`en`:

```js
    'groupPage.ownerTools': 'Owner tools',
    'groupPage.discoveryLink': 'Create discovery link',
    'groupPage.discoveryLabel': 'Discovery link',
    'groupPage.discoveryHint': 'This link shows the group but never makes anyone a member.',
    'groupPage.revokeLink': 'Revoke link',
    'groupPage.linkRevoked': 'Discovery link revoked.',
    'groupPage.transfer': 'Transfer ownership',
    'groupPage.newOwner': 'New owner',
    'groupPage.transferConfirm': 'Transfer',
    'groupPage.hierarchy': 'Group hierarchy',
    'groupPage.hierarchyNote': 'Visibility applies to the immediate parent only; it never cascades to higher groups.',
    'groupPage.relationPending': 'waiting for an answer',
    'groupPage.relationActive': 'active',
    'groupPage.acceptParent': 'Accept {name} as parent',
    'groupPage.declineParent': 'Decline {name} as parent',
    'groupPage.revoke': 'Revoke',
    'groupPage.confirmRevoke': 'Tap again to revoke',
    'groupPage.sharing': 'What the parent group sees',
    'groupPage.namedProgress': 'Named progress',
    'groupPage.fullCoaching': 'Full coaching access',
    'groupPage.sharingSaved': 'Sharing saved.',
    'groupPage.inviteChild': 'Invite a child group',
    'groupPage.childGroup': 'Child group',
    'groupPage.sendInvite': 'Send invitation',
    'groupPage.childInvited': 'Group invitation sent.',
    'groupPage.noChildGroups': 'No other discoverable groups to invite.',
    'groupPage.archive': 'Archive group',
    'groupPage.confirmArchive': 'Tap again to archive for everyone',
```

`pt`:

```js
    'groupPage.ownerTools': 'Ferramentas do responsável',
    'groupPage.discoveryLink': 'Criar link de descoberta',
    'groupPage.discoveryLabel': 'Link de descoberta',
    'groupPage.discoveryHint': 'Este link mostra o grupo mas nunca torna ninguém membro.',
    'groupPage.revokeLink': 'Revogar link',
    'groupPage.linkRevoked': 'Link de descoberta revogado.',
    'groupPage.transfer': 'Transferir responsabilidade',
    'groupPage.newOwner': 'Novo responsável',
    'groupPage.transferConfirm': 'Transferir',
    'groupPage.hierarchy': 'Hierarquia de grupos',
    'groupPage.hierarchyNote': 'A visibilidade aplica-se só ao grupo pai direto; nunca passa para grupos acima.',
    'groupPage.relationPending': 'à espera de resposta',
    'groupPage.relationActive': 'ativa',
    'groupPage.acceptParent': 'Aceitar {name} como grupo pai',
    'groupPage.declineParent': 'Recusar {name} como grupo pai',
    'groupPage.revoke': 'Revogar',
    'groupPage.confirmRevoke': 'Toca outra vez para revogar',
    'groupPage.sharing': 'O que o grupo pai vê',
    'groupPage.namedProgress': 'Progresso com nomes',
    'groupPage.fullCoaching': 'Acesso total de treino',
    'groupPage.sharingSaved': 'Partilha guardada.',
    'groupPage.inviteChild': 'Convidar um grupo filho',
    'groupPage.childGroup': 'Grupo filho',
    'groupPage.sendInvite': 'Enviar convite',
    'groupPage.childInvited': 'Convite de grupo enviado.',
    'groupPage.noChildGroups': 'Não há outros grupos visíveis para convidar.',
    'groupPage.archive': 'Arquivar grupo',
    'groupPage.confirmArchive': 'Toca outra vez para arquivar para todos',
```

- [ ] **Step 2: Write the failing unit tests**

Append to `tests/unit/group-screen.test.js` (inside `describe('group page', ...)`; `groupServices` and `route` are defined at the top of that file):

```js
  const owned = () => vi.fn().mockResolvedValue([{
    group_id: 'g1', state: 'active', access_level: 'coach',
    group: { id: 'g1', name: 'Grupo Lua', owner_id: 'me', timezone: 'Europe/Lisbon', is_discoverable: true, archived_at: null },
  }]);

  it('gives owners a discovery link, transfer, hierarchy answers, and archive', async () => {
    const group = groupServices({
      listMyMemberships: owned(),
      listRelationships: vi.fn().mockResolvedValue([
        { id: 'rel1', parent_group_id: 'p', child_group_id: 'g1', state: 'pending', sharing_level: 'named_progress', parent_name: 'Grupo Mãe', child_name: 'Grupo Lua' },
        { id: 'rel2', parent_group_id: 'g1', child_group_id: 'c', state: 'active', sharing_level: 'named_progress', parent_name: 'Grupo Lua', child_name: 'Roda Filha' },
        { id: 'rel3', parent_group_id: 'g1', child_group_id: 'd', state: 'revoked', sharing_level: 'named_progress', parent_name: 'Grupo Lua', child_name: 'Old' },
      ]),
      rotateDiscoveryLink: vi.fn().mockResolvedValue({ status: 'active', token: 'discovery-1' }),
      revokeDiscoveryLink: vi.fn().mockResolvedValue({ status: 'revoked' }),
      decideRelationship: vi.fn().mockResolvedValue({ status: 'active' }),
      transferOwnership: vi.fn().mockResolvedValue({ status: 'transferred' }),
      archiveGroup: vi.fn().mockResolvedValue({ status: 'archived' }),
    });
    const ctx = appCtx({ services: { group } });
    document.body.replaceChildren(await renderGroup(ctx, route));
    expect(document.querySelector('[data-action="leave-group"]')).toBeNull();
    expect(document.querySelector('[data-member="other"] [data-action="remove-member"]')).not.toBeNull();
    document.querySelector('[data-action="discovery-link"]').click();
    await vi.waitFor(() => expect(document.querySelector('input[aria-label="Discovery link"]').value).toMatch(/\/dashboard\?group_link=discovery-1$/));
    document.querySelector('[data-action="revoke-link"]').click();
    await vi.waitFor(() => expect(group.revokeDiscoveryLink).toHaveBeenCalledWith('g1'));
    expect(document.querySelector('[data-group-status]').textContent).toBe('Discovery link revoked.');
    expect([...document.querySelectorAll('[data-relationship]')].map((row) => row.dataset.relationship)).toEqual(['rel1', 'rel2']);
    expect(document.querySelector('[data-relationship="rel2"] [data-action="revoke-relation"]')).not.toBeNull();
    document.querySelector('[data-relationship="rel1"] [data-relation-decision="accepted"]').click();
    await vi.waitFor(() => expect(group.decideRelationship).toHaveBeenCalledWith('rel1', 'accepted'));
    await vi.waitFor(() => expect(group.listMyMemberships).toHaveBeenCalledTimes(2));
    document.querySelector('[data-action="transfer"]').click();
    const sheet = document.querySelector('[role="dialog"]');
    expect([...sheet.querySelectorAll('select[name="newOwner"] option')].map((option) => option.value)).toEqual(['other']);
    sheet.querySelector('form').requestSubmit();
    await vi.waitFor(() => expect(group.transferOwnership).toHaveBeenCalledWith('g1', 'other'));
    await vi.waitFor(() => expect(group.listMyMemberships).toHaveBeenCalledTimes(3));
    const archive = document.querySelector('[data-action="archive-group"]');
    archive.click();
    expect(group.archiveGroup).not.toHaveBeenCalled();
    archive.click();
    await vi.waitFor(() => expect(group.archiveGroup).toHaveBeenCalledWith('g1'));
    expect(ctx.navigate).toHaveBeenCalledWith('/me/groups');
  });

  it('invites a child group and saves what the parent sees', async () => {
    const group = groupServices({
      listMyMemberships: owned(),
      listRelationships: vi.fn().mockResolvedValue([
        { id: 'rel4', parent_group_id: 'p', child_group_id: 'g1', state: 'active', sharing_level: 'named_progress', parent_name: 'Grupo Mãe', child_name: 'Grupo Lua' },
      ]),
      searchGroups: vi.fn().mockResolvedValue([{ id: 'g1', name: 'Grupo Lua' }, { id: 'g7', name: 'Roda Sete' }]),
      inviteChildGroup: vi.fn().mockResolvedValue({ status: 'pending' }),
      setRelationshipSharing: vi.fn().mockResolvedValue({ status: 'updated' }),
    });
    document.body.replaceChildren(await renderGroup(appCtx({ services: { group } }), route));
    const sharing = document.querySelector('[data-relationship="rel4"] select[name="sharing"]');
    expect(sharing.value).toBe('named_progress');
    sharing.value = 'full_coaching';
    sharing.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(group.setRelationshipSharing).toHaveBeenCalledWith('rel4', 'full_coaching'));
    expect(document.querySelector('[data-group-status]').textContent).toBe('Sharing saved.');
    document.querySelector('[data-action="invite-child"]').click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"] select[name="childGroup"]')).not.toBeNull());
    expect([...document.querySelectorAll('[role="dialog"] select[name="childGroup"] option')].map((option) => option.value)).toEqual(['g7']);
    document.querySelector('[role="dialog"] form').requestSubmit();
    await vi.waitFor(() => expect(group.inviteChildGroup).toHaveBeenCalledWith('g1', 'g7'));
    expect(document.querySelector('[data-group-status]').textContent).toBe('Group invitation sent.');
  });
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/unit/group-screen.test.js`
Expected: FAIL — no owner tools on the page.

- [ ] **Step 4: Implement the owner tools**

```js
// src/app/screens/group-owner.js
import { el } from '../shell/page.js';
import { confirmButton } from './confirm-button.js';
import { openGroupForm } from './group-form.js';
import { linkBox } from './link-box.js';

// Ruling R15: links keep pointing at /dashboard until the switch-over.
export function discoveryLink(origin, token) {
  return `${origin}/dashboard?group_link=${encodeURIComponent(token)}`;
}

function sheetForm(ctx, { title, label, name, options, submitText, submitClass = 'button-primary', onSubmit }) {
  const { document } = ctx;
  const select = el(document, 'select', { className: 'field-input', attrs: { name } },
    options.map(([value, text]) => el(document, 'option', { text, attrs: { value } })));
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  const submit = el(document, 'button', { className: submitClass, text: submitText, attrs: { type: 'submit' } });
  const form = el(document, 'form', { className: 'sheet-form' }, [
    el(document, 'label', { className: 'field-label' }, [label, select]), status, submit,
  ]);
  const sheet = ctx.openSheet({ title, content: form });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = '';
    try {
      await onSubmit(select.value);
      sheet.close();
    } catch (error) {
      status.textContent = error?.message || ctx.i18n.t('groupPage.actionError');
    } finally {
      submit.disabled = false;
    }
  });
  return sheet;
}

export function renderOwnerTools(ctx, { group, roster, relationships, reload, status }) {
  const { document, i18n, services } = ctx;
  const t = (key, values) => i18n.t(key, values);
  const act = async (run) => {
    status.textContent = '';
    try {
      await run();
    } catch (error) {
      status.textContent = error?.message || t('groupPage.actionError');
    }
  };
  const button = (key, action, onClick, className = 'button-secondary small') => el(document, 'button', {
    className, text: t(key), attrs: { type: 'button' }, dataset: { action }, on: { click: onClick },
  });

  const linkArea = el(document, 'div', { className: 'link-box' });
  const coaches = roster.filter((member) => (member.membership_state ?? 'active') === 'active'
    && member.access_level === 'coach' && member.profile_id !== ctx.profile.id);

  const tools = el(document, 'div', { className: 'chip-row' }, [
    button('groupForm.editTitle', 'edit-group', () => openGroupForm(ctx, { group, onSaved: () => reload() })),
    button('groupPage.discoveryLink', 'discovery-link', () => act(async () => {
      const result = await services.group.rotateDiscoveryLink(group.id);
      linkArea.replaceChildren(
        ...linkBox(ctx, { link: discoveryLink(ctx.window.location.origin, result.token), label: t('groupPage.discoveryLabel'), note: t('groupPage.discoveryHint'), status }),
        button('groupPage.revokeLink', 'revoke-link', () => act(async () => {
          await services.group.revokeDiscoveryLink(group.id);
          linkArea.replaceChildren();
          status.textContent = t('groupPage.linkRevoked');
        })),
      );
    })),
    coaches.length ? button('groupPage.transfer', 'transfer', () => sheetForm(ctx, {
      title: t('groupPage.transfer'), label: t('groupPage.newOwner'), name: 'newOwner',
      options: coaches.map((member) => [member.profile_id, member.display_name]),
      submitText: t('groupPage.transferConfirm'), submitClass: 'button-danger',
      onSubmit: async (newOwnerId) => { await services.group.transferOwnership(group.id, newOwnerId); await reload(); },
    })) : null,
    button('groupPage.inviteChild', 'invite-child', () => act(async () => {
      const groups = (await services.group.searchGroups('')).filter((candidate) => candidate.id !== group.id);
      if (!groups.length) {
        status.textContent = t('groupPage.noChildGroups');
        return;
      }
      sheetForm(ctx, {
        title: t('groupPage.inviteChild'), label: t('groupPage.childGroup'), name: 'childGroup',
        options: groups.map((candidate) => [candidate.id, candidate.name]), submitText: t('groupPage.sendInvite'),
        onSubmit: async (childGroupId) => {
          await services.group.inviteChildGroup(group.id, childGroupId);
          status.textContent = t('groupPage.childInvited');
        },
      });
    })),
  ]);

  function relationRow(relationship) {
    const isChild = relationship.child_group_id === group.id;
    const text = `${relationship.parent_name ?? ''} → ${relationship.child_name ?? group.name} · ${t(relationship.state === 'active' ? 'groupPage.relationActive' : 'groupPage.relationPending')}`;
    const actions = [];
    if (relationship.state === 'pending' && isChild) {
      for (const [decision, key, label, className] of [
        ['accepted', 'teaching.accept', 'groupPage.acceptParent', 'button-primary small'],
        ['declined', 'teaching.decline', 'groupPage.declineParent', 'button-secondary small'],
      ]) {
        actions.push(el(document, 'button', {
          className, text: t(key), dataset: { relationDecision: decision },
          attrs: { type: 'button', 'aria-label': t(label, { name: relationship.parent_name ?? '' }) },
          on: { click: () => act(async () => { await services.group.decideRelationship(relationship.id, decision); await reload(); }) },
        }));
      }
    }
    if (relationship.state === 'active') {
      actions.push(confirmButton(document, {
        text: t('groupPage.revoke'), confirmText: t('groupPage.confirmRevoke'), dataset: { action: 'revoke-relation' },
        onConfirm: () => act(async () => { await services.group.revokeRelationship(relationship.id); await reload(); }),
      }));
      if (isChild) {
        const sharing = el(document, 'select', { className: 'field-input', attrs: { name: 'sharing', 'aria-label': t('groupPage.sharing') } },
          [['named_progress', 'groupPage.namedProgress'], ['full_coaching', 'groupPage.fullCoaching']]
            .map(([value, key]) => el(document, 'option', { text: t(key), attrs: { value } })));
        sharing.value = relationship.sharing_level;
        sharing.addEventListener('change', () => act(async () => {
          await services.group.setRelationshipSharing(relationship.id, sharing.value);
          status.textContent = t('groupPage.sharingSaved');
        }));
        actions.push(sharing);
      }
    }
    return el(document, 'div', { className: 'card relation-row', dataset: { relationship: relationship.id } }, [
      el(document, 'span', { text }), el(document, 'div', { className: 'row-actions' }, actions),
    ]);
  }

  return el(document, 'section', { className: 'owner-tools' }, [
    el(document, 'h2', { className: 'section-label', text: t('groupPage.ownerTools') }),
    tools,
    linkArea,
    el(document, 'h2', { className: 'section-label', text: t('groupPage.hierarchy') }),
    el(document, 'p', { className: 'muted', text: t('groupPage.hierarchyNote') }),
    ...relationships.filter((relationship) => ['pending', 'active'].includes(relationship.state)).map(relationRow),
    confirmButton(document, {
      text: t('groupPage.archive'), confirmText: t('groupPage.confirmArchive'), className: 'button-danger', dataset: { action: 'archive-group' },
      onConfirm: () => act(async () => { await services.group.archiveGroup(group.id); ctx.navigate('/me/groups'); }),
    }),
  ]);
}
```

- [ ] **Step 5: Show the tools to owners**

In `src/app/screens/group.js`, add `import { renderOwnerTools } from './group-owner.js';` and, in the final `screen.append(...[ ... ].filter(Boolean))` list, replace `isOwner ? null : confirmButton(document, {` … `}),` (the Leave button entry) with:

```js
    isOwner ? renderOwnerTools(ctx, { group, roster, relationships, reload, status }) : confirmButton(document, {
      text: t('groupPage.leave'), confirmText: t('groupPage.confirmLeave'), className: 'button-danger', dataset: { action: 'leave-group' },
      onConfirm: () => act(async () => { await services.group.leaveGroup(groupId); ctx.navigate('/me/groups'); }),
    }),
```

Append to `assets/app.css`:

```css
/* Owner tools */
.owner-tools { margin-top: 10px; }
.relation-row { display: grid; gap: 8px; margin-bottom: 8px; }
.owner-tools > .button-danger { margin-top: 18px; }
```

- [ ] **Step 6: Run the unit tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 7: Extend the browser test**

Append to `tests/e2e/app-groups.spec.js`:

```js
test('an owner creates a discovery link for the group', async ({ page }) => {
  await page.goto('/app?demo=1#/group/demo-group');
  await page.getByRole('button', { name: 'Create discovery link' }).click();
  await expect(page.getByLabel('Discovery link')).toHaveValue(/\/dashboard\?group_link=discovery-1$/);
  await page.getByRole('button', { name: 'Revoke link' }).click();
  await expect(page.getByText('Discovery link revoked.')).toBeVisible();
});
```

- [ ] **Step 8: Run all suites**

Run: `npx vitest run && npm run test:e2e`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/screens/group-owner.js src/app/screens/group.js src/app/dashboard-i18n.js assets/app.css \
  tests/unit/group-screen.test.js tests/e2e/app-groups.spec.js
git commit -m "feat: add owner tools to the group page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Verification and docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Describe the new parts of `/app`**

In `README.md`, replace the paragraph under `### The new app (`/app`)` with:

```markdown
A mobile-first version of the dashboard is being built at `/app`: Today,
Calendar, Log training, the training page, the coach's class page, and Me with
Progress, Repertoire, Teaching (plans, students, scheduling, past classes),
Groups, Catalog for curators, and Settings. New accounts start with a short
welcome, and a Train · Both · Teach setting in Me changes what **+** offers and
whether Teaching is listed, without removing any data. The app has a bottom tab
bar on phones and a sidebar on desktop and can be added to a phone's home
screen. Discover is not rebuilt yet and links to the classic dashboard at
`/dashboard`.
```

- [ ] **Step 2: Check the placeholders that remain**

Run: `grep -n "renderPlaceholder" src/app/entries/app.js`
Expected: only the `discover` case, the `default` case (which still serves `#/person/<id>` until Plan 3), and the last line of `meSection`; every Me section (`progress`, `repertoire`, `teaching`, `groups`, `catalog`, `settings`) returns its own screen before that line.

- [ ] **Step 3: Run the full suites**

Run:

```bash
npx supabase migration up --local
npm run test:unit
npm run test:db
npm run test:e2e
```

Expected: all pass. Then open `/app?demo=1` at 390 px wide in a browser and check by hand: the Me slider switches modes, **+** opens the right sheet, the class page marks attendance, and no screen scrolls sideways.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: describe Teaching, Me, and onboarding in /app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
