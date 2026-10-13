# Mobile App Plan 4: Switch-Over to `/app`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/app` the only signed-in app: signing in lands there, `/dashboard` and its old links forward there, and the old dashboard, its views, and its tests are deleted once a test proves nothing is lost. Along the way, fix Plan 1's deferred review findings, show every time in the viewer's time zone, and close the minor findings deferred from Plans 2–3 (spec increment 7, revised by the product owner on 2026-10-13).

**Architecture:** First, a parity audit test acts as a gate: every service call, query parameter, and browser test of the old dashboard must have a home in the new app (built by Plans 1–3) before anything is deleted. The app keeps its page (`app.html`), bundle (`assets/generated/app.js`), service worker (`/app-sw.js`, scope `/app`), and manifest. The app learns the two query links only the old dashboard handled (`member_invite`, `group_link`), generates its own links as `/app?…`, and every sign-in path defaults to `/app`. `dashboard.html` becomes a tiny forwarding page that keeps the query and hash. A module-graph test then lists every source file no page loads, and those files, their tests, their copy, and their stylesheets are removed. Later groups fix times across time zones and the deferred minors, three of them with small forward migrations.

**Tech Stack:** Vanilla ES modules + esbuild (its metafile is used for the module graph), Vitest + jsdom, Playwright, Supabase Postgres + pgTAP, Vercel static hosting with `cleanUrls`.

**Spec:** `docs/superpowers/specs/2026-10-11-mobile-first-app-design.md` (Routes, Installable web app, Implementation Approach, Delivery Increments item 7, Acceptance Criteria). The product owner reversed the spec's direction on 2026-10-13: "I want /app to be the only one we end up with after logging in." Where the spec says `/dashboard` serves the app and `/app` redirects, this plan does the opposite; everything else in the spec stands.

This is plan 4 of 5. Plans 2 (`…-plan-2-teaching-me-onboarding.md`) and 3 (`…-plan-3-discover.md`) are implemented and merged; this plan was checked against `origin/main` at `13a7db4`. Plan 5 (Capacitor) runs afterwards.

## Global Constraints

- **Gate:** if Task 1's parity audit fails on a row owned by Plan 1, 2, or 3, stop and report BLOCKED with the failing rows. Do not build missing screens in this plan.
- Every task leaves `npm run test:unit` and `npm run test:e2e` passing; tasks that touch SQL also leave `npm run test:db` passing.
- Do not modify `tools/` (including `tools/serve.py`), `assets/figure3d.js`, or `assets/moves3d/`. This plan does not modify `index.html` (its sign-in code lives in `src/`, which this plan changes).
- Follow `docs/security-checklist.md`: one-time tokens leave the address bar as soon as the app captures them; the release scan in Task 12 passes on a production build.
- Database: new migrations are `2026102500NN_*.sql` (`01` resources, `02` scheduling, `03` Discover search, `04` coach calendar), sorting after Plan 3's `20261020…` and before Plan 5's `20261030…`. New pgTAP files are `0035`–`0038` (`0030`–`0031` and Plan 5's `0040`+ are taken; run `ls supabase/tests` first). Never edit an applied migration. Apply locally with `npx supabase migration up --local`, never `supabase db reset` (the local database is shared with the main checkout). Every function follows the `private.*` security-definer + `set search_path = ''` + `public` `language sql` wrapper pattern, revoked from `public, anon, authenticated` and granted to `authenticated`.
- English copy in American spelling; every new `en` key in `src/app/dashboard-i18n.js` has a `pt` key (Portugal Portuguese, "tu" form), and keys used only by deleted code are removed from both.
- All routes are hash routes under `/app` exactly as listed in the spec's Routes table.
- No new runtime dependencies.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Rulings

Decisions the spec or the product owner left open, made here so tasks do not re-decide them. Rulings marked **(changed 2026-10-13)** replace the previous draft's `/dashboard` direction; the previous Rulings 3 and 4 (moving the service worker and manifest to `/dashboard`) are withdrawn.

- **Ruling 1 — `/app` is the only app; `/dashboard` forwards client-side (changed 2026-10-13).** `dashboard.html` becomes a stub that runs `location.replace('/app' + location.search + location.hash)`, with a `<noscript>` refresh. No `vercel.json` redirect: the hash never reaches a server, `tools/serve.py` (unchangeable) cannot redirect, and one mechanism tested by Playwright beats two. `cleanUrls` already serves `dashboard.html` at `/dashboard` and forwards `/dashboard.html` to `/dashboard`. `vercel.json` is unchanged.
- **Ruling 2 — names stay.** The bundle stays `assets/generated/app.js` (entry `app`); the `dashboard` entry is deleted. `src/app/dashboard-i18n.js` and the `roda.dashboard.locale` key keep their names (renaming them is churn with no user-visible effect).
- **Ruling 3 — the installable app does not move (changed 2026-10-13).** The service worker stays `/app-sw.js` with scope `/app`; the manifest keeps `start_url` and `scope` at `/app`. Installed home-screen apps keep working unchanged.
- **Ruling 4 — every sign-in lands on `/app` (changed 2026-10-13).** `signInWithGoogle` and `sendEmailLink` default `next` to `/app`; `sanitizeReturnRoute` falls back to `/app`; the sign-in dialog's Dashboard and Try demo buttons go to `/app` and `/app?demo=1`; the callback page's retry link points to `/app`. A remembered return route from before the deploy (`/dashboard?…`) still works because `/dashboard` forwards.
- **Ruling 5 — invitation and group links.** The app generates `/app?member_invite=…` and `/app?group_link=…` (`inviteLink` in `src/app/screens/group.js`, `discoveryLink` in `src/app/screens/group-owner.js`); links already shared as `/dashboard?…` forward with their query. The signed-out check runs first (so the token survives sign-in through `next=`); then the token leaves the address bar, waits in this tab's `sessionStorage` (`roda.entryLinks`), and opens as a bottom sheet on the first screen that is not `#/welcome`. One link at a time; an invitation wins over a group link.
- **Ruling 6 — sign-out never drops a waiting resource (product owner, 2026-10-12).** Resources are text and save as soon as they are submitted; the local waiting queue stays only as the fallback for a failed save. Sign-out first sends everything in that queue (normally instant) and then signs out. If anything still cannot be sent (offline or an error), sign-out stops, deletes nothing, and shows "N items are still waiting to sync — connect to the internet and try again" with Try again; there is no "discard and sign out". An unsent Log training draft was never submitted, so it is not waiting to sync: it stays on the device for that profile only. A session that merely expires sends and deletes nothing. The old dashboard's `roda.dashboard.mode` and `roda.dashboard.group` keys are removed at startup (explicit sign-out already removes them).
- **Ruling 7 — "How did it go?"** appears for an attended (non-Alone) class in the last 12 hours that has no felt (whole-round) rating, whatever its part ratings — the spec's "without a felt rating". The rule reads `felt`, not `has_rating`.
- **Ruling 8 — invalid calendar URLs.** An impossible month (`#/calendar/2026-13`) becomes `#/calendar` (current month); an impossible day (`#/calendar/2026-02-30`) becomes that month. The address bar is rewritten.
- **Ruling 9 — resource idempotency.** Each resource carries a client key (a UUID made when it is staged, queued, or — on Record a past class — when the page opens, one per kind). The database keeps one resource per person and key; repeating a key returns the first resource; reusing a key on another training fails with `idempotency_conflict`. The five-argument `add_training_resource` is replaced by a six-argument one whose key defaults to null, so a client on the old code keeps working during deploy.
- **Ruling 10 — carried-over capabilities.** The app gains "Save as sequence" on Log training round cards (the composer passes the repertoire to the round editor, like the old Record dialog) and a "Demo · browser only" label in demo mode. The one-time browser repertoire import already runs when Repertoire opens (Plan 2) and is not duplicated at startup.
- **Ruling 11 — dropped on purpose.** The old automatic retry of group data at startup and the "group data unavailable" warning go away (the spec removes the group selector, so startup no longer loads groups); a failed startup still offers Try again. The My Training / Coaching switch, switching between coached groups, and a late arrival's own duration on Finish (the spec records the planned duration) are replaced by Plan 2's screens.
- **Ruling 12 — stopgaps go.** The Plan 1 placeholder screen and Settings' "Open the classic dashboard" link are removed: the `default` route case renders Today, an unknown Me section goes back to Me, and the `app.classic`, `app.comingSoon`, and `app.completeProfile` copy is deleted.
- **Ruling 13 — reused views stay.** The spec removes "the old `src/app/ui/*-view.js` page views". Views the app embeds as components with an injected root — `resource-view.js` (Plan 1) and, per Plan 2's R13, `statistics-view.js`, `repertoire-view.js`, `catalog-view.js` — are no longer page views and stay, with their unit tests and the stylesheet Progress links (`assets/training-statistics.css`). Everything else the dead-code test reports is removed.
- **Ruling 14 — times follow the viewer (new 2026-10-13).** Every time the app shows is in the viewer's time zone (`ctx.timezone`), including the date and time on the training and class pages. When the class's own zone shows a different clock time, those pages add one quiet line such as "07:00 PM in Lisbon" (Portuguese: "19:00 em Lisbon") (the place is the last part of the IANA zone, underscores as spaces; the weekday is added when the day differs). Calendar days still follow each training's recorded local date, as `docs/security-checklist.md` requires.
- **Ruling 15 — the release scan is narrowed, the hook keeps its name.** Demo mode legitimately ships the local fake services, so `__RODA_E2E_EVENTS__` is in production bundles by design; renaming it would only hide it. The scan in `docs/security-checklist.md` and the runbook drops that pattern and keeps the ones that catch real leaks (`service_role`, access tokens, database passwords, `sb_publishable_e2e_test`), and a unit test now runs the documented scan against a production build.
- **Ruling 16 — error messages follow the language.** The safe error messages move into the copy file as `errors.<code>` keys (English unchanged, plus Portuguese); `src/app/errors.js` keeps English as the fallback for pages that never load the app's copy (sign-in, callback).
- **Ruling 17 — scheduling is idempotent per form.** Schedule a class sends one key per open form; editing any field makes a new key, so a timed-out retry of the same class returns the first class, while a changed class is a new one.
- **Ruling 18 — Discover search is capped at 100 characters** on the server by truncating in the public wrapper (no city, person, or group label is longer than 120, and 100 characters is plenty to match one).
- **Ruling 19 — a coach's calendar lists only classes the coach can still open** (`private.can_manage_schedule`), so removed coaches stop seeing their old group's classes.
- **Ruling 20 — a coach can record a class alone.** Record a past class lists the coach ("You") after the members, checked only when the group has no other members; the database already accepts an active coach as an attendee.
- **Ruling 21 — out of scope (deferred again):** retrying Finish with different attendance; "Find on the map" choosing the first geocoder result; welcome step 3 sending empty contacts; a sent request to a non-discoverable group linking to an unavailable card.

## Review Focus

1. **An old `/dashboard` bookmark or a link shared before the switch** (`/dashboard?demo=1#/training/<id>`, `/dashboard?member_invite=…`) — lands on the same screen or sheet under `/app`, signed in or after signing in. Pinned in Task 9 (`app-redirect.spec.js`) and Task 7.
2. **An invitation or unlisted-group link opened while signed out** — survives sign-in, opens once, and the token is gone from the address bar right after capture. Pinned in Task 7.
3. **A coach in Washington opening a Lisbon class** — the page shows the viewer's own clock and date first, with the class's local time as a secondary line, and never mixes the two. Pinned in Task 11.
4. **Signing out while a resource is still waiting to sync** (offline, or a failed save) — the resource is sent first; if it cannot be, the person stays signed in, nothing is deleted, and Try again is the only way forward; an expired session keeps everything. Pinned in Task 6.
5. **A timed-out request retried by a tap** (Save in Log training after a reload, Schedule a class after a timeout) — exactly one resource or class is created. Pinned in Tasks 5 and 14.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `tests/unit/helpers/module-graph.js` | Which `src/` files each page or worker loads (esbuild metafile) |
| `tests/unit/helpers/i18n-usage.js` | Which copy keys no loaded module uses |
| `tests/unit/helpers/worker-harness.js` | Runs a service-worker module in Node with fake caches and fetch |
| `tests/unit/switch-over-parity.test.js` | The parity gate: old service calls, query parameters, browser tests |
| `tests/unit/dead-code.test.js` | Every `src/` file is loaded by some page or worker |
| `tests/unit/i18n-usage.test.js` | Every copy key is used |
| `tests/unit/pages.test.js` | `app.html` is the app, `dashboard.html` forwards, stylesheets are used |
| `tests/unit/release-scan.test.js` | The documented secret scan finds nothing in a production build |
| `src/app/local-data.js` | Count and send waiting resources; remove old dashboard keys |
| `src/app/screens/sign-out.js` | `signOutSafely`: send waiting resources, then sign out or ask to try again |
| `src/app/shell/entry-links.js` | Capture, scrub, and open invitation and group links |
| `src/app/time-display.js` | Viewer-zone date and time, plus the class's own time when it differs |
| `supabase/migrations/202610250001_resource_idempotency.sql` + `supabase/tests/0035_resource_idempotency.test.sql` | Client keys for resources |
| `supabase/migrations/202610250002_schedule_idempotency.sql` + `supabase/tests/0036_schedule_idempotency.test.sql` | Keys for scheduling a class |
| `supabase/migrations/202610250003_discover_search_cap.sql` + `supabase/tests/0037_discover_search_cap.test.sql` | 100-character search cap |
| `supabase/migrations/202610250004_coach_calendar_access.sql` + `supabase/tests/0038_coach_calendar_access.test.sql` | Removed coaches' classes leave the calendar |
| `tests/e2e/app-hardening.spec.js` | Browser tests for the Plan 1 follow-ups |
| `tests/e2e/app-switch-over.spec.js` | Browser tests for carried-over and ported capabilities |
| `tests/e2e/app-redirect.spec.js` | `/dashboard` forwarding |
| `tests/e2e/app-time-zones.spec.js` | A Lisbon class seen from New York |
| `tests/e2e/auth.spec.js` | Renamed from `auth-dashboard.spec.js`, sign-in tests only |

Modified: `scripts/build.mjs`, `dashboard.html` (replaced by a stub), `auth/callback.html`, `assets/app.css`, `src/app/entries/app.js`, `src/app/auth-service.js`, `src/app/return-route.js`, `src/app/entries/public-auth.js`, `src/app/ui/auth-dialog.js`, `src/app/shell/router.js`, `src/app/shell/layout.js`, `src/app/screens/{today-state,log,record-class,resource-queue,me,group,group-owner,training,class,schedule-sheet,discover}.js`, `src/app/ui/{resource-view,statistics-view}.js`, `src/app/sw/{cache-policy,service-worker}.js`, `src/app/training-service.js`, `src/app/testing/fake-services.js`, `src/app/demo-data.js`, `src/app/errors.js`, `src/app/dashboard-i18n.js`, existing unit and browser tests named in each task, `README.md`, `ROADMAP.md`, `docs/auth-and-database-operations.md`, `docs/training-platform-design-decisions.md`, `docs/security-checklist.md`.

Deleted (Tasks 7, 9, 10): `src/app/screens/placeholder.js`, the old browser specs, `src/app/entries/dashboard.js`, the old page views the app does not embed (`dashboard-view`, `coaching-training-view`, `past-class-view`, `profile-view`, `connection-view`, `group-view`, `training-calendar-view`) and `src/app/dashboard-state.js` — the exact list comes from the dead-code test — their unit tests, `assets/dashboard.css`, `assets/training-calendar.css`, and unused copy.

---

### Task 1: Parity audit gate

**Files:**
- Modify: `scripts/build.mjs`
- Create: `tests/unit/helpers/module-graph.js`, `tests/unit/switch-over-parity.test.js`

**Interfaces:**
- Produces (`scripts/build.mjs`): `export const ENTRY_POINTS` — `{ [bundleName]: sourcePath }` for the page bundles; `export const WORKER_ENTRY_POINTS` — `{ [workerFileNameWithoutJs]: sourcePath }`, built to the repository root.
- Produces (`tests/unit/helpers/module-graph.js`): `reachableModules(entryPaths: string[]) → Promise<string[]>` (sorted `src/…` paths), `appModules()` (from `ENTRY_POINTS.app`), `allModules()` (every page and worker entry), `sourceOf(paths) → Promise<Record<path, text>>`.
- Produces (`tests/unit/switch-over-parity.test.js`): the constant `PORTS_DONE` (false until Task 9 flips it).

- [ ] **Step 1: Export the entry points**

In `scripts/build.mjs`, move the `entryPoints` object literal out of `buildBrowserBundles` and build the worker from a second export (keep the separate Leaflet CSS build as it is):

```js
export const ENTRY_POINTS = Object.freeze({
  'public-auth': 'src/app/entries/public-auth.js',
  'auth-callback': 'src/app/entries/auth-callback.js',
  dashboard: 'src/app/entries/dashboard.js',
  app: 'src/app/entries/app.js',
  'public-sequences': 'src/app/entries/public-sequences.js',
});

// Service workers are built to the site root so their scope can cover pages.
export const WORKER_ENTRY_POINTS = Object.freeze({
  'app-sw': 'src/app/sw/service-worker.js',
});
```

Inside `buildBrowserBundles`, use `const entryPoints = ENTRY_POINTS;` and replace the service-worker `build` call with:

```js
  const version = JSON.stringify(String(Date.now()));
  await Promise.all(Object.entries(WORKER_ENTRY_POINTS).map(([name, entry]) => build({
    entryPoints: [entry],
    outfile: `${name}.js`,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: ['es2020'],
    minify: !test,
    legalComments: 'none',
    define: { __RODA_SW_VERSION__: version },
  })));
```

- [ ] **Step 2: Write the module-graph helper**

```js
// tests/unit/helpers/module-graph.js
// Answers "which source files does each page or worker actually load?" with
// esbuild's metafile, so dead-code and parity checks follow real imports.
import { readFile } from 'node:fs/promises';

import { build } from 'esbuild';

import { ENTRY_POINTS, WORKER_ENTRY_POINTS } from '../../../scripts/build.mjs';

const DEFINE = {
  __RODA_E2E__: 'false',
  __RODA_SUPABASE_URL__: '"http://127.0.0.1:54321"',
  __RODA_SUPABASE_PUBLISHABLE_KEY__: '"sb_publishable_graph"',
  __RODA_SW_VERSION__: '"graph"',
};

export async function reachableModules(entryPaths) {
  const result = await build({
    entryPoints: entryPaths,
    bundle: true,
    write: false,
    metafile: true,
    outdir: 'module-graph-out',
    platform: 'browser',
    format: 'esm',
    logLevel: 'silent',
    loader: { '.css': 'empty' },
    define: DEFINE,
  });
  return Object.keys(result.metafile.inputs).filter((path) => path.startsWith('src/')).sort();
}

export function appModules() {
  return reachableModules([ENTRY_POINTS.app]);
}

export function allModules() {
  return reachableModules([...Object.values(ENTRY_POINTS), ...Object.values(WORKER_ENTRY_POINTS)]);
}

export async function sourceOf(paths) {
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await readFile(path, 'utf8')])));
}
```

- [ ] **Step 3: Write the parity audit**

The lists are frozen from the old dashboard (`src/app/entries/dashboard.js`, the old `src/app/ui/*-view.js` page views, and the ten old browser specs) and mapped to the tests that exist on `origin/main` at `13a7db4`. A cover is `'<file> › <exact test title>'`; the file is a browser spec in `tests/e2e/` or, where the behavior is a screen rule, a unit test in `tests/unit/`. Rows marked `plan-4` are delivered by this plan and are only checked once `PORTS_DONE` is true (Task 9).

```js
// tests/unit/switch-over-parity.test.js
// Gate for the switch-over: every capability of the old dashboard must have a
// home in the app before the old code is deleted, and must keep it after.
import { existsSync, readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { appModules, sourceOf } from './helpers/module-graph.js';

// Task 9 flips this once this plan's own ports exist.
const PORTS_DONE = false;
const active = (row) => PORTS_DONE || row.owner !== 'plan-4';

// Method names too common to match without their service's name.
const AMBIGUOUS = new Set(['list', 'save', 'remove', 'end', 'request', 'decide']);
const ALIASES = (service) => [`services\\.${service}`, service, `${service}s`, `${service}Service`];

const call = (owner, name, extra = {}) => ({ owner, call: name, ...extra });

// Every service method the old dashboard called. `replacedBy` accepts the
// app's spec-backed replacement instead of the call itself.
const SERVICE_CALLS = [
  call('plan-1', 'auth.getSession'), call('plan-1', 'auth.onAuthStateChange'), call('plan-1', 'auth.signOut'),
  call('plan-1', 'profile.loadProfile'), call('plan-2', 'profile.loadCoachProfile'),
  call('plan-2', 'profile.completeProfile'), call('plan-2', 'profile.uploadProfilePicture'),
  call('plan-2', 'profile.registerAsCoach', { replacedBy: /usage_?[mM]ode/, why: 'Spec: choosing Both or Teach creates the coach profile.' }),
  call('plan-2', 'group.listMyMemberships'), call('plan-4', 'group.resolveDiscoveryToken'),
  call('plan-4', 'group.acceptInvitation'), call('plan-3', 'group.requestAccess'),
  call('plan-3', 'group.searchGroups', { replacedBy: /discover_?[sS]earch|services\.discover\.search\(/, why: 'Spec: Discover search finds groups.' }),
  call('plan-2', 'group.createGroup'), call('plan-2', 'group.updateGroup'),
  call('plan-2', 'group.setGroupTimezone', { replacedBy: /\.updateGroup\(/, why: 'update_group takes the timezone since 202609220001.' }),
  call('plan-2', 'group.archiveGroup'), call('plan-2', 'group.transferOwnership'), call('plan-2', 'group.listRoster'),
  call('plan-2', 'group.removeMember'), call('plan-2', 'group.listJoinRequests'), call('plan-2', 'group.decideJoinRequest'),
  call('plan-2', 'group.createInvitation'), call('plan-2', 'group.rotateDiscoveryLink'), call('plan-2', 'group.revokeDiscoveryLink'),
  call('plan-2', 'group.listRelationships'), call('plan-2', 'group.inviteChildGroup'), call('plan-2', 'group.decideRelationship'),
  call('plan-2', 'group.setRelationshipSharing'), call('plan-2', 'group.revokeRelationship'),
  call('plan-2', 'connection.listMine'), call('plan-2', 'connection.searchCandidates'), call('plan-2', 'connection.request'),
  call('plan-2', 'connection.decide'), call('plan-2', 'connection.end'),
  call('plan-1', 'training.createIdempotencyKey'), call('plan-1', 'training.recordAloneTraining'),
  call('plan-1', 'training.listCalendar'),
  call('plan-1', 'training.listResourceKinds', { replacedBy: /resource_kinds/, why: 'list_my_calendar returns resource_kinds.' }),
  call('plan-1', 'training.saveNotes'), call('plan-1', 'training.saveRoundAssessments'), call('plan-1', 'training.addResource'),
  call('plan-1', 'training.getDay', { replacedBy: /\.getTraining\(/, why: 'Spec: a day sheet lists items that open the training page.' }),
  call('plan-2', 'training.addFeedback'), call('plan-2', 'training.listPlans'), call('plan-2', 'training.createPlan'),
  call('plan-2', 'training.savePlanDraft'), call('plan-2', 'training.publishPlan'), call('plan-2', 'training.scheduleGroupTraining'),
  call('plan-2', 'training.schedulePersonalClass'), call('plan-2', 'training.completeGroupTraining'),
  call('plan-2', 'training.completePersonalClass'), call('plan-2', 'training.recordPastClass'),
  call('plan-2', 'statistics.getPersonal'), call('plan-2', 'statistics.getGroup'), call('plan-2', 'statistics.searchMembers'),
  call('plan-1', 'repertoire.list'), call('plan-2', 'repertoire.save'), call('plan-2', 'repertoire.remove'),
  call('plan-2', 'repertoire.importItems'),
  call('plan-1', 'catalog.amICurator'), call('plan-1', 'catalog.listTermMappings'), call('plan-2', 'catalog.listUncataloguedTerms'),
  call('plan-2', 'catalog.mapTerm'), call('plan-2', 'catalog.mergeTerm'), call('plan-2', 'catalog.ignoreTerm'),
  call('plan-2', 'catalog.setNeedsVideo'),
];

// Query parameters the old dashboard accepted.
const URL_INPUTS = [
  { param: 'demo', owner: 'plan-1' },
  { param: 'member_invite', owner: 'plan-4' },
  { param: 'group_link', owner: 'plan-4' },
];

// Old views the app embeds as components with an injected root.
const REUSED_VIEWS = Object.freeze([
  'src/app/ui/catalog-view.js', 'src/app/ui/repertoire-view.js', 'src/app/ui/resource-view.js', 'src/app/ui/statistics-view.js',
]);

const OLD_SPECS = [
  'auth-dashboard.spec.js', 'training-calendar.spec.js', 'training-resources.spec.js', 'repertoire.spec.js',
  'catalog-curation.spec.js', 'coaching-training.spec.js', 'past-class.spec.js', 'training-statistics.spec.js',
  'coaching-connections.spec.js', 'group-flows.spec.js',
];

const covered = (owner) => (old, ...covers) => ({ old, owner, covers });
const plan1 = covered('plan-1');
const plan2 = covered('plan-2');
const plan3 = covered('plan-3');
const here = covered('plan-4');
const dropped = (old, why) => ({ old, owner: 'spec', dropped: why });

// Every old browser test and the test(s) that cover its behavior now.
const BROWSER_TESTS = [
  here('auth-dashboard.spec.js › keeps the movement library usable around one Google-first sign-in dialog',
    'auth.spec.js › keeps the movement library usable around one Google-first sign-in dialog'),
  here('auth-dashboard.spec.js › offers passwordless email as the secondary sign-in method',
    'auth.spec.js › offers passwordless email as the secondary sign-in method'),
  here('auth-dashboard.spec.js › opens a seeded browser-only demo without an account',
    'auth.spec.js › opens a seeded browser-only demo without an account'),
  here('auth-dashboard.spec.js › uses a compact calendar beside details on desktop and stacked on mobile',
    'app-switch-over.spec.js › Calendar fits a phone and sits beside the training on desktop'),
  here('auth-dashboard.spec.js › shows Entrar only while Portuguese is selected',
    'auth.spec.js › shows Entrar only while Portuguese is selected'),
  here('auth-dashboard.spec.js › uses the same entry as a dashboard action for a signed-in account',
    'auth.spec.js › uses the same entry as a dashboard action for a signed-in account'),
  here('auth-dashboard.spec.js › exchanges a callback once and returns to a safe local destination',
    'auth.spec.js › exchanges a callback once and returns to a safe local destination'),
  here('auth-dashboard.spec.js › scrubs callback data and exposes only safe retry routes on failure',
    'auth.spec.js › scrubs callback data and exposes only safe retry routes on failure'),
  here('auth-dashboard.spec.js › returns unauthenticated dashboard visits to the unified sign-in destination',
    'auth.spec.js › returns unauthenticated dashboard visits to the unified sign-in destination'),
  here('auth-dashboard.spec.js › retries one transient dashboard data failure automatically',
    'app-switch-over.spec.js › a failed startup offers Try again and then opens Today'),
  dropped('auth-dashboard.spec.js › keeps personal training available when group data remains unavailable',
    'Spec "Things that move": the group selector is removed, so startup no longer loads groups.'),
  here('auth-dashboard.spec.js › replaces a failed profile startup with a recoverable error',
    'app-switch-over.spec.js › a failed startup offers Try again and then opens Today'),
  plan2('auth-dashboard.spec.js › previews the profile picture in its circular crop before saving',
    'welcome-screen.test.js › keeps the answers and never uploads the same photo twice after a failure'),
  plan2('auth-dashboard.spec.js › completes the practitioner profile with an optional automatic timezone',
    'app-welcome.spec.js › a new person sets name and mode, then lands on Today',
    'me-screen.test.js › saves the profile from Settings'),
  plan2('auth-dashboard.spec.js › uses a binary mode switch and extends a practitioner through coach registration',
    'app-mode.spec.js › the mode changes + and Teaching in Me without removing coaching'),
  plan1('auth-dashboard.spec.js › keeps a coach in My Training by default and clears private UI on expiry',
    'app-navigation.spec.js › a session that ends while the app is open goes to sign-in'),
  here('auth-dashboard.spec.js › signs out from the dashboard and removes persisted private state',
    'app-hardening.spec.js › signing out sends waiting resources first',
    'app-hardening.spec.js › signing out offline keeps waiting resources and asks to try again'),
  plan2('auth-dashboard.spec.js › keeps private feature workspaces blocked behind required profile completion',
    'app-access.spec.js › finished profiles never see the welcome, unfinished ones always do'),
  plan2('auth-dashboard.spec.js › localizes dashboard modes, tabs, and coach planning in Portuguese',
    'app-shell.spec.js › shows the navigation and moves between destinations',
    'dashboard-i18n.test.js › keeps English and Portuguese translation catalogs structurally complete'),
  plan1('training-calendar.spec.js › records Alone training and opens its calendar details',
    'app-log.spec.js › logs a training from the chat box and opens it',
    'app-calendar.spec.js › Calendar shows the full month and opens a day'),
  here('training-calendar.spec.js › preserves a failed form and retries without duplicate participation',
    'app-switch-over.spec.js › a failed save keeps the composer and a retry records one training'),
  here('training-calendar.spec.js › localizes the calendar action in Portuguese',
    'app-switch-over.spec.js › Calendar speaks Portuguese'),
  here('training-calendar.spec.js › keeps the calendar inside a mobile viewport',
    'app-switch-over.spec.js › Calendar fits a phone and sits beside the training on desktop'),
  here('training-calendar.spec.js › rates a round and a transition from the day detail',
    'app-switch-over.spec.js › rates a round and a transition from the training page'),
  here('training-calendar.spec.js › records a round typed with an unknown move and shows it as new',
    'app-switch-over.spec.js › marks an unknown move as new and records it'),
  here('training-resources.spec.js › adds a video link and a summary file to Alone training',
    'app-log.spec.js › logs a training from the chat box and opens it',
    'app-switch-over.spec.js › adds a summary file from the training page'),
  here('repertoire.spec.js › imports browser sequences once and logs one as training',
    'app-switch-over.spec.js › imports browser sequences once and logs one from Repertoire'),
  here('repertoire.spec.js › saves a round as a sequence from Record training',
    'app-switch-over.spec.js › saves a round as a sequence from Log training'),
  plan2('catalog-curation.spec.js › hides the Catalog tab from non-curators',
    'app-me-pages.spec.js › Progress and Repertoire open from Me, and Catalog is for curators only'),
  plan2('catalog-curation.spec.js › a curator maps a term and the parser recognizes it next time',
    'app-me-pages.spec.js › curators open the Catalog from Me',
    'me-subpages.test.js › lets curators handle uncatalogued words and refreshes recognition'),
  plan2('coaching-training.spec.js › creates and publishes a plan, then schedules a hidden group training',
    'app-teaching.spec.js › a coach writes and publishes a plan, then schedules it'),
  plan2('coaching-training.spec.js › schedules direct and group-derived personal classes with the right authorization context',
    'app-coach-calendar.spec.js › Calendar shows a personal class the coach arranged and opens its class page',
    'student-screen.test.js › schedules for this student and ends coaching after a second tap'),
  plan2('coaching-training.spec.js › does not expose coach scheduling controls to an unregistered practitioner',
    'app-access.spec.js › Teaching sends Train people without coaching back to Me'),
  plan2('coaching-training.spec.js › confirms only attendees, preserves a late-arrival duration, and retries without duplicates',
    'app-class.spec.js › a coach finishes a class from Today with tap-to-mark attendance',
    'class-screen.test.js › shows the plan and finishes once for the people marked here'),
  plan2('coaching-training.spec.js › adds feedback in an authorized context and clears student detail after revocation',
    'app-teaching.spec.js › a coach opens a student and leaves feedback on a training',
    'student-screen.test.js › explains a person who is not my student'),
  plan2('past-class.spec.js › a coach records a past group class with a video link',
    'app-mode.spec.js › a coach records a past class from +'),
  plan2('training-statistics.spec.js › shows personal totals, all selectors, group ranking, pinning, and privacy',
    'statistics-view.test.js › renders a podium, complete ranking, pinned current member, and privacy note',
    'me-subpages.test.js › shows personal statistics and the ranking of the chosen group'),
  plan2('training-statistics.spec.js › localizes statistics in Portuguese',
    'statistics-view.test.js › clears group details when access is revoked and localizes Portuguese copy'),
  plan2('training-statistics.spec.js › stacks the podium within a mobile viewport',
    'app-layout.spec.js › Progress shows its stat cards two per row on a phone'),
  plan2('coaching-connections.spec.js › requests, accepts, and ends a direct coaching connection',
    'app-groups.spec.js › a student asks a coach to coach them',
    'teaching-screen.test.js › accepts a student request and finds a student to coach',
    'groups-screen.test.js › ends coaching with a coach after a second tap'),
  plan2('coaching-connections.spec.js › renders the connection experience in Portuguese',
    'dashboard-i18n.test.js › keeps English and Portuguese translation catalogs structurally complete'),
  plan3('group-flows.spec.js › searches groups, requests member access, and resolves an unlisted link',
    'app-discover.spec.js › opens a group card from search and asks to join'),
  here('group-flows.spec.js › searches groups, requests member access, and resolves an unlisted link',
    'app-switch-over.spec.js › opens an unlisted group link and requests access'),
  plan2('group-flows.spec.js › registers coaching, requests coach access, and creates a group',
    'app-groups.spec.js › a coach creates a group and opens it'),
  plan2('group-flows.spec.js › lets a direct coach approve members, remove members, and create shareable invitations',
    'app-groups.spec.js › a coach invites a student from the group page',
    'group-screen.test.js › lets a coach invite, answer requests, and remove members'),
  plan2('group-flows.spec.js › lets an owner manage coach access and immediate-parent sharing',
    'group-screen.test.js › invites a child group and saves what the parent sees'),
  here('group-flows.spec.js › retains a member invitation through sign-in and explains terminal invitation states',
    'app-switch-over.spec.js › keeps a member invitation through sign-in and explains used links'),
  plan2('group-flows.spec.js › switches between coached groups and clears a group after access is revoked',
    'group-screen.test.js › explains a group I am not in'),
  plan2('group-flows.spec.js › lets a child owner decide a parent invitation and surfaces hierarchy conflicts',
    'group-screen.test.js › gives owners a discovery link, transfer, hierarchy answers, and archive'),
  plan2('group-flows.spec.js › lets an owner rotate discovery links and transfer ownership to an active coach',
    'app-groups.spec.js › an owner creates a discovery link for the group',
    'group-screen.test.js › gives owners a discovery link, transfer, hierarchy answers, and archive'),
  plan2('group-flows.spec.js › lets an owner edit and archive a group',
    'group-screen.test.js › gives owners a discovery link, transfer, hierarchy answers, and archive'),
];

// Modules whose own job is the call (services, fakes, copy) do not count as a use.
const NOT_A_USE = [
  /^src\/app\/[a-z-]+-service\.js$/, /^src\/app\/testing\//, /^src\/app\/supabase-client\.js$/, /^src\/app\/dashboard-i18n\.js$/,
];

async function appCorpus() {
  const modules = (await appModules()).filter((path) => !NOT_A_USE.some((pattern) => pattern.test(path)));
  return Object.values(await sourceOf(modules)).join('\n');
}

function callPattern(name) {
  const [service, method] = name.split('.');
  return AMBIGUOUS.has(method)
    ? new RegExp(`\\b(?:${ALIASES(service).join('|')})\\.${method}(?:\\?\\.)?\\(`)
    : new RegExp(`\\.${method}(?:\\?\\.)?\\(`);
}

function testTitles(file) {
  const path = file.endsWith('.spec.js') ? `tests/e2e/${file}` : `tests/unit/${file}`;
  if (!existsSync(path)) return [];
  const pattern = /^\s*(?:test|it)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/gm;
  return [...readFileSync(path, 'utf8').matchAll(pattern)].map((match) => match[2].replace(/\\(.)/g, '$1'));
}

describe('switch-over parity audit', () => {
  it('keeps every old dashboard service call in use by the app', async () => {
    const text = await appCorpus();
    const missing = SERVICE_CALLS.filter(active)
      .filter((row) => !callPattern(row.call).test(text) && !(row.replacedBy && row.replacedBy.test(text)));
    expect(missing.map(({ call: name, owner }) => `${name} (${owner})`)).toEqual([]);
  });

  it('reads every query parameter the old dashboard accepted', async () => {
    const text = await appCorpus();
    const missing = URL_INPUTS.filter(active).filter(({ param }) => !text.includes(`'${param}'`));
    expect(missing.map(({ param, owner }) => `${param} (${owner})`)).toEqual([]);
  });

  it.runIf(PORTS_DONE)('has no stopgap screens or links to the classic dashboard', async () => {
    expect(await appModules()).not.toContain('src/app/screens/placeholder.js');
    const text = await appCorpus();
    for (const key of ['app.classic', 'app.comingSoon', 'app.completeProfile']) expect(text).not.toContain(`'${key}'`);
    expect(text).not.toMatch(/['"`]\/dashboard/);
  });

  it('loads no old page view except those reused as components', async () => {
    const views = (await appModules()).filter((path) => /^src\/app\/ui\/.+-view\.js$/.test(path));
    expect(views.filter((path) => !REUSED_VIEWS.includes(path))).toEqual([]);
  });

  it('lists every test of the old browser specs that still exist', () => {
    const listed = new Set(BROWSER_TESTS.map(({ old }) => old));
    const unlisted = OLD_SPECS.flatMap((file) => testTitles(file).map((title) => `${file} › ${title}`))
      .filter((old) => !listed.has(old));
    expect(unlisted).toEqual([]);
  });

  it('covers every old browser test with a new one or a spec-backed drop', () => {
    const problems = [];
    for (const row of BROWSER_TESTS.filter(active)) {
      if (row.dropped) continue;
      if (!row.covers.length) problems.push(`${row.old}: no covering test (${row.owner})`);
      for (const target of row.covers) {
        const [file, title] = target.split(' › ');
        if (!testTitles(file).includes(title)) problems.push(`${row.old}: missing ${target}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it.runIf(PORTS_DONE)('keeps only app, sign-in, and public browser specs', () => {
    const stray = readdirSync('tests/e2e').filter((file) => file.endsWith('.spec.js')
      && !/^(app-.+|auth|public-sequences)\.spec\.js$/.test(file));
    expect(stray).toEqual([]);
  });
});
```

- [ ] **Step 4: Run the audit — pass or stop**

Run: `npx vitest run tests/unit/switch-over-parity.test.js`
Expected: PASS. Rows owned by `plan-4` (the sign-in specs, the ports, `acceptInvitation`, `resolveDiscoveryToken`, `member_invite`, `group_link`, the stopgaps) are skipped until Task 9.

If anything owned by `plan-1`, `plan-2`, or `plan-3` fails (a service call nobody makes, a cover whose test title no longer exists, an old `*-view.js` loaded that is not in `REUSED_VIEWS`), first check whether a test was merely renamed: if so, update the row to the new exact title. If the behavior itself has no test or no code, **stop** and report BLOCKED with the failing lines. If a call exists in the app under a variable name `ALIASES` does not list, extend `ALIASES`; never add `replacedBy` or `dropped` to make a row pass.

- [ ] **Step 5: Run the unit suite**

Run: `npm run test:unit`
Expected: PASS (including `tests/unit/build-config.test.js`, which still builds the worker to `app-sw.js`).

- [ ] **Step 6: Commit**

```bash
git add scripts/build.mjs tests/unit/helpers/module-graph.js tests/unit/switch-over-parity.test.js
git commit -m "test: gate the switch-over on a parity audit of the old dashboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Group A — Plan 1 follow-ups

Tasks 2–6 fix the minor findings deferred from Plan 1's review. None of them is made moot by the switch to `/app`.

### Task 2: Calendar URL fallback and the "How did it go?" rule

**Files:**
- Modify: `src/app/shell/router.js`, `src/app/screens/today-state.js`
- Test: `tests/unit/router.test.js`, `tests/unit/today-state.test.js`, `tests/e2e/app-hardening.spec.js` (create)

**Interfaces:**
- Produces: `parseRoute(hash)` returns, for an impossible calendar month, `{ name: 'calendar', path: '/calendar', params: { month: null, day: null }, query, redirected: true }`, and for an impossible day `{ name: 'calendar', path: '/calendar/<yyyy-mm>', params: { month, day: null }, query, redirected: true }`. The router rewrites the hash to `#<route.path>` for any redirected route.
- Produces: `nowNextCard` returns `{ type: 'rate' }` for a qualifying class whose `felt` is null, whatever `has_rating` says.

- [ ] **Step 1: Write the failing unit tests**

Add to `tests/unit/router.test.js` inside `describe('router', …)`:

```js
  it.each([
    ['#/calendar/2026-13', '/calendar', { month: null, day: null }],
    ['#/calendar/2026-00', '/calendar', { month: null, day: null }],
    ['#/calendar/2026-02-30', '/calendar/2026-02', { month: '2026-02', day: null }],
    ['#/calendar/2026-10-00', '/calendar/2026-10', { month: '2026-10', day: null }],
  ])('turns the impossible calendar date %s into %s', (hash, path, params) => {
    expect(parseRoute(hash)).toMatchObject({ name: 'calendar', path, params, redirected: true });
  });

  it('keeps possible calendar dates as they are', () => {
    const route = parseRoute('#/calendar/2028-02-29');
    expect(route).toMatchObject({ name: 'calendar', path: '/calendar/2028-02-29', params: { month: '2028-02', day: '29' } });
    expect(route.redirected).toBeUndefined();
  });

  it('rewrites an impossible calendar hash to the screen it shows', () => {
    window.location.hash = '#/calendar/2026-13';
    const onRoute = vi.fn();
    const router = createRouter({ window, onRoute });
    router.start();
    expect(window.location.hash).toBe('#/calendar');
    expect(onRoute).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'calendar', params: { month: null, day: null } }));
    router.stop();
  });
```

In `tests/unit/today-state.test.js`, replace the test `'asks how a recent class went when it is not rated'` with:

```js
  it('asks how a recent class went until it has a felt rating', () => {
    const training = { occurrence_id: 'o1', role: 'participant', kind: 'group', occurred_at: '2026-10-11T10:00:00Z', has_rating: false, felt: null };
    expect(nowNextCard({ calendarItems: [], recent: [training], profileId: 'me', now })).toEqual({ type: 'rate', training });
    const partsOnly = { ...training, has_rating: true };
    expect(nowNextCard({ calendarItems: [], recent: [partsOnly], profileId: 'me', now })).toEqual({ type: 'rate', training: partsOnly });
    expect(nowNextCard({ calendarItems: [], recent: [{ ...training, has_rating: true, felt: 'okay' }], profileId: 'me', now })).toBeNull();
    expect(nowNextCard({ calendarItems: [], recent: [{ ...training, kind: 'alone' }], profileId: 'me', now })).toBeNull();
  });
```

- [ ] **Step 2: Write the failing browser test**

```js
// tests/e2e/app-hardening.spec.js
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

test('an impossible calendar month opens the current month', async ({ page }) => {
  await page.goto('/app#/calendar/2026-13');
  await expect(page.getByRole('heading', { name: 'October 2026' })).toBeVisible();
  await expect(page).toHaveURL(/#\/calendar$/);
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/unit/router.test.js tests/unit/today-state.test.js && npm run build:test && npx playwright test tests/e2e/app-hardening.spec.js`
Expected: FAIL — the router returns `month: '2026-13'`, `partsOnly` returns `null`, and the browser test times out on "Loading…".

- [ ] **Step 4: Implement**

In `src/app/shell/router.js`, add above `parseRoute`:

```js
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function daysIn(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

// A hand-edited calendar URL falls back to a date that exists instead of
// leaving the screen stuck while it tries to draw an impossible month.
function checkCalendar(route) {
  const { month, day } = route.params;
  if (month && !MONTH.test(month)) {
    return { ...route, path: '/calendar', params: { month: null, day: null }, redirected: true };
  }
  if (day && (Number(day) < 1 || Number(day) > daysIn(month))) {
    return { ...route, path: `/calendar/${month}`, params: { month, day: null }, redirected: true };
  }
  return route;
}
```

In `parseRoute`, change the matched-route return to pass calendar routes through it:

```js
    if (match) {
      const route = { name, path, params: Object.fromEntries(keys.map((key, index) => [key, match[index + 1] ?? null])), query };
      return name === 'calendar' ? checkCalendar(route) : route;
    }
```

In `createRouter`'s `handle()`, rewrite to the redirected route's own path:

```js
  function handle() {
    const route = parseRoute(window.location.hash);
    if (route.redirected && window.location.hash && window.location.hash !== `#${route.path}`) {
      window.history.replaceState(null, '', `#${route.path}`);
    }
    onRoute(route);
  }
```

In `src/app/screens/today-state.js`, in the `rate()` card of `nowNextCard`, replace `&& !entry.has_rating &&` with `&& !entry.felt &&`.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run tests/unit/router.test.js tests/unit/today-state.test.js && npx playwright test tests/e2e/app-hardening.spec.js`
Expected: PASS.

- [ ] **Step 6: Run the suites**

Run: `npm run test:unit && npm run test:e2e`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/shell/router.js src/app/screens/today-state.js tests/unit/router.test.js tests/unit/today-state.test.js tests/e2e/app-hardening.spec.js
git commit -m "fix: open a real month for impossible calendar links and ask How did it go until a class is felt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The service worker caches only good responses

**Files:**
- Modify: `src/app/sw/cache-policy.js`, `src/app/sw/service-worker.js`
- Create: `tests/unit/helpers/worker-harness.js`
- Test: `tests/unit/cache-policy.test.js`, `tests/unit/service-worker.test.js` (create)

**Interfaces:**
- Produces (`cache-policy.js`): `SHELL_PATH = '/app'`, `shouldCache(response) → boolean` (true only for `ok` and not `redirected`).
- Produces (`tests/unit/helpers/worker-harness.js`): `loadWorker(load: () => Promise<module>, { cacheKeys }) → { handlers, cache, cacheStorage, stored, fetchMock, self }`, `respond(handlers, request) → Promise<Response> | undefined`, `lifecycle(handlers, 'install' | 'activate') → Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/cache-policy.test.js` (and add `shouldCache` to its import):

```js
  it.each([
    [{ ok: true, redirected: false, status: 200 }, true],
    [{ ok: false, redirected: false, status: 404 }, false],
    [{ ok: false, redirected: false, status: 503 }, false],
    [{ ok: true, redirected: true, status: 200 }, false],
    [{ ok: false, redirected: false, status: 0, type: 'opaqueredirect' }, false],
    [undefined, false],
  ])('caches %o: %s', (response, expected) => {
    expect(shouldCache(response)).toBe(expected);
  });
```

```js
// tests/unit/helpers/worker-harness.js
// Runs a service-worker module in Node with fake caches, fetch, and self.
// `load` is a literal dynamic import from the test file, for example
// `() => import('../../src/app/sw/service-worker.js')`.
import { vi } from 'vitest';

export const ORIGIN = 'https://roda.fyi';

export async function loadWorker(load, { cacheKeys = [] } = {}) {
  vi.resetModules();
  const handlers = {};
  const stored = new Map();
  const keyOf = (key) => (typeof key === 'string' ? key : key.url);
  const cache = {
    put: vi.fn(async (key, response) => { stored.set(keyOf(key), response); }),
    match: vi.fn(async (key) => stored.get(keyOf(key))),
    addAll: vi.fn(async () => {}),
  };
  const cacheStorage = {
    open: vi.fn(async () => cache),
    match: vi.fn(async (key) => stored.get(keyOf(key))),
    keys: vi.fn(async () => cacheKeys),
    delete: vi.fn(async () => true),
  };
  const fetchMock = vi.fn();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, handler) => { handlers[type] = handler; },
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
    registration: { unregister: vi.fn(async () => true) },
  };
  vi.stubGlobal('__RODA_SW_VERSION__', 'test');
  vi.stubGlobal('caches', cacheStorage);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('self', self);
  await load();
  return { handlers, cache, cacheStorage, stored, fetchMock, self };
}

export async function respond(handlers, request) {
  let answer;
  handlers.fetch({ request, respondWith: (promise) => { answer = promise; } });
  return answer;
}

export async function lifecycle(handlers, type) {
  let done;
  handlers[type]({ waitUntil: (promise) => { done = promise; } });
  await done;
}
```

```js
// tests/unit/service-worker.test.js
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SHELL_PATH } from '../../src/app/sw/cache-policy.js';
import { ORIGIN, lifecycle, loadWorker as load, respond } from './helpers/worker-harness.js';

const loadWorker = (options) => load(() => import('../../src/app/sw/service-worker.js'), options);
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const navigation = (path) => ({ url: `${ORIGIN}${path}`, method: 'GET', mode: 'navigate' });

afterEach(() => { vi.unstubAllGlobals(); });

describe('service worker', () => {
  it('starts and claims its pages', async () => {
    const worker = await loadWorker();
    await lifecycle(worker.handlers, 'activate');
    expect(worker.self.clients.claim).toHaveBeenCalled();
  });

  it('keeps a good app page for offline use', async () => {
    const worker = await loadWorker();
    worker.fetchMock.mockResolvedValue(new Response('<html>ok</html>', { status: 200 }));
    const response = await respond(worker.handlers, navigation(SHELL_PATH));
    expect(response.status).toBe(200);
    await settle();
    expect(worker.cache.put).toHaveBeenCalledWith(SHELL_PATH, expect.anything());
  });

  it.each([
    ['a server error', () => new Response('down', { status: 503 })],
    ['a missing page', () => new Response('gone', { status: 404 })],
    ['a redirected page', () => ({ ok: true, status: 200, redirected: true, clone() { return this; } })],
  ])('never keeps %s as the app page', async (_label, makeResponse) => {
    const worker = await loadWorker();
    worker.fetchMock.mockResolvedValue(makeResponse());
    await respond(worker.handlers, navigation(SHELL_PATH));
    await settle();
    expect(worker.cache.put).not.toHaveBeenCalled();
  });

  it('serves the kept app page when the network is down', async () => {
    const worker = await loadWorker();
    worker.stored.set(SHELL_PATH, new Response('<html>kept</html>', { status: 200 }));
    worker.fetchMock.mockRejectedValue(new TypeError('offline'));
    const response = await respond(worker.handlers, navigation(SHELL_PATH));
    expect(await response.text()).toBe('<html>kept</html>');
  });

  it('never keeps a failed file', async () => {
    const worker = await loadWorker();
    worker.fetchMock.mockResolvedValue(new Response('missing', { status: 404 }));
    await respond(worker.handlers, { url: `${ORIGIN}/assets/app.css`, method: 'GET', mode: 'cors' });
    await settle();
    expect(worker.cache.put).not.toHaveBeenCalled();
  });

  it('leaves data requests to the network', async () => {
    const worker = await loadWorker();
    expect(await respond(worker.handlers, { url: 'https://example.supabase.co/rest/v1/rpc/get_training', method: 'POST', mode: 'cors' })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/cache-policy.test.js tests/unit/service-worker.test.js`
Expected: FAIL — `shouldCache` and `SHELL_PATH` are not exported, and the 503, 404, and redirected pages are cached.

- [ ] **Step 3: Implement**

In `src/app/sw/cache-policy.js`, add near the top and use `SHELL_PATH` for the first `APP_SHELL` entry (keep the other entries, including Plan 2's `training-statistics.css` and Plan 3's `leaflet.css`) and in `strategyFor`'s navigation check:

```js
// The page the worker keeps for offline use.
export const SHELL_PATH = '/app';

// Only a good, direct answer may become something served offline later.
export function shouldCache(response) {
  return Boolean(response?.ok) && !response.redirected;
}
```

```js
  if (mode === 'navigate') return target.pathname === SHELL_PATH ? 'network-first' : 'bypass';
```

In `src/app/sw/service-worker.js`, import `SHELL_PATH` and `shouldCache` and replace both caching branches:

```js
  if (strategy === 'network-first') {
    event.respondWith(fetch(request)
      .then((response) => {
        if (shouldCache(response)) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(SHELL_PATH, copy));
        }
        return response;
      })
      .catch(() => caches.match(SHELL_PATH)));
    return;
  }
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(request);
    const network = fetch(request).then((response) => {
      if (shouldCache(response)) cache.put(request, response.clone());
      return response;
    }).catch(() => cached);
    return cached ?? network;
  }));
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/unit/cache-policy.test.js tests/unit/service-worker.test.js`
Expected: PASS.

- [ ] **Step 5: Run the unit suite and build**

Run: `npm run test:unit && npm run build:test`
Expected: PASS, and `app-sw.js` is rebuilt.

- [ ] **Step 6: Commit**

```bash
git add src/app/sw tests/unit/helpers/worker-harness.js tests/unit/cache-policy.test.js tests/unit/service-worker.test.js
git commit -m "fix: keep only good responses in the app's offline cache

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Very long words wrap on phones

**Files:**
- Modify: `assets/app.css`
- Test: `tests/unit/app-css.test.js`, `tests/e2e/app-hardening.spec.js`

**Interfaces:**
- Consumes: the `app-hardening.spec.js` setup from Task 2.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/app-css.test.js`:

```js
  it('wraps very long words instead of widening the page', async () => {
    const css = await readFile('assets/app.css', 'utf8');
    expect(css).toMatch(/\.screen,\s*\.sheet\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });
```

Add to `tests/e2e/app-hardening.spec.js`:

```js
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

test('very long words wrap instead of widening the page', async ({ page }) => {
  const word = 'a'.repeat(160);
  await page.goto('/app#/log');
  const box = page.getByLabel('Write a round');
  await box.fill(`ginga ${word}`);
  await box.press('Enter');
  await expect(page.locator('textarea[data-round-text]')).toHaveCount(1);
  expect(await sideways(page)).toBe(false);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/training\//);
  await expect(page.locator('.chapter')).toHaveCount(1);
  expect(await sideways(page)).toBe(false);
  await page.goto('/app#/');
  await expect(page.locator('.recent-card').first()).toBeVisible();
  expect(await sideways(page)).toBe(false);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/app-css.test.js && npx playwright test tests/e2e/app-hardening.spec.js -g "long words"`
Expected: the CSS test FAILS; the browser test FAILS in `chromium-mobile` (the unknown-move chip and the chapter stretch the page past 390 px).

- [ ] **Step 3: Implement**

Append to `assets/app.css`:

```css
/* Long unbroken words (pasted links, typos) wrap instead of widening the page. */
.screen, .sheet { overflow-wrap: anywhere; }
.chapter-text, .recent-card, .round-card, .day-item, .round-chip, .segment, .chip, .tag { min-width: 0; max-width: 100%; }
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/unit/app-css.test.js && npm run build:test && npx playwright test tests/e2e/app-hardening.spec.js`
Expected: PASS in both projects.

- [ ] **Step 5: Commit**

```bash
git add assets/app.css tests/unit/app-css.test.js tests/e2e/app-hardening.spec.js
git commit -m "fix: wrap very long words so phone screens never scroll sideways

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Adding a resource twice keeps one

**Files:**
- Create: `supabase/migrations/202610250001_resource_idempotency.sql`, `supabase/tests/0035_resource_idempotency.test.sql`
- Modify: `src/app/training-service.js`, `src/app/testing/fake-services.js`, `src/app/errors.js`, `src/app/screens/log.js`, `src/app/screens/resource-queue.js`, `src/app/screens/record-class.js`, `src/app/ui/resource-view.js`
- Test: `tests/unit/training-service.test.js`, `tests/unit/log-screen.test.js`, `tests/unit/resource-queue.test.js`, `tests/unit/record-class.test.js`, `tests/unit/resource-view.test.js`, `tests/unit/errors.test.js`, `tests/e2e/app-hardening.spec.js`

**Interfaces:**
- Produces (SQL): `public.add_training_resource(occurrence_id uuid, kind text, title text, url text, body text, client_key uuid default null) → jsonb { status: 'saved', resource_id }`; repeating `(caller, client_key)` returns the first `resource_id`; the same key on another training raises `P0001 idempotency_conflict`. The five-argument function is dropped.
- Produces (JS, real and fake): `training.addResource({ occurrenceId, kind, title, url, body, clientKey })` sends `client_key: clientKey ?? null`.
- Produces: every resource staged in Log training, sent by `saveResourcesOrQueue`, built by Record a past class, or queued in `createResourceSection` carries `clientKey` (string), also in `roda.logDraft:*` and `roda.pendingResources:*`; queued items saved before this change get a key the first time they are read.

- [ ] **Step 1: Write the failing database test**

Check the next free numbers first: `ls supabase/migrations | tail -3` (the migration must sort last) and `ls supabase/tests | tail -3`.

```sql
-- supabase/tests/0035_resource_idempotency.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_column('public', 'training_resources', 'client_key', 'resources remember their client key');
select has_function('public', 'add_training_resource', array['uuid', 'text', 'text', 'text', 'text', 'uuid']);
select hasnt_function('public', 'add_training_resource', array['uuid', 'text', 'text', 'text', 'text']);

select tests.create_user('10000000-0000-0000-0000-000000003501', 'ana35@example.test', 'Ana Trinta Cinco');
select tests.create_user('10000000-0000-0000-0000-000000003502', 'bia35@example.test', 'Bia Trinta Cinco');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003501');
select public.record_alone_training('2026-10-01', 'Europe/Lisbon', 45, null,
  '[{"source_text":"ginga","movements":[{"movement_key":"ginga","movement_name":"Ginga","segment_key":"m:1"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000003501', '2026-10-01T08:00:00Z') ->> 'occurrence_id' as first_id \gset
select public.record_alone_training('2026-10-02', 'Europe/Lisbon', 45, null,
  '[{"source_text":"ginga","movements":[{"movement_key":"ginga","movement_name":"Ginga","segment_key":"m:1"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000003502', '2026-10-02T08:00:00Z') ->> 'occurrence_id' as second_id \gset

select public.add_training_resource(:'first_id', 'video', 'Recording', 'https://youtu.be/VAI3JUKTwz0', null,
  '60000000-0000-0000-0000-000000003501') ->> 'resource_id' as resource_id \gset
select is(
  public.add_training_resource(:'first_id', 'video', 'Recording', 'https://youtu.be/VAI3JUKTwz0', null,
    '60000000-0000-0000-0000-000000003501') ->> 'resource_id',
  :'resource_id', 'repeating a client key returns the first resource');
select is((select count(*)::integer from public.training_resources where occurrence_id = :'first_id'), 1,
  'the repeat adds nothing');
select throws_ok(
  format($$select public.add_training_resource(%L, 'video', null, 'https://youtu.be/x', null, '60000000-0000-0000-0000-000000003501')$$, :'second_id'),
  'P0001', 'idempotency_conflict', 'a client key cannot move to another training');
select public.add_training_resource(:'first_id', 'summary', null, null, '# Notes');
select is((select count(*)::integer from public.training_resources where occurrence_id = :'first_id'), 2,
  'calls without a key still add a resource');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003502');
select public.record_alone_training('2026-10-03', 'Europe/Lisbon', 30, null,
  '[{"source_text":"ginga","movements":[{"movement_key":"ginga","movement_name":"Ginga","segment_key":"m:1"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000003503', '2026-10-03T08:00:00Z') ->> 'occurrence_id' as bia_id \gset
select isnt(
  public.add_training_resource(:'bia_id', 'video', null, 'https://youtu.be/VAI3JUKTwz0', null,
    '60000000-0000-0000-0000-000000003501') ->> 'resource_id',
  :'resource_id', 'another person may use the same key value');

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx supabase test db supabase/tests/0035_resource_idempotency.test.sql`
Expected: FAIL — `has_column` fails.

- [ ] **Step 3: Write the migration and apply it**

```sql
-- supabase/migrations/202610250001_resource_idempotency.sql
-- A reload right after Save can send the same resource again. Each resource
-- now carries the client's key, and a repeated key returns the first row.
alter table public.training_resources add column client_key uuid;
create unique index training_resources_client_key_idx
  on public.training_resources (added_by, client_key) where client_key is not null;

drop function public.add_training_resource(uuid, text, text, text, text);
drop function private.add_training_resource(uuid, uuid, text, text, text, text);

create function private.add_training_resource(
  actor_id uuid, target_occurrence_id uuid, new_kind text, new_title text, new_url text, new_body text,
  target_client_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare existing public.training_resources;
declare created_id uuid;
begin
  if not private.can_write_training_resources(actor_id, target_occurrence_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  insert into public.training_resources (occurrence_id, kind, title, url, body, added_by, client_key)
  values (
    target_occurrence_id, new_kind, nullif(btrim(coalesce(new_title, '')), ''),
    nullif(btrim(coalesce(new_url, '')), ''), new_body, actor_id, target_client_key
  )
  on conflict (added_by, client_key) where client_key is not null do nothing
  returning id into created_id;
  if created_id is null then
    select * into existing from public.training_resources resource
     where resource.added_by = actor_id and resource.client_key = target_client_key;
    if existing.occurrence_id <> target_occurrence_id then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;
    created_id := existing.id;
  end if;
  return jsonb_build_object('status', 'saved', 'resource_id', created_id);
end;
$$;

create function public.add_training_resource(
  occurrence_id uuid, kind text, title text, url text, body text, client_key uuid default null
)
returns jsonb language sql set search_path = ''
as $$ select private.add_training_resource(auth.uid(), occurrence_id, kind, title, url, body, client_key); $$;

revoke execute on function private.add_training_resource(uuid, uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function private.add_training_resource(uuid, uuid, text, text, text, text, uuid) to authenticated;
revoke execute on function public.add_training_resource(uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.add_training_resource(uuid, text, text, text, text, uuid) to authenticated;
```

Run: `npx supabase migration up --local && npx supabase test db supabase/tests/0035_resource_idempotency.test.sql`
Expected: PASS.

- [ ] **Step 4: Write the failing client tests**

In `tests/unit/training-service.test.js`, in `'uses stable resource and past-class contracts'`, add `client_key: null` to both expected `add_training_resource` parameter objects, and add:

```js
  it('sends the client key so a repeated resource is kept once', async () => {
    const { client, calls } = harness();
    await createTrainingService(client).addResource({ occurrenceId: 'o-1', kind: 'video', url: 'https://youtu.be/x', clientKey: 'c-1' });
    expect(calls).toEqual([['add_training_resource', { occurrence_id: 'o-1', kind: 'video', title: null, url: 'https://youtu.be/x', body: null, client_key: 'c-1' }]]);
  });
```

In `tests/unit/errors.test.js`, add (import `toAppError` if the file does not already):

```js
  it('explains a client key reused on another training', () => {
    expect(toAppError({ code: 'P0001', message: 'idempotency_conflict' }).message)
      .toBe('This item was already saved to another training.');
  });
```

In `tests/unit/log-screen.test.js`, change the expectation at the end of `'adds resources and queues the ones that fail after saving'` to:

```js
    expect(JSON.parse(localStorage.getItem('roda.pendingResources:o7'))).toEqual([
      { occurrenceId: 'o7', kind: 'summary', title: '', url: null, body: '# Notes', clientKey: 'k' },
    ]);
    expect(training.addResource.mock.calls[0][0]).toMatchObject({ kind: 'video', clientKey: 'k' });
```

and add:

```js
  it('gives resources from an older draft a key before saving', async () => {
    localStorage.setItem('roda.logDraft:p1', JSON.stringify({
      localDate: '2026-10-11', durationMinutes: 45, notes: '', idempotencyKey: 'key-1',
      rounds: [{ sourceText: 'ginga', ratings: [] }], resources: [{ kind: 'video', title: '', url: 'https://youtu.be/x', body: null }],
    }));
    const training = {
      createIdempotencyKey: vi.fn(() => 'fresh'),
      recordAloneTraining: vi.fn().mockResolvedValue({ status: 'completed', occurrence_id: 'o8' }),
      addResource: vi.fn().mockResolvedValue({ status: 'saved' }),
    };
    const context = ctx(training);
    document.body.replaceChildren(await renderLog(context));
    document.querySelector('button[data-action="save"]').click();
    await vi.waitFor(() => expect(context.navigate).toHaveBeenCalledWith('/training/o8'));
    expect(training.addResource).toHaveBeenCalledWith(expect.objectContaining({ occurrenceId: 'o8', clientKey: 'fresh' }));
  });
```

In `tests/unit/resource-queue.test.js`, add `clientKey: expect.any(String)` to the object in `'saves every resource when the network works'` and to both queued objects in `'queues the failed resource and everything after it'`, and add:

```js
  it('keeps a resource key and gives a keyless resource one', async () => {
    const storage = memoryStorage();
    const service = { addResource: vi.fn().mockResolvedValue({}), createIdempotencyKey: vi.fn(() => 'made') };
    await saveResourcesOrQueue({ storage, service, occurrenceId: 'o3', resources: [
      { kind: 'video', title: '', url: 'https://x', body: null, clientKey: 'kept' },
      { kind: 'summary', title: '', url: null, body: '# A' },
    ] });
    expect(service.addResource.mock.calls.map(([input]) => input.clientKey)).toEqual(['kept', 'made']);
  });
```

In `tests/unit/record-class.test.js`, in `'records a group class for the checked people with its rounds and resources'`, add `clientKey: 'key-r'` to the expected `addResource` object (the test's `createIdempotencyKey` always returns `'key-r'`).

In `tests/unit/resource-view.test.js`, change the two `toHaveBeenCalledWith({ occurrenceId: 'o1', … })` expectations in `'shows resources and adds link, text, and files'` to include `clientKey: expect.any(String)`, and add:

```js
  it('retries a queued resource with the same key it was queued with', async () => {
    const service = {
      createIdempotencyKey: vi.fn().mockReturnValueOnce('key-a'),
      addResource: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ status: 'saved' }),
    };
    const item = { occurrence_id: 'o3', can_add_resources: true, resources: [] };
    document.body.replaceChildren(createResourceSection({ document, i18n, item, service, onChanged: vi.fn() }));
    document.querySelector('button[data-action="open-resources"]').click();
    const form = document.querySelector('form[data-resource-form]');
    form.querySelector('input[name="url"]').value = 'https://youtu.be/y';
    form.requestSubmit();
    await vi.waitFor(() => expect(form.querySelector('[role="status"]').textContent).toBe('offline'));
    document.body.replaceChildren(createResourceSection({ document, i18n, item, service, onChanged: vi.fn() }));
    document.querySelector('button[data-action="retry-resources"]').click();
    await vi.waitFor(() => expect(service.addResource).toHaveBeenCalledTimes(2));
    expect(service.addResource.mock.calls.map(([input]) => input.clientKey)).toEqual(['key-a', 'key-a']);
  });

  it('gives a resource queued before keys existed one key and keeps it', () => {
    localStorage.setItem('roda.pendingResources:o4', JSON.stringify([{ occurrenceId: 'o4', kind: 'summary', title: '', url: null, body: '# Old' }]));
    const service = { createIdempotencyKey: vi.fn().mockReturnValueOnce('key-old'), addResource: vi.fn() };
    const item = { occurrence_id: 'o4', can_add_resources: true, resources: [] };
    createResourceSection({ document, i18n, item, service, onChanged: vi.fn() });
    createResourceSection({ document, i18n, item, service, onChanged: vi.fn() });
    expect(JSON.parse(localStorage.getItem('roda.pendingResources:o4'))[0].clientKey).toBe('key-old');
    expect(service.createIdempotencyKey).toHaveBeenCalledTimes(1);
  });
```

Add to `tests/e2e/app-hardening.spec.js`:

```js
test('saving again after a reload adds each resource once', async ({ page }) => {
  await page.goto('/app#/log');
  const box = page.getByLabel('Write a round');
  await box.fill('ginga 10 min');
  await box.press('Enter');
  await page.getByRole('button', { name: '🎥 Link' }).click();
  await page.getByRole('dialog').getByLabel('Link').fill('https://youtu.be/VAI3JUKTwz0');
  await page.getByRole('dialog').getByRole('button', { name: 'Add' }).click();
  // The draft as it is right before Save: what a reload mid-save finds again.
  const draft = await page.evaluate(() => localStorage.getItem('roda.logDraft:practitioner-1'));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/training\//);
  const first = page.url();
  await page.evaluate((saved) => localStorage.setItem('roda.logDraft:practitioner-1', saved), draft);
  await page.goto('/app#/log');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(first);
  await expect(page.locator('.resource-buttons button')).toHaveCount(1);
});
```

- [ ] **Step 5: Run to verify they fail**

Run: `npx vitest run tests/unit/training-service.test.js tests/unit/errors.test.js tests/unit/log-screen.test.js tests/unit/resource-queue.test.js tests/unit/record-class.test.js tests/unit/resource-view.test.js && npm run build:test && npx playwright test tests/e2e/app-hardening.spec.js -g "once"`
Expected: FAIL — no `client_key`, no `clientKey`, a generic error message, and two resource buttons in the browser.

- [ ] **Step 6: Implement**

`src/app/errors.js`, add to `SAFE_MESSAGES`:

```js
  idempotency_conflict: 'This item was already saved to another training.',
```

`src/app/training-service.js`:

```js
    async addResource(input) {
      const resource = normalizeResource(input);
      return call('add_training_resource', {
        occurrence_id: input.occurrenceId, kind: input.kind, ...resource, client_key: input.clientKey ?? null,
      });
    },
```

`src/app/testing/fake-services.js`, in the fake training service's `addResource`, after the authorization check and before `nextId(state, 'resource')`:

```js
      if (input.clientKey) {
        const existing = state.resources.find((item) => item.added_by === actorId() && item.client_key === input.clientKey);
        if (existing) {
          if (existing.occurrence_id !== occurrence.id) throw new AppError('validation', 'idempotency_conflict');
          return { status: 'saved', resource_id: existing.id };
        }
      }
```

and store the key on the new row: `state.resources.push({ id, occurrence_id: occurrence.id, kind: input.kind, added_by: actorId(), client_key: input.clientKey ?? null, ...resource });`.

`src/app/screens/log.js`, after `const todayIso = ctx.today();`:

```js
  // Each staged resource keeps one key, so a repeated Save cannot add it twice.
  const withKey = (resource) => (resource.clientKey ? resource : { ...resource, clientKey: training.createIdempotencyKey() });
```

then use `resources: (saved?.resources ?? []).map(withKey),` in `state`, and `state.resources.push(withKey(resource));` in the resource sheet's submit handler.

`src/app/screens/resource-queue.js`: give every resource a key before sending, so a queued copy keeps it:

```js
export async function saveResourcesOrQueue({ storage, service, occurrenceId, resources }) {
  const newKey = () => service.createIdempotencyKey?.() ?? globalThis.crypto.randomUUID();
  const pending = resources.map((resource) => ({ occurrenceId, ...resource, clientKey: resource.clientKey ?? newKey() }));
```

(the rest of the function is unchanged).

`src/app/screens/record-class.js`: right after `const idempotencyKey = training.createIdempotencyKey();`, add

```js
  // One key per resource kind for the whole page, so pressing Save again after
  // a failure never adds a resource twice.
  const resourceKeys = {
    video: training.createIdempotencyKey(), summary: training.createIdempotencyKey(), voice: training.createIdempotencyKey(),
  };
```

and change the `extras` mapping to `.map(([resourceKind, url, body]) => ({ kind: resourceKind, title: '', url, body, clientKey: resourceKeys[resourceKind] }));`.

`src/app/ui/resource-view.js`: give `pendingStore` a key maker and keep keys stable:

```js
function pendingStore(document, occurrenceId, newKey) {
  const key = `roda.pendingResources:${occurrenceId}`;
  let storage = null;
  try {
    storage = document.defaultView?.localStorage ?? null;
  } catch {
    storage = null;
  }
  let items = [];
  try {
    const value = JSON.parse(storage?.getItem(key) ?? '[]');
    items = Array.isArray(value) ? value : [];
  } catch {
    items = [];
  }
  const store = {
    read() {
      return [...items];
    },
    write(next) {
      items = [...next];
      try {
        if (items.length) storage?.setItem(key, JSON.stringify(items));
        else storage?.removeItem(key);
      } catch {
        // Storage full or blocked: the in-memory queue still holds the items.
      }
    },
  };
  // Items queued before keys existed get one now, saved so it never changes.
  if (items.some((item) => !item?.clientKey)) {
    store.write(items.map((item) => (item?.clientKey ? item : { ...item, clientKey: newKey() })));
  }
  return store;
}
```

In `createResourceSection`, create the key maker and pass it:

```js
  const newKey = () => service.createIdempotencyKey?.() ?? globalThis.crypto.randomUUID();
  const pending = pendingStore(document, item.occurrence_id, newKey);
```

and add `clientKey: newKey()` to each of the three `queued.push({ … })` objects in the form's submit handler.

- [ ] **Step 7: Run to verify they pass**

Run: `npx vitest run tests/unit/training-service.test.js tests/unit/errors.test.js tests/unit/log-screen.test.js tests/unit/resource-queue.test.js tests/unit/record-class.test.js tests/unit/resource-view.test.js && npm run build:test && npx playwright test tests/e2e/app-hardening.spec.js`
Expected: PASS.

- [ ] **Step 8: Run all suites**

Run: `npm run test:unit && npm run test:e2e && npm run test:db`
Expected: PASS (the existing `0013` and `0016` tests call the function with five arguments, which the default covers).

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/202610250001_resource_idempotency.sql supabase/tests/0035_resource_idempotency.test.sql src/app/training-service.js src/app/testing/fake-services.js src/app/errors.js src/app/screens/log.js src/app/screens/resource-queue.js src/app/screens/record-class.js src/app/ui/resource-view.js tests/unit/training-service.test.js tests/unit/errors.test.js tests/unit/log-screen.test.js tests/unit/resource-queue.test.js tests/unit/record-class.test.js tests/unit/resource-view.test.js tests/e2e/app-hardening.spec.js
git commit -m "fix: add each training resource once, even after a reload mid-save

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Signing out never loses a waiting resource

Resources are text and save the moment they are submitted (on the training page, or in the same Save as the training in Log training). The local waiting queue (`roda.pendingResources:<occurrence>`) exists only as the fallback for a save that failed. Signing out first sends anything in that queue; normally that takes milliseconds and sign-out goes ahead. If something still cannot be sent, sign-out stops, deletes nothing, and says so, with Try again. There is no "discard and sign out".

**Files:**
- Create: `src/app/local-data.js`, `src/app/screens/sign-out.js`
- Modify: `src/app/entries/app.js`, `src/app/dashboard-i18n.js`
- Test: `tests/unit/local-data.test.js`, `tests/unit/sign-out.test.js`, `tests/e2e/app-hardening.spec.js`

**Interfaces:**
- Consumes: `training.addResource(input)` and `training.createIdempotencyKey()` (Task 5: queued items carry `clientKey`, so a resend never duplicates).
- Produces (`local-data.js`): `waitingCount(storage) → number` (items across every `roda.pendingResources:*` queue), `sendWaitingResources(storage, training) → Promise<number>` (sends every queued item in order, removes each one that saves, returns how many are still waiting; never throws), `clearLegacyDashboardKeys(storage) → void`. All tolerate missing or throwing storage.
- Produces (`sign-out.js`): `signOutSafely(ctx, { signOut: () => Promise<void> }) → Promise<boolean>` (true when it signed out); uses `ctx.document`, `ctx.window`, `ctx.i18n`, `ctx.services.training`, `ctx.openSheet`.
- Produces (copy): `signOut.waitingTitle`, `signOut.waitingOne`, `signOut.waitingMany` (`{count}`); the button reuses `app.retry`.

- [ ] **Step 1: Write the failing unit tests**

```js
// tests/unit/local-data.test.js
import { describe, expect, it, vi } from 'vitest';

import { clearLegacyDashboardKeys, sendWaitingResources, waitingCount } from '../../src/app/local-data.js';

function memory(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

const item = (occurrenceId, clientKey) => ({ occurrenceId, kind: 'summary', title: '', url: null, body: '# Notes', clientKey });

describe('waiting resources', () => {
  it('counts every queued item and ignores drafts and broken values', () => {
    const storage = memory({
      'roda.pendingResources:o1': JSON.stringify([item('o1', 'a'), item('o1', 'b')]),
      'roda.pendingResources:o2': '{broken',
      'roda.logDraft:p1': JSON.stringify({ rounds: [{ sourceText: 'ginga' }] }),
    });
    expect(waitingCount(storage)).toBe(2);
  });

  it('sends everything waiting and empties the queues', async () => {
    const storage = memory({ 'roda.pendingResources:o1': JSON.stringify([item('o1', 'a'), item('o1', 'b')]) });
    const training = { addResource: vi.fn().mockResolvedValue({ status: 'saved' }), createIdempotencyKey: vi.fn() };
    expect(await sendWaitingResources(storage, training)).toBe(0);
    expect(training.addResource.mock.calls.map(([input]) => input.clientKey)).toEqual(['a', 'b']);
    expect(storage.getItem('roda.pendingResources:o1')).toBeNull();
  });

  it('keeps what could not be sent, in order', async () => {
    const storage = memory({ 'roda.pendingResources:o1': JSON.stringify([item('o1', 'a'), item('o1', 'b')]) });
    const training = { addResource: vi.fn().mockResolvedValueOnce({ status: 'saved' }).mockRejectedValue(new Error('offline')) };
    expect(await sendWaitingResources(storage, training)).toBe(1);
    expect(JSON.parse(storage.getItem('roda.pendingResources:o1'))).toEqual([item('o1', 'b')]);
  });

  it('gives an item queued before keys existed a key before sending it', async () => {
    const storage = memory({ 'roda.pendingResources:o1': JSON.stringify([item('o1', undefined)]) });
    const training = { addResource: vi.fn().mockRejectedValue(new Error('offline')), createIdempotencyKey: vi.fn(() => 'new-key') };
    await sendWaitingResources(storage, training);
    expect(training.addResource).toHaveBeenCalledWith(expect.objectContaining({ clientKey: 'new-key' }));
    expect(JSON.parse(storage.getItem('roda.pendingResources:o1'))[0].clientKey).toBe('new-key');
  });

  it('removes the old dashboard keys and survives blocked storage', async () => {
    const storage = memory({ 'roda.dashboard.mode': 'coaching', 'roda.dashboard.group': 'g1', 'roda.dashboard.locale': 'en' });
    clearLegacyDashboardKeys(storage);
    expect([...storage.values.keys()]).toEqual(['roda.dashboard.locale']);
    const blocked = { get length() { throw new Error('blocked'); }, getItem() { throw new Error('blocked'); } };
    expect(waitingCount(blocked)).toBe(0);
    expect(await sendWaitingResources(blocked, { addResource: vi.fn() })).toBe(0);
    expect(() => clearLegacyDashboardKeys(null)).not.toThrow();
  });
});
```

```js
// tests/unit/sign-out.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { signOutSafely } from '../../src/app/screens/sign-out.js';
import { openSheet } from '../../src/app/shell/sheet.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });
const ctx = (training) => ({ document, window, i18n, services: { training }, openSheet: (options) => openSheet({ document, ...options }) });
const queue = () => localStorage.setItem('roda.pendingResources:o1', JSON.stringify([
  { occurrenceId: 'o1', kind: 'summary', title: '', url: null, body: '# Notes', clientKey: 'a' },
]));

describe('sign out', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
  });

  it('signs out at once when nothing is waiting, and keeps an unsent draft', async () => {
    localStorage.setItem('roda.logDraft:p1', JSON.stringify({ rounds: [{ sourceText: 'ginga' }] }));
    const signOut = vi.fn().mockResolvedValue();
    expect(await signOutSafely(ctx({ addResource: vi.fn() }), { signOut })).toBe(true);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('roda.logDraft:p1')).not.toBeNull();
  });

  it('sends waiting resources first, then signs out', async () => {
    queue();
    const training = { addResource: vi.fn().mockResolvedValue({ status: 'saved' }) };
    const signOut = vi.fn().mockResolvedValue();
    expect(await signOutSafely(ctx(training), { signOut })).toBe(true);
    expect(training.addResource).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('stays signed in, keeps the items, and offers only Try again when they cannot be sent', async () => {
    queue();
    const training = { addResource: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ status: 'saved' }) };
    const signOut = vi.fn().mockResolvedValue();
    expect(await signOutSafely(ctx(training), { signOut })).toBe(false);
    const sheet = document.querySelector('[role="dialog"]');
    expect(sheet.getAttribute('aria-label')).toBe('Waiting to sync');
    expect(sheet.textContent).toContain('One item is still waiting to sync — connect to the internet and try again.');
    expect([...sheet.querySelectorAll('button:not([data-sheet-close])')].map((button) => button.textContent)).toEqual(['Try again']);
    expect(signOut).not.toHaveBeenCalled();
    expect(localStorage.getItem('roda.pendingResources:o1')).not.toBeNull();
    sheet.querySelector('[data-action="retry-sign-out"]').click();
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem('roda.pendingResources:o1')).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing browser tests**

Add to `tests/e2e/app-hardening.spec.js`:

```js
async function trainingWithWaitingResource(page) {
  await page.goto('/app#/log');
  const box = page.getByLabel('Write a round');
  await box.fill('ginga 10 min');
  await box.press('Enter');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/training\//);
  const occurrenceId = page.url().split('#/training/')[1];
  await page.evaluate((id) => localStorage.setItem(`roda.pendingResources:${id}`, JSON.stringify([
    { occurrenceId: id, kind: 'summary', title: 'Notes', url: null, body: '# Class notes', clientKey: 'waiting-1' },
  ])), occurrenceId);
}

const savedResources = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('roda.e2e.trainingState')).resources.length);

test('signing out sends waiting resources first', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('roda.dashboard.mode', 'coaching'));
  await trainingWithWaitingResource(page);
  expect(await page.evaluate(() => localStorage.getItem('roda.dashboard.mode'))).toBeNull();
  await page.goto('/app#/me/settings');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await savedResources(page)).toBe(1);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('roda.pendingResources:')))).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('roda.e2e.session'))).toBeNull();
});

test('signing out offline keeps waiting resources and asks to try again', async ({ page }) => {
  await trainingWithWaitingResource(page);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('roda.e2e.trainingState'));
    localStorage.setItem('roda.e2e.trainingState', JSON.stringify({ ...state, failNext: 'addResource' }));
  });
  await page.goto('/app#/me/settings');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Waiting to sync' });
  await expect(sheet).toContainText('One item is still waiting to sync — connect to the internet and try again.');
  await expect(sheet.getByRole('button', { name: /sign out/i })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('roda.e2e.session'))).not.toBeNull();
  await sheet.getByRole('button', { name: 'Try again' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await savedResources(page)).toBe(1);
});

test('an expired session keeps unsaved work for after sign-in', async ({ page }) => {
  await page.goto('/app#/log');
  const box = page.getByLabel('Write a round');
  await box.fill('ginga 10 min');
  await box.press('Enter');
  await page.evaluate(() => window.__RODA_E2E_EXPIRE__());
  await expect(page).toHaveURL(/\?next=/);
  expect(await page.evaluate(() => localStorage.getItem('roda.logDraft:practitioner-1'))).not.toBeNull();
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/unit/local-data.test.js tests/unit/sign-out.test.js && npm run build:test && npx playwright test tests/e2e/app-hardening.spec.js -g "sign|expired"`
Expected: FAIL — the modules do not exist, and today's sign-out leaves the waiting resource unsent (`savedResources` is 0) and never shows the sheet.

- [ ] **Step 4: Implement**

```js
// src/app/local-data.js
// Resources save as soon as they are submitted. When a save fails, the item
// waits in browser storage (roda.pendingResources:<occurrence>) until it can
// be sent. This module counts and sends those items so nothing waiting is
// ever dropped, for example when signing out.
const PENDING_PREFIX = 'roda.pendingResources:';
const LEGACY_KEYS = Object.freeze(['roda.dashboard.mode', 'roda.dashboard.group']);

function storedKeys(storage) {
  try {
    return Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(Boolean);
  } catch {
    return [];
  }
}

function readQueue(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeQueue(storage, key, queue) {
  try {
    if (queue.length) storage.setItem(key, JSON.stringify(queue));
    else storage.removeItem(key);
  } catch {
    // Blocked storage: nothing was stored there to begin with.
  }
}

export function waitingCount(storage) {
  return storedKeys(storage)
    .filter((key) => key.startsWith(PENDING_PREFIX))
    .reduce((total, key) => total + readQueue(storage, key).length, 0);
}

export async function sendWaitingResources(storage, training) {
  let remaining = 0;
  for (const key of storedKeys(storage).filter((name) => name.startsWith(PENDING_PREFIX))) {
    let queue = readQueue(storage, key).map((entry) => (
      entry?.clientKey ? entry : { ...entry, clientKey: training.createIdempotencyKey?.() ?? globalThis.crypto.randomUUID() }
    ));
    writeQueue(storage, key, queue);
    while (queue.length) {
      try {
        await training.addResource(queue[0]);
      } catch {
        break;
      }
      queue = queue.slice(1);
      writeQueue(storage, key, queue);
    }
    remaining += queue.length;
  }
  return remaining;
}

export function clearLegacyDashboardKeys(storage) {
  for (const key of LEGACY_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      // Nothing to clear.
    }
  }
}
```

```js
// src/app/screens/sign-out.js
import { sendWaitingResources } from '../local-data.js';
import { el } from '../shell/page.js';

function localStorageOf(window) {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Sign-out never drops a resource that has not reached the account. It sends
// anything waiting first; if that fails, the person stays signed in and is
// asked to connect and try again. There is deliberately no way to discard.
export async function signOutSafely(ctx, { signOut }) {
  const { document, i18n } = ctx;
  const storage = localStorageOf(ctx.window);
  const remaining = await sendWaitingResources(storage, ctx.services.training);
  if (!remaining) {
    await signOut();
    return true;
  }
  let sheet = null;
  const retry = el(document, 'button', {
    className: 'button-primary', text: i18n.t('app.retry'), attrs: { type: 'button' }, dataset: { action: 'retry-sign-out' },
    on: { click: async () => {
      retry.disabled = true;
      sheet.close();
      await signOutSafely(ctx, { signOut });
    } },
  });
  const message = remaining === 1 ? i18n.t('signOut.waitingOne') : i18n.t('signOut.waitingMany', { count: remaining });
  sheet = ctx.openSheet({
    title: i18n.t('signOut.waitingTitle'),
    content: el(document, 'div', { className: 'sign-out-waiting' }, [el(document, 'p', { text: message }), retry]),
  });
  return false;
}
```

Copy in `src/app/dashboard-i18n.js` — `en`:

```js
    'signOut.waitingTitle': 'Waiting to sync',
    'signOut.waitingOne': 'One item is still waiting to sync — connect to the internet and try again.',
    'signOut.waitingMany': '{count} items are still waiting to sync — connect to the internet and try again.',
```

`pt`:

```js
    'signOut.waitingTitle': 'À espera de sincronizar',
    'signOut.waitingOne': 'Um item ainda está à espera de sincronizar — liga-te à internet e tenta novamente.',
    'signOut.waitingMany': '{count} itens ainda estão à espera de sincronizar — liga-te à internet e tenta novamente.',
```

In `src/app/entries/app.js`: import `signOutSafely` from `'../screens/sign-out.js'` and `clearLegacyDashboardKeys` from `'../local-data.js'`; make `clearLegacyDashboardKeys(localStorage);` the first line of `main()`; and wrap the Settings sign-out handler (find the call `services.auth.signOut()` passed as `onSignOut` to the Settings screen) so it reads:

```js
            onSignOut: () => signOutSafely(ctx, {
              signOut: async () => { await services.auth.signOut(); location.replace('/'); },
            }),
```

Leave the `onAuthStateChange` handler (session expiry) unchanged: it must not send or clear anything. An unsent Log training draft (`roda.logDraft:<profile>`) is not "waiting to sync" — it was never submitted — and stays on the device for that profile only; the composer never shows another profile's draft.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run tests/unit/local-data.test.js tests/unit/sign-out.test.js tests/unit/dashboard-i18n.test.js && npm run build:test && npx playwright test tests/e2e/app-hardening.spec.js tests/e2e/app-shell.spec.js`
Expected: PASS (the existing "signs out from Settings" test has nothing waiting, so it signs out at once).

- [ ] **Step 6: Run the suites**

Run: `npm run test:unit && npm run test:e2e`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/local-data.js src/app/screens/sign-out.js src/app/entries/app.js src/app/dashboard-i18n.js tests/unit/local-data.test.js tests/unit/sign-out.test.js tests/e2e/app-hardening.spec.js
git commit -m "feat: send waiting resources before signing out and never drop them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Group B — Switch-over to `/app`

### Task 7: The app handles every link and entry the old dashboard did

**Files:**
- Create: `src/app/shell/entry-links.js`
- Modify: `src/app/entries/app.js`, `src/app/shell/layout.js`, `src/app/screens/log.js`, `src/app/screens/me.js`, `src/app/screens/group.js`, `src/app/screens/group-owner.js`, `src/app/dashboard-i18n.js`, `assets/app.css`
- Delete: `src/app/screens/placeholder.js`
- Test: `tests/unit/entry-links.test.js`, `tests/unit/layout.test.js`, `tests/unit/me-screen.test.js`, `tests/e2e/app-switch-over.spec.js` (create)

**Interfaces:**
- Consumes: `services.group.acceptInvitation(token) → { status: 'accepted'|'expired'|'revoked', group_id?, already_used? }`, `services.group.resolveDiscoveryToken(token) → group | null`, `services.group.requestAccess(groupId, 'member', token)`; `seedAccount(page, { profile, coachProfile, extra })` from `tests/e2e/app-helpers.js`.
- Produces (`entry-links.js`): `LINK_PARAMS`, `takeEntryLinks(window, storage) → { member_invite?, group_link? }` (scrubs the address bar), `runEntryLinks(ctx, storage) → Promise<void>` (opens at most one sheet and forgets the link).
- Produces: `inviteLink(origin, token) → '<origin>/app?member_invite=<token>'`, `discoveryLink(origin, token) → '<origin>/app?group_link=<token>'`.
- Produces (`layout.js`): `createLayout({ …, demo = false })` renders `p.app-demo[role=note]` with `app.demoBadge` when `demo` is true.
- Produces (`app.js`): the signed-out return is `/?next=<encoded pathname + search + hash>`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/entry-links.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { inviteLink } from '../../src/app/screens/group.js';
import { discoveryLink } from '../../src/app/screens/group-owner.js';
import { runEntryLinks, takeEntryLinks } from '../../src/app/shell/entry-links.js';
import { openSheet } from '../../src/app/shell/sheet.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

function memory() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
}

const ctx = (group) => ({ document, i18n, services: { group }, navigate: vi.fn(), openSheet: (options) => openSheet({ document, ...options }) });
const sheet = () => document.querySelector('[role="dialog"]');

describe('entry links', () => {
  beforeEach(() => { document.body.replaceChildren(); });

  it('makes links that open the app', () => {
    expect(inviteLink('https://roda.fyi', 'a b')).toBe('https://roda.fyi/app?member_invite=a%20b');
    expect(discoveryLink('https://roda.fyi', 'x/y')).toBe('https://roda.fyi/app?group_link=x%2Fy');
  });

  it('captures an invitation and scrubs it from the address bar', () => {
    window.history.replaceState(null, '', '/app?member_invite=abc&demo=1#/calendar');
    const storage = memory();
    expect(takeEntryLinks(window, storage)).toEqual({ member_invite: 'abc' });
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/app?demo=1#/calendar');
    expect(JSON.parse(storage.getItem('roda.entryLinks'))).toEqual({ member_invite: 'abc' });
  });

  it('drops an empty token and stores nothing', () => {
    window.history.replaceState(null, '', '/app?group_link=#/');
    const storage = memory();
    expect(takeEntryLinks(window, storage)).toEqual({});
    expect(window.location.search).toBe('');
    expect(storage.getItem('roda.entryLinks')).toBeNull();
  });

  it('does nothing without a waiting link', async () => {
    await runEntryLinks(ctx({}), memory());
    expect(sheet()).toBeNull();
  });

  it('accepts an invitation once', async () => {
    const storage = memory();
    storage.setItem('roda.entryLinks', JSON.stringify({ member_invite: 'abc' }));
    const group = { acceptInvitation: vi.fn().mockResolvedValue({ status: 'accepted', group_id: 'g1' }) };
    const context = ctx(group);
    await runEntryLinks(context, storage);
    expect(storage.getItem('roda.entryLinks')).toBeNull();
    expect(sheet().getAttribute('aria-label')).toBe('Group invitation');
    sheet().querySelector('[data-action="accept-invite"]').click();
    await vi.waitFor(() => expect(sheet().textContent).toContain('Invitation accepted. You are now a group member.'));
    expect(group.acceptInvitation).toHaveBeenCalledWith('abc');
    sheet().querySelector('[data-action="open-groups"]').click();
    expect(context.navigate).toHaveBeenCalledWith('/me/groups');
  });

  it.each([
    [{ status: 'expired' }, 'This invitation has expired.'],
    [{ status: 'revoked' }, 'This invitation was revoked.'],
    [{ status: 'accepted', already_used: true }, 'This invitation has already been used.'],
  ])('explains an invitation answered with %o', async (result, message) => {
    const storage = memory();
    storage.setItem('roda.entryLinks', JSON.stringify({ member_invite: 'abc' }));
    await runEntryLinks(ctx({ acceptInvitation: vi.fn().mockResolvedValue(result) }), storage);
    sheet().querySelector('[data-action="accept-invite"]').click();
    await vi.waitFor(() => expect(sheet().textContent).toContain(message));
  });

  it('shows a linked group and asks to join with the link', async () => {
    const storage = memory();
    storage.setItem('roda.entryLinks', JSON.stringify({ group_link: 'secret' }));
    const group = {
      resolveDiscoveryToken: vi.fn().mockResolvedValue({ id: 'g2', name: 'Grupo Mata', location: 'Porto', description: 'Saturday roda' }),
      requestAccess: vi.fn().mockResolvedValue({ status: 'pending' }),
    };
    await runEntryLinks(ctx(group), storage);
    expect(sheet().getAttribute('aria-label')).toBe('Grupo Mata');
    expect(sheet().textContent).toContain('Porto');
    sheet().querySelector('[data-action="request-member"]').click();
    await vi.waitFor(() => expect(sheet().textContent).toContain('Your member access request is pending.'));
    expect(group.requestAccess).toHaveBeenCalledWith('g2', 'member', 'secret');
  });

  it('says when a group link cannot be opened', async () => {
    const storage = memory();
    storage.setItem('roda.entryLinks', JSON.stringify({ group_link: 'nope' }));
    await runEntryLinks(ctx({ resolveDiscoveryToken: vi.fn().mockResolvedValue(null) }), storage);
    expect(sheet().getAttribute('aria-label')).toBe('Group link');
    expect(sheet().textContent).toContain('This group link is unavailable.');
  });
});
```

Add to `tests/unit/layout.test.js`:

```js
  it('labels the demo so visitors know it stays in this browser', () => {
    const layout = createLayout({ document, i18n, onPlus() {}, demo: true });
    expect(layout.root.querySelector('.app-demo').textContent).toBe('Demo · browser only');
    expect(createLayout({ document, i18n, onPlus() {} }).root.querySelector('.app-demo')).toBeNull();
  });
```

In `tests/unit/me-screen.test.js`: delete the test `'renders placeholders with a link to the classic dashboard'` and its `renderPlaceholder` import, and in `'switches language and signs out from Settings'` change the last line to `expect(view.querySelector('a[href="/dashboard"]')).toBeNull();`.

```js
// tests/e2e/app-switch-over.spec.js
import { expect, test } from '@playwright/test';

import { seedAccount } from './app-helpers.js';

const lua = {
  id: 'group-lua', slug: 'grupo-lua', owner_id: 'owner-1', name: 'Grupo Lua', description: 'Tuesday training',
  location: 'Lisbon', picture_path: null, is_discoverable: true, archived_at: null,
};
const mata = { ...lua, id: 'group-mata', slug: 'grupo-mata', owner_id: 'owner-2', name: 'Grupo Mata', description: 'Saturday roda', location: 'Porto', is_discoverable: false };

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
});

test('keeps a member invitation through sign-in and explains used links', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/app?member_invite=member-valid');
  await expect(page).toHaveURL(/\?next=%2Fapp%3Fmember_invite%3Dmember-valid$/);

  await seedAccount(page, { extra: { 'roda.e2e.groupState': {
    groups: [lua],
    invitationTokens: {
      'member-valid': { state: 'pending', group: lua },
      'member-expired': { state: 'expired', group: lua },
      'member-revoked': { state: 'revoked', group: lua },
      'member-used': { state: 'accepted', group: lua },
    },
  } } });
  await page.goto('/app?member_invite=member-valid');
  const invitation = page.getByRole('dialog', { name: 'Group invitation' });
  await expect(invitation).toContainText('You were invited to join a group');
  expect(new URL(page.url()).search).toBe('');
  await invitation.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(invitation).toContainText('Invitation accepted. You are now a group member.');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('roda.e2e.groupState'))
    .memberships.map(({ group_id: id }) => id))).toEqual(['group-lua']);

  for (const [token, message] of [['member-expired', 'expired'], ['member-revoked', 'revoked'], ['member-used', 'already been used']]) {
    await page.goto(`/app?member_invite=${token}`);
    const again = page.getByRole('dialog', { name: 'Group invitation' });
    await again.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(again).toContainText(message);
    expect(new URL(page.url()).search).toBe('');
  }
});

test('opens an unlisted group link and requests access', async ({ page }) => {
  await seedAccount(page, { extra: { 'roda.e2e.groupState': { groups: [lua, mata], discoveryTokens: { 'unlisted-secret': 'group-mata' } } } });
  await page.goto('/app?group_link=unlisted-secret');
  const card = page.getByRole('dialog', { name: 'Grupo Mata' });
  await expect(card).toContainText('Porto');
  expect(new URL(page.url()).search).toBe('');
  await card.getByRole('button', { name: 'Request member access' }).click();
  await expect(card).toContainText('Your member access request is pending.');
  await expect.poll(() => page.evaluate(() => window.__RODA_E2E_EVENTS__))
    .toContainEqual({ type: 'request-access', groupId: 'group-mata', requestedAccess: 'member' });

  await page.goto('/app?group_link=nope');
  await expect(page.getByRole('dialog', { name: 'Group link' })).toContainText('This group link is unavailable.');
});

test('saves a round as a sequence from Log training', async ({ page }) => {
  await seedAccount(page);
  await page.goto('/app#/log');
  const box = page.getByLabel('Write a round');
  await box.fill('10x (ginga, armada)');
  await box.press('Enter');
  await page.getByRole('button', { name: 'Save as sequence' }).click();
  await expect(page.getByText('Saved to your repertoire.')).toBeVisible();
  await page.getByRole('button', { name: '📚 Saved' }).click();
  await expect(page.getByRole('dialog')).toContainText('10x (ginga, armada)');
});

test('the demo says it stays in this browser', async ({ page }) => {
  await page.goto('/app?demo=1');
  await expect(page.getByRole('note')).toHaveText('Demo · browser only');
});

test('Settings no longer points at the classic dashboard', async ({ page }) => {
  await seedAccount(page);
  await page.goto('/app#/me/settings');
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await expect(page.locator('a[href="/dashboard"]')).toHaveCount(0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/entry-links.test.js tests/unit/layout.test.js tests/unit/me-screen.test.js && npm run build:test && npx playwright test tests/e2e/app-switch-over.spec.js`
Expected: FAIL — `entry-links.js` does not exist, the links still say `/dashboard`, there is no demo note, Settings still links to the classic dashboard, and the first browser test fails its first assertion because today's sign-in return drops the query (`next=%2Fapp` only).

- [ ] **Step 3: Implement the link handling**

```js
// src/app/shell/entry-links.js
// One-time links (member invitations, unlisted group links) arrive as query
// parameters. The token leaves the address bar as soon as the signed-in app
// starts, waits in this tab's storage, and opens on the first screen that is
// not the welcome flow.
import { el } from './page.js';

export const LINK_PARAMS = Object.freeze(['member_invite', 'group_link']);
const KEY = 'roda.entryLinks';
let held = null;

export function takeEntryLinks(window, storage) {
  const url = new URL(window.location.href);
  const links = {};
  let changed = false;
  for (const name of LINK_PARAMS) {
    if (!url.searchParams.has(name)) continue;
    const value = url.searchParams.get(name).trim();
    if (value) links[name] = value;
    url.searchParams.delete(name);
    changed = true;
  }
  if (changed) window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  if (Object.keys(links).length) {
    try {
      storage.setItem(KEY, JSON.stringify(links));
      held = null;
    } catch {
      // Storage is missing or blocked: keep the link for this page load only.
      held = links;
    }
  }
  return links;
}

function readLinks(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(KEY) ?? 'null');
    if (saved && typeof saved === 'object') return saved;
  } catch {
    // Fall back to the in-memory copy.
  }
  return held;
}

function forget(storage) {
  held = null;
  try {
    storage?.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}

const INVITE_MESSAGES = Object.freeze({ expired: 'links.expired', revoked: 'links.revoked', accepted: 'links.used' });

function showInvitation(ctx, token) {
  const { document, i18n } = ctx;
  const status = el(document, 'p', { attrs: { role: 'status' } });
  const accept = el(document, 'button', {
    className: 'button-primary', text: i18n.t('links.accept'), attrs: { type: 'button' }, dataset: { action: 'accept-invite' },
  });
  const body = el(document, 'div', { className: 'entry-link' }, [el(document, 'p', { text: i18n.t('links.inviteIntro') }), accept, status]);
  accept.addEventListener('click', async () => {
    accept.disabled = true;
    try {
      const result = await ctx.services.group.acceptInvitation(token);
      if (result?.status === 'accepted' && !result.already_used) {
        status.textContent = i18n.t('links.accepted');
        accept.replaceWith(el(document, 'button', {
          className: 'button-secondary', text: i18n.t('links.openGroups'), attrs: { type: 'button' }, dataset: { action: 'open-groups' },
          on: { click: () => ctx.navigate('/me/groups') },
        }));
        return;
      }
      status.textContent = i18n.t(INVITE_MESSAGES[result?.status] ?? 'links.unavailable');
    } catch (error) {
      status.textContent = error?.message || i18n.t('links.unavailable');
      accept.disabled = false;
    }
  });
  ctx.openSheet({ title: i18n.t('links.inviteTitle'), content: body });
}

async function showGroupLink(ctx, token) {
  const { document, i18n } = ctx;
  let group = null;
  try {
    group = await ctx.services.group.resolveDiscoveryToken(token);
  } catch {
    group = null;
  }
  if (!group) {
    ctx.openSheet({ title: i18n.t('links.groupTitle'), content: el(document, 'p', { text: i18n.t('links.groupUnavailable') }) });
    return;
  }
  const status = el(document, 'p', { attrs: { role: 'status' } });
  const request = el(document, 'button', {
    className: 'button-primary', text: i18n.t('links.requestMember'), attrs: { type: 'button' }, dataset: { action: 'request-member' },
  });
  request.addEventListener('click', async () => {
    request.disabled = true;
    try {
      await ctx.services.group.requestAccess(group.id, 'member', token);
      status.textContent = i18n.t('links.requested');
    } catch (error) {
      status.textContent = error?.message || i18n.t('app.loadError');
      request.disabled = false;
    }
  });
  ctx.openSheet({ title: group.name, content: el(document, 'div', { className: 'entry-link' }, [
    group.location ? el(document, 'p', { className: 'muted', text: group.location }) : null,
    group.description ? el(document, 'p', { text: group.description }) : null,
    el(document, 'p', { className: 'muted', text: i18n.t('links.groupNote') }),
    request, status,
  ]) });
}

export async function runEntryLinks(ctx, storage) {
  const links = readLinks(storage);
  if (!links) return;
  forget(storage);
  if (links.member_invite) showInvitation(ctx, links.member_invite);
  else if (links.group_link) await showGroupLink(ctx, links.group_link);
}
```

In `src/app/screens/group.js` and `src/app/screens/group-owner.js`, replace the `Ruling R15` comment and the link builders:

```js
// The app is the only place these links open (Plan 4, Ruling 5).
export function inviteLink(origin, token) {
  return `${origin}/app?member_invite=${encodeURIComponent(token)}`;
}
```

```js
// The app is the only place these links open (Plan 4, Ruling 5).
export function discoveryLink(origin, token) {
  return `${origin}/app?group_link=${encodeURIComponent(token)}`;
}
```

Copy in `src/app/dashboard-i18n.js` — `en`:

```js
    'app.demoBadge': 'Demo · browser only',
    'links.inviteTitle': 'Group invitation',
    'links.inviteIntro': 'You were invited to join a group as a practitioner. The invitation can be used once.',
    'links.accept': 'Accept invitation',
    'links.accepted': 'Invitation accepted. You are now a group member.',
    'links.openGroups': 'Open your groups',
    'links.expired': 'This invitation has expired.',
    'links.revoked': 'This invitation was revoked.',
    'links.used': 'This invitation has already been used.',
    'links.unavailable': 'This invitation is no longer available.',
    'links.groupTitle': 'Group link',
    'links.groupUnavailable': 'This group link is unavailable.',
    'links.groupNote': 'This link shows the group. A coach still approves who joins.',
    'links.requestMember': 'Request member access',
    'links.requested': 'Your member access request is pending.',
```

`pt`:

```js
    'app.demoBadge': 'Demo · apenas neste navegador',
    'links.inviteTitle': 'Convite para grupo',
    'links.inviteIntro': 'Foste convidado para entrar num grupo como praticante. O convite só pode ser usado uma vez.',
    'links.accept': 'Aceitar convite',
    'links.accepted': 'Convite aceite. Já és membro do grupo.',
    'links.openGroups': 'Abrir os teus grupos',
    'links.expired': 'Este convite expirou.',
    'links.revoked': 'Este convite foi revogado.',
    'links.used': 'Este convite já foi usado.',
    'links.unavailable': 'Este convite já não está disponível.',
    'links.groupTitle': 'Link de grupo',
    'links.groupUnavailable': 'Este link de grupo não está disponível.',
    'links.groupNote': 'Este link mostra o grupo. Um treinador ainda aprova quem entra.',
    'links.requestMember': 'Pedir acesso como membro',
    'links.requested': 'O teu pedido de acesso como membro está pendente.',
```

- [ ] **Step 4: Wire the entry, the layout, Settings, and the composer**

`src/app/shell/layout.js`: add `demo = false` to `createLayout`'s options (`{ document, i18n, onPlus, plusLabel = () => 'app.logTraining', demo = false }`); before `const root = …` add

```js
  const demoNote = demo ? el(document, 'p', { className: 'app-demo', attrs: { role: 'note' } }) : null;
```

put `demoNote` right after `nav` in the `root` children list, and add to `refreshCopy()`:

```js
    if (demoNote) demoNote.textContent = i18n.t('app.demoBadge');
```

`assets/app.css`:

```css
.app-demo { margin: 0; padding: 4px 12px; text-align: center; font-size: .75rem; background: var(--card-2); color: var(--sand); border-bottom: 1px solid var(--line); }
```

`src/app/screens/me.js`: in `renderSettings`, delete the element `el(document, 'a', { className: 'button-secondary', text: i18n.t('app.classic'), attrs: { href: '/dashboard' } }),`.

`src/app/entries/app.js`:

1. Imports: add `import { runEntryLinks, takeEntryLinks } from '../shell/entry-links.js';` and delete the `renderPlaceholder` import.
2. Near the top of `main()`, add:

```js
  const tabStorage = (() => {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  })();
```

3. Replace the `toSignIn` definition so the whole address survives sign-in:

```js
  const toSignIn = () => location.replace(`/?next=${encodeURIComponent(`${location.pathname}${location.search}${location.hash}`)}`);
```

4. Right after `const { profile, session } = startup;` add `takeEntryLinks(window, tabStorage);`.
5. Pass `demo: demoMode` to `createLayout({ … })`.
6. In `meSection`, replace the final `return renderPlaceholder(ctx, { title: i18n.t(`app.${section}`) });` with:

```js
    router.replace('/me');
    return null;
```

7. In `screenFor`, replace `default: return renderPlaceholder(ctx, { title: i18n.t('app.today') });` with `default: return renderToday(ctx, route);`.
8. At the end of `show(route)`, after `target.replaceChildren(view);` and the focus line, add:

```js
    if (route.name !== 'welcome') runEntryLinks(ctx, tabStorage);
```

Then `git rm src/app/screens/placeholder.js`.

`src/app/screens/log.js`: pass the repertoire to the round editor so cards offer "Save as sequence":

```js
  const editor = createRoundEditor({
    document, i18n, mode: 'record', getTermMappings: ctx.getTermMappings, showAddButton: false, repertoire: ctx.services.repertoire,
  });
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run tests/unit/entry-links.test.js tests/unit/layout.test.js tests/unit/me-screen.test.js tests/unit/log-screen.test.js tests/unit/dashboard-i18n.test.js && npm run build:test && npx playwright test tests/e2e/app-switch-over.spec.js tests/e2e/app-shell.spec.js tests/e2e/app-navigation.spec.js`
Expected: PASS. (`app-shell`'s "signed-out visitors go to sign-in and keep the route" still expects `%2Fapp%23%2Fcalendar`, which the path-based return produces.)

- [ ] **Step 6: Run the suites**

Run: `npm run test:unit && npm run test:e2e`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A src/app/shell/entry-links.js src/app/shell/layout.js src/app/entries/app.js src/app/screens src/app/dashboard-i18n.js assets/app.css tests/unit/entry-links.test.js tests/unit/layout.test.js tests/unit/me-screen.test.js tests/e2e/app-switch-over.spec.js
git commit -m "feat: open invitations and group links in the app, link to /app, and drop the stopgap screens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Port the old dashboard's browser tests

**Files:**
- Test: `tests/e2e/app-switch-over.spec.js`

**Interfaces:**
- Consumes: `seedAccount` and the `beforeEach` clock from Task 7.
- Produces: the test titles named by the `here(...)` rows in Task 1's audit.

These are coverage ports for behaviors the old dashboard tested on screens Plans 1–2 rebuilt. They are expected to pass on first run; a failure is a real regression of an old capability and is fixed inside this task, in the screen the failing test names.

- [ ] **Step 1: Write the ported tests**

Append to `tests/e2e/app-switch-over.spec.js`:

```js
const trainingState = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('roda.e2e.trainingState')));

async function logRound(page, text) {
  await page.goto('/app#/log');
  const box = page.getByLabel('Write a round');
  await box.fill(text);
  await box.press('Enter');
}

test('a failed save keeps the composer and a retry records one training', async ({ page }) => {
  await seedAccount(page, { extra: { 'roda.e2e.trainingState': { failNext: 'recordAloneTraining' } } });
  await logRound(page, '10x armada, au');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.log-status')).toContainText('failed');
  await expect(page.locator('textarea[data-round-text]').first()).toHaveValue('10x armada, au');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/training\//);
  await expect.poll(async () => {
    const state = await trainingState(page);
    return [state.occurrences.length, state.participations.length];
  }).toEqual([1, 1]);
});

test('marks an unknown move as new and records it', async ({ page }) => {
  await seedAccount(page);
  await logRound(page, 'armada, galopanti');
  await expect(page.locator('[data-chip="2"]')).toHaveAttribute('data-status', 'new');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/training\//);
  await expect.poll(async () => (await trainingState(page)).occurrences[0].rounds[0].movements
    .map(({ movement_key: key, catalogued }) => `${key}:${catalogued}`)).toEqual(['armada:true', 'galopanti:false']);
});

test('rates a round and a transition from the training page', async ({ page }) => {
  await seedAccount(page);
  await logRound(page, '10x armada, au');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/training\//);
  await page.locator('[data-action="rate"]').click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('radio', { name: 'Hard' }).first().check();
  await sheet.getByRole('button', { name: 'Rate parts' }).click();
  await sheet.getByRole('button', { name: 'Transition Armada → Aú' }).click();
  await sheet.locator('[data-segment-editor]').getByRole('radio', { name: 'Hard' }).check();
  await sheet.getByRole('button', { name: 'Save ratings' }).click();
  await expect(sheet.getByText('Ratings saved.')).toBeVisible();
  await expect.poll(async () => Object.values((await trainingState(page)).roundRatings)
    .flatMap((byRound) => Object.values(byRound).flat())
    .map(({ segment_key: key, difficulty }) => `${key}:${difficulty}`).sort()).toEqual(['r:hard', 't:1>2:hard']);
});

test('adds a summary file from the training page', async ({ page }) => {
  await seedAccount(page);
  await logRound(page, 'ginga 10 min');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/training\//);
  await page.locator('[data-action="add"]').click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Resource type').selectOption('summary');
  await sheet.getByLabel('Text files (.txt, .md)').setInputFiles({
    name: 'class-notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Class notes\n- ginga'),
  });
  await sheet.getByRole('button', { name: 'Save resources' }).click();
  await expect(sheet.getByText('Resources saved.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /class-notes\.md/ })).toBeVisible();
});

test('imports browser sequences once and logs one from Repertoire', async ({ page }) => {
  await seedAccount(page, { extra: { 'roda.seqs': [[{ c: 'golpes', n: 'Armada' }, { c: 'floreios', n: 'Aú' }]] } });
  await page.goto('/app#/me/repertoire');
  await expect(page.locator('.repertoire-text')).toHaveText(['Armada, Aú']);
  await page.reload();
  await expect(page.locator('.repertoire-text')).toHaveCount(1);
  await page.getByRole('button', { name: 'Log', exact: true }).click();
  await expect(page).toHaveURL(/#\/log$/);
  await expect(page.locator('textarea[data-round-text]').first()).toHaveValue('Armada, Aú');
});

test('Calendar speaks Portuguese', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
  await page.goto('/app?demo=1#/me/settings');
  await page.getByRole('button', { name: 'Português' }).click();
  await page.goto('/app?demo=1#/calendar');
  await expect(page.getByRole('heading', { name: /outubro de 2026/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mês seguinte' })).toBeVisible();
  await expect(page.locator('.cal-legend')).toContainText('Sozinho');
});

test('Calendar fits a phone and sits beside the training on desktop', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
  await page.goto('/app?demo=1#/calendar');
  await expect(page.locator('.cal-day')).toHaveCount(35);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.locator('.cal-day:has(.cal-dot:not(.upcoming))').first().click();
  await page.getByRole('dialog').locator('.day-item').first().click();
  await expect(page).toHaveURL(/#\/training\//);
  if (testInfo.project.name.includes('mobile')) {
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden();
  } else {
    const month = await page.locator('#appMain .cal-grid').boundingBox();
    const detail = await page.locator('#appDetail').boundingBox();
    expect(detail.x).toBeGreaterThanOrEqual(month.x + month.width - 1);
  }
});

test('a failed startup offers Try again and then opens Today', async ({ page }) => {
  await seedAccount(page, { extra: { 'roda.e2e.failProfileLoads': 1 } });
  await page.goto('/app');
  await expect(page.getByText('The profile could not be loaded.')).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.week-day')).toHaveCount(7);
});
```

- [ ] **Step 2: Run them**

Run: `npm run build:test && npx playwright test tests/e2e/app-switch-over.spec.js`
Expected: PASS in both projects. If a test fails, it shows an old capability the app lost: fix the named screen (`src/app/screens/log.js`, `training.js`, `calendar.js`, or `repertoire.js`) in this task, re-run, and mention the fix in the commit message.

- [ ] **Step 3: Confirm the audit rows now have their tests**

Run: `grep -c "^test(" tests/e2e/app-switch-over.spec.js`
Expected: `13`.

- [ ] **Step 4: Run the suites**

Run: `npm run test:unit && npm run test:e2e`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/app-switch-over.spec.js
git commit -m "test: port the old dashboard's browser checks to the app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Sign-in lands on `/app`; `/dashboard` forwards there

**Files:**
- Modify: `dashboard.html` (replaced by a stub), `auth/callback.html`, `src/app/auth-service.js`, `src/app/return-route.js`, `src/app/entries/public-auth.js`, `src/app/ui/auth-dialog.js`, `tests/unit/switch-over-parity.test.js`, `tests/unit/auth-dialog.test.js`, `tests/unit/return-route.test.js`
- Rename: `tests/e2e/auth-dashboard.spec.js` → `tests/e2e/auth.spec.js` (rewritten)
- Delete: `tests/e2e/{catalog-curation,coaching-connections,coaching-training,group-flows,past-class,repertoire,training-calendar,training-resources,training-statistics}.spec.js`
- Test: `tests/unit/pages.test.js` (create), `tests/e2e/app-redirect.spec.js` (create)

**Interfaces:**
- Consumes: everything in Tasks 1–8.
- Produces: `/dashboard` and `/dashboard.html` forward to `/app` with the same query and hash; every sign-in default is `/app`; `PORTS_DONE = true`.

- [ ] **Step 1: Write the failing tests and close the gate**

In `tests/unit/switch-over-parity.test.js`, set `const PORTS_DONE = true;`.

In `tests/unit/auth-dialog.test.js`, change `expect(navigate).toHaveBeenCalledWith('/dashboard?demo=1');` to `'/app?demo=1'` and `expect(navigations).toEqual(['/dashboard']);` to `['/app']`. In `tests/unit/return-route.test.js`, change the two fallback expectations `.toBe('/dashboard')` (the rejected-route `it.each` and `'stores only a sanitized local route'`) to `.toBe('/app')`, and add:

```js
  it('keeps an old dashboard link so it can forward to the app', () => {
    expect(sanitizeReturnRoute('/dashboard?member_invite=abc')).toBe('/dashboard?member_invite=abc');
  });
```

```js
// tests/unit/pages.test.js
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('app pages', () => {
  it('serves the app at /app', async () => {
    const html = await readFile('app.html', 'utf8');
    expect(html).toContain('<script type="module" src="/assets/generated/app.js"></script>');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
  });

  it('turns /dashboard into a forward that keeps the query and the hash', async () => {
    const html = await readFile('dashboard.html', 'utf8');
    expect(html).toContain("location.replace('/app' + location.search + location.hash)");
    expect(html).toContain('<meta http-equiv="refresh" content="0; url=/app">');
    expect(html).not.toContain('type="module"');
    expect(html).not.toContain('<dialog');
  });

  it('sends a failed sign-in back to the app, not the old dashboard', async () => {
    const html = await readFile('auth/callback.html', 'utf8');
    expect(html).toContain('<a href="/app">Open Roda</a>');
    expect(html).not.toContain('href="/dashboard"');
  });
});
```

```js
// tests/e2e/app-redirect.spec.js
import { expect, test } from '@playwright/test';

import { seedAccount } from './app-helpers.js';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
});

test('an old /dashboard link opens the same screen in the app', async ({ page }) => {
  await page.goto('/dashboard?demo=1#/training/demo-group-1');
  await expect(page).toHaveURL(/\/app\?demo=1#\/training\/demo-group-1$/);
  await expect(page.locator('.tag').first()).toContainText('⏱');
});

test('/dashboard.html forwards too', async ({ page }) => {
  await page.goto('/dashboard.html?demo=1#/calendar');
  await expect(page).toHaveURL(/\/app\?demo=1#\/calendar$/);
  await expect(page.locator('.cal-day')).toHaveCount(35);
});

test('an old invitation link survives sign-in and opens in the app', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/dashboard?member_invite=member-valid');
  await expect(page).toHaveURL(/\?next=%2Fapp%3Fmember_invite%3Dmember-valid$/);
  await seedAccount(page, { extra: { 'roda.e2e.groupState': {
    groups: [{ id: 'group-lua', slug: 'grupo-lua', owner_id: 'owner-1', name: 'Grupo Lua', description: null, location: 'Lisbon', picture_path: null, is_discoverable: true, archived_at: null }],
    invitationTokens: { 'member-valid': { state: 'pending', group: { id: 'group-lua', name: 'Grupo Lua' } } },
  } } });
  await page.goto('/dashboard?member_invite=member-valid');
  await expect(page.getByRole('dialog', { name: 'Group invitation' })).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/pages.test.js tests/unit/switch-over-parity.test.js tests/unit/auth-dialog.test.js tests/unit/return-route.test.js && npm run build:test && npx playwright test tests/e2e/app-redirect.spec.js`
Expected: FAIL — `dashboard.html` is the old page, defaults are `/dashboard`, the audit reports the missing `auth.spec.js` titles and the stray old specs, and the browser stays on `/dashboard`.

- [ ] **Step 3: Forward `/dashboard` and point every sign-in at `/app`**

Replace `dashboard.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Roda</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <!-- The app lives at /app. Keep the query (demo, invitations, group links)
       and the hash route, which never reaches the server, so old links and
       bookmarks keep working. -->
  <script>location.replace('/app' + location.search + location.hash);</script>
  <noscript><meta http-equiv="refresh" content="0; url=/app"></noscript>
</head>
<body>
  <p><a href="/app">Open Roda</a></p>
</body>
</html>
```

`auth/callback.html`: change `<a href="/dashboard">Go to dashboard</a>` to `<a href="/app">Open Roda</a>`.

`src/app/auth-service.js`: change both defaults `next = '/dashboard'` (in `signInWithGoogle` and `sendEmailLink`) to `next = '/app'`.

`src/app/return-route.js`: change `sanitizeReturnRoute`'s default `fallback = '/dashboard'` and the `consumeReturnRoute` fallback `'/dashboard'` to `'/app'`.

`src/app/entries/public-auth.js`: in `intendedRoute`, change `'/dashboard'` to `'/app'`.

`src/app/ui/auth-dialog.js`: change the default `returnRoute = () => '/dashboard'` to `() => '/app'`, `navigate('/dashboard')` to `navigate('/app')`, and `navigate('/dashboard?demo=1')` to `navigate('/app?demo=1')`.

Check nothing else sends people to the old page:

```bash
grep -rn "'/dashboard\|\"/dashboard\|href=\"/dashboard" src auth app.html
```

Expected: only `src/app/entries/dashboard.js` and the old `src/app/ui/*-view.js` files (deleted in Task 10).

- [ ] **Step 4: Keep the sign-in browser tests and delete the old dashboard's**

```bash
git mv tests/e2e/auth-dashboard.spec.js tests/e2e/auth.spec.js
git rm -q --ignore-unmatch tests/e2e/catalog-curation.spec.js tests/e2e/coaching-connections.spec.js tests/e2e/coaching-training.spec.js tests/e2e/group-flows.spec.js tests/e2e/past-class.spec.js tests/e2e/repertoire.spec.js tests/e2e/training-calendar.spec.js tests/e2e/training-resources.spec.js tests/e2e/training-statistics.spec.js
```

Replace `tests/e2e/auth.spec.js` with exactly:

```js
import { expect, test } from '@playwright/test';

// Seeded fixtures describe September 2026; pin the browser clock so month-relative views match.
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-24T12:00:00Z'));
});

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('keeps the movement library usable around one Google-first sign-in dialog', async ({ page }) => {
  const search = page.getByRole('searchbox', { name: 'Search moves' });
  await search.fill('bananeira');
  await expect(page.locator('article.card:visible')).toHaveCount(1);
  await expect(page.locator('article.card:visible')).toContainText('Bananeira');

  const entry = page.getByRole('button', { name: 'Sign in' });
  await expect(entry).toHaveCount(1);
  await expect(page.getByRole('button', { name: /register|login/i })).toHaveCount(0);
  await entry.click();

  const dialog = page.getByRole('dialog', { name: 'Sign in' });
  await expect(dialog).toBeVisible();
  const google = page.getByRole('button', { name: /Continue with Google.*Recommended/i });
  await expect(google).toBeFocused();
  await expect(google).toHaveClass(/auth-google/);

  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

  await google.click();
  await expect.poll(() => page.evaluate(() => window.__RODA_E2E_EVENTS__)).toEqual([
    { type: 'google', next: '/app' },
  ]);
  await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeDisabled();

  await expect(search).toHaveValue('bananeira');
  await expect(page.locator('article.card:visible')).toContainText('Bananeira');
});

test('offers passwordless email as the secondary sign-in method', async ({ page }) => {
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Email address').fill('student@example.com');
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();

  await expect(page.getByRole('status')).toContainText('Check your email');
  await expect.poll(() => page.evaluate(() => window.__RODA_E2E_EVENTS__)).toEqual([
    { type: 'email', email: 'student@example.com', next: '/app' },
  ]);
});

test('opens a seeded browser-only demo without an account', async ({ page }) => {
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Try demo' }).click();

  await expect(page).toHaveURL('/app?demo=1');
  await expect(page.getByRole('note')).toHaveText('Demo · browser only');
  await expect(page.locator('.week-day')).toHaveCount(7);
  await expect(page.locator('.recent-card').first()).toBeVisible();
});

test('shows Entrar only while Portuguese is selected', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

  await page.getByRole('button', { name: 'Português' }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('dialog', { name: 'Entrar' })).toBeVisible();

  await page.locator('#authClose').click();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('dialog', { name: 'Sign in' })).toBeVisible();
});

test('uses the same entry as a dashboard action for a signed-in account', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('roda.e2e.session', JSON.stringify({
    user: { id: 'practitioner-1', email: 'student@example.com' },
  })));
  await page.reload();

  const dashboard = page.getByRole('button', { name: 'Dashboard' });
  await expect(dashboard).toBeVisible();
  await dashboard.click();
  // No stored profile, so the welcome may open first.
  await expect(page).toHaveURL(/\/app(#\/[a-z/]*)?$/);
});

test('exchanges a callback once and returns to a safe local destination', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('roda.e2e.profile', JSON.stringify({
    id: 'practitioner-1', display_name: 'Ana Silva', avatar_path: null, usage_mode: 'train',
    timezone_override: null, leaderboard_visible: true, completed_at: '2026-09-11T20:00:00Z',
  })));
  await page.goto('/auth/callback?code=e2e-success&next=%2Fapp%3Fgroup_link%3Dsafe-token');

  await expect(page).toHaveURL(/\/app(#\/)?$/);
  await expect(page.getByRole('dialog', { name: 'Group link' })).toContainText('This group link is unavailable.');
  await expect.poll(() => page.evaluate(() => JSON.parse(
    localStorage.getItem('roda.e2e.session'),
  )?.user?.id)).toBe('practitioner-1');
});

test('scrubs callback data and exposes only safe retry routes on failure', async ({ page }) => {
  await page.goto('/auth/callback?code=e2e-failure&next=https://attacker.invalid&error=e2e');

  await expect(page).toHaveURL('/auth/callback');
  await expect(page.getByRole('alert')).toContainText('could not complete');
  await expect(page.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('link', { name: 'Open Roda' })).toHaveAttribute('href', '/app');
});

test('returns unauthenticated dashboard visits to the unified sign-in destination', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page).toHaveURL('/?next=%2Fapp');
  await expect(page.getByRole('dialog', { name: 'Sign in' })).toBeVisible();
});
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run tests/unit/pages.test.js tests/unit/switch-over-parity.test.js tests/unit/auth-dialog.test.js tests/unit/return-route.test.js tests/unit/auth-service.test.js && npm run build:test && npx playwright test`
Expected: PASS — every browser spec, including the redirect spec and `auth.spec.js`.

- [ ] **Step 6: Run the unit suite**

Run: `npm run test:unit`
Expected: PASS (the old views' unit tests still pass; their code is removed in Task 10).

- [ ] **Step 7: Commit**

```bash
git add -A dashboard.html auth/callback.html src/app/auth-service.js src/app/return-route.js src/app/entries/public-auth.js src/app/ui/auth-dialog.js tests/unit tests/e2e
git commit -m "feat: land every sign-in on /app and forward /dashboard links there

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Remove the old dashboard code

**Files:**
- Modify: `scripts/build.mjs`, `src/app/dashboard-i18n.js`, `tests/unit/pages.test.js`, `tests/unit/dashboard-i18n.test.js` (only if it used a removed key)
- Create: `tests/unit/dead-code.test.js`, `tests/unit/i18n-usage.test.js`, `tests/unit/helpers/i18n-usage.js`
- Delete: `src/app/entries/dashboard.js` and every module the dead-code test lists; the unit tests that import them; unused top-level stylesheets

**Interfaces:**
- Consumes: `allModules()` from Task 1.
- Produces (`tests/unit/helpers/i18n-usage.js`): `RETIRED_KEYS`, `unusedKeys() → Promise<string[]>`.

- [ ] **Step 1: Write the failing tests and drop the old entry**

In `scripts/build.mjs`, delete the line `dashboard: 'src/app/entries/dashboard.js',` from `ENTRY_POINTS`.

```js
// tests/unit/dead-code.test.js
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { allModules } from './helpers/module-graph.js';

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => (
    entry.isDirectory() ? sourceFiles(join(directory, entry.name)) : [join(directory, entry.name)]
  )));
  return nested.flat().filter((path) => path.endsWith('.js'));
}

describe('source tree', () => {
  it('has no module that no page or worker loads', async () => {
    const loaded = new Set(await allModules());
    expect((await sourceFiles('src')).filter((path) => !loaded.has(path)).sort()).toEqual([]);
  });
});
```

```js
// tests/unit/helpers/i18n-usage.js
import { readFile } from 'node:fs/promises';

import { DASHBOARD_STRINGS } from '../../../src/app/dashboard-i18n.js';
import { allModules } from './module-graph.js';

// Stopgap copy from Plan 1 that must not survive the switch-over.
export const RETIRED_KEYS = Object.freeze(['app.classic', 'app.comingSoon', 'app.completeProfile']);

export async function unusedKeys() {
  const files = (await allModules()).filter((path) => path !== 'src/app/dashboard-i18n.js');
  const text = (await Promise.all(files.map((path) => readFile(path, 'utf8')))).join('\n');
  // Keys built at runtime, such as `training.${difficulty}` or `errors.${code}`.
  const prefixes = [...text.matchAll(/`([a-zA-Z]+(?:\.[a-zA-Z]+)*\.)\$\{/g)].map((match) => match[1]);
  return Object.keys(DASHBOARD_STRINGS.en).filter((key) => RETIRED_KEYS.includes(key) || (
    !text.includes(`'${key}'`) && !text.includes(`"${key}"`) && !text.includes(`\`${key}\``)
    && !prefixes.some((prefix) => key.startsWith(prefix))
  ));
}
```

```js
// tests/unit/i18n-usage.test.js
import { describe, expect, it } from 'vitest';

import { unusedKeys } from './helpers/i18n-usage.js';

describe('copy', () => {
  it('ships only copy that some page or worker uses', async () => {
    expect(await unusedKeys()).toEqual([]);
  });
});
```

Add to `tests/unit/pages.test.js` (extend the imports with `readdir` and `stat` from `node:fs/promises`):

```js
  it('links stylesheets that exist and leaves none unused', async () => {
    const linked = new Set();
    for (const page of ['index.html', 'app.html', 'dashboard.html', 'studio.html', 'auth/callback.html']) {
      const html = await readFile(page, 'utf8');
      for (const match of html.matchAll(/<link rel="stylesheet" href="\/?(assets\/[^"]+\.css)"/g)) linked.add(match[1]);
    }
    for (const path of linked) await expect(stat(path)).resolves.toBeTruthy();
    const topLevel = (await readdir('assets')).filter((name) => name.endsWith('.css')).map((name) => `assets/${name}`);
    expect(topLevel.filter((path) => !linked.has(path))).toEqual([]);
  });
```

- [ ] **Step 2: Run to see what is dead**

Run: `npx vitest run tests/unit/dead-code.test.js tests/unit/i18n-usage.test.js tests/unit/pages.test.js`
Expected: FAIL. On `13a7db4` plus Tasks 1–9 the dead-code test lists exactly:

```text
src/app/dashboard-state.js
src/app/entries/dashboard.js
src/app/ui/coaching-training-view.js
src/app/ui/connection-view.js
src/app/ui/dashboard-view.js
src/app/ui/group-view.js
src/app/ui/past-class-view.js
src/app/ui/profile-view.js
src/app/ui/training-calendar-view.js
```

The copy test lists unused keys (the `dashboard.*` keys and others only those views used, plus the retired keys); the stylesheet test lists `assets/dashboard.css` and `assets/training-calendar.css`. Delete only what the tests print.

- [ ] **Step 3: Delete the dead modules and their unit tests**

```bash
DEAD="src/app/dashboard-state.js src/app/entries/dashboard.js src/app/ui/coaching-training-view.js src/app/ui/connection-view.js src/app/ui/dashboard-view.js src/app/ui/group-view.js src/app/ui/past-class-view.js src/app/ui/profile-view.js src/app/ui/training-calendar-view.js"
for path in $DEAD; do grep -l "/$(basename "$path")'" tests/unit/*.test.js; done | sort -u
```

Expected: `coaching-training-view.test.js`, `connection-view.test.js`, `dashboard-state.test.js`, `group-view.test.js`, `past-class-view.test.js`, `training-calendar-view.test.js` (under `tests/unit/`). If a test of a kept module appears, stop and inspect it: it means a kept module imports a dead one, which the dead-code test would have reported.

```bash
git rm -q $DEAD $(for path in $DEAD; do grep -l "/$(basename "$path")'" tests/unit/*.test.js; done | sort -u)
git rm -q assets/dashboard.css assets/training-calendar.css
```

- [ ] **Step 4: Delete unused copy from both locales**

```bash
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs';
const { unusedKeys } = await import('./tests/unit/helpers/i18n-usage.js');
const unused = new Set(await unusedKeys());
const path = 'src/app/dashboard-i18n.js';
const kept = readFileSync(path, 'utf8').split('\n').filter((line) => {
  const match = /^ {4}'([^']+)':/.exec(line);
  return !match || !unused.has(match[1]);
});
writeFileSync(path, kept.join('\n'));
console.log('removed', unused.size, 'keys from en and pt:', [...unused].join(' '));
"
```

Expected: a list including the `dashboard.*` keys and `app.classic`, `app.comingSoon`, `app.completeProfile`. If `tests/unit/dashboard-i18n.test.js` used a removed key (for example `connections.requested`), switch that assertion to a kept key with a placeholder, such as `today.attended` with `{ count: 3 }` (read its `en` and `pt` values from the file).

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run tests/unit/dead-code.test.js tests/unit/i18n-usage.test.js tests/unit/pages.test.js tests/unit/dashboard-i18n.test.js tests/unit/switch-over-parity.test.js`
Expected: PASS — including the parity audit, which proves every old service call is still made after the deletion.

- [ ] **Step 6: Run all suites and look for leftovers**

Run: `npm run test:unit && npm run test:e2e`
Expected: PASS.

```bash
grep -rnE "dashboard-view|training-calendar-view|coaching-training-view|connection-view|group-view|profile-view|past-class-view|dashboard-state|generated/dashboard\.js|dashboard\.css|training-calendar\.css" \
  --include='*.js' --include='*.mjs' --include='*.html' --include='*.json' \
  --exclude-dir=node_modules --exclude-dir=test-results --exclude-dir=generated .
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add -A scripts/build.mjs src tests assets
git commit -m "chore: remove the old dashboard views, entry, styles, tests, and copy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Group C — Time zones

### Task 11: Every time in the viewer's time zone

The product owner now lives in Washington and teaches or attends classes recorded in other zones. Today and Calendar already show the viewer's zone (`ctx.timezone`); the training page (`src/app/screens/training.js`) and the coach's class page (`timeOf` in `src/app/screens/class.js`) show the class's own zone, so the same class reads 14:00 on Today and 19:00 on its page.

**Files:**
- Create: `src/app/time-display.js`
- Modify: `src/app/screens/training.js`, `src/app/screens/class.js`, `src/app/dashboard-i18n.js`, `assets/app.css`
- Test: `tests/unit/time-display.test.js`, `tests/unit/training-screen.test.js`, `tests/unit/class-screen.test.js`, `tests/e2e/app-time-zones.spec.js`

**Interfaces:**
- Produces (`time-display.js`): `clockTime(locale, iso, timeZone) → string` (`'07:00 PM'`, `'19:00'`), `zonePlace(timeZone) → string` (`'Europe/Lisbon'` → `'Lisbon'`, `'America/Argentina/Buenos_Aires'` → `'Buenos Aires'`), `whenParts({ i18n, iso, viewerZone, classZone }) → { date, time, elsewhere }` where `date` and `time` are in `viewerZone` and `elsewhere` is `null` or the copy `time.inPlace` (`'{time} in {place}'`).
- Produces (DOM): the training and class pages render `p.training-elsewhere.muted` under `.training-meta` when `elsewhere` is not null.

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/time-display.test.js
import { describe, expect, it } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { clockTime, whenParts, zonePlace } from '../../src/app/time-display.js';

const i18n = (locale) => createDashboardI18n({ document: null, storage: { getItem: () => locale, setItem() {} }, navigator: { languages: [locale] } });

describe('time display', () => {
  it('names the place of a zone', () => {
    expect(zonePlace('Europe/Lisbon')).toBe('Lisbon');
    expect(zonePlace('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
    expect(zonePlace('UTC')).toBe('UTC');
  });

  it('formats a clock time in a zone', () => {
    expect(clockTime('en', '2026-10-08T18:00:00Z', 'America/New_York')).toBe('02:00 PM');
    expect(clockTime('pt', '2026-10-08T18:00:00Z', 'Europe/Lisbon')).toBe('19:00');
  });

  it('shows the viewer first and the class zone when its clock differs', () => {
    expect(whenParts({ i18n: i18n('en'), iso: '2026-10-08T18:00:00Z', viewerZone: 'America/New_York', classZone: 'Europe/Lisbon' }))
      .toEqual({ date: 'Thu, Oct 8', time: '02:00 PM', elsewhere: '07:00 PM in Lisbon' });
    expect(whenParts({ i18n: i18n('pt'), iso: '2026-10-08T18:00:00Z', viewerZone: 'America/New_York', classZone: 'Europe/Lisbon' }).elsewhere)
      .toBe('19:00 em Lisbon');
  });

  it('adds the weekday when the class zone is on another day', () => {
    expect(whenParts({ i18n: i18n('en'), iso: '2026-10-09T03:30:00Z', viewerZone: 'America/Los_Angeles', classZone: 'Europe/Lisbon' }))
      .toEqual({ date: 'Thu, Oct 8', time: '08:30 PM', elsewhere: 'Fri 04:30 AM in Lisbon' });
  });

  it('says nothing more when the zone or its clock is the same', () => {
    expect(whenParts({ i18n: i18n('en'), iso: '2026-10-08T18:00:00Z', viewerZone: 'Europe/Lisbon', classZone: 'Europe/Lisbon' }).elsewhere).toBeNull();
    expect(whenParts({ i18n: i18n('en'), iso: '2026-10-08T18:00:00Z', viewerZone: 'Europe/London', classZone: 'Europe/Lisbon' }).elsewhere).toBeNull();
    expect(whenParts({ i18n: i18n('en'), iso: '2026-10-08T18:00:00Z', viewerZone: 'Europe/Lisbon', classZone: null }).elsewhere).toBeNull();
  });
});
```

Add to `tests/unit/training-screen.test.js`:

```js
  it('shows the time in my zone and the class zone below it', async () => {
    const view = await renderTraining({ ...ctx({ getTraining: vi.fn().mockResolvedValue(base) }), timezone: 'America/New_York' }, { params: { id: 'o1' } });
    expect(view.querySelector('.training-meta').textContent).toContain('Sat, Sep 26 · 09:19 AM');
    expect(view.querySelector('.training-elsewhere').textContent).toBe('02:19 PM in Lisbon');
  });

  it('adds no extra line when I am in the class zone', async () => {
    const view = await renderTraining(ctx({ getTraining: vi.fn().mockResolvedValue(base) }), { params: { id: 'o1' } });
    expect(view.querySelector('.training-elsewhere')).toBeNull();
  });
```

Add to `tests/unit/class-screen.test.js` (inside `describe('class page', …)`):

```js
  it('shows the class time in my zone and its own zone below it', async () => {
    const training = { completeGroupTraining: vi.fn() };
    training.getScheduledClass = vi.fn().mockResolvedValue(base);
    training.createIdempotencyKey = vi.fn(() => 'k1');
    const ctx = appCtx({ services: { training }, timezone: 'America/New_York' });
    const view = await renderClass(ctx, { name: 'class', params: { id: 's1' }, query: {} });
    expect(view.querySelector('.training-meta').textContent).toContain('Sun, Oct 11 · 06:00 AM');
    expect(view.querySelector('.training-elsewhere').textContent).toBe('11:00 AM in Lisbon');
  });
```

```js
// tests/e2e/app-time-zones.spec.js
import { expect, test } from '@playwright/test';

test.use({ timezoneId: 'America/New_York' });

test('a Lisbon class shows my New York time first and its Lisbon time below', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
  // demo-group-1 happened on Oct 8 at 18:00 UTC, recorded in Europe/Lisbon.
  await page.goto('/app?demo=1#/training/demo-group-1');
  // \s also matches the narrow no-break space some browsers put before PM.
  await expect(page.locator('.training-meta')).toContainText(/Thu, Oct 8 · 02:00\sPM/);
  await expect(page.locator('.training-elsewhere')).toHaveText(/^07:00\sPM in Lisbon$/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/time-display.test.js tests/unit/training-screen.test.js tests/unit/class-screen.test.js && npm run build:test && npx playwright test tests/e2e/app-time-zones.spec.js`
Expected: FAIL — `time-display.js` does not exist; the pages show `02:19 PM` / `11:00 AM` / `07:00 PM` (the class zone) and no second line.

- [ ] **Step 3: Implement**

```js
// src/app/time-display.js
// Ruling 14: every time is in the viewer's zone. When a class was recorded in
// another zone whose clock differs, its own time is added as a quiet second line.
const LOCALES = Object.freeze({ en: 'en-US', pt: 'pt-PT' });
const localeOf = (locale) => LOCALES[locale] ?? 'en-US';

export function clockTime(locale, iso, timeZone) {
  return new Intl.DateTimeFormat(localeOf(locale), { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
}

export function zonePlace(timeZone) {
  return String(timeZone ?? '').split('/').pop().replace(/_/g, ' ');
}

function dayKey(iso, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(new Date(iso));
}

export function whenParts({ i18n, iso, viewerZone, classZone }) {
  const locale = i18n.locale();
  const date = i18n.formatDate(iso, { weekday: 'short', day: 'numeric', month: 'short', timeZone: viewerZone });
  const time = clockTime(locale, iso, viewerZone);
  let elsewhere = null;
  if (classZone && classZone !== viewerZone) {
    const there = clockTime(locale, iso, classZone);
    const sameDay = dayKey(iso, classZone) === dayKey(iso, viewerZone);
    if (there !== time || !sameDay) {
      const weekday = new Intl.DateTimeFormat(localeOf(locale), { weekday: 'short', timeZone: classZone }).format(new Date(iso));
      elsewhere = i18n.t('time.inPlace', { time: sameDay ? there : `${weekday} ${there}`, place: zonePlace(classZone) });
    }
  }
  return { date, time, elsewhere };
}
```

Copy — `en`: `'time.inPlace': '{time} in {place}',`; `pt`: `'time.inPlace': '{time} em {place}',`.

`assets/app.css`:

```css
.training-elsewhere { margin: -4px 0 6px; }
```

`src/app/screens/training.js`: import `{ whenParts }` from `'../time-display.js'` and replace the `time` and `meta` constants and the title/meta append with:

```js
  const when = whenParts({ i18n, iso: training.occurred_at, viewerZone: ctx.timezone, classZone: training.timezone });
  const meta = [when.date, when.time, training.kind === 'alone' ? null : training.coach_name].filter(Boolean).join(' · ');
  screen.append(el(document, 'h1', { className: 'training-title', text: titleFor(i18n, training) }),
    el(document, 'p', { className: 'training-meta muted', text: meta }));
  if (when.elsewhere) screen.append(el(document, 'p', { className: 'training-elsewhere muted', text: when.elsewhere }));
```

`src/app/screens/class.js`: delete `timeOf`, import `{ whenParts }` from `'../time-display.js'`, and build the meta from it:

```js
  const when = whenParts({ i18n, iso: data.starts_at, viewerZone: ctx.timezone, classZone: data.timezone });
  const meta = [
    when.date, when.time, i18n.t('today.youTeach'),
    data.plan_title ? i18n.t('classPage.plan', { title: data.plan_title }) : null,
  ].filter(Boolean).join(' · ');
```

and after the `p.training-meta` element in the `screen.append(…)` call, add `when.elsewhere ? el(document, 'p', { className: 'training-elsewhere muted', text: when.elsewhere }) : null,` (`el` skips `null` children; `screen.append` does not, so keep it inside an `el(...)` children array or append it separately with `if (when.elsewhere) screen.append(…)` right after).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/unit/time-display.test.js tests/unit/training-screen.test.js tests/unit/class-screen.test.js tests/unit/dashboard-i18n.test.js && npm run build:test && npx playwright test tests/e2e/app-time-zones.spec.js tests/e2e/app-training.spec.js tests/e2e/app-class.spec.js`
Expected: PASS.

- [ ] **Step 5: Run the suites**

Run: `npm run test:unit && npm run test:e2e`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/time-display.js src/app/screens/training.js src/app/screens/class.js src/app/dashboard-i18n.js assets/app.css tests/unit/time-display.test.js tests/unit/training-screen.test.js tests/unit/class-screen.test.js tests/e2e/app-time-zones.spec.js
git commit -m "fix: show class times in the viewer's zone, with the class's own time below

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Group D — Deferred minors from Plans 2–3

Each task starts with a failing test. None of these is made moot by the switch to `/app`: the release scan, copy, scheduling, Discover, calendar, and Teaching fixes all concern the app itself. Left deferred (Ruling 21): retrying Finish with different attendance; "Find on the map" choosing the first result; welcome step 3 sending empty contacts; a sent request to a non-discoverable group linking to an unavailable card.

### Task 12: The release scan runs against a real production build

**Files:**
- Modify: `docs/security-checklist.md`, `docs/auth-and-database-operations.md`
- Test: `tests/unit/release-scan.test.js` (create)

**Interfaces:**
- Consumes: `buildBrowserBundles({ outputDirectory })` from `scripts/build.mjs`.
- Produces: the documented scan pattern is the single source; the test reads it from `docs/security-checklist.md`.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/release-scan.test.js
// Runs the secret scan from docs/security-checklist.md against a production
// build, so the documented command and the shipped bundles cannot drift apart.
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildBrowserBundles } from '../../scripts/build.mjs';

async function documentedPattern() {
  const checklist = await readFile('docs/security-checklist.md', 'utf8');
  const match = /rg -n "([^"]+)" assets\/generated/.exec(checklist);
  return new RegExp(match[1]);
}

describe('release secret scan', () => {
  it('finds nothing in a production build', async () => {
    const pattern = await documentedPattern();
    const out = await mkdtemp(join(tmpdir(), 'roda-release-scan-'));
    const prior = { url: process.env.RODA_SUPABASE_URL, key: process.env.RODA_SUPABASE_PUBLISHABLE_KEY };
    process.env.RODA_SUPABASE_URL = 'https://example.supabase.co';
    process.env.RODA_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_release_scan';
    try {
      await buildBrowserBundles({ outputDirectory: out });
      const hits = [];
      for (const name of await readdir(out)) {
        if (pattern.test(await readFile(join(out, name), 'utf8'))) hits.push(name);
      }
      expect(hits).toEqual([]);
    } finally {
      if (prior.url === undefined) delete process.env.RODA_SUPABASE_URL;
      else process.env.RODA_SUPABASE_URL = prior.url;
      if (prior.key === undefined) delete process.env.RODA_SUPABASE_PUBLISHABLE_KEY;
      else process.env.RODA_SUPABASE_PUBLISHABLE_KEY = prior.key;
      await rm(out, { force: true, recursive: true });
    }
  }, 60000);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/release-scan.test.js`
Expected: FAIL with `['app.js']` (and possibly other bundles): demo mode's fake services set `window.__RODA_E2E_EVENTS__`.

- [ ] **Step 3: Narrow the scan (Ruling 15)**

In `docs/security-checklist.md` and in `docs/auth-and-database-operations.md` (step 6 of "Preview and production rollout"), change the command to:

```bash
rg -n "service_role|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|sb_publishable_e2e_test" assets/generated
```

and add one sentence after the checklist's command: "Demo mode ships the browser-only fake services on purpose, so their `__RODA_E2E_*` hooks are expected in production bundles; a test build is caught by `sb_publishable_e2e_test` instead. `tests/unit/release-scan.test.js` runs this exact pattern against a production build."

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/release-scan.test.js && npm run build:test`
Expected: PASS (the second command restores the test build of `app-sw.js`, which the production build in the test overwrote).

- [ ] **Step 5: Commit**

```bash
git add tests/unit/release-scan.test.js docs/security-checklist.md docs/auth-and-database-operations.md
git commit -m "test: run the documented secret scan against a production build

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Error messages in Portuguese, and "1 day"

**Files:**
- Modify: `src/app/errors.js`, `src/app/entries/app.js`, `src/app/dashboard-i18n.js`, `src/app/ui/statistics-view.js`
- Test: `tests/unit/errors.test.js`, `tests/unit/dashboard-i18n.test.js`, `tests/unit/statistics-view.test.js`

**Interfaces:**
- Produces (`errors.js`): `SAFE_CODES` (frozen list of the safe-message codes), `useErrorTranslations(i18n | null)`; while set, `new AppError(kind, code)` without a message and `toAppError(…)` take their message from `errors.<code>` (falling back to `errors.generic`, then to English).
- Produces (copy): `errors.<code>` for every code in `SAFE_CODES`, `errors.generic`, `statistics.dayOne`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/errors.test.js` (import `AppError`, `SAFE_CODES`, `toAppError`, `useErrorTranslations` from `'../../src/app/errors.js'` and `createDashboardI18n` from `'../../src/app/dashboard-i18n.js'`; add `afterEach(() => useErrorTranslations(null));`):

```js
  it('speaks the chosen language once the app passes its copy', () => {
    const pt = createDashboardI18n({ document: null, storage: { getItem: () => 'pt', setItem() {} }, navigator: { languages: ['pt'] } });
    useErrorTranslations(pt);
    expect(toAppError({ code: 'PT403' }).message).toBe('Não tens permissão para fazer isso.');
    expect(new AppError('network', 'network_failure').message).toBe('O pedido de rede falhou. Tenta novamente.');
    expect(new AppError('validation', 'something_new').message).toBe('Algo correu mal.');
    useErrorTranslations(null);
    expect(toAppError({ code: 'PT403' }).message).toBe('You do not have permission to do that.');
  });
```

Add to `tests/unit/dashboard-i18n.test.js` (import `AppError`, `SAFE_CODES` from `'../../src/app/errors.js'`):

```js
  it('translates every safe error message, keeping the English text', () => {
    for (const code of SAFE_CODES) {
      expect(DASHBOARD_STRINGS.en[`errors.${code}`]).toBe(new AppError('validation', code).message);
      expect(DASHBOARD_STRINGS.pt[`errors.${code}`]).toEqual(expect.any(String));
    }
    expect(DASHBOARD_STRINGS.pt['errors.generic']).toBe('Algo correu mal.');
  });
```

Add to `tests/unit/statistics-view.test.js`:

```js
  it('says "1 day" for a one-day streak', async () => {
    const api = service({ getPersonal: vi.fn().mockResolvedValue({ ...personal(), current_streak: 1 }) });
    await view(api).loadPersonal();
    const text = document.querySelector('#trainingStatisticsPanel').textContent;
    expect(text).toContain('1 day');
    expect(text).not.toContain('1 days');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/errors.test.js tests/unit/dashboard-i18n.test.js tests/unit/statistics-view.test.js`
Expected: FAIL — `useErrorTranslations` and `SAFE_CODES` do not exist; the streak reads "1 days".

- [ ] **Step 3: Implement**

`src/app/errors.js` — below `SAFE_MESSAGES`:

```js
export const SAFE_CODES = Object.freeze(Object.keys(SAFE_MESSAGES));

let translate = null;

// Ruling 16: the app passes its copy so these messages follow the chosen
// language; pages that never load it (sign-in, callback) keep English.
export function useErrorTranslations(i18n) {
  translate = i18n ? (code) => {
    try {
      return i18n.t(`errors.${code}`);
    } catch {
      return null;
    }
  } : null;
}

function safeMessage(code) {
  return translate?.(code) ?? SAFE_MESSAGES[code] ?? translate?.('generic') ?? 'Something went wrong.';
}
```

change the constructor default to `message = safeMessage(code)`, and in `toAppError` replace `new AppError(kind, code, SAFE_MESSAGES[code], { cause: error })` with `new AppError(kind, code, undefined, { cause: error })`.

`src/app/entries/app.js`: import `{ useErrorTranslations }` from `'../errors.js'` and call `useErrorTranslations(i18n);` right after `i18n` is created.

Copy — add to `en` (the English values are exactly today's `SAFE_MESSAGES`, plus Task 5's `idempotency_conflict`):

```js
    'errors.cancelled_training': 'This training was canceled.',
    'errors.connection_ended': 'This coaching connection has ended.',
    'errors.duplicate_completion': 'This training was already completed.',
    'errors.edit_conflict': 'This plan changed elsewhere. Reload it before saving again.',
    'errors.invalid_email': 'Enter a valid email address.',
    'errors.invalid_attendee': 'One or more attendees are not active group members.',
    'errors.invitation_expired': 'This invitation has expired.',
    'errors.missing_code': 'The sign-in response did not include a code.',
    'errors.missing_session': 'The sign-in response did not create a session.',
    'errors.network_failure': 'The network request failed. Please try again.',
    'errors.not_authenticated': 'Please sign in to continue.',
    'errors.not_authorized': 'You do not have permission to do that.',
    'errors.otp_expired': 'This sign-in link has expired.',
    'errors.published_plan_immutable': 'Published plans cannot be changed.',
    'errors.request_expired': 'This request has expired.',
    'errors.relationship_expired': 'This group invitation has expired.',
    'errors.idempotency_conflict': 'This item was already saved to another training.',
    'errors.generic': 'Something went wrong.',
    'statistics.dayOne': '{count} day',
```

`pt`:

```js
    'errors.cancelled_training': 'Este treino foi cancelado.',
    'errors.connection_ended': 'Esta ligação de treino terminou.',
    'errors.duplicate_completion': 'Este treino já foi concluído.',
    'errors.edit_conflict': 'Este plano mudou noutro lado. Recarrega-o antes de guardar outra vez.',
    'errors.invalid_email': 'Escreve um email válido.',
    'errors.invalid_attendee': 'Uma ou mais pessoas presentes não são membros ativos do grupo.',
    'errors.invitation_expired': 'Este convite expirou.',
    'errors.missing_code': 'A resposta de entrada não incluiu um código.',
    'errors.missing_session': 'A resposta de entrada não criou uma sessão.',
    'errors.network_failure': 'O pedido de rede falhou. Tenta novamente.',
    'errors.not_authenticated': 'Entra para continuar.',
    'errors.not_authorized': 'Não tens permissão para fazer isso.',
    'errors.otp_expired': 'Este link de entrada expirou.',
    'errors.published_plan_immutable': 'Planos publicados não podem ser alterados.',
    'errors.request_expired': 'Este pedido expirou.',
    'errors.relationship_expired': 'Este convite de grupo expirou.',
    'errors.idempotency_conflict': 'Este item já foi guardado noutro treino.',
    'errors.generic': 'Algo correu mal.',
    'statistics.dayOne': '{count} dia',
```

If `SAFE_MESSAGES` gained other codes since this plan was written, add each one to both blocks; the new copy test fails until they match.

`src/app/ui/statistics-view.js`, in the streak card:

```js
      statCard(i18n.t('statistics.streak'), i18n.t(
        (personalData.current_streak ?? 0) === 1 ? 'statistics.dayOne' : 'statistics.days',
        { count: personalData.current_streak ?? 0 },
      )),
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/unit/errors.test.js tests/unit/dashboard-i18n.test.js tests/unit/statistics-view.test.js`
Expected: PASS.

- [ ] **Step 5: Run the suites**

Run: `npm run test:unit && npm run test:e2e`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/errors.js src/app/entries/app.js src/app/dashboard-i18n.js src/app/ui/statistics-view.js tests/unit/errors.test.js tests/unit/dashboard-i18n.test.js tests/unit/statistics-view.test.js
git commit -m "fix: show error messages in Portuguese and say 1 day, not 1 days

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Scheduling a class twice creates one class

**Files:**
- Create: `supabase/migrations/202610250002_schedule_idempotency.sql`, `supabase/tests/0036_schedule_idempotency.test.sql`
- Modify: `src/app/training-service.js`, `src/app/testing/fake-services.js`, `src/app/screens/schedule-sheet.js`
- Test: `tests/unit/training-service.test.js`, `tests/unit/schedule-sheet.test.js`

**Interfaces:**
- Produces (SQL): `public.schedule_group_training(plan_version_id, group_id, starts_at, local_date, timezone, visible_in_advance default true, idempotency_key uuid default null)` and `public.schedule_personal_class(plan_version_id, student_profile_id, group_id, connection_id, starts_at, local_date, timezone, visible_in_advance default true, idempotency_key uuid default null)`; repeating `(caller, idempotency_key)` returns the first `{ status: 'scheduled', schedule_id }`.
- Produces (JS): `scheduleGroupTraining({ …, idempotencyKey })` and `schedulePersonalClass({ …, idempotencyKey })` send `idempotency_key: idempotencyKey ?? null`; the schedule sheet sends one key per form and makes a new one when any field changes.

- [ ] **Step 1: Write the failing database test**

```sql
-- supabase/tests/0036_schedule_idempotency.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_column('public', 'scheduled_trainings', 'idempotency_key', 'schedules remember their request key');
select has_function('public', 'schedule_group_training', array['uuid', 'uuid', 'timestamp with time zone', 'date', 'text', 'boolean', 'uuid']);
select has_function('public', 'schedule_personal_class', array['uuid', 'uuid', 'uuid', 'uuid', 'timestamp with time zone', 'date', 'text', 'boolean', 'uuid']);

select tests.create_user('10000000-0000-0000-0000-000000003601', 'coach36@example.test', 'Mestre Trinta Seis');
select tests.create_user('10000000-0000-0000-0000-000000003602', 'ana36@example.test', 'Ana Trinta Seis');
insert into public.coach_profiles (profile_id) values ('10000000-0000-0000-0000-000000003601');
insert into public.groups (id, owner_id, name, timezone)
values ('20000000-0000-0000-0000-000000003601', '10000000-0000-0000-0000-000000003601', 'Grupo Trinta Seis', 'Europe/Lisbon');
insert into public.group_memberships (group_id, profile_id, access_level) values
  ('20000000-0000-0000-0000-000000003601', '10000000-0000-0000-0000-000000003601', 'coach'),
  ('20000000-0000-0000-0000-000000003601', '10000000-0000-0000-0000-000000003602', 'member');
insert into public.coach_student_connections (
  id, coach_profile_id, student_profile_id, state, initiated_by, decided_at, decided_by
) values (
  '40000000-0000-0000-0000-000000003601', '10000000-0000-0000-0000-000000003601',
  '10000000-0000-0000-0000-000000003602', 'active', '10000000-0000-0000-0000-000000003602',
  now(), '10000000-0000-0000-0000-000000003601'
);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003601');
select public.create_workout_plan(
  'Armada ladder', null, null, 60, null,
  '[{"source_text":"10x (armada, au)","movements":[{"movement_key":"armada","movement_name":"Armada","segment_key":"m:1"}]}]'::jsonb
) ->> 'plan_id' as plan_id \gset
select public.publish_workout_plan(:'plan_id') ->> 'version_id' as version_id \gset

select public.schedule_group_training(:'version_id', '20000000-0000-0000-0000-000000003601',
  '2026-11-03T18:00:00Z', '2026-11-03', 'Europe/Lisbon', true, '70000000-0000-0000-0000-000000003601') ->> 'schedule_id' as first_id \gset
select is(
  public.schedule_group_training(:'version_id', '20000000-0000-0000-0000-000000003601',
    '2026-11-03T18:00:00Z', '2026-11-03', 'Europe/Lisbon', true, '70000000-0000-0000-0000-000000003601') ->> 'schedule_id',
  :'first_id', 'a retried group class returns the first class');
select is((select count(*)::integer from public.scheduled_trainings where arranged_by = '10000000-0000-0000-0000-000000003601'), 1,
  'the retry creates nothing');
select isnt(
  public.schedule_group_training(:'version_id', '20000000-0000-0000-0000-000000003601',
    '2026-11-04T18:00:00Z', '2026-11-04', 'Europe/Lisbon', true, '70000000-0000-0000-0000-000000003602') ->> 'schedule_id',
  :'first_id', 'a new key schedules a new class');
select public.schedule_group_training(:'version_id', '20000000-0000-0000-0000-000000003601',
  '2026-11-05T18:00:00Z', '2026-11-05', 'Europe/Lisbon', true);
select is((select count(*)::integer from public.scheduled_trainings where arranged_by = '10000000-0000-0000-0000-000000003601'), 3,
  'a call without a key still schedules');

select public.schedule_personal_class(:'version_id', '10000000-0000-0000-0000-000000003602', null,
  '40000000-0000-0000-0000-000000003601', '2026-11-06T18:00:00Z', '2026-11-06', 'Europe/Lisbon', true,
  '70000000-0000-0000-0000-000000003603') ->> 'schedule_id' as personal_id \gset
select is(
  public.schedule_personal_class(:'version_id', '10000000-0000-0000-0000-000000003602', null,
    '40000000-0000-0000-0000-000000003601', '2026-11-06T18:00:00Z', '2026-11-06', 'Europe/Lisbon', true,
    '70000000-0000-0000-0000-000000003603') ->> 'schedule_id',
  :'personal_id', 'a retried personal class returns the first class');

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx supabase test db supabase/tests/0036_schedule_idempotency.test.sql`
Expected: FAIL — `has_column` fails.

- [ ] **Step 3: Write the migration and apply it**

```sql
-- supabase/migrations/202610250002_schedule_idempotency.sql
-- A timed-out "Schedule a class" retried by the coach must not create a second
-- class. The existing private schedulers stay; a thin "once" layer remembers
-- the request key.
alter table public.scheduled_trainings add column idempotency_key uuid;
create unique index scheduled_trainings_idempotency_idx
  on public.scheduled_trainings (arranged_by, idempotency_key) where idempotency_key is not null;

create function private.scheduled_once(actor_id uuid, target_key uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('status', 'scheduled', 'schedule_id', schedule.id)
    from public.scheduled_trainings schedule
   where target_key is not null
     and schedule.arranged_by = actor_id
     and schedule.idempotency_key = target_key;
$$;

create function private.remember_schedule_key(target_schedule_id uuid, target_key uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.scheduled_trainings set idempotency_key = target_key
   where id = target_schedule_id and target_key is not null;
$$;

create function private.schedule_group_training_once(
  actor_id uuid, target_key uuid, target_plan_version_id uuid, target_group_id uuid,
  target_starts_at timestamptz, target_local_date date, target_timezone text, target_visible_in_advance boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if target_key is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text || target_key::text, 0));
    result := private.scheduled_once(actor_id, target_key);
    if result is not null then
      return result;
    end if;
  end if;
  result := private.schedule_group_training(
    actor_id, target_plan_version_id, target_group_id, target_starts_at, target_local_date,
    target_timezone, target_visible_in_advance
  );
  perform private.remember_schedule_key((result ->> 'schedule_id')::uuid, target_key);
  return result;
end;
$$;

create function private.schedule_personal_class_once(
  actor_id uuid, target_key uuid, target_plan_version_id uuid, target_student_profile_id uuid,
  target_group_id uuid, target_connection_id uuid, target_starts_at timestamptz, target_local_date date,
  target_timezone text, target_visible_in_advance boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if target_key is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text || target_key::text, 0));
    result := private.scheduled_once(actor_id, target_key);
    if result is not null then
      return result;
    end if;
  end if;
  result := private.schedule_personal_class(
    actor_id, target_plan_version_id, target_student_profile_id, target_group_id, target_connection_id,
    target_starts_at, target_local_date, target_timezone, target_visible_in_advance
  );
  perform private.remember_schedule_key((result ->> 'schedule_id')::uuid, target_key);
  return result;
end;
$$;

drop function public.schedule_group_training(uuid, uuid, timestamptz, date, text, boolean);
drop function public.schedule_personal_class(uuid, uuid, uuid, uuid, timestamptz, date, text, boolean);

create function public.schedule_group_training(
  plan_version_id uuid, group_id uuid, starts_at timestamptz, local_date date, timezone text,
  visible_in_advance boolean default true, idempotency_key uuid default null
)
returns jsonb language sql set search_path = ''
as $$
  select private.schedule_group_training_once(
    auth.uid(), idempotency_key, plan_version_id, group_id, starts_at, local_date, timezone, visible_in_advance
  );
$$;

create function public.schedule_personal_class(
  plan_version_id uuid, student_profile_id uuid, group_id uuid, connection_id uuid, starts_at timestamptz,
  local_date date, timezone text, visible_in_advance boolean default true, idempotency_key uuid default null
)
returns jsonb language sql set search_path = ''
as $$
  select private.schedule_personal_class_once(
    auth.uid(), idempotency_key, plan_version_id, student_profile_id, group_id, connection_id,
    starts_at, local_date, timezone, visible_in_advance
  );
$$;

revoke execute on function private.scheduled_once(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.remember_schedule_key(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.schedule_group_training_once(uuid, uuid, uuid, uuid, timestamptz, date, text, boolean) from public, anon, authenticated;
revoke execute on function private.schedule_personal_class_once(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, date, text, boolean) from public, anon, authenticated;
grant execute on function private.scheduled_once(uuid, uuid) to authenticated;
grant execute on function private.remember_schedule_key(uuid, uuid) to authenticated;
grant execute on function private.schedule_group_training_once(uuid, uuid, uuid, uuid, timestamptz, date, text, boolean) to authenticated;
grant execute on function private.schedule_personal_class_once(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, date, text, boolean) to authenticated;
revoke execute on function public.schedule_group_training(uuid, uuid, timestamptz, date, text, boolean, uuid) from public, anon, authenticated;
revoke execute on function public.schedule_personal_class(uuid, uuid, uuid, uuid, timestamptz, date, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.schedule_group_training(uuid, uuid, timestamptz, date, text, boolean, uuid) to authenticated;
grant execute on function public.schedule_personal_class(uuid, uuid, uuid, uuid, timestamptz, date, text, boolean, uuid) to authenticated;
```

Run: `npx supabase migration up --local && npx supabase test db supabase/tests/0036_schedule_idempotency.test.sql`
Expected: PASS.

- [ ] **Step 4: Write the failing client tests**

In `tests/unit/training-service.test.js`, add `idempotency_key: null` to the expected `schedule_personal_class` (and, if present, `schedule_group_training`) parameter objects, and add:

```js
  it('sends the schedule request key', async () => {
    const { client, calls } = harness();
    await createTrainingService(client).scheduleGroupTraining({
      planVersionId: 'v', groupId: 'g', startsAt: '2026-11-03T18:00:00Z', localDate: '2026-11-03',
      timezone: 'Europe/Lisbon', idempotencyKey: 'sk1',
    });
    expect(calls[0][1]).toMatchObject({ idempotency_key: 'sk1' });
  });
```

In `tests/unit/schedule-sheet.test.js`, give the group test's `training` mock `createIdempotencyKey: vi.fn(() => 'sk1')`, add `idempotencyKey: 'sk1'` to its expected `scheduleGroupTraining` call (and the matching `idempotencyKey` to the personal-class test's expectation, giving that mock a key too), and add:

```js
  it('retries a timed-out class with the same key and a changed class with a new one', async () => {
    const training = {
      createIdempotencyKey: vi.fn().mockReturnValueOnce('sk1').mockReturnValueOnce('sk2'),
      scheduleGroupTraining: vi.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue({ status: 'scheduled', schedule_id: 's9' }),
    };
    const ctx = appCtx({ services: { training } });
    openScheduleSheet(ctx, { teaching });
    const form = await sheetForm();
    form.querySelector('input[name="date"]').value = '2026-10-14';
    form.requestSubmit();
    await vi.waitFor(() => expect(training.scheduleGroupTraining).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(form.querySelector('button[type="submit"]').disabled).toBe(false));
    form.requestSubmit();
    await vi.waitFor(() => expect(training.scheduleGroupTraining).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(form.querySelector('button[type="submit"]').disabled).toBe(false));
    form.querySelector('input[name="time"]').value = '20:00';
    form.querySelector('input[name="time"]').dispatchEvent(new Event('input', { bubbles: true }));
    form.requestSubmit();
    await vi.waitFor(() => expect(training.scheduleGroupTraining).toHaveBeenCalledTimes(3));
    expect(training.scheduleGroupTraining.mock.calls.map(([input]) => input.idempotencyKey)).toEqual(['sk1', 'sk1', 'sk2']);
  });
```

- [ ] **Step 5: Run to verify they fail**

Run: `npx vitest run tests/unit/training-service.test.js tests/unit/schedule-sheet.test.js`
Expected: FAIL — no `idempotency_key` is sent and the sheet sends no key.

- [ ] **Step 6: Implement**

`src/app/training-service.js`: add `idempotency_key: input.idempotencyKey ?? null,` to both the `schedule_group_training` and `schedule_personal_class` parameter objects.

`src/app/testing/fake-services.js`: at the top of both fake `scheduleGroupTraining` and `schedulePersonalClass`, after the `isCoach` check:

```js
      const repeat = input.idempotencyKey
        && state.schedules.find((item) => item.arranged_by === actorId() && item.idempotency_key === input.idempotencyKey);
      if (repeat) return { status: 'scheduled', schedule_id: repeat.id };
```

and add `idempotency_key: input.idempotencyKey ?? null,` to each new `schedule` object.

`src/app/screens/schedule-sheet.js`, in `buildForm` right before `let busy = false;`:

```js
  // Ruling 17: one key per class; changing any field means a different class.
  const newKey = () => ctx.services.training.createIdempotencyKey?.() ?? null;
  let requestKey = newKey();
  form.addEventListener('input', () => { requestKey = newKey(); });
  form.addEventListener('change', () => { requestKey = newKey(); });
```

and add `idempotencyKey: requestKey,` to the `common` object.

- [ ] **Step 7: Run to verify they pass**

Run: `npx vitest run tests/unit/training-service.test.js tests/unit/schedule-sheet.test.js && npm run test:unit && npm run test:e2e && npm run test:db`
Expected: PASS (`0018_teaching_read_api.test.sql` still calls the schedulers with six or eight positional arguments, which the new default covers).

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/202610250002_schedule_idempotency.sql supabase/tests/0036_schedule_idempotency.test.sql src/app/training-service.js src/app/testing/fake-services.js src/app/screens/schedule-sheet.js tests/unit/training-service.test.js tests/unit/schedule-sheet.test.js
git commit -m "fix: schedule a class once even when a timed-out request is retried

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Discover search cap, map teardown, and the desktop panel

**Files:**
- Create: `supabase/migrations/202610250003_discover_search_cap.sql`, `supabase/tests/0037_discover_search_cap.test.sql`
- Modify: `src/app/screens/discover.js`, `src/app/entries/app.js`, `assets/app.css`
- Test: `tests/unit/discover-screen.test.js`

**Interfaces:**
- Produces (SQL): `public.discover_search(search_text, result_limit)` searches only the first 100 characters of `search_text`.
- Produces (JS): `releaseDiscoverMap()` exported from `src/app/screens/discover.js` destroys the live map but keeps the remembered view; the app calls it when it shows any route other than `discover`, `person`, or `group`. On desktop (`(min-width: 900px)`) the panel handle is disabled, has no `aria-expanded`, and the list is always open.

- [ ] **Step 1: Write the failing tests**

```sql
-- supabase/tests/0037_discover_search_cap.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select tests.create_user('10000000-0000-0000-0000-000000003701', 'owner37@example.test', 'Owner Trinta Sete');
select tests.create_user('10000000-0000-0000-0000-000000003702', 'viewer37@example.test', 'Viewer Trinta Sete');
insert into public.groups (id, owner_id, name, timezone, is_discoverable)
values ('20000000-0000-0000-0000-000000003701', '10000000-0000-0000-0000-000000003701',
        repeat('Lua', 33) || 'L', 'Europe/Lisbon', true);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003702');
select is(
  (select count(*)::integer from public.discover_search(repeat('Lua', 33) || 'L' || repeat(' and more words', 400), 20)
    where kind = 'group'),
  1, 'search reads only the first 100 characters, so a very long query still finds the group');
select is(
  (select count(*)::integer from public.discover_search(repeat('x', 100000), 20)), 0,
  'a huge query returns nothing instead of scanning with it');

reset role;
select * from finish();
rollback;
```

Add to `tests/unit/discover-screen.test.js` (import `releaseDiscoverMap` with `renderDiscover`):

```js
  it('lets go of the map when Discover is left, and keeps the view for next time', async () => {
    const { ctx, maps } = setup();
    await mount(ctx);
    maps[0].options.onMove({ bounds: WORLD.bounds, view: { lat: 38.7, lng: -9.1, zoom: 9 } });
    releaseDiscoverMap();
    releaseDiscoverMap();
    expect(maps[0].destroy).toHaveBeenCalledTimes(1);
    await mount(ctx);
    expect(maps[1].options.view).toEqual({ lat: 38.7, lng: -9.1, zoom: 9 });
  });

  it('shows the list without a toggle on desktop', async () => {
    const { ctx } = setup();
    ctx.window = Object.assign(Object.create(window), { matchMedia: vi.fn(() => ({ matches: true, addEventListener() {} })) });
    const view = await mount(ctx);
    const handle = view.querySelector('.discover-panel-handle');
    expect(handle.disabled).toBe(true);
    expect(handle.hasAttribute('aria-expanded')).toBe(false);
    expect(view.querySelector('.discover-panel').classList.contains('expanded')).toBe(true);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx supabase test db supabase/tests/0037_discover_search_cap.test.sql && npx vitest run tests/unit/discover-screen.test.js`
Expected: FAIL — the long query finds nothing; `releaseDiscoverMap` does not exist; the desktop handle is an enabled button with `aria-expanded="false"`.

- [ ] **Step 3: Implement**

```sql
-- supabase/migrations/202610250003_discover_search_cap.sql
-- Ruling 18: search only the first 100 characters. No city, person, or group
-- label is longer than 120, and a huge query must not be scanned with.
create or replace function public.discover_search(search_text text, result_limit integer default 20)
returns table (
  kind text, profile_id uuid, group_id uuid, label text, city text, region text, country text,
  lat numeric, lng numeric, person_count integer
)
language sql stable set search_path = ''
as $$ select * from private.discover_search(auth.uid(), left(search_text, 100), result_limit); $$;
```

Run: `npx supabase migration up --local`.

`src/app/screens/discover.js` — below `resetDiscoverMemory`:

```js
// Called by the app whenever another screen opens: Leaflet keeps listeners and
// timers alive until its map is removed.
export function releaseDiscoverMap() {
  activeMap?.destroy();
  activeMap = null;
}
```

and after the `setExpanded` function:

```js
  // On desktop the list is always shown, so the handle is only a label.
  const wide = ctx.window?.matchMedia?.('(min-width: 900px)');
  function syncWide() {
    if (wide?.matches) {
      handle.disabled = true;
      handle.removeAttribute('aria-expanded');
      panel.classList.add('expanded');
    } else {
      handle.disabled = false;
      setExpanded(panel.classList.contains('expanded'));
    }
  }
  wide?.addEventListener?.('change', syncWide);
  syncWide();
```

`assets/app.css`:

```css
.discover-panel-handle:disabled { color: inherit; opacity: 1; cursor: default; }
```

`src/app/entries/app.js`: import `{ releaseDiscoverMap }` from `'../screens/discover.js'` (it already imports `renderDiscover` from there) and, in `show(route)` right after the redirect check, add:

```js
    if (!['discover', 'person', 'group'].includes(route.name)) releaseDiscoverMap();
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx supabase test db supabase/tests/0037_discover_search_cap.test.sql && npx vitest run tests/unit/discover-screen.test.js && npm run build:test && npx playwright test tests/e2e/app-discover.spec.js`
Expected: PASS.

- [ ] **Step 5: Run all suites**

Run: `npm run test:unit && npm run test:e2e && npm run test:db`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/202610250003_discover_search_cap.sql supabase/tests/0037_discover_search_cap.test.sql src/app/screens/discover.js src/app/entries/app.js assets/app.css tests/unit/discover-screen.test.js
git commit -m "fix: cap Discover search, free the map when leaving, and keep the desktop list static

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: A removed coach stops seeing the group's classes

**Files:**
- Create: `supabase/migrations/202610250004_coach_calendar_access.sql`, `supabase/tests/0038_coach_calendar_access.test.sql`

**Interfaces:**
- Produces (SQL): `private.list_my_calendar` (same signature) lists a class the caller arranged only while `private.can_manage_schedule(caller, schedule)` is true.

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/0038_coach_calendar_access.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select tests.create_user('10000000-0000-0000-0000-000000003801', 'owner38@example.test', 'Owner Trinta Oito');
select tests.create_user('10000000-0000-0000-0000-000000003802', 'coach38@example.test', 'Coach Trinta Oito');
select tests.create_user('10000000-0000-0000-0000-000000003803', 'ana38@example.test', 'Ana Trinta Oito');
insert into public.coach_profiles (profile_id) values
  ('10000000-0000-0000-0000-000000003801'), ('10000000-0000-0000-0000-000000003802');
insert into public.groups (id, owner_id, name, timezone)
values ('20000000-0000-0000-0000-000000003801', '10000000-0000-0000-0000-000000003801', 'Grupo Trinta Oito', 'Europe/Lisbon');
insert into public.group_memberships (group_id, profile_id, access_level) values
  ('20000000-0000-0000-0000-000000003801', '10000000-0000-0000-0000-000000003801', 'coach'),
  ('20000000-0000-0000-0000-000000003801', '10000000-0000-0000-0000-000000003802', 'coach'),
  ('20000000-0000-0000-0000-000000003801', '10000000-0000-0000-0000-000000003803', 'member');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003802');
select public.create_workout_plan(
  'Armada ladder', null, null, 60, null,
  '[{"source_text":"10x (armada, au)","movements":[{"movement_key":"armada","movement_name":"Armada","segment_key":"m:1"}]}]'::jsonb
) ->> 'plan_id' as plan_id \gset
select public.publish_workout_plan(:'plan_id') ->> 'version_id' as version_id \gset
select public.schedule_group_training(:'version_id', '20000000-0000-0000-0000-000000003801',
  '2026-11-10T18:00:00Z', '2026-11-10', 'Europe/Lisbon', true) ->> 'schedule_id' as schedule_id \gset
select is((select count(*)::integer from public.list_my_calendar('2026-11-01', '2026-12-01') where item_id = :'schedule_id'), 1,
  'an active coach sees the class they arranged');

reset role;
update public.group_memberships set state = 'removed', ended_at = now(), ended_by = '10000000-0000-0000-0000-000000003801'
 where group_id = '20000000-0000-0000-0000-000000003801' and profile_id = '10000000-0000-0000-0000-000000003802';

select tests.set_actor('10000000-0000-0000-0000-000000003802');
select is((select count(*)::integer from public.list_my_calendar('2026-11-01', '2026-12-01') where item_id = :'schedule_id'), 0,
  'a removed coach no longer sees a class they can no longer open');

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx supabase test db supabase/tests/0038_coach_calendar_access.test.sql`
Expected: FAIL — the last assertion finds 1 (the "arranged but not a member" branch still lists it).

- [ ] **Step 3: Write the migration and apply it**

The body is `private.list_my_calendar` from `supabase/migrations/202610120002_teaching_read_api.sql` with one added condition (marked).

```sql
-- supabase/migrations/202610250004_coach_calendar_access.sql
-- Ruling 19: a coach's calendar lists only classes the coach can still open.
create or replace function private.list_my_calendar(actor_id uuid, range_start date, range_end_exclusive date)
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
  student_name text,
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
         own.coach_name, own.visible_in_advance, own.plan_title, null::text,
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
         schedule.visible_in_advance, plan.title, student.display_name, 'coach'::text, '[]'::jsonb
    from public.scheduled_trainings schedule
    join public.workout_plan_versions version on version.id = schedule.plan_version_id
    join public.workout_plans plan on plan.id = version.plan_id
    left join public.groups target_group on target_group.id = schedule.group_id
    left join public.profiles coach on coach.id = schedule.arranged_by
    left join public.profiles student on student.id = schedule.student_profile_id
   where schedule.arranged_by = actor_id
     and schedule.state = 'scheduled'
     and schedule.local_date >= range_start
     and schedule.local_date < range_end_exclusive
     -- Added by 202610250004: only classes the caller can still open.
     and private.can_manage_schedule(actor_id, schedule.id)
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
         true, plan.title, student.display_name, 'coach'::text, private.occurrence_resource_kinds(occurrence.id)
    from public.training_occurrences occurrence
    left join public.groups target_group on target_group.id = occurrence.group_id
    left join public.profiles coach on coach.id = occurrence.recorded_by
    left join public.profiles student on student.id = occurrence.student_profile_id
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
```

Before applying, compare this block with the function in `202610120002_teaching_read_api.sql` (for example `diff <(sed -n '/create function private.list_my_calendar/,/^\$\$;/p' supabase/migrations/202610120002_teaching_read_api.sql) <(sed -n '/create or replace function private.list_my_calendar/,/^\$\$;/p' supabase/migrations/202610250004_coach_calendar_access.sql)`): only the first line, the two added lines, and nothing else may differ. If a later migration already replaced `private.list_my_calendar`, copy that newest body instead and add the same two lines.

Run: `npx supabase migration up --local && npx supabase test db supabase/tests/0038_coach_calendar_access.test.sql supabase/tests/0018_teaching_read_api.test.sql`
Expected: PASS (0018's coach still sees their personal and group classes).

- [ ] **Step 4: Run all suites**

Run: `npm run test:db && npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202610250004_coach_calendar_access.sql supabase/tests/0038_coach_calendar_access.test.sql
git commit -m "fix: hide classes a removed coach can no longer open from their calendar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Teaching fixes — Finish beside Teaching, a class with only the coach, the demo owner

**Files:**
- Modify: `src/app/entries/app.js`, `src/app/screens/record-class.js`, `src/app/demo-data.js`, `src/app/dashboard-i18n.js`
- Test: `tests/unit/record-class.test.js`, `tests/unit/demo-data.test.js`, `tests/e2e/app-teaching.spec.js`

**Interfaces:**
- Produces: on desktop, a training opened from a class shown beside Teaching opens beside Teaching too (the left pane keeps `[data-teaching-home]`).
- Produces: Record a past class lists the coach as `input[name="attendee"][value="<own profile id>"]` labeled `record.you`, after the members, checked only when the group has no other members.
- Produces: the demo roster lists the demo owner with `access_level: 'coach'`; `DEMO_VERSION` becomes `'4'` so browsers holding the old demo data reseed.

- [ ] **Step 1: Write the failing tests**

Add to `tests/e2e/app-teaching.spec.js`:

```js
test('on desktop, finishing a class beside Teaching keeps Teaching on the left', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'desktop side-by-side only');
  await page.clock.setFixedTime(new Date('2026-10-26T19:30:00Z'));
  await page.goto('/app?demo=1#/me/teaching');
  await expect(page.locator('#appMain [data-teaching-home]')).toBeVisible();
  await page.evaluate(() => { location.hash = '#/class/demo-schedule'; });
  await page.locator('#appDetail').getByRole('button', { name: 'Finish class' }).click();
  await expect(page).toHaveURL(/#\/training\//);
  await page.keyboard.press('Escape');
  await expect(page.locator('#appMain [data-teaching-home]')).toBeVisible();
  await expect(page.locator('#appDetail .training-title')).toBeVisible();
});
```

In `tests/unit/record-class.test.js`, change `expect([...boxes].map((box) => box.value)).toEqual(['caio', 'duda']);` to `.toEqual(['caio', 'duda', 'me']);` and add:

```js
  it('lets a coach record a class when nobody else is in the group', async () => {
    const s = services();
    s.group.listRoster = vi.fn().mockResolvedValue([
      { profile_id: 'me', display_name: 'Ana Silva', access_level: 'coach', membership_state: 'active' },
    ]);
    const ctx = appCtx({ services: s });
    document.body.replaceChildren(await renderRecordClass(ctx));
    const boxes = document.querySelectorAll('input[name="attendee"]');
    expect([...boxes].map((box) => [box.value, box.checked])).toEqual([['me', true]]);
    expect(boxes[0].closest('label').textContent).toContain('You');
    send('ginga');
    document.querySelector('input[name="time"]').value = '10:00';
    save();
    await vi.waitFor(() => expect(ctx.navigate).toHaveBeenCalledWith('/training/o5'));
    expect(s.training.recordPastClass).toHaveBeenCalledWith(expect.objectContaining({
      attendees: [{ profileId: 'me', durationMinutes: 60 }],
    }), expect.any(Date));
  });
```

Add to `tests/unit/demo-data.test.js`:

```js
  it('lists the demo owner as a coach of the demo group', () => {
    const localStorage = storage();
    seedDemoData(localStorage, new Date('2026-09-22T12:00:00Z'));
    const groups = JSON.parse(localStorage.getItem('roda.e2e.groupState'));
    expect(groups.rosters['demo-group'].find(({ profile_id: id }) => id === 'practitioner-1').access_level).toBe('coach');
    expect(localStorage.getItem('roda.demo.version')).toBe('4');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/record-class.test.js tests/unit/demo-data.test.js && npm run build:test && npx playwright test tests/e2e/app-teaching.spec.js --project chromium-desktop`
Expected: FAIL — no "You" row; the demo owner is a member and the version is `'3'`; after Finish the left pane shows Me instead of Teaching.

- [ ] **Step 3: Implement**

`src/app/entries/app.js`, in `show(route)`, replace the `besideTeaching` constant with:

```js
    // Ruling R23 (Plan 2): a class, plan, or student opened from Teaching appears beside it on desktop,
    // and so does the training a class beside Teaching turns into when it is finished.
    const teachingOnLeft = layout.main.firstElementChild?.dataset.teachingHome !== undefined;
    const besideTeaching = desktop.matches && teachingOnLeft
      && ['class', 'teaching-plan', 'teaching-student', 'training'].includes(route.name);
```

`src/app/screens/record-class.js`, replace `renderAttendees` with:

```js
  function renderAttendees() {
    const members = (teaching.rosters[group.node.value] ?? []).filter((member) => member.access_level === 'member'
      && (member.membership_state ?? 'active') === 'active' && member.profile_id !== ctx.profile.id);
    const box = (value, checked, label) => {
      const input = el(document, 'input', { attrs: { type: 'checkbox', name: 'attendee', value } });
      input.checked = checked;
      return el(document, 'label', { className: 'check-row' }, [input, ` ${label}`]);
    };
    // Ruling 20: the coach can be the one attendee when nobody else is in the group.
    attendees.replaceChildren(el(document, 'legend', { text: i18n.t('record.attendees') }),
      ...members.map((member) => box(member.profile_id, true, member.display_name)),
      box(ctx.profile.id, !members.length, i18n.t('record.you')));
  }
```

Copy — `en`: `'record.you': 'You',`; `pt`: `'record.you': 'Tu',`.

`src/app/demo-data.js`: set `DEMO_VERSION = '4'` and change the roster row for `practitioner-1` to `access_level: 'coach'`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/unit/record-class.test.js tests/unit/demo-data.test.js && npm run build:test && npx playwright test tests/e2e/app-teaching.spec.js tests/e2e/app-class.spec.js tests/e2e/app-groups.spec.js`
Expected: PASS. If another browser test asserted the demo owner as a member of the demo group (a ranking or roster count), update that expectation to the owner's coach role and say so in the commit message.

- [ ] **Step 5: Run the suites**

Run: `npm run test:unit && npm run test:e2e`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/entries/app.js src/app/screens/record-class.js src/app/demo-data.js src/app/dashboard-i18n.js tests/unit/record-class.test.js tests/unit/demo-data.test.js tests/e2e/app-teaching.spec.js
git commit -m "fix: keep Teaching beside a finished class, let a coach record a class alone, and show the demo owner as coach

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Docs, production smoke checklist, and final verification

**Files:**
- Modify: `README.md`, `ROADMAP.md`, `docs/auth-and-database-operations.md`, `docs/training-platform-design-decisions.md`, `docs/security-checklist.md`

**Interfaces:**
- Consumes: the finished switch-over.
- Produces: documentation only.

- [ ] **Step 1: README**

In `README.md`, change the opening paragraph's "the authenticated dashboard uses" to "the signed-in app at `/app` uses", rename the subsection `### The new app (`/app`)` to `### The app (`/app`)`, replace its first sentence ("A mobile-first version of the dashboard is being built at `/app`: …") with "Signed-in people use a mobile-first app at `/app`: …" (keep the rest of the list), and add at the end of that subsection:

```markdown
Every sign-in lands on `/app`. The old address `/dashboard` forwards there and
keeps the rest of the link, so older bookmarks, invitation links, and group
links keep working. Times are shown in your own time zone; a class recorded in
another zone also shows its local time, for example "07:00 PM in Lisbon".
```

Change "Catalog curators see a Catalog tab listing uncatalogued words…" to "Catalog curators see Catalog under Me, listing uncatalogued words…".

- [ ] **Step 2: ROADMAP**

In `ROADMAP.md`, after the bullet list under "Delivered in the training-input increment", add:

```markdown
Delivered in the mobile-first app
(`docs/superpowers/specs/2026-10-11-mobile-first-app-design.md`), the only
signed-in app, at `/app`:

- Today, Calendar, Log training with a chat box, and a video-first training page,
- Teaching, Progress, Repertoire, Groups, Catalog, and Settings under Me,
- a Train · Both · Teach setting in place of the My Training / Coaching switch,
- Discover v1: people at city level and groups on an OpenStreetMap map, and
- an installable web app.
```

and add to the "Next:" list:

```markdown
- **App-store packaging** (Plan 5, Capacitor) and **offline data access**; the
  web app currently caches only its own files.
```

- [ ] **Step 3: Operations runbook**

In `docs/auth-and-database-operations.md`:

1. In the deployment table, change the first row's concern to `Static site, callback, the app at /app, service worker, browser bundles`.
2. Replace the paragraph ending "…it does not create another user." with: "The public movement library remains available without an account. Every signed-in account is a practitioner. Choosing Both or Teach in the app adds coaching to the same profile; it does not create another user."
3. In "Invitations and discovery links", change the last bullet to: "The app creates `/app?member_invite=…` and `/app?group_link=…` links; links shared earlier as `/dashboard?…` forward to `/app` with their query. Tokens survive sign-in through the `next` return route and are removed from the address bar as soon as the app starts; the token then waits in that tab's session storage until the invitation or group sheet opens."
4. In smoke test 2, change "profile/dashboard" to "welcome or the app"; in smoke test 8, change "private dashboard surface" to "private app screens"; in "Preview and production rollout" step 5, change "and then `/dashboard`" to "and then `/app`".
5. Add this section before "## Preview and production rollout":

````markdown
## App switch-over (2026-10)

`/app` is the only signed-in app. Every sign-in defaults to `/app`;
`dashboard.html` is a small page that forwards `/dashboard` to `/app` with the
same query and hash; keep it so old bookmarks and shared links keep working.
The service worker (`/app-sw.js`, scope `/app`) and the manifest did not move.

Production smoke checklist after deploying the switch-over:

1. `curl -s https://roda.fyi/dashboard | grep -c "location.replace('/app'"`
   prints 1, and `curl -s https://roda.fyi/app | grep -c 'assets/generated/app.js'`
   prints 1.
2. Open `https://roda.fyi/dashboard#/calendar` → the address becomes
   `https://roda.fyi/app#/calendar` and the month shows.
3. Sign in with Google and with an email link from the public site → both land
   on `/app` (or the welcome, for a new account).
4. Open `https://roda.fyi/app?demo=1` → "Demo · browser only" and Today.
5. In a private window, open `https://roda.fyi/app#/me/settings` → sign in →
   you return to Settings.
6. Create a member invitation in a group page; the link starts with
   `https://roda.fyi/app?member_invite=`. Open it in a private window, sign in,
   accept once; the address bar never shows the token after the app opens.
   Open it again → "already been used". Repeat with an old
   `/dashboard?member_invite=…` link → same result.
7. Create a discovery link for an unlisted group, open it signed in → the
   group sheet, request access; the request appears for the group's coach.
8. With the device or profile time zone set to America/New_York, open a class
   recorded in Europe/Lisbon → the page shows the New York time first and
   "… in Lisbon" below it; Today shows the same New York time.
9. Add a resource on a training page while offline (developer tools) so it
   waits to sync; still offline, sign out from Settings → "1 item is still
   waiting to sync — connect to the internet and try again" and you stay
   signed in. Go online, tap Try again → signed out; after signing back in,
   the resource is on the training.
10. Schedule a class, throttle the network until the request times out, and
    tap Schedule again → only one class appears in Teaching and Calendar.
11. On a phone, log a training whose round contains a long pasted link → the
    page never scrolls sideways.
12. Switch to Português, go offline in developer tools, and save Notes on a
    training → the error reads "O pedido de rede falhou. Tenta novamente."
13. Run the bundle scan from the security checklist on the production build;
    it prints nothing.

Rollback: use Vercel's instant rollback to the previous deployment. The four
`2026102500NN` migrations only add columns, defaulted arguments, a search cap,
and a calendar filter, so earlier code keeps working against them.
````

- [ ] **Step 4: Design decisions and security checklist**

In `docs/training-platform-design-decisions.md`, at the end of "Decision 3: Universal practitioner accounts and dashboard modes", add:

```markdown
**Update (2026-10):** the mobile-first app at `/app` replaced the binary switch
with a Train · Both · Teach setting stored on the profile. It changes emphasis
(what **+** does, which Today cards come first, whether Teaching is listed under
Me, and the default Discover visibility), never access. Choosing Both or Teach
creates the coach profile; choosing Train never deletes plans, groups, or
students. See `docs/superpowers/specs/2026-10-11-mobile-first-app-design.md`.
```

In `docs/security-checklist.md`, replace the item "Coaches remain practitioners and can record their own training; Coaching is an explicit binary mode, not a separate account." with:

```markdown
- [ ] Coaches remain practitioners and can record their own training; teaching
  is a Train · Both · Teach setting on the same profile, not a separate
  account, and changing it never removes access or data.
```

and add under "Product privacy and behavior":

```markdown
- [ ] Signing out sends every resource still waiting to sync first; if one
  cannot be sent, the person stays signed in and nothing is deleted.
```

- [ ] **Step 5: Full verification from a clean build**

Run:

```bash
npm run build
npm run test:unit
npm run test:e2e
npm run test:db
npm run build
rg -n "service_role|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|sb_publishable_e2e_test" assets/generated
git diff --check
git status --short
```

Expected: every suite passes; the `rg` scan prints nothing; `git diff --check` prints nothing; `git status --short` lists only the documentation files from this task.

- [ ] **Step 6: Check the acceptance criteria**

Each spec acceptance criterion must point to a passing test:

| Criterion | Evidence |
|-----------|----------|
| 1 Phone screens fit, logging one tap away | `app-shell.spec.js`, `app-hardening.spec.js › very long words wrap…` |
| 2 Today | `app-today.spec.js`, `today-state.test.js` |
| 3 Log training survives failure and reload | `app-log.spec.js › keeps a draft across reloads`, `app-switch-over.spec.js › a failed save…`, `app-hardening.spec.js › saving again after a reload…` |
| 4 Training page | `app-training.spec.js`, `app-time-zones.spec.js`, `app-switch-over.spec.js › adds a summary file…` |
| 5 Coaches finish a class | `app-class.spec.js`, `app-teaching.spec.js › on desktop, finishing a class beside Teaching…` |
| 6 Calendar | `app-calendar.spec.js`, `app-switch-over.spec.js › Calendar fits a phone…` |
| 7 Train · Both · Teach | `app-mode.spec.js › the mode changes + and Teaching in Me without removing coaching` |
| 8 Discover | `app-discover.spec.js` |
| 9 Desktop sidebar and side by side | `app-switch-over.spec.js › Calendar fits a phone and sits beside the training on desktop`, `app-discover.spec.js › keeps the map beside an open card on desktop` |
| 10 Home screen | `manifest.test.js`, `cache-policy.test.js`, `service-worker.test.js` |
| 11 Suites pass | Step 5 |

If a row has no passing test, stop and report it.

- [ ] **Step 7: Commit**

```bash
git add README.md ROADMAP.md docs/auth-and-database-operations.md docs/training-platform-design-decisions.md docs/security-checklist.md
git commit -m "docs: describe /app as the only signed-in app and the switch-over smoke checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
