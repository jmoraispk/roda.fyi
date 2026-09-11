# Authentication and Group Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver roda.fyi's secure account and group foundation: one Google-first sign-in experience, universal practitioner profiles with optional coaching capability, self-managed groups and memberships, invitation-based group hierarchy, tested RLS/storage boundaries, and a framework-free authenticated dashboard shell.

**Architecture:** Keep the existing public movement library as static HTML and add three small browser bundles built with esbuild: public authentication, authentication callback, and dashboard. The bundles call Supabase Auth and a deliberately narrow Postgres API. Application tables remain in `public` with RLS enabled and minimal grants; mutating and projection logic lives in `private` `security definer` functions with an empty search path, reached through `public` security-invoker wrappers. Git-tracked migrations are the database source of truth. Vercel still serves static files, while its build injects only the public Supabase URL and publishable key.

**Tech Stack:** Node.js 22.22.2, npm, vanilla HTML/CSS/JavaScript, esbuild 0.28.2, `@supabase/supabase-js` 2.116.0, Vitest 5.0.0, jsdom 30.0.1, Playwright 1.63.0, Supabase CLI 2.117.0, PostgreSQL, pgTAP, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-11-auth-group-foundation-design.md`

## Global Constraints

- Work on `codex/auth-group-foundation` (or an isolated worktree created from it), not directly on `main`.
- Do not push an incomplete migration chain to `main`; the connected Supabase project may deploy production migrations from that branch.
- Do not migrate `index.html` or `studio.html` to a frontend framework. Anonymous visitors must retain full movement-library access.
- The top-level dashboard control is a binary **My Training / Coaching** mode switch implemented with pressed buttons, not tabs. Tabs may only appear below it in future deliveries.
- Every authenticated account is a practitioner. `coach_profiles` adds coaching capability to the same identity; it never replaces the practitioner profile.
- Do not add workout, plan, round, session, feedback, calendar, ranking-result, music, recommendation, partner-drill, or traveling-drill tables in this delivery.
- Browser code may receive only `RODA_SUPABASE_URL` and `RODA_SUPABASE_PUBLISHABLE_KEY`. Never commit or bundle the database password, service-role key, Supabase personal access token, Google client secret, or SMTP credentials.
- Enable RLS explicitly in migrations even though automatic RLS is enabled on the hosted project. Revoke default table privileges before granting the minimum required operations.
- Keep every `security definer` function in the unexposed `private` schema, set `search_path = ''`, schema-qualify every referenced object, revoke execution from `public`, and grant execution only to the role that needs it.
- Public API wrappers in `public` must be `security invoker`; they may call only the corresponding checked function in `private`.
- Preserve state history through status changes (`left`, `removed`, `revoked`, `archived`) rather than hard deletion.
- A person can be a member in one group and a coach or owner in another.
- Named/full inherited access stops at the immediate parent. Higher ancestors can be considered only by a future aggregate interface and must never gain raw-row access.
- Test behavior before implementation in each task. A failing test must demonstrate the missing behavior before production code is added.
- Commit after every task using the message shown. Do not include unrelated existing changes.

---

## Planned File Structure

### New runtime and build files

- `.nvmrc` — exact Node.js version.
- `package.json`, `package-lock.json` — pinned build/test/Supabase tooling.
- `.env.example` — names and documentation for the two public browser values only.
- `scripts/build.mjs` — loads `.env.local`, validates public config, and builds three browser bundles.
- `assets/auth.css` — shared sign-in dialog styles.
- `assets/dashboard.css` — authenticated shell, profile, group, and hierarchy styles.
- `assets/generated/` — ignored build output containing `public-auth.js`, `auth-callback.js`, and `dashboard.js`.
- `auth/callback.html` — PKCE callback and safe return-route screen.
- `dashboard.html` — authenticated product shell.
- `src/app/config.js` — build-injected public config.
- `src/app/supabase-client.js` — one browser-client factory.
- `src/app/errors.js` — stable RPC/auth error normalization.
- `src/app/return-route.js` — local-only return URL validation and invitation restoration.
- `src/app/auth-service.js` — Google, email-link, callback, session, and sign-out operations.
- `src/app/profile-service.js` — profile completion, timezone, picture, and coach registration operations.
- `src/app/group-service.js` — typed query/RPC boundary for all group flows.
- `src/app/dashboard-state.js` — pure mode/context selection and access-revocation behavior.
- `src/app/ui/auth-dialog.js` — dependency-injected sign-in dialog controller.
- `src/app/ui/profile-view.js` — dependency-injected profile completion/settings controller.
- `src/app/ui/dashboard-view.js` — shell, mode switch, context switcher, and empty states.
- `src/app/ui/group-view.js` — discovery, requests, invitations, roster, settings, and hierarchy controller.
- `src/app/entries/public-auth.js` — homepage composition root.
- `src/app/entries/auth-callback.js` — callback composition root.
- `src/app/entries/dashboard.js` — dashboard composition root.
- `src/app/testing/fake-services.js` — included only in the E2E build.

### New database files

- `supabase/config.toml` — local Supabase configuration.
- `supabase/migrations/202609110001_foundation_schema.sql` — schemas, enums, tables, indexes, triggers, and locked-down grants.
- `supabase/migrations/202609110002_foundation_permissions.sql` — read-side permission helpers and limited projections.
- `supabase/migrations/202609110003_foundation_membership_api.sql` — profile, coach, group, request, membership, and invitation transitions.
- `supabase/migrations/202609110004_foundation_hierarchy_api.sql` — relationship transitions and future permission interface.
- `supabase/migrations/202609110005_foundation_rls.sql` — policies and explicit API/table/function grants.
- `supabase/migrations/202609110006_foundation_storage.sql` — private buckets and object policies.
- `supabase/tests/0000_test_helpers.sql` — test identities, JWT switching, and fixture helpers.
- `supabase/tests/0001_foundation_constraints.test.sql` — table and invariant tests.
- `supabase/tests/0002_membership_authorization.test.sql` — member/coach/owner access matrix.
- `supabase/tests/0003_invitation_discovery.test.sql` — searchable/unlisted/request/invitation tests.
- `supabase/tests/0004_hierarchy_authorization.test.sql` — parent, cycle, sharing, and non-cascade tests.
- `supabase/tests/0005_storage_authorization.test.sql` — profile/group object path policies.

### New browser tests and documentation

- `vitest.config.js`
- `playwright.config.js`
- `tests/unit/return-route.test.js`
- `tests/unit/build-config.test.js`
- `tests/unit/auth-service.test.js`
- `tests/unit/profile-service.test.js`
- `tests/unit/dashboard-state.test.js`
- `tests/unit/auth-dialog.test.js`
- `tests/unit/group-view.test.js`
- `tests/e2e/auth-dashboard.spec.js`
- `tests/e2e/group-flows.spec.js`
- `docs/auth-and-database-operations.md`
- `docs/security-checklist.md`

### Modified files

- `.gitignore` — ignore generated bundles and local Supabase output without ignoring migrations.
- `index.html` — add the unified sign-in entry/dialog and load the public-auth bundle.
- `vercel.json` — run the pinned npm build while continuing to serve the repository as a static site.
- `README.md` — link setup, database, test, and security documentation.
- `docs/README.md` — link the approved spec, this plan, and operations guide.

---

## Database Contract

### Tables and columns

The first migration creates the following exact application fields. All IDs are `uuid`; all timestamps are `timestamptz`; all mutable rows have `created_at` and `updated_at` with `now()` defaults.

| Table | Required contract |
|---|---|
| `profiles` | `id` PK/FK to `auth.users`; `display_name` (1–80 trimmed characters); nullable `avatar_path`; nullable `timezone_override` (Automatic is `null`); `leaderboard_visible boolean default true`; nullable `completed_at` |
| `coach_profiles` | `profile_id` PK/FK to `profiles`; `activated_at` |
| `groups` | `id`; immutable unique `slug`; `owner_id`; `name` (1–120); nullable `description` (max 2,000), `location` (max 160), `picture_path`; `is_discoverable default true`; nullable `archived_at`, `archived_by` |
| `group_memberships` | `id`; `group_id`; `profile_id`; `access_level` = `member`/`coach`; `state` = `active`/`left`/`removed`; `joined_at`; nullable `ended_at`, `ended_by`; unique `(group_id, profile_id)` |
| `group_join_requests` | `id`; `group_id`; `profile_id`; `requested_access`; state = `pending`/`approved`/`declined`/`cancelled`/`expired`; `expires_at` default 30 days; nullable decision actor/time; one pending row per person/group/access |
| `group_member_invitations` | `id`; `group_id`; nullable normalized `email`; unique `token_hash bytea`; state = `pending`/`accepted`/`revoked`/`expired`; `invited_by`; `expires_at` default 7 days; nullable acceptance/revocation actor/time |
| `group_discovery_links` | `id`; `group_id`; unique `token_hash bytea`; state = `active`/`revoked`; `created_by`; nullable `revoked_by`, `revoked_at`; one active row per group |
| `group_relationships` | `id`; `parent_group_id`; `child_group_id`; state = `pending`/`active`/`declined`/`revoked`/`expired`; sharing = `named_progress`/`full_coaching`; `invited_by`; `expires_at` default 30 days; nullable decision/revocation actor/time; one active parent per child |
| `private.group_ownership_audit` | `id`; `group_id`; `previous_owner_id`; `new_owner_id`; `changed_by`; `changed_at` |

Foreign-key behavior is conservative: auth-user deletion cascades to its profile only through Supabase's account-deletion path; group-owned records cascade when a group is deleted by trusted maintenance, while ordinary product flows archive/revoke instead. Actor audit columns use `on delete set null` where deletion would otherwise erase history.

### Exposed RPC surface

Browser modules call these `public` wrappers. Each mutator returns one JSON object with a stable `status` and the affected public ID. Retrying a completed operation returns its current stable state instead of adding a duplicate.

```text
complete_my_profile(display_name, timezone_override, leaderboard_visible)
set_my_profile_picture(avatar_path)
register_as_coach()
create_group(name, description, location, is_discoverable)
update_group(group_id, name, description, location, is_discoverable)
set_group_picture(group_id, picture_path)
transfer_group_ownership(group_id, new_owner_id)
archive_group(group_id)
leave_group(group_id)
remove_group_member(group_id, profile_id)
request_group_access(group_id, requested_access, discovery_token)
cancel_group_join_request(request_id)
decide_group_join_request(request_id, decision)
create_member_invitation(group_id, email)
accept_member_invitation(token)
revoke_member_invitation(invitation_id)
rotate_group_discovery_link(group_id)
revoke_group_discovery_link(group_id)
invite_child_group(parent_group_id, child_group_id)
decide_group_relationship(relationship_id, decision)
set_group_relationship_sharing(relationship_id, sharing_level)
revoke_group_relationship(relationship_id)
```

Read projections are exact and deliberately narrower than base tables:

```text
search_groups(search_text, result_limit, result_offset)
resolve_group_discovery_token(token)
list_group_roster(group_id)
list_group_join_requests(group_id)
list_group_member_invitations(group_id)
list_my_member_invitations()
list_group_relationships(group_id)
```

`search_groups` returns only group ID, slug, name, picture path, location, description, and an immediate parent name/slug when both groups are discoverable and active. `list_group_roster` returns only profile ID, display name, resolved picture path, access level, membership state, and join date. It never returns timezone or leaderboard settings.

### Stable permission-helper interface

Later training migrations must call these tested helpers rather than implement ancestry rules again:

```text
private.is_active_group_member(group_id, profile_id)
private.is_group_coach(group_id, profile_id)
private.is_group_owner(group_id, profile_id)
private.is_direct_coach_of(coach_id, practitioner_id)
private.has_named_parent_progress(coach_id, child_group_id)
private.has_full_parent_coaching(coach_id, child_group_id)
private.is_group_ancestor(ancestor_group_id, descendant_group_id)
private.can_roll_up_anonymous_aggregate(source_group_id, ancestor_group_id)
```

The last two helpers prove ancestry/aggregate eligibility only. They do not authorize row reads. A future aggregate function may use `can_roll_up_anonymous_aggregate`, but no foundation policy grants ancestor coaches raw access.

---

## Task 1: Create the Reproducible Toolchain and Build Boundary

**Files:**
- Create: `.nvmrc`
- Create: `package.json`
- Create: `package-lock.json`
- Create: `.env.example`
- Create: `scripts/build.mjs`
- Create: `vitest.config.js`
- Create: `playwright.config.js`
- Modify: `.gitignore`
- Modify: `vercel.json`

- [ ] **Step 1: Create the isolated implementation branch**

```bash
git switch -c codex/auth-group-foundation
```

Expected: branch is created from the reviewed `main` containing the approved spec.

- [ ] **Step 2: Pin Node and dependencies**

Set `.nvmrc` to `22.22.2`. Create `package.json` with `private: true`, `type: "module"`, and exact dev dependencies:

```json
{
  "@playwright/test": "1.63.0",
  "@supabase/supabase-js": "2.116.0",
  "dotenv": "17.4.2",
  "esbuild": "0.28.2",
  "jsdom": "30.0.1",
  "supabase": "2.117.0",
  "vitest": "5.0.0"
}
```

Add scripts: `build`, `build:test`, `test:unit`, `test:e2e`, `test:db`, `test`, `supabase:start`, `supabase:stop`, `supabase:reset`, and `check`. `check` runs build, unit tests, E2E tests, and database tests in that order. Run `npm install` under Node 22.22.2 to create the lockfile.

- [ ] **Step 3: Write a failing build-config test**

In `scripts/build.mjs`, export a pure `readPublicConfig(env)` function. Add an inline Vitest file or `tests/unit/build-config.test.js` proving that blank/malformed URLs and keys not beginning with `sb_publishable_` fail, while a valid URL/key pair is returned unchanged.

Run:

```bash
npm run test:unit -- tests/unit/build-config.test.js
```

Expected: FAIL because the parser does not exist.

- [ ] **Step 4: Implement the three-entry esbuild script**

Load `.env.local` with `dotenv`, require `RODA_SUPABASE_URL` and `RODA_SUPABASE_PUBLISHABLE_KEY`, and build:

```text
src/app/entries/public-auth.js   -> assets/generated/public-auth.js
src/app/entries/auth-callback.js -> assets/generated/auth-callback.js
src/app/entries/dashboard.js     -> assets/generated/dashboard.js
```

Use browser platform, ESM format, target `es2020`, bundling, sourcemaps outside production, and compile-time booleans `__RODA_E2E__` plus the two config strings. `build:test` uses syntactically valid dummy public values and enables `__RODA_E2E__`; the production `build` must fail closed when config is absent.

- [ ] **Step 5: Configure test runners and ignores**

Configure Vitest for `tests/unit/**/*.test.js` with jsdom available per-file. Configure Playwright to start `python tools/serve.py 8137`, use `http://127.0.0.1:8137`, and run Chromium at desktop and 390px mobile widths. Ignore `/assets/generated/`, `/test-results/`, and `/playwright-report/`.

- [ ] **Step 6: Configure Vercel's minimal build**

Change only `installCommand` to `npm ci` and `buildCommand` to `npm run build`; retain `framework: null`, `outputDirectory: "."`, clean URLs, and existing trailing-slash behavior. Document the two required Vercel environment variables in `.env.example` without values.

- [ ] **Step 7: Verify and commit**

```bash
npm run build:test
npm run test:unit -- tests/unit/build-config.test.js
git status --short
git add .nvmrc package.json package-lock.json .env.example scripts/build.mjs vitest.config.js playwright.config.js .gitignore vercel.json tests/unit/build-config.test.js
git commit -m "build: add reproducible Supabase browser toolchain"
```

Expected: bundles build with test config, parser tests pass, and generated output remains untracked.

---

## Task 2: Initialize and Link Supabase Safely

**Files:**
- Create: `supabase/config.toml`
- Create: `docs/auth-and-database-operations.md`

**External checkpoint:** The executor needs the hosted project reference, database password, public project URL, and publishable key. The user should put secrets directly in environment variables or provider dashboards, not paste them into chat. A personal access token may be exported as `SUPABASE_ACCESS_TOKEN`; it must not be written to `.env.example` or any committed file.

- [ ] **Step 1: Confirm the local prerequisite**

```bash
node --version
npx supabase --version
```

Expected: Node `v22.22.2` and Supabase CLI `2.117.0`. Local `supabase start` additionally requires a Docker-compatible runtime; if Docker is unavailable, continue schema authoring and use a linked disposable/preview Supabase branch for SQL verification, never production data.

- [ ] **Step 2: Initialize the repository**

```bash
npx supabase init
```

Set the local project ID in `supabase/config.toml` to `roda-fyi`. Keep Auth email and OAuth development URLs at `http://127.0.0.1:8137/auth/callback` and the site URL at `http://127.0.0.1:8137`.

- [ ] **Step 3: Link without exposing credentials**

```bash
npx supabase login
npx supabase link --project-ref "$RODA_SUPABASE_PROJECT_REF"
```

If `SUPABASE_ACCESS_TOKEN` is already present, omit interactive login. Supply the database password only at the CLI prompt or through its supported secret variable. Confirm `.gitignore` excludes `supabase/.temp/`.

- [ ] **Step 4: Audit the hosted baseline before writing migrations**

Run `npx supabase db pull` only into a temporary review branch/migration, inspect it, and retain it only if the hosted project contains intentional user-created schema. A new project should not cause provider-managed schemas or secrets to be committed. Never use `db reset`, `db push`, or destructive SQL against the hosted production database during this inspection.

- [ ] **Step 5: Document operational ownership**

In `docs/auth-and-database-operations.md`, explain:

- Vercel deploys the static website; Supabase deploys migrations/functions/bucket declarations.
- GitHub integration must use working directory `.`, production branch `main`, and a required migration check before production deployment.
- Auth provider settings, redirect allowlists, Google secrets, SMTP, and Vercel environment variables remain dashboard configuration.
- Public URL/publishable key are safe in the browser; all other credentials are privileged.
- Local, preview, and production databases must remain separate.

- [ ] **Step 6: Commit**

```bash
git add supabase/config.toml docs/auth-and-database-operations.md
git commit -m "chore: initialize Supabase project workflow"
```

---

## Task 3: Build the Locked-Down Foundation Schema

**Files:**
- Create: `supabase/migrations/202609110001_foundation_schema.sql`
- Create: `supabase/tests/0000_test_helpers.sql`
- Create: `supabase/tests/0001_foundation_constraints.test.sql`

- [ ] **Step 1: Write failing pgTAP schema/invariant tests**

Create test helpers that insert deterministic users into `auth.users`, create completed `profiles`, and switch `request.jwt.claim.sub`, `request.jwt.claim.role`, and SQL role between `anon` and `authenticated`. Tests must begin a transaction and roll back.

Test all table/column contracts above, including:

- default `leaderboard_visible = true` and `timezone_override is null`;
- one membership row per group/person;
- only one pending request per person/group/access;
- only one active discovery link per group;
- only one active parent per child;
- self-relationships rejected;
- expired defaults are 7 days for member invitations and 30 days for requests/relationships;
- all eight public application tables have RLS enabled;
- `anon` and `authenticated` have no direct table privileges after the first migration.

Run:

```bash
npm run test:db -- supabase/tests/0001_foundation_constraints.test.sql
```

Expected: FAIL because the application tables do not exist.

- [ ] **Step 2: Create schemas, extensions, enums, and tables**

Create `private`, revoke public creation/usage, install `pgcrypto` and `unaccent` into `extensions`, and create the exact database contract. Add check constraints for trimmed length, distinct relationship endpoints, status-specific timestamps, positive limits, and expiry after creation.

Generate immutable group slugs from normalized names plus the first eight hex characters of the generated group ID. Do not permit direct slug updates.

- [ ] **Step 3: Add profile and timestamp triggers**

Create a fixed-search-path private trigger that inserts one `profiles` row after `auth.users` insertion. Seed `display_name` from `full_name`, then `name`, then the email local part, then `Capoeirista`; leave `completed_at` null. Add one reusable timestamp trigger for mutable rows.

- [ ] **Step 4: Add deferred ownership integrity**

Create a deferrable constraint trigger that checks every non-archived group has exactly one owner in `groups.owner_id` and that this person has an active coach membership in that group at transaction end. The trigger must cover group inserts/owner changes and membership access/state changes.

- [ ] **Step 5: Lock all tables immediately**

Enable and force RLS on application tables where appropriate; revoke all from `anon` and `authenticated`. Do not add permissive policies in this migration.

- [ ] **Step 6: Reset, test, and commit**

```bash
npm run supabase:reset
npm run test:db -- supabase/tests/0001_foundation_constraints.test.sql
git add supabase/migrations/202609110001_foundation_schema.sql supabase/tests/0000_test_helpers.sql supabase/tests/0001_foundation_constraints.test.sql
git commit -m "feat(db): add locked-down account and group schema"
```

Expected: migration rebuild succeeds from zero and all constraint tests pass.

---

## Task 4: Add Permission Helpers and Safe Read Projections

**Files:**
- Create: `supabase/migrations/202609110002_foundation_permissions.sql`
- Extend: `supabase/tests/0002_membership_authorization.test.sql`

- [ ] **Step 1: Write the failing actor-matrix tests**

Build fixtures for outsider, member, coach, owner, immediate-parent coach, and higher-ancestor coach. Prove:

- only self can read complete profile fields;
- group coaches can retrieve roster names/pictures but not profile timezone/preferences;
- a member cannot retrieve the full roster through the coach projection;
- anonymous search sees only discoverable, active groups and exact public columns;
- unlisted/archived groups do not appear;
- public umbrella name appears only when both immediate groups are discoverable;
- a signed-in recipient can list only invitations bound to their normalized Auth email, without token hashes;
- no read projection returns unrelated request emails, owner IDs, token hashes, or private rows.

Expected: FAIL because helpers/projections do not exist.

- [ ] **Step 2: Implement private identity/permission helpers**

Implement the membership, coach, owner, and direct-coach helpers from the Database Contract as `stable` functions. Each accepts explicit IDs for testability, defaults caller-oriented wrappers to `auth.uid()`, has an empty search path, and returns false on null/missing/inactive records. Task 6 adds the relationship and aggregate helpers after their transition rules are tested.

- [ ] **Step 3: Implement read projections**

Implement `private.search_groups`, `private.resolve_group_discovery_token`, `private.list_group_roster`, and `private.list_my_member_invitations`, plus public invoker wrappers with the exact surface above. Clamp search limit to 1–50, use normalized case-insensitive name/location matching, and return deterministic name/ID ordering.

Discovery resolution must hash the supplied token with SHA-256 and return only the public group projection. It may reveal an unlisted group but never membership or relationship-private data.

- [ ] **Step 4: Verify function hardening**

Add pgTAP assertions that every definer function resides in `private`, has `prosecdef = true`, and has `search_path=''`; every `public` wrapper has `prosecdef = false`. Assert token-hash columns are absent from all public result types.

- [ ] **Step 5: Test and commit**

```bash
npm run supabase:reset
npm run test:db -- supabase/tests/0002_membership_authorization.test.sql
git add supabase/migrations/202609110002_foundation_permissions.sql supabase/tests/0002_membership_authorization.test.sql
git commit -m "feat(db): add permission helpers and safe projections"
```

---

## Task 5: Implement Profiles, Coaching, Groups, and Membership Transitions

**Files:**
- Create: `supabase/migrations/202609110003_foundation_membership_api.sql`
- Extend: `supabase/tests/0002_membership_authorization.test.sql`
- Create: `supabase/tests/0003_invitation_discovery.test.sql`

- [ ] **Step 1: Write failing transition tests**

Cover the exact authority rules:

- any authenticated user completes only their own profile and registers themselves as a coach;
- registration is idempotent;
- only a registered coach creates a group;
- group creation atomically creates owner plus active coach membership;
- any group coach approves member requests and removes ordinary members;
- only owner approves coach requests, removes coaches, changes group settings, archives, or transfers ownership;
- owner cannot leave/remove self until transfer;
- transfer promotes/reactivates the recipient as coach, updates owner, and writes `private.group_ownership_audit` in one transaction;
- duplicate approvals/retries do not duplicate memberships;
- revoked membership immediately removes coach/roster permissions.

Expected: FAIL because transition functions do not exist.

- [ ] **Step 2: Implement profile/coach/group functions**

Implement private checked mutators and public wrappers for profile completion, profile-picture assignment, coach registration, group creation/update/picture/archive, ownership transfer, leaving, and removal. Picture assignment accepts only a path rooted at the caller's profile ID or the owned group ID. Validate timezone overrides as null or trimmed strings no longer than 64 characters; the browser performs IANA validation.

Every function must reject missing auth, validate current authority from the database, update atomically, and return stable statuses such as `created`, `active`, `updated`, `archived`, `transferred`, `left`, `removed`, or `already_complete`.

- [ ] **Step 3: Implement join-request transitions**

`request_group_access` permits access when the group is discoverable or when the optional plaintext discovery token hashes to that group's current active discovery link. The token is checked but never stored on the request. Coach access additionally requires `coach_profiles`. A duplicate active request returns the existing request; a declined/cancelled/expired request may be reopened with a new 30-day expiry. Decision values are only `approved` or `declined`.

Approval must lock the request, re-check authority, upsert/reactivate membership at the approved access level, record decision actor/time, and return the membership ID. Never allow a coach approver to upgrade someone to coach.

- [ ] **Step 4: Implement member/discovery invitation transitions**

Generate 32 random bytes inside Postgres, encode as URL-safe text for the one-time response, and store only `digest(raw_token, 'sha256')`.

- Any active coach can create/revoke a member invitation or rotate/revoke a discovery link.
- An email-bound member invitation compares normalized Auth email before acceptance.
- Acceptance locks the invitation, rejects expired/revoked tokens with stable codes, creates/reactivates a member membership, and marks the invite accepted atomically.
- A retry by the same accepted profile returns `already_accepted`; another profile receives `already_used`.
- Rotation revokes the previous active discovery link before creating another.
- A discovery token reveals the group and enables requesting access; it never creates membership.

- [ ] **Step 5: Verify invitation/request privacy and commit**

```bash
npm run supabase:reset
npm run test:db -- supabase/tests/0002_membership_authorization.test.sql
npm run test:db -- supabase/tests/0003_invitation_discovery.test.sql
git add supabase/migrations/202609110003_foundation_membership_api.sql supabase/tests/0002_membership_authorization.test.sql supabase/tests/0003_invitation_discovery.test.sql
git commit -m "feat(db): add self-managed group membership workflows"
```

---

## Task 6: Implement Group Hierarchy and Non-Cascading Sharing

**Files:**
- Create: `supabase/migrations/202609110004_foundation_hierarchy_api.sql`
- Create: `supabase/tests/0004_hierarchy_authorization.test.sql`

- [ ] **Step 1: Write failing hierarchy tests**

Prove:

- only parent owner invites a child group;
- only child owner accepts/declines;
- activation defaults to `named_progress`;
- each child has at most one active parent;
- local → regional → global chains are valid;
- self-link and direct/indirect cycles fail;
- only child owner changes sharing to/from `full_coaching`;
- either active relationship owner revokes;
- parent coach gets named/full helper result only for the immediate child;
- grandparent coach gets neither named nor full helper result for the descendant;
- the anonymous-rollup helper is true for active immediate and higher ancestor chains without exposing a person or raw row;
- revocation makes both helper results false immediately;
- retrying accept/revoke returns stable current state.

Expected: FAIL because hierarchy functions do not exist.

- [ ] **Step 2: Implement the recursive cycle check**

Use a recursive CTE over active parent→child edges. Adding `parent_group_id -> child_group_id` is rejected when parent equals child or when the proposed child already reaches the proposed parent. Lock the child group and its active relationship rows during acceptance to serialize competing invitations.

- [ ] **Step 3: Implement relationship transitions**

Create checked private mutators and public wrappers for invite, decision, sharing change, and revocation. Invitations expire after 30 days. Acceptance rechecks both owners, active group state, active-parent uniqueness, and cycles in one transaction. Preserve declined/revoked rows as history.

- [ ] **Step 4: Implement immediate-parent sharing helpers**

`has_named_parent_progress` returns true for immediate-parent active coaches at either sharing level. `has_full_parent_coaching` returns true only at `full_coaching`. Neither function recurses. `is_group_ancestor` and `can_roll_up_anonymous_aggregate` may recurse, but neither is used by a raw-row RLS policy in this delivery. The aggregate helper returns true for active ancestor chains regardless of named/full sharing because its future output is anonymous.

- [ ] **Step 5: Test and commit**

```bash
npm run supabase:reset
npm run test:db -- supabase/tests/0004_hierarchy_authorization.test.sql
git add supabase/migrations/202609110004_foundation_hierarchy_api.sql supabase/tests/0004_hierarchy_authorization.test.sql
git commit -m "feat(db): add invitation-based group hierarchy"
```

---

## Task 7: Add Explicit RLS Policies and API Grants

**Files:**
- Create: `supabase/migrations/202609110005_foundation_rls.sql`
- Extend: `supabase/tests/0002_membership_authorization.test.sql`
- Extend: `supabase/tests/0003_invitation_discovery.test.sql`
- Extend: `supabase/tests/0004_hierarchy_authorization.test.sql`

- [ ] **Step 1: Add failing direct-Data-API tests**

Under actual `anon`/`authenticated` roles, prove direct SQL operations mirror Data API behavior:

- anonymous table reads/writes fail;
- authenticated outsiders cannot inspect or mutate unrelated rows;
- users read only their full profile and mutate it only through the checked profile RPCs; they read only their memberships/requests;
- users cannot directly insert coach profiles, groups, memberships, invitations, or relationships;
- active coaches can read group-management rows only for their groups;
- owners receive the stricter coach/relationship capabilities;
- no role can select token hashes;
- leaderboard opt-out never changes direct-coach permission;
- no ancestor role gains raw foundation rows through hierarchy alone.

Expected: FAIL until the exact grants/policies are present.

- [ ] **Step 2: Add least-privilege grants**

Grant base-table operations only where a direct RLS path is intentional. Keep all mutation-only tables unavailable for direct insert/update/delete and expose mutations only through wrappers. Grant `anon` execute solely on group search/discovery projections; grant `authenticated` execute on the checked RPC wrappers needed by the dashboard.

- [ ] **Step 3: Add RLS policies**

Use operation-specific policies; never use `for all`. Keep profile base reads self-only and route profile mutation through checked RPCs. Use projection functions for coach roster and public group discovery. Policies must check active membership and active/non-archived groups on every read.

- [ ] **Step 4: Add a catalog security audit test**

Assert every table in exposed `public` has RLS, no table grants exist for `anon`, no `authenticated` mutation grant bypasses an RPC-only table, all definer functions have empty search paths, and `public` cannot execute any private function.

- [ ] **Step 5: Run the full DB suite and commit**

```bash
npm run supabase:reset
npm run test:db
git add supabase/migrations/202609110005_foundation_rls.sql supabase/tests/0002_membership_authorization.test.sql supabase/tests/0003_invitation_discovery.test.sql supabase/tests/0004_hierarchy_authorization.test.sql
git commit -m "feat(db): enforce foundation RLS and grants"
```

---

## Task 8: Add Private Profile and Group Image Storage

**Files:**
- Create: `supabase/migrations/202609110006_foundation_storage.sql`
- Create: `supabase/tests/0005_storage_authorization.test.sql`

- [ ] **Step 1: Write failing storage-policy tests**

Test object rows for `profile-pictures` and `group-pictures`:

- profile owner writes only under `{auth.uid()}/{object_uuid}.{extension}`;
- unrelated account cannot overwrite/delete;
- group owner writes only under `{group_id}/{object_uuid}.{extension}`;
- non-owner coach/member cannot write group image;
- discoverable group pictures are readable anonymously;
- unlisted group pictures require active group membership or an authorized immediate-parent surface;
- roster-authorized direct coaches can read member profile pictures;
- outsiders cannot read private profile pictures.

Expected: FAIL because buckets/policies do not exist.

- [ ] **Step 2: Create private buckets and path policies**

Insert two non-public buckets idempotently. Restrict MIME types to JPEG, PNG, and WebP and individual file size to 5 MB. Validate the first path segment as the authenticated profile ID or owned group ID. Select policies must mirror corresponding record visibility; update/delete policies require the same owner as insert.

- [ ] **Step 3: Prevent cross-object overwrite**

The browser always generates a fresh UUID filename. Profile/group update functions accept only paths in the caller's authorized prefix. Replacing an image updates the record path; cleanup of the old object is best-effort and may be handled by trusted maintenance without weakening write policy.

- [ ] **Step 4: Test and commit**

```bash
npm run supabase:reset
npm run test:db -- supabase/tests/0005_storage_authorization.test.sql
git add supabase/migrations/202609110006_foundation_storage.sql supabase/tests/0005_storage_authorization.test.sql
git commit -m "feat(db): secure profile and group image storage"
```

---

## Task 9: Build Browser Services and Pure State Logic

**Files:**
- Create: `src/app/config.js`
- Create: `src/app/supabase-client.js`
- Create: `src/app/errors.js`
- Create: `src/app/return-route.js`
- Create: `src/app/auth-service.js`
- Create: `src/app/profile-service.js`
- Create: `src/app/group-service.js`
- Create: `src/app/dashboard-state.js`
- Create: `tests/unit/return-route.test.js`
- Create: `tests/unit/auth-service.test.js`
- Create: `tests/unit/profile-service.test.js`
- Create: `tests/unit/dashboard-state.test.js`

- [ ] **Step 1: Write failing return-route and auth tests**

Test that return routes accept only same-origin relative paths beginning with `/`, reject protocol-relative/external/javascript paths, preserve member/discovery/relationship invitation query parameters, and default to `/dashboard`.

With an injected fake Supabase client, prove Google calls `signInWithOAuth` with provider `google` and `/auth/callback`; email calls `signInWithOtp` with `shouldCreateUser: true`; callback exchanges one code once; sign-out clears private state; and auth errors normalize into validation, expired, authorization, and network categories.

- [ ] **Step 2: Implement config/client/auth modules**

Create one Supabase client with PKCE, persisted sessions, refresh enabled, and automatic URL detection disabled because the callback module owns exchange. Do not request Google offline access or extra scopes. Store the intended safe route before redirect and include it in the callback query for email links that may open in a new tab.

- [ ] **Step 3: Write failing profile/state tests**

Prove browser timezone detection uses `Intl.DateTimeFormat().resolvedOptions().timeZone`, Automatic persists as database null, invalid manual zones are rejected with `Intl.DateTimeFormat(..., {timeZone})`, provider display name/picture only prefill incomplete profiles, and all accounts enter My Training initially.

For `dashboard-state`, prove Coaching is a mode, not a tab; a non-coach gets the registration CTA; coaches retain personal training; last valid mode/group restores; missing/revoked memberships clear the selected group and cached private view.

- [ ] **Step 4: Implement profile/group services and pure reducer**

Keep service methods one-to-one with the RPC/read contracts. Translate database status/error codes without parsing prose. `dashboard-state.js` must be DOM-free and expose state transitions for session loaded/expired, profile loaded, memberships loaded, mode chosen, group chosen, and access revoked.

- [ ] **Step 5: Run tests and commit**

```bash
npm run test:unit -- tests/unit/return-route.test.js tests/unit/auth-service.test.js tests/unit/profile-service.test.js tests/unit/dashboard-state.test.js
git add src/app/config.js src/app/supabase-client.js src/app/errors.js src/app/return-route.js src/app/auth-service.js src/app/profile-service.js src/app/group-service.js src/app/dashboard-state.js tests/unit/return-route.test.js tests/unit/auth-service.test.js tests/unit/profile-service.test.js tests/unit/dashboard-state.test.js
git commit -m "feat: add tested Supabase browser services"
```

---

## Task 10: Add the Unified Google-First Sign-In Experience

**Files:**
- Modify: `index.html`
- Create: `assets/auth.css`
- Create: `auth/callback.html`
- Create: `src/app/ui/auth-dialog.js`
- Create: `src/app/entries/public-auth.js`
- Create: `src/app/entries/auth-callback.js`
- Create: `tests/unit/auth-dialog.test.js`
- Extend: `tests/e2e/auth-dashboard.spec.js`

- [ ] **Step 1: Write failing dialog tests**

Using jsdom and an injected fake auth service, prove:

- the public nav has one entry labeled `Sign in`, never separate Register/Login controls;
- activating it opens an accessible dialog;
- `Continue with Google` is first and visually primary with a `Recommended` label;
- email is secondary and submits only after browser validation;
- duplicate submissions disable actions and show progress;
- signed-in state changes the entry into a dashboard/profile link;
- Escape/close returns focus to the opener.

- [ ] **Step 2: Add dialog markup and styling without disturbing anonymous content**

Insert the sign-in entry beside the language control, a native `<dialog>`, and the generated module script. Put new styles in `assets/auth.css`, reusing the established color/font variables. Add responsive behavior so the existing navigation remains usable at 390px. No auth guard may wrap the movement library.

- [ ] **Step 3: Implement the controllers**

`auth-dialog.js` receives `{authService, document, location}` and owns no global singleton. `public-auth.js` composes it, observes session changes, and routes authenticated entry to `/dashboard`. Google is the default focus. Email success replaces the form with a “check your email” state.

- [ ] **Step 4: Implement callback handling**

`auth/callback.html` includes `referrer=no-referrer`, a small loading/error surface, and only `assets/generated/auth-callback.js`. The controller reads then immediately scrubs `code`/invitation-sensitive query data with `history.replaceState`, exchanges the code, validates the return route, and redirects. Failures offer Sign in again and a safe `/dashboard` link.

- [ ] **Step 5: Add deterministic browser checks**

The E2E test build composes `fake-services.js`; production tree-shaking excludes it. Verify desktop/mobile dialog layout, keyboard focus, Google/email calls, callback success/error routing, and that anonymous move search/cards still work before and after opening the dialog.

- [ ] **Step 6: Verify and commit**

```bash
npm run test:unit -- tests/unit/auth-dialog.test.js
npm run build:test
npm run test:e2e -- tests/e2e/auth-dashboard.spec.js
git add index.html assets/auth.css auth/callback.html src/app/ui/auth-dialog.js src/app/entries/public-auth.js src/app/entries/auth-callback.js src/app/testing/fake-services.js tests/unit/auth-dialog.test.js tests/e2e/auth-dashboard.spec.js
git commit -m "feat: add unified Google-first sign in"
```

---

## Task 11: Add Profile Completion and the Dashboard Mode Shell

**Files:**
- Create: `dashboard.html`
- Create: `assets/dashboard.css`
- Create: `src/app/ui/profile-view.js`
- Create: `src/app/ui/dashboard-view.js`
- Create: `src/app/entries/dashboard.js`
- Extend: `tests/e2e/auth-dashboard.spec.js`

- [ ] **Step 1: Write failing dashboard tests**

Cover:

- unauthenticated access returns to the unified sign-in while retaining the safe destination;
- first sign-in shows display-name confirmation and optional picture;
- timezone shows `Automatic (detected zone)` by default and is not required;
- manual valid timezone saves; invalid timezone does not;
- dashboard starts in My Training;
- the top control is a two-button `aria-pressed` mode group, not `role=tablist`;
- coaches still see My Training and can switch to Coaching;
- non-coaches see `Register as a coach`; accepting extends the same profile;
- sign-out and session expiry clear private DOM/state.

- [ ] **Step 2: Create the semantic dashboard shell**

Add header/profile menu, binary mode switch, group context selector, status region, main content, and dialog hosts. My Training shows foundation-only membership/discovery controls plus an honest “Training history and plans are coming next” empty state. Coaching shows registration or managed-group controls. Do not create fake statistics/cards for data that does not exist.

- [ ] **Step 3: Implement profile and shell controllers**

Prefill from Auth metadata only while `completed_at` is null. Upload optional pictures through the authorized profile prefix and then update `avatar_path`. Save Automatic as null. Registering as coach refreshes capabilities without creating/replacing the auth user.

Restore local keys `roda.dashboard.mode` and `roda.dashboard.group`, but validate them against fresh server results before rendering. On auth/session/membership revocation, remove cached private state and rerender a closed surface.

- [ ] **Step 4: Verify responsive/accessibility behavior**

Use Playwright at desktop and 390px. Check logical tab order, visible focus, labels, live errors, mode state, context selector, profile dialog, and no horizontal overflow.

- [ ] **Step 5: Test and commit**

```bash
npm run test:unit
npm run build:test
npm run test:e2e -- tests/e2e/auth-dashboard.spec.js
git add dashboard.html assets/dashboard.css src/app/ui/profile-view.js src/app/ui/dashboard-view.js src/app/entries/dashboard.js tests/e2e/auth-dashboard.spec.js
git commit -m "feat: add practitioner dashboard foundation"
```

---

## Task 12: Add Group Discovery, Membership, and Management UI

**Files:**
- Create: `src/app/ui/group-view.js`
- Create: `tests/unit/group-view.test.js`
- Create: `tests/e2e/group-flows.spec.js`
- Modify: `dashboard.html`
- Modify: `assets/dashboard.css`
- Modify: `src/app/entries/dashboard.js`

- [ ] **Step 1: Write failing unit tests for permission-dependent rendering**

Prove UI actions from server-provided capabilities:

- all signed-in people can search and request member access;
- only registered coaches can request coach access or create a group;
- coach sees invite/approve/remove-member controls;
- owner additionally sees approve/remove-coach, transfer, archive, parent invite, and relationship settings;
- owner cannot choose Leave until transfer;
- no hidden button is treated as authorization—the service error still renders safely;
- revoked access clears roster/request/invitation content.

- [ ] **Step 2: Implement group discovery and join flows**

Add debounced name/location search with pagination and limited cards. Unlisted discovery opens from `?group_link=TOKEN`, resolves before/after authentication, scrubs the token from the visible URL after capture, and offers member/coach request. Show pending, approved, declined, cancelled, and expired states explicitly.

- [ ] **Step 3: Implement coaching management flows**

Add group creation/settings, context switching, roster, request decisions, member removal, ownership transfer, and archive. Invitation creation accepts an optional normalized email, returns a copyable link, and offers a `mailto:` share action; the app does not need a privileged email-sending backend. Show seven-day expiry and one-time status.

Add discovery-link create/rotate/revoke controls with a warning that the link reveals only the group and never grants membership.

- [ ] **Step 4: Implement hierarchy flows**

Owners can search a target child group, send parent invitation, and view pending/active/history rows. Child owners accept/decline. Active relationships show a single toggle with labels `Named progress` and `Full coaching access`; only the child owner can operate it. Either owner sees revoke. Display that named/full access is immediate-parent only and anonymous aggregate rollup is future work.

- [ ] **Step 5: Add E2E scenarios with fake services**

Test member request/approval, coach request requiring registration and owner approval, member invitation before sign-in then resume, expired/revoked/used invite messages, multi-group context, ownership transfer, unlisted link, parent invitation/acceptance, sharing toggle, cycle/second-parent errors, and access revocation clearing the view.

- [ ] **Step 6: Test and commit**

```bash
npm run test:unit -- tests/unit/group-view.test.js
npm run build:test
npm run test:e2e -- tests/e2e/group-flows.spec.js
git add dashboard.html assets/dashboard.css src/app/ui/group-view.js src/app/entries/dashboard.js tests/unit/group-view.test.js tests/e2e/group-flows.spec.js
git commit -m "feat: add self-service group and hierarchy UI"
```

---

## Task 13: Configure Hosted Auth and Deployment Boundaries

**Files:**
- Modify: `docs/auth-and-database-operations.md`
- Create: `docs/security-checklist.md`
- Modify: `README.md`
- Modify: `docs/README.md`

This task includes external dashboard changes. Enter secrets directly into Google, Supabase, and Vercel; never put them in the repository or chat.

- [ ] **Step 1: Configure exact URL allowlists**

In Supabase Auth URL Configuration, set the production Site URL to the canonical roda.fyi HTTPS origin and allow only:

```text
https://roda.fyi/auth/callback
http://127.0.0.1:8137/auth/callback
```

First verify that `https://roda.fyi` is the canonical production origin. If deployment currently redirects to a different canonical origin, use that single verified origin consistently in Google, Supabase, Vercel, and the operations doc. Do not use a broad wildcard in production.

- [ ] **Step 2: Configure Google as the primary provider**

In Google Auth Platform, create a Web client with the production/local site origins and the exact Supabase callback URI shown by the hosted project's Google provider page. Enable only `openid`, email, and profile. Enter client ID/secret in Supabase Auth. Do not request Google Drive/Calendar or offline refresh access.

- [ ] **Step 3: Configure passwordless email as secondary**

Keep email-link signup enabled. For production, configure an external SMTP provider before public launch and customize the template/branding. Until SMTP is configured, label email as setup/testing-only rather than implying production reliability.

- [ ] **Step 4: Configure Vercel public build values**

Set `RODA_SUPABASE_URL` and `RODA_SUPABASE_PUBLISHABLE_KEY` for Production and the intended Preview environments. Do not add the service-role key or database password to the static build.

- [ ] **Step 5: Verify Supabase GitHub deployment settings**

Confirm repository working directory `.`, production branch `main`, “Deploy to production” enabled only for `main`, and the Supabase migration check required in GitHub branch protection. Preview branching is optional and plan-dependent; it is not assumed available on Free.

- [ ] **Step 6: Write operator docs and commit**

Document local setup, migrations, rollback-by-forward-migration, secret rotation, OAuth smoke testing, SMTP dependency, invitation behavior, and incident response for a leaked public vs privileged key. Link the spec/plan/operations/security docs from both README indexes.

```bash
git add docs/auth-and-database-operations.md docs/security-checklist.md README.md docs/README.md
git commit -m "docs: add auth database and security operations"
```

---

## Task 14: Full Verification and Production Readiness Review

**Files:**
- Modify only files needed to fix failures discovered by verification.

- [ ] **Step 1: Run clean automated verification**

```bash
npm ci
npm run build:test
npm run test:unit
npm run test:e2e
npm run supabase:reset
npm run test:db
git status --short
```

Expected: all commands pass; only intentional source/docs changes are present; generated bundles, reports, local environment, and Supabase temp state are untracked/ignored.

- [ ] **Step 2: Run database security catalog checks against the linked non-production environment**

Use `npx supabase db diff` to prove migrations reproduce the expected schema without drift. Verify exposed tables all have RLS; grants match tests; no definer exists in an exposed schema; every private definer has empty search path; no plaintext invitation/discovery token exists; and no privileged secret appears in functions/config.

- [ ] **Step 3: Scan repository and browser output for secrets**

Search tracked files and built bundles for service-role/database/token/Google-secret patterns. Confirm the only bundled values are the exact public project URL and `sb_publishable_...` key. Inspect the browser network panel to ensure no private credential is returned.

- [ ] **Step 4: Run manual Google and email smoke tests**

On local and production origins:

1. Sign in with a new Google account and complete the profile.
2. Sign out and sign in again through the same button.
3. Request an email link, open it in a new tab, and verify safe return routing.
4. Verify cancel/error/expired-link screens.
5. Confirm no duplicate profile is created when Google/email resolve to the same verified Supabase identity; if provider linking is not configured, document that equal email alone is not used as an authorization merge.

- [ ] **Step 5: Run manual role/hierarchy smoke tests**

Use separate owner, coach, member, immediate-parent coach, and higher-ancestor accounts. Exercise group creation, member and coach approvals, transfer, unlisted discovery, member invite, relationship acceptance, sharing toggle, revocation, and forbidden actions. Confirm revoked access fails on the next read and clears cached private UI.

- [ ] **Step 6: Confirm deferred features are absent**

Inspect migrations/UI for workout/session/feedback/statistic/ranking data models. Only profile preference and permission scaffolding may exist. Empty states must identify those features as future deliveries rather than simulate them.

- [ ] **Step 7: Final commit, review, and integration choice**

```bash
git diff --check
git status --short --branch
git log --oneline --decorate -15
```

If verification required fixes, inspect `git status --short`, stage only the named files involved in those fixes, and commit them with `git commit -m "fix: close foundation verification gaps"`.

Then request code review. Merge/push to `main` only after the user chooses the integration method and the full migration set is safe to deploy.

---

## Acceptance Traceability

| Spec acceptance criterion | Implemented/tested in |
|---|---|
| Unified Google-first + email-link sign-in | Tasks 9–10, 13–14 |
| Public library remains anonymous | Tasks 10 and 14 |
| Universal practitioner + optional coach capability | Tasks 3, 5, 9, 11 |
| Self-service groups with owner/coach/member boundaries | Tasks 5, 7, 12 |
| Searchable/unlisted discovery without data leakage | Tasks 4–5, 7, 12 |
| Resumable person/group invitation flows | Tasks 5–6, 9–10, 12 |
| Multi-level tree, one parent, no cycles | Task 6 and Task 12 |
| Named/full immediate-parent permissions, no cascade | Tasks 4, 6–7, 12 |
| Full RLS/storage actor matrix | Tasks 3–8 and 14 |
| No privileged secret committed or sent to browser | Tasks 1–2, 13–14 |

## Plan Self-Review Checklist

- [x] Every in-scope feature in the approved spec maps to at least one implementation task and one verification step.
- [x] No task creates a later-delivery training/music/recommendation data model.
- [x] Every database transition states its actor, allowed states, expiry, idempotent retry behavior, and test location.
- [x] Every browser service has an injectable boundary and deterministic unit/E2E coverage.
- [x] No code sample or command contains a real secret, unresolved personal path, or destructive production action.
- [x] Search this plan for `TODO`, `TBD`, `placeholder`, and `implement later`; no incomplete instruction remains (references to explicitly out-of-scope future deliveries are intentional).
- [x] File names, RPC names, table fields, modes, status values, and sharing labels are consistent throughout.
