# Mobile App Plan 5: Native iOS and Android Apps with Capacitor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the mobile-first app as native iOS and Android apps with Capacitor, with store-compliant sign-in and in-app account deletion, while the web app keeps behaving exactly as before.

**Architecture:** A new `build:native` script bundles the same entry (`src/app/entries/app.js`) into `native-www/`, which Capacitor ships inside the apps. Everything native sits behind one build-time module, `roda:platform`: the web build resolves it to a no-op web platform, the native build to Capacitor plugins, so the web bundle contains no Capacitor code. Sign-in uses the system browser with PKCE and a custom-scheme deep link (plus native Sign in with Apple on iOS). Account deletion is a new private definer function that deletes the auth user and leaves an anonymous profile tombstone.

**Tech Stack:** Capacitor 8.5.3 (Swift Package Manager on iOS, Gradle on Android), vanilla ES modules + esbuild, Vitest + jsdom, Playwright, Supabase Postgres + pgTAP, GitHub Actions (Ubuntu and macOS runners).

**Spec:** `docs/superpowers/specs/2026-10-11-mobile-first-app-design.md` lists "App-store packaging (for example with Capacitor)" only under **Deferred**; there is no spec section beyond that line. The **Design decisions** section below stands in for the spec. The product owner must approve it before any task starts.

This is plan 5. It runs **after Plan 4** (the switch-over that serves the app at `/dashboard`). The native build finds whichever page loads `/assets/generated/app.js`, so it works with the page at `/app` or `/dashboard`.

## Design decisions (to confirm before execution)

Versions were checked on npm on 2026-10-12. Capacitor 8 needs Node 22+, Xcode 26+, an iOS 15 deployment target, Android Studio Otter (2025.2.1)+, and Android compile/target SDK 36 (min SDK 24); new iOS projects use Swift Package Manager by default ([Capacitor 8 update guide](https://capacitorjs.com/docs/updating/8-0)).

**D1. Bundle the web app inside the apps (no `server.url`).**
- Recommendation: `npm run build:native` writes the app page, CSS, fonts, icons, and a native build of `app.js` to `native-www/` (Capacitor's `webDir`). App updates ship as store releases. Server changes (Supabase RPCs) must stay backward compatible with the oldest app version still in use, so never change a public RPC's signature in place: add a new function and keep the old one until old builds are retired.
- Alternatives: `server.url: 'https://roda.fyi/dashboard'` (remote loading); live-update services (Capgo, Appflow).
- Why: Apple Guideline 4.2 rejects apps that are thin website wrappers; a bundled shell opens offline and instantly; remote loading would also make every web deploy an unreviewed app change. Live updates can come later without changing this design.

**D2. Sign-in: system browser OAuth with PKCE and a custom-scheme deep link.**
- Recommendation: In the apps, Google sign-in and the email link redirect to `fyi.roda.app://auth-callback`. Google opens in `@capacitor/browser` (SFSafariViewController on iOS, Chrome Custom Tabs on Android) using `signInWithOAuth({ skipBrowserRedirect: true })`. `@capacitor/app` delivers the deep link (`appUrlOpen`, plus `getLaunchUrl()` on cold start), and the existing `finishCallback` calls `exchangeCodeForSession`. The PKCE verifier never leaves the app, so another app claiming the scheme cannot use an intercepted code.
- Alternatives: a native Google plugin plus `signInWithIdToken` (`@capgo/capacitor-social-login` pulls in the Facebook SDK and needs separate iOS/Android client IDs and SHA-1 fingerprints); universal links and App Links with `apple-app-site-association` and `assetlinks.json` on roda.fyi (redirects inside SFSafariViewController hand over to the app unreliably).
- Why: Google blocks OAuth inside embedded WebViews (`disallowed_useragent`), and the system browser is allowed. This reuses the existing Supabase Google provider, needs no new Google OAuth client, and serves Google and the email link alike. Universal links can come later.

**D3. Sign in with Apple on iOS (Guideline 4.8).**
- Recommendation: The iOS app offers "Continue with Apple" through `@capawesome/capacitor-apple-sign-in` 0.1.4 (MIT, Capacitor 8, Swift Package Manager) and Supabase `signInWithIdToken({ provider: 'apple', token, nonce })`, using a SHA-256-hashed nonce for Apple and the raw nonce for Supabase. The full name Apple shares on first sign-in is saved with `updateUser({ data: { full_name } })`. The web app and the Android app are unchanged.
- Alternatives: rely on the email link as the "equivalent option" (reviewers decide case by case whether it meets 4.8's privacy criteria); Apple through the web OAuth flow (the client secret must be regenerated every 6 months or sign-in breaks); `@capacitor-community/apple-sign-in` 7.1.0 (its `Package.swift` pins `capacitor-swift-pm` to 7.x and does not resolve with Capacitor 8).
- Why: Since January 2024, Guideline 4.8 no longer names Sign in with Apple, but apps that use Google login must still offer another login service that limits data to name and email, lets people hide their email, and does not track them. Sign in with Apple is the option Apple's reviewers accept without debate. Native Apple sign-in needs no client secret ([Supabase: Login with Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple)). It also gives App Review a way in without a test Google account.

**D4. In-app account deletion on every platform (Guideline 5.1.1(v), Google Play account deletion policy).**
- Finding: roda.fyi has no account deletion today. `profiles.id` references `auth.users` with `on delete cascade`, but 13 foreign keys to `profiles` and `coach_profiles` use `on delete restrict` (classes, participations, plans, resources), so deleting any active user from the dashboard already fails.
- Recommendation: Me → Settings → "Delete account", the same on web, iOS, and Android. `public.delete_my_account()` deletes the auth user; a `before delete` trigger on `auth.users` erases the person's data first. The profile row stays as an anonymous tombstone ("Deleted account", no photo, no time zone, hidden from leaderboards, `deleted_at` set), so the classes, plans, and groups other people rely on keep working. The FK from `profiles` to `auth.users` is dropped to allow the tombstone. Erased: own trainings, participations (notes, ratings, and feedback on them), feedback they wrote, links they added, saved sequences, curator role, join requests, pending invitations to their email, Discover place and contacts (visibility set to `nobody`), and the profile photo (removed through the Storage API by the client, because SQL deletes on `storage.objects` are blocked). Ended: memberships, coaching connections, and future scheduled classes they arranged or were booked into. Kept without a name: classes they taught or recorded for others, and their plans. An owner of a group with other active members must transfer or archive it first (`owner_must_transfer`, the rule `leave_group` already uses); owned groups with no other members are archived automatically. The same trigger runs when an operator deletes a user in the Supabase dashboard.
- Alternatives: a full cascade (deletes students' class history when a coach leaves); a "request deletion" form handled manually (slow, error-prone, and Apple wants deletion in the app); an Edge Function using the service-role key (adds a privileged deployment surface).
- Why: Both stores require it, the security checklist already lists "account deletion" as a pre-launch item, and the tombstone respects other people's records without keeping anything that identifies the person. Known limit: an access token stays valid for up to one hour after deletion; the client signs out locally right away, and refresh tokens die with the auth user. The tombstone name is stored in English.

**D5. No service worker in the native shell.**
- Recommendation: Service worker registration moves into the web platform module, and the native platform never registers one.
- Why: The files are already on the device, and a service worker would cache stale copies that outlive store updates.

**D6. Durable storage through Capacitor Preferences.**
- Recommendation: On native, drafts, pending resources, the Supabase session, and the locale go through a small adapter that reads synchronously from memory and writes through, in order, to `@capacitor/preferences` (UserDefaults on iOS, SharedPreferences on Android). The first native launch copies existing `roda.*` keys from WebView localStorage. Callers keep the Storage API (`getItem`, `setItem`, `removeItem`, `key`, `length`) and get `flush()` before reloads. The web keeps `window.localStorage`.
- Alternatives: keep WebView localStorage (iOS can evict WebView data under storage pressure); `@capacitor/filesystem` JSON files (more code, same result).
- Why: A lost draft or a lost "waiting to sync" resource is real data loss, and an evicted session signs people out.

**D7. System bars, splash, icons, and keyboard.**
- Recommendation: Use the SystemBars plugin built into Capacitor 8 core (`style: 'DARK'`, `insetsHandling: 'css'`) and change `assets/app.css` to read `var(--safe-area-inset-*, env(safe-area-inset-*, 0px))`, which fixes Android WebView versions below 140 and changes nothing on the web ([SystemBars](https://capacitorjs.com/docs/apis/system-bars)). `@capacitor/splash-screen` 8.0.2 keeps the launch screen until the first screen renders, with a 4-second fallback. `scripts/build-icons.mjs` also renders `resources/logo.png` (1024 px) from `favicon.svg`, and `@capacitor/assets` 3.0.5 generates every icon and splash, run through `npx` and committed. `@capacitor/keyboard` 8.0.6 uses `resize: 'native'` so the Log training chat box stays above the keyboard.
- Why: These are first-party pieces, one source image, and no hand-made icon sets.

**D8. Android back button.**
- Recommendation: Back closes an open sheet first. On a detail page it calls the router's `back()` with the screen's fallback (`/me` for Me sections, `/` otherwise). On another tab it goes to Today, and on Today it minimizes the app.
- Why: This matches the in-app Back button and Android convention, and never leaves the app with a blank WebView.

**D9. External links and YouTube.**
- Recommendation: In the apps, `http(s)` links that leave the app, and the training page's "open video" button, open in `@capacitor/browser`. YouTube embeds load through a small wrapper page on roda.fyi (`https://roda.fyi/embed/youtube?v=<id>`), which gives YouTube a normal https referrer. WKWebView embeds from `capacitor://localhost` fail with YouTube error 153. The web keeps embedding `youtube-nocookie.com` directly. The apps append `RodaApp/1 (+https://roda.fyi)` to the user agent, which helps OpenStreetMap's tile and Nominatim policies (Plan 3); the device smoke test checks the map.
- Why: People stay in the app, and videos play on iOS.

**D10. One build-time platform module.**
- Recommendation: `app.js` imports `createPlatform` from `roda:platform`. An esbuild plugin resolves it to `src/app/platform/web.js` for `npm run build` and to `src/app/platform/native.js` for `npm run build:native`. Pure logic (storage adapter, deep-link parsing, back-button decisions, link detection) lives in separate modules with unit tests.
- Alternatives: runtime checks with `Capacitor.isNativePlatform()` in the shared bundle.
- Why: The web bundle stays byte-for-byte free of Capacitor, which a build test enforces, so "the web behaves exactly as before" is checked by a test.

**D11. App identity and versions.**
- Recommendation: App ID / bundle ID `fyi.roda.app`, display name "Roda", URL scheme `fyi.roda.app`. The marketing version is `package.json` `version`. The build number (`versionCode` / `CFBundleVersion`) is the number of minutes since 2026-01-01 UTC, from `scripts/native-version.mjs`. It always increases and stays far below Android's 2,100,000,000 limit.
- Why: There is no counter to store or bump by hand, and every upload gets a new build number.

**D12. Native project folders and CI.**
- Recommendation: Commit `android/` and `ios/` at the repo root (Capacitor convention); `native-www/` and signing files are git-ignored, and `.vercelignore` keeps `android/`, `ios/`, `native-www/`, and `resources/` off the website (Vercel serves the repo root). A GitHub Actions workflow (`native.yml`) builds the native bundle, runs `npx cap sync`, fails if the committed native projects drift, builds a debug APK on Ubuntu, and builds an unsigned simulator app on a `macos-26` runner. Release signing stays manual for now: an Android upload keystore read from git-ignored `android/keystore.properties`, and an iOS archive in Xcode on a Mac. fastlane can come later.
- Why: The developer's machine is Linux, which can build Android locally, but iOS compiles only on macOS. CI proves both compile on every change without storing signing secrets.

**D13. Out of scope (later):** push notifications, universal links and App Links, live updates, native Google sign-in, tablet and landscape tuning, offline data (the spec already defers it), and release automation (fastlane).

## Global Constraints

- Plans 2–4 are merged (`docs/superpowers/plans/2026-10-12-mobile-app-plan-{2-teaching-me-onboarding,3-discover,4-switch-over}.md`). This plan relies on what they add: `dashboard.html` loads `/assets/generated/app.js` (entry `src/app/entries/app.js`) at `/dashboard`, and `app.html` is a forwarding stub; `scripts/build.mjs` exports `ENTRY_POINTS` and `WORKER_ENTRY_POINTS`; `src/app/sw/register.js` exports `registerAppWorker({ navigator, caches })`; `src/app/local-data.js` exports `clearLocalTrainingData(storage)`; `src/app/screens/sign-out.js` exports `confirmSignOut(ctx, { signOut })`; Settings is rendered from `meSection` in `app.js`; `profiles` has Plan 2's `usage_mode` and Plan 3's `discover_visibility`, `place_*`, and `contact_*` columns. E2E paths use `/dashboard`. Where a step quotes an anchor line, find that line by its content; if a later plan reshaped it, keep its current form and apply the same change.
- The web app behaves exactly as before when not running natively: the web bundle is built with `roda:platform` → `src/app/platform/web.js` and contains no Capacitor code (a build test checks this).
- Do not modify `tools/`, `assets/figure3d.js`, or `assets/moves3d/`. This plan does not change `index.html`; any future change there stays inside its Sequences section.
- Follow `docs/security-checklist.md`. Every new function follows the existing pattern: a `private.*` security definer with `set search_path = ''` and fully qualified names, called by a `public` `language sql` wrapper passing `auth.uid()`; revoke from public/anon/authenticated, grant to authenticated. No new tables. If one is ever needed, enable RLS.
- New migrations: `supabase/migrations/2026103000NN_*.sql`; new DB tests: `supabase/tests/0040_*.test.sql` upward. Never edit applied migrations. Apply locally with `npx supabase migration up --local`, never `supabase db reset` (the local database is shared with the main checkout).
- Keep `npm run test:unit`, `npm run test:e2e`, and `npm run test:db` passing after every task.
- English copy in American spelling; every new `en` key in `src/app/dashboard-i18n.js` has a `pt` key in the existing European Portuguese register.
- Exact pins (devDependencies, bundled by esbuild like `@supabase/supabase-js`): `@capacitor/core` 8.5.3, `@capacitor/cli` 8.5.3, `@capacitor/android` 8.5.3, `@capacitor/ios` 8.5.3, `@capacitor/app` 8.1.2, `@capacitor/browser` 8.0.5, `@capacitor/preferences` 8.0.1, `@capacitor/splash-screen` 8.0.2, `@capacitor/keyboard` 8.0.6, `@capawesome/capacitor-apple-sign-in` 0.1.4. Run `@capacitor/assets` 3.0.5 through `npx`; do not add it to `package.json`.
- Toolchain: Node 22 (`.nvmrc`), JDK 21, Android SDK 36, Xcode 26 (macOS CI only).
- App ID `fyi.roda.app`; deep link `fyi.roda.app://auth-callback`, the only custom-scheme URL the app accepts.
- Never commit signing material: `android/keystore.properties`, `*.jks`, `*.keystore`, `.p8`/`.p12` files.
- Store accounts, signing keys, and Supabase/Apple/Google dashboard settings are owner steps (see **Owner's manual steps**), never code steps.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Someone starts sign-in and backs out** (closes the browser sheet, or cancels the Apple sheet). The buttons work again, and a cancel shows no error. Pinned in Task 5 (sign-in screen tests).
2. **A deep link that isn't a valid sign-in callback** (another URL, a repeated launch URL, or `?error=access_denied`). Other URLs are ignored, each code is exchanged once, and an error shows "Sign-in needs another try" on the sign-in screen, never a blank app. Pinned in Task 5 (auth-callback tests).
3. **The app is killed right after a draft or a "waiting to sync" resource is written.** After relaunch the draft and the queue are still there. Pinned in Task 3 (durable storage: a second adapter over the same Preferences reads the values back after `flush()`).
4. **Android Back with a sheet open, on a detail page, on another tab, and on Today.** Back closes the sheet, goes back within the app, goes to Today, and minimizes, in that order. It never shows a blank WebView. Pinned in Task 6.
5. **A group owner with other members tries to delete their account.** They see which groups to transfer or archive, and nothing is deleted (not even the photo). Pinned in Task 1 (pgTAP) and Task 2 (unit and e2e).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `supabase/migrations/202610300001_account_deletion.sql` | Tombstone column, `account_deletion_check`, `delete_my_account`, erase trigger on `auth.users` |
| `supabase/tests/0040_account_deletion.test.sql` | DB tests for deletion, the owner rule, and the dashboard path |
| `src/app/account-service.js` | `createAccountService` |
| `src/app/screens/delete-account.js` | Delete-account sheet content |
| `src/app/platform/web.js` | Web platform: localStorage, `window.open`, service worker, no-ops |
| `src/app/platform/native.js` | Native platform: Capacitor plugins behind the same interface |
| `src/app/platform/durable-storage.js` | Sync Storage view over Preferences with ordered write-through |
| `src/app/platform/auth-callback.js` | `parseAuthCallback`, `nativeHashFromReturnRoute`, `createAuthCallbackHandler` |
| `src/app/platform/back-button.js` | `backAction` |
| `src/app/platform/external-links.js` | `isExternalUrl`, `installExternalLinks` |
| `src/app/screens/sign-in.js` | Native sign-in screen (Apple on iOS, Google, email link, demo) |
| `scripts/build-native.mjs` | `findAppPage`, `nativePageHtml`, `buildNative` → `native-www/` |
| `scripts/native-version.mjs` | `nativeVersion` (marketing version + build number) |
| `embed/youtube.html` | YouTube wrapper page on roda.fyi for the apps |
| `capacitor.config.json` | Capacitor app config |
| `android/`, `ios/` | Generated native projects (committed) |
| `resources/logo.png` | Source image for `@capacitor/assets` |
| `.github/workflows/native.yml` | Native CI |
| `.vercelignore` | Keeps native folders off the website |

Modified: `scripts/build.mjs`, `tests/unit/helpers/module-graph.js`, `scripts/build-icons.mjs`, `package.json`, `package-lock.json`, `.gitignore`, `src/app/entries/app.js`, `src/app/create-services.js`, `src/app/supabase-client.js`, `src/app/auth-service.js`, `src/app/errors.js`, `src/app/testing/fake-services.js`, `src/app/screens/me.js`, `src/app/screens/log.js`, `src/app/screens/training.js`, `src/app/screens/youtube.js`, `src/app/screens/sign-out.js`, `src/app/shell/sheet.js`, `src/app/ui/resource-view.js`, `src/app/dashboard-i18n.js`, `assets/app.css`, `supabase/config.toml`, `README.md`, `docs/auth-and-database-operations.md`, `docs/security-checklist.md`.

Task order: account deletion first (Tasks 1–2, useful on the web on their own), then the platform seam and the native projects (Tasks 3–4), native behavior (Tasks 5–7), CI (Task 8), and verification (Task 9).

---

### Task 1: Account deletion in the database

**Files:**
- Create: `supabase/migrations/202610300001_account_deletion.sql`
- Test: `supabase/tests/0040_account_deletion.test.sql`

**Interfaces:**
- Consumes: existing `public.record_past_class`, `public.record_alone_training`, `public.add_training_resource`, `public.leave_group`, `public.get_training`, test helpers `tests.create_user`, `tests.set_actor`, `tests.reset_actor`.
- Produces (SQL): `public.account_deletion_check() → jsonb` `{ "blocking_groups": [{ "group_id": uuid, "name": text }] }` (owned, non-archived groups that have another active member, ordered by name).
- Produces (SQL): `public.delete_my_account() → jsonb` `{ "status": "deleted" }`; raises `P0001 owner_must_transfer` when `blocking_groups` is not empty, `PT401 not_authenticated` without a caller; anon gets `42501`.
- Produces (SQL): column `public.profiles.deleted_at timestamptz` (null for live accounts); trigger `auth_user_erase_profile` (`before delete on auth.users`), so dashboard deletions erase too.

- [ ] **Step 1: Check the profile columns Plans 2–3 added**

Run: `grep -n "add column" supabase/migrations/202610[12]*.sql`
Expected: Plan 2's `usage_mode` and Plan 3's `discover_visibility`, `place_city`, `place_region`, `place_country`, `place_lat`, `place_lng`, `contact_instagram`, `contact_website`, `contact_whatsapp`, `contact_email` on `public.profiles` (plus Plan 3's group columns and Plan 4's resource key). The scrub in Step 4 clears every Discover and contact column on `profiles`. If the output lists any other `profiles` column that holds personal data, add it to the scrub and to the "Discover data is removed" assertion before continuing.

- [ ] **Step 2: Write the failing DB test**

```sql
-- supabase/tests/0040_account_deletion.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_function('public', 'delete_my_account', array[]::text[]);
select has_function('public', 'account_deletion_check', array[]::text[]);
select has_column('public', 'profiles', 'deleted_at');
select hasnt_fk('public', 'profiles', 'profiles outlive their auth user as tombstones');

select tests.create_user('10000000-0000-0000-0000-000000004001', 'coach40@example.test', 'Mestre Quarenta');
select tests.create_user('10000000-0000-0000-0000-000000004002', 'ana40@example.test', 'Ana Quarenta');
select tests.create_user('10000000-0000-0000-0000-000000004003', 'bia40@example.test', 'Bia Quarenta');
select tests.create_user('10000000-0000-0000-0000-000000004004', 'caio40@example.test', 'Caio Quarenta');
insert into public.coach_profiles (profile_id) values ('10000000-0000-0000-0000-000000004001');
insert into public.groups (id, owner_id, name, timezone)
values ('20000000-0000-0000-0000-000000004001', '10000000-0000-0000-0000-000000004001', 'Grupo Quarenta', 'Europe/Lisbon');
insert into public.group_memberships (group_id, profile_id, access_level) values
  ('20000000-0000-0000-0000-000000004001', '10000000-0000-0000-0000-000000004001', 'coach'),
  ('20000000-0000-0000-0000-000000004001', '10000000-0000-0000-0000-000000004002', 'member'),
  ('20000000-0000-0000-0000-000000004001', '10000000-0000-0000-0000-000000004003', 'member');
insert into public.coach_student_connections
  (coach_profile_id, student_profile_id, state, initiated_by, decided_at, decided_by)
values ('10000000-0000-0000-0000-000000004001', '10000000-0000-0000-0000-000000004002',
  'active', '10000000-0000-0000-0000-000000004001', now(), '10000000-0000-0000-0000-000000004002');
insert into public.group_member_invitations (group_id, email, token_hash, invited_by)
values ('20000000-0000-0000-0000-000000004001', 'ana40@example.test',
  extensions.digest('invite-0040', 'sha256'), '10000000-0000-0000-0000-000000004001');
insert into public.practice_sequences (profile_id, title, source_text)
values ('10000000-0000-0000-0000-000000004002', 'My flow', 'ginga, armada');
update public.profiles
   set discover_visibility = 'everyone', place_city = 'Lisboa', place_country = 'Portugal',
       place_lat = 38.72, place_lng = -9.14, contact_instagram = 'ana.quarenta', contact_email = 'ana40@example.test'
 where id = '10000000-0000-0000-0000-000000004002';

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000004001');
select public.record_past_class('group', '20000000-0000-0000-0000-000000004001', null, null,
  '2026-09-26T13:19:30Z', '2026-09-26', 'Europe/Lisbon', 56,
  '[{"profile_id":"10000000-0000-0000-0000-000000004002","duration_minutes":56}]'::jsonb,
  '[{"source_text":"ginga 10 min","movements":[{"movement_key":"ginga","movement_name":"Ginga","segment_key":"m:1"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000004001') ->> 'occurrence_id' as class_id \gset
select public.add_training_resource(:'class_id', 'video', 'Recording', 'https://youtu.be/VAI3JUKTwz0', null);

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000004002');
select public.record_alone_training('2026-09-27', 'Europe/Lisbon', 45, 'Knees ok',
  '[{"source_text":"armada, au","movements":[{"movement_key":"armada","movement_name":"Armada","segment_key":"m:1"}]}]'::jsonb,
  '50000000-0000-0000-0000-000000004002', '2026-09-27T08:00:00Z') ->> 'occurrence_id' as alone_id \gset
select public.add_training_resource(:'alone_id', 'summary', 'Notes', null, 'Felt light today.');
select is(public.account_deletion_check() -> 'blocking_groups', '[]'::jsonb, 'a member has nothing blocking deletion');
select is(public.delete_my_account() ->> 'status', 'deleted', 'a member can delete their account');

select tests.reset_actor();
select is((select count(*)::integer from auth.users where id = '10000000-0000-0000-0000-000000004002'), 0,
  'the auth user is gone');
select is((select display_name from public.profiles where id = '10000000-0000-0000-0000-000000004002'), 'Deleted account',
  'the profile keeps no name');
select ok((select deleted_at is not null and avatar_path is null and timezone_override is null and not leaderboard_visible
             from public.profiles where id = '10000000-0000-0000-0000-000000004002'),
  'the profile is scrubbed');
select ok((select discover_visibility = 'nobody' and place_city is null and place_country is null and place_lat is null
                  and contact_instagram is null and contact_website is null and contact_whatsapp is null and contact_email is null
             from public.profiles where id = '10000000-0000-0000-0000-000000004002'),
  'Discover data is removed');
select is((select count(*)::integer from public.training_occurrences where id = :'alone_id'), 0,
  'their own trainings are deleted with their resources');
select is((select count(*)::integer from public.training_participations
            where profile_id = '10000000-0000-0000-0000-000000004002'), 0, 'their participations are deleted');
select is((select count(*)::integer from public.training_occurrences where id = :'class_id'), 1,
  'the class stays for the coach');
select is((select state::text from public.group_memberships
            where profile_id = '10000000-0000-0000-0000-000000004002'), 'left', 'their memberships end');
select is((select state::text from public.coach_student_connections
            where student_profile_id = '10000000-0000-0000-0000-000000004002'), 'ended', 'their coaching connections end');
select is((select count(*)::integer from public.practice_sequences
            where profile_id = '10000000-0000-0000-0000-000000004002'), 0, 'their saved sequences are deleted');
select is((select count(*)::integer from public.group_member_invitations where email = 'ana40@example.test'), 0,
  'pending invitations to their address are deleted');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000004001');
select is((public.get_training(:'class_id') ->> 'attendee_count')::integer, 0,
  'the coach still opens the class after the attendee leaves');
select is(public.account_deletion_check() -> 'blocking_groups' -> 0 ->> 'name', 'Grupo Quarenta',
  'an owner sees the group that blocks deletion');
select throws_ok($$select public.delete_my_account()$$, 'P0001', 'owner_must_transfer',
  'an owner of a group with members must transfer or archive it first');

select tests.reset_actor();
select is((select count(*)::integer from auth.users where id = '10000000-0000-0000-0000-000000004001'), 1,
  'a refused deletion deletes nothing');
select is((select count(*)::integer from public.training_resources where occurrence_id = :'class_id'), 1,
  'a refused deletion keeps the coach''s links');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000004003');
select public.leave_group('20000000-0000-0000-0000-000000004001');

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000004001');
select is(public.delete_my_account() ->> 'status', 'deleted', 'an owner of an emptied group can delete their account');

select tests.reset_actor();
select ok((select archived_at is not null from public.groups where id = '20000000-0000-0000-0000-000000004001'),
  'their emptied group is archived');
select is((select count(*)::integer from public.training_occurrences where id = :'class_id'), 1,
  'classes they recorded stay');
select is((select count(*)::integer from public.training_resources where occurrence_id = :'class_id'), 0,
  'links they added are removed');

delete from auth.users where id = '10000000-0000-0000-0000-000000004004';
select is((select display_name from public.profiles where id = '10000000-0000-0000-0000-000000004004'), 'Deleted account',
  'deleting a user from the dashboard also erases the profile');

select tests.set_actor(null, 'anon');
select throws_ok($$select public.delete_my_account()$$, '42501', null, 'anonymous callers are refused');
select throws_ok($$select public.account_deletion_check()$$, '42501', null, 'anonymous callers cannot check');

reset role;
select * from finish();
rollback;
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx supabase test db supabase/tests/0040_account_deletion.test.sql`
Expected: FAIL — `has_function` for `delete_my_account` fails, and the run stops at the first call to the missing function.

- [ ] **Step 4: Write the migration**

```sql
-- supabase/migrations/202610300001_account_deletion.sql
-- Account deletion. The auth user is deleted; the profile stays as an anonymous
-- tombstone so classes, plans, and groups other people rely on keep working.
alter table public.profiles add column deleted_at timestamptz;
alter table public.profiles drop constraint profiles_id_fkey;

create function private.account_deletion_blockers(actor_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('group_id', g.id, 'name', g.name) order by g.name),
    '[]'::jsonb
  )
    from public.groups g
   where g.owner_id = actor_id
     and g.archived_at is null
     and exists (
       select 1
         from public.group_memberships gm
        where gm.group_id = g.id
          and gm.profile_id <> actor_id
          and gm.state = 'active'
     );
$$;

create function private.erase_account(target_id uuid, target_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_array_length(private.account_deletion_blockers(target_id)) > 0 then
    raise exception using errcode = 'P0001', message = 'owner_must_transfer';
  end if;

  -- Groups: owned groups without other active members are archived first, so
  -- the owner-integrity trigger accepts ending the owner's membership.
  update public.groups
     set archived_at = now(), archived_by = target_id
   where owner_id = target_id and archived_at is null;
  update public.group_memberships
     set state = 'left', ended_at = now(), ended_by = target_id
   where profile_id = target_id and state = 'active';
  delete from public.group_join_requests where profile_id = target_id;
  if target_email is not null then
    delete from public.group_member_invitations
     where email = lower(target_email) and state = 'pending';
  end if;

  -- Coaching connections and future classes end; past records stay for others.
  update public.coach_student_connections
     set state = 'ended', ended_at = now(), ended_by = target_id
   where state = 'active' and target_id in (coach_profile_id, student_profile_id);
  update public.coach_student_connections
     set state = 'declined', decided_at = now(), decided_by = target_id
   where state = 'pending' and target_id in (coach_profile_id, student_profile_id);
  update public.scheduled_trainings
     set state = 'cancelled', cancelled_at = now(), cancelled_by = target_id
   where state = 'scheduled'
     and starts_at > now()
     and (arranged_by = target_id or student_profile_id = target_id);

  -- Their own training data. Participations go before occurrences: an
  -- occurrence that still has participations is immutable.
  delete from public.training_resources where added_by = target_id;
  delete from public.training_feedback where coach_profile_id = target_id;
  delete from public.training_participations where profile_id = target_id;
  delete from public.training_occurrences where kind = 'alone' and recorded_by = target_id;
  delete from public.practice_sequences where profile_id = target_id;
  delete from public.catalog_curators where profile_id = target_id;

  update public.profiles
     set display_name = 'Deleted account',
         avatar_path = null,
         timezone_override = null,
         leaderboard_visible = false,
         discover_visibility = 'nobody',
         place_city = null, place_region = null, place_country = null, place_lat = null, place_lng = null,
         contact_instagram = null, contact_website = null, contact_whatsapp = null, contact_email = null,
         deleted_at = now()
   where id = target_id;
end;
$$;

create function private.handle_deleted_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.erase_account(old.id, old.email);
  return old;
end;
$$;

create trigger auth_user_erase_profile
before delete on auth.users
for each row execute function private.handle_deleted_user();

create function private.delete_account(actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  delete from auth.users where id = actor_id;
  if not found then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  return jsonb_build_object('status', 'deleted');
end;
$$;

create function public.account_deletion_check()
returns jsonb language sql stable set search_path = ''
as $$ select jsonb_build_object('blocking_groups', private.account_deletion_blockers(auth.uid())); $$;

create function public.delete_my_account()
returns jsonb language sql set search_path = ''
as $$ select private.delete_account(auth.uid()); $$;

revoke execute on function private.account_deletion_blockers(uuid) from public, anon, authenticated;
revoke execute on function private.erase_account(uuid, text) from public, anon, authenticated;
revoke execute on function private.handle_deleted_user() from public, anon, authenticated;
revoke execute on function private.delete_account(uuid) from public, anon, authenticated;
grant execute on function private.account_deletion_blockers(uuid) to authenticated;
grant execute on function private.delete_account(uuid) to authenticated;
revoke execute on function public.account_deletion_check() from public, anon, authenticated;
revoke execute on function public.delete_my_account() from public, anon, authenticated;
grant execute on function public.account_deletion_check() to authenticated;
grant execute on function public.delete_my_account() to authenticated;
```

- [ ] **Step 5: Apply and run the test**

Run: `npx supabase migration up --local && npx supabase test db supabase/tests/0040_account_deletion.test.sql`
Expected: PASS — every assertion `ok`.

- [ ] **Step 6: Run the whole DB suite**

Run: `npm run test:db`
Expected: all files pass (0000–0016, any Plan 2–4 files, and 0040).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/202610300001_account_deletion.sql supabase/tests/0040_account_deletion.test.sql
git commit -m "feat: let people delete their account

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Delete account in Settings

**Files:**
- Create: `src/app/account-service.js`, `src/app/screens/delete-account.js`
- Modify: `src/app/create-services.js`, `src/app/testing/fake-services.js`, `src/app/screens/me.js`, `src/app/entries/app.js`, `src/app/errors.js`, `src/app/dashboard-i18n.js`, `assets/app.css`
- Test: `tests/unit/account-service.test.js`, `tests/unit/delete-account.test.js`, `tests/unit/me-screen.test.js`, `tests/e2e/app-account.spec.js`

**Interfaces:**
- Consumes: `public.account_deletion_check()`, `public.delete_my_account()` (Task 1); `ctx.openSheet`, `services.auth.signOut()`; Plan 4's `clearLocalTrainingData(storage)` from `src/app/local-data.js`.
- Produces (JS): `createAccountService(client)` → `{ deletionCheck(): Promise<{ blockingGroups: { group_id, name }[] }>, deleteAccount(profileId: string): Promise<{ status: 'deleted' }> }`; `services.account` (real and `createE2EAccountService({ window })`).
- Produces (JS): `createDeleteAccountPanel({ document, i18n, account, profileId, onDeleted }) → Promise<HTMLElement>`; `renderSettings(ctx, { onLocaleChange, onSignOut, onProfileSaved, onDeleteAccount })`.
- Produces (e2e hook): `localStorage['roda.e2e.ownedGroups']` (JSON array of `{ group_id, name }`) makes the fake `deletionCheck` report blockers.

- [ ] **Step 1: Write the failing unit tests**

```js
// tests/unit/account-service.test.js
import { describe, expect, it } from 'vitest';

import { createAccountService } from '../../src/app/account-service.js';

function fakeClient({ files = [], rpcError = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name) => {
      calls.push(['rpc', name]);
      if (rpcError) return { data: null, error: rpcError };
      return name === 'account_deletion_check'
        ? { data: { blocking_groups: [{ group_id: 'g1', name: 'Grupo Lua' }] }, error: null }
        : { data: { status: 'deleted' }, error: null };
    },
    storage: {
      from: (bucket) => ({
        list: async (folder, options) => {
          calls.push(['list', bucket, folder, options]);
          return { data: files, error: null };
        },
        remove: async (paths) => {
          calls.push(['remove', bucket, paths]);
          return { data: [], error: null };
        },
      }),
    },
  };
}

describe('account service', () => {
  it('reports the groups that block deletion', async () => {
    const client = fakeClient();
    expect(await createAccountService(client).deletionCheck()).toEqual({
      blockingGroups: [{ group_id: 'g1', name: 'Grupo Lua' }],
    });
  });

  it('removes the profile photo before deleting the account', async () => {
    const client = fakeClient({ files: [{ name: 'a.jpg' }, { name: 'b.png' }] });
    expect(await createAccountService(client).deleteAccount('p1')).toEqual({ status: 'deleted' });
    expect(client.calls).toEqual([
      ['list', 'profile-pictures', 'p1', { limit: 100 }],
      ['remove', 'profile-pictures', ['p1/a.jpg', 'p1/b.png']],
      ['rpc', 'delete_my_account'],
    ]);
  });

  it('skips the photo step when there is no photo and surfaces the owner rule', async () => {
    const client = fakeClient({ rpcError: { code: 'P0001', message: 'owner_must_transfer' } });
    await expect(createAccountService(client).deleteAccount('p1')).rejects.toMatchObject({ code: 'owner_must_transfer' });
    expect(client.calls.map(([type]) => type)).toEqual(['list', 'rpc']);
  });
});
```

```js
// tests/unit/delete-account.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { AppError } from '../../src/app/errors.js';
import { createDeleteAccountPanel } from '../../src/app/screens/delete-account.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

describe('delete account panel', () => {
  it('lists blocking groups and offers no delete button', async () => {
    const account = { deletionCheck: vi.fn().mockResolvedValue({ blockingGroups: [{ group_id: 'g1', name: 'Grupo Lua' }] }), deleteAccount: vi.fn() };
    const panel = await createDeleteAccountPanel({ document, i18n, account, profileId: 'p1', onDeleted: vi.fn() });
    expect(panel.textContent).toContain('Grupo Lua');
    expect(panel.querySelector('a[href="#/me/groups"]')).not.toBeNull();
    expect(panel.querySelector('button[data-action="delete-forever"]')).toBeNull();
    expect(account.deleteAccount).not.toHaveBeenCalled();
  });

  it('deletes only after the person confirms', async () => {
    const onDeleted = vi.fn();
    const account = { deletionCheck: vi.fn().mockResolvedValue({ blockingGroups: [] }), deleteAccount: vi.fn().mockResolvedValue({ status: 'deleted' }) };
    const panel = await createDeleteAccountPanel({ document, i18n, account, profileId: 'p1', onDeleted });
    const button = panel.querySelector('button[data-action="delete-forever"]');
    expect(button.disabled).toBe(true);
    button.click();
    expect(account.deleteAccount).not.toHaveBeenCalled();
    const confirm = panel.querySelector('input[data-action="confirm-delete"]');
    confirm.checked = true;
    confirm.dispatchEvent(new Event('change'));
    button.click();
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(account.deleteAccount).toHaveBeenCalledWith('p1');
  });

  it('explains the owner rule if a group gains a member meanwhile', async () => {
    const account = {
      deletionCheck: vi.fn().mockResolvedValue({ blockingGroups: [] }),
      deleteAccount: vi.fn().mockRejectedValue(new AppError('validation', 'owner_must_transfer')),
    };
    const panel = await createDeleteAccountPanel({ document, i18n, account, profileId: 'p1', onDeleted: vi.fn() });
    const confirm = panel.querySelector('input[data-action="confirm-delete"]');
    confirm.checked = true;
    confirm.dispatchEvent(new Event('change'));
    panel.querySelector('button[data-action="delete-forever"]').click();
    await vi.waitFor(() => expect(panel.querySelector('[role="status"]').textContent)
      .toBe('You own groups with other members. Transfer or archive them first:'));
    expect(panel.querySelector('button[data-action="delete-forever"]').disabled).toBe(false);
  });
});
```

Add to `tests/unit/me-screen.test.js`, inside `describe('me screen', …)`:

```js
  it('offers account deletion in Settings', async () => {
    const onDeleteAccount = vi.fn();
    const view = await renderSettings(ctx(), { onLocaleChange: vi.fn(), onSignOut: vi.fn(), onDeleteAccount });
    const button = view.querySelector('button[data-action="delete-account"]');
    expect(button.textContent).toBe('Delete account');
    button.click();
    expect(onDeleteAccount).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/account-service.test.js tests/unit/delete-account.test.js tests/unit/me-screen.test.js`
Expected: FAIL — `Cannot find module '../../src/app/account-service.js'` and `…/delete-account.js`; the Settings test fails because there is no `delete-account` button.

- [ ] **Step 3: Write the account service**

```js
// src/app/account-service.js
import { toAppError } from './errors.js';

function unwrap(result) {
  if (result.error) throw toAppError(result.error);
  return result.data;
}

export function createAccountService(client) {
  return {
    async deletionCheck() {
      const data = unwrap(await client.rpc('account_deletion_check'));
      return { blockingGroups: data?.blocking_groups ?? [] };
    },

    // The photo goes first: the Storage API needs a live session, and SQL may
    // not delete storage objects directly.
    async deleteAccount(profileId) {
      const bucket = client.storage.from('profile-pictures');
      const files = unwrap(await bucket.list(profileId, { limit: 100 })) ?? [];
      const paths = files.map((file) => `${profileId}/${file.name}`);
      if (paths.length) unwrap(await bucket.remove(paths));
      return unwrap(await client.rpc('delete_my_account'));
    },
  };
}
```

- [ ] **Step 4: Write the panel**

```js
// src/app/screens/delete-account.js
import { el } from '../shell/page.js';

export async function createDeleteAccountPanel({ document, i18n, account, profileId, onDeleted }) {
  const panel = el(document, 'div', { className: 'delete-account' });
  let check;
  try {
    check = await account.deletionCheck();
  } catch (error) {
    panel.append(el(document, 'p', { className: 'muted', text: error?.message || i18n.t('app.loadError') }));
    return panel;
  }
  if (check.blockingGroups.length) {
    panel.append(
      el(document, 'p', { text: i18n.t('account.ownerMustTransfer') }),
      el(document, 'ul', { className: 'delete-account-groups' },
        check.blockingGroups.map((group) => el(document, 'li', { text: group.name }))),
      el(document, 'a', { className: 'button-secondary', text: i18n.t('account.openGroups'), attrs: { href: '#/me/groups' } }),
    );
    return panel;
  }

  const status = el(document, 'p', { className: 'log-status', attrs: { role: 'status' } });
  const confirm = el(document, 'input', { attrs: { type: 'checkbox' }, dataset: { action: 'confirm-delete' } });
  const button = el(document, 'button', {
    className: 'button-danger', text: i18n.t('account.deleteForever'),
    attrs: { type: 'button', disabled: true }, dataset: { action: 'delete-forever' },
  });
  confirm.addEventListener('change', () => { button.disabled = !confirm.checked; });
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    confirm.disabled = true;
    status.textContent = i18n.t('account.deleting');
    try {
      await account.deleteAccount(profileId);
      await onDeleted();
    } catch (error) {
      status.textContent = error?.code === 'owner_must_transfer'
        ? i18n.t('account.ownerMustTransfer')
        : (error?.message || i18n.t('account.deleteError'));
      confirm.disabled = false;
      button.disabled = !confirm.checked;
    }
  });
  panel.append(
    el(document, 'p', { text: i18n.t('account.deleteExplain') }),
    el(document, 'ul', { className: 'delete-account-facts' },
      ['account.deleteRemoves', 'account.deleteKeeps'].map((key) => el(document, 'li', { text: i18n.t(key) }))),
    el(document, 'label', { className: 'delete-account-confirm' }, [confirm, el(document, 'span', { text: i18n.t('account.deleteConfirm') })]),
    button,
    status,
  );
  return panel;
}
```

- [ ] **Step 5: Add the Settings button**

In `src/app/screens/me.js`, add `onDeleteAccount` to the options `renderSettings` destructures (after Plan 2 it reads `{ onLocaleChange, onSignOut, onProfileSaved = () => {} }`; it becomes `{ onLocaleChange, onSignOut, onProfileSaved = () => {}, onDeleteAccount }`), and append the button right after the sign-out button:

```js
    el(document, 'button', {
      className: 'button-danger', text: i18n.t('app.signOut'), attrs: { type: 'button' }, dataset: { action: 'sign-out' },
      on: { click: () => onSignOut() },
    }),
    el(document, 'button', {
      className: 'button-danger', text: i18n.t('account.delete'), attrs: { type: 'button' }, dataset: { action: 'delete-account' },
      on: { click: () => onDeleteAccount?.() },
    }),
```

- [ ] **Step 6: Add copy, the safe error message, and styles**

In `src/app/dashboard-i18n.js`, add to `en`:

```js
    'account.delete': 'Delete account',
    'account.deleteExplain': "Deleting your account signs you out and can't be undone.",
    'account.deleteRemoves': 'Removed: your name and photo, your own trainings, notes, ratings, saved sequences, links you added, and feedback you wrote.',
    'account.deleteKeeps': 'Kept without your name: classes you taught, so your students keep their history.',
    'account.deleteConfirm': "I understand this can't be undone.",
    'account.deleteForever': 'Delete my account',
    'account.deleting': 'Deleting your account…',
    'account.deleteError': "We couldn't delete your account. Please try again.",
    'account.ownerMustTransfer': 'You own groups with other members. Transfer or archive them first:',
    'account.openGroups': 'Open Groups',
```

and to `pt`:

```js
    'account.delete': 'Apagar conta',
    'account.deleteExplain': 'Apagar a conta termina a tua sessão e não pode ser desfeito.',
    'account.deleteRemoves': 'Removido: o teu nome e foto, os teus treinos, notas, avaliações, sequências guardadas, links que adicionaste e feedback que escreveste.',
    'account.deleteKeeps': 'Mantido sem o teu nome: as aulas que deste, para que os teus alunos mantenham o histórico.',
    'account.deleteConfirm': 'Compreendo que isto não pode ser desfeito.',
    'account.deleteForever': 'Apagar a minha conta',
    'account.deleting': 'A apagar a tua conta…',
    'account.deleteError': 'Não foi possível apagar a tua conta. Tenta novamente.',
    'account.ownerMustTransfer': 'És dono de grupos com outros membros. Transfere-os ou arquiva-os primeiro:',
    'account.openGroups': 'Abrir Grupos',
```

In `src/app/errors.js`, add to `SAFE_MESSAGES` (alphabetical position after `otp_expired`):

```js
  owner_must_transfer: 'Transfer or archive the groups you own first.',
```

Append to `assets/app.css`:

```css
.delete-account-facts { padding-left: 18px; color: var(--sand); }
.delete-account-confirm { display: flex; gap: 10px; align-items: center; margin: 12px 0; }
.delete-account-confirm input { width: 22px; height: 22px; }
```

- [ ] **Step 7: Wire the services and the screen**

In `src/app/create-services.js`, import and add the account service to both branches:

```js
import { createAccountService } from './account-service.js';
```

```js
import {
  createE2EAccountService, createE2EAuthService, createE2ECatalogService, createE2EConnectionService, createE2EGroupService,
  createE2EProfileService, createE2ERepertoireService, createE2EStatisticsService, createE2ETrainingService,
} from './testing/fake-services.js';
```

In the `localMode` object, after `auth: createE2EAuthService({ window }),` add `account: createE2EAccountService({ window }),`. In the real object, after `auth: …,` add `account: createAccountService(client),`.

In `src/app/testing/fake-services.js`, after `createE2EAuthService`:

```js
export function createE2EAccountService({ window }) {
  const { localStorage: storage } = window;
  const record = (event) => window.__RODA_E2E_EVENTS__.push(event);

  return {
    async deletionCheck() {
      return { blockingGroups: JSON.parse(storage.getItem('roda.e2e.ownedGroups') ?? '[]') };
    },

    async deleteAccount(profileId) {
      record({ type: 'delete-account', profileId });
      storage.removeItem(SESSION_KEY);
      return { status: 'deleted' };
    },
  };
}
```

In `src/app/entries/app.js`, add imports:

```js
import { clearLocalTrainingData } from '../local-data.js';
import { createDeleteAccountPanel } from '../screens/delete-account.js';
```

(Plan 4 already imports `clearLegacyDashboardKeys` from `'../local-data.js'`; add `clearLocalTrainingData` to that import instead of adding a second one), and pass `onDeleteAccount` where Settings is rendered (in `meSection`, next to `onSignOut`; leave the other options as they are):

```js
            onDeleteAccount: async () => {
              const content = await createDeleteAccountPanel({
                document, i18n, account: services.account, profileId: profile.id,
                onDeleted: async () => {
                  clearLocalTrainingData(localStorage);
                  await services.auth.signOut().catch(() => {});
                  location.replace('/');
                },
              });
              ctx.openSheet({ title: i18n.t('account.delete'), content });
            },
```

(`signOut` after deletion may return an error because the server session is gone; supabase-js still clears the local session, and `auth-service.signOut` clears its private keys before rethrowing, so the error is ignored.)

- [ ] **Step 8: Write the e2e test**

```js
// tests/e2e/app-account.spec.js
import { expect, test } from '@playwright/test';

const APP = '/dashboard';

test.beforeEach(async ({ page }) => {
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

test('deletes the account from Settings after confirming', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('roda.logDraft:practitioner-1', '{"notes":"x"}'));
  await page.goto(`${APP}#/me/settings`);
  await page.getByRole('button', { name: 'Delete account' }).click();
  const sheet = page.getByRole('dialog', { name: 'Delete account' });
  const remove = sheet.getByRole('button', { name: 'Delete my account' });
  await expect(remove).toBeDisabled();
  await sheet.getByLabel("I understand this can't be undone.").check();
  await remove.click();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => [
    localStorage.getItem('roda.e2e.session'), localStorage.getItem('roda.logDraft:practitioner-1'),
  ])).toEqual([null, null]);
});

test('asks a group owner to transfer or archive their groups first', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('roda.e2e.ownedGroups', JSON.stringify([{ group_id: 'g1', name: 'Grupo Lua' }])));
  await page.goto(`${APP}#/me/settings`);
  await page.getByRole('button', { name: 'Delete account' }).click();
  const sheet = page.getByRole('dialog', { name: 'Delete account' });
  await expect(sheet.getByText('Grupo Lua')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Delete my account' })).toHaveCount(0);
  await expect(sheet.getByRole('link', { name: 'Open Groups' })).toHaveAttribute('href', '#/me/groups');
});
```

- [ ] **Step 9: Run the tests**

Run: `npx vitest run tests/unit/account-service.test.js tests/unit/delete-account.test.js tests/unit/me-screen.test.js tests/unit/dashboard-i18n.test.js`
Expected: PASS.

Run: `npm run test:e2e -- tests/e2e/app-account.spec.js`
Expected: 4 passed (2 tests × desktop and phone projects).

- [ ] **Step 10: Run the full suites and commit**

Run: `npm run test:unit && npm run test:e2e`
Expected: all pass.

```bash
git add src/app/account-service.js src/app/screens/delete-account.js src/app/create-services.js \
  src/app/testing/fake-services.js src/app/screens/me.js src/app/entries/app.js src/app/errors.js \
  src/app/dashboard-i18n.js assets/app.css tests/unit/account-service.test.js tests/unit/delete-account.test.js \
  tests/unit/me-screen.test.js tests/e2e/app-account.spec.js
git commit -m "feat: add Delete account to Settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Platform seam, durable storage, and the native web bundle

**Files:**
- Create: `src/app/platform/durable-storage.js`, `src/app/platform/web.js`, `src/app/platform/native.js`, `scripts/build-native.mjs`, `.vercelignore`
- Modify: `scripts/build.mjs`, `tests/unit/helpers/module-graph.js`, `package.json`, `package-lock.json`, `.gitignore`, `src/app/entries/app.js`, `src/app/create-services.js`, `src/app/supabase-client.js`, `src/app/screens/log.js`, `src/app/screens/training.js`, `src/app/screens/sign-out.js`, `src/app/ui/resource-view.js`
- Test: `tests/unit/durable-storage.test.js`, `tests/unit/build-native.test.js`, `tests/unit/build-config.test.js`, `tests/unit/supabase-client.test.js`, `tests/unit/log-screen.test.js`, `tests/unit/training-screen.test.js`, `tests/unit/sign-out-storage.test.js`

**Interfaces:**
- Consumes: `services.account` (Task 2); Plan 4's `ENTRY_POINTS`, `WORKER_ENTRY_POINTS`, `registerAppWorker`, `confirmSignOut`, `clearLocalTrainingData`.
- Produces (JS): `createDurableStorage({ preferences, legacy }) → Promise<{ getItem, setItem, removeItem, key, length, flush(): Promise<void> }>`, where `preferences` is `{ keys(), get({ key }), set({ key, value }), remove({ key }) }` (the `@capacitor/preferences` shape).
- Produces (JS): `createPlatform({ window })` from `roda:platform`, returning `{ isNative: boolean, name: 'web'|'ios'|'android', createStorage(): Promise<Storage>, flushStorage(): Promise<void>, authRedirectUrl: string|null, openAuthUrl: ((url) => Promise<void>)|null, onAppUrl(handler: (url: string) => void): void, closeBrowser(): Promise<void>, onBrowserClosed(handler): void, openExternal(url: string): void, onBackButton(handler): void, minimize(): void, appleSignIn: ((options: { nonce: string }) => Promise<{ idToken, givenName, familyName }>)|null, registerServiceWorker(): void, ready(): void }`. Constants exported from `native.js`: `APP_ID = 'fyi.roda.app'`, `AUTH_REDIRECT_URL = 'fyi.roda.app://auth-callback'`.
- Produces (build): `buildBrowserBundles({ test, outputDirectory, native })`; `platformPlugin(target: 'web'|'native')`; `scripts/build-native.mjs` exports `NATIVE_WEB_DIR = 'native-www'`, `findAppPage(root) → { name, html }`, `nativePageHtml(html) → string`, `buildNative({ root, outputDirectory, test }) → { page }`; npm script `build:native`.
- Produces (JS): `createRodaClient(config, createClient, { storage } = {})`; `createServices({ window, localMode, storage, platform })`; `ctx.storage`, `ctx.platform`, `ctx.openExternal(url)`; `createResourceSection({ …, storage })`.

- [ ] **Step 1: Install the pinned Capacitor packages**

Run:

```bash
npm install --save-dev --save-exact @capacitor/core@8.5.3 @capacitor/cli@8.5.3 @capacitor/android@8.5.3 \
  @capacitor/ios@8.5.3 @capacitor/app@8.1.2 @capacitor/browser@8.0.5 @capacitor/preferences@8.0.1 \
  @capacitor/splash-screen@8.0.2 @capacitor/keyboard@8.0.6 @capawesome/capacitor-apple-sign-in@0.1.4
```

Expected: `added … packages`, and `package.json` lists the ten packages with exact versions (no `^`).

- [ ] **Step 2: Write the failing tests**

```js
// tests/unit/durable-storage.test.js
import { describe, expect, it } from 'vitest';

import { createDurableStorage } from '../../src/app/platform/durable-storage.js';

function fakePreferences(initial = {}, { failSets = 0 } = {}) {
  const values = new Map(Object.entries(initial));
  let failures = failSets;
  return {
    values,
    keys: async () => ({ keys: [...values.keys()] }),
    get: async ({ key }) => ({ value: values.has(key) ? values.get(key) : null }),
    set: async ({ key, value }) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('disk full');
      }
      values.set(key, value);
    },
    remove: async ({ key }) => { values.delete(key); },
  };
}

function legacyStorage(entries) {
  const values = new Map(Object.entries(entries));
  return { getItem: (key) => values.get(key) ?? null, key: (index) => [...values.keys()][index] ?? null, get length() { return values.size; } };
}

describe('durable storage', () => {
  it('reads what an earlier session wrote', async () => {
    const preferences = fakePreferences({ 'roda.logDraft:p1': '{"notes":"x"}' });
    const storage = await createDurableStorage({ preferences });
    expect(storage.getItem('roda.logDraft:p1')).toBe('{"notes":"x"}');
    expect(storage.getItem('missing')).toBeNull();
  });

  it('keeps writes across a relaunch once flushed', async () => {
    const preferences = fakePreferences();
    const first = await createDurableStorage({ preferences });
    first.setItem('roda.pendingResources:o1', '[1]');
    first.setItem('roda.logDraft:p1', 'draft');
    first.removeItem('roda.logDraft:p1');
    expect(first.getItem('roda.pendingResources:o1')).toBe('[1]');
    await first.flush();
    const second = await createDurableStorage({ preferences });
    expect(second.getItem('roda.pendingResources:o1')).toBe('[1]');
    expect(second.getItem('roda.logDraft:p1')).toBeNull();
  });

  it('copies roda keys from WebView storage once without overwriting newer values', async () => {
    const preferences = fakePreferences({ 'roda.dashboard.locale': 'pt' });
    const storage = await createDurableStorage({
      preferences,
      legacy: legacyStorage({ 'roda.auth.session': 'token', 'roda.dashboard.locale': 'en', 'other.key': 'x' }),
    });
    await storage.flush();
    expect(storage.getItem('roda.auth.session')).toBe('token');
    expect(storage.getItem('roda.dashboard.locale')).toBe('pt');
    expect(storage.getItem('other.key')).toBeNull();
    expect(preferences.values.get('roda.auth.session')).toBe('token');
  });

  it('keeps working in memory when a write fails, and persists later writes', async () => {
    const preferences = fakePreferences({}, { failSets: 1 });
    const storage = await createDurableStorage({ preferences });
    storage.setItem('a', '1');
    storage.setItem('b', '2');
    await expect(storage.flush()).resolves.toBeUndefined();
    expect(storage.getItem('a')).toBe('1');
    expect(preferences.values.get('b')).toBe('2');
  });

  it('enumerates keys like Storage', async () => {
    const storage = await createDurableStorage({ preferences: fakePreferences({ x: '1', y: '2' }) });
    expect(storage.length).toBe(2);
    expect([storage.key(0), storage.key(1), storage.key(2)]).toEqual(['x', 'y', null]);
  });
});
```

```js
// tests/unit/build-native.test.js
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildNative, findAppPage, nativePageHtml } from '../../scripts/build-native.mjs';

describe('findAppPage', () => {
  it('picks the page that loads the app bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'roda-pages-'));
    try {
      await writeFile(join(root, 'dashboard.html'), '<script src="/assets/generated/dashboard.js"></script>');
      await writeFile(join(root, 'app.html'), '<script type="module" src="/assets/generated/app.js"></script>');
      expect((await findAppPage(root)).name).toBe('app.html');
      await writeFile(join(root, 'dashboard.html'), '<script type="module" src="/assets/generated/app.js"></script>');
      expect((await findAppPage(root)).name).toBe('dashboard.html');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails loudly when no page loads the app bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'roda-pages-'));
    try {
      await mkdir(root, { recursive: true });
      await expect(findAppPage(root)).rejects.toThrow('/assets/generated/app.js');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('nativePageHtml', () => {
  it('drops the web manifest and keeps everything else', () => {
    const html = '<head>\n  <link rel="manifest" href="/manifest.webmanifest">\n  <link rel="stylesheet" href="/assets/app.css">\n</head>';
    expect(nativePageHtml(html)).toBe('<head>\n  <link rel="stylesheet" href="/assets/app.css">\n</head>');
  });
});

describe('buildNative', () => {
  it('bundles the app with the native platform and every file the page links', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'roda-native-'));
    try {
      await buildNative({ outputDirectory, test: true });
      const html = await readFile(join(outputDirectory, 'index.html'), 'utf8');
      const linked = [...html.matchAll(/(?:href|src)="\/([^"#?]+)"/g)].map((match) => match[1]);
      expect(linked).toContain('assets/generated/app.js');
      for (const path of linked) await expect(access(join(outputDirectory, path))).resolves.toBeUndefined();
      const bundle = await readFile(join(outputDirectory, 'assets/generated/app.js'), 'utf8');
      expect(bundle).toContain('appUrlOpen');
      expect(bundle).not.toContain('dashboard-sw.js');
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  }, 60_000);
});
```

Add to `tests/unit/build-config.test.js`, inside `describe('buildBrowserBundles', …)`:

```js
  it('keeps Capacitor out of the web bundle', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'roda-web-build-'));
    try {
      await buildBrowserBundles({ test: true, outputDirectory });
      const bundle = await readFile(join(outputDirectory, 'app.js'), 'utf8');
      expect(bundle).not.toContain('appUrlOpen');
      expect(bundle).not.toContain('@capacitor');
      expect(bundle).toContain('dashboard-sw.js');
    } finally {
      await rm(outputDirectory, { force: true, recursive: true });
    }
  });
```

and add `readFile` to that file's `node:fs/promises` import.

Add to `tests/unit/supabase-client.test.js`, inside `describe('createRodaClient', …)`:

```js
  it('uses the storage the app provides when one is given', () => {
    const calls = [];
    const storage = { getItem() {}, setItem() {}, removeItem() {} };
    createRodaClient({ supabaseUrl: 'https://example.supabase.co', supabasePublishableKey: 'sb_publishable_x' },
      (...args) => { calls.push(args); return {}; }, { storage });
    expect(calls[0][2].auth.storage).toBe(storage);
  });
```

Add to `tests/unit/log-screen.test.js`, inside `describe('log screen', …)`:

```js
  it('keeps the draft in the storage the app provides', async () => {
    const values = new Map();
    const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
    const training = { createIdempotencyKey: vi.fn(() => 'key-1'), recordAloneTraining: vi.fn() };
    const view = await renderLog(ctx(training, { storage }));
    document.body.replaceChildren(view);
    send('ginga 10 min');
    await vi.waitFor(() => expect(values.get('roda.logDraft:p1')).toContain('ginga 10 min'));
    expect(localStorage.getItem('roda.logDraft:p1')).toBeNull();
  });
```

Add to `tests/unit/training-screen.test.js`, inside `describe('training screen', …)`:

```js
  it('reads waiting resources from the storage the app provides', async () => {
    const values = new Map([['roda.pendingResources:o1', JSON.stringify([
      { occurrenceId: 'o1', kind: 'summary', title: '', url: null, body: '# Notes' },
    ])]]);
    const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
    const training = { ...base, can_add_resources: true };
    const view = await renderTraining({ ...ctx({ getTraining: vi.fn().mockResolvedValue(training), addResource: vi.fn() }), storage },
      { params: { id: 'o1' } });
    expect(view.querySelector('[data-pending-resources]').textContent).toBe('1 resource waiting to sync.');
  });
```

```js
// tests/unit/sign-out-storage.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { confirmSignOut } from '../../src/app/screens/sign-out.js';

describe('sign out in the native apps', () => {
  it('clears drafts from the storage the app provides', async () => {
    const values = new Map([['roda.pendingResources:o1', '[]'], ['roda.dashboard.locale', 'en']]);
    const storage = {
      getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key),
      key: (index) => [...values.keys()][index] ?? null, get length() { return values.size; },
    };
    const i18n = createDashboardI18n({ document, storage, navigator: { languages: ['en'] } });
    const signOut = vi.fn();
    await confirmSignOut({ document, window, i18n, profile: { id: 'p1' }, storage, openSheet: vi.fn() }, { signOut });
    expect([...values.keys()]).toEqual(['roda.dashboard.locale']);
    expect(signOut).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/unit/durable-storage.test.js tests/unit/build-native.test.js tests/unit/build-config.test.js tests/unit/supabase-client.test.js tests/unit/log-screen.test.js tests/unit/training-screen.test.js tests/unit/sign-out-storage.test.js`
Expected: FAIL — `Cannot find module` for `durable-storage.js` and `build-native.mjs`; the client, log, training, and sign-out tests fail because `storage` is ignored. The new web-bundle test already passes; it guards the web build from here on.

- [ ] **Step 4: Write the durable storage adapter**

```js
// src/app/platform/durable-storage.js
// A synchronous Storage view over an async key-value store (Capacitor
// Preferences). Reads come from memory; writes land in memory at once and are
// persisted in order. flush() resolves when every write reached the store.
const PREFIX = 'roda.';

export async function createDurableStorage({ preferences, legacy = null }) {
  const values = new Map();
  const { keys } = await preferences.keys();
  for (const key of keys) {
    const { value } = await preferences.get({ key });
    if (value !== null && value !== undefined) values.set(key, value);
  }

  let queue = Promise.resolve();
  const persist = (operation) => {
    queue = queue.then(operation).catch(() => {});
  };

  const storage = {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem(key, value) {
      const text = String(value);
      values.set(key, text);
      persist(() => preferences.set({ key, value: text }));
    },
    removeItem(key) {
      values.delete(key);
      persist(() => preferences.remove({ key }));
    },
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    flush: () => queue,
  };

  // First native launch after an update: keep what WebView storage held.
  try {
    for (let index = 0; index < (legacy?.length ?? 0); index += 1) {
      const key = legacy.key(index);
      if (key?.startsWith(PREFIX) && !values.has(key)) storage.setItem(key, legacy.getItem(key));
    }
  } catch {
    // WebView storage blocked: nothing to copy.
  }
  return storage;
}
```

- [ ] **Step 5: Write the two platforms**

```js
// src/app/platform/web.js
// The browser: everything behaves exactly as it did before native builds.
import { registerAppWorker } from '../sw/register.js';

export function createPlatform({ window }) {
  const noop = () => {};
  return {
    isNative: false,
    name: 'web',
    createStorage: async () => window.localStorage,
    flushStorage: async () => {},
    authRedirectUrl: null,
    openAuthUrl: null,
    onAppUrl: noop,
    closeBrowser: async () => {},
    onBrowserClosed: noop,
    openExternal(url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    onBackButton: noop,
    minimize: noop,
    appleSignIn: null,
    registerServiceWorker() {
      if (!__RODA_E2E__) registerAppWorker({ navigator: window.navigator, caches: window.caches });
    },
    ready: noop,
  };
}
```

```js
// src/app/platform/native.js
// iOS and Android: Capacitor plugins behind the same interface as web.js.
import { AppleSignIn } from '@capawesome/capacitor-apple-sign-in';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { SplashScreen } from '@capacitor/splash-screen';

import { createDurableStorage } from './durable-storage.js';

export const APP_ID = 'fyi.roda.app';
export const AUTH_REDIRECT_URL = 'fyi.roda.app://auth-callback';
const SPLASH_FALLBACK_MS = 4000;

export function createPlatform({ window }) {
  const name = Capacitor.getPlatform();
  let storage = null;
  let splashHidden = false;
  const hideSplash = () => {
    if (splashHidden) return;
    splashHidden = true;
    SplashScreen.hide().catch(() => {});
  };
  window.setTimeout(hideSplash, SPLASH_FALLBACK_MS);

  return {
    isNative: true,
    name,
    async createStorage() {
      storage ??= await createDurableStorage({ preferences: Preferences, legacy: window.localStorage });
      return storage;
    },
    flushStorage: () => storage?.flush() ?? Promise.resolve(),
    authRedirectUrl: AUTH_REDIRECT_URL,
    openAuthUrl: (url) => Browser.open({ url }),
    onAppUrl(handler) {
      App.getLaunchUrl().then((launch) => { if (launch?.url) handler(launch.url); }).catch(() => {});
      App.addListener('appUrlOpen', ({ url }) => handler(url));
    },
    closeBrowser: () => Browser.close().catch(() => {}),
    onBrowserClosed(handler) {
      Browser.addListener('browserFinished', handler);
    },
    openExternal(url) {
      Browser.open({ url }).catch(() => {});
    },
    onBackButton(handler) {
      App.addListener('backButton', handler);
    },
    minimize() {
      App.minimizeApp().catch(() => {});
    },
    appleSignIn: name === 'ios'
      ? async ({ nonce }) => {
        await AppleSignIn.initialize({ clientId: APP_ID });
        const result = await AppleSignIn.signIn({ scopes: ['EMAIL', 'FULL_NAME'], nonce });
        return { idToken: result.idToken, givenName: result.givenName, familyName: result.familyName };
      }
      : null,
    registerServiceWorker() {
      // The files ship inside the app; a service worker would only cache stale copies.
    },
    ready: hideSplash,
  };
}
```

- [ ] **Step 6: Resolve `roda:platform` at build time and add the native build**

In `scripts/build.mjs`, change the `node:url` import and add the plugin:

```js
import { fileURLToPath, pathToFileURL } from 'node:url';
```

```js
const PLATFORM_FILES = Object.freeze({
  web: fileURLToPath(new URL('../src/app/platform/web.js', import.meta.url)),
  native: fileURLToPath(new URL('../src/app/platform/native.js', import.meta.url)),
});

// `roda:platform` is the only seam between the web and native builds.
export function platformPlugin(target) {
  return {
    name: 'roda-platform',
    setup(build) {
      build.onResolve({ filter: /^roda:platform$/ }, () => ({ path: PLATFORM_FILES[target] }));
    },
  };
}
```

Change `buildBrowserBundles` (as Plan 4 left it, using `ENTRY_POINTS` and `WORKER_ENTRY_POINTS`) so the signature and entry points read:

```js
export async function buildBrowserBundles({
  test = false,
  outputDirectory = 'assets/generated',
  native = false,
} = {}) {
  loadDotEnv({ path: '.env.local', quiet: true });
  const publicConfig = readPublicConfig(test ? TEST_CONFIG : process.env);
  // The apps load only the app page; they never register a service worker.
  const entryPoints = native ? { app: ENTRY_POINTS.app } : ENTRY_POINTS;
```

In the page `build({ … })` call add `plugins: [platformPlugin(native ? 'native' : 'web')],`. Wrap the `WORKER_ENTRY_POINTS` builds (`await Promise.all(Object.entries(WORKER_ENTRY_POINTS).map(…))`) in `if (!native) { … }`.

```js
// scripts/build-native.mjs
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildBrowserBundles } from './build.mjs';

export const NATIVE_WEB_DIR = 'native-www';
const APP_SCRIPT = '/assets/generated/app.js';
const PAGE_CANDIDATES = ['dashboard.html', 'app.html'];
const STATIC_FILES = ['favicon.svg', 'assets/app.css', 'assets/training-forms.css'];
const STATIC_DIRECTORIES = ['assets/fonts', 'assets/icons'];

export async function findAppPage(root = '.') {
  for (const name of PAGE_CANDIDATES) {
    let html;
    try {
      html = await readFile(join(root, name), 'utf8');
    } catch {
      continue;
    }
    if (html.includes(APP_SCRIPT)) return { name, html };
  }
  throw new Error(`No page in ${PAGE_CANDIDATES.join(', ')} loads ${APP_SCRIPT}`);
}

export function nativePageHtml(html) {
  return html.replace(/\s*<link rel="manifest"[^>]*>/, '');
}

export async function buildNative({ root = '.', outputDirectory = NATIVE_WEB_DIR, test = false } = {}) {
  const page = await findAppPage(root);
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(join(outputDirectory, 'assets'), { recursive: true });
  await buildBrowserBundles({ test, native: true, outputDirectory: join(outputDirectory, 'assets/generated') });
  for (const file of STATIC_FILES) await cp(join(root, file), join(outputDirectory, file));
  for (const directory of STATIC_DIRECTORIES) {
    await cp(join(root, directory), join(outputDirectory, directory), { recursive: true });
  }
  await writeFile(join(outputDirectory, 'index.html'), nativePageHtml(page.html));
  return { page: page.name };
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const { page } = await buildNative({ test: process.argv.includes('--test') });
  console.log(`Built ${NATIVE_WEB_DIR}/ from ${page}`);
}
```

Plan 4's module graph (`tests/unit/helpers/module-graph.js`, used by its dead-code and copy-usage tests) must resolve `roda:platform` too, and must count the native-only modules as loaded. Change its import, `reachableModules`, and `allModules`:

```js
import { ENTRY_POINTS, platformPlugin, WORKER_ENTRY_POINTS } from '../../../scripts/build.mjs';
```

```js
export async function reachableModules(entryPaths, platform = 'web') {
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
    plugins: [platformPlugin(platform)],
  });
  return Object.keys(result.metafile.inputs).filter((path) => path.startsWith('src/')).sort();
}
```

```js
// The web pages and workers, plus the app as the iOS and Android builds bundle it.
export async function allModules() {
  const [web, native] = await Promise.all([
    reachableModules([...Object.values(ENTRY_POINTS), ...Object.values(WORKER_ENTRY_POINTS)]),
    reachableModules([ENTRY_POINTS.app], 'native'),
  ]);
  return [...new Set([...web, ...native])].sort();
}
```

If the build test reports a linked file missing from `native-www` (for example a stylesheet Plan 3 added for the map), add it to `STATIC_FILES` or `STATIC_DIRECTORIES`.

In `package.json` `scripts`, add:

```json
    "build:native": "node scripts/build-native.mjs",
```

Append to `.gitignore`:

```gitignore
# Native apps (Capacitor): built web bundle and signing material.
native-www/
android/keystore.properties
*.jks
*.keystore
*.p8
*.p12
```

Create `.vercelignore` (Vercel serves the repo root, so keep the native folders off the website):

```gitignore
android/
ios/
native-www/
resources/
```

- [ ] **Step 7: Thread storage and the platform through the app**

`src/app/supabase-client.js`:

```js
export function createRodaClient(config, createClient = createSupabaseClient, { storage } = {}) {
  return createClient(
    config.supabaseUrl,
    config.supabasePublishableKey,
    {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'roda.auth.session',
        ...(storage ? { storage } : {}),
      },
    },
  );
}
```

`src/app/create-services.js` — new signature, and the real branch passes native storage only on native:

```js
export function createServices({ window, localMode, storage = window.localStorage, platform = null }) {
```

```js
  const client = createRodaClient(publicConfig, undefined, platform?.isNative ? { storage } : {});
  return {
    auth: createAuthService({ client, origin: window.location.origin, storage }),
```

(the rest of the real branch is unchanged; Task 5 adds the native auth options).

`src/app/screens/log.js`: replace `const storage = window.localStorage;` with:

```js
  const storage = ctx.storage ?? window.localStorage;
```

`src/app/ui/resource-view.js`: let callers pass storage:

```js
function pendingStore(document, occurrenceId, preferredStorage = null) {
  const key = `roda.pendingResources:${occurrenceId}`;
  let storage = preferredStorage;
  try {
    storage ??= document.defaultView?.localStorage ?? null;
  } catch {
    storage = null;
  }
```

```js
export function createResourceSection({ document, i18n, item, service, onChanged, storage = null }) {
  const pending = pendingStore(document, item.occurrence_id, storage);
```

`src/app/screens/training.js`: read pending resources from `ctx.storage` and pass it on:

```js
  let pending = [];
  try {
    const storage = ctx.storage ?? document.defaultView?.localStorage;
    pending = JSON.parse(storage?.getItem(`roda.pendingResources:${training.occurrence_id}`) ?? '[]');
  } catch {
    pending = [];
  }
```

and add `storage: ctx.storage,` to both `createResourceSection({ … })` calls in that file.

`src/app/entries/app.js`:

```js
import { createPlatform } from 'roda:platform';
```

Replace the start of `main()` up to `const root = …` with:

```js
async function main() {
  const platform = createPlatform({ window });
  const params = new URLSearchParams(location.search);
  const demoMode = params.get('demo') === '1';
  if (demoMode) seedDemoData(localStorage);
  const localMode = __RODA_E2E__ || demoMode;
  // Native builds keep private data in Capacitor Preferences; the web keeps localStorage.
  const storage = localMode ? localStorage : await platform.createStorage();
  const services = createServices({ window, localMode, storage, platform });
  const i18n = createDashboardI18n({ document, storage, navigator });
  const root = document.querySelector('#appRoot');
```

Add to the `ctx` object:

```js
    storage, platform,
    openExternal: (url) => platform.openExternal(url),
```

In the Settings `onDeleted` callback from Task 2, replace `clearLocalTrainingData(localStorage);` with `clearLocalTrainingData(storage);`.

Replace Plan 4's service-worker line at the end of `main()`:

```js
  if (!__RODA_E2E__) registerAppWorker({ navigator, caches: window.caches });
```

with:

```js
  platform.registerServiceWorker();
```

and remove the now-unused `registerAppWorker` import from `app.js`.

`src/app/screens/sign-out.js` (Plan 4): drafts and queued resources live in `ctx.storage` on native, so in `confirmSignOut` replace `const storage = localStorageOf(ctx.window);` with:

```js
  const storage = ctx.storage ?? localStorageOf(ctx.window);
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run tests/unit/durable-storage.test.js tests/unit/build-native.test.js tests/unit/build-config.test.js tests/unit/supabase-client.test.js tests/unit/log-screen.test.js tests/unit/training-screen.test.js tests/unit/sign-out-storage.test.js tests/unit/dead-code.test.js`
Expected: PASS (the dead-code test now sees `src/app/platform/native.js` and `durable-storage.js` through the native graph).

Run: `npm run build && npm run build:native`
Expected: the web build finishes silently; then `Built native-www/ from dashboard.html`.

Run: `ls native-www native-www/assets/generated`
Expected: `assets  favicon.svg  index.html` and `app.js`.

- [ ] **Step 9: Run the full suites and commit**

Run: `npm run test:unit && npm run test:e2e`
Expected: all pass (the web app is unchanged).

```bash
git add package.json package-lock.json .gitignore .vercelignore scripts/build.mjs scripts/build-native.mjs \
  tests/unit/helpers/module-graph.js \
  src/app/platform src/app/entries/app.js src/app/create-services.js src/app/supabase-client.js \
  src/app/screens/log.js src/app/screens/training.js src/app/screens/sign-out.js src/app/ui/resource-view.js \
  tests/unit/durable-storage.test.js tests/unit/build-native.test.js tests/unit/build-config.test.js \
  tests/unit/supabase-client.test.js tests/unit/log-screen.test.js tests/unit/training-screen.test.js \
  tests/unit/sign-out-storage.test.js
git commit -m "feat: add the native platform seam and build:native

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Capacitor projects, app identity, icons, and splash

**Files:**
- Create: `capacitor.config.json`, `scripts/native-version.mjs`, `resources/logo.png`, `android/` (generated), `ios/` (generated)
- Modify: `scripts/build-icons.mjs`, `package.json`, `android/app/src/main/AndroidManifest.xml`, `android/app/build.gradle`, `ios/App/App/Info.plist`
- Test: `tests/unit/native-version.test.js`

**Interfaces:**
- Consumes: `npm run build:native` and `native-www/` (Task 3).
- Produces (JS): `nativeVersion({ packageVersion, now }) → { name: string, code: number }`; CLI `node scripts/native-version.mjs name|code` prints one value.
- Produces (native): Android `applicationId` and iOS bundle ID `fyi.roda.app`; the `fyi.roda.app://auth-callback` deep link registered on both; Gradle properties `rodaVersionName` and `rodaVersionCode`; release signing from `android/keystore.properties` when the file exists.
- Produces (npm scripts): `native:sync`, `native:android`, `native:icons`.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/native-version.test.js
import { describe, expect, it } from 'vitest';

import { nativeVersion } from '../../scripts/native-version.mjs';

describe('nativeVersion', () => {
  it('uses package.json for the name and minutes since 2026 for the build number', () => {
    expect(nativeVersion({ packageVersion: '0.1.0', now: new Date('2026-10-12T00:00:00Z') }))
      .toEqual({ name: '0.1.0', code: 408_960 });
  });

  it('always increases and stays within the Android limit', () => {
    const earlier = nativeVersion({ packageVersion: '1.0.0', now: new Date('2026-10-12T10:00:00Z') }).code;
    const later = nativeVersion({ packageVersion: '1.0.0', now: new Date('2026-10-12T10:01:00Z') }).code;
    expect(later).toBe(earlier + 1);
    expect(nativeVersion({ packageVersion: '1.0.0', now: new Date('2100-01-01T00:00:00Z') }).code).toBeLessThan(2_100_000_000);
  });

  it('rejects versions the stores do not accept', () => {
    expect(() => nativeVersion({ packageVersion: '1.0', now: new Date('2026-10-12T00:00:00Z') })).toThrow('MAJOR.MINOR.PATCH');
    expect(() => nativeVersion({ packageVersion: '1.0.0', now: new Date('2025-12-31T23:59:00Z') })).toThrow('build epoch');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/native-version.test.js`
Expected: FAIL — `Cannot find module '../../scripts/native-version.mjs'`.

- [ ] **Step 3: Write the version script**

```js
// scripts/native-version.mjs
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const BUILD_EPOCH = Date.UTC(2026, 0, 1);

export function nativeVersion({ packageVersion, now = new Date() }) {
  if (!/^\d+\.\d+\.\d+$/.test(packageVersion ?? '')) {
    throw new Error('package.json version must be MAJOR.MINOR.PATCH');
  }
  const code = Math.floor((now.getTime() - BUILD_EPOCH) / 60_000);
  if (code < 1) throw new Error('The clock is before the build epoch');
  return { name: packageVersion, code };
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const { name, code } = nativeVersion({ packageVersion: version });
  const field = process.argv[2];
  console.log(field === 'name' ? name : field === 'code' ? String(code) : `${name} (${code})`);
}
```

Run: `npx vitest run tests/unit/native-version.test.js`
Expected: PASS.

- [ ] **Step 4: Add the Capacitor config and npm scripts**

```json
{
  "appId": "fyi.roda.app",
  "appName": "Roda",
  "webDir": "native-www",
  "backgroundColor": "#17120d",
  "appendUserAgent": "RodaApp/1 (+https://roda.fyi)",
  "ios": {
    "contentInset": "never"
  },
  "plugins": {
    "SystemBars": {
      "insetsHandling": "css",
      "style": "DARK"
    },
    "SplashScreen": {
      "launchAutoHide": false,
      "backgroundColor": "#17120d",
      "showSpinner": false
    },
    "Keyboard": {
      "resize": "native",
      "resizeOnFullScreen": true
    }
  }
}
```

Save it as `capacitor.config.json`. In `package.json` `scripts`, add:

```json
    "native:sync": "npm run build:native && cap sync",
    "native:android": "npm run native:sync && cd android && ./gradlew assembleDebug -ProdaVersionName=$(node ../scripts/native-version.mjs name) -ProdaVersionCode=$(node ../scripts/native-version.mjs code)",
    "native:icons": "node scripts/build-icons.mjs && npx --yes @capacitor/assets@3.0.5 generate --assetPath resources --iconBackgroundColor '#17120d' --iconBackgroundColorDark '#17120d' --splashBackgroundColor '#17120d' --splashBackgroundColorDark '#17120d' --ios --android",
```

- [ ] **Step 5: Generate the native projects**

Run: `npm run build:native && npx cap add android && npx cap add ios`
Expected: `✔ Adding native android project in android`, `✔ Adding native Xcode project in ios`, and `✔ Sync finished` for both. Capacitor 8 uses Swift Package Manager for iOS, so no CocoaPods step runs on Linux. If the iOS step stops with a macOS-only error, commit `android/` first and run `npx cap add ios` once on the macOS runner (Task 8's workflow with `workflow_dispatch`), committing the generated `ios/` from there.

Run: `git status --short android ios | head`
Expected: new files under `android/` and `ios/` only; `android/app/src/main/assets/public` and `ios/App/App/public` stay untracked (Capacitor's own `.gitignore` files).

- [ ] **Step 6: Register the deep link, versions, and release signing**

`android/app/src/main/AndroidManifest.xml` — inside the `MainActivity` `<activity>`, after the existing `MAIN`/`LAUNCHER` `<intent-filter>`:

```xml
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="fyi.roda.app" android:host="auth-callback" />
            </intent-filter>
```

`android/app/build.gradle` — after the `apply plugin: 'com.android.application'` line:

```groovy
def keystorePropertiesFile = rootProject.file('keystore.properties')
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystorePropertiesFile.withInputStream { keystoreProperties.load(it) }
}
```

In `defaultConfig`, replace the generated `versionCode …` and `versionName …` lines with:

```groovy
        versionCode = (project.findProperty('rodaVersionCode') ?: '1') as Integer
        versionName = project.findProperty('rodaVersionName') ?: '0.0.0'
```

Inside `android { … }`, before `buildTypes`:

```groovy
    signingConfigs {
        release {
            if (keystorePropertiesFile.exists()) {
                storeFile = file(keystoreProperties['storeFile'])
                storePassword = keystoreProperties['storePassword']
                keyAlias = keystoreProperties['keyAlias']
                keyPassword = keystoreProperties['keyPassword']
            }
        }
    }
```

and inside `buildTypes { release { … } }` add:

```groovy
            if (keystorePropertiesFile.exists()) {
                signingConfig = signingConfigs.release
            }
```

`ios/App/App/Info.plist` — before the final `</dict>`:

```xml
	<key>CFBundleURLTypes</key>
	<array>
		<dict>
			<key>CFBundleURLName</key>
			<string>fyi.roda.app</string>
			<key>CFBundleURLSchemes</key>
			<array>
				<string>fyi.roda.app</string>
			</array>
		</dict>
	</array>
	<key>ITSAppUsesNonExemptEncryption</key>
	<false/>
```

(The Info.plist template already uses `$(MARKETING_VERSION)` and `$(CURRENT_PROJECT_VERSION)`; the iOS build passes both from `native-version.mjs`.)

- [ ] **Step 7: Generate icons and splash screens**

Replace `scripts/build-icons.mjs` with:

```js
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Web icons for the manifest and iOS home screen, plus the 1024 px source image
// that `npm run native:icons` hands to @capacitor/assets.
const OUTPUTS = [
  [180, 'assets/icons/app-180.png'],
  [192, 'assets/icons/app-192.png'],
  [512, 'assets/icons/app-512.png'],
  [1024, 'resources/logo.png'],
];

const svg = await readFile('favicon.svg', 'utf8');
await mkdir('assets/icons', { recursive: true });
await mkdir('resources', { recursive: true });
const browser = await chromium.launch();
for (const [size, path] of OUTPUTS) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:#17120d">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
}
await browser.close();
console.log(`Wrote ${OUTPUTS.map(([, path]) => path).join(', ')}`);
```

Run: `npm run native:icons`
Expected: `Wrote assets/icons/app-180.png, assets/icons/app-192.png, assets/icons/app-512.png, resources/logo.png`, then `@capacitor/assets` lists the generated Android `mipmap-*`/`drawable*` files and the iOS `AppIcon`/`Splash` image sets.

- [ ] **Step 8: Build the Android debug app**

Prerequisites on the Linux machine: Android Studio Otter (or the command-line SDK) with SDK Platform 36 and Build-Tools 36, JDK 21 (`java -version` prints `21`), and `ANDROID_HOME` set.

Run: `npm run native:android`
Expected: `✔ Sync finished`, then Gradle ends with `BUILD SUCCESSFUL`, and `android/app/build/outputs/apk/debug/app-debug.apk` exists. Do not launch it yet: Task 5 adds the native sign-in screen.

Run: `"$(ls -d "$ANDROID_HOME"/build-tools/36.* | tail -1)/aapt2" dump xmltree --file AndroidManifest.xml android/app/build/outputs/apk/debug/app-debug.apk | grep -c 'fyi.roda.app'`
Expected: a count of at least `2` (the package name and the deep-link scheme).

- [ ] **Step 9: Commit**

```bash
git add capacitor.config.json scripts/native-version.mjs scripts/build-icons.mjs package.json \
  resources/logo.png android ios tests/unit/native-version.test.js
git commit -m "feat: add the iOS and Android projects

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Native sign-in (Google, email link, Apple)

**Files:**
- Create: `src/app/platform/auth-callback.js`, `src/app/screens/sign-in.js`
- Modify: `src/app/auth-service.js`, `src/app/create-services.js`, `src/app/entries/app.js`, `src/app/dashboard-i18n.js`, `assets/app.css`, `supabase/config.toml`
- Test: `tests/unit/auth-service.test.js`, `tests/unit/auth-callback.test.js`, `tests/unit/sign-in-screen.test.js`

**Interfaces:**
- Consumes: `platform.authRedirectUrl`, `platform.openAuthUrl`, `platform.onAppUrl`, `platform.closeBrowser`, `platform.onBrowserClosed`, `platform.appleSignIn`, `platform.flushStorage`, `platform.ready` (Task 3); the existing `auth.finishCallback(search) → { session, returnRoute }`.
- Produces (JS): `createAuthService({ client, origin, storage, redirectUrl, openUrl, crypto })`, adding `signInWithApple(authorize) → Promise<session>`; with `openUrl` set, `signInWithGoogle` uses `skipBrowserRedirect` and opens the returned URL.
- Produces (JS): `parseAuthCallback(url) → { search, key } | null`; `nativeHashFromReturnRoute(route) → '#/…'`; `createAuthCallbackHandler({ auth, closeBrowser, onSignedIn, onError }) → (url) => Promise<boolean>`.
- Produces (JS): `renderSignIn({ document, i18n, platform, auth, next, message, onSignedIn, onDemo }) → HTMLElement` with buttons `data-action="apple|google|demo"` and an email form.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/auth-service.test.js` (add `import { createHash } from 'node:crypto';` at the top):

```js
describe('createAuthService in the native apps', () => {
  it('opens Google in the system browser with the app callback', async () => {
    const { client, calls } = authClient({
      signInWithOAuth: async (request) => {
        calls.push(['oauth', request]);
        return { data: { url: 'https://example.supabase.co/auth/v1/authorize?provider=google' }, error: null };
      },
    });
    const opened = [];
    const storage = memoryStorage();
    const service = createAuthService({
      client, origin: 'capacitor://localhost', storage,
      redirectUrl: 'fyi.roda.app://auth-callback', openUrl: async (url) => { opened.push(url); },
    });
    await service.signInWithGoogle('/#/log');
    expect(calls[0]).toEqual(['oauth', {
      provider: 'google',
      options: { redirectTo: 'fyi.roda.app://auth-callback', skipBrowserRedirect: true },
    }]);
    expect(opened).toEqual(['https://example.supabase.co/auth/v1/authorize?provider=google']);
    expect(storage.getItem('roda.auth.returnRoute')).toBe('/#/log');
  });

  it('sends email links to the app callback', async () => {
    const { client, calls } = authClient();
    const service = createAuthService({
      client, origin: 'capacitor://localhost', storage: memoryStorage(), redirectUrl: 'fyi.roda.app://auth-callback',
    });
    await service.sendEmailLink('ana@example.com', '/#/');
    expect(calls[0][1].options.emailRedirectTo).toBe('fyi.roda.app://auth-callback');
  });

  it('signs in with Apple using a hashed nonce and saves the name Apple shares once', async () => {
    const { client, calls } = authClient({
      signInWithIdToken: async (request) => {
        calls.push(['idToken', request]);
        return { data: { session: { user: { id: 'u' } } }, error: null };
      },
      updateUser: async (request) => {
        calls.push(['updateUser', request]);
        return { data: {}, error: null };
      },
    });
    let sentNonce = null;
    const service = createAuthService({ client, origin: 'capacitor://localhost', storage: memoryStorage() });
    const session = await service.signInWithApple(async ({ nonce }) => {
      sentNonce = nonce;
      return { idToken: 'apple.jwt', givenName: 'Ana', familyName: 'Silva' };
    });
    expect(session).toEqual({ user: { id: 'u' } });
    const [, request] = calls.find(([type]) => type === 'idToken');
    expect(request).toMatchObject({ provider: 'apple', token: 'apple.jwt' });
    expect(request.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(createHash('sha256').update(request.nonce).digest('hex')).toBe(sentNonce);
    expect(calls).toContainEqual(['updateUser', { data: { full_name: 'Ana Silva' } }]);
  });

  it('does not touch the name when Apple shares none', async () => {
    const { client, calls } = authClient({
      signInWithIdToken: async () => ({ data: { session: { user: { id: 'u' } } }, error: null }),
      updateUser: async (request) => {
        calls.push(['updateUser', request]);
        return { data: {}, error: null };
      },
    });
    const service = createAuthService({ client, origin: 'capacitor://localhost', storage: memoryStorage() });
    await service.signInWithApple(async () => ({ idToken: 'apple.jwt', givenName: null, familyName: null }));
    expect(calls.some(([type]) => type === 'updateUser')).toBe(false);
  });
});
```

```js
// tests/unit/auth-callback.test.js
import { describe, expect, it, vi } from 'vitest';

import {
  createAuthCallbackHandler, nativeHashFromReturnRoute, parseAuthCallback,
} from '../../src/app/platform/auth-callback.js';

describe('parseAuthCallback', () => {
  it('accepts only the app callback', () => {
    expect(parseAuthCallback('fyi.roda.app://auth-callback?code=abc')).toEqual({ search: '?code=abc', key: 'abc' });
    expect(parseAuthCallback('fyi.roda.app://auth-callback?error=access_denied'))
      .toEqual({ search: '?error=access_denied', key: '?error=access_denied' });
    expect(parseAuthCallback('fyi.roda.app://other?code=abc')).toBeNull();
    expect(parseAuthCallback('https://roda.fyi/auth/callback?code=abc')).toBeNull();
    expect(parseAuthCallback('evil.app://auth-callback?code=abc')).toBeNull();
    expect(parseAuthCallback('not a url')).toBeNull();
  });
});

describe('nativeHashFromReturnRoute', () => {
  it('keeps only the in-app route', () => {
    expect(nativeHashFromReturnRoute('/dashboard#/training/abc')).toBe('#/training/abc');
    expect(nativeHashFromReturnRoute('/#/log')).toBe('#/log');
    expect(nativeHashFromReturnRoute('/dashboard')).toBe('#/');
    expect(nativeHashFromReturnRoute(null)).toBe('#/');
    expect(nativeHashFromReturnRoute('/#javascript:alert(1)')).toBe('#/');
  });
});

describe('createAuthCallbackHandler', () => {
  function setup(finishCallback = vi.fn().mockResolvedValue({ returnRoute: '/#/log' })) {
    const options = {
      auth: { finishCallback }, closeBrowser: vi.fn().mockResolvedValue(), onSignedIn: vi.fn(), onError: vi.fn(),
    };
    return { options, handle: createAuthCallbackHandler(options) };
  }

  it('closes the browser, exchanges each code once, and continues', async () => {
    const { options, handle } = setup();
    expect(await handle('fyi.roda.app://auth-callback?code=abc')).toBe(true);
    expect(await handle('fyi.roda.app://auth-callback?code=abc')).toBe(false);
    expect(options.closeBrowser).toHaveBeenCalledTimes(1);
    expect(options.auth.finishCallback).toHaveBeenCalledWith('?code=abc');
    expect(options.onSignedIn).toHaveBeenCalledWith('/#/log');
  });

  it('ignores links that are not sign-in callbacks', async () => {
    const { options, handle } = setup();
    expect(await handle('https://roda.fyi/dashboard')).toBe(false);
    expect(options.auth.finishCallback).not.toHaveBeenCalled();
  });

  it('reports a denied or broken callback', async () => {
    const { options, handle } = setup(vi.fn().mockRejectedValue(new Error('missing code')));
    await handle('fyi.roda.app://auth-callback?error=access_denied');
    expect(options.onError).toHaveBeenCalled();
    expect(options.onSignedIn).not.toHaveBeenCalled();
  });
});
```

```js
// tests/unit/sign-in-screen.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { renderSignIn } from '../../src/app/screens/sign-in.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

function platform(name) {
  let closed = () => {};
  return {
    name, isNative: true,
    appleSignIn: name === 'ios' ? vi.fn() : null,
    onBrowserClosed: (handler) => { closed = handler; },
    closeBrowserNow: () => closed(),
  };
}

function auth(overrides = {}) {
  return {
    signInWithGoogle: vi.fn().mockResolvedValue({}),
    sendEmailLink: vi.fn().mockResolvedValue({}),
    signInWithApple: vi.fn().mockResolvedValue({ user: { id: 'u' } }),
    ...overrides,
  };
}

function render(options) {
  const view = renderSignIn({ document, i18n, next: '/#/log', onSignedIn: vi.fn(), onDemo: vi.fn(), ...options });
  document.body.replaceChildren(view);
  return view;
}

const button = (view, action) => view.querySelector(`button[data-action="${action}"]`);

describe('native sign-in screen', () => {
  it('offers Apple only on iOS', () => {
    expect(button(render({ platform: platform('ios'), auth: auth() }), 'apple').textContent).toBe('Continue with Apple');
    expect(button(render({ platform: platform('android'), auth: auth() }), 'apple')).toBeNull();
  });

  it('opens Google and re-enables the buttons when the browser is closed', async () => {
    const native = platform('android');
    const service = auth();
    const view = render({ platform: native, auth: service });
    button(view, 'google').click();
    await vi.waitFor(() => expect(service.signInWithGoogle).toHaveBeenCalledWith('/#/log'));
    expect(button(view, 'google').disabled).toBe(true);
    native.closeBrowserNow();
    expect(button(view, 'google').disabled).toBe(false);
    expect(view.querySelector('[role="status"]').textContent).toBe('');
  });

  it('signs in with Apple and continues to the remembered route', async () => {
    const onSignedIn = vi.fn();
    const native = platform('ios');
    const service = auth();
    const view = render({ platform: native, auth: service, onSignedIn });
    button(view, 'apple').click();
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledWith('/#/log'));
    expect(service.signInWithApple).toHaveBeenCalledWith(native.appleSignIn);
  });

  it('treats a cancelled Apple sheet as if nothing happened', async () => {
    const service = auth({
      signInWithApple: vi.fn().mockRejectedValue(Object.assign(new Error('The user canceled'), { code: 'SIGN_IN_CANCELED' })),
    });
    const view = render({ platform: platform('ios'), auth: service });
    button(view, 'apple').click();
    await vi.waitFor(() => expect(button(view, 'apple').disabled).toBe(false));
    expect(view.querySelector('[role="status"]').textContent).toBe('');
  });

  it('sends an email link and asks to open it on this phone', async () => {
    const service = auth();
    const view = render({ platform: platform('android'), auth: service });
    view.querySelector('input[type="email"]').value = 'ana@example.com';
    view.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(view.querySelector('[role="status"]').textContent)
      .toBe('Check your email on this phone and open the link.'));
    expect(service.sendEmailLink).toHaveBeenCalledWith('ana@example.com', '/#/log');
  });

  it('shows a message after a failed callback and opens the demo', () => {
    const onDemo = vi.fn();
    const view = render({ platform: platform('android'), auth: auth(), message: 'Sign-in needs another try.', onDemo });
    expect(view.querySelector('[role="status"]').textContent).toBe('Sign-in needs another try.');
    button(view, 'demo').click();
    expect(onDemo).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/auth-service.test.js tests/unit/auth-callback.test.js tests/unit/sign-in-screen.test.js`
Expected: FAIL — missing modules `auth-callback.js` and `sign-in.js`; the native auth-service tests fail (`skipBrowserRedirect` missing, `signInWithApple is not a function`). The existing web auth-service tests still pass.

- [ ] **Step 3: Extend the auth service**

In `src/app/auth-service.js`, add helpers above `createAuthService`:

```js
function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomNonce(crypto) {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256Hex(crypto, text) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}
```

Change the factory signature and the three sign-in methods (the other methods stay as they are):

```js
export function createAuthService({
  client, origin, storage, redirectUrl = callbackUrl(origin), openUrl = null, crypto = globalThis.crypto,
}) {
  return {
    async signInWithGoogle(next = '/dashboard') {
      const route = sanitizeReturnRoute(next);
      rememberReturnRoute(storage, route);
      const result = await client.auth.signInWithOAuth({
        provider: 'google',
        // Native apps open the URL in the system browser themselves; Google
        // refuses sign-in inside an embedded WebView.
        options: openUrl ? { redirectTo: redirectUrl, skipBrowserRedirect: true } : { redirectTo: redirectUrl },
      });
      const data = unwrap(result);
      if (openUrl) await openUrl(data.url);
      return data;
    },

    async sendEmailLink(email, next = '/dashboard') {
      const normalizedEmail = email?.trim() ?? '';
      if (!validEmail(normalizedEmail)) {
        throw new AppError('validation', 'invalid_email');
      }

      const route = sanitizeReturnRoute(next);
      rememberReturnRoute(storage, route);
      const result = await client.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: redirectUrl,
          shouldCreateUser: true,
        },
      });
      return unwrap(result);
    },

    // iOS only. Apple gets the hashed nonce; Supabase gets the raw one and
    // checks that the ID token carries its hash.
    async signInWithApple(authorize) {
      const rawNonce = randomNonce(crypto);
      const credential = await authorize({ nonce: await sha256Hex(crypto, rawNonce) });
      const data = unwrap(await client.auth.signInWithIdToken({
        provider: 'apple', token: credential.idToken, nonce: rawNonce,
      }));
      const fullName = [credential.givenName, credential.familyName].filter(Boolean).join(' ').trim();
      if (fullName) {
        try {
          await client.auth.updateUser({ data: { full_name: fullName } });
        } catch {
          // Apple shares the name only once; the welcome screen still asks for one.
        }
      }
      return data.session;
    },
```

- [ ] **Step 4: Write the deep-link handler**

```js
// src/app/platform/auth-callback.js
const CALLBACK_PROTOCOL = 'fyi.roda.app:';
const CALLBACK_HOST = 'auth-callback';

export function parseAuthCallback(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== CALLBACK_PROTOCOL || parsed.host !== CALLBACK_HOST) return null;
  return { search: parsed.search, key: parsed.searchParams.get('code') ?? parsed.search };
}

// Return routes are page paths like '/dashboard#/log'; the app only needs the hash.
export function nativeHashFromReturnRoute(route) {
  const hash = String(route ?? '').split('#')[1] ?? '';
  return hash.startsWith('/') ? `#${hash}` : '#/';
}

// The launch URL and appUrlOpen can both deliver the same link; exchange each once.
export function createAuthCallbackHandler({ auth, closeBrowser, onSignedIn, onError }) {
  const seen = new Set();
  return async function handleAuthCallback(url) {
    const callback = parseAuthCallback(url);
    if (!callback || seen.has(callback.key)) return false;
    seen.add(callback.key);
    await closeBrowser();
    try {
      const { returnRoute } = await auth.finishCallback(callback.search);
      await onSignedIn(returnRoute);
    } catch (error) {
      onError(error);
    }
    return true;
  };
}
```

- [ ] **Step 5: Write the sign-in screen**

```js
// src/app/screens/sign-in.js
import { el } from '../shell/page.js';

const CANCELLED = /cancel/i;

function isCancel(error) {
  return CANCELLED.test(String(error?.code ?? '')) || CANCELLED.test(String(error?.message ?? ''));
}

// Native apps only: on the web, sign-in lives on index.html.
export function renderSignIn({ document, i18n, platform, auth, next, message = '', onSignedIn, onDemo }) {
  const status = el(document, 'p', { className: 'sign-in-status', text: message, attrs: { role: 'status' } });
  const controls = [];
  let busy = false;

  function setBusy(value, text = '') {
    busy = value;
    for (const control of controls) control.disabled = value;
    status.textContent = text;
  }

  function fail(error) {
    setBusy(false, isCancel(error) ? '' : (error?.message || i18n.t('signIn.error')));
  }

  function action(name, className, key, run) {
    const button = el(document, 'button', {
      className, text: i18n.t(key), attrs: { type: 'button' }, dataset: { action: name },
      on: {
        click: async () => {
          if (busy) return;
          try {
            await run();
          } catch (error) {
            fail(error);
          }
        },
      },
    });
    controls.push(button);
    return button;
  }

  const apple = platform.appleSignIn
    ? action('apple', 'button-primary', 'signIn.apple', async () => {
      setBusy(true, i18n.t('signIn.opening'));
      const session = await auth.signInWithApple(platform.appleSignIn);
      if (session) await onSignedIn(next);
    })
    : null;
  const google = action('google', apple ? 'button-secondary' : 'button-primary', 'signIn.google', async () => {
    setBusy(true, i18n.t('signIn.opening'));
    await auth.signInWithGoogle(next);
  });
  platform.onBrowserClosed(() => {
    if (busy) setBusy(false);
  });

  const email = el(document, 'input', {
    className: 'field-input',
    attrs: { type: 'email', required: true, autocomplete: 'email', 'aria-label': i18n.t('signIn.email'), placeholder: i18n.t('signIn.email') },
  });
  const send = el(document, 'button', { className: 'button-secondary', text: i18n.t('signIn.sendLink'), attrs: { type: 'submit' } });
  controls.push(email, send);
  const form = el(document, 'form', { className: 'sign-in-email', attrs: { novalidate: true } }, [email, send]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!form.checkValidity()) {
      form.reportValidity?.();
      return;
    }
    setBusy(true, i18n.t('signIn.sending'));
    try {
      await auth.sendEmailLink(email.value, next);
      setBusy(false, i18n.t('signIn.checkEmail'));
    } catch (error) {
      fail(error);
    }
  });
  const demo = action('demo', 'button-secondary', 'signIn.demo', async () => onDemo());

  return el(document, 'section', { className: 'screen screen-sign-in' }, [
    el(document, 'h1', { className: 'page-title', text: i18n.t('signIn.title') }),
    el(document, 'p', { className: 'muted', text: i18n.t('signIn.lead') }),
    apple, google, form, demo, status,
  ]);
}
```

- [ ] **Step 6: Add copy and styles**

In `src/app/dashboard-i18n.js`, add to `en`:

```js
    'signIn.title': 'Welcome to Roda',
    'signIn.lead': 'Train, teach, and track capoeira.',
    'signIn.apple': 'Continue with Apple',
    'signIn.google': 'Continue with Google',
    'signIn.email': 'Email address',
    'signIn.sendLink': 'Email me a sign-in link',
    'signIn.sending': 'Sending your sign-in link…',
    'signIn.checkEmail': 'Check your email on this phone and open the link.',
    'signIn.opening': 'Opening sign-in…',
    'signIn.demo': 'Try the demo',
    'signIn.error': 'Sign-in needs another try.',
```

and to `pt`:

```js
    'signIn.title': 'Bem-vindo à Roda',
    'signIn.lead': 'Treina, ensina e acompanha a tua capoeira.',
    'signIn.apple': 'Continuar com a Apple',
    'signIn.google': 'Continuar com o Google',
    'signIn.email': 'Endereço de email',
    'signIn.sendLink': 'Enviar-me um link de entrada',
    'signIn.sending': 'A enviar o link de entrada…',
    'signIn.checkEmail': 'Abre o email neste telemóvel e toca no link.',
    'signIn.opening': 'A abrir o início de sessão…',
    'signIn.demo': 'Experimentar a demo',
    'signIn.error': 'O início de sessão precisa de outra tentativa.',
```

Append to `assets/app.css`:

```css
.screen-sign-in { min-height: 100vh; display: flex; flex-direction: column; justify-content: center; gap: 12px; padding-bottom: calc(32px + var(--safe-bottom)); }
.screen-sign-in > .button-primary, .screen-sign-in > .button-secondary, .sign-in-email .button-secondary { width: 100%; margin: 0; }
.sign-in-email { display: grid; gap: 8px; margin-top: 12px; }
.sign-in-status { min-height: 1.4em; color: var(--muted); }
```

- [ ] **Step 7: Wire native auth into services and the app**

In `src/app/create-services.js`, the real `auth` entry becomes:

```js
    auth: createAuthService({
      client, origin: window.location.origin, storage,
      redirectUrl: platform?.authRedirectUrl ?? undefined,
      openUrl: platform?.openAuthUrl ?? null,
    }),
```

On the web, `authRedirectUrl` and `openAuthUrl` are `null`, so the service gets its defaults and behaves exactly as before.

In `src/app/entries/app.js`, add imports:

```js
import { createAuthCallbackHandler, nativeHashFromReturnRoute } from '../platform/auth-callback.js';
import { renderSignIn } from '../screens/sign-in.js';
```

Replace Plan 4's `toSignIn` line:

```js
  const toSignIn = () => location.replace(`/?next=${encodeURIComponent(`${location.pathname}${location.search}${location.hash}`)}`);
```

with:

```js
  const webSignIn = () => location.replace(`/?next=${encodeURIComponent(`${location.pathname}${location.search}${location.hash}`)}`);
  const restartAt = async (route) => {
    await platform.flushStorage();
    location.replace(`/${nativeHashFromReturnRoute(route)}`);
  };
  const showSignIn = (message = '') => {
    root.replaceChildren(renderSignIn({
      document, i18n, platform, auth: services.auth, next: `/${location.hash}`, message,
      onSignedIn: restartAt,
      onDemo: () => location.replace('/?demo=1'),
    }));
    platform.ready();
  };
  const toSignIn = platform.isNative ? () => showSignIn() : webSignIn;
  platform.onAppUrl(createAuthCallbackHandler({
    auth: services.auth,
    closeBrowser: () => platform.closeBrowser(),
    onSignedIn: restartAt,
    onError: () => showSignIn(i18n.t('signIn.error')),
  }));
```

In `supabase/config.toml`, add the native callback to `additional_redirect_urls`:

```toml
additional_redirect_urls = ["https://roda.fyi/auth/callback", "http://127.0.0.1:8137/auth/callback", "http://localhost:*/auth/callback", "fyi.roda.app://auth-callback"]
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run tests/unit/auth-service.test.js tests/unit/auth-callback.test.js tests/unit/sign-in-screen.test.js tests/unit/dashboard-i18n.test.js`
Expected: PASS.

Run: `npm run test:unit && npm run test:e2e`
Expected: all pass (the web still signs in on `index.html`).

- [ ] **Step 9: Try it on Android**

Prerequisite: owner step O-1 (the Supabase redirect URL) is done for the project in `.env.local`.

Run:

```bash
npm run native:android
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n fyi.roda.app/.MainActivity
```

Expected: the splash, then "Welcome to Roda" with Google, email, and demo (no Apple button on Android). "Continue with Google" opens a Chrome Custom Tab; after choosing an account the app comes back on Today, signed in.

Run: `adb shell am start -a android.intent.action.VIEW -d "fyi.roda.app://auth-callback?error=access_denied" fyi.roda.app` after signing out from Settings.
Expected: the sign-in screen shows "Sign-in needs another try."

- [ ] **Step 10: Commit**

```bash
git add src/app/auth-service.js src/app/platform/auth-callback.js src/app/screens/sign-in.js \
  src/app/create-services.js src/app/entries/app.js src/app/dashboard-i18n.js assets/app.css supabase/config.toml \
  tests/unit/auth-service.test.js tests/unit/auth-callback.test.js tests/unit/sign-in-screen.test.js
git commit -m "feat: sign in from the native apps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Native shell: back button, splash, and system bars

**Files:**
- Create: `src/app/platform/back-button.js`
- Modify: `src/app/shell/sheet.js`, `src/app/entries/app.js`, `assets/app.css`
- Test: `tests/unit/back-button.test.js`, `tests/unit/sheet.test.js`, `tests/unit/app-css.test.js`

**Interfaces:**
- Consumes: `parseRoute`, `isDetail` from `src/app/shell/router.js`; `router.back(fallback)`, `router.navigate(path)`; `platform.onBackButton`, `platform.minimize`, `platform.ready` (Task 3).
- Produces (JS): `backAction({ sheetOpen: boolean, route: Route | null }) → { type: 'close-sheet' } | { type: 'back', fallback: string } | { type: 'home' } | { type: 'minimize' }`; `isSheetOpen() → boolean` from `sheet.js`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/back-button.test.js
import { describe, expect, it } from 'vitest';

import { backAction } from '../../src/app/platform/back-button.js';
import { parseRoute } from '../../src/app/shell/router.js';

const at = (hash, sheetOpen = false) => backAction({ sheetOpen, route: parseRoute(hash) });

describe('backAction', () => {
  it('closes an open sheet first', () => {
    expect(at('#/training/abc', true)).toEqual({ type: 'close-sheet' });
    expect(at('#/', true)).toEqual({ type: 'close-sheet' });
  });

  it('goes back from detail pages with the same fallback as the in-app Back button', () => {
    expect(at('#/training/abc')).toEqual({ type: 'back', fallback: '/' });
    expect(at('#/log')).toEqual({ type: 'back', fallback: '/' });
    expect(at('#/me/settings')).toEqual({ type: 'back', fallback: '/me' });
    expect(at('#/me/teaching/plans/p1')).toEqual({ type: 'back', fallback: '/me/teaching' });
  });

  it('returns to Today from the other tabs', () => {
    expect(at('#/calendar')).toEqual({ type: 'home' });
    expect(at('#/discover')).toEqual({ type: 'home' });
    expect(at('#/me')).toEqual({ type: 'home' });
  });

  it('minimizes on Today and before any route is shown', () => {
    expect(at('#/')).toEqual({ type: 'minimize' });
    expect(backAction({ sheetOpen: false, route: null })).toEqual({ type: 'minimize' });
  });
});
```

Add to `tests/unit/sheet.test.js` (import `closeSheet` and `isSheetOpen` alongside `openSheet`):

```js
  it('reports whether a sheet is open', () => {
    closeSheet();
    expect(isSheetOpen()).toBe(false);
    const sheet = openSheet({ document, title: 'Notes', content: document.createElement('p') });
    expect(isSheetOpen()).toBe(true);
    sheet.close();
    expect(isSheetOpen()).toBe(false);
  });
```

Add to `tests/unit/app-css.test.js`:

```js
  it('reads the native safe-area variables before env()', async () => {
    const css = await readFile('assets/app.css', 'utf8');
    expect(css).toContain('var(--safe-area-inset-top, env(safe-area-inset-top, 0px))');
    const wrapped = /var\(--safe-area-inset-(top|right|bottom|left), env\(safe-area-inset-\1, 0px\)\)/g;
    expect(css.replace(wrapped, '')).not.toContain('env(safe-area-inset');
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/back-button.test.js tests/unit/sheet.test.js tests/unit/app-css.test.js`
Expected: FAIL — missing `back-button.js`; `isSheetOpen is not a function`; the CSS still has bare `env(safe-area-inset-…)`.

- [ ] **Step 3: Implement**

```js
// src/app/platform/back-button.js
import { isDetail } from '../shell/router.js';

// Matches the fallbacks the screens pass to ctx.back().
const DETAIL_FALLBACK = Object.freeze({
  'me-section': '/me',
  'teaching-plan': '/me/teaching',
  'teaching-student': '/me/teaching',
});

export function backAction({ sheetOpen, route }) {
  if (sheetOpen) return { type: 'close-sheet' };
  if (!route) return { type: 'minimize' };
  if (isDetail(route)) return { type: 'back', fallback: DETAIL_FALLBACK[route.name] ?? '/' };
  if (route.name !== 'today') return { type: 'home' };
  return { type: 'minimize' };
}
```

In `src/app/shell/sheet.js`, after `closeSheet`:

```js
export function isSheetOpen() {
  return current !== null;
}
```

In `assets/app.css`, wrap every safe-area `env()` in the SystemBars variable:

```bash
sed -i -E 's/env\(safe-area-inset-(top|right|bottom|left), 0px\)/var(--safe-area-inset-\1, env(safe-area-inset-\1, 0px))/g' assets/app.css
```

Run: `grep -n "safe-area" assets/app.css`
Expected: every match reads `var(--safe-area-inset-<side>, env(safe-area-inset-<side>, 0px))`, including `--safe-bottom` on line 10.

In `src/app/entries/app.js`:

```js
import { backAction } from '../platform/back-button.js';
import { closeSheet, isSheetOpen, openSheet } from '../shell/sheet.js';
```

(replacing the existing `sheet.js` import). Next to `let lastTopLevel = …`, add `let currentRoute = null;`, and make `currentRoute = route;` the first line of `show(route)`. After `root.replaceChildren(layout.root);` add `platform.ready();`, and add `platform.ready();` after the error screen's `root.replaceChildren(…)` too. After `router.start();`:

```js
  platform.onBackButton(() => {
    const action = backAction({ sheetOpen: isSheetOpen(), route: currentRoute });
    if (action.type === 'close-sheet') closeSheet();
    else if (action.type === 'back') router.back(action.fallback);
    else if (action.type === 'home') router.navigate('/');
    else platform.minimize();
  });
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/back-button.test.js tests/unit/sheet.test.js tests/unit/app-css.test.js`
Expected: PASS.

Run: `npm run test:unit && npm run test:e2e`
Expected: all pass (on the web, `var(--safe-area-inset-*)` is undefined, so `env()` applies as before).

- [ ] **Step 5: Check Back on Android**

Run: `npm run native:android && adb install -r android/app/build/outputs/apk/debug/app-debug.apk && adb shell am start -n fyi.roda.app/.MainActivity`, sign in, then for each case press `adb shell input keyevent KEYCODE_BACK`:

| Start | Expected after Back |
|-------|---------------------|
| A training page opened from Today | Today |
| A resource sheet open on a training page | Sheet closed, still on the training page |
| Me → Settings | Me |
| Calendar tab | Today |
| Today | App in the background (`adb shell dumpsys activity activities \| grep mResumedActivity` no longer shows `fyi.roda.app`) |

Also expected: the splash disappears as soon as Today renders; the status bar shows light icons on the dark background; nothing sits under the status bar or the gesture bar.

- [ ] **Step 6: Commit**

```bash
git add src/app/platform/back-button.js src/app/shell/sheet.js src/app/entries/app.js assets/app.css \
  tests/unit/back-button.test.js tests/unit/sheet.test.js tests/unit/app-css.test.js
git commit -m "feat: wire Android Back, the splash, and safe areas in the native apps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: External links and YouTube in the native apps

**Files:**
- Create: `src/app/platform/external-links.js`, `embed/youtube.html`
- Modify: `src/app/screens/youtube.js`, `src/app/screens/training.js`, `src/app/entries/app.js`
- Test: `tests/unit/external-links.test.js`, `tests/unit/youtube.test.js`, `tests/unit/youtube-player-page.test.js`, `tests/unit/training-screen.test.js`

**Interfaces:**
- Consumes: `ctx.platform`, `ctx.openExternal` (Task 3); `platform.openExternal`.
- Produces (JS): `isExternalUrl(href, appOrigin) → boolean`; `installExternalLinks({ document, appOrigin, openExternal }) → () => void` (uninstall); `youtubeEmbedUrl(url, { native } = {})`; `NATIVE_YOUTUBE_PLAYER = 'https://roda.fyi/embed/youtube?v='`.
- Produces (web): the page `https://roda.fyi/embed/youtube?v=<11-character id>` (Vercel `cleanUrls` serves `embed/youtube.html`).

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/external-links.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { installExternalLinks, isExternalUrl } from '../../src/app/platform/external-links.js';

describe('isExternalUrl', () => {
  it('flags only http(s) links that leave the app', () => {
    expect(isExternalUrl('https://youtu.be/VAI3JUKTwz0', 'capacitor://localhost')).toBe(true);
    expect(isExternalUrl('http://example.com/page', 'https://localhost')).toBe(true);
    expect(isExternalUrl('https://localhost/#/me', 'https://localhost')).toBe(false);
    expect(isExternalUrl('#/training/1', 'capacitor://localhost')).toBe(false);
    expect(isExternalUrl('mailto:ana@example.com', 'capacitor://localhost')).toBe(false);
    expect(isExternalUrl('javascript:alert(1)', 'capacitor://localhost')).toBe(false);
  });
});

describe('installExternalLinks', () => {
  it('opens leaving links in the system browser and leaves in-app links alone', () => {
    const openExternal = vi.fn();
    const uninstall = installExternalLinks({ document, appOrigin: 'capacitor://localhost', openExternal });
    document.body.innerHTML = '<a id="out" href="https://youtu.be/VAI3JUKTwz0" target="_blank"><span>Video</span></a><a id="in" href="#/me">Me</a>';
    const out = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('#out span').dispatchEvent(out);
    expect(out.defaultPrevented).toBe(true);
    expect(openExternal).toHaveBeenCalledWith('https://youtu.be/VAI3JUKTwz0');
    const inside = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('#in').dispatchEvent(inside);
    expect(inside.defaultPrevented).toBe(false);
    expect(openExternal).toHaveBeenCalledTimes(1);
    uninstall();
  });
});
```

Add to `tests/unit/youtube.test.js`:

```js
  it('plays through the roda.fyi player in the native apps', () => {
    expect(youtubeEmbedUrl('https://youtu.be/VAI3JUKTwz0', { native: true })).toBe('https://roda.fyi/embed/youtube?v=VAI3JUKTwz0');
    expect(youtubeEmbedUrl('https://vimeo.com/1', { native: true })).toBeNull();
  });
```

```js
// tests/unit/youtube-player-page.test.js
import { readFile } from 'node:fs/promises';

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const html = await readFile('embed/youtube.html', 'utf8');

function load(search) {
  return new JSDOM(html, { url: `https://roda.fyi/embed/youtube${search}`, runScripts: 'dangerously' }).window.document;
}

describe('YouTube player page', () => {
  it('embeds a valid video with a referrer YouTube accepts', () => {
    const doc = load('?v=VAI3JUKTwz0');
    const frame = doc.querySelector('iframe');
    expect(frame.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/VAI3JUKTwz0');
    expect(frame.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
    expect(doc.querySelector('meta[name="referrer"]').getAttribute('content')).toBe('strict-origin-when-cross-origin');
  });

  it('embeds nothing for anything that is not a video id', () => {
    for (const search of ['', '?v=', '?v=javascript:alert(1)', '?v=../../x', '?v=VAI3JUKTwz0x']) {
      expect(load(search).querySelector('iframe')).toBeNull();
    }
  });
});
```

Add to `tests/unit/training-screen.test.js`:

```js
  it('plays the video through the roda.fyi player and opens other videos outside the app on native', async () => {
    const openExternal = vi.fn();
    const training = { ...base, resources: [...base.resources, { id: 'v2', kind: 'video', title: 'Other', url: 'https://vimeo.com/1', body: null, can_edit: false }] };
    const view = await renderTraining({ ...ctx({ getTraining: vi.fn().mockResolvedValue(training) }), platform: { isNative: true }, openExternal },
      { params: { id: 'o1' } });
    expect(view.querySelector('iframe').getAttribute('src')).toBe('https://roda.fyi/embed/youtube?v=VAI3JUKTwz0');
    view.querySelector('button[data-resource="v2"]').click();
    expect(openExternal).toHaveBeenCalledWith('https://vimeo.com/1');
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/external-links.test.js tests/unit/youtube.test.js tests/unit/youtube-player-page.test.js tests/unit/training-screen.test.js`
Expected: FAIL — missing `external-links.js` and `embed/youtube.html`; `youtubeEmbedUrl` ignores `native`; the training page still embeds `youtube-nocookie.com`.

- [ ] **Step 3: Implement**

```js
// src/app/platform/external-links.js
export function isExternalUrl(href, appOrigin) {
  let url;
  try {
    url = new URL(href, appOrigin);
  } catch {
    return false;
  }
  return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin !== appOrigin;
}

// Native apps: links that leave the app open in the in-app system browser
// (SFSafariViewController / Custom Tabs) instead of replacing the app.
export function installExternalLinks({ document, appOrigin, openExternal }) {
  const onClick = (event) => {
    if (event.defaultPrevented) return;
    const link = event.target?.closest?.('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!isExternalUrl(href, appOrigin)) return;
    event.preventDefault();
    openExternal(new URL(href, appOrigin).href);
  };
  document.addEventListener('click', onClick);
  return () => document.removeEventListener('click', onClick);
}
```

`src/app/screens/youtube.js` — replace `youtubeEmbedUrl`:

```js
// WKWebView embeds from capacitor://localhost fail with YouTube error 153, so
// the apps play through a page on roda.fyi that gives YouTube a normal referrer.
export const NATIVE_YOUTUBE_PLAYER = 'https://roda.fyi/embed/youtube?v=';

export function youtubeEmbedUrl(url, { native = false } = {}) {
  const id = youtubeId(url);
  if (!id) return null;
  return native ? `${NATIVE_YOUTUBE_PLAYER}${id}` : `https://www.youtube-nocookie.com/embed/${id}`;
}
```

`src/app/screens/training.js` — after `const back = () => ctx.back('/');` add:

```js
  const embedUrl = (url) => youtubeEmbedUrl(url, { native: Boolean(ctx.platform?.isNative) });
  const openExternal = ctx.openExternal ?? ((url) => ctx.window?.open?.(url, '_blank', 'noopener,noreferrer'));
```

then use `embedUrl(url)` / `embedUrl(video.url)` in place of `youtubeEmbedUrl(url)` / `youtubeEmbedUrl(video.url)`, and replace `else ctx.window?.open?.(resource.url, '_blank', 'noopener,noreferrer');` with `else openExternal(resource.url);`.

`embed/youtube.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <meta name="robots" content="noindex">
  <title>Video · Roda</title>
  <style>html, body { margin: 0; height: 100%; background: #000; } iframe { display: block; border: 0; width: 100%; height: 100%; }</style>
</head>
<body>
  <script>
    // Player for the Roda iOS and Android apps; only an 11-character YouTube id is accepted.
    (function () {
      var id = new URLSearchParams(location.search).get('v') || '';
      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return;
      var frame = document.createElement('iframe');
      frame.setAttribute('src', 'https://www.youtube-nocookie.com/embed/' + id);
      frame.setAttribute('title', 'Video');
      frame.setAttribute('allow', 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen');
      frame.setAttribute('allowfullscreen', '');
      frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      document.body.appendChild(frame);
    }());
  </script>
</body>
</html>
```

In `src/app/entries/app.js`, import `installExternalLinks` from `'../platform/external-links.js'` and, right after `const platform = createPlatform({ window });`:

```js
  if (platform.isNative) {
    installExternalLinks({ document, appOrigin: location.origin, openExternal: (url) => platform.openExternal(url) });
  }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/external-links.test.js tests/unit/youtube.test.js tests/unit/youtube-player-page.test.js tests/unit/training-screen.test.js`
Expected: PASS.

Run: `npm run test:unit && npm run test:e2e`
Expected: all pass (the web still embeds `youtube-nocookie.com`).

- [ ] **Step 5: Check links on Android**

Run: `npm run native:android && adb install -r android/app/build/outputs/apk/debug/app-debug.apk`, sign in, and open a training that has a non-YouTube video link.
Expected: tapping it opens a Chrome Custom Tab, and Back returns to the training page. YouTube playback needs `embed/youtube.html` live on roda.fyi, so Task 9's device check covers it after the web deploy.

- [ ] **Step 6: Commit**

```bash
git add src/app/platform/external-links.js embed/youtube.html src/app/screens/youtube.js src/app/screens/training.js \
  src/app/entries/app.js tests/unit/external-links.test.js tests/unit/youtube.test.js \
  tests/unit/youtube-player-page.test.js tests/unit/training-screen.test.js
git commit -m "feat: open links and play videos inside the native apps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: CI for the native builds

**Files:**
- Create: `.github/workflows/native.yml`

**Interfaces:**
- Consumes: `scripts/build-native.mjs --test` (Task 3; uses the fixed test Supabase config, so CI needs no secrets or variables), `scripts/native-version.mjs` (Task 4), the committed `android/` and `ios/` projects.
- Produces: the GitHub Actions workflow "Native apps" with jobs `android` (debug APK artifact `roda-debug-apk`) and `ios` (unsigned simulator build). Both fail when `npx cap sync` changes committed files.

- [ ] **Step 1: Write the workflow**

```yaml
# .github/workflows/native.yml
name: Native apps

on:
  pull_request:
    paths:
      - 'android/**'
      - 'ios/**'
      - 'capacitor.config.json'
      - 'package.json'
      - 'package-lock.json'
      - 'scripts/build.mjs'
      - 'scripts/build-native.mjs'
      - 'scripts/native-version.mjs'
      - 'src/**'
      - 'assets/**'
      - '.github/workflows/native.yml'
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: native-${{ github.ref }}
  cancel-in-progress: true

jobs:
  android:
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
          cache: npm
      - uses: actions/setup-java@v5
        with:
          distribution: temurin
          java-version: '21'
      - run: npm ci
      # CI only proves the apps compile, so it uses the fixed test configuration.
      - run: node scripts/build-native.mjs --test
      - run: npx cap sync android
      - name: Committed Android project matches package.json
        run: git diff --exit-code -- android
      - name: Build the debug APK
        working-directory: android
        run: ./gradlew assembleDebug -ProdaVersionName="$(node ../scripts/native-version.mjs name)" -ProdaVersionCode="$(node ../scripts/native-version.mjs code)"
      - uses: actions/upload-artifact@v4
        with:
          name: roda-debug-apk
          path: android/app/build/outputs/apk/debug/app-debug.apk
          retention-days: 7

  ios:
    runs-on: macos-26
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: xcodebuild -version
      - run: npm ci
      - run: node scripts/build-native.mjs --test
      - run: npx cap sync ios
      - name: Committed iOS project matches package.json
        run: git diff --exit-code -- ios
      - name: Build for the simulator (unsigned)
        run: >-
          xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug
          -sdk iphonesimulator -destination 'generic/platform=iOS Simulator'
          MARKETING_VERSION="$(node scripts/native-version.mjs name)"
          CURRENT_PROJECT_VERSION="$(node scripts/native-version.mjs code)"
          CODE_SIGNING_ALLOWED=NO build
```

- [ ] **Step 2: Run it on GitHub**

Run:

```bash
git add .github/workflows/native.yml
git commit -m "ci: build the iOS and Android apps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD
gh workflow run native.yml --ref "$(git branch --show-current)"
gh run watch "$(gh run list --workflow native.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
```

Expected: `xcodebuild -version` prints `Xcode 26.…`; the `android` job ends with `BUILD SUCCESSFUL` and uploads `roda-debug-apk`; the `ios` job ends with `** BUILD SUCCEEDED **`; `gh run watch` exits 0.

If a drift check fails, run `npm run native:sync` locally, commit the listed files under `android/` or `ios/`, and push again. If the iOS project was generated in CI (Task 4 Step 5 fallback), download it from that run and commit it before this step.

---

### Task 9: Docs, full verification, and the device check

**Files:**
- Modify: `README.md`, `docs/auth-and-database-operations.md`, `docs/security-checklist.md`

**Interfaces:**
- Consumes: everything above.
- Produces: documentation that matches the shipped behavior; recorded evidence for the owner's release.

- [ ] **Step 1: Document the native apps in `README.md`**

Add after the section about the new app:

```markdown
### Native apps (iOS and Android)

The same app ships as iOS and Android apps built with [Capacitor](https://capacitorjs.com/).
`npm run build:native` bundles it into `native-www/`, and `npm run native:sync`
copies that into `android/` and `ios/`. On Linux, `npm run native:android` builds
a debug APK (needs JDK 21 and Android SDK 36). iOS builds need macOS with Xcode
26; the **Native apps** GitHub Actions workflow builds both on every change.
After adding or updating a Capacitor plugin, run `npm run native:sync` and commit
the changes under `android/` and `ios/`, or CI fails. `npm run native:icons`
regenerates icons and splash screens from `favicon.svg`. Everything native sits
behind `roda:platform` (`src/app/platform/`), so the web bundle has no Capacitor
code.
```

- [ ] **Step 2: Update the operations runbook**

In `docs/auth-and-database-operations.md`, section "Exact Auth URL configuration", add the native callback as the last line of the `Redirect URLs` block:

```text
fyi.roda.app://auth-callback
```

and add after that section's last paragraph:

```markdown
The iOS and Android apps sign in through the system browser and return through
the custom-scheme deep link `fyi.roda.app://auth-callback`. PKCE keeps the code
useless to any other app that claims the scheme. Add only this exact URL; never
a scheme wildcard.
```

Add two sections before "Rotation and incident response":

```markdown
## Native apps: Sign in with Apple

The iOS app offers Sign in with Apple natively (`signInWithIdToken`). In
**Supabase → Authentication → Sign In / Providers → Apple**, enable the provider
and list `fyi.roda.app` under **Client IDs**. Leave the secret empty: native
sign-in needs no client secret, so there is no 6-month rotation. If web Apple
sign-in is added later, list its Services ID first and set up the secret
rotation then.

## Account deletion

People delete their account in **Me → Settings → Delete account** (web, iOS,
and Android). `public.delete_my_account()` deletes the auth user, and the
`auth_user_erase_profile` trigger erases their data first: own trainings,
participations, notes, ratings, feedback they wrote, links they added, saved
sequences, join requests, and pending invitations to their email. It ends
memberships, connections, and future classes. The profile stays as an anonymous
tombstone (`display_name = 'Deleted account'`, `deleted_at` set) so classes and
groups others rely on keep working. Owners of groups with other active members
must transfer or archive them first (`owner_must_transfer`). Deleting a user in
**Supabase → Authentication → Users** runs the same trigger. The client removes
the profile photo through the Storage API before calling the function. An access
token issued before deletion stays valid until it expires (at most one hour).
```

- [ ] **Step 3: Update the security checklist**

In `docs/security-checklist.md`:

Replace the redirect allowlist item's first line `- [ ] Supabase redirect allowlist contains the exact production and` with `- [ ] Supabase redirect allowlist contains the exact native callback \`fyi.roda.app://auth-callback\`, the exact production and`.

Add under "Account and provider security":

```markdown
- [ ] Sign in with Apple lists only `fyi.roda.app` under Supabase's Apple Client
  IDs, has no client secret, and the Apple App ID has Sign in with Apple enabled.
```

Add under "Browser and secret boundary":

```markdown
- [ ] No Android keystore, `android/keystore.properties`, `.p8`, or `.p12` file
  is tracked; `native-www/` is ignored, and `.vercelignore` keeps `android/`,
  `ios/`, `native-www/`, and `resources/` off the website.
```

Add under "Product privacy and behavior":

```markdown
- [ ] Delete account works from Settings on web, iOS, and Android with a
  throwaway account: the auth user is gone, the profile reads "Deleted account",
  and an owner of a group with members is asked to transfer or archive first.
```

- [ ] **Step 4: Run every suite**

Run:

```bash
npm run build
npm run test:unit
npm run test:db
npm run test:e2e
npm run build:native
rg -n "service_role|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|sb_publishable_e2e_test|__RODA_E2E_EVENTS__" assets/generated native-www
git status --short
```

Expected: the builds succeed; all unit, DB, and e2e tests pass; the `rg` secret scan prints nothing; `git status` shows only the three docs files.

- [ ] **Step 5: Device check**

After the web deploy (so `https://roda.fyi/embed/youtube` is live), on an Android emulator or phone (`npm run native:android`, then `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`), and on iOS once owner step O-6 is done (Xcode on a Mac, or TestFlight), confirm each item and record the result in the pull request:

1. Cold launch shows the splash, then the sign-in screen, with no white flash.
2. Google sign-in returns to the app on Today. The email link opened on the same phone signs in. On iOS, Continue with Apple signs in, and cancelling leaves the buttons usable.
3. Log training: the chat box stays above the keyboard. Force-quit the app with a draft, relaunch, and the draft is still there.
4. A training with a YouTube recording plays inline on both platforms; a resource link opens in the in-app browser and closing it returns to the app.
5. Android Back follows the table in Task 6 Step 5.
6. The status bar shows light icons on the dark background, and nothing is hidden under the notch, the status bar, or the home/gesture bar.
7. Launch in airplane mode: the app opens and shows the offline notice instead of a blank screen.
8. Settings → Delete account with a throwaway account returns to the sign-in screen, and Supabase → Authentication → Users no longer lists it.
9. If Plan 3 shipped Discover, map tiles and place search load (OpenStreetMap accepts the `RodaApp/1` user agent).

- [ ] **Step 6: Commit**

```bash
git add README.md docs/auth-and-database-operations.md docs/security-checklist.md
git commit -m "docs: describe the native apps and account deletion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Owner's manual steps

These need the product owner's accounts, keys, or a Mac. None of them are code. The "Needed by" column says which step waits on them.

| # | Step | Exact settings | Needed by |
|---|------|----------------|-----------|
| O-1 | Allow the native callback in Supabase | Supabase → Authentication → URL Configuration → Redirect URLs → add exactly `fyi.roda.app://auth-callback` (keep the existing entries, no wildcard). Repeat on any staging project used for native testing. | Task 5 Step 9 |
| O-2 | Prove hosted account deletion on staging | Push the migrations to a non-production project, sign in with a throwaway account, and delete it from Settings. Check that Authentication → Users no longer lists it and that `select display_name, deleted_at from public.profiles where id = '<id>'` returns `Deleted account` with a timestamp. This confirms the hosted `postgres` role may delete from `auth.users`. | Before production rollout of Task 1 |
| O-3 | Enroll in the Apple Developer Program | developer.apple.com/programs → Enroll (US$99/year). Choose Individual, or Organization (needs a D-U-N-S number; the store shows the organization as seller). | O-4, O-6, O-7 |
| O-4 | Create the App ID | Certificates, Identifiers & Profiles → Identifiers → + → App IDs → App → Description `Roda`, Bundle ID **Explicit** `fyi.roda.app` → Capabilities: check **Sign in with Apple** (Enable as a primary App ID) → Register. | O-5, O-6 |
| O-5 | Enable Apple in Supabase | Supabase → Authentication → Sign In / Providers → Apple → Enable; **Client IDs**: `fyi.roda.app`; leave **Secret Key** empty → Save. | iOS sign-in (Task 9 Step 5) |
| O-6 | Sign the iOS app on a Mac | Xcode 26 → open `ios/App/App.xcodeproj` → target **App** → Signing & Capabilities: Team = your team, "Automatically manage signing" on → **+ Capability → Sign in with Apple**. Commit the new `ios/App/App/App.entitlements` and the `project.pbxproj` change (no secrets). Run on a simulator or device for the Task 9 device check. | Task 9 Step 5 (iOS), O-7 |
| O-7 | App Store Connect record and first upload | My Apps → + New App: iOS, Name `Roda`, Primary language English (U.S.), Bundle ID `fyi.roda.app`, SKU `roda-ios`. App Privacy: collected and linked to the person, used only for App Functionality, no tracking: Contact Info (name, email address), User Content (training notes and other content), Identifiers (user ID). Add the Privacy Policy URL and Support URL (O-12). Fill in the age rating questionnaire. Review notes: "Sign in with Apple, or tap Try the demo to explore without an account. Account deletion: Me → Settings → Delete account." Upload: Xcode → Product → Archive (Any iOS Device) with Build Settings `MARKETING_VERSION` = `node scripts/native-version.mjs name` and `CURRENT_PROJECT_VERSION` = `node scripts/native-version.mjs code` → Organizer → Distribute App → App Store Connect → Upload. Test through TestFlight before submitting. | Store submission |
| O-8 | Google Play developer account and app | play.google.com/console → create a developer account (one-time US$25, identity verification) → Create app: name `Roda`, default language English (United States), App, Free. New personal accounts must run a closed test (currently at least 12 testers for 14 days) before production access; check the Play Console dashboard for the current rule. | O-9, O-10 |
| O-9 | Android upload key and release bundle | `keytool -genkeypair -v -keystore ~/keys/roda-upload.jks -alias roda-upload -keyalg RSA -keysize 2048 -validity 10000`; keep both passwords in a password manager and the `.jks` outside the repo. Create git-ignored `android/keystore.properties` with `storeFile=/home/<you>/keys/roda-upload.jks`, `storePassword=…`, `keyAlias=roda-upload`, `keyPassword=…`. Build: `npm run native:sync && cd android && ./gradlew bundleRelease -ProdaVersionName=$(node ../scripts/native-version.mjs name) -ProdaVersionCode=$(node ../scripts/native-version.mjs code)` → upload `android/app/build/outputs/bundle/release/app-release.aab` to **Testing → Internal testing**, and accept **Play App Signing** (Google holds the app signing key, so a lost upload key can be reset). | Store submission |
| O-10 | Play Console app content | Policy → App content: Privacy policy URL (O-12); Ads: no; Data safety: collects name, email address, user IDs, and other user-generated content (training notes), all for App functionality, encrypted in transit, not shared, deletion available in the app; **Delete account URL**: `https://roda.fyi/dashboard#/me/settings` (signing in there shows Delete account); content rating questionnaire; target audience as the product owner decides. | Store submission |
| O-11 | Google sign-in branding | No new Google OAuth client is needed: the apps use the existing Web client through Supabase. Make sure Google Auth Platform → Branding is verified/published so the consent screen shows "Roda", not an unverified-app warning. | Public release |
| O-12 | Privacy policy and support contact | Publish a privacy policy and a support contact on roda.fyi (both stores require the URLs; the security checklist requires approval). | O-7, O-10 |
| O-13 | Deploy the web before shipping apps | Merge and deploy Task 7 so `https://roda.fyi/embed/youtube` exists before any app build reaches testers. | Task 9 Step 5 |
| O-14 | GitHub Actions minutes | Settings → Actions → allow workflows. On a private repository, macOS minutes bill at a higher rate; check the plan's included minutes. | Task 8 |

---

## Self-review notes

- **Coverage:** every design decision maps to a task. D1 → Tasks 3–4; D2 → Task 5; D3 → Tasks 3 and 5 and O-4–O-6; D4 → Tasks 1–2 and O-2; D5 → Task 3; D6 → Task 3; D7 → Tasks 4 and 6; D8 → Task 6; D9 → Task 7; D10 → Task 3; D11 → Task 4; D12 → Tasks 3, 4, and 8.
- **Review Focus pins:** 1 → Task 5 sign-in screen tests (browser closed, Apple cancel); 2 → Task 5 auth-callback tests (other URLs, duplicate code, `access_denied`); 3 → Task 3 durable-storage relaunch test; 4 → Task 6 back-button tests and the Step 5 table; 5 → Task 1 `owner_must_transfer` assertions and Task 2 panel and e2e tests.
- **Names used across tasks:** `createPlatform`, `platform.{isNative,name,createStorage,flushStorage,authRedirectUrl,openAuthUrl,onAppUrl,closeBrowser,onBrowserClosed,openExternal,onBackButton,minimize,appleSignIn,registerServiceWorker,ready}`, `createDurableStorage`, `createServices({ window, localMode, storage, platform })`, `services.account.{deletionCheck,deleteAccount}`, `clearLocalTrainingData`, `createDeleteAccountPanel`, `renderSignIn`, `createAuthCallbackHandler`, `nativeHashFromReturnRoute`, `backAction`, `isSheetOpen`, `installExternalLinks`, `youtubeEmbedUrl(url, { native })`, `nativeVersion`.
