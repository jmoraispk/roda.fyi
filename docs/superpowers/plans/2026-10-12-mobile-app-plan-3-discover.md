# Mobile App Plan 3: Discover v1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Discover v1 in the new app at `/app` — city-level people clusters and discoverable groups on an OpenStreetMap map, search, person and group cards with request to join, Discover settings, group owners' place and contacts, and welcome step 3 — spec increment 6.

**Architecture:** Two migrations add the spec's `place_*`/`contact_*`/`discover_visibility` columns and seven `private` security-definer functions behind `public` SQL wrappers (two writes, five reads), all applying one visibility rule (`private.discover_can_see`). A new `discover` service (real and local fake) and a `geocoder` service (Nominatim in production, fixtures in browser tests) feed the full-screen map (`#/discover`), the person page and group card, the Settings → Discover section, and small pieces plugged into plan 2's group page, Me → Groups, and welcome. Leaflet is bundled by esbuild behind a one-function adapter (`ctx.createMap`), so unit tests inject a fake map and browser tests load a one-pixel tile instead of OpenStreetMap.

**Tech Stack:** Vanilla ES modules + esbuild, Leaflet 1.9.4, Vitest + jsdom, Playwright, Supabase Postgres + pgTAP.

**Spec:** `docs/superpowers/specs/2026-10-11-mobile-first-app-design.md` — sections "Discover v1" (Screen, Settings, Geocoding, Visibility rules), "Data Model" (`profiles` additions, `groups` additions, Functions), "Testing", Acceptance Criterion 8. Model plan for format and helpers: `docs/superpowers/plans/2026-10-11-mobile-app-plan-1-shell-reading-logging.md`.

This is plan 3 of 4. It runs **after plan 2 is merged** (`docs/superpowers/plans/2026-10-12-mobile-app-plan-2-teaching-me-onboarding.md`) and consumes plan 2's `profiles.usage_mode` column (migration `202610120001_usage_mode.sql`, values `train`/`both`/`teach`, default `train`), `public.set_usage_mode(mode text)`, the JS `profile.setUsageMode(mode)`, `welcomeSteps()` in `src/app/screens/welcome.js` (plan 2 Ruling R1), the group page `src/app/screens/group.js` with owner tools in `group-owner.js` (R14), `#/me/groups` in `groups.js`, and Settings with a Profile section (R19). Plan 2 hands this plan the Discover group card for non-members (R14) and the list and cancel of join requests a person sent (R16).

## Global Constraints

- Plan 2 must be merged first: this plan's SQL reads `profiles.usage_mode`, and Tasks 6 and 8–10 extend plan 2's Settings, group page, Me → Groups, and welcome. Where a step names a plan 2 local variable, keep plan 2's actual name.
- Do not modify `tools/`, `assets/figure3d.js`, `assets/moves3d/`, `dashboard.html`, or `/dashboard` behavior. Do not modify `index.html` (the public "Find a class" page is deferred to the locations spec).
- Out of scope (locations spec): teaching addresses, weekly class times, students' training places, precision finer than city, and address deduplication.
- Every new function follows the existing pattern: `private.*` security definer with `set search_path = ''` and fully qualified names, called by `public` `language sql` wrappers that pass `auth.uid()`; revoke from `public, anon, authenticated`, grant to `authenticated`. RLS stays enabled on every table; this plan adds columns only, and clients keep no direct `insert`/`update` grant on `profiles` or `groups`.
- New migrations: `supabase/migrations/2026102000NN_*.sql`; never edit applied migrations. pgTAP files start at `supabase/tests/0030_*`. Apply locally with `npx supabase migration up --local`, never `supabase db reset` (the local database is shared with the main checkout). In DB tests, run `reset role;` before every `tests.set_actor(...)` that switches actors.
- Spec data rules, verbatim: `discover_visibility` null, `everyone`, `signed_in`, or `nobody`; `place_city`/`place_region`/`place_country` ≤ 120 characters; `place_lat` numeric(5,2) −90 to 90, set together with `place_lng`; `place_lng` −180 to 180; `contact_instagram` `^[A-Za-z0-9._]{1,30}$`; `contact_website` starts with `https://`, ≤ 2,048; `contact_whatsapp` `^\+?[0-9 ]{6,20}$`; `contact_email` simple email shape, ≤ 254. Groups get the same `place_*` columns and `contact_instagram`, `contact_website`, `contact_email`; `groups.location` stays as the display label.
- Effective visibility = `discover_visibility` when set, otherwise `everyone` when `usage_mode` is `both` or `teach` and `nobody` when it is `train`. Nobody-visible profiles never appear in map points, cards, or search. Contacts are returned only with a visible card.
- `discover_points` returns at most 500 rows; `discover_search` returns up to 20.
- Coordinates are rounded to two decimals in the browser and again in the database.
- Leaflet `1.9.4` is the only new dependency, pinned exactly, bundled by esbuild; its CSS is built to `assets/generated/leaflet.css`.
- OpenStreetMap usage: OSM attribution ("© OpenStreetMap contributors") is visible on every map; Nominatim requests are user-initiated only, at most one per second, cached per query, never bulk, and the browser sends its origin as `Referer` (`strict-origin-when-cross-origin`). Unit and browser tests never contact `openstreetmap.org`.
- English copy in American spelling; every new `en` key in `src/app/dashboard-i18n.js` has a `pt` key (European Portuguese, matching the existing file).
- Phone first at 390 px; desktop layout from 900 px.
- Follow `docs/security-checklist.md`; Task 11 adds the Discover lines to it.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A city, group, or person name containing markup** (for example a Nominatim result or an owner typing `<img src=x onerror=alert(1)>`) — it shows as literal text in pins, lists, and cards; nothing executes. Pinned in Task 5 (`pinElement`) and Task 7 (panel rows).
2. **Fast panning or zooming** — point responses can return out of order; only the newest view's points are drawn and listed. Pinned in Task 7.
3. **A non-https website stored in the database** (an older client, a direct RPC call, or `javascript:`) — the server refuses it, and a card never renders a link that is not `https:`, `mailto:`, Instagram, or `wa.me`. Pinned in Task 1 (DB) and Task 5 (`contactLinks`).
4. **The map panned across the antimeridian or zoomed out over several world copies** — bounds are normalized before the request, Pacific pins appear on both sides, and the request never fails with `invalid_bounds`. Pinned in Task 2 (DB) and Task 5 (`normalizeBounds`).
5. **Nominatim slow, failing, rate-limiting (429), or Search pressed twice** — one request per distinct query, at least one second apart, a friendly "City search isn't available" message, and the typed text is kept. Pinned in Task 4 and Task 6.

## Rulings

Decisions where the spec is silent or conflicts with the code or a third-party policy. Each is repeated where it applies.

1. **Mode is not a parameter of `update_discover_profile`.** The spec lists "the caller's mode" there; plan 2 owns mode exclusively through `public.set_usage_mode(mode)`, which also creates the coach profile. `update_discover_profile` takes visibility, place, and contacts only.
2. **Anonymous callers get no execute grant yet** (confirmed by the product owner, 2026-10-12). The private functions already implement the anonymous row of the visibility table (a null actor sees only effective `everyone`, finished profiles), and DB tests call them directly with a null actor. The `public` wrappers are granted to `authenticated` only; granting `anon` is a one-line migration when the public "Find a class" page ships (`search_groups` shows the precedent). This avoids exposing contacts to unauthenticated scraping before that page has its own review.
3. **Unfinished profiles (`completed_at is null`) never appear to others**, whatever their visibility. A person always sees themself.
4. **`visibility = null` means "not chosen".** The settings form sends the stored value unless the person picks a radio, so an unchosen visibility keeps following the mode when the mode changes later.
5. **"Signed-in people" means any authenticated caller.**
6. **Two read functions the spec does not list:** `discover_city_people(city, region, country, limit)` (the sheet's list of a city's people; points carry only counts) and `discover_group(group_id)` (the group card; `groups` RLS only lets members read rows; it also returns the caller's status and pending request id so the card can offer Cancel request). Both apply the same visibility rule.
7. **Nominatim city search runs when the person presses Search or Enter, not while typing** (confirmed by the product owner, 2026-10-12). Nominatim's usage policy forbids client-side autocomplete; an explicit submit is "one request per search after the person stops typing" without per-keystroke requests. Requests are additionally throttled to ≥ 1 s and cached per URL, and Search is disabled while a request is in flight.
8. **The Discover search bar queries our database** (people, groups, cities that have visible people), debounced at 300 ms. Its last row, "Find "…" on the map", sends one Nominatim request only when tapped, to pan to a city nobody has claimed yet.
9. **Leaflet 1.9.4 is a `devDependency`, pinned exactly**, alongside `@supabase/supabase-js`: everything is bundled at build time and Vercel's `npm ci` installs dev dependencies. It is bundled statically into `app.js` (no code splitting, which would change every existing bundle). Its CSS is built separately with images inlined as data URLs.
10. **Settings → Discover is a section of the existing Settings page** (`#/me/settings`), not a new route; the spec's Routes table has none.
11. **Photos** (confirmed by the product owner, 2026-10-12): the profile-picture read policy is extended so a person's photo is readable exactly when their Discover card is visible to the caller. Group pictures are already readable for discoverable groups. Cards fall back to initials when there is no photo or signing fails.
12. **Group cards list only coaches the viewer can see** under the Discover rules; a hidden coach is omitted, not anonymized. "Trains in" and "Teaches in" on person cards list only discoverable, unarchived groups.
13. **Only the group owner edits the group's place and contacts** (spec: "owner only"), not other coaches. The form sits in the owner tools of the group page that Me → Groups opens (plan 2's `group-owner.js`). A group that is not discoverable keeps its place but shows no pin; the owner sees a note saying so.
14. **Contact normalization:** a leading `@` is dropped from Instagram handles; a website typed without a scheme gets `https://`; `http://` and other schemes are rejected; WhatsApp drops `-`, `(`, `)`, and `.`. Groups have no WhatsApp contact (spec).
15. **Privacy note placement:** the repo has no privacy-notice page, so the third-party disclosure appears in the app (Discover's panel and the city picker) and as checklist lines in `docs/security-checklist.md`.
16. **Desktop (≥ 900 px):** Discover shows a 340 px list column (search on top, "in view" list below) beside the map. Person and group pages opened from Discover use the right-hand detail pane like the training page; while the pane is open the list column hides so the map keeps its width.
17. **Map zoom is limited to 2–14**: street-level zoom adds nothing when every point is a city centroid.
18. **Join requests I sent** (plan 2 R16): pending, unexpired requests are listed in Me → Groups with Cancel request, and the group card offers Cancel request while pending. Decided or expired requests are not shown.
19. **`#/group/<id>` stays plan 2's page for members, coaches, and owners**; only people outside the group get the Discover card (plan 2 R14). The card therefore has no owner tools; it says "You're in this group." if a member ever reaches it.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `supabase/migrations/202610200001_discover.sql` | Columns, constraints, indexes, visibility helpers, `update_discover_profile`, `update_group_discover` |
| `supabase/migrations/202610200002_discover_read.sql` | `discover_points`, `discover_city_people`, `discover_person`, `discover_group`, `discover_search`, profile-picture read policy |
| `supabase/tests/0030_discover_profile.test.sql` | Writes, constraints, owner-only group updates |
| `supabase/tests/0031_discover_read.test.sql` | Visibility for anonymous, signed-in, self, hidden; limits; antimeridian |
| `src/app/discover-rules.js` | Pure rules shared by UI and fake: visibility, rounding, contacts, places, bounds |
| `src/app/discover-service.js` | Supabase calls for Discover |
| `src/app/geocoder.js` | Nominatim client with throttle and cache; `parsePlace` |
| `src/app/map-tiles.js` | OSM tile URL and attribution; one-pixel tiles for browser tests |
| `src/app/screens/discover-state.js` | Pure screen helpers: bounds, initial view, pins, panel order, contact links |
| `src/app/screens/discover-map.js` | Leaflet adapter behind `ctx.createMap` |
| `src/app/screens/discover-settings.js` | City picker, visibility choice, contact fields, Settings → Discover section |
| `src/app/screens/discover.js` | `#/discover` map, search, in-view panel |
| `src/app/screens/discover-cards.js` | `#/person/<id>` and the Discover group card for non-members |
| `src/app/screens/group-discover-form.js` | Group owners' place and contacts (owner tools on the group page) |
| `src/app/screens/sent-requests.js` | Join requests I sent, with Cancel (Me → Groups) |
| `src/app/screens/welcome-discover.js` | Welcome step 3 |
| `tests/e2e/app-discover.spec.js` | Browser tests at phone and desktop sizes |

Modified: `package.json`, `package-lock.json`, `scripts/build.mjs`, `app.html`, `src/app/sw/cache-policy.js`, `src/app/create-services.js`, `src/app/testing/fake-services.js`, `src/app/entries/app.js`, `src/app/screens/me.js`, `src/app/dashboard-i18n.js`, `assets/app.css`, plan 2's `src/app/screens/welcome.js`, `group.js`, `group-owner.js`, `groups.js` and their tests (`tests/unit/welcome-screen.test.js`, `tests/e2e/app-welcome.spec.js`), `tests/unit/build-config.test.js`, `tests/unit/cache-policy.test.js`, `tests/unit/me-screen.test.js`, `tests/e2e/app-shell.spec.js`, `docs/security-checklist.md`, `README.md`.

---

### Task 1: Discover columns, constraints, and write functions

**Files:**
- Create: `supabase/migrations/202610200001_discover.sql`, `supabase/tests/0030_discover_profile.test.sql`

**Interfaces:**
- Consumes (plan 2): `public.profiles.usage_mode text not null default 'train'`.
- Produces (SQL):
  - `private.discover_effective_visibility(visibility text, mode text) → text`.
  - `private.discover_can_see(actor_id uuid, target_id uuid, visibility text, mode text, completed_at timestamptz) → boolean` — true for self; otherwise false unless `completed_at` is set and the effective visibility is `everyone`, or `signed_in` with a non-null actor.
  - `public.update_discover_profile(visibility text, place_city text, place_region text, place_country text, place_lat numeric, place_lng numeric, contact_instagram text, contact_website text, contact_whatsapp text, contact_email text) → jsonb { status: 'updated', profile_id }`. Full replace; empty strings become null; coordinates rounded to 2 decimals. Errors (`P0001`): `invalid_visibility`, `invalid_place`, `invalid_instagram`, `invalid_website`, `invalid_whatsapp`, `invalid_email`; `PT401 not_authenticated`.
  - `public.update_group_discover(group_id uuid, place_city text, place_region text, place_country text, place_lat numeric, place_lng numeric, contact_instagram text, contact_website text, contact_email text) → jsonb { status: 'updated', group_id }`; `PT403 not_authorized` unless the caller owns the (unarchived) group.

Ruling 1 applies: no mode parameter. Ruling 3 and 5 are encoded in `discover_can_see`. Ruling 13: owner only.

- [ ] **Step 1: Write the failing DB test**

```sql
-- supabase/tests/0030_discover_profile.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_column('public', 'profiles', 'discover_visibility', 'profiles have a Discover visibility');
select has_column('public', 'profiles', 'contact_whatsapp', 'profiles have a WhatsApp contact');
select col_type_is('public', 'profiles', 'place_lat', 'numeric(5,2)', 'latitude keeps two decimals');
select col_type_is('public', 'groups', 'place_lng', 'numeric(5,2)', 'group longitude keeps two decimals');
select has_column('public', 'groups', 'contact_website', 'groups have a website contact');
select hasnt_column('public', 'groups', 'contact_whatsapp', 'groups have no WhatsApp contact');
select has_function('public', 'update_discover_profile',
  array['text', 'text', 'text', 'text', 'numeric', 'numeric', 'text', 'text', 'text', 'text']);
select has_function('public', 'update_group_discover',
  array['uuid', 'text', 'text', 'text', 'numeric', 'numeric', 'text', 'text', 'text']);

select results_eq(
  $$ select private.discover_effective_visibility(choice, mode)
       from (values (null::text, 'train'::text, 1), (null, 'both', 2), (null, 'teach', 3),
                    ('signed_in', 'teach', 4), ('everyone', 'train', 5)) given(choice, mode, position)
      order by position $$,
  $$ values ('nobody'::text), ('everyone'::text), ('everyone'::text), ('signed_in'::text), ('everyone'::text) $$,
  'an unchosen visibility follows the mode; a chosen one wins');
select results_eq(
  $$ select private.discover_can_see(actor, target, choice, 'train', finished)
       from (values
         ('10000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000002'::uuid, 'everyone'::text, now(), 1),
         (null, '10000000-0000-0000-0000-000000000002', 'everyone', now(), 2),
         (null, '10000000-0000-0000-0000-000000000002', 'signed_in', now(), 3),
         ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'signed_in', now(), 4),
         ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', null, now(), 5),
         ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'nobody', null, 6),
         ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'everyone', null, 7)
       ) given(actor, target, choice, finished, position)
      order by position $$,
  $$ values (true), (true), (false), (true), (false), (true), (false) $$,
  'the visibility table: everyone, anonymous, signed in, train default, self, unfinished');

select tests.create_user('10000000-0000-0000-0000-000000003001', 'ana30@example.test', 'Ana Trinta');
select tests.create_user('10000000-0000-0000-0000-000000003002', 'owner30@example.test', 'Mestre Trinta');
select tests.create_user('10000000-0000-0000-0000-000000003003', 'coach30@example.test', 'Coach Trinta');
select tests.create_user('10000000-0000-0000-0000-000000003004', 'bia30@example.test', 'Bia Trinta');
insert into public.coach_profiles (profile_id) values
  ('10000000-0000-0000-0000-000000003002'), ('10000000-0000-0000-0000-000000003003');
insert into public.groups (id, owner_id, name, timezone)
values ('20000000-0000-0000-0000-000000003001', '10000000-0000-0000-0000-000000003002', 'Grupo Trinta', 'Europe/Lisbon');
insert into public.group_memberships (group_id, profile_id, access_level) values
  ('20000000-0000-0000-0000-000000003001', '10000000-0000-0000-0000-000000003002', 'coach'),
  ('20000000-0000-0000-0000-000000003001', '10000000-0000-0000-0000-000000003003', 'coach'),
  ('20000000-0000-0000-0000-000000003001', '10000000-0000-0000-0000-000000003004', 'member');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003001');
select is(public.update_discover_profile('nobody', '  Lisbon ', 'Lisbon', 'Portugal', 38.7169, -9.1399,
  '@ana.silva', 'https://ana.example', '+351 912 345 678', ' ana@example.test ') ->> 'status', 'updated',
  'a person saves their Discover settings');
select results_eq(
  $$ select discover_visibility, place_city, place_lat, place_lng, contact_instagram, contact_email
       from public.profiles where id = '10000000-0000-0000-0000-000000003001' $$,
  $$ values ('nobody'::text, 'Lisbon'::text, 38.72::numeric, -9.14::numeric, 'ana.silva'::text, 'ana@example.test'::text) $$,
  'text is trimmed, coordinates are rounded to two decimals, and @ is dropped');
select public.update_discover_profile(null, null, null, null, null, null, '', null, null, null);
select results_eq(
  $$ select discover_visibility, place_city, place_lat, contact_instagram, contact_website
       from public.profiles where id = '10000000-0000-0000-0000-000000003001' $$,
  $$ values (null::text, null::text, null::numeric, null::text, null::text) $$,
  'saving empty values returns to the mode default and clears place and contacts');
select throws_ok($$ select public.update_discover_profile('friends', null, null, null, null, null, null, null, null, null) $$,
  'P0001', 'invalid_visibility', 'an unknown visibility is refused');
select throws_ok($$ select public.update_discover_profile(null, 'Lisbon', null, null, 38.7, null, null, null, null, null) $$,
  'P0001', 'invalid_place', 'a latitude needs a longitude');
select throws_ok($$ select public.update_discover_profile(null, null, null, null, 38.7, -9.1, null, null, null, null) $$,
  'P0001', 'invalid_place', 'coordinates need a city');
select throws_ok($$ select public.update_discover_profile(null, 'Nowhere', null, null, 91, 0, null, null, null, null) $$,
  'P0001', 'invalid_place', 'latitude stays within -90 to 90');
select throws_ok($$ select public.update_discover_profile(null, 'Nowhere', null, null, 0, 180.5, null, null, null, null) $$,
  'P0001', 'invalid_place', 'longitude stays within -180 to 180');
select throws_ok($$ select public.update_discover_profile(null, repeat('a', 121), null, null, 0, 0, null, null, null, null) $$,
  'P0001', 'invalid_place', 'city names are at most 120 characters');
select throws_ok($$ select public.update_discover_profile(null, null, null, null, null, null, 'ana silva', null, null, null) $$,
  'P0001', 'invalid_instagram', 'Instagram handles have no spaces');
select throws_ok($$ select public.update_discover_profile(null, null, null, null, null, null, null, 'http://ana.example', null, null) $$,
  'P0001', 'invalid_website', 'websites must use https');
select throws_ok($$ select public.update_discover_profile(null, null, null, null, null, null, null, 'javascript:alert(1)', null, null) $$,
  'P0001', 'invalid_website', 'script links are refused');
select throws_ok($$ select public.update_discover_profile(null, null, null, null, null, null, null, null, '12345', null) $$,
  'P0001', 'invalid_whatsapp', 'WhatsApp numbers have at least six digits');
select throws_ok($$ select public.update_discover_profile(null, null, null, null, null, null, null, null, null, 'ana@example') $$,
  'P0001', 'invalid_email', 'emails need a domain with a dot');
select throws_ok(
  $$ update public.profiles set discover_visibility = 'everyone' where id = '10000000-0000-0000-0000-000000003001' $$,
  '42501', null, 'people cannot write Discover columns directly');

reset role;
select throws_ok($$ update public.profiles set contact_website = 'http://x.example' where id = '10000000-0000-0000-0000-000000003001' $$,
  '23514', null, 'the website constraint holds without the function');
select throws_ok($$ update public.profiles set place_lat = 10 where id = '10000000-0000-0000-0000-000000003001' $$,
  '23514', null, 'a latitude alone breaks the place constraints');
select throws_ok($$ update public.profiles set discover_visibility = 'friends' where id = '10000000-0000-0000-0000-000000003001' $$,
  '23514', null, 'the visibility constraint holds without the function');
select throws_ok($$ update public.profiles set contact_instagram = 'has space' where id = '10000000-0000-0000-0000-000000003001' $$,
  '23514', null, 'the Instagram constraint holds without the function');
select throws_ok($$ update public.profiles set contact_whatsapp = 'call me' where id = '10000000-0000-0000-0000-000000003001' $$,
  '23514', null, 'the WhatsApp constraint holds without the function');
select throws_ok($$ update public.profiles set contact_email = 'nobody' where id = '10000000-0000-0000-0000-000000003001' $$,
  '23514', null, 'the email constraint holds without the function');
select throws_ok($$ update public.groups set place_city = 'Far', place_lat = 0, place_lng = 200 where id = '20000000-0000-0000-0000-000000003001' $$,
  '23514', null, 'group longitudes stay within -180 to 180');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003002');
select is(public.update_group_discover('20000000-0000-0000-0000-000000003001', 'Lisbon', 'Lisbon', 'Portugal',
  38.7223, -9.1393, '@grupotrinta', 'https://trinta.example', 'ola@trinta.example') ->> 'status', 'updated',
  'the owner sets the group place and contacts');
select results_eq(
  $$ select place_city, place_lat, place_lng, contact_instagram, location
       from public.groups where id = '20000000-0000-0000-0000-000000003001' $$,
  $$ values ('Lisbon'::text, 38.72::numeric, -9.14::numeric, 'grupotrinta'::text, null::text) $$,
  'the group place is rounded and the location label is untouched');
select throws_ok($$ select public.update_group_discover('20000000-0000-0000-0000-000000003001', null, null, null, null, null, null, 'ftp://x', null) $$,
  'P0001', 'invalid_website', 'group websites must use https');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003003');
select throws_ok($$ select public.update_group_discover('20000000-0000-0000-0000-000000003001', null, null, null, null, null, null, null, null) $$,
  'PT403', 'not_authorized', 'a coach who is not the owner cannot change the group place');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003004');
select throws_ok($$ select public.update_group_discover('20000000-0000-0000-0000-000000003001', null, null, null, null, null, null, null, null) $$,
  'PT403', 'not_authorized', 'a member cannot change the group place');

reset role;
select tests.set_actor(null, 'anon');
select throws_ok($$ select public.update_discover_profile(null, null, null, null, null, null, null, null, null, null) $$,
  '42501', null, 'anonymous callers cannot save Discover settings');
select throws_ok($$ select public.update_group_discover('20000000-0000-0000-0000-000000003001', null, null, null, null, null, null, null, null) $$,
  '42501', null, 'anonymous callers cannot change groups');

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx supabase test db supabase/tests/0030_discover_profile.test.sql`
Expected: FAIL — `has_column` for `discover_visibility` fails and `private.discover_effective_visibility` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/202610200001_discover.sql
-- Discover v1: city-level places, contacts, and visibility. Requires 202610120001_usage_mode.sql.

alter table public.profiles
  add column discover_visibility text,
  add column place_city text,
  add column place_region text,
  add column place_country text,
  add column place_lat numeric(5,2),
  add column place_lng numeric(5,2),
  add column contact_instagram text,
  add column contact_website text,
  add column contact_whatsapp text,
  add column contact_email text;

alter table public.profiles
  add constraint profiles_discover_visibility_check check (
    discover_visibility is null or discover_visibility in ('everyone', 'signed_in', 'nobody')
  ),
  add constraint profiles_place_text_check check (
    (place_city is null or (place_city = btrim(place_city) and char_length(place_city) between 1 and 120))
    and (place_region is null or (place_region = btrim(place_region) and char_length(place_region) between 1 and 120))
    and (place_country is null or (place_country = btrim(place_country) and char_length(place_country) between 1 and 120))
  ),
  add constraint profiles_place_coordinates_check check (
    (place_lat is null) = (place_lng is null)
    and (place_lat is null or place_lat between -90 and 90)
    and (place_lng is null or place_lng between -180 and 180)
  ),
  add constraint profiles_place_complete_check check (
    (place_lat is null and place_city is null and place_region is null and place_country is null)
    or (place_lat is not null and place_city is not null)
  ),
  add constraint profiles_contact_instagram_check check (
    contact_instagram is null or contact_instagram ~ '^[A-Za-z0-9._]{1,30}$'
  ),
  add constraint profiles_contact_website_check check (
    contact_website is null
    or (contact_website ~ '^https://[^[:space:]]+$' and char_length(contact_website) <= 2048)
  ),
  add constraint profiles_contact_whatsapp_check check (
    contact_whatsapp is null or contact_whatsapp ~ '^\+?[0-9 ]{6,20}$'
  ),
  add constraint profiles_contact_email_check check (
    contact_email is null
    or (char_length(contact_email) <= 254
        and contact_email ~ '^[^@[:space:]?#]+@[^@[:space:]?#]+\.[^@[:space:]?#]+$')
  );

alter table public.groups
  add column place_city text,
  add column place_region text,
  add column place_country text,
  add column place_lat numeric(5,2),
  add column place_lng numeric(5,2),
  add column contact_instagram text,
  add column contact_website text,
  add column contact_email text;

alter table public.groups
  add constraint groups_place_text_check check (
    (place_city is null or (place_city = btrim(place_city) and char_length(place_city) between 1 and 120))
    and (place_region is null or (place_region = btrim(place_region) and char_length(place_region) between 1 and 120))
    and (place_country is null or (place_country = btrim(place_country) and char_length(place_country) between 1 and 120))
  ),
  add constraint groups_place_coordinates_check check (
    (place_lat is null) = (place_lng is null)
    and (place_lat is null or place_lat between -90 and 90)
    and (place_lng is null or place_lng between -180 and 180)
  ),
  add constraint groups_place_complete_check check (
    (place_lat is null and place_city is null and place_region is null and place_country is null)
    or (place_lat is not null and place_city is not null)
  ),
  add constraint groups_contact_instagram_check check (
    contact_instagram is null or contact_instagram ~ '^[A-Za-z0-9._]{1,30}$'
  ),
  add constraint groups_contact_website_check check (
    contact_website is null
    or (contact_website ~ '^https://[^[:space:]]+$' and char_length(contact_website) <= 2048)
  ),
  add constraint groups_contact_email_check check (
    contact_email is null
    or (char_length(contact_email) <= 254
        and contact_email ~ '^[^@[:space:]?#]+@[^@[:space:]?#]+\.[^@[:space:]?#]+$')
  );

create index profiles_discover_place_idx on public.profiles (place_lat, place_lng)
  where place_lat is not null;
create index groups_discover_place_idx on public.groups (place_lat, place_lng)
  where place_lat is not null and archived_at is null and is_discoverable;

create function private.discover_effective_visibility(visibility text, mode text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(visibility, case when mode in ('both', 'teach') then 'everyone' else 'nobody' end);
$$;

-- The one visibility rule for points, city lists, cards, search, and photos.
create function private.discover_can_see(
  actor_id uuid, target_id uuid, visibility text, mode text, completed_at timestamptz
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(target_id = actor_id, false)
      or (completed_at is not null and (
            private.discover_effective_visibility(visibility, mode) = 'everyone'
            or (private.discover_effective_visibility(visibility, mode) = 'signed_in' and actor_id is not null)));
$$;

create function private.discover_place(city text, region text, country text, lat numeric, lng numeric)
returns table (place_city text, place_region text, place_country text, place_lat numeric, place_lng numeric)
language plpgsql
immutable
set search_path = ''
as $$
declare
  clean_city text := nullif(btrim(city), '');
  clean_region text := nullif(btrim(region), '');
  clean_country text := nullif(btrim(country), '');
begin
  if clean_city is null and lat is null and lng is null then
    return query select null::text, null::text, null::text, null::numeric, null::numeric;
    return;
  end if;
  if clean_city is null or lat is null or lng is null
     or char_length(clean_city) > 120
     or char_length(coalesce(clean_region, '')) > 120
     or char_length(coalesce(clean_country, '')) > 120
     or lat < -90 or lat > 90 or lng < -180 or lng > 180 then
    raise exception using errcode = 'P0001', message = 'invalid_place';
  end if;
  return query select clean_city, clean_region, clean_country, round(lat, 2), round(lng, 2);
end;
$$;

create function private.discover_contact(contact_kind text, raw_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  clean text := nullif(btrim(raw_value), '');
begin
  if contact_kind = 'instagram' then
    clean := nullif(regexp_replace(coalesce(clean, ''), '^@', ''), '');
  end if;
  if clean is null then
    return null;
  end if;
  if (contact_kind = 'instagram' and clean ~ '^[A-Za-z0-9._]{1,30}$')
     or (contact_kind = 'website' and clean ~ '^https://[^[:space:]]+$' and char_length(clean) <= 2048)
     or (contact_kind = 'whatsapp' and clean ~ '^\+?[0-9 ]{6,20}$')
     or (contact_kind = 'email' and char_length(clean) <= 254
         and clean ~ '^[^@[:space:]?#]+@[^@[:space:]?#]+\.[^@[:space:]?#]+$') then
    return clean;
  end if;
  raise exception using errcode = 'P0001', message = 'invalid_' || contact_kind;
end;
$$;

create function private.update_discover_profile(
  actor_id uuid, new_visibility text,
  new_city text, new_region text, new_country text, new_lat numeric, new_lng numeric,
  new_instagram text, new_website text, new_whatsapp text, new_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  place record;
begin
  if actor_id is null or not exists (select 1 from public.profiles person where person.id = actor_id) then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if new_visibility is not null and new_visibility not in ('everyone', 'signed_in', 'nobody') then
    raise exception using errcode = 'P0001', message = 'invalid_visibility';
  end if;
  select * into place from private.discover_place(new_city, new_region, new_country, new_lat, new_lng);
  update public.profiles person
     set discover_visibility = new_visibility,
         place_city = place.place_city,
         place_region = place.place_region,
         place_country = place.place_country,
         place_lat = place.place_lat,
         place_lng = place.place_lng,
         contact_instagram = private.discover_contact('instagram', new_instagram),
         contact_website = private.discover_contact('website', new_website),
         contact_whatsapp = private.discover_contact('whatsapp', new_whatsapp),
         contact_email = private.discover_contact('email', new_email)
   where person.id = actor_id;
  return jsonb_build_object('status', 'updated', 'profile_id', actor_id);
end;
$$;

create function private.update_group_discover(
  actor_id uuid, target_group_id uuid,
  new_city text, new_region text, new_country text, new_lat numeric, new_lng numeric,
  new_instagram text, new_website text, new_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  place record;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if not private.is_group_owner(target_group_id, actor_id) then
    raise exception using errcode = 'PT403', message = 'not_authorized';
  end if;
  select * into place from private.discover_place(new_city, new_region, new_country, new_lat, new_lng);
  update public.groups target
     set place_city = place.place_city,
         place_region = place.place_region,
         place_country = place.place_country,
         place_lat = place.place_lat,
         place_lng = place.place_lng,
         contact_instagram = private.discover_contact('instagram', new_instagram),
         contact_website = private.discover_contact('website', new_website),
         contact_email = private.discover_contact('email', new_email)
   where target.id = target_group_id;
  return jsonb_build_object('status', 'updated', 'group_id', target_group_id);
end;
$$;

create function public.update_discover_profile(
  visibility text, place_city text, place_region text, place_country text,
  place_lat numeric, place_lng numeric,
  contact_instagram text, contact_website text, contact_whatsapp text, contact_email text
)
returns jsonb language sql set search_path = ''
as $$
  select private.update_discover_profile(auth.uid(), visibility, place_city, place_region, place_country,
    place_lat, place_lng, contact_instagram, contact_website, contact_whatsapp, contact_email);
$$;

create function public.update_group_discover(
  group_id uuid, place_city text, place_region text, place_country text,
  place_lat numeric, place_lng numeric,
  contact_instagram text, contact_website text, contact_email text
)
returns jsonb language sql set search_path = ''
as $$
  select private.update_group_discover(auth.uid(), group_id, place_city, place_region, place_country,
    place_lat, place_lng, contact_instagram, contact_website, contact_email);
$$;

revoke execute on function private.discover_effective_visibility(text, text) from public, anon, authenticated;
revoke execute on function private.discover_can_see(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function private.discover_place(text, text, text, numeric, numeric) from public, anon, authenticated;
revoke execute on function private.discover_contact(text, text) from public, anon, authenticated;
revoke execute on function private.update_discover_profile(uuid, text, text, text, text, numeric, numeric, text, text, text, text)
  from public, anon, authenticated;
revoke execute on function private.update_group_discover(uuid, uuid, text, text, text, numeric, numeric, text, text, text)
  from public, anon, authenticated;
grant execute on function private.update_discover_profile(uuid, text, text, text, text, numeric, numeric, text, text, text, text)
  to authenticated;
grant execute on function private.update_group_discover(uuid, uuid, text, text, text, numeric, numeric, text, text, text)
  to authenticated;
revoke execute on function public.update_discover_profile(text, text, text, text, numeric, numeric, text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.update_group_discover(uuid, text, text, text, numeric, numeric, text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_discover_profile(text, text, text, text, numeric, numeric, text, text, text, text)
  to authenticated;
grant execute on function public.update_group_discover(uuid, text, text, text, numeric, numeric, text, text, text)
  to authenticated;
```

- [ ] **Step 4: Apply and run DB tests**

Run: `npx supabase migration up --local && npm run test:db`
Expected: PASS, including `0030_discover_profile.test.sql`; earlier files unchanged.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202610200001_discover.sql supabase/tests/0030_discover_profile.test.sql
git commit -m "feat: add Discover places, contacts, and visibility

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Discover read functions

**Files:**
- Create: `supabase/migrations/202610200002_discover_read.sql`, `supabase/tests/0031_discover_read.test.sql`

**Interfaces:**
- Consumes: `private.discover_can_see`, `private.discover_effective_visibility`, `private.is_active_group_member`, `private.is_direct_coach_of`, `private.has_named_parent_progress` (foundation).
- Produces (SQL, all `authenticated` only — Ruling 2):
  - `public.discover_points(min_lat numeric, min_lng numeric, max_lat numeric, max_lng numeric) → table (kind text, lat numeric, lng numeric, city text, region text, country text, person_count integer, group_id uuid, name text, location text)`; `kind` is `'city'` (cluster of visible people, `group_id`/`name`/`location` null) or `'group'` (discoverable group with a place, `person_count` null); a box with `min_lng > max_lng` crosses the antimeridian; ≤ 500 rows, biggest clusters first; `P0001 invalid_bounds` for null, inverted-latitude, or out-of-range values.
  - `public.discover_city_people(city text, region text default null, country text default null, result_limit integer default 50) → table (profile_id uuid, display_name text, avatar_path text, usage_mode text)`; the caller first; limit clamped 1–100.
  - `public.discover_person(profile_id uuid) → jsonb | null` `{ profile_id, display_name, avatar_path, usage_mode, city, region, country, lat, lng, is_self, visibility (self only, effective), contacts: { instagram?, website?, whatsapp?, email? }, trains_in: [{ group_id, name }], teaches: [{ group_id, name, role: 'owner'|'coach' }] }`.
  - `public.discover_group(group_id uuid) → jsonb | null` `{ group_id, name, picture_path, location, city, region, country, lat, lng, is_discoverable, contacts: { instagram?, website?, email? }, coaches: [{ profile_id, display_name, is_owner }], my_status: 'owner'|'coach'|'member'|'pending'|null, my_request_id: uuid|null }`; null unless the group is unarchived and discoverable or the caller is an active member.
  - `public.discover_search(search_text text, result_limit integer default 20) → table (kind text, profile_id uuid, group_id uuid, label text, city text, region text, country text, lat numeric, lng numeric, person_count integer)`; kinds `city`/`person`/`group` interleaved (first of each kind, then second…); fewer than 2 characters → no rows; `%` and `_` match literally; ≤ 20 rows.
  - `private.can_read_profile_picture` additionally allows a photo whose Discover card the caller can see (Ruling 11).

Rulings 6, 11, 12 apply.

- [ ] **Step 1: Write the failing DB test**

```sql
-- supabase/tests/0031_discover_read.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_function('public', 'discover_points', array['numeric', 'numeric', 'numeric', 'numeric']);
select has_function('public', 'discover_city_people', array['text', 'text', 'text', 'integer']);
select has_function('public', 'discover_person', array['uuid']);
select has_function('public', 'discover_group', array['uuid']);
select has_function('public', 'discover_search', array['text', 'integer']);

select tests.create_user('10000000-0000-0000-0000-000000003101', 'alice31@example.test', 'Alice Everyone');
select tests.create_user('10000000-0000-0000-0000-000000003102', 'bruno31@example.test', 'Bruno Teach');
select tests.create_user('10000000-0000-0000-0000-000000003103', 'carla31@example.test', 'Carla Signed');
select tests.create_user('10000000-0000-0000-0000-000000003104', 'dora31@example.test', 'Dora Hidden');
select tests.create_user('10000000-0000-0000-0000-000000003105', 'edu31@example.test', 'Edu Nobody');
select tests.create_user('10000000-0000-0000-0000-000000003106', 'fabi31@example.test', 'Fabi Unfinished');
select tests.create_user('10000000-0000-0000-0000-000000003107', 'vera31@example.test', 'Vera Viewer');
insert into public.coach_profiles (profile_id) values
  ('10000000-0000-0000-0000-000000003102'), ('10000000-0000-0000-0000-000000003105');

update public.profiles set completed_at = now(), usage_mode = 'train'
 where id in ('10000000-0000-0000-0000-000000003101', '10000000-0000-0000-0000-000000003102',
              '10000000-0000-0000-0000-000000003103', '10000000-0000-0000-0000-000000003104',
              '10000000-0000-0000-0000-000000003105', '10000000-0000-0000-0000-000000003107');
update public.profiles set usage_mode = 'teach'
 where id in ('10000000-0000-0000-0000-000000003102', '10000000-0000-0000-0000-000000003105');
update public.profiles set usage_mode = 'both', discover_visibility = 'everyone'
 where id = '10000000-0000-0000-0000-000000003106';
update public.profiles set discover_visibility = 'everyone' where id = '10000000-0000-0000-0000-000000003101';
update public.profiles set discover_visibility = 'signed_in', contact_website = 'https://carla.example'
 where id = '10000000-0000-0000-0000-000000003103';
update public.profiles set discover_visibility = 'nobody', contact_instagram = 'edu.secret'
 where id = '10000000-0000-0000-0000-000000003105';
update public.profiles
   set place_city = 'Lisbon', place_region = 'Lisboa', place_country = 'Portugal', place_lat = 38.72, place_lng = -9.14
 where id in ('10000000-0000-0000-0000-000000003101', '10000000-0000-0000-0000-000000003102',
              '10000000-0000-0000-0000-000000003103', '10000000-0000-0000-0000-000000003104',
              '10000000-0000-0000-0000-000000003106');
update public.profiles
   set place_city = 'Porto', place_region = 'Porto', place_country = 'Portugal', place_lat = 41.15, place_lng = -8.61
 where id = '10000000-0000-0000-0000-000000003105';

insert into public.groups (id, owner_id, name, timezone, is_discoverable, location,
                           place_city, place_region, place_country, place_lat, place_lng, contact_instagram)
values
  ('20000000-0000-0000-0000-000000003101', '10000000-0000-0000-0000-000000003102', 'Roda Lisboa', 'Europe/Lisbon', true,
   'Arroios', 'Lisbon', 'Lisboa', 'Portugal', 38.73, -9.13, 'rodalisboa'),
  ('20000000-0000-0000-0000-000000003102', '10000000-0000-0000-0000-000000003105', 'Roda Secreta', 'Europe/Lisbon', false,
   null, 'Porto', 'Porto', 'Portugal', 41.15, -8.61, null),
  ('20000000-0000-0000-0000-000000003103', '10000000-0000-0000-0000-000000003102', 'Roda Suva', 'Pacific/Fiji', true,
   null, 'Suva', 'Central', 'Fiji', -18.14, 178.44, null);
insert into public.group_memberships (group_id, profile_id, access_level) values
  ('20000000-0000-0000-0000-000000003101', '10000000-0000-0000-0000-000000003102', 'coach'),
  ('20000000-0000-0000-0000-000000003101', '10000000-0000-0000-0000-000000003101', 'member'),
  ('20000000-0000-0000-0000-000000003101', '10000000-0000-0000-0000-000000003104', 'member'),
  ('20000000-0000-0000-0000-000000003102', '10000000-0000-0000-0000-000000003105', 'coach'),
  ('20000000-0000-0000-0000-000000003103', '10000000-0000-0000-0000-000000003102', 'coach');

-- A signed-in viewer
reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003107');
select results_eq(
  $$ select kind, city, person_count, lat from public.discover_points(30, -20, 50, 10) where kind = 'city' $$,
  $$ values ('city'::text, 'Lisbon'::text, 3, 38.72::numeric) $$,
  'a signed-in person sees Everyone and Signed-in people, clustered per city at two decimals');
select results_eq(
  $$ select name from public.discover_points(30, -20, 50, 10) where kind = 'group' $$,
  $$ values ('Roda Lisboa'::text) $$,
  'only discoverable groups with a place are pinned');
select results_eq(
  $$ select name from public.discover_points(-30, 170, 0, -170) where kind = 'group' $$,
  $$ values ('Roda Suva'::text) $$,
  'a box across the antimeridian finds pins on its far side');
select throws_ok($$ select * from public.discover_points(50, -20, 30, 10) $$,
  'P0001', 'invalid_bounds', 'an inverted latitude range is refused');
select throws_ok($$ select * from public.discover_points(30, -200, 50, 10) $$,
  'P0001', 'invalid_bounds', 'longitudes stay within -180 to 180');
select results_eq(
  $$ select display_name from public.discover_city_people('Lisbon', 'Lisboa', 'Portugal') $$,
  $$ values ('Alice Everyone'::text), ('Bruno Teach'::text), ('Carla Signed'::text) $$,
  'a city lists only visible, finished profiles');
select is(public.discover_person('10000000-0000-0000-0000-000000003104'), null, 'a Train profile that never chose has no card');
select is(public.discover_person('10000000-0000-0000-0000-000000003105'), null, 'an explicit Nobody coach has no card');
select is(public.discover_person('10000000-0000-0000-0000-000000003106'), null, 'an unfinished profile has no card');
select is(public.discover_person('10000000-0000-0000-0000-000000003103') -> 'contacts' ->> 'website', 'https://carla.example',
  'contacts come with a visible card');
select is(public.discover_person('10000000-0000-0000-0000-000000003101') ->> 'visibility', null,
  'others never see the chosen visibility');
select is(public.discover_person('10000000-0000-0000-0000-000000003101') -> 'trains_in',
  jsonb_build_array(jsonb_build_object('group_id', '20000000-0000-0000-0000-000000003101', 'name', 'Roda Lisboa')),
  'a card lists the discoverable groups the person trains in');
select is(public.discover_person('10000000-0000-0000-0000-000000003102') -> 'teaches',
  jsonb_build_array(
    jsonb_build_object('group_id', '20000000-0000-0000-0000-000000003101', 'name', 'Roda Lisboa', 'role', 'owner'),
    jsonb_build_object('group_id', '20000000-0000-0000-0000-000000003103', 'name', 'Roda Suva', 'role', 'owner')),
  'a card lists the groups the person teaches');
select results_eq(
  $$ select kind, label, person_count from public.discover_search('lisb', 20) $$,
  $$ values ('city'::text, 'Lisbon'::text, 3), ('group'::text, 'Roda Lisboa'::text, null::integer) $$,
  'search finds the city with its visible count and the group');
select is((select count(*)::integer from public.discover_search('dora', 20)), 0, 'hidden people are not searchable');
select is((select count(*)::integer from public.discover_search('edu', 20)), 0, 'explicitly hidden coaches are not searchable');
select is((select count(*)::integer from public.discover_search('secreta', 20)), 0, 'undiscoverable groups are not searchable');
select is((select count(*)::integer from public.discover_search('a', 20)), 0, 'one-letter searches return nothing');
select is((select count(*)::integer from public.discover_search('%%', 20)), 0, 'wildcards match literally');
select is(public.discover_group('20000000-0000-0000-0000-000000003102'), null, 'an undiscoverable group has no card for outsiders');
select is(public.discover_group('20000000-0000-0000-0000-000000003101') -> 'coaches',
  jsonb_build_array(jsonb_build_object('profile_id', '10000000-0000-0000-0000-000000003102',
    'display_name', 'Bruno Teach', 'is_owner', true)),
  'a group card lists its visible coaches');
select is(public.discover_group('20000000-0000-0000-0000-000000003101') -> 'contacts' ->> 'instagram', 'rodalisboa',
  'a group card carries its contacts');
select is(public.discover_group('20000000-0000-0000-0000-000000003101') ->> 'my_status', null, 'an outsider has no status');
select public.request_group_access('20000000-0000-0000-0000-000000003101', 'member', null);
select is(public.discover_group('20000000-0000-0000-0000-000000003101') ->> 'my_status', 'pending',
  'a pending join request shows on the card');
select is((public.discover_group('20000000-0000-0000-0000-000000003101') ->> 'my_request_id')::uuid,
  (select id from public.group_join_requests where profile_id = '10000000-0000-0000-0000-000000003107'),
  'the card carries the pending request id for Cancel request');

-- A hidden person still sees themself
reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003104');
select is((select person_count from public.discover_points(30, -20, 50, 10) where kind = 'city' and city = 'Lisbon'), 4,
  'a hidden person is counted in their own view');
select is(public.discover_person('10000000-0000-0000-0000-000000003104') ->> 'visibility', 'nobody',
  'a person sees their own effective visibility');
select is((public.discover_person('10000000-0000-0000-0000-000000003104') ->> 'is_self')::boolean, true, 'the card knows it is mine');
select is(public.discover_group('20000000-0000-0000-0000-000000003101') ->> 'my_status', 'member', 'members see their status');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000003105');
select isnt(public.discover_group('20000000-0000-0000-0000-000000003102'), null, 'members still open their undiscoverable group');
select is(public.discover_group('20000000-0000-0000-0000-000000003102') ->> 'my_status', 'owner', 'owners see their status');

-- Anonymous rules (no grant yet, so call the private functions as the test owner)
reset role;
select is((select person_count from private.discover_points(null, 30, -20, 50, 10) where kind = 'city'), 2,
  'anonymous viewers would see only Everyone profiles');
select is(private.discover_person(null, '10000000-0000-0000-0000-000000003103'), null,
  'anonymous viewers never see Signed-in profiles');
select isnt(private.discover_person(null, '10000000-0000-0000-0000-000000003102'), null,
  'anonymous viewers would see Everyone profiles');
select tests.set_actor(null, 'anon');
select throws_ok($$ select * from public.discover_points(30, -20, 50, 10) $$, '42501', null, 'anonymous callers cannot read points yet');
select throws_ok($$ select public.discover_person('10000000-0000-0000-0000-000000003102') $$, '42501', null, 'anonymous callers cannot read cards yet');
select throws_ok($$ select * from public.discover_search('lisb', 20) $$, '42501', null, 'anonymous callers cannot search yet');

-- Photos follow card visibility
reset role;
update public.profiles set avatar_path = '10000000-0000-0000-0000-000000003101/11111111-1111-4111-8111-111111111111.jpg'
 where id = '10000000-0000-0000-0000-000000003101';
update public.profiles set avatar_path = '10000000-0000-0000-0000-000000003104/22222222-2222-4222-8222-222222222222.jpg'
 where id = '10000000-0000-0000-0000-000000003104';
select ok(private.can_read_profile_picture('10000000-0000-0000-0000-000000003101/11111111-1111-4111-8111-111111111111.jpg',
  '10000000-0000-0000-0000-000000003107'), 'a visible card''s photo is readable');
select ok(not private.can_read_profile_picture('10000000-0000-0000-0000-000000003104/22222222-2222-4222-8222-222222222222.jpg',
  '10000000-0000-0000-0000-000000003107'), 'a hidden person''s photo stays private');

-- Limits
reset role;
select tests.create_user(('10000000-0000-0000-0000-0000000031' || n)::uuid, 'zeta' || n || '@example.test', 'Zeta ' || n)
  from generate_series(10, 34) n;
update public.profiles set completed_at = now(), usage_mode = 'teach' where display_name like 'Zeta %';
with created as (
  insert into public.groups (owner_id, name, timezone, place_city, place_lat, place_lng)
  select '10000000-0000-0000-0000-000000003102', 'Pin ' || n, 'UTC', 'Pin ' || n, round(-40 + n * 0.1, 2), 100
    from generate_series(1, 501) n
  returning id
)
insert into public.group_memberships (group_id, profile_id, access_level)
select id, '10000000-0000-0000-0000-000000003102', 'coach' from created;
select tests.set_actor('10000000-0000-0000-0000-000000003107');
select is((select count(*)::integer from public.discover_search('zeta', 500)), 20, 'search returns at most 20 rows');
select is((select count(*)::integer from public.discover_points(-90, -180, 90, 180)), 500, 'points return at most 500 rows');

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx supabase test db supabase/tests/0031_discover_read.test.sql`
Expected: FAIL — `has_function('public', 'discover_points', …)` fails.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/202610200002_discover_read.sql
create function private.discover_points(
  actor_id uuid, min_lat numeric, min_lng numeric, max_lat numeric, max_lng numeric
)
returns table (
  kind text, lat numeric, lng numeric, city text, region text, country text,
  person_count integer, group_id uuid, name text, location text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if min_lat is null or min_lng is null or max_lat is null or max_lng is null
     or min_lat > max_lat or min_lat < -90 or max_lat > 90
     or min_lng < -180 or min_lng > 180 or max_lng < -180 or max_lng > 180 then
    raise exception using errcode = 'P0001', message = 'invalid_bounds';
  end if;
  return query
  with visible_people as (
    select person.place_city, person.place_region, person.place_country, person.place_lat, person.place_lng
      from public.profiles person
     where person.place_lat is not null
       and person.place_lat between min_lat and max_lat
       and case when min_lng <= max_lng then person.place_lng between min_lng and max_lng
                else person.place_lng >= min_lng or person.place_lng <= max_lng end
       and private.discover_can_see(actor_id, person.id, person.discover_visibility,
                                    person.usage_mode, person.completed_at)
  ),
  points as (
    select 'city'::text as kind,
           round(avg(visible.place_lat), 2) as lat,
           round(avg(visible.place_lng), 2) as lng,
           visible.place_city as city,
           visible.place_region as region,
           visible.place_country as country,
           count(*)::integer as person_count,
           null::uuid as group_id,
           null::text as name,
           null::text as location
      from visible_people visible
     group by visible.place_city, visible.place_region, visible.place_country
    union all
    select 'group'::text, pinned.place_lat, pinned.place_lng,
           pinned.place_city, pinned.place_region, pinned.place_country,
           null::integer, pinned.id, pinned.name, pinned.location
      from public.groups pinned
     where pinned.archived_at is null
       and pinned.is_discoverable
       and pinned.place_lat is not null
       and pinned.place_lat between min_lat and max_lat
       and case when min_lng <= max_lng then pinned.place_lng between min_lng and max_lng
                else pinned.place_lng >= min_lng or pinned.place_lng <= max_lng end
  )
  select point.kind, point.lat, point.lng, point.city, point.region, point.country,
         point.person_count, point.group_id, point.name, point.location
    from points point
   order by coalesce(point.person_count, 1) desc, point.kind, coalesce(point.city, point.name), point.group_id
   limit 500;
end;
$$;

create function private.discover_city_people(
  actor_id uuid, target_city text, target_region text, target_country text, result_limit integer
)
returns table (profile_id uuid, display_name text, avatar_path text, usage_mode text)
language sql
stable
security definer
set search_path = ''
as $$
  select person.id, person.display_name, person.avatar_path, person.usage_mode
    from public.profiles person
   where person.place_city = target_city
     and person.place_region is not distinct from target_region
     and person.place_country is not distinct from target_country
     and private.discover_can_see(actor_id, person.id, person.discover_visibility,
                                  person.usage_mode, person.completed_at)
   order by person.id = actor_id desc nulls last, person.display_name, person.id
   limit least(greatest(coalesce(result_limit, 50), 1), 100);
$$;

create function private.discover_person(actor_id uuid, target_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'profile_id', person.id,
    'display_name', person.display_name,
    'avatar_path', person.avatar_path,
    'usage_mode', person.usage_mode,
    'city', person.place_city,
    'region', person.place_region,
    'country', person.place_country,
    'lat', person.place_lat,
    'lng', person.place_lng,
    'is_self', coalesce(person.id = actor_id, false),
    'visibility', case when person.id = actor_id
      then private.discover_effective_visibility(person.discover_visibility, person.usage_mode) end,
    'contacts', jsonb_strip_nulls(jsonb_build_object(
      'instagram', person.contact_instagram, 'website', person.contact_website,
      'whatsapp', person.contact_whatsapp, 'email', person.contact_email)),
    'trains_in', coalesce((
      select jsonb_agg(jsonb_build_object('group_id', joined.id, 'name', joined.name) order by joined.name, joined.id)
        from public.group_memberships membership
        join public.groups joined on joined.id = membership.group_id
       where membership.profile_id = person.id and membership.state = 'active'
         and membership.access_level = 'member'
         and joined.archived_at is null and joined.is_discoverable
    ), '[]'::jsonb),
    'teaches', coalesce((
      select jsonb_agg(jsonb_build_object(
               'group_id', taught.id, 'name', taught.name,
               'role', case when taught.owner_id = person.id then 'owner' else 'coach' end)
             order by taught.name, taught.id)
        from public.group_memberships membership
        join public.groups taught on taught.id = membership.group_id
       where membership.profile_id = person.id and membership.state = 'active'
         and membership.access_level = 'coach'
         and taught.archived_at is null and taught.is_discoverable
    ), '[]'::jsonb)
  )
    from public.profiles person
   where person.id = target_profile_id
     and private.discover_can_see(actor_id, person.id, person.discover_visibility,
                                  person.usage_mode, person.completed_at);
$$;

create function private.discover_group(actor_id uuid, target_group_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'group_id', shown.id,
    'name', shown.name,
    'picture_path', shown.picture_path,
    'location', shown.location,
    'city', shown.place_city,
    'region', shown.place_region,
    'country', shown.place_country,
    'lat', shown.place_lat,
    'lng', shown.place_lng,
    'is_discoverable', shown.is_discoverable,
    'contacts', jsonb_strip_nulls(jsonb_build_object(
      'instagram', shown.contact_instagram, 'website', shown.contact_website, 'email', shown.contact_email)),
    'coaches', coalesce((
      select jsonb_agg(jsonb_build_object(
               'profile_id', coach.id, 'display_name', coach.display_name, 'is_owner', coach.id = shown.owner_id)
             order by coach.id = shown.owner_id desc, coach.display_name, coach.id)
        from public.group_memberships membership
        join public.profiles coach on coach.id = membership.profile_id
       where membership.group_id = shown.id and membership.state = 'active'
         and membership.access_level = 'coach'
         and private.discover_can_see(actor_id, coach.id, coach.discover_visibility,
                                      coach.usage_mode, coach.completed_at)
    ), '[]'::jsonb),
    'my_status', case
      when actor_id is null then null
      when shown.owner_id = actor_id then 'owner'
      when exists (
        select 1 from public.group_memberships mine
         where mine.group_id = shown.id and mine.profile_id = actor_id
           and mine.state = 'active' and mine.access_level = 'coach'
      ) then 'coach'
      when exists (
        select 1 from public.group_memberships mine
         where mine.group_id = shown.id and mine.profile_id = actor_id and mine.state = 'active'
      ) then 'member'
      when exists (
        select 1 from public.group_join_requests request
         where request.group_id = shown.id and request.profile_id = actor_id
           and request.state = 'pending' and request.expires_at > now()
      ) then 'pending'
    end,
    'my_request_id', (
      select request.id from public.group_join_requests request
       where request.group_id = shown.id and request.profile_id = actor_id
         and request.state = 'pending' and request.expires_at > now()
       order by request.created_at desc
       limit 1
    )
  )
    from public.groups shown
   where shown.id = target_group_id
     and shown.archived_at is null
     and (shown.is_discoverable or private.is_active_group_member(shown.id, actor_id));
$$;

create function private.discover_search(actor_id uuid, search_text text, result_limit integer)
returns table (
  kind text, profile_id uuid, group_id uuid, label text, city text, region text, country text,
  lat numeric, lng numeric, person_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  needle text := extensions.unaccent(lower(btrim(coalesce(search_text, ''))));
  pattern text;
  cap integer := least(greatest(coalesce(result_limit, 20), 1), 20);
begin
  if char_length(needle) < 2 then
    return;
  end if;
  pattern := '%' || replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
  with visible as (
    select person.*
      from public.profiles person
     where private.discover_can_see(actor_id, person.id, person.discover_visibility,
                                    person.usage_mode, person.completed_at)
  ),
  cities as (
    select 'city'::text as kind, null::uuid as profile_id, null::uuid as group_id,
           visible.place_city as label, visible.place_city as city, visible.place_region as region,
           visible.place_country as country,
           round(avg(visible.place_lat), 2) as lat, round(avg(visible.place_lng), 2) as lng,
           count(*)::integer as person_count,
           row_number() over (order by count(*) desc, visible.place_city) as rank_in_kind,
           0 as kind_order
      from visible
     where visible.place_city is not null
       and extensions.unaccent(lower(visible.place_city)) like pattern
     group by visible.place_city, visible.place_region, visible.place_country
  ),
  people as (
    select 'person'::text, visible.id, null::uuid, visible.display_name, visible.place_city,
           visible.place_region, visible.place_country, visible.place_lat, visible.place_lng,
           null::integer,
           row_number() over (order by visible.display_name, visible.id),
           1
      from visible
     where extensions.unaccent(lower(visible.display_name)) like pattern
  ),
  found_groups as (
    select 'group'::text, null::uuid, found.id, found.name, found.place_city, found.place_region,
           found.place_country, found.place_lat, found.place_lng, null::integer,
           row_number() over (order by found.name, found.id),
           2
      from public.groups found
     where found.archived_at is null
       and found.is_discoverable
       and extensions.unaccent(lower(found.name || ' ' || coalesce(found.location, '') || ' '
                                     || coalesce(found.place_city, ''))) like pattern
  )
  select result.kind, result.profile_id, result.group_id, result.label, result.city, result.region,
         result.country, result.lat, result.lng, result.person_count
    from (select * from cities union all select * from people union all select * from found_groups) result
   order by result.rank_in_kind, result.kind_order
   limit cap;
end;
$$;

-- Ruling 11: a photo is readable exactly when its Discover card is visible.
create or replace function private.can_read_profile_picture(object_name text, actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    actor_id is not null
    and (
      object_name ~ (
        '^' || actor_id::text ||
        '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
      )
      or exists (
        select 1
          from public.profiles profile
         where profile.avatar_path = object_name
           and (
             private.is_direct_coach_of(actor_id, profile.id)
             or exists (
               select 1
                 from public.group_memberships membership
                 join public.groups child_group
                   on child_group.id = membership.group_id
                  and child_group.archived_at is null
                where membership.profile_id = profile.id
                  and membership.state = 'active'
                  and private.has_named_parent_progress(actor_id, child_group.id)
             )
             or private.discover_can_see(actor_id, profile.id, profile.discover_visibility,
                                         profile.usage_mode, profile.completed_at)
           )
      )
    ),
    false
  );
$$;

create function public.discover_points(min_lat numeric, min_lng numeric, max_lat numeric, max_lng numeric)
returns table (
  kind text, lat numeric, lng numeric, city text, region text, country text,
  person_count integer, group_id uuid, name text, location text
)
language sql stable set search_path = ''
as $$ select * from private.discover_points(auth.uid(), min_lat, min_lng, max_lat, max_lng); $$;

create function public.discover_city_people(
  city text, region text default null, country text default null, result_limit integer default 50
)
returns table (profile_id uuid, display_name text, avatar_path text, usage_mode text)
language sql stable set search_path = ''
as $$ select * from private.discover_city_people(auth.uid(), city, region, country, result_limit); $$;

create function public.discover_person(profile_id uuid)
returns jsonb language sql stable set search_path = ''
as $$ select private.discover_person(auth.uid(), profile_id); $$;

create function public.discover_group(group_id uuid)
returns jsonb language sql stable set search_path = ''
as $$ select private.discover_group(auth.uid(), group_id); $$;

create function public.discover_search(search_text text, result_limit integer default 20)
returns table (
  kind text, profile_id uuid, group_id uuid, label text, city text, region text, country text,
  lat numeric, lng numeric, person_count integer
)
language sql stable set search_path = ''
as $$ select * from private.discover_search(auth.uid(), search_text, result_limit); $$;

revoke execute on function private.discover_points(uuid, numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke execute on function private.discover_city_people(uuid, text, text, text, integer) from public, anon, authenticated;
revoke execute on function private.discover_person(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.discover_group(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.discover_search(uuid, text, integer) from public, anon, authenticated;
grant execute on function private.discover_points(uuid, numeric, numeric, numeric, numeric) to authenticated;
grant execute on function private.discover_city_people(uuid, text, text, text, integer) to authenticated;
grant execute on function private.discover_person(uuid, uuid) to authenticated;
grant execute on function private.discover_group(uuid, uuid) to authenticated;
grant execute on function private.discover_search(uuid, text, integer) to authenticated;
revoke execute on function public.discover_points(numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.discover_city_people(text, text, text, integer) from public, anon, authenticated;
revoke execute on function public.discover_person(uuid) from public, anon, authenticated;
revoke execute on function public.discover_group(uuid) from public, anon, authenticated;
revoke execute on function public.discover_search(text, integer) from public, anon, authenticated;
grant execute on function public.discover_points(numeric, numeric, numeric, numeric) to authenticated;
grant execute on function public.discover_city_people(text, text, text, integer) to authenticated;
grant execute on function public.discover_person(uuid) to authenticated;
grant execute on function public.discover_group(uuid) to authenticated;
grant execute on function public.discover_search(text, integer) to authenticated;
```

- [ ] **Step 4: Apply and run DB tests**

Run: `npx supabase migration up --local && npm run test:db`
Expected: PASS, including `0031_discover_read.test.sql`; `0005_storage_authorization.test.sql` still passes (the picture policy only gained a branch).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202610200002_discover_read.sql supabase/tests/0031_discover_read.test.sql
git commit -m "feat: add Discover points, cards, and search

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Shared Discover rules and the Discover service

**Files:**
- Create: `src/app/discover-rules.js`, `src/app/discover-service.js`
- Modify: `src/app/testing/fake-services.js`, `src/app/create-services.js`
- Test: `tests/unit/discover-rules.test.js`, `tests/unit/discover-service.test.js`

**Interfaces:**
- Consumes: SQL from Tasks 1–2; `toAppError`, `AppError` (`src/app/errors.js`); fake helpers `readSession` and the fake group state keys `roda.e2e.groupState` / `roda.e2e.memberships`.
- Produces (`src/app/discover-rules.js`, pure):
  - `VISIBILITIES = ['everyone', 'signed_in', 'nobody']`; `effectiveVisibility({ discover_visibility, usage_mode }) → string`; `canSeePerson(viewerId, person) → boolean` (person has `id, discover_visibility, usage_mode, completed_at`).
  - `roundCoordinate(value) → number|null`; `foldText(value) → string` (lower case, no accents, trimmed).
  - `normalizeContacts({ instagram, website, whatsapp, email }) → { instagram, website, whatsapp, email }` (nulls for empty); `validateContacts(contacts) → { [field]: 'invalid_<field>' }`; `fieldErrors(error) → { [field]: code }` for a server `invalid_<field>` error.
  - `normalizePlace(place) → { city, region, country, lat, lng }|null`; `placeFromRow(row)`; `contactsFromRow(row)`; `placeColumns(place) → { place_city, place_region, place_country, place_lat, place_lng }`; `contactColumns(contacts) → { contact_instagram, contact_website, contact_whatsapp, contact_email }`; `placeLabel({ city, region, country }) → 'Lisbon, Portugal'` (repeated parts dropped).
  - `inBounds(lat, lng, { minLat, minLng, maxLat, maxLng }) → boolean` (antimeridian aware); `cityKey({ city, region, country }) → string`.
- Produces (`createDiscoverService(client)` and `createE2EDiscoverService({ window })`, same methods):
  - `loadMine() → { id, usage_mode, discover_visibility, place_*, contact_* }`
  - `updateMine({ visibility, place, contacts }) → { status, profile_id }`
  - `loadGroup(groupId) → { id, owner_id, name, is_discoverable, place_*, contact_instagram, contact_website, contact_email }`
  - `updateGroup(groupId, { place, contacts }) → { status, group_id }`
  - `points({ minLat, minLng, maxLat, maxLng }) → point[]` (Task 2 row shape)
  - `cityPeople({ city, region, country }, limit = 50) → [{ profile_id, display_name, avatar_path, usage_mode }]`
  - `person(profileId) → card|null`; `group(groupId) → card|null` (Task 2 shapes, including `my_request_id`)
  - `search(text, limit = 20) → row[]` (Task 2 row shape)
  - `pictureUrl(kind: 'profile'|'group', path) → string|null`
- Produces (fake only): `E2E_DISCOVER_PEOPLE`, `E2E_DISCOVER_GROUPS`; localStorage `roda.e2e.discoverPeople` overrides the people list and `roda.e2e.discoverViewer` makes the fake answer as that profile id.
- Produces: `createServices(...)` returns `discover`.

The fake applies the same rules as SQL through `canSeePerson`, so browser tests exercise the visibility table. Default fake people (both e2e and `?demo=1`): Mestre Lua (Teach, unchosen → Everyone, Lisbon), Bia Santos (Train, Signed-in, Lisbon), Caio Lima (Train, unchosen → Nobody, Lisbon), Duda Reis (Both, unchosen → Everyone, Rio de Janeiro); one discoverable group Grupo Lua (Lisbon) and one undiscoverable group Roda Fechada (Porto).

- [ ] **Step 1: Write the failing rules test**

```js
// tests/unit/discover-rules.test.js
import { describe, expect, it } from 'vitest';

import {
  canSeePerson, contactColumns, effectiveVisibility, fieldErrors, foldText, inBounds, normalizeContacts,
  normalizePlace, placeColumns, placeFromRow, placeLabel, roundCoordinate, validateContacts,
} from '../../src/app/discover-rules.js';

describe('discover rules', () => {
  it.each([
    [null, 'train', 'nobody'], [null, 'both', 'everyone'], [null, 'teach', 'everyone'], [null, undefined, 'nobody'],
    ['signed_in', 'teach', 'signed_in'], ['everyone', 'train', 'everyone'],
  ])('visibility %s with mode %s is %s', (visibility, mode, expected) => {
    expect(effectiveVisibility({ discover_visibility: visibility, usage_mode: mode })).toBe(expected);
  });

  it('applies the viewer table', () => {
    const done = '2026-09-01T00:00:00Z';
    const everyone = { id: 'a', discover_visibility: 'everyone', usage_mode: 'train', completed_at: done };
    const signedIn = { id: 'b', discover_visibility: 'signed_in', usage_mode: 'train', completed_at: done };
    const hidden = { id: 'c', discover_visibility: null, usage_mode: 'train', completed_at: done };
    const unfinished = { id: 'd', discover_visibility: 'everyone', usage_mode: 'teach', completed_at: null };
    const people = [everyone, signedIn, hidden, unfinished];
    expect(people.map((person) => canSeePerson('viewer', person))).toEqual([true, true, false, false]);
    expect(people.map((person) => canSeePerson(null, person))).toEqual([true, false, false, false]);
    expect(canSeePerson('c', hidden)).toBe(true);
    expect(canSeePerson('d', unfinished)).toBe(true);
  });

  it('rounds coordinates to two decimals and keeps missing values missing', () => {
    expect(roundCoordinate('38.7169')).toBe(38.72);
    expect(roundCoordinate(-9.1399)).toBe(-9.14);
    expect(roundCoordinate(null)).toBeNull();
    expect(roundCoordinate('')).toBeNull();
    expect(roundCoordinate('north')).toBeNull();
  });

  it('normalizes contacts the way people type them', () => {
    expect(normalizeContacts({
      instagram: ' @ana.silva ', website: 'ana.example/aulas', whatsapp: '+351 912-345-678', email: ' ana@example.com ',
    })).toEqual({
      instagram: 'ana.silva', website: 'https://ana.example/aulas', whatsapp: '+351 912345678', email: 'ana@example.com',
    });
    expect(normalizeContacts({ instagram: '', website: '   ' }))
      .toEqual({ instagram: null, website: null, whatsapp: null, email: null });
  });

  it.each([
    [{ instagram: 'ana silva' }, { instagram: 'invalid_instagram' }],
    [{ instagram: 'a'.repeat(31) }, { instagram: 'invalid_instagram' }],
    [{ website: 'http://ana.example' }, { website: 'invalid_website' }],
    [{ website: 'javascript:alert(1)' }, { website: 'invalid_website' }],
    [{ website: `https://${'a'.repeat(2041)}` }, { website: 'invalid_website' }],
    [{ whatsapp: '12345' }, { whatsapp: 'invalid_whatsapp' }],
    [{ whatsapp: '+351 912 345 678' }, {}],
    [{ email: 'ana@example' }, { email: 'invalid_email' }],
    [{ email: 'ana@example.com' }, {}],
  ])('validates %o', (contacts, errors) => {
    expect(validateContacts(normalizeContacts(contacts))).toEqual(errors);
  });

  it('maps a server rejection to its field', () => {
    expect(fieldErrors({ code: 'invalid_website' })).toEqual({ website: 'invalid_website' });
    expect(fieldErrors({ code: 'invalid_place' })).toEqual({});
    expect(fieldErrors(null)).toEqual({});
  });

  it('keeps only complete, rounded places', () => {
    expect(normalizePlace({ city: ' Lisbon ', region: 'Lisbon', country: 'Portugal', lat: 38.7169, lng: -9.1399 }))
      .toEqual({ city: 'Lisbon', region: 'Lisbon', country: 'Portugal', lat: 38.72, lng: -9.14 });
    expect(normalizePlace(null)).toBeNull();
    expect(normalizePlace({ city: 'Lisbon', lat: null, lng: -9 })).toBeNull();
    expect(normalizePlace({ city: 'Nowhere', lat: 91, lng: 0 })).toBeNull();
    expect(normalizePlace({ city: 'x'.repeat(130), lat: 0, lng: 0 }).city).toHaveLength(120);
  });

  it('converts between rows, columns, and labels', () => {
    const row = { place_city: 'Lisbon', place_region: 'Lisbon', place_country: 'Portugal', place_lat: '38.72', place_lng: '-9.14' };
    const place = placeFromRow(row);
    expect(place).toEqual({ city: 'Lisbon', region: 'Lisbon', country: 'Portugal', lat: 38.72, lng: -9.14 });
    expect(placeColumns(place)).toEqual({ ...row, place_lat: 38.72, place_lng: -9.14 });
    expect(placeColumns(null).place_city).toBeNull();
    expect(placeFromRow({ place_city: null })).toBeNull();
    expect(placeLabel(place)).toBe('Lisbon, Portugal');
    expect(placeLabel({ city: 'Salvador', region: 'Bahia', country: 'Brazil' })).toBe('Salvador, Bahia, Brazil');
    expect(contactColumns({ instagram: 'ana' })).toEqual({
      contact_instagram: 'ana', contact_website: null, contact_whatsapp: null, contact_email: null,
    });
  });

  it('finds points inside a box, including one across the antimeridian', () => {
    const box = { minLat: 30, minLng: -20, maxLat: 50, maxLng: 10 };
    expect(inBounds(38.72, -9.14, box)).toBe(true);
    expect(inBounds(-22.91, -43.17, box)).toBe(false);
    const pacific = { minLat: -30, minLng: 170, maxLat: 0, maxLng: -170 };
    expect(inBounds(-18.14, 178.44, pacific)).toBe(true);
    expect(inBounds(-18.14, -175, pacific)).toBe(true);
    expect(inBounds(-18.14, 0, pacific)).toBe(false);
  });

  it('folds accents and case for search', () => {
    expect(foldText('  Aú São ')).toBe('au sao');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/discover-rules.test.js`
Expected: FAIL — cannot find module `src/app/discover-rules.js`.

- [ ] **Step 3: Implement the rules**

```js
// src/app/discover-rules.js
// Discover rules shared by the screens and the local fake. The database applies the same rules.
export const VISIBILITIES = Object.freeze(['everyone', 'signed_in', 'nobody']);
const CONTACT_FIELDS = Object.freeze(['instagram', 'website', 'whatsapp', 'email']);
const INSTAGRAM = /^[A-Za-z0-9._]{1,30}$/;
const WEBSITE = /^https:\/\/\S+$/;
const WHATSAPP = /^\+?[0-9 ]{6,20}$/;
export const EMAIL = /^[^@\s?#]+@[^@\s?#]+\.[^@\s?#]+$/;

export function effectiveVisibility({ discover_visibility: visibility = null, usage_mode: mode = 'train' } = {}) {
  if (visibility) return visibility;
  return mode === 'both' || mode === 'teach' ? 'everyone' : 'nobody';
}

export function canSeePerson(viewerId, person) {
  if (viewerId && person.id === viewerId) return true;
  if (!person.completed_at) return false;
  const visibility = effectiveVisibility(person);
  return visibility === 'everyone' || (visibility === 'signed_in' && Boolean(viewerId));
}

export function roundCoordinate(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

export function foldText(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase().trim();
}

function trimmed(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

export function normalizeContacts(raw = {}) {
  const instagram = trimmed(raw.instagram)?.replace(/^@/, '') || null;
  let website = trimmed(raw.website);
  if (website && !/^[a-z][a-z0-9+.-]*:/i.test(website)) website = `https://${website}`;
  const whatsapp = trimmed(raw.whatsapp)?.replace(/[-().]/g, '').replace(/\s+/g, ' ') || null;
  return { instagram, website, whatsapp, email: trimmed(raw.email) };
}

export function validateContacts(contacts) {
  const errors = {};
  if (contacts.instagram && !INSTAGRAM.test(contacts.instagram)) errors.instagram = 'invalid_instagram';
  if (contacts.website && (!WEBSITE.test(contacts.website) || contacts.website.length > 2048)) errors.website = 'invalid_website';
  if (contacts.whatsapp && !WHATSAPP.test(contacts.whatsapp)) errors.whatsapp = 'invalid_whatsapp';
  if (contacts.email && (!EMAIL.test(contacts.email) || contacts.email.length > 254)) errors.email = 'invalid_email';
  return errors;
}

export function fieldErrors(error) {
  const field = String(error?.code ?? '').replace(/^invalid_/, '');
  return CONTACT_FIELDS.includes(field) ? { [field]: error.code } : {};
}

export function normalizePlace(place) {
  const city = trimmed(place?.city);
  if (!city) return null;
  const lat = roundCoordinate(place.lat);
  const lng = roundCoordinate(place.lng);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const clip = (value) => trimmed(value)?.slice(0, 120) ?? null;
  return { city: city.slice(0, 120), region: clip(place.region), country: clip(place.country), lat, lng };
}

export function placeFromRow(row) {
  if (!row?.place_city) return null;
  return {
    city: row.place_city, region: row.place_region ?? null, country: row.place_country ?? null,
    lat: Number(row.place_lat), lng: Number(row.place_lng),
  };
}

export function contactsFromRow(row) {
  return {
    instagram: row?.contact_instagram ?? null, website: row?.contact_website ?? null,
    whatsapp: row?.contact_whatsapp ?? null, email: row?.contact_email ?? null,
  };
}

export function placeColumns(place) {
  return {
    place_city: place?.city ?? null, place_region: place?.region ?? null, place_country: place?.country ?? null,
    place_lat: place?.lat ?? null, place_lng: place?.lng ?? null,
  };
}

export function contactColumns(contacts) {
  return {
    contact_instagram: contacts?.instagram ?? null, contact_website: contacts?.website ?? null,
    contact_whatsapp: contacts?.whatsapp ?? null, contact_email: contacts?.email ?? null,
  };
}

export function placeLabel({ city, region, country } = {}) {
  return [city, region, country].filter(Boolean).filter((part, index, all) => all.indexOf(part) === index).join(', ');
}

export function inBounds(lat, lng, { minLat, minLng, maxLat, maxLng }) {
  if (lat < minLat || lat > maxLat) return false;
  return minLng <= maxLng ? lng >= minLng && lng <= maxLng : lng >= minLng || lng <= maxLng;
}

export function cityKey({ city, region = null, country = null }) {
  return JSON.stringify([city, region ?? null, country ?? null]);
}
```

- [ ] **Step 4: Run the rules test**

Run: `npx vitest run tests/unit/discover-rules.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing service and fake tests**

```js
// tests/unit/discover-service.test.js
import { describe, expect, it } from 'vitest';

import { createDiscoverService, GROUP_DISCOVER_COLUMNS, MY_DISCOVER_COLUMNS } from '../../src/app/discover-service.js';
import { createE2EDiscoverService } from '../../src/app/testing/fake-services.js';

function harness({ rows = {}, rpc = {}, signed = { data: { signedUrl: 'https://cdn.example/p.jpg' }, error: null } } = {}) {
  const calls = [];
  return {
    calls,
    client: {
      rpc: async (name, params = {}) => {
        calls.push(['rpc', name, params]);
        return rpc[name] ?? { data: [], error: null };
      },
      from(table) {
        const query = {
          select(columns) { calls.push(['select', table, columns]); return query; },
          eq(column, value) { calls.push(['eq', column, value]); return query; },
          single: async () => rows[table] ?? { data: null, error: null },
        };
        return query;
      },
      storage: {
        from(bucket) {
          return {
            createSignedUrl: async (path, seconds) => {
              calls.push(['sign', bucket, path, seconds]);
              return signed;
            },
          };
        },
      },
    },
  };
}

const LISBON = { city: 'Lisbon', region: 'Lisbon', country: 'Portugal', lat: 38.72, lng: -9.14 };

describe('discover service', () => {
  it('sends settings with column-named parameters', async () => {
    const { client, calls } = harness();
    const service = createDiscoverService(client);
    await service.updateMine({ visibility: null, place: LISBON, contacts: { instagram: 'ana' } });
    await service.updateGroup('g1', { place: null, contacts: { website: 'https://g.example', whatsapp: '+351 900 000 000' } });
    expect(calls).toEqual([
      ['rpc', 'update_discover_profile', {
        visibility: null, place_city: 'Lisbon', place_region: 'Lisbon', place_country: 'Portugal',
        place_lat: 38.72, place_lng: -9.14, contact_instagram: 'ana', contact_website: null,
        contact_whatsapp: null, contact_email: null,
      }],
      ['rpc', 'update_group_discover', {
        group_id: 'g1', place_city: null, place_region: null, place_country: null, place_lat: null, place_lng: null,
        contact_instagram: null, contact_website: 'https://g.example', contact_email: null,
      }],
    ]);
  });

  it('reads points, city lists, cards, and search results', async () => {
    const { client, calls } = harness();
    const service = createDiscoverService(client);
    await service.points({ minLat: 30, minLng: -20, maxLat: 50, maxLng: 10 });
    await service.cityPeople({ ...LISBON, kind: 'city' });
    await service.person('p1');
    await service.group('g1');
    await service.search('  lis ');
    expect(calls).toEqual([
      ['rpc', 'discover_points', { min_lat: 30, min_lng: -20, max_lat: 50, max_lng: 10 }],
      ['rpc', 'discover_city_people', { city: 'Lisbon', region: 'Lisbon', country: 'Portugal', result_limit: 50 }],
      ['rpc', 'discover_person', { profile_id: 'p1' }],
      ['rpc', 'discover_group', { group_id: 'g1' }],
      ['rpc', 'discover_search', { search_text: 'lis', result_limit: 20 }],
    ]);
  });

  it('loads my settings and a group, and maps errors', async () => {
    const { client, calls } = harness({
      rows: { profiles: { data: { id: 'p1', place_city: null }, error: null }, groups: { data: { id: 'g1', owner_id: 'p1' }, error: null } },
      rpc: { update_discover_profile: { data: null, error: { code: 'P0001', message: 'invalid_website' } } },
    });
    const service = createDiscoverService(client);
    await expect(service.loadMine()).resolves.toEqual({ id: 'p1', place_city: null });
    await expect(service.loadGroup('g1')).resolves.toEqual({ id: 'g1', owner_id: 'p1' });
    expect(calls).toEqual([
      ['select', 'profiles', MY_DISCOVER_COLUMNS],
      ['select', 'groups', GROUP_DISCOVER_COLUMNS],
      ['eq', 'id', 'g1'],
    ]);
    await expect(service.updateMine({ contacts: { website: 'http://x' } }))
      .rejects.toMatchObject({ kind: 'validation', code: 'invalid_website' });
  });

  it('signs pictures only when a path exists', async () => {
    const { client, calls } = harness();
    const service = createDiscoverService(client);
    expect(await service.pictureUrl('profile', null)).toBeNull();
    expect(await service.pictureUrl('group', 'g1/x.jpg')).toBe('https://cdn.example/p.jpg');
    expect(calls).toEqual([['sign', 'group-pictures', 'g1/x.jpg', 3600]]);
    const failing = createDiscoverService(harness({ signed: { data: null, error: { message: 'denied' } } }).client);
    expect(await failing.pictureUrl('profile', 'p1/x.jpg')).toBeNull();
  });
});

describe('local Discover fake', () => {
  function fakeWindow(entries = {}) {
    const values = new Map(Object.entries(entries));
    return {
      __RODA_E2E_EVENTS__: [],
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
      },
    };
  }
  const SESSION = JSON.stringify({ user: { id: 'practitioner-1' } });
  const PROFILE = JSON.stringify({ id: 'practitioner-1', display_name: 'Ana Silva', usage_mode: 'train', completed_at: '2026-09-11T20:00:00Z' });
  const EVERYWHERE = { minLat: -90, minLng: -180, maxLat: 90, maxLng: 180 };
  const lisbonCount = async (service) => (await service.points(EVERYWHERE))
    .find((point) => point.kind === 'city' && point.city === 'Lisbon').person_count;

  it('follows the visibility table for clusters, cards, and search', async () => {
    const window = fakeWindow({ 'roda.e2e.session': SESSION, 'roda.e2e.profile': PROFILE });
    const service = createE2EDiscoverService({ window });
    await service.updateMine({ visibility: null, place: LISBON, contacts: {} });
    expect(await lisbonCount(service)).toBe(3);
    expect(await service.person('discover-caio')).toBeNull();
    expect((await service.person('practitioner-1')).visibility).toBe('nobody');
    expect((await service.cityPeople(LISBON))[0].profile_id).toBe('practitioner-1');
    window.localStorage.setItem('roda.e2e.discoverViewer', 'discover-bia');
    expect(await lisbonCount(service)).toBe(2);
    expect(await service.person('practitioner-1')).toBeNull();
    expect(await service.search('ana')).toEqual([]);
    window.localStorage.removeItem('roda.e2e.discoverViewer');
    await service.updateMine({ visibility: 'everyone', place: LISBON, contacts: {} });
    window.localStorage.setItem('roda.e2e.discoverViewer', 'discover-bia');
    expect(await lisbonCount(service)).toBe(3);
    expect((await service.search('ana')).map(({ kind, profile_id: id }) => [kind, id])).toEqual([['person', 'practitioner-1']]);
  });

  it('rejects invalid contacts and lets only owners change their group', async () => {
    const group = { id: 'group-1', owner_id: 'practitioner-1', name: 'Roda da Lua', is_discoverable: true, archived_at: null };
    const other = { id: 'group-2', owner_id: 'someone', name: 'Outra', is_discoverable: true, archived_at: null };
    const window = fakeWindow({
      'roda.e2e.session': SESSION, 'roda.e2e.profile': PROFILE,
      'roda.e2e.groupState': JSON.stringify({ groups: [group, other] }),
    });
    const service = createE2EDiscoverService({ window });
    await expect(service.updateMine({ contacts: { website: 'http://x.example' } }))
      .rejects.toMatchObject({ code: 'invalid_website' });
    await service.updateGroup('group-1', { place: LISBON, contacts: { email: 'ola@lua.example' } });
    expect((await service.loadGroup('group-1')).contact_email).toBe('ola@lua.example');
    expect((await service.points(EVERYWHERE)).some((point) => point.group_id === 'group-1')).toBe(true);
    await expect(service.updateGroup('group-2', { place: LISBON, contacts: {} }))
      .rejects.toMatchObject({ kind: 'authorization' });
  });

  it('reports coaches and join status on group cards', async () => {
    const window = fakeWindow({ 'roda.e2e.session': SESSION, 'roda.e2e.profile': PROFILE });
    const service = createE2EDiscoverService({ window });
    const card = await service.group('discover-group-lua');
    expect(card.my_status).toBeNull();
    expect(card.coaches).toEqual([{ profile_id: 'discover-lua', display_name: 'Mestre Lua', is_owner: true }]);
    window.localStorage.setItem('roda.e2e.groupState', JSON.stringify({
      joinRequests: { 'discover-group-lua': [{ id: 'r1', profile_id: 'practitioner-1', state: 'pending' }] },
    }));
    expect(await service.group('discover-group-lua')).toMatchObject({ my_status: 'pending', my_request_id: 'r1' });
    expect(await service.group('discover-group-hidden')).toBeNull();
  });
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `npx vitest run tests/unit/discover-service.test.js`
Expected: FAIL — cannot find module `src/app/discover-service.js`.

- [ ] **Step 7: Implement the real service**

```js
// src/app/discover-service.js
import { contactColumns, placeColumns } from './discover-rules.js';
import { toAppError } from './errors.js';

export const MY_DISCOVER_COLUMNS = 'id, usage_mode, discover_visibility, place_city, place_region, place_country, place_lat, place_lng, contact_instagram, contact_website, contact_whatsapp, contact_email';
export const GROUP_DISCOVER_COLUMNS = 'id, owner_id, name, is_discoverable, place_city, place_region, place_country, place_lat, place_lng, contact_instagram, contact_website, contact_email';

export function createDiscoverService(client) {
  async function call(name, params = {}) {
    const result = await client.rpc(name, params);
    if (result.error) throw toAppError(result.error);
    return result.data;
  }

  async function read(query) {
    const result = await query;
    if (result.error) throw toAppError(result.error);
    return result.data;
  }

  return {
    loadMine() {
      return read(client.from('profiles').select(MY_DISCOVER_COLUMNS).single());
    },
    updateMine({ visibility = null, place = null, contacts = {} } = {}) {
      return call('update_discover_profile', { visibility, ...placeColumns(place), ...contactColumns(contacts) });
    },
    loadGroup(groupId) {
      return read(client.from('groups').select(GROUP_DISCOVER_COLUMNS).eq('id', groupId).single());
    },
    updateGroup(groupId, { place = null, contacts = {} } = {}) {
      const { contact_whatsapp: _whatsapp, ...groupContacts } = contactColumns(contacts);
      return call('update_group_discover', { group_id: groupId, ...placeColumns(place), ...groupContacts });
    },
    points({ minLat, minLng, maxLat, maxLng }) {
      return call('discover_points', { min_lat: minLat, min_lng: minLng, max_lat: maxLat, max_lng: maxLng });
    },
    cityPeople({ city, region = null, country = null }, limit = 50) {
      return call('discover_city_people', { city, region, country, result_limit: limit });
    },
    person(profileId) {
      return call('discover_person', { profile_id: profileId });
    },
    group(groupId) {
      return call('discover_group', { group_id: groupId });
    },
    search(text, limit = 20) {
      return call('discover_search', { search_text: String(text ?? '').trim(), result_limit: limit });
    },
    async pictureUrl(kind, path) {
      if (!path) return null;
      const bucket = kind === 'group' ? 'group-pictures' : 'profile-pictures';
      const result = await client.storage.from(bucket).createSignedUrl(path, 3600);
      return result.error ? null : result.data?.signedUrl ?? null;
    },
  };
}
```

- [ ] **Step 8: Implement the fake in `src/app/testing/fake-services.js`**

Add to the imports at the top:

```js
import {
  VISIBILITIES, canSeePerson, cityKey, contactColumns, contactsFromRow, effectiveVisibility, foldText, inBounds,
  normalizeContacts, normalizePlace, placeColumns, roundCoordinate, validateContacts,
} from '../discover-rules.js';
```

Append at the end of the file:

```js
const LISBON_PLACE = { place_city: 'Lisbon', place_region: 'Lisbon', place_country: 'Portugal' };
const NO_CONTACTS = { contact_instagram: null, contact_website: null, contact_whatsapp: null, contact_email: null };

export const E2E_DISCOVER_PEOPLE = Object.freeze([
  {
    id: 'discover-lua', display_name: 'Mestre Lua', avatar_path: null, usage_mode: 'teach', discover_visibility: null,
    completed_at: '2026-09-01T00:00:00Z', ...LISBON_PLACE, place_lat: 38.72, place_lng: -9.14,
    ...NO_CONTACTS, contact_instagram: 'mestrelua', contact_website: 'https://lua.example',
    trains_in: [], teaches: [{ group_id: 'discover-group-lua', name: 'Grupo Lua', role: 'owner' }],
  },
  {
    id: 'discover-bia', display_name: 'Bia Santos', avatar_path: null, usage_mode: 'train', discover_visibility: 'signed_in',
    completed_at: '2026-09-01T00:00:00Z', ...LISBON_PLACE, place_lat: 38.72, place_lng: -9.14, ...NO_CONTACTS,
    trains_in: [{ group_id: 'discover-group-lua', name: 'Grupo Lua' }], teaches: [],
  },
  {
    id: 'discover-caio', display_name: 'Caio Lima', avatar_path: null, usage_mode: 'train', discover_visibility: null,
    completed_at: '2026-09-01T00:00:00Z', ...LISBON_PLACE, place_lat: 38.72, place_lng: -9.14, ...NO_CONTACTS,
    trains_in: [], teaches: [],
  },
  {
    id: 'discover-duda', display_name: 'Duda Reis', avatar_path: null, usage_mode: 'both', discover_visibility: null,
    completed_at: '2026-09-01T00:00:00Z', place_city: 'Rio de Janeiro', place_region: 'Rio de Janeiro',
    place_country: 'Brazil', place_lat: -22.91, place_lng: -43.17, ...NO_CONTACTS, trains_in: [], teaches: [],
  },
]);

export const E2E_DISCOVER_GROUPS = Object.freeze([
  {
    id: 'discover-group-lua', owner_id: 'discover-lua', name: 'Grupo Lua', picture_path: null, location: 'Arroios, Lisbon',
    is_discoverable: true, archived_at: null, ...LISBON_PLACE, place_lat: 38.73, place_lng: -9.13,
    contact_instagram: 'grupolua', contact_website: null, contact_email: 'ola@grupolua.example', coaches: ['discover-lua'],
  },
  {
    id: 'discover-group-hidden', owner_id: 'discover-lua', name: 'Roda Fechada', picture_path: null, location: 'Porto',
    is_discoverable: false, archived_at: null, place_city: 'Porto', place_region: 'Porto', place_country: 'Portugal',
    place_lat: 41.15, place_lng: -8.61, contact_instagram: null, contact_website: null, contact_email: null,
    coaches: ['discover-lua'],
  },
]);

function checkedContacts(contacts) {
  const clean = normalizeContacts(contacts);
  const [code] = Object.values(validateContacts(clean));
  if (code) throw new AppError('validation', code);
  return clean;
}

function checkedPlace(place) {
  if (!place) return null;
  const clean = normalizePlace(place);
  if (!clean) throw new AppError('validation', 'invalid_place');
  return clean;
}

function presentContacts(entries) {
  return Object.fromEntries(entries.filter(([, value]) => value));
}

export function createE2EDiscoverService({ window }) {
  const { localStorage: storage } = window;
  const read = (key, fallback) => {
    try {
      return JSON.parse(storage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const record = (event) => window.__RODA_E2E_EVENTS__?.push(event);
  const viewer = () => storage.getItem('roda.e2e.discoverViewer') || readSession(storage)?.user?.id || null;
  const groupState = () => read('roda.e2e.groupState', {});
  const memberships = () => groupState().memberships ?? read('roda.e2e.memberships', []);

  function people() {
    const self = read('roda.e2e.profile', null);
    const mine = memberships().filter((membership) => (
      membership.profile_id === self?.id && membership.state === 'active' && membership.group?.is_discoverable
    ));
    const selfEntry = self && {
      ...self,
      usage_mode: self.usage_mode ?? 'train',
      trains_in: mine.filter(({ access_level: level }) => level === 'member')
        .map(({ group_id: id, group }) => ({ group_id: id, name: group.name })),
      teaches: mine.filter(({ access_level: level }) => level === 'coach')
        .map(({ group_id: id, group }) => ({ group_id: id, name: group.name, role: group.owner_id === self.id ? 'owner' : 'coach' })),
    };
    return [...structuredClone(read('roda.e2e.discoverPeople', E2E_DISCOVER_PEOPLE)), ...(selfEntry ? [selfEntry] : [])];
  }

  function groups() {
    return [...structuredClone(E2E_DISCOVER_GROUPS), ...(groupState().groups ?? [])];
  }

  const visiblePeople = () => people().filter((person) => canSeePerson(viewer(), person));

  return {
    async loadMine() {
      const profile = read('roda.e2e.profile', {});
      return {
        id: profile.id, usage_mode: profile.usage_mode ?? 'train', discover_visibility: profile.discover_visibility ?? null,
        ...placeColumns(null), ...contactColumns(null),
        ...Object.fromEntries(Object.entries(profile).filter(([key]) => key.startsWith('place_') || key.startsWith('contact_'))),
      };
    },

    async updateMine({ visibility = null, place = null, contacts = {} } = {}) {
      if (visibility !== null && !VISIBILITIES.includes(visibility)) throw new AppError('validation', 'invalid_visibility');
      const cleanPlace = checkedPlace(place);
      const cleanContacts = checkedContacts(contacts);
      const profile = {
        ...read('roda.e2e.profile', {}), discover_visibility: visibility,
        ...placeColumns(cleanPlace), ...contactColumns(cleanContacts),
      };
      storage.setItem('roda.e2e.profile', JSON.stringify(profile));
      record({ type: 'discover-update', visibility, place: cleanPlace, contacts: cleanContacts });
      return { status: 'updated', profile_id: profile.id };
    },

    async loadGroup(groupId) {
      const group = groups().find(({ id }) => id === groupId);
      if (!group) throw new AppError('authorization', 'not_authorized');
      return { ...placeColumns(null), contact_instagram: null, contact_website: null, contact_email: null, ...group };
    },

    async updateGroup(groupId, { place = null, contacts = {} } = {}) {
      const state = groupState();
      const group = (state.groups ?? []).find(({ id }) => id === groupId);
      if (!group || group.owner_id !== viewer()) throw new AppError('authorization', 'not_authorized');
      const cleanPlace = checkedPlace(place);
      const { contact_whatsapp: _whatsapp, ...cleanContacts } = contactColumns(checkedContacts({ ...contacts, whatsapp: null }));
      const values = { ...placeColumns(cleanPlace), ...cleanContacts };
      Object.assign(group, values);
      for (const membership of state.memberships ?? []) {
        if (membership.group_id === groupId && membership.group) Object.assign(membership.group, values);
      }
      storage.setItem('roda.e2e.groupState', JSON.stringify(state));
      record({ type: 'group-discover-update', groupId, ...values });
      return { status: 'updated', group_id: groupId };
    },

    async points(bounds) {
      const clusters = new Map();
      for (const person of visiblePeople()) {
        if (person.place_lat == null || !inBounds(Number(person.place_lat), Number(person.place_lng), bounds)) continue;
        const place = { city: person.place_city, region: person.place_region ?? null, country: person.place_country ?? null };
        const entry = clusters.get(cityKey(place)) ?? {
          kind: 'city', ...place, lat: 0, lng: 0, person_count: 0, group_id: null, name: null, location: null,
        };
        entry.lat += Number(person.place_lat);
        entry.lng += Number(person.place_lng);
        entry.person_count += 1;
        clusters.set(cityKey(place), entry);
      }
      const cities = [...clusters.values()].map((entry) => ({
        ...entry, lat: roundCoordinate(entry.lat / entry.person_count), lng: roundCoordinate(entry.lng / entry.person_count),
      }));
      const pins = groups()
        .filter((group) => group.is_discoverable && !group.archived_at && group.place_lat != null
          && inBounds(Number(group.place_lat), Number(group.place_lng), bounds))
        .map((group) => ({
          kind: 'group', lat: group.place_lat, lng: group.place_lng, city: group.place_city,
          region: group.place_region ?? null, country: group.place_country ?? null, person_count: null,
          group_id: group.id, name: group.name, location: group.location ?? null,
        }));
      return [...cities, ...pins].sort((a, b) => (b.person_count ?? 1) - (a.person_count ?? 1)).slice(0, 500);
    },

    async cityPeople({ city, region = null, country = null }) {
      const me = viewer();
      return visiblePeople()
        .filter((person) => person.place_city === city && (person.place_region ?? null) === region
          && (person.place_country ?? null) === country)
        .sort((a, b) => Number(b.id === me) - Number(a.id === me) || a.display_name.localeCompare(b.display_name))
        .map((person) => ({
          profile_id: person.id, display_name: person.display_name, avatar_path: person.avatar_path ?? null,
          usage_mode: person.usage_mode ?? 'train',
        }));
    },

    async person(profileId) {
      const person = visiblePeople().find(({ id }) => id === profileId);
      if (!person) return null;
      const isSelf = person.id === viewer();
      const contacts = contactsFromRow(person);
      return {
        profile_id: person.id, display_name: person.display_name, avatar_path: person.avatar_path ?? null,
        usage_mode: person.usage_mode ?? 'train', city: person.place_city ?? null, region: person.place_region ?? null,
        country: person.place_country ?? null, lat: person.place_lat ?? null, lng: person.place_lng ?? null,
        is_self: isSelf, visibility: isSelf ? effectiveVisibility(person) : null,
        contacts: presentContacts(Object.entries(contacts)),
        trains_in: person.trains_in ?? [], teaches: person.teaches ?? [],
      };
    },

    async group(groupId) {
      const me = viewer();
      const state = groupState();
      const group = groups().find(({ id }) => id === groupId);
      const membership = memberships().find((entry) => (
        entry.group_id === groupId && entry.profile_id === me && entry.state === 'active'
      ));
      if (!group || group.archived_at || (!group.is_discoverable && !membership)) return null;
      const visible = visiblePeople();
      const coachIds = group.coaches ?? (state.rosters?.[groupId] ?? [])
        .filter(({ access_level: level }) => level === 'coach').map(({ profile_id: id }) => id);
      const pending = (state.joinRequests?.[groupId] ?? [])
        .find((request) => request.profile_id === me && request.state === 'pending');
      return {
        group_id: group.id, name: group.name, picture_path: group.picture_path ?? null, location: group.location ?? null,
        city: group.place_city ?? null, region: group.place_region ?? null, country: group.place_country ?? null,
        lat: group.place_lat ?? null, lng: group.place_lng ?? null, is_discoverable: group.is_discoverable,
        contacts: presentContacts([
          ['instagram', group.contact_instagram], ['website', group.contact_website], ['email', group.contact_email],
        ]),
        coaches: coachIds.map((id) => visible.find((person) => person.id === id)).filter(Boolean)
          .map((person) => ({ profile_id: person.id, display_name: person.display_name, is_owner: person.id === group.owner_id })),
        my_status: group.owner_id === me ? 'owner'
          : membership ? (membership.access_level === 'coach' ? 'coach' : 'member')
            : pending ? 'pending' : null,
        my_request_id: pending?.id ?? null,
      };
    },

    async search(text, limit = 20) {
      const needle = foldText(text);
      if (needle.length < 2) return [];
      const cap = Math.min(Math.max(limit, 1), 20);
      const visible = visiblePeople();
      const cities = new Map();
      for (const person of visible) {
        if (!person.place_city || !foldText(person.place_city).includes(needle)) continue;
        const place = { city: person.place_city, region: person.place_region ?? null, country: person.place_country ?? null };
        const entry = cities.get(cityKey(place)) ?? {
          kind: 'city', profile_id: null, group_id: null, label: place.city, ...place,
          lat: Number(person.place_lat), lng: Number(person.place_lng), person_count: 0,
        };
        entry.person_count += 1;
        cities.set(cityKey(place), entry);
      }
      const lists = [
        [...cities.values()].sort((a, b) => b.person_count - a.person_count || a.label.localeCompare(b.label)),
        visible.filter((person) => foldText(person.display_name).includes(needle))
          .sort((a, b) => a.display_name.localeCompare(b.display_name))
          .map((person) => ({
            kind: 'person', profile_id: person.id, group_id: null, label: person.display_name,
            city: person.place_city ?? null, region: person.place_region ?? null, country: person.place_country ?? null,
            lat: person.place_lat ?? null, lng: person.place_lng ?? null, person_count: null,
          })),
        groups().filter((group) => group.is_discoverable && !group.archived_at
          && foldText(`${group.name} ${group.location ?? ''} ${group.place_city ?? ''}`).includes(needle))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((group) => ({
            kind: 'group', profile_id: null, group_id: group.id, label: group.name,
            city: group.place_city ?? null, region: group.place_region ?? null, country: group.place_country ?? null,
            lat: group.place_lat ?? null, lng: group.place_lng ?? null, person_count: null,
          })),
      ];
      const rows = [];
      for (let index = 0; rows.length < cap && lists.some((list) => index < list.length); index += 1) {
        for (const list of lists) if (index < list.length && rows.length < cap) rows.push(list[index]);
      }
      return rows;
    },

    async pictureUrl() {
      return null;
    },
  };
}
```

- [ ] **Step 9: Wire the service in `src/app/create-services.js`**

Add the imports and a `discover` entry to both branches:

```js
import { createDiscoverService } from './discover-service.js';
```

```js
import {
  createE2EAuthService, createE2ECatalogService, createE2EConnectionService, createE2EDiscoverService,
  createE2EGroupService, createE2EProfileService, createE2ERepertoireService, createE2EStatisticsService,
  createE2ETrainingService,
} from './testing/fake-services.js';
```

In the `localMode` object add `discover: createE2EDiscoverService({ window }),`; in the real object add `discover: createDiscoverService(client),`.

- [ ] **Step 10: Run tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/app/discover-rules.js src/app/discover-service.js src/app/testing/fake-services.js src/app/create-services.js tests/unit/discover-rules.test.js tests/unit/discover-service.test.js
git commit -m "feat: add the Discover service and shared visibility rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Nominatim geocoder

**Files:**
- Create: `src/app/geocoder.js`
- Modify: `src/app/testing/fake-services.js`, `src/app/create-services.js`, `src/app/entries/app.js`
- Test: `tests/unit/geocoder.test.js`

**Interfaces:**
- Consumes: `roundCoordinate`, `cityKey`, `foldText` (Task 3); `AppError`.
- Produces:
  - `NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org'`.
  - `parsePlace(item) → { city, region, country, lat, lng }|null` — city from `address.city ?? town ?? village ?? municipality ?? hamlet ?? name`; region from `state ?? region ?? province ?? county`; each ≤ 120 characters; coordinates rounded.
  - `createNominatimGeocoder({ fetch, language = () => 'en', now = Date.now, wait, endpoint }) → { searchCities(query) → place[], reverse({ lat, lng }) → place|null }`. One shared queue; requests at least 1,000 ms apart; results cached per URL (in-flight requests shared); failures throw `AppError('network', 'geocoder_unavailable', …, { retryable: true })` and are not cached; queries shorter than 2 characters send nothing; reverse sends coordinates rounded to 2 decimals at `zoom=10` (city level).
  - Fake: `createE2EGeocoder({ window })` with `E2E_CITIES` (Lisbon, Rio de Janeiro, Salvador); records `{ type: 'geocode-search', query }` and `{ type: 'geocode-reverse', lat, lng }` events; `localStorage['roda.e2e.failGeocoder'] = 'true'` makes it throw `geocoder_unavailable`.
  - `createServices({ window, localMode, e2e = false, language = () => 'en' })` returns `geocoder` — the fake whenever `e2e` is true (even in demo mode), Nominatim otherwise.

Ruling 7: the client never searches per keystroke; this module enforces spacing and caching even if a caller misbehaves.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/geocoder.test.js
import { describe, expect, it, vi } from 'vitest';

import { createNominatimGeocoder, parsePlace } from '../../src/app/geocoder.js';

const LISBOA = {
  lat: '38.7077507', lon: '-9.1365919', name: 'Lisboa',
  address: { city: 'Lisboa', state: 'Lisboa', country: 'Portugal' },
};

function setup(responses = [[LISBOA]]) {
  let clock = 0;
  const fetch = vi.fn(async () => {
    const body = responses.length > 1 ? responses.shift() : responses[0];
    if (body instanceof Error) throw body;
    if (body?.status) return { ok: false, status: body.status, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  });
  const wait = vi.fn(async (ms) => { clock += ms; });
  const geocoder = createNominatimGeocoder({ fetch, now: () => clock, wait, language: () => 'pt' });
  return { geocoder, fetch, wait, tick: (ms) => { clock += ms; } };
}

describe('nominatim geocoder', () => {
  it('asks for city-level places with policy-friendly parameters', async () => {
    const { geocoder, fetch } = setup();
    await expect(geocoder.searchCities('  Lisboa ')).resolves.toEqual([
      { city: 'Lisboa', region: 'Lisboa', country: 'Portugal', lat: 38.71, lng: -9.14 },
    ]);
    const [url, options] = fetch.mock.calls[0];
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://nominatim.openstreetmap.org/search');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      q: 'Lisboa', format: 'jsonv2', addressdetails: '1', limit: '5', featureType: 'city', 'accept-language': 'pt',
    });
    expect(options).toEqual({ credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin' });
  });

  it('sends one request per distinct search, even when pressed twice', async () => {
    const { geocoder, fetch } = setup();
    await Promise.all([geocoder.searchCities('Lisboa'), geocoder.searchCities('Lisboa')]);
    await geocoder.searchCities('Lisboa');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('spaces requests at least one second apart', async () => {
    const { geocoder, fetch, wait, tick } = setup();
    await geocoder.searchCities('Lisboa');
    tick(200);
    await geocoder.searchCities('Porto');
    expect(wait).toHaveBeenCalledWith(800);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('never sends one-letter searches', async () => {
    const { geocoder, fetch } = setup();
    await expect(geocoder.searchCities(' L ')).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([[{ status: 429 }], [new TypeError('Failed to fetch')]])('turns %o into a retryable error and retries later', async (failure) => {
    const { geocoder, fetch } = setup([failure, [LISBOA]]);
    await expect(geocoder.searchCities('Lisboa')).rejects.toMatchObject({ code: 'geocoder_unavailable', retryable: true });
    await expect(geocoder.searchCities('Lisboa')).resolves.toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reverse-geocodes a rounded tap at city zoom', async () => {
    const { geocoder, fetch } = setup([LISBOA]);
    await expect(geocoder.reverse({ lat: 38.712345, lng: -9.139876 })).resolves.toMatchObject({ city: 'Lisboa' });
    const params = new URL(fetch.mock.calls[0][0]).searchParams;
    expect([params.get('lat'), params.get('lon'), params.get('zoom')]).toEqual(['38.71', '-9.14', '10']);
  });

  it('returns null when reverse finds nothing', async () => {
    const { geocoder } = setup([{ error: 'Unable to geocode' }]);
    await expect(geocoder.reverse({ lat: 0, lng: 0 })).resolves.toBeNull();
  });

  it('drops duplicate cities', async () => {
    const { geocoder } = setup([[LISBOA, { ...LISBOA, lat: '38.71' }]]);
    await expect(geocoder.searchCities('Lisboa')).resolves.toHaveLength(1);
  });

  it('parses towns and villages and drops unusable rows', () => {
    expect(parsePlace({ lat: '1', lon: '2', address: { town: 'Ilhéus', state: 'Bahia', country: 'Brasil' } }))
      .toEqual({ city: 'Ilhéus', region: 'Bahia', country: 'Brasil', lat: 1, lng: 2 });
    expect(parsePlace({ lat: '1', lon: '2', address: {} })).toBeNull();
    expect(parsePlace({ name: 'Somewhere', address: {} })).toBeNull();
    expect(parsePlace({ lat: '1', lon: '2', name: 'y'.repeat(200), address: {} }).city).toHaveLength(120);
    expect(parsePlace(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/geocoder.test.js`
Expected: FAIL — cannot find module `src/app/geocoder.js`.

- [ ] **Step 3: Implement**

```js
// src/app/geocoder.js
// City search against OpenStreetMap Nominatim, following its usage policy:
// user-initiated requests only, at most one per second, cached, never bulk.
// The browser sends this site's origin as Referer, which identifies the app.
import { cityKey, roundCoordinate } from './discover-rules.js';
import { AppError } from './errors.js';

export const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org';
const MIN_INTERVAL_MS = 1000;

function clip(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, 120) : null;
}

export function parsePlace(item) {
  if (!item || typeof item !== 'object') return null;
  const address = item.address ?? {};
  const city = clip(address.city ?? address.town ?? address.village ?? address.municipality ?? address.hamlet ?? item.name);
  const lat = roundCoordinate(item.lat);
  const lng = roundCoordinate(item.lon);
  if (!city || lat === null || lng === null) return null;
  return {
    city,
    region: clip(address.state ?? address.region ?? address.province ?? address.county),
    country: clip(address.country),
    lat,
    lng,
  };
}

function unavailable(cause) {
  return new AppError('network', 'geocoder_unavailable', 'City search is not available right now.', { retryable: true, cause });
}

export function createNominatimGeocoder({
  fetch,
  language = () => 'en',
  now = () => Date.now(),
  wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
  endpoint = NOMINATIM_ENDPOINT,
} = {}) {
  const cache = new Map();
  let nextAllowedAt = 0;
  let queue = Promise.resolve();

  function request(path, params) {
    const url = new URL(path, endpoint);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const key = url.href;
    if (cache.has(key)) return cache.get(key);
    const pending = queue.then(async () => {
      const delay = nextAllowedAt - now();
      if (delay > 0) await wait(delay);
      nextAllowedAt = now() + MIN_INTERVAL_MS;
      let response;
      try {
        response = await fetch(key, { credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin' });
      } catch (error) {
        throw unavailable(error);
      }
      if (!response.ok) throw unavailable();
      return response.json();
    });
    queue = pending.catch(() => {});
    cache.set(key, pending);
    pending.catch(() => cache.delete(key));
    return pending;
  }

  return {
    async searchCities(query) {
      const text = String(query ?? '').trim();
      if (text.length < 2) return [];
      const rows = await request('/search', {
        q: text, format: 'jsonv2', addressdetails: '1', limit: '5', featureType: 'city', 'accept-language': language(),
      });
      const seen = new Set();
      return (Array.isArray(rows) ? rows : []).map(parsePlace).filter((place) => {
        if (!place || seen.has(cityKey(place))) return false;
        seen.add(cityKey(place));
        return true;
      });
    },
    async reverse({ lat, lng }) {
      const row = await request('/reverse', {
        lat: String(roundCoordinate(lat)), lon: String(roundCoordinate(lng)),
        format: 'jsonv2', zoom: '10', addressdetails: '1', 'accept-language': language(),
      });
      return row?.error ? null : parsePlace(row);
    },
  };
}
```

- [ ] **Step 4: Add the fake geocoder to `src/app/testing/fake-services.js`**

Append:

```js
export const E2E_CITIES = Object.freeze([
  { city: 'Lisbon', region: 'Lisbon', country: 'Portugal', lat: 38.72, lng: -9.14 },
  { city: 'Rio de Janeiro', region: 'Rio de Janeiro', country: 'Brazil', lat: -22.91, lng: -43.17 },
  { city: 'Salvador', region: 'Bahia', country: 'Brazil', lat: -12.97, lng: -38.5 },
]);

export function createE2EGeocoder({ window }) {
  const record = (event) => window.__RODA_E2E_EVENTS__?.push(event);
  const failing = () => window.localStorage.getItem('roda.e2e.failGeocoder') === 'true';
  const down = () => new AppError('network', 'geocoder_unavailable', 'City search is not available right now.', { retryable: true });
  return {
    async searchCities(query) {
      const text = foldText(query);
      if (text.length < 2) return [];
      record({ type: 'geocode-search', query: String(query).trim() });
      if (failing()) throw down();
      return E2E_CITIES.filter(({ city }) => foldText(city).includes(text)).map((place) => ({ ...place }));
    },
    async reverse({ lat, lng }) {
      record({ type: 'geocode-reverse', lat: roundCoordinate(lat), lng: roundCoordinate(lng) });
      if (failing()) throw down();
      const nearest = [...E2E_CITIES]
        .sort((a, b) => Math.hypot(a.lat - lat, a.lng - lng) - Math.hypot(b.lat - lat, b.lng - lng))[0];
      return Math.hypot(nearest.lat - lat, nearest.lng - lng) < 2 ? { ...nearest } : null;
    },
  };
}
```

- [ ] **Step 5: Wire the geocoder**

In `src/app/create-services.js`, import `createNominatimGeocoder` from `./geocoder.js` and `createE2EGeocoder` from the fakes, then change the function head and both return objects:

```js
export function createServices({ window, localMode, e2e = false, language = () => 'en' }) {
  const geocoder = e2e
    ? createE2EGeocoder({ window })
    : createNominatimGeocoder({ fetch: window.fetch.bind(window), language });
  if (localMode) {
    return {
      // …existing entries…
      discover: createE2EDiscoverService({ window }),
      geocoder,
    };
  }
  // …
  return {
    // …existing entries…
    discover: createDiscoverService(client),
    geocoder,
  };
}
```

In `src/app/entries/app.js`, create `i18n` before `services` and pass the new options:

```js
  const i18n = createDashboardI18n({ document, storage: localStorage, navigator });
  const services = createServices({ window, localMode, e2e: __RODA_E2E__, language: () => i18n.locale() });
```

(delete the later `const i18n = …` line).

- [ ] **Step 6: Run tests and the build**

Run: `npx vitest run && npm run build:test`
Expected: PASS; the build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/app/geocoder.js src/app/testing/fake-services.js src/app/create-services.js src/app/entries/app.js tests/unit/geocoder.test.js
git commit -m "feat: add a policy-friendly Nominatim city search

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Leaflet, map helpers, and the map adapter

**Files:**
- Create: `src/app/map-tiles.js`, `src/app/screens/discover-state.js`, `src/app/screens/discover-map.js`
- Modify: `package.json`, `package-lock.json`, `scripts/build.mjs`, `app.html`, `src/app/sw/cache-policy.js`, `src/app/entries/app.js`
- Test: `tests/unit/discover-state.test.js`, `tests/unit/build-config.test.js`, `tests/unit/cache-policy.test.js`

**Interfaces:**
- Consumes: `placeLabel`, `EMAIL` (Task 3); `el` (`src/app/shell/page.js`).
- Produces:
  - `OSM_TILES = { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution }`, `E2E_TILES = { url: <one-pixel data URL>, attribution }` (same attribution).
  - `discover-state.js`: `WORLD_VIEW = { lat: 20, lng: 0, zoom: 2 }`; `normalizeBounds({ minLat, minLng, maxLat, maxLng }) → bounds` (latitudes clamped, longitudes wrapped into −180…180, full world when the span is ≥ 360, 4 decimals); `initialView({ remembered, myPlace }) → { lat, lng, zoom }`; `summarize(points) → { people, groups }`; `pinLabel(point) → 'Lisbon · 3' | group name`; `pinElement(document, point) → <span class="discover-pin city|group">` (text only); `sortForPanel(points)` (cities by count, then groups by name); `contactLinks(contacts) → [{ kind, text, href }]` (Instagram, `https:` website, `wa.me`, `mailto:` only).
  - `createLeafletMap({ document, container, tiles, view, onMove, onSelect, onTap }) → { setPoints(points), flyTo({ lat, lng, zoom? }), destroy() }`; calls `onMove({ bounds, view })` after the first render and every `moveend`; `onSelect(point)` on marker click or Enter; `onTap({ lat, lng })` on map click when given.
  - `ctx.createMap(options)` in `src/app/entries/app.js` = `createLeafletMap({ document, tiles, ...options })` with `E2E_TILES` in test builds.
  - Build output `assets/generated/leaflet.css` with its images inlined; precached by the service worker and linked from `app.html`.

Ruling 9 (dependency and bundling) and Ruling 17 (zoom 2–14) apply. The adapter has no unit test because Leaflet needs a real layout engine; Task 7's screen tests use a fake map and Task 11's browser tests exercise the real one.

- [ ] **Step 1: Add the dependency**

Run: `npm install --save-dev --save-exact leaflet@1.9.4`
Expected: `package.json` `devDependencies` gains `"leaflet": "1.9.4"` and `package-lock.json` updates.

- [ ] **Step 2: Write the failing tests**

```js
// tests/unit/discover-state.test.js
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  contactLinks, initialView, normalizeBounds, pinElement, pinLabel, sortForPanel, summarize, WORLD_VIEW,
} from '../../src/app/screens/discover-state.js';

describe('discover state', () => {
  it.each([
    [{ minLat: 38, minLng: -10, maxLat: 39, maxLng: -9 }, { minLat: 38, minLng: -10, maxLat: 39, maxLng: -9 }],
    [{ minLat: -95, minLng: -540, maxLat: 95, maxLng: 540 }, { minLat: -90, minLng: -180, maxLat: 90, maxLng: 180 }],
    [{ minLat: -30, minLng: 170, maxLat: 0, maxLng: 190 }, { minLat: -30, minLng: 170, maxLat: 0, maxLng: -170 }],
    [{ minLat: -30, minLng: -200, maxLat: 0, maxLng: -170 }, { minLat: -30, minLng: 160, maxLat: 0, maxLng: -170 }],
    [{ minLat: 0, minLng: 100, maxLat: 10, maxLng: 180 }, { minLat: 0, minLng: 100, maxLat: 10, maxLng: 180 }],
    [{ minLat: 38.123456, minLng: -9.987654, maxLat: 39, maxLng: -9 }, { minLat: 38.1235, minLng: -9.9877, maxLat: 39, maxLng: -9 }],
  ])('normalizes %o', (input, expected) => {
    expect(normalizeBounds(input)).toEqual(expected);
  });

  it('starts at the remembered view, then my city, then the world', () => {
    expect(initialView({ remembered: { lat: 1, lng: 2, zoom: 5 }, myPlace: { lat: 38.72, lng: -9.14 } }))
      .toEqual({ lat: 1, lng: 2, zoom: 5 });
    expect(initialView({ myPlace: { lat: 38.72, lng: -9.14 } })).toEqual({ lat: 38.72, lng: -9.14, zoom: 10 });
    expect(initialView()).toEqual(WORLD_VIEW);
  });

  it('summarizes and orders what is in view', () => {
    const points = [
      { kind: 'group', name: 'Grupo Lua' }, { kind: 'city', city: 'Porto', person_count: 1 },
      { kind: 'city', city: 'Lisbon', person_count: 3 },
    ];
    expect(summarize(points)).toEqual({ people: 4, groups: 1 });
    expect(sortForPanel(points).map(pinLabel)).toEqual(['Lisbon · 3', 'Porto · 1', 'Grupo Lua']);
  });

  it('builds pins as text so names cannot inject markup', () => {
    const pin = pinElement(document, { kind: 'city', city: '<img src=x onerror=alert(1)>', person_count: 2 });
    expect(pin.querySelector('img')).toBeNull();
    expect(pin.textContent).toBe('<img src=x onerror=alert(1)> · 2');
    expect(pin.className).toBe('discover-pin city');
  });

  it('links only to safe contact addresses', () => {
    expect(contactLinks({
      instagram: 'ana.silva', website: 'https://ana.example/aulas', whatsapp: '+351 912 345 678', email: 'ana@example.com',
    })).toEqual([
      { kind: 'instagram', text: '@ana.silva', href: 'https://www.instagram.com/ana.silva/' },
      { kind: 'website', text: 'ana.example', href: 'https://ana.example/aulas' },
      { kind: 'whatsapp', text: '+351 912 345 678', href: 'https://wa.me/351912345678' },
      { kind: 'email', text: 'ana@example.com', href: 'mailto:ana@example.com' },
    ]);
    expect(contactLinks({ instagram: 'x/../evil', website: 'javascript:alert(1)', email: 'a@b.co?cc=x@y.z' })).toEqual([]);
    expect(contactLinks({ website: 'http://ana.example', whatsapp: '12' })).toEqual([]);
  });
});
```

In `tests/unit/build-config.test.js`, add `readFile` to the `node:fs/promises` import and, right after the first `await buildBrowserBundles({ test: true, outputDirectory });`, add:

```js
      const leafletCss = await readFile(join(outputDirectory, 'leaflet.css'), 'utf8');
      expect(leafletCss).toContain('.leaflet-container');
      expect(leafletCss).not.toMatch(/url\(["']?images\//);
```

In `tests/unit/cache-policy.test.js`, extend the precache expectation:

```js
    expect(APP_SHELL).toEqual(expect.arrayContaining([
      '/app', '/assets/app.css', '/assets/generated/app.js', '/assets/generated/leaflet.css', '/manifest.webmanifest',
    ]));
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/unit/discover-state.test.js tests/unit/build-config.test.js tests/unit/cache-policy.test.js`
Expected: FAIL — `discover-state.js` missing, `leaflet.css` missing, `APP_SHELL` lacks the stylesheet.

- [ ] **Step 4: Implement the helpers and tiles**

```js
// src/app/map-tiles.js
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

export const OSM_TILES = Object.freeze({
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: OSM_ATTRIBUTION,
});

// One transparent pixel for every tile, so browser tests never contact OpenStreetMap.
export const E2E_TILES = Object.freeze({
  url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  attribution: OSM_ATTRIBUTION,
});
```

```js
// src/app/screens/discover-state.js
import { EMAIL } from '../discover-rules.js';
import { el } from '../shell/page.js';

export const WORLD_VIEW = Object.freeze({ lat: 20, lng: 0, zoom: 2 });

function wrapLng(lng) {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

export function normalizeBounds({ minLat, minLng, maxLat, maxLng }) {
  const clampLat = (value) => round4(Math.min(90, Math.max(-90, value)));
  if (maxLng - minLng >= 360) return { minLat: clampLat(minLat), minLng: -180, maxLat: clampLat(maxLat), maxLng: 180 };
  let east = wrapLng(maxLng);
  if (east === -180 && maxLng > minLng) east = 180;
  return { minLat: clampLat(minLat), minLng: round4(wrapLng(minLng)), maxLat: clampLat(maxLat), maxLng: round4(east) };
}

export function initialView({ remembered = null, myPlace = null } = {}) {
  if (remembered) return remembered;
  if (myPlace) return { lat: myPlace.lat, lng: myPlace.lng, zoom: 10 };
  return WORLD_VIEW;
}

export function summarize(points) {
  return points.reduce((total, point) => (point.kind === 'city'
    ? { ...total, people: total.people + (point.person_count ?? 0) }
    : { ...total, groups: total.groups + 1 }), { people: 0, groups: 0 });
}

export function pinLabel(point) {
  return point.kind === 'city' ? `${point.city} · ${point.person_count}` : point.name;
}

export function pinElement(document, point) {
  return el(document, 'span', { className: `discover-pin ${point.kind}`, text: pinLabel(point) });
}

export function sortForPanel(points) {
  return [...points].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'city' ? -1 : 1)
    || (b.person_count ?? 0) - (a.person_count ?? 0)
    || pinLabel(a).localeCompare(pinLabel(b)));
}

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function contactLinks(contacts = {}) {
  const links = [];
  if (contacts.instagram && /^[A-Za-z0-9._]{1,30}$/.test(contacts.instagram)) {
    links.push({ kind: 'instagram', text: `@${contacts.instagram}`, href: `https://www.instagram.com/${contacts.instagram}/` });
  }
  const website = contacts.website ? httpsUrl(contacts.website) : null;
  if (website) links.push({ kind: 'website', text: website.host, href: website.href });
  const digits = String(contacts.whatsapp ?? '').replace(/\D/g, '');
  if (digits.length >= 6 && digits.length <= 20) {
    links.push({ kind: 'whatsapp', text: contacts.whatsapp, href: `https://wa.me/${digits}` });
  }
  if (contacts.email && EMAIL.test(contacts.email)) {
    links.push({ kind: 'email', text: contacts.email, href: `mailto:${contacts.email}` });
  }
  return links;
}
```

- [ ] **Step 5: Implement the Leaflet adapter**

```js
// src/app/screens/discover-map.js
import * as L from 'leaflet';

import { pinElement, pinLabel } from './discover-state.js';

const LEAFLET_LINK = '<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>';

export function createLeafletMap({
  document, container, tiles, view, onMove = () => {}, onSelect = () => {}, onTap = null,
}) {
  const map = L.map(container, { zoomControl: false, attributionControl: false, worldCopyJump: true, minZoom: 2, maxZoom: 14 });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.attribution({ position: 'bottomright', prefix: LEAFLET_LINK }).addTo(map);
  L.tileLayer(tiles.url, {
    attribution: tiles.attribution, maxZoom: 14, referrerPolicy: 'strict-origin-when-cross-origin',
  }).addTo(map);
  const markers = L.layerGroup().addTo(map);

  function snapshot() {
    const bounds = map.getBounds();
    const center = map.getCenter().wrap();
    return {
      bounds: { minLat: bounds.getSouth(), minLng: bounds.getWest(), maxLat: bounds.getNorth(), maxLng: bounds.getEast() },
      view: { lat: center.lat, lng: center.lng, zoom: map.getZoom() },
    };
  }

  map.on('moveend', () => onMove(snapshot()));
  if (onTap) {
    map.on('click', (event) => {
      const point = event.latlng.wrap();
      onTap({ lat: point.lat, lng: point.lng });
    });
  }
  map.setView([view.lat, view.lng], view.zoom);
  map.whenReady(() => onMove(snapshot()));
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => map.invalidateSize()) : null;
  observer?.observe(container);

  return {
    setPoints(points) {
      markers.clearLayers();
      for (const point of points) {
        L.marker([Number(point.lat), Number(point.lng)], {
          icon: L.divIcon({ className: 'discover-pin-icon', html: pinElement(document, point), iconSize: null }),
          keyboard: true,
          title: pinLabel(point),
          riseOnHover: true,
        }).on('click', () => onSelect(point)).addTo(markers);
      }
    },
    flyTo({ lat, lng, zoom }) {
      map.setView([lat, lng], zoom ?? Math.max(map.getZoom(), 10));
    },
    destroy() {
      observer?.disconnect();
      map.remove();
    },
  };
}
```

- [ ] **Step 6: Build Leaflet's CSS, link it, and precache it**

In `scripts/build.mjs`, after the main `await build({ entryPoints, … })` call, add:

```js
  await build({
    entryPoints: { leaflet: 'node_modules/leaflet/dist/leaflet.css' },
    outdir: outputDirectory,
    entryNames: '[name]',
    bundle: true,
    minify: !test,
    legalComments: 'none',
    loader: { '.png': 'dataurl', '.svg': 'dataurl' },
  });
```

In `app.html`, before the `app.css` link:

```html
  <link rel="stylesheet" href="/assets/generated/leaflet.css">
```

In `src/app/sw/cache-policy.js`, add `'/assets/generated/leaflet.css',` after `'/assets/generated/app.js',` in `APP_SHELL`. (Tiles and Nominatim are cross-origin, so `strategyFor` already bypasses them: the service worker never caches third-party data.)

- [ ] **Step 7: Provide `ctx.createMap` in `src/app/entries/app.js`**

```js
import { E2E_TILES, OSM_TILES } from '../map-tiles.js';
import { createLeafletMap } from '../screens/discover-map.js';
```

Before `const ctx = {`, add `const tiles = __RODA_E2E__ ? E2E_TILES : OSM_TILES;` and add this property to `ctx`:

```js
    createMap: (options) => createLeafletMap({ document, tiles, ...options }),
```

- [ ] **Step 8: Run tests and the build**

Run: `npx vitest run && npm run build:test`
Expected: PASS; `assets/generated/leaflet.css` exists and `app.js` bundles Leaflet.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json scripts/build.mjs app.html src/app/sw/cache-policy.js src/app/map-tiles.js src/app/screens/discover-state.js src/app/screens/discover-map.js src/app/entries/app.js tests/unit/discover-state.test.js tests/unit/build-config.test.js tests/unit/cache-policy.test.js
git commit -m "feat: bundle Leaflet with Discover map helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Settings → Discover

**Files:**
- Create: `src/app/screens/discover-settings.js`
- Modify: `src/app/screens/me.js`, `src/app/dashboard-i18n.js`, `assets/app.css`
- Test: `tests/unit/discover-settings.test.js`, `tests/unit/me-screen.test.js`

**Interfaces:**
- Consumes: Task 3 rules and `services.discover.loadMine/updateMine`; Task 4 `services.geocoder.searchCities/reverse`; Task 5 `WORLD_VIEW`, `ctx.createMap`; `ctx.openSheet` (plan 1).
- Produces:
  - `createCityPicker(ctx, { value, onChange }) → { element, value() }` — shows the chosen city, Remove city, a search box with a Search button (Enter also searches; nothing is sent while typing; Search is disabled in flight), result buttons labeled with `placeLabel`, "Pick on the map" (a sheet with a map; one reverse lookup per tap), and the OpenStreetMap privacy note.
  - `createVisibilityChoice(ctx, { stored, mode, name }) → { element, value() }` — three radios; the effective value is checked; `value()` stays `stored` (possibly null) until the person picks.
  - `createContactFields(ctx, { values, fields }) → { element, read(), showErrors(map), focusFirstError(map) }` — inputs named `instagram`, `website`, `whatsapp`, `email`; `read()` returns `normalizeContacts(...)`.
  - `errorText(i18n, error) → string`.
  - `renderDiscoverSettings(ctx) → Promise<HTMLElement>` (`section.discover-settings`, Save button `data-action="save-discover"`).
  - i18n keys `discover.privacy`, `geocoder.unavailable`, `discoverSettings.*`.

Rulings 4, 7, 10, 14, 15 apply. Plan 2's `renderSettings(ctx, { onLocaleChange, onSignOut, onProfileSaved })` starts with a Profile section (R19); the Discover section goes right after it and before Language, matching the spec's Settings order (profile, Discover visibility, city, contacts, language, …).

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/discover-settings.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { renderDiscoverSettings } from '../../src/app/screens/discover-settings.js';

const LISBON = { city: 'Lisbon', region: 'Lisbon', country: 'Portugal', lat: 38.72, lng: -9.14 };
const EMPTY = {
  id: 'p1', usage_mode: 'train', discover_visibility: null, place_city: null, place_region: null, place_country: null,
  place_lat: null, place_lng: null, contact_instagram: null, contact_website: null, contact_whatsapp: null, contact_email: null,
};

function ctx({ mine = EMPTY, discover = {}, geocoder = {} } = {}) {
  const values = new Map([['roda.dashboard.locale', 'en']]);
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const sheets = [];
  const maps = [];
  return {
    document, sheets, maps,
    i18n: createDashboardI18n({ document, storage, navigator: { languages: ['en'] } }),
    profile: { id: 'p1', display_name: 'Ana Silva' },
    services: {
      discover: { loadMine: vi.fn().mockResolvedValue(mine), updateMine: vi.fn().mockResolvedValue({ status: 'updated' }), ...discover },
      geocoder: { searchCities: vi.fn().mockResolvedValue([LISBON]), reverse: vi.fn().mockResolvedValue(LISBON), ...geocoder },
    },
    openSheet: vi.fn((options) => {
      const sheet = { ...options, close: vi.fn(() => options.onClose?.()) };
      sheets.push(sheet);
      return sheet;
    }),
    createMap: vi.fn((options) => {
      const map = { options, setPoints: vi.fn(), flyTo: vi.fn(), destroy: vi.fn() };
      maps.push(map);
      return map;
    }),
  };
}

async function mount(context) {
  const view = await renderDiscoverSettings(context);
  document.body.replaceChildren(view);
  return view;
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const press = (node, key) => node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

async function chooseLisbon(view) {
  const input = view.querySelector('input[aria-label="Search a city"]');
  input.value = 'Lisbon';
  press(input, 'Enter');
  await flush();
  [...view.querySelectorAll('.discover-city-results button')].find((button) => button.textContent === 'Lisbon, Portugal').click();
}

describe('Discover settings', () => {
  it('shows the mode default when nothing was chosen', async () => {
    const view = await mount(ctx());
    expect(view.querySelector('.discover-city-current').textContent).toBe('No city yet.');
    expect(view.querySelector('input[value="nobody"]').checked).toBe(true);
    expect(view.textContent).toContain("You haven't chosen yet, so this follows your mode.");
    expect(view.textContent).toContain('Map images and city search come from OpenStreetMap.');
  });

  it('shows a Teach person as findable by everyone', async () => {
    const view = await mount(ctx({ mine: { ...EMPTY, usage_mode: 'teach' } }));
    expect(view.querySelector('input[value="everyone"]').checked).toBe(true);
  });

  it('asks the geocoder only when Search is pressed, once per press', async () => {
    const context = ctx();
    const view = await mount(context);
    const input = view.querySelector('input[aria-label="Search a city"]');
    input.value = 'Lisbon';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(context.services.geocoder.searchCities).not.toHaveBeenCalled();
    press(input, 'Enter');
    view.querySelector('.discover-city-search button').click();
    await flush();
    expect(context.services.geocoder.searchCities).toHaveBeenCalledTimes(1);
    expect(context.services.geocoder.searchCities).toHaveBeenCalledWith('Lisbon');
    [...view.querySelectorAll('.discover-city-results button')].find((button) => button.textContent === 'Lisbon, Portugal').click();
    expect(view.querySelector('.discover-city-current').textContent).toBe('Lisbon, Portugal');
  });

  it('keeps the typed city when city search is unavailable', async () => {
    const view = await mount(ctx({ geocoder: { searchCities: vi.fn().mockRejectedValue(new Error('down')) } }));
    const input = view.querySelector('input[aria-label="Search a city"]');
    input.value = 'Lisbon';
    press(input, 'Enter');
    await flush();
    expect(view.textContent).toContain("City search isn't available right now. Try again in a moment.");
    expect(input.value).toBe('Lisbon');
    expect(view.querySelector('.discover-city-search button').disabled).toBe(false);
  });

  it('blocks invalid contacts before saving', async () => {
    const context = ctx();
    const view = await mount(context);
    view.querySelector('input[name="website"]').value = 'http://ana.example';
    view.querySelector('input[name="email"]').value = 'ana@example';
    view.querySelector('button[data-action="save-discover"]').click();
    await flush();
    expect(context.services.discover.updateMine).not.toHaveBeenCalled();
    expect(view.textContent).toContain('Use a full address starting with https://.');
    expect(view.textContent).toContain('Enter a valid email address.');
    expect(document.activeElement).toBe(view.querySelector('input[name="website"]'));
  });

  it('saves the place, contacts, and an unchosen visibility as null', async () => {
    const context = ctx();
    const view = await mount(context);
    await chooseLisbon(view);
    view.querySelector('input[name="instagram"]').value = '@ana.silva';
    view.querySelector('button[data-action="save-discover"]').click();
    await flush();
    expect(context.services.discover.updateMine).toHaveBeenLastCalledWith({
      visibility: null, place: LISBON, contacts: { instagram: 'ana.silva', website: null, whatsapp: null, email: null },
    });
    expect(view.textContent).toContain('Saved.');
    const nobody = view.querySelector('input[value="nobody"]');
    nobody.checked = true;
    nobody.dispatchEvent(new Event('change', { bubbles: true }));
    view.querySelector('button[data-action="save-discover"]').click();
    await flush();
    expect(context.services.discover.updateMine.mock.lastCall[0].visibility).toBe('nobody');
  });

  it('shows a server rejection next to its field', async () => {
    const rejection = Object.assign(new Error('Something went wrong.'), { kind: 'validation', code: 'invalid_whatsapp' });
    const view = await mount(ctx({ discover: { updateMine: vi.fn().mockRejectedValue(rejection) } }));
    view.querySelector('input[name="whatsapp"]').value = '+351 912 345 678';
    view.querySelector('button[data-action="save-discover"]').click();
    await flush();
    expect(view.querySelector('input[name="whatsapp"]').getAttribute('aria-invalid')).toBe('true');
    expect(view.textContent).toContain('Use 6 to 20 digits, optionally starting with +.');
  });

  it('picks a city by tapping the map', async () => {
    const context = ctx();
    const view = await mount(context);
    view.querySelector('button[data-action="pick-on-map"]').click();
    expect(context.maps[0].options.view).toEqual({ lat: 20, lng: 0, zoom: 2 });
    await context.maps[0].options.onTap({ lat: 38.7123, lng: -9.1398 });
    expect(context.services.geocoder.reverse).toHaveBeenCalledWith({ lat: 38.7123, lng: -9.1398 });
    expect(context.sheets[0].close).toHaveBeenCalled();
    expect(context.maps[0].destroy).toHaveBeenCalled();
    expect(view.querySelector('.discover-city-current').textContent).toBe('Lisbon, Portugal');
  });
});
```

In `tests/unit/me-screen.test.js`, extend the `services` of every context that renders Settings (the shared `ctx()` and plan 2's "saves the profile from Settings" test):

```js
    services: {
      catalog: { amICurator: vi.fn().mockResolvedValue(false) },
      discover: { loadMine: vi.fn().mockResolvedValue({ id: 'p1', usage_mode: 'train', discover_visibility: null, place_city: null }) },
      geocoder: { searchCities: vi.fn(), reverse: vi.fn() },
    },
```

and in "switches language and signs out from Settings" add `expect(view.querySelector('.discover-settings')).not.toBeNull();`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/discover-settings.test.js tests/unit/me-screen.test.js`
Expected: FAIL — cannot find module `discover-settings.js`; the Settings assertion fails.

- [ ] **Step 3: Add the i18n keys**

Append to the `en` object in `src/app/dashboard-i18n.js`:

```js
    'discover.privacy': 'Map images and city search come from OpenStreetMap. Your browser contacts their servers directly, so they see your IP address and the area you look at, never your name or account.',
    'geocoder.unavailable': "City search isn't available right now. Try again in a moment.",
    'discoverSettings.title': 'Discover',
    'discoverSettings.city': 'Your city',
    'discoverSettings.cityNone': 'No city yet.',
    'discoverSettings.citySearch': 'Search a city',
    'discoverSettings.search': 'Search',
    'discoverSettings.searching': 'Searching…',
    'discoverSettings.noCity': 'No city found. Try another spelling.',
    'discoverSettings.pickOnMap': 'Pick on the map',
    'discoverSettings.tapMap': 'Tap your city on the map',
    'discoverSettings.removeCity': 'Remove city',
    'discoverSettings.who': 'Who can find you',
    'discoverSettings.everyone': 'Everyone',
    'discoverSettings.signedIn': 'Signed-in people',
    'discoverSettings.nobody': 'Nobody',
    'discoverSettings.defaultHint': "You haven't chosen yet, so this follows your mode.",
    'discoverSettings.contacts': 'Contacts',
    'discoverSettings.contactsHint': 'Shown on your card to people who can find you.',
    'discoverSettings.instagram': 'Instagram handle',
    'discoverSettings.website': 'Website (https)',
    'discoverSettings.whatsapp': 'WhatsApp number',
    'discoverSettings.email': 'Contact email',
    'discoverSettings.save': 'Save',
    'discoverSettings.saved': 'Saved.',
    'discoverSettings.error.invalid_instagram': 'Use up to 30 letters, numbers, dots, or underscores.',
    'discoverSettings.error.invalid_website': 'Use a full address starting with https://.',
    'discoverSettings.error.invalid_whatsapp': 'Use 6 to 20 digits, optionally starting with +.',
    'discoverSettings.error.invalid_email': 'Enter a valid email address.',
    'discoverSettings.error.invalid_place': 'Choose a city from the search results.',
    'discoverSettings.error.invalid_visibility': 'Choose who can find you.',
```

Append to the `pt` object:

```js
    'discover.privacy': 'As imagens do mapa e a procura de cidades vêm do OpenStreetMap. O teu navegador contacta diretamente os servidores deles, que veem o teu endereço IP e a zona que estás a ver, nunca o teu nome nem a tua conta.',
    'geocoder.unavailable': 'A procura de cidades não está disponível agora. Tenta daqui a pouco.',
    'discoverSettings.title': 'Descobrir',
    'discoverSettings.city': 'A tua cidade',
    'discoverSettings.cityNone': 'Ainda sem cidade.',
    'discoverSettings.citySearch': 'Procurar uma cidade',
    'discoverSettings.search': 'Procurar',
    'discoverSettings.searching': 'A procurar…',
    'discoverSettings.noCity': 'Nenhuma cidade encontrada. Tenta outra grafia.',
    'discoverSettings.pickOnMap': 'Escolher no mapa',
    'discoverSettings.tapMap': 'Toca na tua cidade no mapa',
    'discoverSettings.removeCity': 'Remover cidade',
    'discoverSettings.who': 'Quem te pode encontrar',
    'discoverSettings.everyone': 'Toda a gente',
    'discoverSettings.signedIn': 'Pessoas com sessão iniciada',
    'discoverSettings.nobody': 'Ninguém',
    'discoverSettings.defaultHint': 'Ainda não escolheste, por isso segue o teu modo.',
    'discoverSettings.contacts': 'Contactos',
    'discoverSettings.contactsHint': 'Aparecem no teu cartão para quem te pode encontrar.',
    'discoverSettings.instagram': 'Utilizador do Instagram',
    'discoverSettings.website': 'Site (https)',
    'discoverSettings.whatsapp': 'Número de WhatsApp',
    'discoverSettings.email': 'Email de contacto',
    'discoverSettings.save': 'Guardar',
    'discoverSettings.saved': 'Guardado.',
    'discoverSettings.error.invalid_instagram': 'Usa até 30 letras, números, pontos ou sublinhados.',
    'discoverSettings.error.invalid_website': 'Usa um endereço completo começado por https://.',
    'discoverSettings.error.invalid_whatsapp': 'Usa 6 a 20 dígitos, opcionalmente começados por +.',
    'discoverSettings.error.invalid_email': 'Introduz um email válido.',
    'discoverSettings.error.invalid_place': 'Escolhe uma cidade dos resultados da procura.',
    'discoverSettings.error.invalid_visibility': 'Escolhe quem te pode encontrar.',
```

- [ ] **Step 4: Implement the settings module**

```js
// src/app/screens/discover-settings.js
import {
  VISIBILITIES, contactsFromRow, effectiveVisibility, fieldErrors, normalizeContacts, normalizePlace, placeFromRow,
  placeLabel, validateContacts,
} from '../discover-rules.js';
import { el } from '../shell/page.js';
import { WORLD_VIEW } from './discover-state.js';

const VISIBILITY_KEYS = Object.freeze({
  everyone: 'discoverSettings.everyone', signed_in: 'discoverSettings.signedIn', nobody: 'discoverSettings.nobody',
});
const CONTACT_FIELDS = Object.freeze([
  ['instagram', 'discoverSettings.instagram', 'text'],
  ['website', 'discoverSettings.website', 'url'],
  ['whatsapp', 'discoverSettings.whatsapp', 'tel'],
  ['email', 'discoverSettings.email', 'email'],
]);
const KNOWN_ERRORS = new Set([
  'invalid_place', 'invalid_visibility', 'invalid_instagram', 'invalid_website', 'invalid_whatsapp', 'invalid_email',
]);

export function errorText(i18n, error) {
  return KNOWN_ERRORS.has(error?.code)
    ? i18n.t(`discoverSettings.error.${error.code}`)
    : (error?.message || i18n.t('app.loadError'));
}

export function createCityPicker(ctx, { value = null, onChange = () => {} } = {}) {
  const { document, i18n } = ctx;
  let current = value;
  let searching = false;
  const label = el(document, 'p', { className: 'discover-city-current' });
  const remove = el(document, 'button', { className: 'quiet-button', text: i18n.t('discoverSettings.removeCity'), attrs: { type: 'button' } });
  const input = el(document, 'input', { className: 'field-input', attrs: {
    type: 'search', 'aria-label': i18n.t('discoverSettings.citySearch'), placeholder: i18n.t('discoverSettings.citySearch'),
    autocomplete: 'off', enterkeyhint: 'search',
  } });
  const searchButton = el(document, 'button', { className: 'secondary-button', text: i18n.t('discoverSettings.search'), attrs: { type: 'button' } });
  const results = el(document, 'div', { className: 'discover-city-results', attrs: { 'aria-live': 'polite' } });
  const mapButton = ctx.createMap
    ? el(document, 'button', { className: 'quiet-button', text: i18n.t('discoverSettings.pickOnMap'), attrs: { type: 'button' }, dataset: { action: 'pick-on-map' } })
    : null;

  function refresh() {
    label.textContent = current ? placeLabel(current) : i18n.t('discoverSettings.cityNone');
    remove.hidden = !current;
  }

  function choose(place) {
    current = place;
    results.replaceChildren();
    refresh();
    onChange(place);
  }

  async function search() {
    const text = input.value.trim();
    if (text.length < 2 || searching) return;
    searching = true;
    searchButton.disabled = true;
    results.replaceChildren(el(document, 'p', { className: 'muted', text: i18n.t('discoverSettings.searching') }));
    try {
      const places = await ctx.services.geocoder.searchCities(text);
      results.replaceChildren(...(places.length
        ? places.map((place) => el(document, 'button', {
          className: 'discover-row', text: placeLabel(place), attrs: { type: 'button' }, on: { click: () => choose(place) },
        }))
        : [el(document, 'p', { className: 'muted', text: i18n.t('discoverSettings.noCity') })]));
    } catch {
      results.replaceChildren(el(document, 'p', { className: 'field-error', text: i18n.t('geocoder.unavailable') }));
    } finally {
      searching = false;
      searchButton.disabled = false;
    }
  }

  function pickOnMap() {
    const container = el(document, 'div', { className: 'discover-pick-map' });
    const status = el(document, 'p', { className: 'muted', attrs: { role: 'status' } });
    let map = null;
    let busy = false;
    const sheet = ctx.openSheet({
      title: i18n.t('discoverSettings.tapMap'),
      content: el(document, 'div', {}, [container, status]),
      onClose: () => map?.destroy(),
    });
    map = ctx.createMap({
      container,
      view: current ? { lat: current.lat, lng: current.lng, zoom: 10 } : WORLD_VIEW,
      onTap: async (point) => {
        if (busy) return;
        busy = true;
        status.textContent = i18n.t('discoverSettings.searching');
        try {
          const place = await ctx.services.geocoder.reverse(point);
          if (place) {
            sheet.close();
            choose(place);
          } else {
            status.textContent = i18n.t('discoverSettings.noCity');
          }
        } catch {
          status.textContent = i18n.t('geocoder.unavailable');
        } finally {
          busy = false;
        }
      },
    });
  }

  remove.addEventListener('click', () => choose(null));
  searchButton.addEventListener('click', search);
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    search();
  });
  mapButton?.addEventListener('click', pickOnMap);
  refresh();
  const element = el(document, 'div', { className: 'discover-city' }, [
    label, remove, el(document, 'div', { className: 'discover-city-search' }, [input, searchButton]), results, mapButton,
    el(document, 'p', { className: 'muted discover-privacy', text: i18n.t('discover.privacy') }),
  ]);
  return { element, value: () => current };
}

export function createVisibilityChoice(ctx, { stored = null, mode = 'train', name = 'discoverVisibility' } = {}) {
  const { document, i18n } = ctx;
  let chosen = stored;
  const effective = effectiveVisibility({ discover_visibility: stored, usage_mode: mode });
  const hint = el(document, 'p', { className: 'muted', text: i18n.t('discoverSettings.defaultHint'), attrs: { hidden: Boolean(stored) } });
  const options = VISIBILITIES.map((value) => el(document, 'label', { className: 'discover-radio' }, [
    el(document, 'input', {
      attrs: { type: 'radio', name, value, checked: value === effective },
      on: { change: () => { chosen = value; hint.hidden = true; } },
    }),
    ` ${i18n.t(VISIBILITY_KEYS[value])}`,
  ]));
  const element = el(document, 'fieldset', { className: 'discover-visibility' }, [
    el(document, 'legend', { className: 'section-label', text: i18n.t('discoverSettings.who') }), ...options, hint,
  ]);
  return { element, value: () => chosen };
}

export function createContactFields(ctx, { values = {}, fields = ['instagram', 'website', 'whatsapp', 'email'] } = {}) {
  const { document, i18n } = ctx;
  const inputs = {};
  const errors = {};
  const element = el(document, 'div', { className: 'discover-contacts-form' }, CONTACT_FIELDS
    .filter(([key]) => fields.includes(key))
    .map(([key, labelKey, type]) => {
      inputs[key] = el(document, 'input', { className: 'field-input', attrs: { type, name: key, value: values[key] ?? '', autocomplete: 'off' } });
      errors[key] = el(document, 'span', { className: 'field-error' });
      return el(document, 'label', { className: 'field-label' }, [i18n.t(labelKey), inputs[key], errors[key]]);
    }));
  return {
    element,
    read() {
      return normalizeContacts(Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value])));
    },
    showErrors(map) {
      for (const [key, node] of Object.entries(errors)) {
        node.textContent = map[key] ? i18n.t(`discoverSettings.error.${map[key]}`) : '';
        inputs[key].setAttribute('aria-invalid', String(Boolean(map[key])));
      }
    },
    focusFirstError(map) {
      inputs[Object.keys(inputs).find((key) => map[key])]?.focus();
    },
  };
}

export async function renderDiscoverSettings(ctx) {
  const { document, i18n } = ctx;
  const section = el(document, 'section', { className: 'discover-settings', attrs: { 'aria-labelledby': 'discoverSettingsTitle' } }, [
    el(document, 'h2', { className: 'section-label', text: i18n.t('discoverSettings.title'), attrs: { id: 'discoverSettingsTitle' } }),
  ]);
  let mine;
  try {
    mine = await ctx.services.discover.loadMine();
  } catch (error) {
    section.append(el(document, 'p', { className: 'muted', text: errorText(i18n, error) }));
    return section;
  }
  let place = placeFromRow(mine);
  const city = createCityPicker(ctx, { value: place, onChange: (next) => { place = next; } });
  const visibility = createVisibilityChoice(ctx, { stored: mine.discover_visibility ?? null, mode: mine.usage_mode ?? 'train' });
  const contacts = createContactFields(ctx, { values: contactsFromRow(mine) });
  const status = el(document, 'p', { className: 'muted', attrs: { role: 'status' } });
  const save = el(document, 'button', {
    className: 'button-primary', text: i18n.t('discoverSettings.save'), attrs: { type: 'button' }, dataset: { action: 'save-discover' },
  });
  save.addEventListener('click', async () => {
    const values = contacts.read();
    const errors = validateContacts(values);
    contacts.showErrors(errors);
    if (Object.keys(errors).length) {
      status.textContent = '';
      contacts.focusFirstError(errors);
      return;
    }
    save.disabled = true;
    status.textContent = i18n.t('log.saving');
    try {
      await ctx.services.discover.updateMine({ visibility: visibility.value(), place: normalizePlace(place), contacts: values });
      status.textContent = i18n.t('discoverSettings.saved');
    } catch (error) {
      contacts.showErrors(fieldErrors(error));
      status.textContent = errorText(i18n, error);
    } finally {
      save.disabled = false;
    }
  });
  section.append(
    el(document, 'h3', { className: 'field-label', text: i18n.t('discoverSettings.city') }), city.element,
    visibility.element,
    el(document, 'h3', { className: 'field-label', text: i18n.t('discoverSettings.contacts') }),
    el(document, 'p', { className: 'muted', text: i18n.t('discoverSettings.contactsHint') }),
    contacts.element, save, status,
  );
  return section;
}
```

- [ ] **Step 5: Add the section to Settings in `src/app/screens/me.js`**

```js
import { renderDiscoverSettings } from './discover-settings.js';
```

In `renderSettings`, insert `await renderDiscoverSettings(ctx),` into the returned section's children right after plan 2's Profile section and before the Language label.

- [ ] **Step 6: Add the styles to `assets/app.css`**

```css
/* Discover settings and forms */
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.discover-settings { margin-bottom: 18px; }
.discover-city { display: grid; gap: 8px; }
.discover-city-current { margin: 0; font-weight: 600; }
.discover-city-search { display: flex; gap: 8px; }
.discover-city-search .field-input { flex: 1; }
.discover-city-results { display: grid; }
.discover-pick-map { height: 50vh; border-radius: 14px; overflow: hidden; isolation: isolate; }
.discover-visibility { border: 0; padding: 0; margin: 12px 0; }
.discover-radio { display: flex; gap: 8px; align-items: center; padding: 8px 0; }
.discover-privacy { font-size: .75rem; margin-top: 10px; }
.discover-row { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--line); background: transparent; padding: 12px 4px; cursor: pointer; }
.discover-row-title { font-weight: 600; }
.field-error { color: var(--clay); font-size: .8rem; }
.field-error:empty { display: none; }
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run`
Expected: PASS, including i18n key parity.

- [ ] **Step 8: Commit**

```bash
git add src/app/screens/discover-settings.js src/app/screens/me.js src/app/dashboard-i18n.js assets/app.css tests/unit/discover-settings.test.js tests/unit/me-screen.test.js
git commit -m "feat: add Discover city, visibility, and contacts to Settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: The Discover screen

**Files:**
- Create: `src/app/screens/discover.js`
- Modify: `src/app/entries/app.js`, `src/app/dashboard-i18n.js`, `assets/app.css`, `tests/e2e/app-shell.spec.js`
- Test: `tests/unit/discover-screen.test.js`

**Interfaces:**
- Consumes: `services.discover.loadMine/points/cityPeople/search` (Task 3), `services.geocoder.searchCities` (Task 4), `normalizeBounds`, `initialView`, `summarize`, `pinLabel`, `sortForPanel` (Task 5), `ctx.createMap` (Task 5), `placeFromRow`, `placeLabel` (Task 3), `ctx.navigate`, `ctx.profile.id`. Timers are the global `setTimeout`/`clearTimeout`, so Vitest's fake timers drive them.
- Produces:
  - `renderDiscover(ctx) → Promise<HTMLElement>` — `section.screen-discover` with a search form (`role="search"`, input labeled "Search people, groups, or cities"), `.discover-map`, and `.discover-panel` (handle button with `aria-expanded`, body listing what is in view, the add-your-city hint when the person has no city, and the privacy note). Points load 250 ms after the map stops moving; only the newest response is drawn. Rows are `button.discover-row` with `data-kind` (`city`, `group`, `person`, `place`) and `data-profile-id` / `data-group-id` where relevant.
  - `resetDiscoverMemory()` for tests. The last map view is remembered for the session so Back from a card returns to the same area.
  - Route `#/discover` renders this screen.
  - i18n keys `discover.*` (below) and `person.mode.*`.

Rulings 8 and 16 apply. Search uses our database (debounced 300 ms); "Find "…" on the map" is the only path from this screen to Nominatim.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/discover-screen.test.js
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { renderDiscover, resetDiscoverMemory } from '../../src/app/screens/discover.js';

const LISBON = {
  kind: 'city', city: 'Lisbon', region: 'Lisbon', country: 'Portugal', lat: 38.72, lng: -9.14,
  person_count: 3, group_id: null, name: null, location: null,
};
const GROUP = {
  kind: 'group', city: 'Lisbon', region: 'Lisbon', country: 'Portugal', lat: 38.73, lng: -9.13,
  person_count: null, group_id: 'g1', name: 'Grupo Lua', location: 'Arroios',
};
const WORLD = { bounds: { minLat: -60, minLng: -540, maxLat: 80, maxLng: 540 }, view: { lat: 20, lng: 0, zoom: 2 } };
const NO_PLACE = { id: 'me', usage_mode: 'train', place_city: null };
const MY_LISBON = { ...NO_PLACE, place_city: 'Lisbon', place_region: 'Lisbon', place_country: 'Portugal', place_lat: 38.72, place_lng: -9.14 };

function setup({ mine = NO_PLACE, discover = {}, geocoder = {} } = {}) {
  const maps = [];
  const values = new Map([['roda.dashboard.locale', 'en']]);
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const ctx = {
    document, window,
    i18n: createDashboardI18n({ document, storage, navigator: { languages: ['en'] } }),
    profile: { id: 'me', display_name: 'Ana Silva' },
    navigate: vi.fn(),
    services: {
      discover: {
        loadMine: vi.fn().mockResolvedValue(mine),
        points: vi.fn().mockResolvedValue([LISBON, GROUP]),
        cityPeople: vi.fn().mockResolvedValue([
          { profile_id: 'me', display_name: 'Ana Silva', usage_mode: 'train' },
          { profile_id: 'p2', display_name: 'Mestre Lua', usage_mode: 'teach' },
        ]),
        search: vi.fn().mockResolvedValue([]),
        ...discover,
      },
      geocoder: { searchCities: vi.fn().mockResolvedValue([]), ...geocoder },
    },
    createMap: vi.fn((options) => {
      const map = { options, setPoints: vi.fn(), flyTo: vi.fn(), destroy: vi.fn() };
      maps.push(map);
      return map;
    }),
  };
  return { ctx, maps };
}

async function mount(ctx) {
  const view = await renderDiscover(ctx);
  document.body.replaceChildren(view);
  await vi.advanceTimersByTimeAsync(0);
  return view;
}

async function search(view, text) {
  const input = view.querySelector('input[type="search"]');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(300);
}

const rowKinds = (view) => [...view.querySelectorAll('.discover-panel-body .discover-row')].map((row) => row.dataset.kind);

beforeEach(() => {
  vi.useFakeTimers();
  resetDiscoverMemory();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('discover screen', () => {
  it('loads points for the normalized view and lists them', async () => {
    const { ctx, maps } = setup();
    const view = await mount(ctx);
    expect(maps).toHaveLength(1);
    expect(maps[0].options.view).toEqual({ lat: 20, lng: 0, zoom: 2 });
    maps[0].options.onMove(WORLD);
    await vi.advanceTimersByTimeAsync(250);
    expect(ctx.services.discover.points).toHaveBeenCalledWith({ minLat: -60, minLng: -180, maxLat: 80, maxLng: 180 });
    expect(maps[0].setPoints).toHaveBeenLastCalledWith([LISBON, GROUP]);
    expect(view.querySelector('.discover-summary').textContent).toBe('3 people · 1 group');
    expect(rowKinds(view)).toEqual(['city', 'group']);
    expect(view.textContent).toContain('Map images and city search come from OpenStreetMap.');
  });

  it('keeps only the newest view when responses arrive out of order', async () => {
    let releaseFirst;
    const points = vi.fn()
      .mockReturnValueOnce(new Promise((resolve) => { releaseFirst = resolve; }))
      .mockResolvedValueOnce([GROUP]);
    const { ctx, maps } = setup({ discover: { points } });
    await mount(ctx);
    maps[0].options.onMove(WORLD);
    await vi.advanceTimersByTimeAsync(250);
    maps[0].options.onMove({ ...WORLD, bounds: { minLat: 38, minLng: -10, maxLat: 39, maxLng: -9 } });
    await vi.advanceTimersByTimeAsync(250);
    releaseFirst([LISBON]);
    await vi.advanceTimersByTimeAsync(0);
    expect(maps[0].setPoints).toHaveBeenLastCalledWith([GROUP]);
    expect(maps[0].setPoints).not.toHaveBeenCalledWith([LISBON]);
  });

  it('collapses rapid moves into one request', async () => {
    const { ctx, maps } = setup();
    await mount(ctx);
    maps[0].options.onMove(WORLD);
    await vi.advanceTimersByTimeAsync(100);
    maps[0].options.onMove(WORLD);
    await vi.advanceTimersByTimeAsync(250);
    expect(ctx.services.discover.points).toHaveBeenCalledTimes(1);
  });

  it('lists a city’s people when its pin is chosen, then goes back', async () => {
    const { ctx, maps } = setup();
    const view = await mount(ctx);
    maps[0].options.onMove(WORLD);
    await vi.advanceTimersByTimeAsync(250);
    maps[0].options.onSelect(LISBON);
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.services.discover.cityPeople).toHaveBeenCalledWith({ city: 'Lisbon', region: 'Lisbon', country: 'Portugal' });
    expect(view.querySelector('.discover-panel-handle').getAttribute('aria-expanded')).toBe('true');
    const people = [...view.querySelectorAll('.discover-row[data-kind="person"] .discover-row-title')].map((node) => node.textContent);
    expect(people).toEqual(['Ana Silva (you)', 'Mestre Lua']);
    view.querySelector('.discover-row[data-profile-id="p2"]').click();
    expect(ctx.navigate).toHaveBeenCalledWith('/person/p2');
    [...view.querySelectorAll('button')].find((button) => button.textContent === '‹ Everything in view').click();
    expect(rowKinds(view)).toEqual(['city', 'group']);
  });

  it('opens group pins and group rows as group pages', async () => {
    const { ctx, maps } = setup();
    const view = await mount(ctx);
    maps[0].options.onSelect(GROUP);
    expect(ctx.navigate).toHaveBeenCalledWith('/group/g1');
    maps[0].options.onMove(WORLD);
    await vi.advanceTimersByTimeAsync(250);
    view.querySelector('.discover-row[data-kind="group"]').click();
    expect(ctx.navigate).toHaveBeenLastCalledWith('/group/g1');
  });

  it('remembers the map view when coming back', async () => {
    const first = setup();
    await mount(first.ctx);
    first.maps[0].options.onMove({ ...WORLD, view: { lat: 38.7, lng: -9.1, zoom: 11 } });
    const second = setup();
    await mount(second.ctx);
    expect(first.maps[0].destroy).toHaveBeenCalled();
    expect(second.maps[0].options.view).toEqual({ lat: 38.7, lng: -9.1, zoom: 11 });
  });

  it('centers on my city and hints when I have none', async () => {
    const withCity = setup({ mine: MY_LISBON });
    const view = await mount(withCity.ctx);
    expect(withCity.maps[0].options.view).toEqual({ lat: 38.72, lng: -9.14, zoom: 10 });
    expect(view.querySelector('.discover-add-city')).toBeNull();
    resetDiscoverMemory();
    const withoutCity = setup();
    const other = await mount(withoutCity.ctx);
    expect(other.querySelector('.discover-add-city a').getAttribute('href')).toBe('#/me/settings');
  });

  it('searches people, groups, and cities, and flies to a city', async () => {
    const { ctx, maps } = setup({ discover: { search: vi.fn().mockResolvedValue([
      { kind: 'city', profile_id: null, group_id: null, label: 'Lisbon', city: 'Lisbon', region: 'Lisbon', country: 'Portugal', lat: 38.72, lng: -9.14, person_count: 3 },
      { kind: 'person', profile_id: 'p2', group_id: null, label: 'Mestre Lua', city: 'Lisbon', region: 'Lisbon', country: 'Portugal', lat: 38.72, lng: -9.14, person_count: null },
      { kind: 'group', profile_id: null, group_id: 'g1', label: 'Grupo Lua', city: null, region: null, country: null, lat: null, lng: null, person_count: null },
    ]) } });
    const view = await mount(ctx);
    await search(view, 'l');
    expect(ctx.services.discover.search).not.toHaveBeenCalled();
    await search(view, 'lis');
    expect(ctx.services.discover.search).toHaveBeenCalledTimes(1);
    expect(ctx.services.discover.search).toHaveBeenCalledWith('lis', 20);
    expect([...view.querySelectorAll('.discover-results .discover-row')].map((row) => row.dataset.kind))
      .toEqual(['city', 'person', 'group', 'place']);
    view.querySelector('.discover-results .discover-row[data-kind="person"]').click();
    expect(ctx.navigate).toHaveBeenCalledWith('/person/p2');
    view.querySelector('.discover-results .discover-row[data-kind="city"]').click();
    expect(maps[0].flyTo).toHaveBeenCalledWith({ lat: 38.72, lng: -9.14, zoom: 11 });
    expect(ctx.services.discover.cityPeople).toHaveBeenCalled();
    expect(view.querySelector('.discover-results').hidden).toBe(true);
  });

  it('asks the geocoder only when "Find on the map" is tapped', async () => {
    const searchCities = vi.fn()
      .mockResolvedValueOnce([{ city: 'Salvador', region: 'Bahia', country: 'Brazil', lat: -12.97, lng: -38.5 }])
      .mockResolvedValueOnce([]);
    const { ctx, maps } = setup({ geocoder: { searchCities } });
    const view = await mount(ctx);
    await search(view, 'Salvador');
    expect(searchCities).not.toHaveBeenCalled();
    expect(view.textContent).toContain('No people, groups, or cities match.');
    view.querySelector('.discover-row[data-kind="place"]').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(searchCities).toHaveBeenCalledWith('Salvador');
    expect(maps[0].flyTo).toHaveBeenCalledWith({ lat: -12.97, lng: -38.5, zoom: 11 });
    await search(view, 'Xyzzy');
    view.querySelector('.discover-row[data-kind="place"]').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(view.textContent).toContain('No place found for “Xyzzy”.');
  });

  it('shows names from the server as text', async () => {
    const { ctx, maps } = setup({ discover: { points: vi.fn().mockResolvedValue([{ ...LISBON, city: '<img src=x onerror=alert(1)>' }]) } });
    const view = await mount(ctx);
    maps[0].options.onMove(WORLD);
    await vi.advanceTimersByTimeAsync(250);
    expect(view.querySelector('.discover-panel img')).toBeNull();
    expect(view.querySelector('.discover-row-title').textContent).toBe('<img src=x onerror=alert(1)> · 3');
  });

  it('offers a retry when points fail to load', async () => {
    const points = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([LISBON]);
    const { ctx, maps } = setup({ discover: { points } });
    const view = await mount(ctx);
    maps[0].options.onMove(WORLD);
    await vi.advanceTimersByTimeAsync(250);
    expect(view.textContent).toContain("We couldn't load the map. Try again.");
    [...view.querySelectorAll('button')].find((button) => button.textContent === 'Try again').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(rowKinds(view)).toEqual(['city']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/discover-screen.test.js`
Expected: FAIL — cannot find module `src/app/screens/discover.js`.

- [ ] **Step 3: Add the i18n keys**

Append to `en`:

```js
    'discover.search': 'Search people, groups, or cities',
    'discover.map': 'Map of people and groups',
    'discover.inView': 'In view',
    'discover.people.one': '{count} person',
    'discover.people.other': '{count} people',
    'discover.groups.one': '{count} group',
    'discover.groups.other': '{count} groups',
    'discover.empty': 'Nobody here yet. Zoom out or search for a city.',
    'discover.cityPeople': 'People in {city}',
    'discover.allInView': 'Everything in view',
    'discover.you': 'you',
    'discover.addCity': 'Add your city so people can find you.',
    'discover.addCityAction': 'Add your city',
    'discover.loadError': "We couldn't load the map. Try again.",
    'discover.noResults': 'No people, groups, or cities match.',
    'discover.findOnMap': 'Find “{text}” on the map',
    'discover.noPlaceFound': 'No place found for “{text}”.',
    'person.mode.train': 'Trains',
    'person.mode.both': 'Trains and teaches',
    'person.mode.teach': 'Teaches',
```

Append to `pt`:

```js
    'discover.search': 'Procurar pessoas, grupos ou cidades',
    'discover.map': 'Mapa de pessoas e grupos',
    'discover.inView': 'À vista',
    'discover.people.one': '{count} pessoa',
    'discover.people.other': '{count} pessoas',
    'discover.groups.one': '{count} grupo',
    'discover.groups.other': '{count} grupos',
    'discover.empty': 'Ainda ninguém aqui. Afasta o mapa ou procura uma cidade.',
    'discover.cityPeople': 'Pessoas em {city}',
    'discover.allInView': 'Tudo o que está à vista',
    'discover.you': 'tu',
    'discover.addCity': 'Adiciona a tua cidade para te poderem encontrar.',
    'discover.addCityAction': 'Adicionar cidade',
    'discover.loadError': 'Não foi possível carregar o mapa. Tenta novamente.',
    'discover.noResults': 'Nenhuma pessoa, grupo ou cidade corresponde.',
    'discover.findOnMap': 'Encontrar “{text}” no mapa',
    'discover.noPlaceFound': 'Nenhum lugar encontrado para “{text}”.',
    'person.mode.train': 'Treina',
    'person.mode.both': 'Treina e ensina',
    'person.mode.teach': 'Ensina',
```

- [ ] **Step 4: Implement the screen**

```js
// src/app/screens/discover.js
import { placeFromRow, placeLabel } from '../discover-rules.js';
import { el } from '../shell/page.js';
import { initialView, normalizeBounds, pinLabel, sortForPanel, summarize } from './discover-state.js';

let rememberedView = null;
let activeMap = null;

export function resetDiscoverMemory() {
  activeMap?.destroy();
  activeMap = null;
  rememberedView = null;
}

function counted(i18n, key, count) {
  return i18n.t(`${key}.${count === 1 ? 'one' : 'other'}`, { count });
}

export async function renderDiscover(ctx) {
  const { document, i18n, services } = ctx;
  activeMap?.destroy();
  activeMap = null;
  let myPlace = null;
  try {
    myPlace = placeFromRow(await services.discover.loadMine());
  } catch {
    myPlace = null;
  }

  let points = [];
  let panelMode = 'view';
  let map = null;
  let loadToken = 0;
  let searchToken = 0;
  let moveTimer = null;
  let searchTimer = null;

  const input = el(document, 'input', { className: 'field-input discover-search-input', attrs: {
    type: 'search', 'aria-label': i18n.t('discover.search'), placeholder: i18n.t('discover.search'),
    autocomplete: 'off', enterkeyhint: 'search',
  } });
  const results = el(document, 'div', { className: 'discover-results', attrs: { hidden: true } });
  const searchForm = el(document, 'form', { className: 'discover-search', attrs: { role: 'search' } }, [input, results]);
  const mapNode = el(document, 'div', { className: 'discover-map', attrs: { role: 'region', 'aria-label': i18n.t('discover.map') } });
  const summary = el(document, 'span', { className: 'discover-summary' });
  const handle = el(document, 'button', {
    className: 'discover-panel-handle', attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'discoverPanelBody' },
  }, [el(document, 'span', { className: 'sheet-grab', attrs: { 'aria-hidden': 'true' } }), summary]);
  const body = el(document, 'div', { className: 'discover-panel-body', attrs: { id: 'discoverPanelBody' } });
  const panel = el(document, 'section', { className: 'discover-panel', attrs: { 'aria-label': i18n.t('discover.inView') } }, [handle, body]);
  const privacy = el(document, 'p', { className: 'muted discover-privacy', text: i18n.t('discover.privacy') });
  const screen = el(document, 'section', { className: 'screen screen-discover' }, [
    el(document, 'h1', { className: 'visually-hidden', text: i18n.t('app.discover') }), searchForm, mapNode, panel,
  ]);

  function setExpanded(open) {
    handle.setAttribute('aria-expanded', String(open));
    panel.classList.toggle('expanded', open);
  }

  function row(title, detail, onClick, dataset = {}) {
    return el(document, 'button', { className: 'discover-row', attrs: { type: 'button' }, dataset, on: { click: onClick } }, [
      el(document, 'span', { className: 'discover-row-title', text: title }),
      detail ? el(document, 'span', { className: 'muted', text: detail }) : null,
    ]);
  }

  function updateSummary() {
    const totals = summarize(points);
    summary.textContent = `${counted(i18n, 'discover.people', totals.people)} · ${counted(i18n, 'discover.groups', totals.groups)}`;
  }

  function renderInView() {
    panelMode = 'view';
    updateSummary();
    const rows = sortForPanel(points).map((point) => (point.kind === 'city'
      ? row(pinLabel(point), placeLabel(point), () => showCity(point), { kind: 'city' })
      : row(point.name, point.location || placeLabel(point), () => ctx.navigate(`/group/${point.group_id}`),
        { kind: 'group', groupId: point.group_id })));
    const hint = myPlace ? null : el(document, 'p', { className: 'discover-add-city' }, [
      `${i18n.t('discover.addCity')} `,
      el(document, 'a', { text: i18n.t('discover.addCityAction'), attrs: { href: '#/me/settings' } }),
    ]);
    const empty = el(document, 'p', { className: 'muted', text: i18n.t('discover.empty') });
    body.replaceChildren(...[hint, ...(rows.length ? rows : [empty]), privacy].filter(Boolean));
  }

  async function showCity(point) {
    panelMode = 'city';
    setExpanded(true);
    const back = el(document, 'button', {
      className: 'quiet-button', text: `‹ ${i18n.t('discover.allInView')}`, attrs: { type: 'button' }, on: { click: renderInView },
    });
    body.replaceChildren(el(document, 'p', { className: 'muted', text: i18n.t('app.loading') }));
    let people;
    try {
      people = await services.discover.cityPeople({ city: point.city, region: point.region ?? null, country: point.country ?? null });
    } catch (error) {
      body.replaceChildren(el(document, 'p', { className: 'muted', text: error?.message || i18n.t('app.loadError') }), back, privacy);
      return;
    }
    if (panelMode !== 'city') return;
    body.replaceChildren(
      el(document, 'h2', { className: 'section-label', text: i18n.t('discover.cityPeople', { city: point.city }) }),
      ...people.map((person) => row(
        person.profile_id === ctx.profile.id ? `${person.display_name} (${i18n.t('discover.you')})` : person.display_name,
        i18n.t(`person.mode.${person.usage_mode ?? 'train'}`),
        () => ctx.navigate(`/person/${person.profile_id}`),
        { kind: 'person', profileId: person.profile_id },
      )),
      back, privacy,
    );
  }

  async function loadPoints(bounds) {
    const token = ++loadToken;
    try {
      const next = await services.discover.points(bounds);
      if (token !== loadToken) return;
      points = next;
      map?.setPoints(points);
      if (panelMode === 'view') renderInView();
      else updateSummary();
    } catch {
      if (token !== loadToken) return;
      panelMode = 'view';
      body.replaceChildren(
        el(document, 'p', { className: 'muted', text: i18n.t('discover.loadError') }),
        el(document, 'button', {
          className: 'secondary-button', text: i18n.t('app.retry'), attrs: { type: 'button' }, on: { click: () => loadPoints(bounds) },
        }),
        privacy,
      );
    }
  }

  function onMove({ bounds, view }) {
    rememberedView = view;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => { loadPoints(normalizeBounds(bounds)); }, 250);
  }

  function closeResults() {
    results.hidden = true;
    results.replaceChildren();
  }

  async function findPlace(text) {
    let places;
    try {
      places = await services.geocoder.searchCities(text);
    } catch {
      results.replaceChildren(el(document, 'p', { className: 'muted', text: i18n.t('geocoder.unavailable') }));
      return;
    }
    if (!places.length) {
      results.replaceChildren(el(document, 'p', { className: 'muted', text: i18n.t('discover.noPlaceFound', { text }) }));
      return;
    }
    closeResults();
    map?.flyTo({ lat: places[0].lat, lng: places[0].lng, zoom: 11 });
  }

  async function runSearch(text) {
    const token = ++searchToken;
    let rows = [];
    let failed = false;
    try {
      rows = await services.discover.search(text, 20);
    } catch {
      failed = true;
    }
    if (token !== searchToken) return;
    const items = rows.map((item) => {
      const detail = item.city ? placeLabel(item) : null;
      if (item.kind === 'person') {
        return row(item.label, detail, () => ctx.navigate(`/person/${item.profile_id}`), { kind: 'person', profileId: item.profile_id });
      }
      if (item.kind === 'group') {
        return row(item.label, detail, () => ctx.navigate(`/group/${item.group_id}`), { kind: 'group', groupId: item.group_id });
      }
      return row(`${item.label} · ${item.person_count}`, detail, () => {
        closeResults();
        map?.flyTo({ lat: Number(item.lat), lng: Number(item.lng), zoom: 11 });
        showCity(item);
      }, { kind: 'city' });
    });
    const empty = el(document, 'p', { className: 'muted', text: i18n.t(failed ? 'app.loadError' : 'discover.noResults') });
    results.replaceChildren(...(items.length ? items : [empty]),
      row(i18n.t('discover.findOnMap', { text }), null, () => findPlace(text), { kind: 'place' }));
    results.hidden = false;
  }

  handle.addEventListener('click', () => setExpanded(handle.getAttribute('aria-expanded') !== 'true'));
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const text = input.value.trim();
    if (text.length < 2) {
      searchToken += 1;
      closeResults();
      return;
    }
    searchTimer = setTimeout(() => { runSearch(text); }, 300);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    input.value = '';
    searchToken += 1;
    closeResults();
  });
  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    clearTimeout(searchTimer);
    const text = input.value.trim();
    if (text.length >= 2) runSearch(text);
  });

  renderInView();
  const view = initialView({ remembered: rememberedView, myPlace });
  setTimeout(() => {
    if (!mapNode.isConnected) return;
    map = ctx.createMap({
      container: mapNode,
      view,
      onMove,
      onSelect: (point) => (point.kind === 'group' ? ctx.navigate(`/group/${point.group_id}`) : showCity(point)),
    });
    activeMap = map;
    map.setPoints(points);
  }, 0);
  return screen;
}
```

- [ ] **Step 5: Route `#/discover` in `src/app/entries/app.js`**

```js
import { renderDiscover } from '../screens/discover.js';
```

Replace `case 'discover': return renderPlaceholder(ctx, { title: i18n.t('app.discover') });` with:

```js
      case 'discover': return renderDiscover(ctx, route);
```

In `tests/e2e/app-shell.spec.js`, the test "sends unknown routes to Today and placeholders to the classic dashboard" opens `#/discover` to find the classic-dashboard link; Discover is no longer a placeholder, so delete its two `#/discover` lines and rename the test to "sends unknown routes to Today" (skip if plan 2 already changed this test).

- [ ] **Step 6: Add the styles to `assets/app.css`**

```css
/* Discover map */
.screen-discover { position: fixed; top: env(safe-area-inset-top, 0px); left: 0; right: 0; bottom: calc(var(--tabbar) + var(--safe-bottom)); max-width: none; margin: 0; padding: 0; }
.discover-map { position: absolute; inset: 0; z-index: 0; isolation: isolate; background: #1f1912; }
.discover-search { position: absolute; z-index: 2; top: 12px; left: 12px; right: 12px; margin: 0; }
.discover-search-input { border-radius: 999px; background: var(--card-2); box-shadow: 0 6px 18px #0008; }
.discover-results { margin-top: 6px; max-height: 50vh; overflow: auto; background: var(--card-2); border: 1px solid var(--line); border-radius: 16px; padding: 4px 10px; }
.discover-panel { position: absolute; z-index: 2; left: 0; right: 0; bottom: 0; background: var(--card-2); border-radius: 20px 20px 0 0; box-shadow: 0 -10px 30px #0008; }
.discover-panel-handle { display: grid; justify-items: center; gap: 4px; width: 100%; border: 0; background: transparent; padding: 6px 16px 10px; cursor: pointer; }
.discover-panel-handle .sheet-grab { margin: 0; }
.discover-panel-body { display: none; max-height: 50vh; overflow: auto; padding: 0 16px 16px; }
.discover-panel.expanded .discover-panel-body { display: grid; gap: 4px; }
.discover-add-city { margin: 4px 0 8px; }
.discover-pin-icon { background: transparent; border: 0; }
.discover-pin { display: inline-block; transform: translate(-50%, -100%); white-space: nowrap; padding: 4px 10px; border-radius: 999px; font: 700 .75rem/1.2 var(--body); box-shadow: 0 3px 10px #0008; }
.discover-pin.city { background: var(--gold); color: var(--bg); }
.discover-pin.group { background: var(--teal); color: var(--bg); }
.screen-discover .leaflet-container { background: #1f1912; font: inherit; }
.screen-discover .leaflet-bottom.leaflet-right { bottom: 64px; }
.screen-discover .leaflet-control-attribution { background: #17120dcc; color: var(--sand); }
.screen-discover .leaflet-control-attribution a { color: var(--gold); }
@media (min-width: 900px) {
  .screen-discover { position: relative; top: auto; bottom: auto; height: 100vh; display: grid; grid-template-columns: 340px minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .discover-search { position: relative; top: auto; left: auto; right: auto; grid-column: 1; grid-row: 1; padding: 16px 16px 8px; }
  .discover-map { position: relative; inset: auto; grid-column: 2; grid-row: 1 / span 2; }
  .discover-panel { position: relative; grid-column: 1; grid-row: 2; border-radius: 0; box-shadow: none; overflow: auto; }
  .discover-panel-handle { pointer-events: none; justify-items: start; }
  .discover-panel-handle .sheet-grab { display: none; }
  .discover-panel-body { display: grid; gap: 4px; max-height: none; }
  .screen-discover .leaflet-bottom.leaflet-right { bottom: 0; }
  .app-panes:has(.app-detail:not(:empty)) .screen-discover { grid-template-columns: minmax(0, 1fr); }
  .app-panes:has(.app-detail:not(:empty)) .discover-panel { display: none; }
  .app-panes:has(.app-detail:not(:empty)) .discover-map { grid-column: 1; grid-row: 2; }
}
```

- [ ] **Step 7: Run tests and the build**

Run: `npx vitest run && npm run build:test`
Expected: PASS; the build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/app/screens/discover.js src/app/entries/app.js src/app/dashboard-i18n.js assets/app.css tests/unit/discover-screen.test.js tests/e2e/app-shell.spec.js
git commit -m "feat: add the Discover map with search and an in-view list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Person page and the Discover group card

**Files:**
- Create: `src/app/screens/discover-cards.js`
- Modify: `src/app/entries/app.js`, plan 2's `src/app/screens/group.js`, `src/app/testing/fake-services.js`, `src/app/dashboard-i18n.js`, `assets/app.css`
- Test: `tests/unit/discover-cards.test.js`

**Interfaces:**
- Consumes: `services.discover.person/group/pictureUrl` (Task 3; `group()` includes `my_request_id`), `services.group.requestAccess(groupId, 'member')` and `services.group.cancelJoinRequest(requestId)` (existing real service; the fake gains `cancelJoinRequest` here), `contactLinks` (Task 5), `placeLabel` (Task 3), `el`, `initials`, `pageHeader`, `ctx.back`.
- Consumes (plan 2): `src/app/screens/group.js` renders `#/group/<id>` for members, coaches, and owners and shows "This group isn't available." to everyone else (plan 2 Ruling R14).
- Produces:
  - `renderPerson(ctx, route) → Promise<HTMLElement>` (`section.screen-discover-card`): photo or initials, name (`h1`), "mode · city" line, a note on the person's own card (visibility plus a link to `#/me/settings`), "Trains in" and "Teaches in" group links (`#/group/<id>`, with owner/coach role), and contacts as safe links. "This person isn't available." for null, authorization, or validation errors (for example a malformed id).
  - `renderGroupCard(ctx, route) → Promise<HTMLElement>` — the Discover group card for people outside the group: picture or initials, name, place label (`location` or city), coaches linking to their cards, contacts, and the join action by `my_status`: `null` → "Ask to join" (disabled while sending; on success the card shows the pending state); `pending` → "Request sent. The group will reply." with "Cancel request" (cancels `my_request_id`, then shows "Ask to join" again); `member`/`coach`/`owner` → "You're in this group." "This group isn't available." when `discover_group` returns null.
  - Fake group service: `cancelJoinRequest(requestId) → { status: 'cancelled' }`.
  - Routes: `#/person/<id>` renders `renderPerson`; plan 2's `#/group/<id>` renders `renderGroupCard` in its non-member branch. On desktop, both open from Discover in the right-hand detail pane and keep the map in the main pane (Ruling 16).

Rulings 11, 12, and 19 apply.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/discover-cards.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { renderGroupCard, renderPerson } from '../../src/app/screens/discover-cards.js';

const PERSON = {
  profile_id: 'p2', display_name: 'Mestre Lua', avatar_path: 'p2/a.jpg', usage_mode: 'teach',
  city: 'Lisbon', region: 'Lisbon', country: 'Portugal', is_self: false, visibility: null,
  contacts: { instagram: 'mestrelua', website: 'javascript:alert(1)' },
  trains_in: [], teaches: [{ group_id: 'g1', name: 'Grupo Lua', role: 'owner' }],
};
const GROUP = {
  group_id: 'g1', name: 'Grupo Lua', picture_path: null, location: 'Arroios, Lisbon', city: 'Lisbon', region: 'Lisbon',
  country: 'Portugal', lat: 38.73, lng: -9.13, is_discoverable: true, contacts: { email: 'ola@grupolua.example' },
  coaches: [{ profile_id: 'p2', display_name: 'Mestre Lua', is_owner: true }], my_status: null, my_request_id: null,
};

function ctx({ discover = {}, group = {} } = {}) {
  const values = new Map([['roda.dashboard.locale', 'en']]);
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  return {
    document,
    i18n: createDashboardI18n({ document, storage, navigator: { languages: ['en'] } }),
    profile: { id: 'me', display_name: 'Ana Silva' },
    back: vi.fn(),
    services: {
      discover: {
        person: vi.fn().mockResolvedValue(PERSON), group: vi.fn().mockResolvedValue(GROUP),
        pictureUrl: vi.fn().mockResolvedValue(null), ...discover,
      },
      group: {
        requestAccess: vi.fn().mockResolvedValue({ status: 'pending', request_id: 'r1' }),
        cancelJoinRequest: vi.fn().mockResolvedValue({ status: 'cancelled' }),
        ...group,
      },
    },
  };
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const button = (view, text) => [...view.querySelectorAll('button')].find((node) => node.textContent === text);

describe('person page', () => {
  it('shows a card with safe contacts and group links', async () => {
    const context = ctx({ discover: { pictureUrl: vi.fn().mockResolvedValue('https://cdn.example/p2.jpg') } });
    const view = await renderPerson(context, { params: { id: 'p2' } });
    expect(context.services.discover.person).toHaveBeenCalledWith('p2');
    expect(view.querySelector('h1').textContent).toBe('Mestre Lua');
    expect(view.textContent).toContain('Teaches · Lisbon, Portugal');
    expect(view.querySelector('.discover-avatar img').getAttribute('src')).toBe('https://cdn.example/p2.jpg');
    expect(context.services.discover.pictureUrl).toHaveBeenCalledWith('profile', 'p2/a.jpg');
    expect(view.querySelector('a[href="#/group/g1"]').textContent).toBe('Grupo Lua');
    expect(view.textContent).toContain('owner');
    expect([...view.querySelectorAll('.discover-contact-list a')].map((link) => link.getAttribute('href')))
      .toEqual(['https://www.instagram.com/mestrelua/']);
    expect(view.querySelector('.discover-contact-list a').getAttribute('rel')).toBe('noopener noreferrer nofollow');
  });

  it.each([
    ['missing', () => vi.fn().mockResolvedValue(null)],
    ['malformed', () => vi.fn().mockRejectedValue(Object.assign(new Error('bad'), { kind: 'validation' }))],
  ])('says a %s card is not available and goes back to Discover', async (_name, makePerson) => {
    const context = ctx({ discover: { person: makePerson() } });
    const view = await renderPerson(context, { params: { id: 'x' } });
    expect(view.textContent).toContain("This person isn't available.");
    view.querySelector('.page-back').click();
    expect(context.back).toHaveBeenCalledWith('/discover');
  });

  it('reminds a hidden person that only they see their card', async () => {
    const context = ctx({ discover: { person: vi.fn().mockResolvedValue({
      ...PERSON, profile_id: 'me', display_name: 'Ana Silva', is_self: true, visibility: 'nobody', contacts: {}, teaches: [],
    }) } });
    const view = await renderPerson(context, { params: { id: 'me' } });
    expect(view.textContent).toContain('Only you can see your card.');
    expect(view.querySelector('.discover-self a').getAttribute('href')).toBe('#/me/settings');
    expect(view.querySelector('.discover-contact-list')).toBeNull();
  });
});

describe('group card', () => {
  it('shows coaches and contacts and asks to join once', async () => {
    const context = ctx();
    const view = await renderGroupCard(context, { params: { id: 'g1' } });
    document.body.replaceChildren(view);
    expect(view.querySelector('h1').textContent).toBe('Grupo Lua');
    expect(view.textContent).toContain('Arroios, Lisbon');
    expect(view.querySelector('a[href="#/person/p2"]').textContent).toBe('Mestre Lua');
    expect(view.querySelector('a[href="mailto:ola@grupolua.example"]')).not.toBeNull();
    const join = button(view, 'Ask to join');
    join.click();
    join.click();
    await flush();
    expect(context.services.group.requestAccess).toHaveBeenCalledTimes(1);
    expect(context.services.group.requestAccess).toHaveBeenCalledWith('g1', 'member');
    expect(view.textContent).toContain('Request sent. The group will reply.');
    expect(button(view, 'Ask to join')).toBeUndefined();
    expect(button(view, 'Cancel request')).toBeDefined();
  });

  it('keeps the button when the request fails', async () => {
    const context = ctx({ group: { requestAccess: vi.fn().mockRejectedValue(new Error('You do not have permission to do that.')) } });
    const view = await renderGroupCard(context, { params: { id: 'g1' } });
    const join = button(view, 'Ask to join');
    join.click();
    await flush();
    expect(join.disabled).toBe(false);
    expect(view.textContent).toContain('You do not have permission to do that.');
  });

  it('cancels a pending request', async () => {
    const context = ctx({ discover: { group: vi.fn().mockResolvedValue({ ...GROUP, my_status: 'pending', my_request_id: 'r9' }) } });
    const view = await renderGroupCard(context, { params: { id: 'g1' } });
    expect(view.textContent).toContain('Request sent. The group will reply.');
    button(view, 'Cancel request').click();
    await flush();
    expect(context.services.group.cancelJoinRequest).toHaveBeenCalledWith('r9');
    expect(button(view, 'Ask to join')).toBeDefined();
  });

  it.each(['member', 'coach', 'owner'])('tells a %s they are in the group', async (status) => {
    const view = await renderGroupCard(ctx({ discover: { group: vi.fn().mockResolvedValue({ ...GROUP, my_status: status }) } }), { params: { id: 'g1' } });
    expect(view.textContent).toContain("You're in this group.");
    expect(button(view, 'Ask to join')).toBeUndefined();
  });

  it('says when a group is not available', async () => {
    const view = await renderGroupCard(ctx({ discover: { group: vi.fn().mockResolvedValue(null) } }), { params: { id: 'g9' } });
    expect(view.textContent).toContain("This group isn't available.");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/discover-cards.test.js`
Expected: FAIL — cannot find module `discover-cards.js`.

- [ ] **Step 3: Add the i18n keys**

Append to `en`:

```js
    'person.unavailable': "This person isn't available.",
    'person.trainsIn': 'Trains in',
    'person.teaches': 'Teaches in',
    'person.owner': 'owner',
    'person.coach': 'coach',
    'person.contacts': 'Contacts',
    'person.hiddenSelf': 'Only you can see your card.',
    'person.visibleSelf.everyone': 'Everyone can find your card.',
    'person.visibleSelf.signed_in': 'Signed-in people can find your card.',
    'person.editSelf': 'Change in Settings',
    'contact.instagram': 'Instagram',
    'contact.website': 'Website',
    'contact.whatsapp': 'WhatsApp',
    'contact.email': 'Email',
    'groupCard.unavailable': "This group isn't available.",
    'groupCard.coaches': 'Coaches',
    'groupCard.join': 'Ask to join',
    'groupCard.requested': 'Request sent. The group will reply.',
    'groupCard.cancel': 'Cancel request',
    'groupCard.member': "You're in this group.",
```

Append to `pt`:

```js
    'person.unavailable': 'Esta pessoa não está disponível.',
    'person.trainsIn': 'Treina em',
    'person.teaches': 'Ensina em',
    'person.owner': 'responsável',
    'person.coach': 'treinador',
    'person.contacts': 'Contactos',
    'person.hiddenSelf': 'Só tu vês o teu cartão.',
    'person.visibleSelf.everyone': 'Toda a gente pode encontrar o teu cartão.',
    'person.visibleSelf.signed_in': 'Quem tem sessão iniciada pode encontrar o teu cartão.',
    'person.editSelf': 'Mudar nas Definições',
    'contact.instagram': 'Instagram',
    'contact.website': 'Site',
    'contact.whatsapp': 'WhatsApp',
    'contact.email': 'Email',
    'groupCard.unavailable': 'Este grupo não está disponível.',
    'groupCard.coaches': 'Treinadores',
    'groupCard.join': 'Pedir para entrar',
    'groupCard.requested': 'Pedido enviado. O grupo vai responder.',
    'groupCard.cancel': 'Cancelar pedido',
    'groupCard.member': 'Fazes parte deste grupo.',
```

(If plan 2 already defines any of these exact keys with the same meaning, keep plan 2's entry and skip the duplicate; the i18n parity test fails on missing keys, not on reuse.)

- [ ] **Step 4: Implement the cards**

```js
// src/app/screens/discover-cards.js
import { placeLabel } from '../discover-rules.js';
import { el, initials, pageHeader } from '../shell/page.js';
import { contactLinks } from './discover-state.js';

async function avatar(ctx, kind, path, name) {
  const node = el(ctx.document, 'div', { className: 'me-avatar discover-avatar', text: initials(name), attrs: { 'aria-hidden': 'true' } });
  if (path) {
    const url = await ctx.services.discover.pictureUrl(kind, path).catch(() => null);
    if (url) node.replaceChildren(el(ctx.document, 'img', { attrs: { src: url, alt: '' } }));
  }
  return node;
}

function contactList(ctx, contacts) {
  const { document, i18n } = ctx;
  const links = contactLinks(contacts ?? {});
  if (!links.length) return null;
  return el(document, 'section', { className: 'discover-contacts' }, [
    el(document, 'h2', { className: 'section-label', text: i18n.t('person.contacts') }),
    el(document, 'ul', { className: 'discover-contact-list' }, links.map((link) => el(document, 'li', {}, [
      el(document, 'span', { className: 'muted', text: `${i18n.t(`contact.${link.kind}`)} ` }),
      el(document, 'a', { text: link.text, attrs: {
        href: link.href, target: link.kind === 'email' ? null : '_blank', rel: 'noopener noreferrer nofollow',
      } }),
    ]))),
  ]);
}

function groupLinks(ctx, groups, withRole) {
  return el(ctx.document, 'ul', { className: 'discover-group-list' }, groups.map((group) => el(ctx.document, 'li', {}, [
    el(ctx.document, 'a', { text: group.name, attrs: { href: `#/group/${group.group_id}` } }),
    withRole ? el(ctx.document, 'span', { className: 'muted', text: ` · ${ctx.i18n.t(`person.${group.role}`)}` }) : null,
  ])));
}

function shell(ctx, back, children) {
  return el(ctx.document, 'section', { className: 'screen screen-discover-card' }, [
    pageHeader({ document: ctx.document, title: '', backLabel: ctx.i18n.t('app.back'), onBack: back }), ...children,
  ]);
}

function unavailable(ctx, key, back) {
  return shell(ctx, back, [el(ctx.document, 'p', { className: 'muted', text: ctx.i18n.t(key) })]);
}

async function load(loader) {
  try {
    return { value: await loader() };
  } catch (error) {
    return { error };
  }
}

const isGone = (error) => !error || error.kind === 'validation' || error.kind === 'authorization';

export async function renderPerson(ctx, route) {
  const { document, i18n } = ctx;
  const back = () => ctx.back('/discover');
  const { value: person, error } = await load(() => ctx.services.discover.person(route.params.id));
  if (!person) return unavailable(ctx, isGone(error) ? 'person.unavailable' : 'app.loadError', back);
  const meta = [i18n.t(`person.mode.${person.usage_mode ?? 'train'}`), person.city ? placeLabel(person) : null]
    .filter(Boolean).join(' · ');
  const children = [
    el(document, 'div', { className: 'me-top' }, [
      await avatar(ctx, 'profile', person.avatar_path, person.display_name),
      el(document, 'div', {}, [
        el(document, 'h1', { className: 'page-title', text: person.display_name }),
        el(document, 'p', { className: 'muted', text: meta }),
      ]),
    ]),
  ];
  if (person.is_self) {
    const key = person.visibility === 'nobody' ? 'person.hiddenSelf' : `person.visibleSelf.${person.visibility}`;
    children.push(el(document, 'p', { className: 'card discover-self' }, [
      `${i18n.t(key)} `, el(document, 'a', { text: i18n.t('person.editSelf'), attrs: { href: '#/me/settings' } }),
    ]));
  }
  if (person.trains_in?.length) {
    children.push(el(document, 'h2', { className: 'section-label', text: i18n.t('person.trainsIn') }), groupLinks(ctx, person.trains_in, false));
  }
  if (person.teaches?.length) {
    children.push(el(document, 'h2', { className: 'section-label', text: i18n.t('person.teaches') }), groupLinks(ctx, person.teaches, true));
  }
  children.push(contactList(ctx, person.contacts));
  return shell(ctx, back, children.filter(Boolean));
}

export async function renderGroupCard(ctx, route) {
  const { document, i18n } = ctx;
  const back = () => ctx.back('/discover');
  const { value: group, error } = await load(() => ctx.services.discover.group(route.params.id));
  if (!group) return unavailable(ctx, isGone(error) ? 'groupCard.unavailable' : 'app.loadError', back);
  let requestId = group.my_request_id ?? null;
  const status = el(document, 'p', { className: 'muted discover-join-status', attrs: { role: 'status' } });
  const actions = el(document, 'div', { className: 'discover-join' });

  function showJoin() {
    const join = el(document, 'button', { className: 'button-primary', text: i18n.t('groupCard.join'), attrs: { type: 'button' } });
    join.addEventListener('click', async () => {
      if (join.disabled) return;
      join.disabled = true;
      try {
        const result = await ctx.services.group.requestAccess(group.group_id, 'member');
        requestId = result?.request_id ?? requestId;
        showPending();
      } catch (requestError) {
        join.disabled = false;
        status.textContent = requestError?.message || i18n.t('app.loadError');
      }
    });
    status.textContent = '';
    actions.replaceChildren(join);
  }

  function showPending() {
    status.textContent = i18n.t('groupCard.requested');
    const cancel = el(document, 'button', { className: 'button-secondary', text: i18n.t('groupCard.cancel'), attrs: { type: 'button' } });
    cancel.addEventListener('click', async () => {
      if (cancel.disabled || !requestId) return;
      cancel.disabled = true;
      try {
        await ctx.services.group.cancelJoinRequest(requestId);
        requestId = null;
        showJoin();
      } catch (cancelError) {
        cancel.disabled = false;
        status.textContent = cancelError?.message || i18n.t('app.loadError');
      }
    });
    actions.replaceChildren(...(requestId ? [cancel] : []));
  }

  if (group.my_status === 'pending') showPending();
  else if (group.my_status) status.textContent = i18n.t('groupCard.member');
  else showJoin();

  const children = [
    el(document, 'div', { className: 'me-top' }, [
      await avatar(ctx, 'group', group.picture_path, group.name),
      el(document, 'div', {}, [
        el(document, 'h1', { className: 'page-title', text: group.name }),
        el(document, 'p', { className: 'muted', text: group.location || (group.city ? placeLabel(group) : '') }),
      ]),
    ]),
  ];
  if (group.coaches?.length) {
    children.push(
      el(document, 'h2', { className: 'section-label', text: i18n.t('groupCard.coaches') }),
      el(document, 'ul', { className: 'discover-group-list' }, group.coaches.map((coach) => el(document, 'li', {}, [
        el(document, 'a', { text: coach.display_name, attrs: { href: `#/person/${coach.profile_id}` } }),
        coach.is_owner ? el(document, 'span', { className: 'muted', text: ` · ${i18n.t('person.owner')}` }) : null,
      ]))),
    );
  }
  children.push(contactList(ctx, group.contacts), actions, status);
  return shell(ctx, back, children.filter(Boolean));
}
```

- [ ] **Step 5: Add `cancelJoinRequest` to the fake group service**

In `createE2EGroupService` in `src/app/testing/fake-services.js`, after `requestAccess`, add:

```js
    async cancelJoinRequest(requestId) {
      const state = readState();
      const request = Object.values(state.joinRequests).flat().find(({ id }) => id === requestId);
      if (!request || request.profile_id !== 'practitioner-1') throw new AppError('authorization', 'not_authorized');
      request.state = 'cancelled';
      writeState(state);
      record({ type: 'cancel-request', requestId });
      return { status: 'cancelled', request_id: requestId };
    },
```

- [ ] **Step 6: Route the person page, use the card in the group page, and keep the map beside them on desktop**

In `src/app/entries/app.js`:

```js
import { renderPerson } from '../screens/discover-cards.js';
```

Add to the `switch` in `screenFor`:

```js
      case 'person': return renderPerson(ctx, route);
```

In `show(route)`, replace `const sideBySide = desktop.matches && route.name === 'training';` with:

```js
    const besideDiscover = (route.name === 'person' || route.name === 'group') && lastTopLevel.name === 'discover';
    const sideBySide = desktop.matches && (route.name === 'training' || besideDiscover);
```

In plan 2's `src/app/screens/group.js`, import the card and return it where the page currently shows "This group isn't available." to someone who is not a member (plan 2 Ruling R14):

```js
import { renderGroupCard } from './discover-cards.js';
```

```js
  // Not a member, coach, or owner: show the Discover card (with request to join) instead.
  if (!membership) return renderGroupCard(ctx, route);
```

(`membership` stands for the value plan 2's `group.js` uses to decide that branch; keep plan 2's name. Plan 2's group tests that asserted the "isn't available" text for outsiders now need `services.discover.group` mocked: return `null` to keep that assertion, since the card shows "This group isn't available." for null.)

- [ ] **Step 7: Add the styles to `assets/app.css`**

```css
/* Person and group cards */
.discover-avatar { overflow: hidden; flex: none; }
.discover-avatar img { width: 100%; height: 100%; object-fit: cover; }
.discover-group-list, .discover-contact-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.discover-self { margin: 8px 0 12px; }
.discover-join-status:empty { display: none; }
```

- [ ] **Step 8: Run tests and the build**

Run: `npx vitest run && npm run build:test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/screens/discover-cards.js src/app/screens/group.js src/app/entries/app.js src/app/testing/fake-services.js src/app/dashboard-i18n.js assets/app.css tests/unit
git commit -m "feat: add the Discover person page and group card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Group owners' place and contacts, and requests I sent

**Files:**
- Create: `src/app/screens/group-discover-form.js`, `src/app/screens/sent-requests.js`
- Modify: plan 2's `src/app/screens/group-owner.js` and `src/app/screens/groups.js`, `src/app/testing/fake-services.js`, `src/app/dashboard-i18n.js`
- Test: `tests/unit/group-discover-form.test.js`, `tests/unit/sent-requests.test.js`

**Interfaces:**
- Consumes: `createCityPicker`, `createContactFields`, `errorText` (Task 6); `services.discover.loadGroup/updateGroup` (Task 3); `contactsFromRow`, `fieldErrors`, `normalizePlace`, `placeFromRow`, `validateContacts` (Task 3); `services.group.listMyJoinRequests()` (existing real service: rows `{ id, group_id, state, expires_at, group: { id, name, location } }`) and `services.group.cancelJoinRequest(requestId)` (Task 8).
- Consumes (plan 2): `group-owner.js` renders the owner tools on `#/group/<id>` with the group's `id` and `owner_id`; `groups.js` renders `#/me/groups`. Plan 2 Ruling R16 hands "join requests I sent (list and cancel)" to this plan.
- Produces:
  - `renderGroupDiscoverForm(ctx, groupId) → Promise<HTMLElement|null>` — `section.group-discover` with the city picker, Instagram/website/email fields (no WhatsApp), Save (`data-action="save-group-discover"`), and a note when the group is not discoverable; `null` when the caller does not own the group.
  - `renderSentRequests(ctx) → Promise<HTMLElement|null>` — `section.sent-requests` listing pending, unexpired requests (group name linking to `#/group/<id>` and a "Cancel request" button each); `null` when there are none.
  - Fake group service: `listMyJoinRequests()` in the real row shape.
  - i18n keys `groupDiscover.*`, `sentRequests.*`.

Ruling 13 applies: owner only, and an undiscoverable group keeps its place but shows no pin.

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/group-discover-form.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { renderGroupDiscoverForm } from '../../src/app/screens/group-discover-form.js';

const GROUP = {
  id: 'g1', owner_id: 'p1', name: 'Roda da Lua', is_discoverable: true,
  place_city: 'Lisbon', place_region: 'Lisbon', place_country: 'Portugal', place_lat: 38.72, place_lng: -9.14,
  contact_instagram: 'rodadalua', contact_website: null, contact_email: null,
};

function ctx(group = GROUP, discover = {}) {
  const values = new Map([['roda.dashboard.locale', 'en']]);
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  return {
    document,
    i18n: createDashboardI18n({ document, storage, navigator: { languages: ['en'] } }),
    profile: { id: 'p1', display_name: 'Ana Silva' },
    services: {
      discover: { loadGroup: vi.fn().mockResolvedValue(group), updateGroup: vi.fn().mockResolvedValue({ status: 'updated' }), ...discover },
      geocoder: { searchCities: vi.fn().mockResolvedValue([]), reverse: vi.fn() },
    },
  };
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('group Discover form', () => {
  it('lets the owner change the place and contacts', async () => {
    const context = ctx();
    const form = await renderGroupDiscoverForm(context, 'g1');
    document.body.replaceChildren(form);
    expect(context.services.discover.loadGroup).toHaveBeenCalledWith('g1');
    expect(form.querySelector('.discover-city-current').textContent).toBe('Lisbon, Portugal');
    expect(form.querySelector('input[name="whatsapp"]')).toBeNull();
    expect(form.querySelector('input[name="instagram"]').value).toBe('rodadalua');
    form.querySelector('input[name="email"]').value = 'ola@lua.example';
    form.querySelector('button[data-action="save-group-discover"]').click();
    await flush();
    expect(context.services.discover.updateGroup).toHaveBeenCalledWith('g1', {
      place: { city: 'Lisbon', region: 'Lisbon', country: 'Portugal', lat: 38.72, lng: -9.14 },
      contacts: { instagram: 'rodadalua', website: null, whatsapp: null, email: 'ola@lua.example' },
    });
    expect(form.textContent).toContain('Saved.');
  });

  it('removes the place when the owner clears the city', async () => {
    const context = ctx();
    const form = await renderGroupDiscoverForm(context, 'g1');
    [...form.querySelectorAll('button')].find((button) => button.textContent === 'Remove city').click();
    form.querySelector('button[data-action="save-group-discover"]').click();
    await flush();
    expect(context.services.discover.updateGroup.mock.lastCall[1].place).toBeNull();
  });

  it('says when the group stays off the map', async () => {
    const form = await renderGroupDiscoverForm(ctx({ ...GROUP, is_discoverable: false }), 'g1');
    expect(form.textContent).toContain("This group isn't discoverable, so it stays off the map");
  });

  it('blocks an invalid website and shows server rejections', async () => {
    const rejection = Object.assign(new Error('x'), { kind: 'validation', code: 'invalid_email' });
    const context = ctx(GROUP, { updateGroup: vi.fn().mockRejectedValue(rejection) });
    const form = await renderGroupDiscoverForm(context, 'g1');
    document.body.replaceChildren(form);
    form.querySelector('input[name="website"]').value = 'http://lua.example';
    form.querySelector('button[data-action="save-group-discover"]').click();
    await flush();
    expect(context.services.discover.updateGroup).not.toHaveBeenCalled();
    expect(form.textContent).toContain('Use a full address starting with https://.');
    form.querySelector('input[name="website"]').value = '';
    form.querySelector('input[name="email"]').value = 'ola@lua.example';
    form.querySelector('button[data-action="save-group-discover"]').click();
    await flush();
    expect(form.querySelector('input[name="email"]').getAttribute('aria-invalid')).toBe('true');
  });

  it('renders nothing for someone who does not own the group', async () => {
    await expect(renderGroupDiscoverForm(ctx({ ...GROUP, owner_id: 'someone' }), 'g1')).resolves.toBeNull();
  });
});
```

```js
// tests/unit/sent-requests.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { renderSentRequests } from '../../src/app/screens/sent-requests.js';

const PENDING = { id: 'r1', group_id: 'g1', state: 'pending', expires_at: '2099-01-01T00:00:00Z', group: { id: 'g1', name: 'Grupo Lua', location: 'Lisbon' } };

function ctx(rows, cancelJoinRequest = vi.fn().mockResolvedValue({ status: 'cancelled' })) {
  const values = new Map([['roda.dashboard.locale', 'en']]);
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  return {
    document,
    i18n: createDashboardI18n({ document, storage, navigator: { languages: ['en'] } }),
    now: () => new Date('2026-10-20T12:00:00Z'),
    services: { group: { listMyJoinRequests: vi.fn().mockResolvedValue(rows), cancelJoinRequest } },
  };
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('requests I sent', () => {
  it('lists pending requests and cancels one', async () => {
    const context = ctx([PENDING, { ...PENDING, id: 'r2', state: 'declined' }, { ...PENDING, id: 'r3', expires_at: '2026-01-01T00:00:00Z' }]);
    const view = await renderSentRequests(context);
    expect([...view.querySelectorAll('a')].map((link) => [link.textContent, link.getAttribute('href')])).toEqual([['Grupo Lua', '#/group/g1']]);
    view.querySelector('button').click();
    await flush();
    expect(context.services.group.cancelJoinRequest).toHaveBeenCalledWith('r1');
    expect(view.querySelector('li')).toBeNull();
    expect(view.textContent).toContain('Request canceled.');
  });

  it('renders nothing without pending requests', async () => {
    await expect(renderSentRequests(ctx([]))).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/group-discover-form.test.js tests/unit/sent-requests.test.js`
Expected: FAIL — cannot find the modules.

- [ ] **Step 3: Add the i18n keys**

Append to `en`:

```js
    'groupDiscover.title': 'On the Discover map',
    'groupDiscover.place': 'Group city',
    'groupDiscover.hidden': "This group isn't discoverable, so it stays off the map until you make it discoverable.",
    'sentRequests.title': 'Requests you sent',
    'sentRequests.canceled': 'Request canceled.',
```

Append to `pt`:

```js
    'groupDiscover.title': 'No mapa Descobrir',
    'groupDiscover.place': 'Cidade do grupo',
    'groupDiscover.hidden': 'Este grupo não é público, por isso fica fora do mapa até o tornares público.',
    'sentRequests.title': 'Pedidos que enviaste',
    'sentRequests.canceled': 'Pedido cancelado.',
```

- [ ] **Step 4: Implement the form and the list**

```js
// src/app/screens/group-discover-form.js
import { contactsFromRow, fieldErrors, normalizePlace, placeFromRow, validateContacts } from '../discover-rules.js';
import { el } from '../shell/page.js';
import { createCityPicker, createContactFields, errorText } from './discover-settings.js';

export async function renderGroupDiscoverForm(ctx, groupId) {
  const { document, i18n } = ctx;
  let group;
  try {
    group = await ctx.services.discover.loadGroup(groupId);
  } catch (error) {
    return el(document, 'section', { className: 'group-discover' }, [el(document, 'p', { className: 'muted', text: errorText(i18n, error) })]);
  }
  if (!group || group.owner_id !== ctx.profile.id) return null;
  let place = placeFromRow(group);
  const city = createCityPicker(ctx, { value: place, onChange: (next) => { place = next; } });
  const contacts = createContactFields(ctx, { values: contactsFromRow(group), fields: ['instagram', 'website', 'email'] });
  const status = el(document, 'p', { className: 'muted', attrs: { role: 'status' } });
  const save = el(document, 'button', {
    className: 'button-primary', text: i18n.t('discoverSettings.save'), attrs: { type: 'button' }, dataset: { action: 'save-group-discover' },
  });
  save.addEventListener('click', async () => {
    const values = contacts.read();
    const errors = validateContacts(values);
    contacts.showErrors(errors);
    if (Object.keys(errors).length) {
      status.textContent = '';
      contacts.focusFirstError(errors);
      return;
    }
    save.disabled = true;
    status.textContent = i18n.t('log.saving');
    try {
      await ctx.services.discover.updateGroup(groupId, { place: normalizePlace(place), contacts: values });
      status.textContent = i18n.t('discoverSettings.saved');
    } catch (error) {
      contacts.showErrors(fieldErrors(error));
      status.textContent = errorText(i18n, error);
    } finally {
      save.disabled = false;
    }
  });
  return el(document, 'section', { className: 'group-discover', dataset: { groupId } }, [
    el(document, 'h2', { className: 'section-label', text: i18n.t('groupDiscover.title') }),
    group.is_discoverable ? null : el(document, 'p', { className: 'muted', text: i18n.t('groupDiscover.hidden') }),
    el(document, 'h3', { className: 'field-label', text: i18n.t('groupDiscover.place') }),
    city.element, contacts.element, save, status,
  ]);
}
```

```js
// src/app/screens/sent-requests.js
import { el } from '../shell/page.js';

export async function renderSentRequests(ctx) {
  const { document, i18n } = ctx;
  let rows;
  try {
    rows = await ctx.services.group.listMyJoinRequests();
  } catch {
    return null;
  }
  const now = ctx.now?.() ?? new Date();
  const pending = rows.filter((row) => row.state === 'pending' && new Date(row.expires_at) > now);
  if (!pending.length) return null;
  const status = el(document, 'p', { className: 'muted', attrs: { role: 'status' } });
  const list = el(document, 'ul', { className: 'discover-group-list' });
  for (const row of pending) {
    const cancel = el(document, 'button', { className: 'quiet-button', text: i18n.t('groupCard.cancel'), attrs: { type: 'button' } });
    const item = el(document, 'li', { className: 'sent-request' }, [
      el(document, 'a', { text: row.group?.name ?? '', attrs: { href: `#/group/${row.group_id}` } }), ' ', cancel,
    ]);
    cancel.addEventListener('click', async () => {
      if (cancel.disabled) return;
      cancel.disabled = true;
      try {
        await ctx.services.group.cancelJoinRequest(row.id);
        item.remove();
        status.textContent = i18n.t('sentRequests.canceled');
      } catch (error) {
        cancel.disabled = false;
        status.textContent = error?.message || i18n.t('app.loadError');
      }
    });
    list.append(item);
  }
  return el(document, 'section', { className: 'sent-requests' }, [
    el(document, 'h2', { className: 'section-label', text: i18n.t('sentRequests.title') }), list, status,
  ]);
}
```

- [ ] **Step 5: Add `listMyJoinRequests` to the fake group service**

In `createE2EGroupService`, after `cancelJoinRequest`, add:

```js
    async listMyJoinRequests() {
      const state = readState();
      const known = [...state.groups, ...E2E_DISCOVER_GROUPS];
      return Object.entries(state.joinRequests).flatMap(([groupId, requests]) => requests
        .filter(({ profile_id: id }) => id === 'practitioner-1')
        .map((request) => {
          const group = known.find(({ id }) => id === groupId);
          return {
            id: request.id, group_id: groupId, profile_id: request.profile_id, requested_access: request.requested_access,
            state: request.state, expires_at: request.expires_at ?? '2099-01-01T00:00:00Z', decided_at: null,
            created_at: request.created_at ?? null,
            group: group ? { id: group.id, slug: group.slug ?? group.id, name: group.name, picture_path: group.picture_path ?? null, location: group.location ?? null } : null,
          };
        }));
    },
```

- [ ] **Step 6: Wire both into plan 2's screens**

In `src/app/screens/group-owner.js` (owner tools on `#/group/<id>`):

```js
import { renderGroupDiscoverForm } from './group-discover-form.js';
```

After the existing owner sections, append (using plan 2's container variable for the owner tools):

```js
  const discoverForm = await renderGroupDiscoverForm(ctx, group.id);
  if (discoverForm) tools.append(discoverForm);
```

In `src/app/screens/groups.js` (`#/me/groups`):

```js
import { renderSentRequests } from './sent-requests.js';
```

After the list of the person's groups, append:

```js
  const sent = await renderSentRequests(ctx);
  if (sent) screen.append(sent);
```

(`tools` and `screen` stand for plan 2's own element names in those functions.) Plan 2's unit tests for these screens gain `services.discover = { loadGroup: vi.fn().mockResolvedValue(null) }` and `services.group.listMyJoinRequests = vi.fn().mockResolvedValue([])`; both new sections then render nothing.

- [ ] **Step 7: Run tests**

Run: `npx vitest run`
Expected: PASS, including plan 2's group and groups tests.

- [ ] **Step 8: Commit**

```bash
git add src/app/screens/group-discover-form.js src/app/screens/sent-requests.js src/app/screens/group-owner.js src/app/screens/groups.js src/app/testing/fake-services.js src/app/dashboard-i18n.js tests/unit
git commit -m "feat: let owners place their group on the map and list sent join requests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Welcome step 3

**Files:**
- Create: `src/app/screens/welcome-discover.js`
- Modify: plan 2's `src/app/screens/welcome.js`, `tests/unit/welcome-screen.test.js`, `tests/e2e/app-welcome.spec.js`; `src/app/dashboard-i18n.js`
- Test: `tests/unit/welcome-discover.test.js`

**Interfaces:**
- Consumes: `createCityPicker`, `createVisibilityChoice` (Task 6); `services.discover.updateMine` (Task 3); `normalizePlace` (Task 3).
- Consumes (plan 2, Ruling R1): `welcomeSteps()` returns an ordered list of `{ id, title, render(state, ctx), validate?(state, ctx), save?(state, ctx) }`; `renderWelcome` finishes with `setUsageMode(state.mode)` → every step's `save` → `saveProfile` (sets `completed_at`); a failed `save` keeps the person on the welcome with the reason; the last step's button reads "Finish".
- Produces: `discoverStep` — `{ id: 'discover', title: 'welcomeDiscover.title', render, save }`. `render` shows the optional city picker and "Who can find you", defaulting from `state.mode` (rebuilt if the person goes back and changes mode before choosing); `save` calls `updateMine({ visibility, place, contacts: {} })` only when a city or a visibility was chosen. `welcomeSteps()` becomes `[profileStep, modeStep, discoverStep]`. i18n keys `welcomeDiscover.*`.

Ruling 4 applies: an untouched visibility is saved as null, so it keeps following the mode. The step is optional: Finish with nothing chosen saves nothing.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/welcome-discover.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { discoverStep } from '../../src/app/screens/welcome-discover.js';

const LISBON = { city: 'Lisbon', region: 'Lisbon', country: 'Portugal', lat: 38.72, lng: -9.14 };

function ctx(updateMine = vi.fn().mockResolvedValue({ status: 'updated' })) {
  const values = new Map([['roda.dashboard.locale', 'en']]);
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  return {
    document,
    i18n: createDashboardI18n({ document, storage, navigator: { languages: ['en'] } }),
    profile: { id: 'p1', display_name: 'Ana Silva' },
    services: { discover: { updateMine }, geocoder: { searchCities: vi.fn().mockResolvedValue([LISBON]), reverse: vi.fn() } },
  };
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const choose = (view, value) => {
  const radio = view.querySelector(`input[value="${value}"]`);
  radio.checked = true;
  radio.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('welcome Discover step', () => {
  it('defaults who can find you from the chosen mode and follows a mode change', () => {
    const context = ctx();
    const state = { mode: 'teach' };
    expect(discoverStep.render(state, context).querySelector('input[value="everyone"]').checked).toBe(true);
    state.mode = 'train';
    expect(discoverStep.render(state, context).querySelector('input[value="nobody"]').checked).toBe(true);
  });

  it('saves the city with an unchosen visibility', async () => {
    const context = ctx();
    const state = { mode: 'both' };
    const view = discoverStep.render(state, context);
    document.body.replaceChildren(view);
    const input = view.querySelector('input[aria-label="Search a city"]');
    input.value = 'Lisbon';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flush();
    [...view.querySelectorAll('button')].find((button) => button.textContent === 'Lisbon, Portugal').click();
    await discoverStep.save(state, context);
    expect(context.services.discover.updateMine).toHaveBeenCalledWith({ visibility: null, place: LISBON, contacts: {} });
  });

  it('saves a chosen visibility without a city, and keeps it across re-renders', async () => {
    const context = ctx();
    const state = { mode: 'train' };
    choose(discoverStep.render(state, context), 'everyone');
    expect(discoverStep.render(state, context).querySelector('input[value="everyone"]').checked).toBe(true);
    await discoverStep.save(state, context);
    expect(context.services.discover.updateMine).toHaveBeenCalledWith({ visibility: 'everyone', place: null, contacts: {} });
  });

  it('saves nothing when nothing was chosen', async () => {
    const context = ctx();
    const state = { mode: 'train' };
    discoverStep.render(state, context);
    await discoverStep.save(state, context);
    expect(context.services.discover.updateMine).not.toHaveBeenCalled();
  });

  it('lets a failed save reach the welcome so the person stays on it', async () => {
    const context = ctx(vi.fn().mockRejectedValue(new Error('The network request failed. Please try again.')));
    const state = { mode: 'train' };
    choose(discoverStep.render(state, context), 'nobody');
    await expect(discoverStep.save(state, context)).rejects.toThrow('The network request failed. Please try again.');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/welcome-discover.test.js`
Expected: FAIL — cannot find module `welcome-discover.js`.

- [ ] **Step 3: Add the i18n keys**

Append to `en`:

```js
    'welcomeDiscover.title': 'Where do you train?',
    'welcomeDiscover.intro': 'Optional. Only your city is shared, never an address. You can change this later in Settings.',
```

Append to `pt`:

```js
    'welcomeDiscover.title': 'Onde treinas?',
    'welcomeDiscover.intro': 'Opcional. Só partilhamos a tua cidade, nunca uma morada. Podes mudar isto depois nas Definições.',
```

- [ ] **Step 4: Implement the step**

```js
// src/app/screens/welcome-discover.js
import { normalizePlace } from '../discover-rules.js';
import { el } from '../shell/page.js';
import { createCityPicker, createVisibilityChoice } from './discover-settings.js';

// Welcome step 3 (plan 2 Ruling R1): optional city and "Who can find you".
export const discoverStep = {
  id: 'discover',
  title: 'welcomeDiscover.title',
  render(state, ctx) {
    state.discoverCity ??= createCityPicker(ctx, { value: null, onChange: (place) => { state.discoverPlace = place; } });
    const chosen = state.discoverVisibility?.value() ?? null;
    if (!state.discoverVisibility || (chosen === null && state.discoverVisibilityMode !== state.mode)) {
      state.discoverVisibility = createVisibilityChoice(ctx, { stored: chosen, mode: state.mode, name: 'welcomeVisibility' });
      state.discoverVisibilityMode = state.mode;
    }
    return el(ctx.document, 'div', { className: 'welcome-discover' }, [
      el(ctx.document, 'p', { className: 'muted', text: ctx.i18n.t('welcomeDiscover.intro') }),
      el(ctx.document, 'h3', { className: 'field-label', text: ctx.i18n.t('discoverSettings.city') }),
      state.discoverCity.element,
      state.discoverVisibility.element,
    ]);
  },
  async save(state, ctx) {
    const visibility = state.discoverVisibility?.value() ?? null;
    const place = normalizePlace(state.discoverPlace ?? null);
    if (!place && visibility === null) return;
    await ctx.services.discover.updateMine({ visibility, place, contacts: {} });
  },
};
```

(Contacts are sent empty on purpose: a first-sign-in profile has none, and they are edited in Settings.)

- [ ] **Step 5: Append the step in plan 2's welcome and update its tests**

In `src/app/screens/welcome.js`:

```js
import { discoverStep } from './welcome-discover.js';
```

```js
export function welcomeSteps() {
  return [profileStep, modeStep, discoverStep];
}
```

In `tests/unit/welcome-screen.test.js` (plan 2):
- "walks through name and mode, then finishes": expect `'Step 1 of 3'` and `'Step 2 of 3'`; after choosing Teach, `press(view, 'welcome-next')` shows `'Step 3 of 3'`, then press `welcome-next` once more to finish. Add `discover: { updateMine: vi.fn() }` and `geocoder: { searchCities: vi.fn(), reverse: vi.fn() }` to `services`, and assert `updateMine` was not called (nothing chosen).
- "keeps the answers and never uploads the same photo twice after a failure": press `welcome-next` three times before the first `waitFor`.
- "runs extra steps and their save hooks before completing the profile": the list is now four steps; press `welcome-next` three times and expect `'Step 4 of 4'` before the final press.

In `tests/e2e/app-welcome.spec.js` (plan 2), replace the line that clicks Finish after choosing Both with:

```js
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Where do you train?' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish' }).click();
```

and add a second test:

```js
test('a new person can add a city and be findable from the welcome', async ({ page }) => {
  await seedAccount(page, { profile: { display_name: 'Capoeirista', completed_at: null } });
  await page.goto('/app');
  await page.getByLabel('Name', { exact: true }).fill('Ana Silva');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: 'Teach' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  const city = page.getByRole('searchbox', { name: 'Search a city' });
  await city.fill('Lisbon');
  await city.press('Enter');
  await page.getByRole('button', { name: 'Lisbon, Portugal' }).click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page).toHaveURL(/#\/$/);
  const profile = await page.evaluate(() => JSON.parse(localStorage.getItem('roda.e2e.profile')));
  expect(profile).toMatchObject({ usage_mode: 'teach', place_city: 'Lisbon', discover_visibility: null });
});
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run && npm run test:e2e -- tests/e2e/app-welcome.spec.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/screens/welcome-discover.js src/app/screens/welcome.js src/app/dashboard-i18n.js tests/unit/welcome-discover.test.js tests/unit/welcome-screen.test.js tests/e2e/app-welcome.spec.js
git commit -m "feat: add the optional city step to the welcome

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Browser tests, privacy documentation, and verification

**Files:**
- Create: `tests/e2e/app-discover.spec.js`
- Modify: `docs/security-checklist.md`, `README.md`

**Interfaces:**
- Consumes: everything above; the fake's default people and groups (Task 3), `E2E_CITIES` (Task 4), `E2E_TILES` (Task 5), `localStorage['roda.e2e.discoverViewer']` and `['roda.e2e.failGeocoder']`; plan 2's `seedAccount(page, { profile })` from `tests/e2e/app-helpers.js` (signs in Ana Silva, `practitioner-1`).
- Produces: browser coverage at phone (390 × 840) and desktop sizes for the spec's "set a city and find yourself on the map; set Nobody and disappear", plus a guard that no request reaches `openstreetmap.org`.

- [ ] **Step 1: Write the browser tests**

```js
// tests/e2e/app-discover.spec.js
import { expect, test } from '@playwright/test';

import { seedAccount } from './app-helpers.js';

let external = [];

test.beforeEach(async ({ page }) => {
  external = [];
  page.on('request', (request) => {
    if (/openstreetmap\.org/.test(request.url())) external.push(request.url());
  });
  await page.route(/openstreetmap\.org/, (route) => route.abort());
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00Z'));
  await seedAccount(page, { profile: { usage_mode: 'train' } });
});

test.afterEach(() => {
  expect(external).toEqual([]);
});

async function searchDiscover(page, text) {
  await page.getByRole('searchbox', { name: 'Search people, groups, or cities' }).fill(text);
  await expect(page.locator('.discover-results')).toBeVisible();
}

async function viewAs(page, profileId) {
  await page.evaluate((id) => {
    if (id) localStorage.setItem('roda.e2e.discoverViewer', id);
    else localStorage.removeItem('roda.e2e.discoverViewer');
  }, profileId);
}

async function saveVisibility(page, label) {
  await page.goto('/app#/me/settings');
  await page.getByRole('radio', { name: label }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
}

test('sets a city, finds herself, and disappears for others with Nobody', async ({ page }) => {
  await page.goto('/app#/me/settings');
  const city = page.getByRole('searchbox', { name: 'Search a city' });
  await city.fill('Lisbon');
  await city.press('Enter');
  await page.getByRole('button', { name: 'Lisbon, Portugal' }).click();
  await page.getByRole('radio', { name: 'Everyone' }).check();
  await page.getByLabel('Instagram handle').fill('@ana.silva');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  expect(await page.evaluate(() => window.__RODA_E2E_EVENTS__.filter(({ type }) => type === 'geocode-search').length)).toBe(1);

  await page.goto('/app#/discover');
  await searchDiscover(page, 'Lisbon');
  await page.locator('.discover-results .discover-row[data-kind="city"]').click();
  await expect(page.locator('.discover-pin', { hasText: 'Lisbon · 3' })).toBeVisible();
  await page.locator('.discover-row[data-profile-id="practitioner-1"]').click();
  await expect(page).toHaveURL(/#\/person\/practitioner-1$/);
  await expect(page.getByRole('heading', { name: 'Ana Silva' })).toBeVisible();
  await expect(page.getByRole('link', { name: '@ana.silva' })).toHaveAttribute('href', 'https://www.instagram.com/ana.silva/');
  await expect(page.getByText('Everyone can find your card.')).toBeVisible();

  await viewAs(page, 'discover-bia');
  await page.goto('/app#/discover');
  await searchDiscover(page, 'Ana');
  await expect(page.locator('.discover-results .discover-row[data-profile-id="practitioner-1"]')).toBeVisible();

  await viewAs(page, null);
  await saveVisibility(page, 'Nobody');

  await viewAs(page, 'discover-bia');
  await page.goto('/app#/discover');
  await searchDiscover(page, 'Lisbon');
  await page.locator('.discover-results .discover-row[data-kind="city"]').click();
  await expect(page.locator('.discover-pin', { hasText: 'Lisbon · 2' })).toBeVisible();
  await expect(page.locator('.discover-row[data-profile-id="practitioner-1"]')).toHaveCount(0);
  await searchDiscover(page, 'Ana');
  await expect(page.getByText('No people, groups, or cities match.')).toBeVisible();
  await page.goto('/app#/person/practitioner-1');
  await expect(page.getByText("This person isn't available.")).toBeVisible();
});

test('never shows people who stay hidden', async ({ page }) => {
  await page.goto('/app#/discover');
  await searchDiscover(page, 'Caio');
  await expect(page.getByText('No people, groups, or cities match.')).toBeVisible();
  await searchDiscover(page, 'Fechada');
  await expect(page.getByText('No people, groups, or cities match.')).toBeVisible();
});

test('opens a group card from search and asks to join', async ({ page }) => {
  await page.goto('/app#/discover');
  await searchDiscover(page, 'Grupo');
  await page.locator('.discover-results .discover-row[data-kind="group"]').click();
  await expect(page).toHaveURL(/#\/group\/discover-group-lua$/);
  await expect(page.getByRole('heading', { name: 'Grupo Lua' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mestre Lua' })).toHaveAttribute('href', '#/person/discover-lua');
  await page.getByRole('button', { name: 'Ask to join' }).click();
  await expect(page.getByText('Request sent. The group will reply.')).toBeVisible();
  const requests = await page.evaluate(() => window.__RODA_E2E_EVENTS__.filter(({ type }) => type === 'request-access'));
  expect(requests).toEqual([{ type: 'request-access', groupId: 'discover-group-lua', requestedAccess: 'member' }]);
});

test('keeps the typed city when city search is down', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('roda.e2e.failGeocoder', 'true'));
  await page.goto('/app#/me/settings');
  const city = page.getByRole('searchbox', { name: 'Search a city' });
  await city.fill('Lisbon');
  await city.press('Enter');
  await expect(page.getByText("City search isn't available right now. Try again in a moment.")).toBeVisible();
  await expect(city).toHaveValue('Lisbon');
});

test('a group owner puts the group on the map', async ({ page }) => {
  await page.evaluate(() => {
    const group = {
      id: 'group-1', slug: 'roda-da-lua', owner_id: 'practitioner-1', name: 'Roda da Lua', description: null,
      location: 'Lisbon', timezone: 'Europe/Lisbon', picture_path: null, is_discoverable: true, archived_at: null,
    };
    localStorage.setItem('roda.e2e.groupState', JSON.stringify({
      groups: [group],
      memberships: [{ group_id: 'group-1', profile_id: 'practitioner-1', access_level: 'coach', state: 'active', joined_at: '2026-09-11T20:00:00Z', group }],
      rosters: { 'group-1': [{ profile_id: 'practitioner-1', display_name: 'Ana Silva', access_level: 'coach', membership_state: 'active' }] },
    }));
  });
  await page.goto('/app#/group/group-1');
  const form = page.locator('.group-discover');
  const city = form.getByRole('searchbox', { name: 'Search a city' });
  await city.fill('Lisbon');
  await city.press('Enter');
  await form.getByRole('button', { name: 'Lisbon, Portugal' }).click();
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form.getByText('Saved.')).toBeVisible();
  await page.goto('/app#/discover');
  await expect(page.locator('.discover-pin', { hasText: 'Roda da Lua' })).toBeVisible();
});

test('fills the phone screen above the tab bar and credits OpenStreetMap', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'phone layout only');
  await page.goto('/app#/discover');
  const map = await page.locator('.discover-map').boundingBox();
  const nav = await page.getByRole('navigation', { name: 'Main navigation' }).boundingBox();
  expect(map.height).toBeGreaterThan(600);
  expect(map.y + map.height).toBeLessThanOrEqual(nav.y + 1);
  await expect(page.getByRole('link', { name: 'OpenStreetMap' })).toBeVisible();
  await expect(page.locator('.discover-summary')).toHaveText('3 people · 1 group');
  await page.locator('.discover-panel-handle').click();
  await expect(page.getByText(/Map images and city search come from OpenStreetMap/)).toBeVisible();
});

test('keeps the map beside an open card on desktop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'desktop layout only');
  await page.goto('/app#/discover');
  const panel = await page.locator('.discover-panel').boundingBox();
  const map = await page.locator('.discover-map').boundingBox();
  expect(panel.x + panel.width).toBeLessThanOrEqual(map.x + 1);
  await expect(page.getByRole('link', { name: 'OpenStreetMap' })).toBeVisible();
  await searchDiscover(page, 'Mestre');
  await page.locator('.discover-results .discover-row[data-kind="person"]').click();
  await expect(page.locator('#appDetail').getByRole('heading', { name: 'Mestre Lua' })).toBeVisible();
  await expect(page.locator('#appMain .discover-map')).toBeVisible();
});
```

- [ ] **Step 2: Run the browser tests**

Run: `npm run test:e2e -- tests/e2e/app-discover.spec.js`
Expected: PASS on `chromium-desktop` and `chromium-mobile`, with no request to `openstreetmap.org`.

- [ ] **Step 3: Document privacy and security checks**

In `docs/security-checklist.md`, append to "Product privacy and behavior":

```markdown
- [ ] Discover stores and returns only city-level places (two-decimal
  coordinates). Nobody-visible and unfinished profiles never appear in map
  points, city lists, cards, search, or profile-picture reads; contacts are
  returned only with a visible card.
- [ ] Discover read functions are not executable by `anon` until the public
  "Find a class" page is reviewed; the private functions already apply the
  anonymous (Everyone-only) rule.
- [ ] Map tiles and city search go from the browser directly to OpenStreetMap.
  The in-app note on Discover and in Discover settings says so; Nominatim
  requests are user-initiated, at most one per second, cached, never bulk, and
  OSM attribution is visible on every map. The service worker never caches
  third-party responses.
```

In `README.md`, append to the "The new app (`/app`)" section:

```markdown
Discover (`#/discover`) shows people per city and discoverable groups on an
OpenStreetMap map, with search and person and group cards. People choose their
city, who can find them, and their contacts in Me → Settings; group owners set
the group's city and contacts on the group's page. Only city-level places are
stored, and Train-mode profiles stay hidden until the person chooses otherwise.
```

- [ ] **Step 4: Run every suite**

Run:

```bash
npm run test:unit
npx supabase migration up --local
npm run test:db
npm run test:e2e
npm run build
rg -n "sb_publishable_e2e_test" assets/generated
```

Expected: all suites pass; the production build succeeds; the final `rg` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/app-discover.spec.js docs/security-checklist.md README.md
git commit -m "test: cover Discover in the browser and document its privacy rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
