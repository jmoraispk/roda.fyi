# Mobile App Plan 4: Switch-Over

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the new mobile-first app at `/dashboard`, forward `/app` there without losing links or installed home-screen apps, delete the old dashboard and its tests once a test proves nothing is lost, and fix Plan 1's deferred review findings (spec increment 7).

**Architecture:** First, a parity audit test acts as a gate: every service call, query parameter, and browser test of the old dashboard must have a home in the new app (built by Plans 1–3) before anything is deleted. A group of small fixes closes Plan 1's open review findings. Then `dashboard.html` becomes the app shell that loads `assets/generated/app.js`, `app.html` becomes a client-side redirect stub that keeps the query and hash, the service worker moves to `/dashboard-sw.js` (scope `/dashboard`), and `/app-sw.js` becomes a worker that deletes the old caches and unregisters itself. Finally, a module-graph test lists every source file no page loads, and those files, their tests, their copy, and their stylesheets are removed.

**Tech Stack:** Vanilla ES modules + esbuild (its metafile is used for the module graph), Vitest + jsdom, Playwright, Supabase Postgres + pgTAP, Vercel static hosting with `cleanUrls`.

**Spec:** `docs/superpowers/specs/2026-10-11-mobile-first-app-design.md` (sections Routes, Installable web app, Implementation Approach, Delivery Increments item 7, Acceptance Criteria).

This is plan 4 of 4. It runs after Plan 2 (`docs/superpowers/plans/2026-10-12-mobile-app-plan-2-teaching-me-onboarding.md`) and Plan 3 (`docs/superpowers/plans/2026-10-12-mobile-app-plan-3-discover.md`) have merged. It is written against the spec's end state, not against those plans' exact code: where it edits code that Plans 2–3 may have reshaped (`src/app/entries/app.js`, `src/app/shell/layout.js`, `app.html`), steps name an anchor to find, not a line number.

## Global Constraints

- **Gate:** if Task 1's parity audit fails on a row owned by Plan 1, 2, or 3, stop and report BLOCKED with the failing rows. Do not build missing screens in this plan.
- Every task leaves `npm run test:unit` and `npm run test:e2e` passing; tasks that touch SQL also leave `npm run test:db` passing.
- Do not modify `tools/` (including `tools/serve.py`), `assets/figure3d.js`, or `assets/moves3d/`. This plan does not modify `index.html` at all.
- Follow `docs/security-checklist.md`: one-time tokens leave the address bar as soon as the app captures them; production bundles contain no test values (run the `rg` scan in Task 12).
- Database: the new migration is `202610250001_*.sql`: after Plan 2's `20261012…` and Plan 3's `20261020…` migrations and before Plan 5's `20261030…` (run `ls supabase/migrations | tail -5` first; bump the number if it would not sort after Plans 2–3). The DB test is `0035_*` (Plan 2 uses `0017`–`0018`, Plan 3 `0030`–`0031`, Plan 5 `0040`+). Never edit an applied migration. Apply locally with `npx supabase migration up --local`, never `supabase db reset` (the local database is shared with the main checkout). Every function follows the `private.*` security-definer + `set search_path = ''` + `public` `language sql` wrapper pattern, revoked from `public, anon, authenticated` and granted to `authenticated`.
- English copy in American spelling; every new `en` key in `src/app/dashboard-i18n.js` has a `pt` key (Portugal Portuguese, "tu" form), and keys used only by deleted code are removed from both.
- All routes live under `/dashboard` as hash routes exactly as listed in the spec's Routes table.
- No new runtime dependencies.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Rulings

Decisions the spec leaves open, made here so tasks do not re-decide them:

- **Ruling 1 — `/app` forwards client-side.** `app.html` becomes a stub that runs `location.replace('/dashboard' + location.search + location.hash)`. No `vercel.json` redirect: the hash never reaches a server, `tools/serve.py` (unchangeable) cannot redirect, and one mechanism tested by Playwright beats two. `vercel.json` is unchanged; `cleanUrls` already serves `dashboard.html` at `/dashboard` and forwards `/app.html` to `/app`.
- **Ruling 2 — names stay.** The bundle stays `assets/generated/app.js` (entry `app`); the `dashboard` entry is deleted. `src/app/dashboard-i18n.js` and the `roda.dashboard.locale` storage key keep their names because `/dashboard` remains the app's home.
- **Ruling 3 — service workers.** The app's worker moves to `/dashboard-sw.js` with scope `/dashboard` and cache prefix `roda-dashboard-`. `/app-sw.js` stays as a retirement worker with no fetch handler: on its next update check it deletes `roda-app-*` caches and unregisters itself. The app page also unregisters any registration whose scope is `/app` and deletes `roda-app-*` caches.
- **Ruling 4 — manifest.** `"id": "/app"` (the identity Chrome derived from the old `start_url`, so already-installed Android apps update in place instead of becoming a second app), `"start_url": "/dashboard"`, `"scope": "/"` (sign-in at `/` and `/auth/callback` stays inside the installed window). Home-screen icons that cannot update their `start_url` (iOS) keep opening `/app`, which forwards.
- **Ruling 5 — invitation and group links** keep their format (`/dashboard?member_invite=…`, `/dashboard?group_link=…`). The signed-out check runs first (so the token survives sign-in through `next=`); then the token leaves the address bar, waits in this tab's `sessionStorage` (`roda.entryLinks`), and opens as a bottom sheet on the first screen that is not `#/welcome`. One link at a time; an invitation wins over a group link.
- **Ruling 6 — sign-out.** An explicit sign-out counts unsynced work (a non-empty `roda.logDraft:<own profile>` draft counts 1, each queued item in every `roda.pendingResources:*` counts 1). With nothing unsynced it signs out at once; otherwise a sheet warns and offers "Stay signed in" or "Sign out and delete". Signing out deletes every `roda.logDraft:*` and `roda.pendingResources:*` key. A session that merely expires deletes nothing, so the work syncs after signing back in. The old dashboard's `roda.dashboard.mode` and `roda.dashboard.group` keys are removed at startup.
- **Ruling 7 — "How did it go?"** appears for an attended (non-Alone) class in the last 12 hours that has no felt (whole-round) rating, whatever its part ratings — the spec's "without a felt rating". The rule reads `felt`, not `has_rating`.
- **Ruling 8 — invalid calendar URLs.** An impossible month (`#/calendar/2026-13`) becomes `#/calendar` (current month); an impossible day (`#/calendar/2026-02-30`) becomes that month. The address bar is rewritten.
- **Ruling 9 — resource idempotency.** Each resource carries a client key (a UUID made when it is staged or queued). The database keeps one resource per person and key; repeating a key returns the first resource; reusing a key on another training fails with `idempotency_conflict`. The five-argument `add_training_resource` is replaced by a six-argument one whose key defaults to null, so a client still on the old code keeps working during deploy.
- **Ruling 10 — carried-over capabilities.** The new app keeps three things only the old dashboard entry did: the one-time browser repertoire import (`importLocalRepertoire`), "Save as sequence" on round cards in Log training (the composer passes the repertoire to the round editor, like the old Record dialog), and a "Demo · browser only" label in demo mode.
- **Ruling 11 — dropped on purpose.** The old automatic retry of group data at startup and the "group data unavailable" warning go away (the spec removes the group selector, so startup no longer loads groups); a failed startup still offers Try again. The My Training / Coaching switch and switching between coached groups are replaced by Train · Both · Teach and Me → Groups (Plan 2).
- **Ruling 12 — docs.** `docs/security-checklist.md` and Decision 3 in `docs/training-platform-design-decisions.md` are updated from "binary mode" to Train · Both · Teach wording, because the switch-over makes the old wording false.
- **Ruling 13 — reused views stay.** The spec removes "the old `src/app/ui/*-view.js` page views". Views the new app embeds as components with an injected root — `resource-view.js` (Plan 1) and, per Plan 2's R13, `statistics-view.js`, `repertoire-view.js`, `catalog-view.js` — are no longer page views and stay, with their unit tests and any stylesheet their screens link (Plan 2 links `assets/training-statistics.css`). Everything else the dead-code test reports is removed. Any other old view still loaded fails the audit.

## Review Focus

1. **An old `/app` link or home-screen icon opened after the switch** (with `?demo=1` and a hash such as `#/training/<id>`) — lands on the same screen under `/dashboard`, and the retired `/app` worker never answers a request. Pinned in Task 9 (`app-redirect.spec.js`) and Task 10 (the retirement worker has no fetch handler).
2. **An invitation or unlisted-group link opened while signed out** — survives sign-in, opens once, and the token is gone from the address bar right after capture. Pinned in Task 7.
3. **A bad deploy, captive portal, or redirect answering the app page** (404, 500, redirected response) — never replaces the cached app page used offline. Pinned in Task 3 and re-run at `/dashboard` in Task 10.
4. **Signing out on a shared phone with unsynced work** — warned first; after confirming, no training text remains in browser storage; an expired session (not a sign-out) keeps the work. Pinned in Task 6.
5. **A hand-edited or stale hash** (`#/calendar/2026-13`, `#/calendar/2026-02-30`) — opens a real screen, never stuck on "Loading…". Pinned in Task 2.

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
| `tests/unit/pages.test.js` | `dashboard.html` is the app shell, `app.html` forwards, stylesheets are used |
| `src/app/local-data.js` | Count and clear drafts and queued resources; remove old dashboard keys |
| `src/app/screens/sign-out.js` | `confirmSignOut` warning sheet |
| `src/app/shell/entry-links.js` | Capture, scrub, and open invitation and group links |
| `src/app/sw/retire-app-worker.js` | Built to `/app-sw.js`: deletes old caches, unregisters |
| `src/app/sw/register.js` | Registers `/dashboard-sw.js`, retires `/app` registrations |
| `supabase/migrations/202610250001_resource_idempotency.sql` | Client keys for resources |
| `supabase/tests/0035_resource_idempotency.test.sql` | DB tests for it |
| `tests/e2e/app-hardening.spec.js` | Browser tests for the Plan 1 follow-ups |
| `tests/e2e/app-switch-over.spec.js` | Browser tests for carried-over and ported capabilities |
| `tests/e2e/app-redirect.spec.js` | `/app` forwarding |
| `tests/e2e/auth.spec.js` | Renamed from `auth-dashboard.spec.js`, sign-in tests only |

Modified: `scripts/build.mjs`, `.gitignore`, `app.html`, `dashboard.html`, `manifest.webmanifest`, `assets/app.css`, `src/app/entries/app.js`, `src/app/shell/router.js`, `src/app/shell/layout.js`, `src/app/screens/today-state.js`, `src/app/screens/log.js`, `src/app/ui/resource-view.js`, `src/app/sw/cache-policy.js`, `src/app/sw/service-worker.js`, `src/app/training-service.js`, `src/app/testing/fake-services.js`, `src/app/errors.js`, `src/app/dashboard-i18n.js`, existing unit and browser tests named in each task, `README.md`, `ROADMAP.md`, `docs/auth-and-database-operations.md`, `docs/training-platform-design-decisions.md`, `docs/security-checklist.md`.

Deleted (Task 9, Task 11): the old browser specs, `src/app/entries/dashboard.js`, the old `src/app/ui/*-view.js` page views the new app does not embed and the state modules only they load (the exact list comes from the dead-code test), their unit tests, `assets/dashboard.css`, `assets/training-calendar.css` (and `assets/training-statistics.css` only if no page links it), and unused copy.

---

### Task 1: Parity audit gate

**Files:**
- Modify: `scripts/build.mjs`
- Create: `tests/unit/helpers/module-graph.js`, `tests/unit/switch-over-parity.test.js`

**Interfaces:**
- Produces (`scripts/build.mjs`): `export const ENTRY_POINTS` — `{ [bundleName]: sourcePath }` for the page bundles; `export const WORKER_ENTRY_POINTS` — `{ [workerFileNameWithoutJs]: sourcePath }` built to the repository root.
- Produces (`tests/unit/helpers/module-graph.js`): `reachableModules(entryPaths: string[]) → Promise<string[]>` (sorted `src/…` paths), `appModules() → Promise<string[]>` (from `ENTRY_POINTS.app`), `allModules() → Promise<string[]>` (every page and worker entry), `sourceOf(paths) → Promise<Record<path, text>>`.
- Produces (`tests/unit/switch-over-parity.test.js`): the constant `PORTS_DONE` (false until Task 9 flips it).

- [ ] **Step 1: Export the entry points**

In `scripts/build.mjs`, move the `entryPoints` object literal out of `buildBrowserBundles` (keep every entry it contains at execution time, including any Plans 2–3 added) and build the worker from a second export:

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

Inside `buildBrowserBundles`, use `const entryPoints = ENTRY_POINTS;` and replace the single service-worker `build` call with:

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

The lists below are frozen from the old dashboard as of 2026-10-12 (`src/app/entries/dashboard.js`, `src/app/ui/*-view.js` except `resource-view.js`, and the old browser specs). Rows marked `plan-4` are delivered by this plan and are only checked once `PORTS_DONE` is true (Task 9).

```js
// tests/unit/switch-over-parity.test.js
// Gate for the switch-over: every capability of the old dashboard must have a
// home in the new app before the old code is deleted, and must keep it after.
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

// Every service method the old dashboard called. `replacedBy` accepts a
// spec-mandated replacement instead of the call itself.
const SERVICE_CALLS = [
  call('plan-1', 'auth.getSession'), call('plan-1', 'auth.onAuthStateChange'), call('plan-1', 'auth.signOut'),
  call('plan-1', 'profile.loadProfile'), call('plan-2', 'profile.loadCoachProfile'),
  call('plan-2', 'profile.completeProfile'), call('plan-2', 'profile.uploadProfilePicture'),
  call('plan-2', 'profile.registerAsCoach', { replacedBy: /usage_?[mM]ode/, why: 'Spec: choosing Both or Teach creates the coach profile.' }),
  call('plan-2', 'group.listMyMemberships'), call('plan-4', 'group.resolveDiscoveryToken'),
  call('plan-4', 'group.acceptInvitation'), call('plan-4', 'group.requestAccess'),
  call('plan-3', 'group.searchGroups', { replacedBy: /discover_?[sS]earch|discoverSearch/, why: 'Spec: Discover search finds groups.' }),
  call('plan-2', 'group.createGroup'), call('plan-2', 'group.updateGroup'), call('plan-2', 'group.setGroupTimezone'),
  call('plan-2', 'group.archiveGroup'), call('plan-2', 'group.transferOwnership'), call('plan-2', 'group.listRoster'),
  call('plan-2', 'group.removeMember'), call('plan-2', 'group.listJoinRequests'), call('plan-2', 'group.decideJoinRequest'),
  call('plan-2', 'group.createInvitation'), call('plan-2', 'group.rotateDiscoveryLink'), call('plan-2', 'group.revokeDiscoveryLink'),
  call('plan-2', 'group.listRelationships'), call('plan-2', 'group.inviteChildGroup'), call('plan-2', 'group.decideRelationship'),
  call('plan-2', 'group.setRelationshipSharing'), call('plan-2', 'group.revokeRelationship'),
  call('plan-2', 'connection.listMine'), call('plan-2', 'connection.searchCandidates'), call('plan-2', 'connection.request'),
  call('plan-2', 'connection.decide'), call('plan-2', 'connection.end'),
  call('plan-1', 'training.createIdempotencyKey'), call('plan-1', 'training.recordAloneTraining'),
  call('plan-1', 'training.listCalendar'), call('plan-1', 'training.listResourceKinds'), call('plan-1', 'training.saveNotes'),
  call('plan-1', 'training.saveRoundAssessments'), call('plan-1', 'training.addResource'),
  call('plan-1', 'training.getDay', { replacedBy: /\.getTraining\(/, why: 'Spec: a day sheet lists items that open the training page.' }),
  call('plan-2', 'training.addFeedback'), call('plan-2', 'training.listPlans'), call('plan-2', 'training.createPlan'),
  call('plan-2', 'training.savePlanDraft'), call('plan-2', 'training.publishPlan'), call('plan-2', 'training.scheduleGroupTraining'),
  call('plan-2', 'training.schedulePersonalClass'), call('plan-2', 'training.completeGroupTraining'),
  call('plan-2', 'training.completePersonalClass'), call('plan-2', 'training.recordPastClass'),
  call('plan-2', 'statistics.getPersonal'), call('plan-2', 'statistics.getGroup'), call('plan-2', 'statistics.searchMembers'),
  call('plan-1', 'repertoire.list'), call('plan-4', 'repertoire.save'), call('plan-2', 'repertoire.remove'),
  call('plan-4', 'repertoire.importItems'),
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

const OLD_SPECS = [
  'auth-dashboard.spec.js', 'training-calendar.spec.js', 'training-resources.spec.js', 'repertoire.spec.js',
  'catalog-curation.spec.js', 'coaching-training.spec.js', 'past-class.spec.js', 'training-statistics.spec.js',
  'coaching-connections.spec.js', 'group-flows.spec.js',
];

const done = (old, ...covers) => ({ old, owner: 'plan-1', covers });
const here = (old, ...covers) => ({ old, owner: 'plan-4', covers });
const later = (owner, old, ...covers) => ({ old, owner, covers });
const dropped = (old, why) => ({ old, owner: 'spec', dropped: why });

// Every old browser test and the new test(s) that cover its behavior,
// written as 'file › exact test title'.
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
  later('plan-2', 'auth-dashboard.spec.js › previews the profile picture in its circular crop before saving'),
  later('plan-2', 'auth-dashboard.spec.js › completes the practitioner profile with an optional automatic timezone'),
  later('plan-2', 'auth-dashboard.spec.js › uses a binary mode switch and extends a practitioner through coach registration'),
  done('auth-dashboard.spec.js › keeps a coach in My Training by default and clears private UI on expiry',
    'app-navigation.spec.js › a session that ends while the app is open goes to sign-in'),
  here('auth-dashboard.spec.js › signs out from the dashboard and removes persisted private state',
    'app-hardening.spec.js › signing out warns about unsaved work and then deletes it'),
  later('plan-2', 'auth-dashboard.spec.js › keeps private feature workspaces blocked behind required profile completion'),
  later('plan-2', 'auth-dashboard.spec.js › localizes dashboard modes, tabs, and coach planning in Portuguese'),
  done('training-calendar.spec.js › records Alone training and opens its calendar details',
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
    'app-switch-over.spec.js › imports browser sequences once and offers them in Log training'),
  here('repertoire.spec.js › saves a round as a sequence from Record training',
    'app-switch-over.spec.js › saves a round as a sequence from Log training'),
  later('plan-2', 'catalog-curation.spec.js › hides the Catalog tab from non-curators'),
  later('plan-2', 'catalog-curation.spec.js › a curator maps a term and the parser recognizes it next time'),
  later('plan-2', 'coaching-training.spec.js › creates and publishes a plan, then schedules a hidden group training'),
  later('plan-2', 'coaching-training.spec.js › schedules direct and group-derived personal classes with the right authorization context'),
  later('plan-2', 'coaching-training.spec.js › does not expose coach scheduling controls to an unregistered practitioner'),
  later('plan-2', 'coaching-training.spec.js › confirms only attendees, preserves a late-arrival duration, and retries without duplicates'),
  later('plan-2', 'coaching-training.spec.js › adds feedback in an authorized context and clears student detail after revocation'),
  later('plan-2', 'past-class.spec.js › a coach records a past group class with a video link'),
  later('plan-2', 'training-statistics.spec.js › shows personal totals, all selectors, group ranking, pinning, and privacy'),
  later('plan-2', 'training-statistics.spec.js › localizes statistics in Portuguese'),
  later('plan-2', 'training-statistics.spec.js › stacks the podium within a mobile viewport'),
  later('plan-2', 'coaching-connections.spec.js › requests, accepts, and ends a direct coaching connection'),
  later('plan-2', 'coaching-connections.spec.js › renders the connection experience in Portuguese'),
  later('plan-3', 'group-flows.spec.js › searches groups, requests member access, and resolves an unlisted link'),
  here('group-flows.spec.js › searches groups, requests member access, and resolves an unlisted link',
    'app-switch-over.spec.js › opens an unlisted group link and requests access'),
  later('plan-2', 'group-flows.spec.js › registers coaching, requests coach access, and creates a group'),
  later('plan-2', 'group-flows.spec.js › lets a direct coach approve members, remove members, and create shareable invitations'),
  later('plan-2', 'group-flows.spec.js › lets an owner manage coach access and immediate-parent sharing'),
  here('group-flows.spec.js › retains a member invitation through sign-in and explains terminal invitation states',
    'app-switch-over.spec.js › keeps a member invitation through sign-in and explains used links'),
  later('plan-2', 'group-flows.spec.js › switches between coached groups and clears a group after access is revoked'),
  later('plan-2', 'group-flows.spec.js › lets a child owner decide a parent invitation and surfaces hierarchy conflicts'),
  later('plan-2', 'group-flows.spec.js › lets an owner rotate discovery links and transfer ownership to an active coach'),
  later('plan-2', 'group-flows.spec.js › lets an owner edit and archive a group'),
];

// Old views the new app embeds as components with an injected root: the
// resource list (Plan 1) and Progress, Repertoire, Catalog (Plan 2's R13).
// Any other old *-view.js still loaded means a page was not rebuilt.
const REUSED_VIEWS = Object.freeze([
  'src/app/ui/catalog-view.js', 'src/app/ui/repertoire-view.js', 'src/app/ui/resource-view.js', 'src/app/ui/statistics-view.js',
]);

// Modules whose own job is the call (services, fakes) do not count as a use.
const NOT_A_USE = [/^src\/app\/[a-z-]+-service\.js$/, /^src\/app\/testing\//, /^src\/app\/supabase-client\.js$/];

async function appCorpus() {
  const modules = (await appModules()).filter((path) => !NOT_A_USE.some((pattern) => pattern.test(path)));
  return Object.values(await sourceOf(modules)).join('\n');
}

function callPattern(name) {
  const [service, method] = name.split('.');
  return AMBIGUOUS.has(method)
    ? new RegExp(`\\b(?:${ALIASES(service).join('|')})\\.${method}\\(`)
    : new RegExp(`\\.${method}\\(`);
}

function testTitles(file) {
  const path = `tests/e2e/${file}`;
  if (!existsSync(path)) return [];
  const pattern = /^\s*test\(\s*(['"`])((?:\\.|(?!\1).)*)\1/gm;
  return [...readFileSync(path, 'utf8').matchAll(pattern)].map((match) => match[2].replace(/\\(.)/g, '$1'));
}

describe('switch-over parity audit', () => {
  it('keeps every old dashboard service call in use by the new app', async () => {
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

  it('has no stopgap screens or links to the classic dashboard', async () => {
    const modules = await appModules();
    expect(modules).not.toContain('src/app/screens/placeholder.js');
    const text = await appCorpus();
    for (const key of ['app.classic', 'app.comingSoon', 'app.completeProfile']) expect(text).not.toContain(`'${key}'`);
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
      if (!row.covers.length) problems.push(`${row.old}: no covering test yet (${row.owner})`);
      for (const target of row.covers) {
        const [file, title] = target.split(' › ');
        if (!testTitles(file).includes(title)) problems.push(`${row.old}: missing ${target}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it.runIf(PORTS_DONE)('keeps only new-app, sign-in, and public browser specs', () => {
    const stray = readdirSync('tests/e2e').filter((file) => !/^(app-.+|auth|public-sequences)\.spec\.js$/.test(file));
    expect(stray).toEqual([]);
  });
});
```

- [ ] **Step 4: Run the audit to see what is not yet mapped**

Run: `npx vitest run tests/unit/switch-over-parity.test.js`
Expected: FAIL in "covers every old browser test" with one `no covering test yet (plan-2)` or `(plan-3)` line per `later(...)` row. Every other assertion should pass; if any other fails, go to Step 6.

- [ ] **Step 5: Map each Plan 2 and Plan 3 row to the tests that cover it**

List the new browser tests:

```bash
grep -nE "^\s*test\(" tests/e2e/app-*.spec.js
```

For each `later('plan-2', '…')` and `later('plan-3', '…')` row, read the old test (`tests/e2e/<old file>`) and the candidate new tests, then append the covering test(s) as extra arguments, for example:

```js
  later('plan-2', 'past-class.spec.js › a coach records a past group class with a video link',
    'app-teaching.spec.js › a coach records a past class with a video link'),
```

A row is covered only when the new test exercises the same behavior (same permission rule, same retry rule, same privacy rule), not merely the same screen. Do not add new `dropped(...)` rows: every drop the spec allows is already listed. If "lists every test of the old browser specs that still exist" fails because Plan 2 or 3 added a test to an old spec, add a `later('<that plan>', '<file> › <title>', '<covering test>')` row for it.

If a call in `SERVICE_CALLS` exists in the new app under a variable name `ALIASES` does not list, extend `ALIASES`; never move a row to `replacedBy` or `dropped` to make it pass.

- [ ] **Step 6: Run the audit — pass or stop**

Run: `npx vitest run tests/unit/switch-over-parity.test.js`
Expected: PASS.

If anything owned by `plan-1`, `plan-2`, or `plan-3` still fails (a service call nobody makes, a row with no covering test, `placeholder.js` still loaded, a stopgap key still used, an old `*-view.js` loaded by the app), **stop**: report BLOCKED with the failing lines. Those capabilities belong to Plans 2–3 and must ship there before this plan continues.

- [ ] **Step 7: Run the unit suite**

Run: `npm run test:unit`
Expected: PASS (including `tests/unit/build-config.test.js`, which still builds the worker to `app-sw.js`).

- [ ] **Step 8: Commit**

```bash
git add scripts/build.mjs tests/unit/helpers/module-graph.js tests/unit/switch-over-parity.test.js
git commit -m "test: gate the switch-over on a parity audit of the old dashboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Group A — Plan 1 follow-ups

Tasks 2–6 fix the minor findings deferred from Plan 1's review. They are independent of the switch-over and still use `/app` URLs in browser tests; Task 9 rewrites those URLs.

### Task 2: Calendar URL fallback and the "How did it go?" rule

**Files:**
- Modify: `src/app/shell/router.js`, `src/app/screens/today-state.js`
- Test: `tests/unit/router.test.js`, `tests/unit/today-state.test.js`, `tests/e2e/app-hardening.spec.js` (create)

**Interfaces:**
- Produces: `parseRoute(hash)` returns, for an impossible calendar month, `{ name: 'calendar', path: '/calendar', params: { month: null, day: null }, redirected: true }`, and for an impossible day `{ name: 'calendar', path: '/calendar/<yyyy-mm>', params: { month, day: null }, redirected: true }`. The router rewrites the hash to `#<route.path>` for any redirected route.
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
    expect(parseRoute(hash)).toEqual({ name: 'calendar', path, params, redirected: true });
  });

  it('keeps possible calendar dates as they are', () => {
    expect(parseRoute('#/calendar/2028-02-29')).toEqual({
      name: 'calendar', path: '/calendar/2028-02-29', params: { month: '2028-02', day: '29' },
    });
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
    return { name: 'calendar', path: '/calendar', params: { month: null, day: null }, redirected: true };
  }
  if (day && (Number(day) < 1 || Number(day) > daysIn(month))) {
    return { name: 'calendar', path: `/calendar/${month}`, params: { month, day: null }, redirected: true };
  }
  return route;
}
```

In `parseRoute`, change the matched-route return to pass calendar routes through it:

```js
    if (match) {
      const route = { name, path, params: Object.fromEntries(keys.map((key, index) => [key, match[index + 1] ?? null])) };
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

In `src/app/screens/today-state.js`, in `nowNextCard`, replace `&& !training.has_rating &&` with `&& !training.felt &&`.

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
- Produces (`cache-policy.js`): `SHELL_PATH` (`'/app'` now; Task 10 changes it to `'/dashboard'`), `shouldCache(response) → boolean` (true only for `ok` and not `redirected`).
- Produces (`tests/unit/helpers/worker-harness.js`): `loadWorker(load: () => Promise<module>, { cacheKeys }) → { handlers, cache, cacheStorage, stored, fetchMock, self }`, `respond(handlers, request) → Promise<Response> | undefined`, `lifecycle(handlers, 'install' | 'activate') → Promise<void>`; reused in Task 10.

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

In `src/app/sw/cache-policy.js`, add near the top and use `SHELL_PATH` for the first `APP_SHELL` entry and in `strategyFor`'s navigation check:

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
- Modify: `src/app/training-service.js`, `src/app/testing/fake-services.js`, `src/app/errors.js`, `src/app/screens/log.js`, `src/app/ui/resource-view.js`
- Test: `tests/unit/training-service.test.js`, `tests/unit/log-screen.test.js`, `tests/unit/resource-view.test.js`, `tests/unit/errors.test.js`, `tests/e2e/app-hardening.spec.js`

**Interfaces:**
- Produces (SQL): `public.add_training_resource(occurrence_id uuid, kind text, title text, url text, body text, client_key uuid default null) → jsonb { status: 'saved', resource_id }`; repeating `(caller, client_key)` returns the first `resource_id`; the same key on another training raises `P0001 idempotency_conflict`. The five-argument function is dropped.
- Produces (JS, real and fake): `training.addResource({ occurrenceId, kind, title, url, body, clientKey })` sends `client_key: clientKey ?? null`.
- Produces: every resource staged in Log training or queued in `createResourceSection` carries `clientKey` (string), also in `roda.logDraft:*` and `roda.pendingResources:*`; queued items saved before this change get a key the first time they are read.

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

Run: `npx vitest run tests/unit/training-service.test.js tests/unit/errors.test.js tests/unit/log-screen.test.js tests/unit/resource-view.test.js && npm run build:test && npx playwright test tests/e2e/app-hardening.spec.js -g "once"`
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

Run: `npx vitest run tests/unit/training-service.test.js tests/unit/errors.test.js tests/unit/log-screen.test.js tests/unit/resource-view.test.js && npm run build:test && npx playwright test tests/e2e/app-hardening.spec.js`
Expected: PASS.

- [ ] **Step 8: Run all suites**

Run: `npm run test:unit && npm run test:e2e && npm run test:db`
Expected: PASS (the existing `0013` and `0016` tests call the function with five arguments, which the default covers).

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/202610250001_resource_idempotency.sql supabase/tests/0035_resource_idempotency.test.sql src/app/training-service.js src/app/testing/fake-services.js src/app/errors.js src/app/screens/log.js src/app/ui/resource-view.js tests/unit/training-service.test.js tests/unit/errors.test.js tests/unit/log-screen.test.js tests/unit/resource-view.test.js tests/e2e/app-hardening.spec.js
git commit -m "fix: add each training resource once, even after a reload mid-save

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Signing out clears local training data

**Files:**
- Create: `src/app/local-data.js`, `src/app/screens/sign-out.js`
- Modify: `src/app/entries/app.js`, `src/app/dashboard-i18n.js`
- Test: `tests/unit/local-data.test.js`, `tests/unit/sign-out.test.js`, `tests/e2e/app-hardening.spec.js`

**Interfaces:**
- Produces (`local-data.js`): `unsyncedCount(storage, profileId) → number`, `clearLocalTrainingData(storage) → void`, `clearLegacyDashboardKeys(storage) → void`; all tolerate missing or throwing storage.
- Produces (`sign-out.js`): `confirmSignOut(ctx, { signOut: () => Promise<void> }) → Promise<void>`; uses `ctx.document`, `ctx.window`, `ctx.i18n`, `ctx.profile.id`, `ctx.openSheet`.
- Produces (copy): `signOut.title`, `signOut.unsyncedOne`, `signOut.unsyncedMany` (`{count}`), `signOut.stay`, `signOut.confirm`.

- [ ] **Step 1: Write the failing unit tests**

```js
// tests/unit/local-data.test.js
import { describe, expect, it } from 'vitest';

import { clearLegacyDashboardKeys, clearLocalTrainingData, unsyncedCount } from '../../src/app/local-data.js';

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

const draft = (overrides = {}) => JSON.stringify({ rounds: [], notes: '', resources: [], ...overrides });

describe('local training data', () => {
  it('counts the own draft once and every waiting resource', () => {
    const storage = memory({
      'roda.logDraft:p1': draft({ rounds: [{ sourceText: 'ginga' }], resources: [{ kind: 'video' }] }),
      'roda.logDraft:p2': draft({ notes: 'someone else' }),
      'roda.pendingResources:o1': JSON.stringify([{ kind: 'video' }, { kind: 'voice' }]),
      'roda.dashboard.locale': 'pt',
    });
    expect(unsyncedCount(storage, 'p1')).toBe(3);
  });

  it('does not count an empty draft or broken values', () => {
    const storage = memory({
      'roda.logDraft:p1': draft({ rounds: [{ sourceText: '   ' }] }),
      'roda.pendingResources:o1': '{broken',
    });
    expect(unsyncedCount(storage, 'p1')).toBe(0);
  });

  it('clears drafts and waiting resources for everyone and keeps other settings', () => {
    const storage = memory({
      'roda.logDraft:p1': draft(), 'roda.logDraft:p2': draft(),
      'roda.pendingResources:o1': '[]', 'roda.dashboard.locale': 'pt', 'roda.seqs': '[]',
    });
    clearLocalTrainingData(storage);
    expect([...storage.values.keys()].sort()).toEqual(['roda.dashboard.locale', 'roda.seqs']);
  });

  it('removes the old dashboard keys', () => {
    const storage = memory({ 'roda.dashboard.mode': 'coaching', 'roda.dashboard.group': 'g1', 'roda.dashboard.locale': 'en' });
    clearLegacyDashboardKeys(storage);
    expect([...storage.values.keys()]).toEqual(['roda.dashboard.locale']);
  });

  it('survives blocked storage', () => {
    const blocked = { get length() { throw new Error('blocked'); }, getItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    expect(unsyncedCount(blocked, 'p1')).toBe(0);
    expect(() => clearLocalTrainingData(blocked)).not.toThrow();
    expect(() => clearLegacyDashboardKeys(null)).not.toThrow();
  });
});
```

```js
// tests/unit/sign-out.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { confirmSignOut } from '../../src/app/screens/sign-out.js';
import { openSheet } from '../../src/app/shell/sheet.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });
const ctx = () => ({ document, window, i18n, profile: { id: 'p1' }, openSheet: (options) => openSheet({ document, ...options }) });

function seedWork() {
  localStorage.setItem('roda.logDraft:p1', JSON.stringify({ rounds: [{ sourceText: 'ginga' }], notes: '', resources: [] }));
  localStorage.setItem('roda.pendingResources:o1', JSON.stringify([{ kind: 'video' }]));
}

describe('sign out', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
  });

  it('signs out at once when nothing is waiting', async () => {
    const signOut = vi.fn().mockResolvedValue();
    localStorage.setItem('roda.logDraft:p1', JSON.stringify({ rounds: [], notes: '', resources: [] }));
    await confirmSignOut(ctx(), { signOut });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('roda.logDraft:p1')).toBeNull();
  });

  it('warns about unsynced work, and staying keeps it', async () => {
    const signOut = vi.fn().mockResolvedValue();
    seedWork();
    await confirmSignOut(ctx(), { signOut });
    const sheet = document.querySelector('[role="dialog"]');
    expect(sheet.getAttribute('aria-label')).toBe('Sign out?');
    expect(sheet.textContent).toContain("2 items on this device haven't been saved to your account yet.");
    sheet.querySelector('[data-action="stay"]').click();
    expect(signOut).not.toHaveBeenCalled();
    expect(localStorage.getItem('roda.logDraft:p1')).not.toBeNull();
  });

  it('deletes the work and signs out when confirmed', async () => {
    const signOut = vi.fn().mockResolvedValue();
    seedWork();
    await confirmSignOut(ctx(), { signOut });
    document.querySelector('[data-action="confirm-sign-out"]').click();
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem('roda.logDraft:p1')).toBeNull();
    expect(localStorage.getItem('roda.pendingResources:o1')).toBeNull();
  });
});
```

Add to `tests/e2e/app-hardening.spec.js`:

```js
test('signing out warns about unsaved work and then deletes it', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('roda.dashboard.mode', 'coaching'));
  await page.goto('/app#/log');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('roda.dashboard.mode'))).toBeNull();
  const box = page.getByLabel('Write a round');
  await box.fill('ginga 10 min');
  await box.press('Enter');
  await page.goto('/app#/me/settings');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Sign out?' });
  await expect(sheet).toContainText("One item on this device hasn't been saved to your account yet.");
  await sheet.getByRole('button', { name: 'Stay signed in' }).click();
  await expect(sheet).toBeHidden();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('dialog', { name: 'Sign out?' }).getByRole('button', { name: 'Sign out and delete' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith('roda.logDraft:') || key.startsWith('roda.pendingResources:')))).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('roda.e2e.session'))).toBeNull();
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

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/local-data.test.js tests/unit/sign-out.test.js && npm run build:test && npx playwright test tests/e2e/app-hardening.spec.js -g "sign|expired"`
Expected: FAIL — the modules do not exist; the browser test signs out without a warning.

- [ ] **Step 3: Implement**

```js
// src/app/local-data.js
// Training text and resources wait in browser storage until they sync. This
// finds that private work so signing out can warn about it and then remove it
// from a shared device.
const DRAFT_PREFIX = 'roda.logDraft:';
const PENDING_PREFIX = 'roda.pendingResources:';
const LEGACY_KEYS = Object.freeze(['roda.dashboard.mode', 'roda.dashboard.group']);

function storedKeys(storage) {
  try {
    return Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(Boolean);
  } catch {
    return [];
  }
}

function readJson(storage, key) {
  try {
    return JSON.parse(storage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function remove(storage, key) {
  try {
    storage.removeItem(key);
  } catch {
    // Blocked storage holds nothing to remove.
  }
}

function draftHasWork(draft) {
  if (!draft || typeof draft !== 'object') return false;
  const rounds = Array.isArray(draft.rounds) ? draft.rounds : [];
  return rounds.some((round) => String(round?.sourceText ?? '').trim() !== '')
    || String(draft.notes ?? '').trim() !== ''
    || (Array.isArray(draft.resources) && draft.resources.length > 0);
}

export function unsyncedCount(storage, profileId) {
  let count = draftHasWork(readJson(storage, `${DRAFT_PREFIX}${profileId}`)) ? 1 : 0;
  for (const key of storedKeys(storage)) {
    if (!key.startsWith(PENDING_PREFIX)) continue;
    const queue = readJson(storage, key);
    if (Array.isArray(queue)) count += queue.length;
  }
  return count;
}

export function clearLocalTrainingData(storage) {
  for (const key of storedKeys(storage)) {
    if (key.startsWith(DRAFT_PREFIX) || key.startsWith(PENDING_PREFIX)) remove(storage, key);
  }
}

export function clearLegacyDashboardKeys(storage) {
  for (const key of LEGACY_KEYS) remove(storage, key);
}
```

```js
// src/app/screens/sign-out.js
import { clearLocalTrainingData, unsyncedCount } from '../local-data.js';
import { el } from '../shell/page.js';

function localStorageOf(window) {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Signing out removes drafts and waiting resources from this device. When any
// of them has not reached the account yet, the person is asked first.
export async function confirmSignOut(ctx, { signOut }) {
  const { document, i18n } = ctx;
  const storage = localStorageOf(ctx.window);
  const finish = async () => {
    clearLocalTrainingData(storage);
    await signOut();
  };
  const count = unsyncedCount(storage, ctx.profile.id);
  if (!count) {
    await finish();
    return;
  }
  let sheet = null;
  const content = el(document, 'div', { className: 'sign-out-confirm' }, [
    el(document, 'p', { text: count === 1 ? i18n.t('signOut.unsyncedOne') : i18n.t('signOut.unsyncedMany', { count }) }),
    el(document, 'button', {
      className: 'button-secondary', text: i18n.t('signOut.stay'), attrs: { type: 'button' }, dataset: { action: 'stay' },
      on: { click: () => sheet.close() },
    }),
    el(document, 'button', {
      className: 'button-danger', text: i18n.t('signOut.confirm'), attrs: { type: 'button' }, dataset: { action: 'confirm-sign-out' },
      on: { click: () => { sheet.close(); finish(); } },
    }),
  ]);
  sheet = ctx.openSheet({ title: i18n.t('signOut.title'), content });
}
```

Copy in `src/app/dashboard-i18n.js` — `en`:

```js
    'signOut.title': 'Sign out?',
    'signOut.unsyncedOne': "One item on this device hasn't been saved to your account yet. Signing out deletes it.",
    'signOut.unsyncedMany': "{count} items on this device haven't been saved to your account yet. Signing out deletes them.",
    'signOut.stay': 'Stay signed in',
    'signOut.confirm': 'Sign out and delete',
```

`pt`:

```js
    'signOut.title': 'Sair?',
    'signOut.unsyncedOne': 'Um item neste dispositivo ainda não foi guardado na tua conta. Ao sair, será apagado.',
    'signOut.unsyncedMany': '{count} itens neste dispositivo ainda não foram guardados na tua conta. Ao sair, serão apagados.',
    'signOut.stay': 'Continuar com sessão iniciada',
    'signOut.confirm': 'Sair e apagar',
```

In `src/app/entries/app.js`: import `confirmSignOut` from `'../screens/sign-out.js'` and `clearLegacyDashboardKeys` from `'../local-data.js'`; make `clearLegacyDashboardKeys(localStorage);` the first line of `main()`; and wrap the Settings sign-out handler (find the call `services.auth.signOut()` passed as `onSignOut` to the Settings screen) so it reads:

```js
            onSignOut: () => confirmSignOut(ctx, {
              signOut: async () => { await services.auth.signOut(); location.replace('/'); },
            }),
```

Leave the `onAuthStateChange` handler (session expiry) unchanged: it must not clear anything.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/unit/local-data.test.js tests/unit/sign-out.test.js tests/unit/dashboard-i18n.test.js && npm run build:test && npx playwright test tests/e2e/app-hardening.spec.js tests/e2e/app-shell.spec.js`
Expected: PASS (the existing "signs out from Settings" test has no drafts, so it signs out at once).

- [ ] **Step 5: Run the suites**

Run: `npm run test:unit && npm run test:e2e`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/local-data.js src/app/screens/sign-out.js src/app/entries/app.js src/app/dashboard-i18n.js tests/unit/local-data.test.js tests/unit/sign-out.test.js tests/e2e/app-hardening.spec.js
git commit -m "feat: warn about unsaved work on sign-out and leave no training text behind

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Group B — Switch-over

### Task 7: Carry over what only the old dashboard entry did

**Files:**
- Create: `src/app/shell/entry-links.js`
- Modify: `src/app/entries/app.js`, `src/app/shell/layout.js`, `src/app/screens/log.js`, `src/app/dashboard-i18n.js`, `assets/app.css`
- Test: `tests/unit/entry-links.test.js`, `tests/unit/layout.test.js`, `tests/e2e/app-switch-over.spec.js` (create)

**Interfaces:**
- Consumes: `services.group.acceptInvitation(token) → { status: 'accepted'|'expired'|'revoked', group_id?, already_used? }`, `services.group.resolveDiscoveryToken(token) → group | null`, `services.group.requestAccess(groupId, 'member', token)`, `importLocalRepertoire({ storage, repertoire, userId })` from `src/app/repertoire-import.js`.
- Produces (`entry-links.js`): `LINK_PARAMS`, `takeEntryLinks(window, storage) → { member_invite?, group_link? }` (scrubs the address bar), `runEntryLinks(ctx, storage) → Promise<void>` (opens at most one sheet and forgets the link).
- Produces (`layout.js`): `createLayout({ …, demo = false })` renders `p.app-demo[role=note]` with `app.demoBadge` when `demo` is true.
- Produces (`app.js`): sign-in return uses the current path, query, and hash: `/?next=<encoded pathname+search+hash>`.
- Produces (`tests/e2e/app-switch-over.spec.js`): helpers `signIn(page, extraStorage)` and fixtures `lua`, `mata`, reused by Task 8.

- [ ] **Step 1: Check what Plans 2–3 already carried over**

Run:

```bash
grep -rn "member_invite\|group_link\|importLocalRepertoire\|demoBadge" src/app/entries/app.js src/app/screens src/app/shell
grep -n "createRoundEditor" src/app/screens/log.js
```

Expected: no output from the first command, and the `createRoundEditor` call in `log.js` has no `repertoire:` option. If a capability already exists, keep that implementation, skip its part of Steps 4–5, and still add its browser test in Step 2.

- [ ] **Step 2: Write the failing tests**

```js
// tests/unit/entry-links.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
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

  it('captures an invitation and scrubs it from the address bar', () => {
    window.history.replaceState(null, '', '/dashboard?member_invite=abc&demo=1#/calendar');
    const storage = memory();
    expect(takeEntryLinks(window, storage)).toEqual({ member_invite: 'abc' });
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/dashboard?demo=1#/calendar');
    expect(JSON.parse(storage.getItem('roda.entryLinks'))).toEqual({ member_invite: 'abc' });
  });

  it('drops an empty token and stores nothing', () => {
    window.history.replaceState(null, '', '/dashboard?group_link=#/');
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

```js
// tests/e2e/app-switch-over.spec.js
import { expect, test } from '@playwright/test';

const ana = {
  id: 'practitioner-1', display_name: 'Ana Silva', avatar_path: null,
  timezone_override: 'Europe/Lisbon', leaderboard_visible: true, completed_at: '2026-09-11T20:00:00Z',
};
const lua = {
  id: 'group-lua', slug: 'grupo-lua', owner_id: 'owner-1', name: 'Grupo Lua', description: 'Tuesday training',
  location: 'Lisbon', picture_path: null, is_discoverable: true, archived_at: null,
};
const mata = { ...lua, id: 'group-mata', slug: 'grupo-mata', owner_id: 'owner-2', name: 'Grupo Mata', description: 'Saturday roda', location: 'Porto', is_discoverable: false };

async function signIn(page, extra = {}) {
  await page.goto('/');
  await page.evaluate(({ profile, entries }) => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1', email: 'ana@example.com' } }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify(profile));
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, JSON.stringify(value));
  }, { profile: ana, entries: extra });
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
});

test('keeps a member invitation through sign-in and explains used links', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/app?member_invite=member-valid');
  await expect(page).toHaveURL(/\?next=%2Fapp%3Fmember_invite%3Dmember-valid$/);

  await signIn(page, {
    'roda.e2e.groupState': {
      groups: [lua],
      invitationTokens: {
        'member-valid': { state: 'pending', group: lua },
        'member-expired': { state: 'expired', group: lua },
        'member-revoked': { state: 'revoked', group: lua },
        'member-used': { state: 'accepted', group: lua },
      },
    },
  });
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
  await signIn(page, { 'roda.e2e.groupState': { groups: [lua, mata], discoveryTokens: { 'unlisted-secret': 'group-mata' } } });
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

test('imports browser sequences once and offers them in Log training', async ({ page }) => {
  await signIn(page, { 'roda.seqs': [[{ c: 'golpes', n: 'Armada' }, { c: 'floreios', n: 'Aú' }]] });
  await page.goto('/app#/log');
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('roda.seqs.imported:')))).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: '📚 Saved' }).click();
  const items = page.getByRole('dialog').locator('[data-sequence]');
  await expect(items).toHaveCount(1);
  await items.first().click();
  await expect(page.locator('textarea[data-round-text]').first()).toHaveValue('Armada, Aú');
});

test('saves a round as a sequence from Log training', async ({ page }) => {
  await signIn(page);
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
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/unit/entry-links.test.js tests/unit/layout.test.js && npm run build:test && npx playwright test tests/e2e/app-switch-over.spec.js`
Expected: FAIL — `entry-links.js` does not exist, there is no demo note, and the browser tests find no sheets, no import, and no "Save as sequence" button. The first browser test also fails its first assertion, because today's sign-in return drops the query.

- [ ] **Step 4: Implement the link handling**

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

- [ ] **Step 5: Wire the entry, the layout, and the composer**

`src/app/shell/layout.js`: add `demo = false` to `createLayout`'s options; before `const root = …` add

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

`src/app/entries/app.js`:

1. Imports: `import { importLocalRepertoire } from '../repertoire-import.js';` and `import { runEntryLinks, takeEntryLinks } from '../shell/entry-links.js';`.
2. Add, near the top of `main()`:

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

4. Right after the signed-out and error branches return (Plan 1's anchor is `const { profile } = startup;`), add:

```js
  takeEntryLinks(window, tabStorage);
  importLocalRepertoire({ storage: localStorage, repertoire: services.repertoire, userId: startup.session.user.id }).catch(() => {});
```

5. Pass `demo: demoMode` to `createLayout({ … })`.
6. At the end of `show(route)`, after the view is placed (`target.replaceChildren(view)` and the focus line), add:

```js
    if (route.name !== 'welcome') runEntryLinks(ctx, tabStorage);
```

`src/app/screens/log.js`: pass the repertoire to the round editor so cards offer "Save as sequence":

```js
  const editor = createRoundEditor({
    document, i18n, mode: 'record', getTermMappings: ctx.getTermMappings, showAddButton: false, repertoire: ctx.services.repertoire,
  });
```

- [ ] **Step 6: Run to verify they pass**

Run: `npx vitest run tests/unit/entry-links.test.js tests/unit/layout.test.js tests/unit/log-screen.test.js tests/unit/dashboard-i18n.test.js && npm run build:test && npx playwright test tests/e2e/app-switch-over.spec.js tests/e2e/app-shell.spec.js tests/e2e/app-navigation.spec.js`
Expected: PASS. (`app-shell`'s "signed-out visitors go to sign-in and keep the route" still expects `%2Fapp%23%2Fcalendar`, which the path-based return produces.)

- [ ] **Step 7: Run the suites**

Run: `npm run test:unit && npm run test:e2e`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/shell/entry-links.js src/app/shell/layout.js src/app/entries/app.js src/app/screens/log.js src/app/dashboard-i18n.js assets/app.css tests/unit/entry-links.test.js tests/unit/layout.test.js tests/e2e/app-switch-over.spec.js
git commit -m "feat: open invitations and group links, import saved sequences, and label the demo in the new app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Port the old dashboard's browser tests

**Files:**
- Test: `tests/e2e/app-switch-over.spec.js`

**Interfaces:**
- Consumes: `signIn(page, extra)` and the `beforeEach` clock from Task 7.
- Produces: the test titles named by the `here(...)` rows in Task 1's audit.

These are coverage ports for behaviors the old dashboard tested on screens Plan 1 rebuilt. They are expected to pass on first run; a failure is a real regression of an old capability and is fixed inside this task, in the screen the failing test names.

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
  await signIn(page, { 'roda.e2e.trainingState': { failNext: 'recordAloneTraining' } });
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
  await signIn(page);
  await logRound(page, 'armada, galopanti');
  await expect(page.locator('[data-chip="2"]')).toHaveAttribute('data-status', 'new');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/training\//);
  await expect.poll(async () => (await trainingState(page)).occurrences[0].rounds[0].movements
    .map(({ movement_key: key, catalogued }) => `${key}:${catalogued}`)).toEqual(['armada:true', 'galopanti:false']);
});

test('rates a round and a transition from the training page', async ({ page }) => {
  await signIn(page);
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
  await signIn(page);
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
  await signIn(page, { 'roda.e2e.failProfileLoads': 1 });
  await page.goto('/app');
  await expect(page.getByText('The profile could not be loaded.')).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.week-day')).toHaveCount(7);
});
```

- [ ] **Step 2: Run them**

Run: `npm run build:test && npx playwright test tests/e2e/app-switch-over.spec.js`
Expected: PASS in both projects. If a test fails, it shows an old capability the new app lost: fix the named screen (`src/app/screens/log.js`, `training.js`, or `calendar.js`) in this task, re-run, and mention the fix in the commit message.

- [ ] **Step 3: Confirm the audit rows now have their tests**

Run: `grep -c "^test(" tests/e2e/app-switch-over.spec.js`
Expected: `12`.

- [ ] **Step 4: Run the suites**

Run: `npm run test:unit && npm run test:e2e`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/app-switch-over.spec.js
git commit -m "test: port the old dashboard's browser checks to the new app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Serve the app at `/dashboard`

**Files:**
- Modify: `dashboard.html` (replaced), `app.html` (replaced), `tests/unit/switch-over-parity.test.js`, `tests/e2e/app-*.spec.js`
- Rename: `tests/e2e/auth-dashboard.spec.js` → `tests/e2e/auth.spec.js` (rewritten)
- Delete: `tests/e2e/{catalog-curation,coaching-connections,coaching-training,group-flows,past-class,repertoire,training-calendar,training-resources,training-statistics}.spec.js`
- Test: `tests/unit/pages.test.js` (create), `tests/e2e/app-redirect.spec.js` (create)

**Interfaces:**
- Consumes: everything in Tasks 1–8.
- Produces: `/dashboard` loads `assets/generated/app.js`; `/app` and `/app.html` forward to `/dashboard` with the same query and hash; `PORTS_DONE = true`.

- [ ] **Step 1: Write the failing tests and close the gate**

In `tests/unit/switch-over-parity.test.js`, set `const PORTS_DONE = true;`.

```js
// tests/unit/pages.test.js
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('app pages', () => {
  it('serves the app shell at /dashboard', async () => {
    const html = await readFile('dashboard.html', 'utf8');
    expect(html).toContain('<script type="module" src="/assets/generated/app.js"></script>');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
    expect(html).toContain('id="appRoot"');
    expect(html).not.toContain('generated/dashboard.js');
    expect(html).not.toContain('<dialog');
  });

  it('turns /app into a forward that keeps the query and the hash', async () => {
    const html = await readFile('app.html', 'utf8');
    expect(html).toContain("location.replace('/dashboard' + location.search + location.hash)");
    expect(html).toContain('<meta http-equiv="refresh" content="0; url=/dashboard">');
    expect(html).not.toContain('type="module"');
    expect(html).not.toContain('rel="manifest"');
  });
});
```

```js
// tests/e2e/app-redirect.spec.js
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
});

test('an old /app link opens the same screen under /dashboard', async ({ page }) => {
  await page.goto('/app?demo=1#/training/demo-group-1');
  await expect(page).toHaveURL(/\/dashboard\?demo=1#\/training\/demo-group-1$/);
  await expect(page.locator('.tag').first()).toContainText('⏱');
});

test('a bare /app opens Today under /dashboard', async ({ page }) => {
  await page.goto('/app?demo=1');
  await expect(page).toHaveURL(/\/dashboard\?demo=1$/);
  await expect(page.locator('.week-day')).toHaveCount(7);
});

test('/app.html forwards too', async ({ page }) => {
  await page.goto('/app.html?demo=1#/calendar');
  await expect(page).toHaveURL(/\/dashboard\?demo=1#\/calendar$/);
  await expect(page.locator('.cal-day')).toHaveCount(35);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/pages.test.js tests/unit/switch-over-parity.test.js && npm run build:test && npx playwright test tests/e2e/app-redirect.spec.js`
Expected: FAIL — `dashboard.html` is the old page, `app.html` is the app, the audit reports missing `auth.spec.js` titles and stray old specs, and the browser stays on `/app`.

- [ ] **Step 3: Move the app shell to `/dashboard` and forward `/app`**

```bash
cp app.html dashboard.html
```

`dashboard.html` now has the app's head (including any stylesheet Plans 2–3 added). Replace `app.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Roda</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <!-- The app moved to /dashboard. Keep the query (demo, invitations) and the
       hash route, which never reaches the server, so old links and home-screen
       icons keep working. -->
  <script>location.replace('/dashboard' + location.search + location.hash);</script>
  <noscript><meta http-equiv="refresh" content="0; url=/dashboard"></noscript>
</head>
<body>
  <p><a href="/dashboard">Open Roda</a></p>
</body>
</html>
```

- [ ] **Step 4: Point the new app's browser tests at `/dashboard`**

`app-redirect.spec.js` (written in Step 1) must keep its `/app` URLs, so it is excluded:

```bash
SPECS=$(ls tests/e2e/app-*.spec.js | grep -v app-redirect.spec.js)
perl -pi -e 's{([\x27"\x60])/app(?=[\x27"\x60?#])}{$1/dashboard}g; s{%2Fapp(?![A-Za-z0-9])}{%2Fdashboard}g; s{\\/app(?![A-Za-z0-9-])}{\\/dashboard}g' $SPECS
grep -nP "[\x27\"\x60]/app[\x27\"\x60?#]|%2Fapp|\\\\/app(?![A-Za-z0-9-])" $SPECS
```

Expected: the `grep` prints nothing. Fix by hand any line it prints.

- [ ] **Step 5: Keep the sign-in tests and delete the old dashboard's browser specs**

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
    { type: 'google', next: '/dashboard' },
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
    { type: 'email', email: 'student@example.com', next: '/dashboard' },
  ]);
});

test('opens a seeded browser-only demo without an account', async ({ page }) => {
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Try demo' }).click();

  await expect(page).toHaveURL('/dashboard?demo=1');
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
  await expect(page).toHaveURL(/\/dashboard(#\/[a-z/]*)?$/);
});

test('exchanges a callback once and returns to a safe local destination', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('roda.e2e.profile', JSON.stringify({
    id: 'practitioner-1', display_name: 'Ana Silva', avatar_path: null,
    timezone_override: null, leaderboard_visible: true, completed_at: '2026-09-11T20:00:00Z',
  })));
  await page.goto('/auth/callback?code=e2e-success&next=%2Fdashboard%3Fgroup_link%3Dsafe-token');

  await expect(page).toHaveURL(/\/dashboard(#\/)?$/);
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
  await expect(page.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute('href', '/dashboard');
});

test('returns unauthenticated dashboard visits to the unified sign-in destination', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page).toHaveURL('/?next=%2Fdashboard');
  await expect(page.getByRole('dialog', { name: 'Sign in' })).toBeVisible();
});
```

(The signed-in account in "uses the same entry…" has no stored profile, so Plan 2's welcome may add `#/welcome`; the pattern allows it.)

- [ ] **Step 6: Run to verify they pass**

Run: `npx vitest run tests/unit/pages.test.js tests/unit/switch-over-parity.test.js && npm run build:test && npx playwright test`
Expected: PASS — every browser spec, including the renamed app specs now at `/dashboard`, the redirect spec, and `auth.spec.js`.

- [ ] **Step 7: Run the unit suite**

Run: `npm run test:unit`
Expected: PASS (the old views' unit tests still pass; their code is removed in Task 11).

- [ ] **Step 8: Commit**

```bash
git add -A dashboard.html app.html tests/unit/pages.test.js tests/unit/switch-over-parity.test.js tests/e2e
git commit -m "feat: serve the new app at /dashboard and forward /app links there

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The installable app lives at `/dashboard`

**Files:**
- Create: `src/app/sw/retire-app-worker.js`, `src/app/sw/register.js`
- Modify: `src/app/sw/cache-policy.js`, `src/app/sw/service-worker.js`, `src/app/entries/app.js`, `scripts/build.mjs`, `.gitignore`, `manifest.webmanifest`
- Test: `tests/unit/cache-policy.test.js`, `tests/unit/service-worker.test.js`, `tests/unit/retire-app-worker.test.js` (create), `tests/unit/sw-register.test.js` (create), `tests/unit/manifest.test.js`, `tests/unit/build-config.test.js`

**Interfaces:**
- Consumes: `loadWorker(load, { cacheKeys })` and `lifecycle` from `tests/unit/helpers/worker-harness.js` (Task 3).
- Produces (`cache-policy.js`): `SHELL_PATH = '/dashboard'`, `cacheName(version) → 'roda-dashboard-<version>'`, `CACHE_PREFIXES = ['roda-app-', 'roda-dashboard-']`.
- Produces (`register.js`): `WORKER_URL = '/dashboard-sw.js'`, `WORKER_SCOPE = '/dashboard'`, `registerAppWorker({ navigator, caches }) → Promise<void>` (never throws).
- Produces (`build.mjs`): `WORKER_ENTRY_POINTS = { 'dashboard-sw': 'src/app/sw/service-worker.js', 'app-sw': 'src/app/sw/retire-app-worker.js' }`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/cache-policy.test.js`: change the `APP_SHELL` expectation's `'/app'` to `'/dashboard'`; change the navigation rows to `[req('/dashboard', { mode: 'navigate' }), 'network-first']` and add `[req('/app', { mode: 'navigate' }), 'bypass']` (remove the old `'/dashboard' → 'bypass'` row); change the cache-name test to `expect(cacheName('123')).toBe('roda-dashboard-123');`.

Add to `tests/unit/service-worker.test.js`:

```js
  it('drops caches from older versions and from /app, and keeps others', async () => {
    const worker = await loadWorker({ cacheKeys: ['roda-app-1', 'roda-dashboard-old', 'roda-dashboard-test', 'other'] });
    await lifecycle(worker.handlers, 'activate');
    expect(worker.cacheStorage.delete.mock.calls.map(([key]) => key).sort()).toEqual(['roda-app-1', 'roda-dashboard-old']);
  });
```

```js
// tests/unit/retire-app-worker.test.js
import { afterEach, describe, expect, it, vi } from 'vitest';

import { lifecycle, loadWorker as load } from './helpers/worker-harness.js';

const loadWorker = (options) => load(() => import('../../src/app/sw/retire-app-worker.js'), options);

afterEach(() => { vi.unstubAllGlobals(); });

describe('retired /app worker', () => {
  it('never answers requests', async () => {
    const worker = await loadWorker();
    expect(worker.handlers.fetch).toBeUndefined();
  });

  it('deletes the old caches and unregisters itself', async () => {
    const worker = await loadWorker({ cacheKeys: ['roda-app-1', 'roda-dashboard-2', 'other'] });
    await lifecycle(worker.handlers, 'install');
    expect(worker.self.skipWaiting).toHaveBeenCalled();
    await lifecycle(worker.handlers, 'activate');
    expect(worker.cacheStorage.delete.mock.calls.map(([key]) => key)).toEqual(['roda-app-1']);
    expect(worker.self.registration.unregister).toHaveBeenCalled();
  });
});
```

```js
// tests/unit/sw-register.test.js
import { describe, expect, it, vi } from 'vitest';

import { registerAppWorker } from '../../src/app/sw/register.js';

function setup(scopes, cacheKeys = []) {
  const registrations = scopes.map((scope) => ({ scope, unregister: vi.fn().mockResolvedValue(true) }));
  const navigator = { serviceWorker: { register: vi.fn().mockResolvedValue({}), getRegistrations: vi.fn().mockResolvedValue(registrations) } };
  const caches = { keys: vi.fn().mockResolvedValue(cacheKeys), delete: vi.fn().mockResolvedValue(true) };
  return { registrations, navigator, caches };
}

describe('registerAppWorker', () => {
  it('registers the dashboard worker and retires the /app one', async () => {
    const { registrations, navigator, caches } = setup(['https://roda.fyi/app', 'https://roda.fyi/dashboard'], ['roda-app-1', 'roda-dashboard-2']);
    await registerAppWorker({ navigator, caches });
    expect(navigator.serviceWorker.register).toHaveBeenCalledWith('/dashboard-sw.js', { scope: '/dashboard' });
    expect(registrations[0].unregister).toHaveBeenCalled();
    expect(registrations[1].unregister).not.toHaveBeenCalled();
    expect(caches.delete.mock.calls.map(([key]) => key)).toEqual(['roda-app-1']);
  });

  it('never throws when workers are missing or failing', async () => {
    await expect(registerAppWorker({ navigator: {}, caches: undefined })).resolves.toBeUndefined();
    const { navigator, caches } = setup([]);
    navigator.serviceWorker.register.mockRejectedValue(new Error('blocked'));
    navigator.serviceWorker.getRegistrations.mockRejectedValue(new Error('blocked'));
    await expect(registerAppWorker({ navigator, caches })).resolves.toBeUndefined();
  });
});
```

In `tests/unit/manifest.test.js`, replace the `toMatchObject` expectation with:

```js
    expect(manifest).toMatchObject({
      id: '/app', name: 'Roda', short_name: 'Roda', start_url: '/dashboard', scope: '/', display: 'standalone',
      background_color: '#17120d', theme_color: '#17120d',
    });
```

Add to `tests/unit/build-config.test.js`:

```js
describe('service workers', () => {
  it('builds the dashboard worker and the /app retirement worker', async () => {
    const { WORKER_ENTRY_POINTS } = await import('../../scripts/build.mjs');
    expect(WORKER_ENTRY_POINTS).toEqual({
      'dashboard-sw': 'src/app/sw/service-worker.js',
      'app-sw': 'src/app/sw/retire-app-worker.js',
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/cache-policy.test.js tests/unit/service-worker.test.js tests/unit/retire-app-worker.test.js tests/unit/sw-register.test.js tests/unit/manifest.test.js tests/unit/build-config.test.js`
Expected: FAIL — old paths, old cache name, missing modules, old manifest, one worker entry.

- [ ] **Step 3: Implement**

`src/app/sw/cache-policy.js`: set `export const SHELL_PATH = '/dashboard';` (the first `APP_SHELL` entry already uses it; keep any entries Plans 2–3 added), and:

```js
// Caches this app has ever created: older versions and the pre-switch /app ones.
export const CACHE_PREFIXES = Object.freeze(['roda-app-', 'roda-dashboard-']);

export function cacheName(version) {
  return `roda-dashboard-${version}`;
}
```

`src/app/sw/service-worker.js`, import `CACHE_PREFIXES` and change the activate filter:

```js
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys
      .filter((key) => key !== CACHE && CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)))
      .map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});
```

```js
// src/app/sw/retire-app-worker.js
// Built to /app-sw.js. The app moved from /app to /dashboard; browsers that
// installed the old worker fetch this file on their next update check. It
// removes the old caches and unregisters itself. It has no fetch handler, so
// /app requests go to the network, where app.html forwards them to /dashboard.
const OLD_PREFIX = 'roda-app-';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith(OLD_PREFIX)).map((key) => caches.delete(key))))
    .then(() => self.registration.unregister()));
});
```

```js
// src/app/sw/register.js
export const WORKER_URL = '/dashboard-sw.js';
export const WORKER_SCOPE = '/dashboard';
const RETIRED_SCOPE_PATH = '/app';

// Registers the app's worker and retires the one installed while the app
// lived at /app. Offline files are a convenience: nothing here may throw.
export async function registerAppWorker({ navigator, caches }) {
  const workers = navigator?.serviceWorker;
  if (!workers) return;
  try {
    await workers.register(WORKER_URL, { scope: WORKER_SCOPE });
  } catch {
    // The app works without offline files.
  }
  try {
    const registrations = await workers.getRegistrations();
    await Promise.all(registrations
      .filter((registration) => new URL(registration.scope).pathname === RETIRED_SCOPE_PATH)
      .map((registration) => registration.unregister()));
    const keys = (await caches?.keys?.()) ?? [];
    await Promise.all(keys.filter((key) => key.startsWith('roda-app-')).map((key) => caches.delete(key)));
  } catch {
    // Cleanup is best effort; the retirement worker finishes it later.
  }
}
```

`src/app/entries/app.js`: import `registerAppWorker` from `'../sw/register.js'` and replace the `navigator.serviceWorker.register('/app-sw.js', { scope: '/app' })` block with:

```js
  if (!__RODA_E2E__) registerAppWorker({ navigator, caches: window.caches });
```

`scripts/build.mjs`:

```js
export const WORKER_ENTRY_POINTS = Object.freeze({
  'dashboard-sw': 'src/app/sw/service-worker.js',
  'app-sw': 'src/app/sw/retire-app-worker.js',
});
```

`.gitignore`: add `dashboard-sw.js` on the line after `app-sw.js`.

`manifest.webmanifest`:

```json
{
  "id": "/app",
  "name": "Roda",
  "short_name": "Roda",
  "description": "Train, teach, and track capoeira.",
  "start_url": "/dashboard",
  "scope": "/",
  "display": "standalone",
  "background_color": "#17120d",
  "theme_color": "#17120d",
  "icons": [
    { "src": "/assets/icons/app-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/assets/icons/app-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

Keep any manifest fields Plans 2–3 added.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/unit/cache-policy.test.js tests/unit/service-worker.test.js tests/unit/retire-app-worker.test.js tests/unit/sw-register.test.js tests/unit/manifest.test.js tests/unit/build-config.test.js && npm run build:test && ls app-sw.js dashboard-sw.js`
Expected: PASS, and both worker files exist.

- [ ] **Step 5: Run the suites**

Run: `npm run test:unit && npm run test:e2e`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/sw src/app/entries/app.js scripts/build.mjs .gitignore manifest.webmanifest tests/unit/cache-policy.test.js tests/unit/service-worker.test.js tests/unit/retire-app-worker.test.js tests/unit/sw-register.test.js tests/unit/manifest.test.js tests/unit/build-config.test.js
git commit -m "feat: install the app from /dashboard and retire the /app service worker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Remove the old dashboard code

**Files:**
- Modify: `scripts/build.mjs`, `src/app/dashboard-i18n.js`, `tests/unit/pages.test.js`
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
  // Keys built at runtime, such as `training.${difficulty}`.
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
    for (const page of ['index.html', 'dashboard.html', 'app.html', 'studio.html', 'auth/callback.html']) {
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
Expected: FAIL. The dead-code test lists the orphans. With Plan 2's reuse of the Progress, Repertoire, and Catalog views, the expected list is:

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

plus `src/app/time-zones.js` and `src/app/training-plan-state.js` if no Plan 2 screen imports them. Delete only what the test prints. The copy test lists unused keys; the stylesheet test lists `assets/dashboard.css` and `assets/training-calendar.css` (and `assets/training-statistics.css` only if no page links it).

- [ ] **Step 3: Delete the dead modules and their unit tests**

Put the printed module paths in `DEAD`, then:

```bash
DEAD="src/app/dashboard-state.js src/app/entries/dashboard.js src/app/ui/coaching-training-view.js src/app/ui/connection-view.js src/app/ui/dashboard-view.js src/app/ui/group-view.js src/app/ui/past-class-view.js src/app/ui/profile-view.js src/app/ui/training-calendar-view.js"
for path in $DEAD; do grep -l "/$(basename "$path")'" tests/unit/*.test.js; done | sort -u
```

Expected: the unit tests of the deleted modules only (`coaching-training-view`, `connection-view`, `dashboard-state`, `group-view`, `past-class-view`, `training-calendar-view` `.test.js`, plus `training-plan-state.test.js` if that module was deleted). If a test of a kept module appears, stop and inspect it: it means a kept module imports a dead one, which the dead-code test would have reported.

```bash
git rm -q $DEAD $(for path in $DEAD; do grep -l "/$(basename "$path")'" tests/unit/*.test.js; done | sort -u)
```

- [ ] **Step 4: Delete unused stylesheets and copy**

```bash
git rm -q assets/dashboard.css assets/training-calendar.css
```

(Only the files the stylesheet test printed; add `assets/training-statistics.css` if it printed that too.) Then remove every unused copy key from both locales:

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

Expected: a list that includes the `dashboard.*` keys and the retired `app.classic`, `app.comingSoon`, `app.completeProfile`. If `tests/unit/dashboard-i18n.test.js` used a removed key (for example `connections.requested`), switch that assertion to a kept key with a placeholder, such as `today.attended` with `{ count: 3 }` → `'3 attended'` / `'3 presentes'` (read the actual `pt` value from the file).

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run tests/unit/dead-code.test.js tests/unit/i18n-usage.test.js tests/unit/pages.test.js tests/unit/dashboard-i18n.test.js tests/unit/switch-over-parity.test.js`
Expected: PASS — including the parity audit, which proves every old service call is still made after the deletion.

- [ ] **Step 6: Run all suites**

Run: `npm run test:unit && npm run test:e2e && npm run test:db`
Expected: PASS.

- [ ] **Step 7: Confirm no reference to the deleted code remains**

```bash
grep -rnE "dashboard-view|training-calendar-view|coaching-training-view|connection-view|group-view|profile-view|past-class-view|dashboard-state|generated/dashboard\.js|dashboard\.css|training-calendar\.css" \
  --include='*.js' --include='*.mjs' --include='*.html' --include='*.json' \
  --exclude-dir=node_modules --exclude-dir=test-results --exclude-dir=generated .
```

Expected: no output (names of modules the dead-code test kept, such as `time-zones`, are not in this pattern).

- [ ] **Step 8: Commit**

```bash
git add -A scripts/build.mjs src tests assets
git commit -m "chore: remove the old dashboard views, entry, styles, tests, and copy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Docs, production smoke checklist, and final verification

**Files:**
- Modify: `README.md`, `ROADMAP.md`, `docs/auth-and-database-operations.md`, `docs/training-platform-design-decisions.md`, `docs/security-checklist.md`

**Interfaces:**
- Consumes: the finished switch-over.
- Produces: documentation only.

- [ ] **Step 1: README**

Replace the whole `### The new app (`/app`)` subsection of `README.md` with:

```markdown
### The app (`/dashboard`)

Signed-in people use a mobile-first app at `/dashboard`: Today, Calendar,
Discover, and Me in a bottom tab bar on phones (a sidebar on desktop), with
**+** for logging a training, scheduling a class, or recording a past class.
Screens are hash routes such as `/dashboard#/calendar/2026-10`, so links can be
shared. The app can be added to a phone's home screen; its service worker keeps
only the app's own files, never training data. The development address `/app`
now forwards to `/dashboard` and keeps the rest of the link.
```

Also change the sentence "Catalog curators see a Catalog tab listing uncatalogued words…" to "Catalog curators see Catalog under Me, listing uncatalogued words…".

- [ ] **Step 2: ROADMAP**

In `ROADMAP.md`, after the bullet list under "Delivered in the training-input increment", add:

```markdown
Delivered in the mobile-first app
(`docs/superpowers/specs/2026-10-11-mobile-first-app-design.md`), served at
`/dashboard`:

- Today, Calendar, Log training with a chat box, and a video-first training page,
- Teaching, Progress, Repertoire, Groups, Catalog, and Settings under Me,
- a Train · Both · Teach setting in place of the My Training / Coaching switch,
- Discover v1: people at city level and groups on an OpenStreetMap map, and
- an installable web app.
```

and add to the "Next:" list:

```markdown
- **App-store packaging** (for example with Capacitor) and **offline data
  access**; the web app currently caches only its own files.
```

- [ ] **Step 3: Operations runbook**

In `docs/auth-and-database-operations.md`:

1. In the deployment table, change the first row's concern to `Static site, callback, the app at /dashboard, service workers, browser bundles`.
2. Replace the paragraph "The public movement library remains available without an account. Every signed-in account is a practitioner. “Register as a coach” adds a capability to the same profile; it does not create another user." with: "The public movement library remains available without an account. Every signed-in account is a practitioner. Choosing Both or Teach in the app adds coaching to the same profile; it does not create another user."
3. In "Invitations and discovery links", change the last bullet to: "Query-string tokens (`/dashboard?member_invite=…`, `/dashboard?group_link=…`) survive sign-in through the `next` return route and are removed from the address bar as soon as the app starts; the token then waits in that tab's session storage until the invitation or group sheet opens."
4. Add this section before "## Preview and production rollout":

````markdown
## App switch-over (2026-10)

The mobile-first app replaced the old dashboard at `/dashboard`. The
development address `/app` is a small page (`app.html`) that forwards to
`/dashboard` with the same query and hash; keep it, because home-screen icons
installed from `/app` keep opening it. The app's service worker is
`/dashboard-sw.js` (scope `/dashboard`, caches `roda-dashboard-*`); `/app-sw.js`
is a retirement worker that deletes `roda-app-*` caches and unregisters itself.
The manifest keeps `"id": "/app"` on purpose: it is the installed app's
identity, so Android updates existing installs instead of creating a second app.

Production smoke checklist after deploying the switch-over:

1. `curl -sI https://roda.fyi/dashboard` returns 200, and
   `curl -s https://roda.fyi/dashboard | grep -c 'assets/generated/app.js'`
   prints 1.
2. `curl -s https://roda.fyi/app | grep -c "location.replace('/dashboard'"`
   prints 1, and `curl -s https://roda.fyi/dashboard-sw.js | head -c 200`
   shows JavaScript.
3. Open `https://roda.fyi/app#/calendar` → the address becomes
   `https://roda.fyi/dashboard#/calendar` and the month shows.
4. Open `https://roda.fyi/dashboard?demo=1` → "Demo · browser only" and Today.
5. In a private window, open `https://roda.fyi/dashboard#/me/settings` → sign in
   → you return to Settings.
6. Create a member invitation in Me → Groups; open it in a private window,
   sign in, accept once; the address bar never shows the token after the app
   opens. Open it again → "already been used".
7. Rotate an unlisted group's discovery link, open it signed in → the group
   sheet, request access; the request appears for the group's coach.
8. Browser developer tools → Application: one service worker,
   `/dashboard-sw.js` with scope `/dashboard`; no registration with scope
   `/app`; Cache Storage holds only `roda-dashboard-*`.
9. Go offline in developer tools and reload `/dashboard` → the app opens and
   says you are offline; no training data appears from the cache.
10. On a phone that had added `/app` to its home screen, open the icon → the
    app opens at `/dashboard`. If the browser's address bar shows inside the
    app (possible on iOS), remove the icon and add `/dashboard` again. A fresh
    "Add to Home Screen" from `/dashboard` opens full-screen.
11. On a phone, log a training whose round contains a long pasted link → the
    page never scrolls sideways.
12. Write a round in Log training, then sign out from Settings → the warning
    appears; after "Sign out and delete", Local Storage has no
    `roda.logDraft:` or `roda.pendingResources:` keys.
13. Run the bundle scan from the security checklist on the production build;
    it prints nothing.

Rollback: use Vercel's instant rollback to the previous deployment. The
`202610250001_resource_idempotency.sql` migration only adds a column and a
function argument with a default, so earlier code keeps working against it.
````

- [ ] **Step 4: Design decisions and security checklist**

In `docs/training-platform-design-decisions.md`, at the end of "Decision 3: Universal practitioner accounts and dashboard modes", add:

```markdown
**Update (2026-10):** the mobile-first app replaced the binary switch with a
Train · Both · Teach setting stored on the profile. It changes emphasis (what
**+** does, which Today cards come first, whether Teaching is listed under Me,
and the default Discover visibility), never access. Choosing Both or Teach
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
- [ ] Signing out warns about unsynced drafts and resources and then removes
  every `roda.logDraft:*` and `roda.pendingResources:*` key from the device.
```

- [ ] **Step 5: Full verification from a clean build**

Run:

```bash
npm run build
npm run test:unit
npm run test:e2e
npm run test:db
npm run build
rg -n "service_role|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|sb_publishable_e2e_test|__RODA_E2E_EVENTS__" assets/generated
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
| 4 Training page | `app-training.spec.js`, `app-switch-over.spec.js › adds a summary file…` |
| 5 Coaches finish a class | Plan 2's test mapped in the parity audit (`coaching-training.spec.js › confirms only attendees…` row) |
| 6 Calendar | `app-calendar.spec.js`, `app-switch-over.spec.js › Calendar fits a phone…` |
| 7 Train · Both · Teach | Plan 2's test mapped in the audit (`uses a binary mode switch…` row) |
| 8 Discover | Plan 3's tests (`npx playwright test -g Discover` lists them) |
| 9 Desktop sidebar and side by side | `app-switch-over.spec.js › Calendar fits a phone and sits beside the training on desktop` |
| 10 Home screen | `manifest.test.js`, `sw-register.test.js`, smoke checklist item 10 |
| 11 Suites pass | Step 5 |

If a row has no passing test, stop and report it.

- [ ] **Step 7: Commit**

```bash
git add README.md ROADMAP.md docs/auth-and-database-operations.md docs/training-platform-design-decisions.md docs/security-checklist.md
git commit -m "docs: describe the app at /dashboard and the switch-over smoke checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
