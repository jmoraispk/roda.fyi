# Phone Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People turn on phone notifications per device, choose what roda sends and when, and receive four kinds of notifications (Finish setting up, Before a class, After a class, Coach requests) from a sender that runs inside Supabase every minute, never twice and never in their quiet hours.

**Architecture:** The database decides what is due. A service-role-only function, `claim_due_notifications`, computes due notifications for all four kinds from preferences, quiet hours, and the person's time zone, records each as a `pending` delivery (unique per person, kind, and subject), and returns structured fields plus the person's devices. An Edge Function, `send-notifications` (Deno), is called every minute by `pg_cron` through `pg_net` with a shared secret header. It turns the structured fields into English or Portuguese text per device, sends Web Push messages with VAPID keys from its secrets, and reports the results through `report_notification_results`, which marks deliveries sent or failed and removes dead devices. In the app, the service worker shows pushes and opens the right screen when one is tapped. A small device seam wraps the browser's permission and push subscription so unit and browser tests can fake it. Settings gains a Notifications section, and Today gains a one-time "Turn on reminders" card.

**Tech Stack:** Vanilla ES modules + esbuild, Vitest + jsdom, Playwright, Supabase Postgres + pgTAP, Supabase Edge Functions (Deno 2) with `jsr:@negrel/webpush@0.5.0` and `npm:@supabase/supabase-js@2.116.0`, and `pg_cron` + `pg_net` + Vault (set up by the owner).

**Spec:** `docs/superpowers/specs/2026-11-01-notifications-design.md`. The owner's decisions there are final: Web Push to phones only, all four kinds, sending inside Supabase (pg_cron every minute → pg_net → Edge Function), the approved defaults, and per-person kinds, timings, and quiet hours.

This plan was checked against `origin/main` at `b485f48`.

## Global Constraints

- Every task leaves `npm run test:unit` and `npm run test:e2e` passing. Tasks that touch SQL also leave `npm run test:db` passing.
- Do not modify `tools/` (including `tools/serve.py`), `assets/figure3d.js`, `assets/moves3d/`, or `index.html`.
- Follow `docs/security-checklist.md`. Every new table has RLS enabled. Clients never write tables directly; every write goes through an RPC that rechecks the caller. Every function is a `private.*` security-definer function with `set search_path = ''` and fully qualified names, plus a `public` `language sql` wrapper that passes `auth.uid()`. Wrappers are revoked from `public, anon, authenticated` and granted to `authenticated` (the person's RPCs) or to `service_role` only (the sender's RPCs).
- Database: new migrations are `2026110100NN_*.sql` (`01` devices and preferences, `02` claims, `03` results). New pgTAP files are `0046`–`0048`. Run `ls supabase/tests` first: `0040`–`0045` are reserved by the Capacitor plan. Never edit an applied migration. Apply locally with `npx supabase migration up --local`. Never run `supabase db reset` or `npm run supabase:reset`: the local database is shared with the main checkout.
- Nothing in the tasks touches production: no `supabase db push`, no `supabase functions deploy`, no `supabase secrets set`, no Vault or cron SQL on the hosted project. Those steps are listed in **Owner rollout** at the end, and only the owner runs them.
- No `npm install` and no new `package.json` dependencies. The Edge Function names its two dependencies by pinned specifiers (`jsr:@negrel/webpush@0.5.0`, `npm:@supabase/supabase-js@2.116.0`), which Supabase resolves when it deploys the function.
- Secrets: the VAPID private key and the cron secret live only in Supabase (function secrets and Vault). The VAPID public key is a public build value, like the Supabase URL. The sender never logs endpoints, keys, or secrets.
- English copy uses American spelling. Every new `en` key in `src/app/dashboard-i18n.js` has a `pt` key (Portugal Portuguese, informal "tu" form), and every key is used by some loaded module (`tests/unit/i18n-usage.test.js`).
- Notification links are hash routes under `/app` from the spec's table: `/app#/`, `/app#/class/<id>`, `/app#/calendar/<yyyy-mm-dd>`, `/app#/training/<id>`, `/app#/group/<id>`, `/app#/me/teaching`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Rulings

Decisions the spec left open, made here so tasks do not decide them again.

- **Ruling 1: the Web Push library is `jsr:@negrel/webpush@0.5.0`.** It is built only on Web APIs (WebCrypto, `fetch`), which the Supabase Edge Runtime (Deno 2) provides. `npm:web-push` depends on Node's `https` and `crypto` modules, which have no documented Supabase Edge track record. Its README warns it has not been reviewed by cryptography experts. That risk is limited here: it signs with our VAPID key and encrypts payloads that hold only a title, a short sentence, and an app link. The library is used only in `index.ts`, behind a `push(device, text, { ttl })` function. If the owner's test send fails, only that function changes, to `npm:web-push@3.6.7`.
- **Ruling 2: VAPID keys use the standard base64url form.** The public key is the 65-byte uncompressed P-256 point, and the private key is the 32-byte scalar `d`. The owner generates them with Node's WebCrypto (one command in Owner rollout, with no package to install). The function turns them into the JSON Web Keys the library imports (`vapid.js`, unit-tested). The browser uses the same public key as `applicationServerKey`. `RODA_VAPID_PUBLIC_KEY` is a required, validated build value, like `RODA_SUPABASE_URL`. `npm run build:test` uses the well-known public example key `BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U`, because browser tests never reach a push service.
- **Ruling 3: only the scheduler can start the sender.** `send-notifications` is deployed with `verify_jwt = false` (in `supabase/config.toml`, and with `--no-verify-jwt`). It accepts only `POST` requests whose `x-roda-cron-secret` header equals the function secret `NOTIFICATIONS_CRON_SECRET`, compared in constant time. Anything else gets 405 or 401.
- **Ruling 4: the sender reaches the database with the key Supabase already gives it.** It uses `supabase-js` with the default secret key from `SUPABASE_SECRET_KEYS` (JSON, key `default`), falling back to the legacy `SUPABASE_SERVICE_ROLE_KEY`. Both are injected by Supabase, so no privileged key is created, copied, or stored anywhere else.
- **Ruling 5: service-role-only RPCs.** `public.claim_due_notifications(at_time timestamptz default now(), batch_limit integer default 50)` and `public.report_notification_results(results jsonb)` are `language sql` wrappers over `private` security-definer functions. They are revoked from `public, anon, authenticated` and granted to `service_role` only. The migration grants `usage on schema private` to `service_role`.
- **Ruling 6: the cron job is an owner step, not a migration.** The migrations create no extension, job, or secret. The owner enables `pg_cron` and `pg_net`, stores the function URL and the cron secret in Vault, and schedules `send-notifications` every minute with SQL that reads them from `vault.decrypted_secrets` (Owner rollout, step 6). To roll back, run `select cron.unschedule('send-notifications');`. `pg_net` writes request headers to `net.http_request_queue` while a request waits, so the cron secret is readable there by database roles that can log in. That is acceptable: the secret can only start the sender.
- **Ruling 7: the person's time zone on the server.** Profiles store only `timezone_override`, and the app uses the browser's zone when that is empty, so the server cannot know the zone from the profile alone. The zone is therefore `profiles.timezone_override` when it is a valid IANA zone, otherwise the zone of the person's most recently saved device (`push_subscriptions.timezone`), otherwise `UTC`. The app sends `ctx.timezone` with the device every time the app starts and every time the language changes, so the device's language and zone stay current (spec: "updated when the language changes").
- **Ruling 8: when each kind is due.** All times are in the person's zone (Ruling 7) with that person's preferences. A missing preferences row means the defaults.
  - *Before a class*: the reminder moment is `starts_at − lead`. The reminder is sent during the 10 minutes after that moment, while the class has not started, has no recorded occurrence, and is still `scheduled`. It is skipped if the class was created after that moment, or if the moment falls in quiet hours. The audience is the coach who arranged the class (while `can_manage_schedule` holds), active `member`s of a group class, and the student of a personal class. Students hear about a class only if it is `visible_in_advance`, for personal classes too, so a hidden plan stays hidden. The subject key is `class:<schedule id>:<epoch of starts_at>`, so moving a class to a new time earns a new reminder.
  - *After a class*: for each participant of a `group` or `personal_class` occurrence who did not record it, has no felt rating (no `r` segment assessment), and whose occurrence has no `video` resource. It is due at `max(end + delay, the time the class was recorded)`.
  - *Coach requests*: three cases. A `pending` join request is sent to the group's active coaches, or to the owner when the request is for coach access. A `pending` coaching request that the student started is sent to that coach. A class the coach arranged that has no occurrence 30 minutes after it ended is sent to that coach (while `can_manage_schedule` holds). Requests are due when they are created. The unfinished class is due at `end + 30 min`. Requests and classes older than two days never notify.
  - *After a class* and *Coach requests* may be sent once due, outside quiet hours, and no later than 3 hours after the end of the quiet hours that the due time fell in. A reminder due at 22:30 therefore arrives at 08:00, and a run missed for longer is dropped, not sent late.
  - *Finish setting up*: there are up to three rounds. Round `n` is due at `max(completed_at + 2 days, previous round's first claim + 7 days)` and is sent outside quiet hours, with no expiry. It stops as soon as the person has a city, an active group or coaching connection, and a training.
- **Ruling 9: claiming, at most once.** `claim_due_notifications` first marks as `failed` every `pending` delivery that already had three attempts and was claimed at least 15 minutes ago. It then claims again any other `pending` delivery claimed at least 15 minutes ago (`attempts + 1`, `for update skip locked`). Finally it inserts new deliveries, skipping subjects already logged, with `on conflict do nothing` on `unique (profile_id, kind, subject_key)`. The batch is 50 by default and 200 at most, retries first. Each claimed row is returned with its devices. Two overlapping runs therefore cannot both claim the same subject.
- **Ruling 10: results.** A delivery becomes `sent` when any device accepted it. If none accepted and at least one failed temporarily, it stays `pending` and is retried after 15 minutes. Otherwise it becomes `failed`. Devices that answer 404 or 410, or whose endpoint is not a known push service, are deleted. A temporary failure adds 1 to `failures`, and the device is deleted at 10 consecutive failures. A success resets `failures` and sets `last_sent_at`.
- **Ruling 11: the copy lives in the sender.** The SQL returns structured fields (`url`, `class_kind`, `group_name`, `person_name`, `starts_at`, `lead_minutes`, `local_date`, `reason`, `zone`). `supabase/functions/send-notifications/copy.js` turns them into text in the device's language, with times in the person's zone (en `7:00 PM`, pt `19:00`). Where the spec says "today's class", the words follow the day of delivery: an evening reminder deferred to the morning says "yesterday's class". The coaching request, which the spec gives only as a body, gets the title "New coaching request". Tags are the delivery id, so a retried delivery replaces itself on the phone.
- **Ruling 12: only known push services.** Endpoints must be `https://` URLs on `fcm.googleapis.com` (Chrome, Edge on Android, Samsung, Opera), `updates.push.services.mozilla.com` (Firefox), `web.push.apple.com` (Safari and iPhone home-screen apps), or `*.notify.windows.com` (Edge on Windows). This is checked in SQL when a device is saved and again in the sender, so the sender never POSTs to an address a person chose. A browser that uses another push service needs a new migration.
- **Ruling 13: a device belongs to one account.** `save_push_subscription` upserts by endpoint, and saving an endpoint already on another account moves it to the caller. A person keeps at most 10 devices, and the oldest are dropped. Signing out turns this device off: the browser unsubscribes first, then the server row is deleted. This is best effort, takes at most 3 seconds, and never blocks sign-out. The next person on a shared phone therefore never receives the previous person's notifications.
- **Ruling 14: the device seam.** `ctx.pushDevice` is `createPushDevice` (real browser APIs) in production. In browser tests it is `createE2EPushDevice`, driven by `localStorage['roda.e2e.push']` = `{ support, permission, answer, subscribed }`, where `support` defaults to `'unsupported'` so existing browser tests see no new cards. Its `permission` falls back to the real `Notification.permission`, so Playwright's `grantPermissions(['notifications'])` works. In demo mode it is `null` ("Notifications are off in the demo."), because a demo has no account to send to.
- **Ruling 15: device states.** `deviceState(device)` returns:
  - `demo` when there is no device.
  - `ios-browser` on an iPhone or iPad not running from the home screen.
  - `unsupported` without a service worker, `PushManager`, or `Notification`.
  - `blocked` when permission is `denied`.
  - `on` when permission is `granted` and a push subscription exists.
  - `off` otherwise.

  Settings shows one control per state: Turn on notifications, On for this device with Turn off, Blocked in the browser (with how to allow it), Add roda to your Home Screen first (with Show me how → `/install`), Not supported in this browser, or the demo note.
- **Ruling 16: the preferences form.** It uses one Save button, like the profile form. Quiet hours are whole hours, `00:00`–`23:00`, with a checkbox to turn them off. Coach requests appear only when `ctx.isCoach()`; otherwise the saved value is kept. The client checks values with the same rules as the server (`checkPreferences`). The new error codes `invalid_subscription` and `invalid_preferences` have safe messages in both languages.
- **Ruling 17: one card on Today.** The Today slot shows one card: "Turn on reminders" when the device is `supported`, permission is still `default`, and this device has not answered (`localStorage['roda.reminders.answered']`); otherwise "Finish setting up"; otherwise the install hint. Turn on and Not now both record the answer for this device, so the card appears once. On an iPhone in Safari, the reminders card never appears, and the checklist and install hint behave as today.
- **Ruling 18: what a push shows and where a tap goes.** Every push shows a notification, because iPhones stop delivering to sites whose pushes show nothing. An unreadable push shows the title "roda". A tap opens only a link matching `^/app(#/[A-Za-z0-9/_-]*)?$`, and anything else opens `/app`. An open app window is focused and moved to the link; otherwise a new window opens.
- **Ruling 19: how the sender is tested.** `deno` is not installed and is not added. The sender's logic is plain JavaScript (`copy.js`, `run.js`, `vapid.js`), imported by `index.ts` in Deno and by Vitest in `tests/unit`. `index.ts` only wires secrets, the database client, and the push library; the owner's test send checks it (Owner rollout, step 8).
- **Ruling 20: order of the owner's rollout.** The build now requires `RODA_VAPID_PUBLIC_KEY`, so the Vercel variable is set before this branch reaches `main`; a missing value fails the build, and the live site stays as it was. Migrations reach production before the app that calls them, as usual.

## Review Focus

1. **An evening class that ends inside quiet hours**, the usual capoeira schedule (class 20:30–21:30, quiet from 22:00): the after-class reminder never arrives at 22:30. It arrives at 08:00 and says "How did yesterday's class go?". This is pinned in Task 3 (`0047`, "waits" then "arrives when quiet hours end") and Task 5 ("yesterday" wording).
2. **Two sender runs overlap, or one crashes mid-batch**: nobody gets the same notification twice. An unsent delivery is retried after 15 minutes, at most three times, and then given up. This is pinned in Task 3 (at most once) and Task 4 (retry window, attempt cap, batch limit).
3. **A person with no time zone in their profile, living elsewhere** (the owner, in Washington): quiet hours and the times in the text follow the zone of their device, not Lisbon or UTC. This is pinned in Task 3 (New York device gets an 18:30 reminder that Lisbon skips) and Task 5 (time formatted in the payload's zone).
4. **A shared phone, where one person signs out and another signs in**: the second person never receives the first person's notifications. This is pinned in Task 2 (an endpoint saved by another account moves), Task 8 (turning off unsubscribes the browser before the network call), and Task 9 (sign-out turns the device off).
5. **Turning on with the network down after the permission prompt**: the device is not left half on. The browser subscription is removed, Settings shows the error, and Turn on notifications is offered again. This is pinned in Task 8 (`turnOn` rolls back) and Task 9 (Settings shows the error and stays off).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `scripts/build.mjs`, `src/app/config.js`, `.env.example` | `RODA_VAPID_PUBLIC_KEY` read, validated, and defined as `__RODA_VAPID_PUBLIC_KEY__` |
| `supabase/migrations/202611010001_notifications.sql` + `supabase/tests/0046_notification_settings.test.sql` | Tables, RLS, endpoint rule, and the person's four RPCs |
| `supabase/migrations/202611010002_notification_claims.sql` + `supabase/tests/0047_notification_due.test.sql` | Quiet hours, recipients, what is due, `claim_due_notifications` |
| `supabase/migrations/202611010003_notification_results.sql` + `supabase/tests/0048_notification_results.test.sql` | `report_notification_results`, retries, device cleanup |
| `supabase/functions/send-notifications/copy.js` | Notification text per kind and language (pure) |
| `supabase/functions/send-notifications/run.js` | Secret check, claim → send → report loop (pure, injected `rpc` and `push`) |
| `supabase/functions/send-notifications/vapid.js` | base64url VAPID keys → JSON Web Keys |
| `supabase/functions/send-notifications/index.ts` | Deno wiring: environment, `supabase-js`, `@negrel/webpush`, `Deno.serve` |
| `supabase/config.toml` | `[functions.send-notifications]` with `verify_jwt = false` |
| `src/app/sw/push-policy.js` | What a push shows; which links a tap may open |
| `src/app/sw/service-worker.js` | `push` and `notificationclick` handlers |
| `src/app/push-device.js` | Browser seam: support, permission, push subscription |
| `src/app/notification-service.js` | RPCs, preference rules and defaults |
| `src/app/notifications.js` | Device state, turn on, turn off, refresh, forget |
| `src/app/testing/fake-services.js` | `createE2EPushDevice`, `createE2ENotificationService` |
| `src/app/screens/notification-settings.js` | Settings → Notifications |
| `src/app/screens/reminders-card.js` | Today's "Turn on reminders" card |
| `tests/unit/helpers/fake-push-device.js` | A fake device for unit tests |
| `tests/unit/{notification-copy,send-notifications,push-device,notification-service,notifications,notification-settings,reminders-card}.test.js` | Unit tests |
| `tests/e2e/app-notifications.spec.js` | Browser tests |

Modified: `src/app/create-services.js`, `src/app/entries/app.js`, `src/app/screens/me.js`, `src/app/screens/today.js`, `src/app/errors.js`, `src/app/dashboard-i18n.js`, `assets/app.css`, `tests/unit/helpers/worker-harness.js`, `tests/unit/helpers/module-graph.js`, `tests/unit/{build-config,release-scan,service-worker,today-screen}.test.js`, `docs/auth-and-database-operations.md`, `docs/security-checklist.md`, `README.md`.

---

### Task 1: The VAPID public key is a public build value

**Files:**
- Modify: `scripts/build.mjs`, `src/app/config.js`, `.env.example`, `tests/unit/helpers/module-graph.js`
- Test: `tests/unit/build-config.test.js`, `tests/unit/release-scan.test.js`

**Interfaces:**
- Produces (`scripts/build.mjs`): `readPublicConfig(env) → { supabaseUrl, supabasePublishableKey, vapidPublicKey }`. It throws `'RODA_VAPID_PUBLIC_KEY is required'` or `'RODA_VAPID_PUBLIC_KEY must be a base64url P-256 public key'`. It also exports `TEST_VAPID_PUBLIC_KEY`.
- Produces (`src/app/config.js`): `publicConfig.vapidPublicKey` (string), from the esbuild define `__RODA_VAPID_PUBLIC_KEY__`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/build-config.test.js`, change the import to `import { TEST_VAPID_PUBLIC_KEY, buildBrowserBundles, readPublicConfig } from '../../scripts/build.mjs';`, then replace the test `'returns trimmed public configuration unchanged'` with these three tests:

```js
  it('requires a VAPID public key in base64url P-256 form', () => {
    const base = { RODA_SUPABASE_URL: 'https://example.supabase.co', RODA_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
    expect(() => readPublicConfig(base)).toThrow('RODA_VAPID_PUBLIC_KEY is required');
    expect(() => readPublicConfig({ ...base, RODA_VAPID_PUBLIC_KEY: 'not a key' }))
      .toThrow('RODA_VAPID_PUBLIC_KEY must be a base64url P-256 public key');
    // 65 bytes, but not an uncompressed point (first byte is not 0x04).
    expect(() => readPublicConfig({ ...base, RODA_VAPID_PUBLIC_KEY: Buffer.alloc(65, 1).toString('base64url') }))
      .toThrow('RODA_VAPID_PUBLIC_KEY must be a base64url P-256 public key');
  });

  it('returns trimmed public configuration unchanged', () => {
    expect(readPublicConfig({
      RODA_SUPABASE_URL: '  http://127.0.0.1:54321  ',
      RODA_SUPABASE_PUBLISHABLE_KEY: '  sb_publishable_local_test  ',
      RODA_VAPID_PUBLIC_KEY: `  ${TEST_VAPID_PUBLIC_KEY}  `,
    })).toEqual({
      supabaseUrl: 'http://127.0.0.1:54321',
      supabasePublishableKey: 'sb_publishable_local_test',
      vapidPublicKey: TEST_VAPID_PUBLIC_KEY,
    });
  });

  it('uses a valid example key for test builds', () => {
    const raw = Buffer.from(TEST_VAPID_PUBLIC_KEY, 'base64url');
    expect(raw).toHaveLength(65);
    expect(raw[0]).toBe(4);
  });
```

In the same file's `buildBrowserBundles` test, save, set, and restore a third variable next to the other two:

```js
    const priorVapid = process.env.RODA_VAPID_PUBLIC_KEY;
```

```js
      process.env.RODA_VAPID_PUBLIC_KEY = TEST_VAPID_PUBLIC_KEY;
```

(set right after `RODA_SUPABASE_PUBLISHABLE_KEY`), and in `finally`:

```js
      if (priorVapid === undefined) delete process.env.RODA_VAPID_PUBLIC_KEY;
      else process.env.RODA_VAPID_PUBLIC_KEY = priorVapid;
```

In `tests/unit/release-scan.test.js`, change the import to `import { TEST_VAPID_PUBLIC_KEY, buildBrowserBundles } from '../../scripts/build.mjs';` and replace the body of the test (everything inside `it('finds nothing in a production build', async () => { … }`) with:

```js
    const pattern = await documentedPattern();
    const out = await mkdtemp(join(tmpdir(), 'roda-release-scan-'));
    const names = ['RODA_SUPABASE_URL', 'RODA_SUPABASE_PUBLISHABLE_KEY', 'RODA_VAPID_PUBLIC_KEY'];
    const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    process.env.RODA_SUPABASE_URL = 'https://example.supabase.co';
    process.env.RODA_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_release_scan';
    process.env.RODA_VAPID_PUBLIC_KEY = TEST_VAPID_PUBLIC_KEY;
    try {
      await buildBrowserBundles({ outputDirectory: out });
      const hits = [];
      for (const name of await readdir(out)) {
        if (pattern.test(await readFile(join(out, name), 'utf8'))) hits.push(name);
      }
      expect(hits).toEqual([]);
    } finally {
      for (const name of names) {
        if (prior[name] === undefined) delete process.env[name];
        else process.env[name] = prior[name];
      }
      await rm(out, { force: true, recursive: true });
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/build-config.test.js tests/unit/release-scan.test.js`
Expected: FAIL: `TEST_VAPID_PUBLIC_KEY` is not exported, and `readPublicConfig` returns no `vapidPublicKey`.

- [ ] **Step 3: Implement**

In `scripts/build.mjs`, replace `TEST_CONFIG` with:

```js
// A well-known example P-256 public key: browser tests never reach a push service.
export const TEST_VAPID_PUBLIC_KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

const TEST_CONFIG = Object.freeze({
  RODA_SUPABASE_URL: 'http://127.0.0.1:54321',
  RODA_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e_test',
  RODA_VAPID_PUBLIC_KEY: TEST_VAPID_PUBLIC_KEY,
});
```

In `readPublicConfig`, replace the final `return { supabaseUrl, supabasePublishableKey };` with:

```js
  // Ruling 2: the browser subscribes with this key; it is public by design.
  const vapidPublicKey = env.RODA_VAPID_PUBLIC_KEY?.trim();
  if (!vapidPublicKey) {
    throw new Error('RODA_VAPID_PUBLIC_KEY is required');
  }
  const point = /^[A-Za-z0-9_-]+$/.test(vapidPublicKey) ? Buffer.from(vapidPublicKey, 'base64url') : Buffer.alloc(0);
  if (point.length !== 65 || point[0] !== 4) {
    throw new Error('RODA_VAPID_PUBLIC_KEY must be a base64url P-256 public key');
  }

  return { supabaseUrl, supabasePublishableKey, vapidPublicKey };
```

In `buildBrowserBundles`, add to the page bundles' `define`:

```js
      __RODA_VAPID_PUBLIC_KEY__: JSON.stringify(publicConfig.vapidPublicKey),
```

Replace `src/app/config.js` with:

```js
export const publicConfig = Object.freeze({
  supabaseUrl: __RODA_SUPABASE_URL__,
  supabasePublishableKey: __RODA_SUPABASE_PUBLISHABLE_KEY__,
  vapidPublicKey: __RODA_VAPID_PUBLIC_KEY__,
});
```

In `tests/unit/helpers/module-graph.js`, add to `DEFINE`:

```js
  __RODA_VAPID_PUBLIC_KEY__: '"BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U"',
```

Append to `.env.example`:

```text
# Phone notifications: the VAPID public key (base64url). Its private half is a
# Supabase function secret and never belongs here.
RODA_VAPID_PUBLIC_KEY=
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/build-config.test.js tests/unit/release-scan.test.js tests/unit/dead-code.test.js`
Expected: PASS.

- [ ] **Step 5: Run the suites**

Run: `npm run test:unit && npm run test:e2e`
Expected: PASS. A local production build (`npm run build`) now needs `RODA_VAPID_PUBLIC_KEY` in `.env.local`; the test build does not.

- [ ] **Step 6: Commit**

```bash
git add scripts/build.mjs src/app/config.js .env.example tests/unit/helpers/module-graph.js tests/unit/build-config.test.js tests/unit/release-scan.test.js
git commit -m "feat: read the push notification public key at build time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Devices, preferences, and the delivery log in the database

**Files:**
- Create: `supabase/migrations/202611010001_notifications.sql`, `supabase/tests/0046_notification_settings.test.sql`

**Interfaces:**
- Produces (tables, RLS on, `select` of own rows for `authenticated`, no client writes):
  - `public.push_subscriptions(id, profile_id, endpoint unique, p256dh, auth, locale 'en'|'pt', timezone, failures, last_sent_at, created_at, updated_at)`.
  - `public.notification_preferences(profile_id pk, setup, before_class, before_minutes ∈ {15,30,60,120}, after_class, after_minutes ∈ {30,60,120}, coach, quiet_start time, quiet_end time, updated_at)`. Both quiet values are null when quiet hours are off, and a missing row means the defaults.
  - `public.notification_deliveries(id, profile_id, kind ∈ {setup,before_class,after_class,coach}, subject_key, due_at, payload jsonb, status ∈ {pending,sent,failed}, attempts 1–3, claimed_at, sent_at, created_at)`, with constraint `notification_deliveries_subject_key unique (profile_id, kind, subject_key)`.
- Produces (RPCs for `authenticated`):
  - `public.save_push_subscription(endpoint text, p256dh text, auth_key text, locale text, timezone text default null) → { status: 'saved', subscription_id }`, which raises `P0001 invalid_subscription`.
  - `public.delete_push_subscription(endpoint text) → { status: 'deleted' | 'missing' }`.
  - `public.get_notification_preferences() → { setup, before_class, before_minutes, after_class, after_minutes, coach, quiet_start: 'HH:MM' | null, quiet_end: 'HH:MM' | null }`.
  - `public.update_notification_preferences(setup boolean, before_class boolean, before_minutes integer, after_class boolean, after_minutes integer, coach boolean, quiet_start text default null, quiet_end text default null)`, which returns the same object and raises `P0001 invalid_preferences`.
- Produces (helpers for later migrations): `private.is_push_endpoint(text) → boolean`, `private.notification_preferences_json(uuid) → jsonb`.

- [ ] **Step 1: Write the failing database test**

Check the next free numbers first: `ls supabase/migrations | tail -3` (the new migration must sort last) and `ls supabase/tests` (`0046` must be free; `0040`–`0045` are reserved).

```sql
-- supabase/tests/0046_notification_settings.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_table('public', 'push_subscriptions', 'devices are stored');
select has_table('public', 'notification_preferences', 'preferences are stored');
select has_table('public', 'notification_deliveries', 'deliveries are logged');
select ok((
  select bool_and(relation.relrowsecurity) from pg_catalog.pg_class relation
   where relation.oid in ('public.push_subscriptions'::regclass, 'public.notification_preferences'::regclass,
                          'public.notification_deliveries'::regclass)
), 'every notification table has RLS');

select tests.create_user('10000000-0000-0000-0000-000000004601', 'ana46@example.test', 'Ana Quarenta Seis');
select tests.create_user('10000000-0000-0000-0000-000000004602', 'bia46@example.test', 'Bia Quarenta Seis');

-- This device
reset role;
select tests.set_actor('10000000-0000-0000-0000-000000004601');
select is(public.save_push_subscription('https://fcm.googleapis.com/fcm/send/ana-phone', repeat('B', 87), repeat('a', 22), 'pt', 'Europe/Lisbon') ->> 'status',
  'saved', 'a person saves this device');
select is((select locale || ' ' || timezone from public.push_subscriptions), 'pt Europe/Lisbon', 'the device keeps its language and zone');
select is(public.save_push_subscription('https://fcm.googleapis.com/fcm/send/ana-phone', repeat('B', 87), repeat('a', 22), 'en', 'Not/AZone') ->> 'status',
  'saved', 'saving the same device again updates it');
select is((select locale || ' ' || coalesce(timezone, 'none') from public.push_subscriptions), 'en none', 'an unknown zone is dropped, not refused');
select is((select count(*)::integer from public.push_subscriptions), 1, 'one row per device');
select throws_ok($$ select public.save_push_subscription('https://attacker.example/push', repeat('B', 87), repeat('a', 22), 'en', null) $$,
  'P0001', 'invalid_subscription', 'endpoints outside the known push services are refused');
select throws_ok($$ select public.save_push_subscription('http://fcm.googleapis.com/fcm/send/x', repeat('B', 87), repeat('a', 22), 'en', null) $$,
  'P0001', 'invalid_subscription', 'plain http is refused');
select throws_ok($$ select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/x', 'short', repeat('a', 22), 'en', null) $$,
  'P0001', 'invalid_subscription', 'malformed keys are refused');
select throws_ok($$ select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/x', repeat('B', 87), repeat('a', 22), 'fr', null) $$,
  'P0001', 'invalid_subscription', 'only English and Portuguese');
select throws_ok($$ insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth)
  values ('10000000-0000-0000-0000-000000004601', 'https://fcm.googleapis.com/fcm/send/direct', repeat('B', 87), repeat('a', 22)) $$,
  '42501', null, 'clients cannot write devices directly');
select throws_ok($$ update public.notification_preferences set setup = false $$, '42501', null, 'clients cannot write preferences directly');
select throws_ok($$ delete from public.notification_deliveries $$, '42501', null, 'clients cannot change the delivery log');

-- What to send
select is(public.get_notification_preferences(), '{"setup": true, "before_class": true, "before_minutes": 60, "after_class": true,
  "after_minutes": 60, "coach": true, "quiet_start": "22:00", "quiet_end": "08:00"}'::jsonb, 'a missing row means the defaults');
select is(public.update_notification_preferences(true, false, 30, true, 120, false, '23:00', '07:00'),
  '{"setup": true, "before_class": false, "before_minutes": 30, "after_class": true, "after_minutes": 120, "coach": false,
    "quiet_start": "23:00", "quiet_end": "07:00"}'::jsonb, 'choices are saved and returned');
select is(public.get_notification_preferences() ->> 'before_minutes', '30', 'and read back');
select is(public.update_notification_preferences(true, true, 60, true, 60, true, null, null) -> 'quiet_start', 'null'::jsonb,
  'quiet hours can be turned off');
select throws_ok($$ select public.update_notification_preferences(true, true, 45, true, 60, true, '22:00', '08:00') $$,
  'P0001', 'invalid_preferences', 'only the offered lead times');
select throws_ok($$ select public.update_notification_preferences(true, true, 60, true, 15, true, '22:00', '08:00') $$,
  'P0001', 'invalid_preferences', 'only the offered delays');
select throws_ok($$ select public.update_notification_preferences(true, true, 60, true, 60, true, '22:00', null) $$,
  'P0001', 'invalid_preferences', 'quiet hours need both ends');
select throws_ok($$ select public.update_notification_preferences(true, true, 60, true, 60, true, '22:00', '22:00') $$,
  'P0001', 'invalid_preferences', 'quiet hours need two different times');
select throws_ok($$ select public.update_notification_preferences(true, true, 60, true, 60, true, '22:30', '08:00') $$,
  'P0001', 'invalid_preferences', 'quiet hours are whole hours');
select throws_ok($$ select public.update_notification_preferences(null, true, 60, true, 60, true, '22:00', '08:00') $$,
  'P0001', 'invalid_preferences', 'every switch is on or off');

-- Other people
reset role;
insert into public.notification_deliveries (profile_id, kind, subject_key, due_at)
values ('10000000-0000-0000-0000-000000004601', 'setup', 'setup:1', '2030-01-01T10:00:00Z');
select tests.set_actor('10000000-0000-0000-0000-000000004601');
select is((select count(*)::integer from public.notification_deliveries), 1, 'a person sees their own deliveries');
reset role;
select tests.set_actor('10000000-0000-0000-0000-000000004602');
select is((select count(*)::integer from public.push_subscriptions), 0, 'another person sees none of Ana''s devices');
select is((select count(*)::integer from public.notification_preferences), 0, 'nor her preferences');
select is((select count(*)::integer from public.notification_deliveries), 0, 'nor her deliveries');
select is(public.delete_push_subscription('https://fcm.googleapis.com/fcm/send/ana-phone') ->> 'status', 'missing',
  'nobody deletes another person''s device');
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/ana-phone', repeat('C', 87), repeat('b', 22), 'en', null);
reset role;
select is((select profile_id::text from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/ana-phone'),
  '10000000-0000-0000-0000-000000004602', 'a phone that signs into another account moves there, so Ana stops receiving on it');

select tests.set_actor('10000000-0000-0000-0000-000000004601');
-- Ruling 13: at most ten devices, the newest kept.
select count(saved.result) from (
  select public.save_push_subscription('https://updates.push.services.mozilla.com/wpush/v2/ana-' || n, repeat('B', 87), repeat('a', 22), 'en', null) as result
    from generate_series(1, 11) n
) saved;
select is((select count(*)::integer from public.push_subscriptions), 10, 'a person keeps at most ten devices');
select is(public.delete_push_subscription('https://updates.push.services.mozilla.com/wpush/v2/ana-11') ->> 'status', 'deleted',
  'the newest device is kept, and turning it off deletes it');

reset role;
-- Visitors
select tests.set_actor(null, 'anon');
select throws_ok($$ select public.get_notification_preferences() $$, '42501', null, 'visitors cannot read preferences');
select throws_ok($$ select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/x', repeat('B', 87), repeat('a', 22), 'en', null) $$,
  '42501', null, 'visitors cannot save devices');

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx supabase test db supabase/tests/0046_notification_settings.test.sql`
Expected: FAIL: `has_table` fails for `push_subscriptions`, and the script stops at the first missing function.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/202611010001_notifications.sql
-- Phone notifications, part 1: devices, preferences, and the delivery log.
-- Spec: docs/superpowers/specs/2026-11-01-notifications-design.md. People
-- reach these tables only through the RPCs below; the sender reaches them
-- through the service-role functions of 202611010002 and 202611010003.

-- Ruling 12: only the push services of the browsers roda supports.
create function private.is_push_endpoint(candidate text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    char_length(candidate) <= 2048
    and candidate ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/[^[:space:]]+$',
    false
  );
$$;

create table public.push_subscriptions (
  id uuid primary key default extensions.gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  locale text not null default 'en',
  timezone text,
  failures integer not null default 0,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_key unique (endpoint),
  constraint push_subscriptions_endpoint_check check (private.is_push_endpoint(endpoint)),
  constraint push_subscriptions_keys_check check (
    p256dh ~ '^[A-Za-z0-9_-]{80,100}={0,2}$' and auth ~ '^[A-Za-z0-9_-]{16,44}={0,2}$'
  ),
  constraint push_subscriptions_locale_check check (locale in ('en', 'pt')),
  constraint push_subscriptions_timezone_check check (timezone is null or char_length(timezone) between 1 and 64),
  constraint push_subscriptions_failures_check check (failures >= 0)
);
create index push_subscriptions_profile_idx on public.push_subscriptions (profile_id, updated_at desc);
create trigger push_subscriptions_set_updated_at
before update on public.push_subscriptions
for each row execute function private.set_updated_at();

create table public.notification_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  setup boolean not null default true,
  before_class boolean not null default true,
  before_minutes integer not null default 60,
  after_class boolean not null default true,
  after_minutes integer not null default 60,
  coach boolean not null default true,
  quiet_start time default '22:00',
  quiet_end time default '08:00',
  updated_at timestamptz not null default now(),
  constraint notification_preferences_before_check check (before_minutes in (15, 30, 60, 120)),
  constraint notification_preferences_after_check check (after_minutes in (30, 60, 120)),
  constraint notification_preferences_quiet_check check (
    (quiet_start is null and quiet_end is null)
    or (
      quiet_start is not null and quiet_end is not null and quiet_start <> quiet_end
      and extract(minute from quiet_start) = 0 and extract(second from quiet_start) = 0
      and extract(minute from quiet_end) = 0 and extract(second from quiet_end) = 0
    )
  )
);

create table public.notification_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  subject_key text not null,
  due_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 1,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notification_deliveries_subject_key unique (profile_id, kind, subject_key),
  constraint notification_deliveries_kind_check check (kind in ('setup', 'before_class', 'after_class', 'coach')),
  constraint notification_deliveries_subject_check check (char_length(subject_key) between 1 and 200),
  constraint notification_deliveries_status_check check (status in ('pending', 'sent', 'failed')),
  constraint notification_deliveries_sent_check check ((status = 'sent') = (sent_at is not null)),
  constraint notification_deliveries_attempts_check check (attempts between 1 and 3)
);
create index notification_deliveries_pending_idx
  on public.notification_deliveries (claimed_at) where status = 'pending';

alter table public.push_subscriptions enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_deliveries enable row level security;
create policy push_subscriptions_select_own on public.push_subscriptions
for select to authenticated using (profile_id = (select auth.uid()));
create policy notification_preferences_select_own on public.notification_preferences
for select to authenticated using (profile_id = (select auth.uid()));
create policy notification_deliveries_select_own on public.notification_deliveries
for select to authenticated using (profile_id = (select auth.uid()));
revoke all on table public.push_subscriptions, public.notification_preferences, public.notification_deliveries
  from public, anon, authenticated;
grant select on table public.push_subscriptions, public.notification_preferences, public.notification_deliveries
  to authenticated;

create function private.save_push_subscription(
  actor_id uuid, new_endpoint text, new_p256dh text, new_auth text, new_locale text, new_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
  zone text := nullif(btrim(coalesce(new_timezone, '')), '');
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if not private.is_push_endpoint(new_endpoint)
     or coalesce(new_p256dh, '') !~ '^[A-Za-z0-9_-]{80,100}={0,2}$'
     or coalesce(new_auth, '') !~ '^[A-Za-z0-9_-]{16,44}={0,2}$'
     or coalesce(new_locale, '') not in ('en', 'pt') then
    raise exception using errcode = 'P0001', message = 'invalid_subscription';
  end if;
  -- Ruling 7: an unknown zone is dropped, not refused; the person's zone then
  -- falls back to their profile or another device.
  if zone is not null and not private.is_valid_timezone(zone) then
    zone := null;
  end if;
  -- Ruling 13: the same endpoint signing into another account moves there.
  insert into public.push_subscriptions as device (profile_id, endpoint, p256dh, auth, locale, timezone)
  values (actor_id, new_endpoint, new_p256dh, new_auth, new_locale, zone)
  on conflict on constraint push_subscriptions_endpoint_key do update
     set profile_id = excluded.profile_id, p256dh = excluded.p256dh, auth = excluded.auth,
         locale = excluded.locale, timezone = excluded.timezone, failures = 0
  returning device.id into saved_id;
  -- At most ten devices per person; the one just saved always stays.
  delete from public.push_subscriptions old
   where old.profile_id = actor_id
     and old.id not in (
       select recent.id from public.push_subscriptions recent
        where recent.profile_id = actor_id
        order by (recent.id = saved_id) desc, recent.updated_at desc, recent.id
        limit 10
     );
  return jsonb_build_object('status', 'saved', 'subscription_id', saved_id);
end;
$$;

create function private.delete_push_subscription(actor_id uuid, target_endpoint text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare removed integer;
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  delete from public.push_subscriptions device
   where device.profile_id = actor_id and device.endpoint = target_endpoint;
  get diagnostics removed = row_count;
  return jsonb_build_object('status', case when removed > 0 then 'deleted' else 'missing' end);
end;
$$;

create function private.notification_preferences_json(target_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'setup', coalesce(pref.setup, true),
    'before_class', coalesce(pref.before_class, true),
    'before_minutes', coalesce(pref.before_minutes, 60),
    'after_class', coalesce(pref.after_class, true),
    'after_minutes', coalesce(pref.after_minutes, 60),
    'coach', coalesce(pref.coach, true),
    'quiet_start', case when pref.profile_id is null then '22:00' else left(pref.quiet_start::text, 5) end,
    'quiet_end', case when pref.profile_id is null then '08:00' else left(pref.quiet_end::text, 5) end
  )
  from (select target_profile_id as id) person
  left join public.notification_preferences pref on pref.profile_id = person.id;
$$;

create function private.get_notification_preferences(actor_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  return private.notification_preferences_json(actor_id);
end;
$$;

create function private.update_notification_preferences(
  actor_id uuid, new_setup boolean, new_before_class boolean, new_before_minutes integer,
  new_after_class boolean, new_after_minutes integer, new_coach boolean, new_quiet_start text, new_quiet_end text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if actor_id is null then
    raise exception using errcode = 'PT401', message = 'not_authenticated';
  end if;
  if new_setup is null or new_before_class is null or new_after_class is null or new_coach is null
     or new_before_minutes is null or new_before_minutes not in (15, 30, 60, 120)
     or new_after_minutes is null or new_after_minutes not in (30, 60, 120)
     or (new_quiet_start is null) <> (new_quiet_end is null)
     or coalesce(new_quiet_start, '00:00') !~ '^([01][0-9]|2[0-3]):00$'
     or coalesce(new_quiet_end, '00:00') !~ '^([01][0-9]|2[0-3]):00$'
     or (new_quiet_start is not null and new_quiet_start = new_quiet_end) then
    raise exception using errcode = 'P0001', message = 'invalid_preferences';
  end if;
  insert into public.notification_preferences (
    profile_id, setup, before_class, before_minutes, after_class, after_minutes, coach, quiet_start, quiet_end
  ) values (
    actor_id, new_setup, new_before_class, new_before_minutes, new_after_class, new_after_minutes, new_coach,
    new_quiet_start::time, new_quiet_end::time
  )
  on conflict (profile_id) do update
     set setup = excluded.setup, before_class = excluded.before_class, before_minutes = excluded.before_minutes,
         after_class = excluded.after_class, after_minutes = excluded.after_minutes, coach = excluded.coach,
         quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end, updated_at = now();
  return private.notification_preferences_json(actor_id);
end;
$$;

create function public.save_push_subscription(
  endpoint text, p256dh text, auth_key text, locale text, timezone text default null
)
returns jsonb
language sql
set search_path = ''
as $$ select private.save_push_subscription(auth.uid(), endpoint, p256dh, auth_key, locale, timezone); $$;

create function public.delete_push_subscription(endpoint text)
returns jsonb
language sql
set search_path = ''
as $$ select private.delete_push_subscription(auth.uid(), endpoint); $$;

create function public.get_notification_preferences()
returns jsonb
language sql
stable
set search_path = ''
as $$ select private.get_notification_preferences(auth.uid()); $$;

create function public.update_notification_preferences(
  setup boolean, before_class boolean, before_minutes integer, after_class boolean, after_minutes integer,
  coach boolean, quiet_start text default null, quiet_end text default null
)
returns jsonb
language sql
set search_path = ''
as $$
  select private.update_notification_preferences(
    auth.uid(), setup, before_class, before_minutes, after_class, after_minutes, coach, quiet_start, quiet_end
  );
$$;

revoke execute on function private.is_push_endpoint(text) from public, anon, authenticated;
revoke execute on function private.notification_preferences_json(uuid) from public, anon, authenticated;
revoke execute on function private.save_push_subscription(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function private.delete_push_subscription(uuid, text) from public, anon, authenticated;
revoke execute on function private.get_notification_preferences(uuid) from public, anon, authenticated;
revoke execute on function private.update_notification_preferences(uuid, boolean, boolean, integer, boolean, integer, boolean, text, text)
  from public, anon, authenticated;
grant execute on function private.save_push_subscription(uuid, text, text, text, text, text) to authenticated;
grant execute on function private.delete_push_subscription(uuid, text) to authenticated;
grant execute on function private.get_notification_preferences(uuid) to authenticated;
grant execute on function private.update_notification_preferences(uuid, boolean, boolean, integer, boolean, integer, boolean, text, text)
  to authenticated;
revoke execute on function public.save_push_subscription(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.delete_push_subscription(text) from public, anon, authenticated;
revoke execute on function public.get_notification_preferences() from public, anon, authenticated;
revoke execute on function public.update_notification_preferences(boolean, boolean, integer, boolean, integer, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.save_push_subscription(text, text, text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;
grant execute on function public.get_notification_preferences() to authenticated;
grant execute on function public.update_notification_preferences(boolean, boolean, integer, boolean, integer, boolean, text, text)
  to authenticated;
```

- [ ] **Step 4: Apply and run the test to verify it passes**

Run: `npx supabase migration up --local && npx supabase test db supabase/tests/0046_notification_settings.test.sql`
Expected: PASS.

- [ ] **Step 5: Run the database suite**

Run: `npm run test:db`
Expected: PASS (no earlier test touches the new tables).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/202611010001_notifications.sql supabase/tests/0046_notification_settings.test.sql
git commit -m "feat: store notification devices and preferences

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The database decides what is due

**Files:**
- Create: `supabase/migrations/202611010002_notification_claims.sql`, `supabase/tests/0047_notification_due.test.sql`

**Interfaces:**
- Consumes (Task 2): the three tables, `private.is_push_endpoint`, `notification_deliveries_subject_key`.
- Consumes (existing): `private.can_manage_schedule(actor_id uuid, schedule_id uuid)`, `private.is_valid_timezone(text)`.
- Produces: `public.claim_due_notifications(at_time timestamptz default now(), batch_limit integer default 50)` returns rows `(delivery_id uuid, profile_id uuid, kind text, subject_key text, payload jsonb, devices jsonb)`, executable by `service_role` only. `devices` is `[{ subscription_id, endpoint, p256dh, auth, locale }]`. `payload` by kind (every payload has `url` and `zone`):
  - `setup`: `{ url: '/app#/', round }`
  - `before_class`: `{ url, role: 'coach'|'student', class_kind: 'group'|'personal_class', group_name, person_name, starts_at, lead_minutes }`
  - `after_class`: `{ url, occurrence_id, class_kind, group_name, person_name, local_date }`
  - `coach`: `{ url, reason: 'join'|'coaching'|'finish', person_name, group_name?, class_kind?, local_date? }`
- Produces (helpers): `private.in_quiet_hours(timestamptz, text, time, time)`, `private.after_quiet_hours(...)`, `private.can_deliver_now(timestamptz, timestamptz, text, time, time)`, `private.notification_recipients()`, `private.due_notifications(timestamptz)`.

- [ ] **Step 1: Write the failing database test**

All times are in January and February 2030, when Lisbon is on UTC, so `…T18:00:00Z` is 18:00 in Lisbon. Fábio has no profile zone; his device is in New York (UTC−5).

```sql
-- supabase/tests/0047_notification_due.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_function('public', 'claim_due_notifications', array['timestamp with time zone', 'integer'], 'the sender claims what is due');

select tests.create_user('10000000-0000-0000-0000-000000004701', 'lua47@example.test', 'Mestre Lua');
select tests.create_user('10000000-0000-0000-0000-000000004702', 'ana47@example.test', 'Ana Quarenta Sete');
select tests.create_user('10000000-0000-0000-0000-000000004703', 'bia47@example.test', 'Bia Quarenta Sete');
select tests.create_user('10000000-0000-0000-0000-000000004704', 'caio47@example.test', 'Caio Quarenta Sete');
select tests.create_user('10000000-0000-0000-0000-000000004705', 'dani47@example.test', 'Dani Quarenta Sete');
select tests.create_user('10000000-0000-0000-0000-000000004706', 'eve47@example.test', 'Eve Quarenta Sete');
select tests.create_user('10000000-0000-0000-0000-000000004707', 'fabio47@example.test', 'Fabio Quarenta Sete');
select tests.create_user('10000000-0000-0000-0000-000000004708', 'gil47@example.test', 'Gil Quarenta Sete');
select tests.create_user('10000000-0000-0000-0000-000000004709', 'hugo47@example.test', 'Hugo Quarenta Sete');
update public.profiles set completed_at = '2030-01-01T10:00:00Z', timezone_override = 'Europe/Lisbon'
 where id in ('10000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004702',
              '10000000-0000-0000-0000-000000004703', '10000000-0000-0000-0000-000000004705');
update public.profiles set completed_at = '2030-01-01T10:00:00Z' where id = '10000000-0000-0000-0000-000000004707';
update public.profiles set completed_at = '2030-02-01T10:00:00Z' where id = '10000000-0000-0000-0000-000000004706';
update public.profiles set completed_at = '2030-02-01T23:00:00Z' where id = '10000000-0000-0000-0000-000000004709';
insert into public.coach_profiles (profile_id) values ('10000000-0000-0000-0000-000000004701');
insert into public.groups (id, owner_id, name, timezone)
values ('20000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004701', 'Grupo Lua', 'Europe/Lisbon');
insert into public.group_memberships (group_id, profile_id, access_level) values
  ('20000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004701', 'coach'),
  ('20000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004702', 'member'),
  ('20000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004703', 'member'),
  ('20000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004705', 'member'),
  ('20000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004707', 'member');
-- Bia, Caio, and Gil have no device, so they never appear.
insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth, locale, timezone) values
  ('10000000-0000-0000-0000-000000004701', 'https://fcm.googleapis.com/fcm/send/lua47', repeat('B', 87), repeat('a', 22), 'pt', 'Europe/Lisbon'),
  ('10000000-0000-0000-0000-000000004702', 'https://fcm.googleapis.com/fcm/send/ana47', repeat('B', 87), repeat('a', 22), 'en', 'Europe/Lisbon'),
  ('10000000-0000-0000-0000-000000004705', 'https://web.push.apple.com/dani47', repeat('B', 87), repeat('a', 22), 'en', 'Europe/Lisbon'),
  ('10000000-0000-0000-0000-000000004706', 'https://fcm.googleapis.com/fcm/send/eve47', repeat('B', 87), repeat('a', 22), 'en', 'Europe/Lisbon'),
  ('10000000-0000-0000-0000-000000004707', 'https://fcm.googleapis.com/fcm/send/fabio47', repeat('B', 87), repeat('a', 22), 'en', 'America/New_York'),
  ('10000000-0000-0000-0000-000000004709', 'https://fcm.googleapis.com/fcm/send/hugo47', repeat('B', 87), repeat('a', 22), 'en', 'Europe/Lisbon');
-- Finish setting up is tested last, with Eve and Hugo; it is off for everyone else.
insert into public.notification_preferences (profile_id, setup, before_minutes) values
  ('10000000-0000-0000-0000-000000004701', false, 60), ('10000000-0000-0000-0000-000000004702', false, 60),
  ('10000000-0000-0000-0000-000000004705', false, 15), ('10000000-0000-0000-0000-000000004707', false, 60);

create temp table claimed (label text, delivery_id uuid, profile_id uuid, kind text, subject_key text, payload jsonb, devices jsonb);
create function pg_temp.claim(at_time timestamptz, label text)
returns void
language sql
as $$
  insert into claimed select label, due.* from public.claim_due_notifications(at_time, 50) due;
  -- Pretend the sender delivered everything, so each later run shows only new work.
  update public.notification_deliveries set status = 'sent', sent_at = claimed_at where status = 'pending';
$$;

reset role;
select tests.set_actor('10000000-0000-0000-0000-000000004701');
select public.create_workout_plan(
  'Armada ladder', null, null, 60, null,
  '[{"source_text":"10x (armada, au)","movements":[{"movement_key":"armada","movement_name":"Armada","segment_key":"m:1"}]}]'::jsonb
) ->> 'plan_id' as plan_id \gset
select public.publish_workout_plan(:'plan_id') ->> 'version_id' as version_id \gset
reset role;
insert into public.scheduled_trainings (
  id, kind, plan_version_id, arranged_by, group_id, starts_at, local_date, timezone, expected_duration_minutes, visible_in_advance
) values
  ('50000000-0000-0000-0000-000000004701', 'group', :'version_id', '10000000-0000-0000-0000-000000004701',
   '20000000-0000-0000-0000-000000004701', '2030-01-15T19:00:00Z', '2030-01-15', 'Europe/Lisbon', 90, true),
  ('50000000-0000-0000-0000-000000004702', 'group', :'version_id', '10000000-0000-0000-0000-000000004701',
   '20000000-0000-0000-0000-000000004701', '2030-01-16T00:30:00Z', '2030-01-16', 'Europe/Lisbon', 60, true),
  ('50000000-0000-0000-0000-000000004703', 'group', :'version_id', '10000000-0000-0000-0000-000000004701',
   '20000000-0000-0000-0000-000000004701', '2030-01-17T19:00:00Z', '2030-01-17', 'Europe/Lisbon', 60, false),
  ('50000000-0000-0000-0000-000000004704', 'group', :'version_id', '10000000-0000-0000-0000-000000004701',
   '20000000-0000-0000-0000-000000004701', '2030-01-19T10:00:00Z', '2030-01-19', 'Europe/Lisbon', 60, true);

-- Before a class
select pg_temp.claim('2030-01-15T17:59:00Z', 'early');
select is((select count(*)::integer from claimed where label = 'early' and kind = 'before_class'), 0,
  'nothing before the reminder moment');
select pg_temp.claim('2030-01-15T18:00:30Z', 'moment');
select results_eq(
  $$ select profile_id::text, payload ->> 'role', payload ->> 'url' from claimed
      where label = 'moment' and kind = 'before_class' order by 2, 1 $$,
  $$ values ('10000000-0000-0000-0000-000000004701', 'coach', '/app#/class/50000000-0000-0000-0000-000000004701'),
            ('10000000-0000-0000-0000-000000004702', 'student', '/app#/calendar/2030-01-15'),
            ('10000000-0000-0000-0000-000000004707', 'student', '/app#/calendar/2030-01-15') $$,
  'an hour before, the coach and each member with a device and a one-hour lead are reminded');
select is((select payload ->> 'person_name' || ' · ' || (payload ->> 'lead_minutes') from claimed
            where label = 'moment' and profile_id = '10000000-0000-0000-0000-000000004702'),
  'Mestre Lua · 60', 'students learn who teaches and the lead');
select ok((select (payload ->> 'starts_at')::timestamptz = '2030-01-15T19:00:00Z' and payload ->> 'zone' = 'Europe/Lisbon'
             and payload ->> 'group_name' = 'Grupo Lua' and payload ->> 'class_kind' = 'group'
             from claimed where label = 'moment' and profile_id = '10000000-0000-0000-0000-000000004702'),
  'the payload carries what the text needs');
select is((select devices -> 0 ->> 'locale' from claimed
            where label = 'moment' and profile_id = '10000000-0000-0000-0000-000000004701'),
  'pt', 'each delivery lists the person''s devices with their language');
select pg_temp.claim('2030-01-15T18:05:00Z', 'again');
select is((select count(*)::integer from claimed where label = 'again' and kind = 'before_class'), 0,
  'a reminder is sent at most once');
select pg_temp.claim('2030-01-15T18:45:10Z', 'dani');
select results_eq($$ select profile_id::text from claimed where label = 'dani' and kind = 'before_class' $$,
  $$ values ('10000000-0000-0000-0000-000000004705') $$, 'each person''s own lead time is honored');
select pg_temp.claim('2030-01-15T23:30:30Z', 'late');
select results_eq(
  $$ select profile_id::text from claimed where label = 'late' and kind = 'before_class' $$,
  $$ values ('10000000-0000-0000-0000-000000004707') $$,
  'quiet hours follow each person''s zone: 23:30 in Lisbon is skipped, 18:30 in New York is not');
select pg_temp.claim('2030-01-17T18:00:30Z', 'hidden');
select results_eq($$ select profile_id::text from claimed where label = 'hidden' and kind = 'before_class' $$,
  $$ values ('10000000-0000-0000-0000-000000004701') $$, 'a class hidden from students reminds only its coach');

-- After a class
insert into public.training_occurrences (
  id, schedule_id, kind, group_id, recorded_by, occurred_at, local_date, timezone, default_duration_minutes, idempotency_key
) values
  ('60000000-0000-0000-0000-000000004701', '50000000-0000-0000-0000-000000004701', 'group', '20000000-0000-0000-0000-000000004701',
   '10000000-0000-0000-0000-000000004701', '2030-01-15T19:00:00Z', '2030-01-15', 'Europe/Lisbon', 90, '70000000-0000-0000-0000-000000004701'),
  ('60000000-0000-0000-0000-000000004702', null, 'group', '20000000-0000-0000-0000-000000004701',
   '10000000-0000-0000-0000-000000004701', '2030-01-20T20:30:00Z', '2030-01-20', 'Europe/Lisbon', 60, '70000000-0000-0000-0000-000000004702'),
  ('60000000-0000-0000-0000-000000004703', null, 'group', '20000000-0000-0000-0000-000000004701',
   '10000000-0000-0000-0000-000000004701', '2030-01-21T10:00:00Z', '2030-01-21', 'Europe/Lisbon', 60, '70000000-0000-0000-0000-000000004703');
insert into public.training_occurrence_rounds (id, occurrence_id, position)
values ('90000000-0000-0000-0000-000000004701', '60000000-0000-0000-0000-000000004701', 1);
insert into public.training_participations (id, occurrence_id, profile_id, actual_duration_minutes, confirmed_at, confirmed_by) values
  ('80000000-0000-0000-0000-000000004701', '60000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004702', 90, '2030-01-15T20:30:00Z', '10000000-0000-0000-0000-000000004701'),
  ('80000000-0000-0000-0000-000000004702', '60000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004705', 90, '2030-01-15T20:30:00Z', '10000000-0000-0000-0000-000000004701'),
  ('80000000-0000-0000-0000-000000004703', '60000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004701', 90, '2030-01-15T20:30:00Z', '10000000-0000-0000-0000-000000004701'),
  ('80000000-0000-0000-0000-000000004704', '60000000-0000-0000-0000-000000004702', '10000000-0000-0000-0000-000000004702', 60, '2030-01-20T21:30:00Z', '10000000-0000-0000-0000-000000004701'),
  ('80000000-0000-0000-0000-000000004705', '60000000-0000-0000-0000-000000004703', '10000000-0000-0000-0000-000000004702', 60, '2030-01-21T11:00:00Z', '10000000-0000-0000-0000-000000004701');
-- Dani already rated the class as a whole; the third class already has its video.
insert into public.training_segment_assessments (participation_id, occurrence_round_id, segment_key, segment_kind, difficulty)
values ('80000000-0000-0000-0000-000000004702', '90000000-0000-0000-0000-000000004701', 'r', 'round', 'okay');
insert into public.training_resources (occurrence_id, kind, url, added_by)
values ('60000000-0000-0000-0000-000000004703', 'video', 'https://youtu.be/abc', '10000000-0000-0000-0000-000000004701');

select pg_temp.claim('2030-01-15T21:29:00Z', 'after-early');
select is((select count(*)::integer from claimed where label = 'after-early' and kind = 'after_class'), 0,
  'not before the chosen time after the class ends');
select pg_temp.claim('2030-01-15T21:30:30Z', 'after');
select results_eq(
  $$ select profile_id::text, payload ->> 'url' from claimed where label = 'after' and kind = 'after_class' $$,
  $$ values ('10000000-0000-0000-0000-000000004702', '/app#/training/60000000-0000-0000-0000-000000004701') $$,
  'an hour after the class, attendees without a rating hear; the coach who recorded it and Dani, who rated it, do not');
select pg_temp.claim('2030-01-20T22:30:30Z', 'quiet');
select is((select count(*)::integer from claimed where label = 'quiet' and kind = 'after_class'), 0,
  'a reminder due in quiet hours waits');
select pg_temp.claim('2030-01-21T08:00:30Z', 'morning');
select results_eq(
  $$ select profile_id::text, payload ->> 'local_date' from claimed where label = 'morning' and kind = 'after_class' $$,
  $$ values ('10000000-0000-0000-0000-000000004702', '2030-01-20') $$,
  'and arrives when quiet hours end');
select pg_temp.claim('2030-01-21T12:00:30Z', 'video');
select is((select count(*)::integer from claimed where label = 'video' and kind = 'after_class'), 0,
  'a class that already has its video sends nothing');

-- Coach requests
select pg_temp.claim('2030-01-19T11:29:00Z', 'finish-early');
select is((select count(*)::integer from claimed where label = 'finish-early' and kind = 'coach'), 0,
  'an unfinished class waits 30 minutes after it ends');
select pg_temp.claim('2030-01-19T11:30:30Z', 'finish');
select results_eq(
  $$ select profile_id::text, payload ->> 'reason', payload ->> 'url' from claimed where label = 'finish' and kind = 'coach' $$,
  $$ values ('10000000-0000-0000-0000-000000004701', 'finish', '/app#/class/50000000-0000-0000-0000-000000004704') $$,
  'a class left unfinished reminds its coach');

insert into public.group_join_requests (id, group_id, profile_id, requested_access, created_at, expires_at) values
  ('30000000-0000-0000-0000-000000004701', '20000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004704',
   'member', '2030-01-22T12:00:00Z', '2030-02-22T12:00:00Z'),
  ('30000000-0000-0000-0000-000000004702', '20000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004708',
   'member', '2030-01-22T23:00:00Z', '2030-02-22T23:00:00Z');
select pg_temp.claim('2030-01-22T12:00:30Z', 'join');
select results_eq(
  $$ select profile_id::text, payload ->> 'reason', payload ->> 'person_name', payload ->> 'group_name', payload ->> 'url'
       from claimed where label = 'join' and kind = 'coach' $$,
  $$ values ('10000000-0000-0000-0000-000000004701', 'join', 'Caio Quarenta Sete', 'Grupo Lua',
             '/app#/group/20000000-0000-0000-0000-000000004701') $$,
  'a join request reaches the group''s coach within a minute, and members hear nothing');
select pg_temp.claim('2030-01-22T23:00:30Z', 'join-night');
select is((select count(*)::integer from claimed where label = 'join-night' and kind = 'coach'), 0, 'a request at night waits');
select pg_temp.claim('2030-01-23T08:00:30Z', 'join-morning');
select results_eq($$ select payload ->> 'person_name' from claimed where label = 'join-morning' and kind = 'coach' $$,
  $$ values ('Gil Quarenta Sete') $$, 'and reaches the coach in the morning');

insert into public.coach_student_connections (id, coach_profile_id, student_profile_id, initiated_by, created_at) values
  ('40000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004704',
   '10000000-0000-0000-0000-000000004704', '2030-01-24T15:00:00Z');
select pg_temp.claim('2030-01-24T15:00:30Z', 'coaching');
select results_eq(
  $$ select profile_id::text, payload ->> 'reason', payload ->> 'person_name', payload ->> 'url'
       from claimed where label = 'coaching' and kind = 'coach' $$,
  $$ values ('10000000-0000-0000-0000-000000004701', 'coaching', 'Caio Quarenta Sete', '/app#/me/teaching') $$,
  'a student asking to be coached reaches the coach');

update public.notification_preferences set coach = false where profile_id = '10000000-0000-0000-0000-000000004701';
insert into public.group_join_requests (group_id, profile_id, requested_access, created_at, expires_at) values
  ('20000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004703', 'member', '2030-01-25T12:00:00Z', '2030-02-25T12:00:00Z');
select pg_temp.claim('2030-01-25T12:00:30Z', 'coach-off');
select is((select count(*)::integer from claimed where label = 'coach-off' and kind = 'coach'), 0,
  'turning Coach requests off stops them');

-- Finish setting up
select pg_temp.claim('2030-02-03T09:59:00Z', 'setup-early');
select is((select count(*)::integer from claimed where label = 'setup-early' and kind = 'setup'), 0,
  'not before two days after sign-up');
select pg_temp.claim('2030-02-03T10:00:30Z', 'setup-1');
select results_eq($$ select profile_id::text, subject_key, payload ->> 'url' from claimed where label = 'setup-1' and kind = 'setup' $$,
  $$ values ('10000000-0000-0000-0000-000000004706', 'setup:1', '/app#/') $$, 'two days after sign-up, the first round');
select pg_temp.claim('2030-02-03T23:00:30Z', 'hugo-night');
select is((select count(*)::integer from claimed where label = 'hugo-night' and kind = 'setup'), 0, 'not in quiet hours');
select pg_temp.claim('2030-02-04T08:00:30Z', 'hugo-morning');
select results_eq($$ select profile_id::text from claimed where label = 'hugo-morning' and kind = 'setup' $$,
  $$ values ('10000000-0000-0000-0000-000000004709') $$, 'but as soon as they end');
select pg_temp.claim('2030-02-05T10:00:30Z', 'setup-wait');
select is((select count(*)::integer from claimed where label = 'setup-wait' and kind = 'setup'), 0, 'at most one round a week');

update public.profiles
   set place_city = 'Lisbon', place_region = 'Lisbon', place_country = 'Portugal', place_lat = 38.72, place_lng = -9.14
 where id = '10000000-0000-0000-0000-000000004709';
insert into public.group_memberships (group_id, profile_id, access_level)
values ('20000000-0000-0000-0000-000000004701', '10000000-0000-0000-0000-000000004709', 'member');
insert into public.training_occurrences (kind, recorded_by, occurred_at, local_date, timezone, default_duration_minutes, idempotency_key)
values ('alone', '10000000-0000-0000-0000-000000004709', '2030-02-05T10:00:00Z', '2030-02-05', 'Europe/Lisbon', 30, '70000000-0000-0000-0000-000000004709');

select pg_temp.claim('2030-02-10T10:00:30Z', 'setup-2');
select results_eq($$ select subject_key from claimed where label = 'setup-2' and kind = 'setup' $$,
  $$ values ('setup:2') $$, 'a week later, the second round for Eve; Hugo has finished setting up');
select pg_temp.claim('2030-02-11T09:00:00Z', 'hugo-done');
select is((select count(*)::integer from claimed where label = 'hugo-done' and kind = 'setup'), 0, 'finishing setup stops the rounds');
select pg_temp.claim('2030-02-17T10:00:30Z', 'setup-3');
select results_eq($$ select subject_key from claimed where label = 'setup-3' and kind = 'setup' $$,
  $$ values ('setup:3') $$, 'the third round');
select pg_temp.claim('2030-02-24T10:00:30Z', 'setup-done');
select is((select count(*)::integer from claimed where label = 'setup-done' and kind = 'setup'), 0, 'and never a fourth');

-- Only the sender may claim.
select tests.set_actor('10000000-0000-0000-0000-000000004702');
select throws_ok($$ select * from public.claim_due_notifications() $$, '42501', null, 'a signed-in person cannot claim notifications');
reset role;
select tests.set_actor(null, 'anon');
select throws_ok($$ select * from public.claim_due_notifications() $$, '42501', null, 'nor can a visitor');
reset role;
select tests.set_actor(null, 'service_role');
select lives_ok($$ select * from public.claim_due_notifications('2031-01-01T12:00:00Z', 1) $$, 'the sender, as service role, can');

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx supabase test db supabase/tests/0047_notification_due.test.sql`
Expected: FAIL: `has_function` fails, and creating `pg_temp.claim` stops the script because `public.claim_due_notifications` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/202611010002_notification_claims.sql
-- Phone notifications, part 2: what is due, and claiming it at most once.
-- Rulings 5, 7, 8, and 9 of docs/superpowers/plans/2026-11-01-notifications.md.

create index scheduled_trainings_upcoming_idx on public.scheduled_trainings (starts_at) where state = 'scheduled';
create index training_occurrences_occurred_idx on public.training_occurrences (occurred_at);

create function private.in_quiet_hours(at_time timestamptz, zone text, quiet_start time, quiet_end time)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when quiet_start is null or quiet_end is null then false
    when quiet_start < quiet_end then
      (at_time at time zone zone)::time >= quiet_start and (at_time at time zone zone)::time < quiet_end
    else
      (at_time at time zone zone)::time >= quiet_start or (at_time at time zone zone)::time < quiet_end
  end;
$$;

-- The first moment at or after at_time that is outside quiet hours.
create function private.after_quiet_hours(at_time timestamptz, zone text, quiet_start time, quiet_end time)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when not private.in_quiet_hours(at_time, zone, quiet_start, quiet_end) then at_time
    when (at_time at time zone zone)::time < quiet_end
      then ((at_time at time zone zone)::date + quiet_end) at time zone zone
    else ((at_time at time zone zone)::date + 1 + quiet_end) at time zone zone
  end;
$$;

-- Ruling 8: due, outside quiet hours, and at most 3 hours after quiet hours let it go.
create function private.can_deliver_now(at_time timestamptz, due_at timestamptz, zone text, quiet_start time, quiet_end time)
returns boolean
language sql
stable
set search_path = ''
as $$
  select at_time >= due_at
     and not private.in_quiet_hours(at_time, zone, quiet_start, quiet_end)
     and at_time < private.after_quiet_hours(due_at, zone, quiet_start, quiet_end) + interval '3 hours';
$$;

-- People with at least one device, with their effective preferences and zone (Ruling 7).
create function private.notification_recipients()
returns table (
  profile_id uuid, setup boolean, before_class boolean, before_minutes integer, after_class boolean,
  after_minutes integer, coach boolean, quiet_start time, quiet_end time, zone text
)
language sql
stable
security definer
set search_path = ''
as $$
  select person.id,
         coalesce(pref.setup, true), coalesce(pref.before_class, true), coalesce(pref.before_minutes, 60),
         coalesce(pref.after_class, true), coalesce(pref.after_minutes, 60), coalesce(pref.coach, true),
         case when pref.profile_id is null then time '22:00' else pref.quiet_start end,
         case when pref.profile_id is null then time '08:00' else pref.quiet_end end,
         coalesce(
           case when private.is_valid_timezone(person.timezone_override) then person.timezone_override end,
           (select device.timezone from public.push_subscriptions device
             where device.profile_id = person.id and device.timezone is not null
             order by device.updated_at desc, device.id limit 1),
           'UTC'
         )
    from public.profiles person
    left join public.notification_preferences pref on pref.profile_id = person.id
   where exists (select 1 from public.push_subscriptions device where device.profile_id = person.id);
$$;

create function private.due_notifications(at_time timestamptz)
returns table (profile_id uuid, kind text, subject_key text, due_at timestamptz, payload jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with recipients as materialized (
    select * from private.notification_recipients()
  ),
  upcoming as (
    select schedule.*
      from public.scheduled_trainings schedule
     where schedule.state = 'scheduled'
       and schedule.starts_at > at_time
       and schedule.starts_at <= at_time + interval '2 hours 10 minutes'
       and not exists (select 1 from public.training_occurrences occurrence where occurrence.schedule_id = schedule.id)
  ),
  audience as (
    select upcoming.id as schedule_id, upcoming.arranged_by as profile_id, 'coach'::text as role
      from upcoming
     where private.can_manage_schedule(upcoming.arranged_by, upcoming.id)
    union
    select upcoming.id, membership.profile_id, 'student'
      from upcoming
      join public.groups target_group on target_group.id = upcoming.group_id and target_group.archived_at is null
      join public.group_memberships membership
        on membership.group_id = upcoming.group_id and membership.state = 'active' and membership.access_level = 'member'
     where upcoming.kind = 'group' and upcoming.visible_in_advance and membership.profile_id <> upcoming.arranged_by
    union
    select upcoming.id, upcoming.student_profile_id, 'student'
      from upcoming
     where upcoming.kind = 'personal_class' and upcoming.visible_in_advance
  )
  -- Before a class
  select r.profile_id, 'before_class'::text,
         'class:' || schedule.id || ':' || extract(epoch from schedule.starts_at)::bigint,
         reminder.moment,
         jsonb_build_object(
           'url', case when audience.role = 'coach' then '/app#/class/' || schedule.id
                       else '/app#/calendar/' || to_char(schedule.local_date, 'YYYY-MM-DD') end,
           'role', audience.role, 'class_kind', schedule.kind::text, 'group_name', target_group.name,
           'person_name', case when audience.role = 'coach' then student.display_name else coach.display_name end,
           'starts_at', schedule.starts_at, 'lead_minutes', r.before_minutes, 'zone', r.zone)
    from audience
    join upcoming schedule on schedule.id = audience.schedule_id
    join recipients r on r.profile_id = audience.profile_id
    left join public.groups target_group on target_group.id = schedule.group_id
    left join public.profiles coach on coach.id = schedule.arranged_by
    left join public.profiles student on student.id = schedule.student_profile_id
    cross join lateral (select schedule.starts_at - make_interval(mins => r.before_minutes) as moment) reminder
   where r.before_class
     and at_time >= reminder.moment
     and at_time < reminder.moment + interval '10 minutes'
     and schedule.created_at <= reminder.moment
     and not private.in_quiet_hours(reminder.moment, r.zone, r.quiet_start, r.quiet_end)
  union all
  -- After a class
  select r.profile_id, 'after_class', 'training:' || occurrence.id, due.moment,
         jsonb_build_object(
           'url', '/app#/training/' || occurrence.id, 'occurrence_id', occurrence.id,
           'class_kind', occurrence.kind::text, 'group_name', target_group.name, 'person_name', coach.display_name,
           'local_date', to_char(occurrence.local_date, 'YYYY-MM-DD'), 'zone', r.zone)
    from public.training_occurrences occurrence
    join public.training_participations participation on participation.occurrence_id = occurrence.id
    join recipients r on r.profile_id = participation.profile_id
    left join public.groups target_group on target_group.id = occurrence.group_id
    left join public.profiles coach on coach.id = occurrence.recorded_by
    cross join lateral (
      select greatest(
        occurrence.occurred_at + make_interval(mins => occurrence.default_duration_minutes + r.after_minutes),
        occurrence.created_at
      ) as moment
    ) due
   where occurrence.kind in ('group', 'personal_class')
     and occurrence.occurred_at > at_time - interval '2 days'
     and occurrence.occurred_at <= at_time
     and participation.profile_id <> occurrence.recorded_by
     and r.after_class
     and private.can_deliver_now(at_time, due.moment, r.zone, r.quiet_start, r.quiet_end)
     and not exists (
       select 1 from public.training_segment_assessments assessment
        where assessment.participation_id = participation.id and assessment.segment_key = 'r'
     )
     and not exists (
       select 1 from public.training_resources resource
        where resource.occurrence_id = occurrence.id and resource.kind = 'video'
     )
  union all
  -- Coach requests: a join request for a group they coach (the owner decides coach access)
  select r.profile_id, 'coach', 'join:' || request.id, request.created_at,
         jsonb_build_object(
           'url', '/app#/group/' || request.group_id, 'reason', 'join',
           'person_name', requester.display_name, 'group_name', target_group.name, 'zone', r.zone)
    from public.group_join_requests request
    join public.groups target_group on target_group.id = request.group_id and target_group.archived_at is null
    join public.profiles requester on requester.id = request.profile_id
    join lateral (
      select membership.profile_id as reviewer_id
        from public.group_memberships membership
       where request.requested_access = 'member'
         and membership.group_id = request.group_id
         and membership.state = 'active'
         and membership.access_level = 'coach'
      union
      select target_group.owner_id where request.requested_access = 'coach'
    ) reviewer on true
    join recipients r on r.profile_id = reviewer.reviewer_id
   where request.state = 'pending'
     and request.created_at > at_time - interval '2 days'
     and reviewer.reviewer_id <> request.profile_id
     and r.coach
     and private.can_deliver_now(at_time, request.created_at, r.zone, r.quiet_start, r.quiet_end)
  union all
  -- Coach requests: a student asking to be coached
  select r.profile_id, 'coach', 'coaching:' || connection.id, connection.created_at,
         jsonb_build_object(
           'url', '/app#/me/teaching', 'reason', 'coaching', 'person_name', student.display_name, 'zone', r.zone)
    from public.coach_student_connections connection
    join public.profiles student on student.id = connection.student_profile_id
    join recipients r on r.profile_id = connection.coach_profile_id
   where connection.state = 'pending'
     and connection.initiated_by = connection.student_profile_id
     and connection.created_at > at_time - interval '2 days'
     and r.coach
     and private.can_deliver_now(at_time, connection.created_at, r.zone, r.quiet_start, r.quiet_end)
  union all
  -- Coach requests: a class they arranged, ended 30 minutes ago and not finished
  select r.profile_id, 'coach', 'finish:' || schedule.id, finish.moment,
         jsonb_build_object(
           'url', '/app#/class/' || schedule.id, 'reason', 'finish', 'class_kind', schedule.kind::text,
           'group_name', target_group.name, 'person_name', student.display_name,
           'local_date', to_char(schedule.local_date, 'YYYY-MM-DD'), 'zone', r.zone)
    from public.scheduled_trainings schedule
    join recipients r on r.profile_id = schedule.arranged_by
    left join public.groups target_group on target_group.id = schedule.group_id
    left join public.profiles student on student.id = schedule.student_profile_id
    cross join lateral (
      select schedule.starts_at + make_interval(mins => schedule.expected_duration_minutes + 30) as moment
    ) finish
   where schedule.state = 'scheduled'
     and schedule.starts_at > at_time - interval '2 days'
     and schedule.starts_at < at_time
     and r.coach
     and not exists (select 1 from public.training_occurrences occurrence where occurrence.schedule_id = schedule.id)
     and private.can_manage_schedule(schedule.arranged_by, schedule.id)
     and private.can_deliver_now(at_time, finish.moment, r.zone, r.quiet_start, r.quiet_end)
  union all
  -- Finish setting up: up to three rounds, a week apart
  select r.profile_id, 'setup', 'setup:' || (sent.rounds + 1), due.moment,
         jsonb_build_object('url', '/app#/', 'round', sent.rounds + 1, 'zone', r.zone)
    from recipients r
    join public.profiles person on person.id = r.profile_id
    cross join lateral (
      select count(*)::integer as rounds, max(delivery.created_at) as last_at
        from public.notification_deliveries delivery
       where delivery.profile_id = r.profile_id and delivery.kind = 'setup'
    ) sent
    cross join lateral (
      select greatest(person.completed_at + interval '2 days', sent.last_at + interval '7 days') as moment
    ) due
   where r.setup
     and person.completed_at is not null
     and sent.rounds < 3
     and at_time >= due.moment
     and not private.in_quiet_hours(at_time, r.zone, r.quiet_start, r.quiet_end)
     and (
       person.place_city is null
       or not (
         exists (
           select 1 from public.group_memberships membership
             join public.groups member_group on member_group.id = membership.group_id
            where membership.profile_id = person.id and membership.state = 'active' and member_group.archived_at is null
         )
         or exists (
           select 1 from public.coach_student_connections connection
            where connection.state = 'active' and person.id in (connection.coach_profile_id, connection.student_profile_id)
         )
       )
       or not (
         exists (select 1 from public.training_participations participation where participation.profile_id = person.id)
         or exists (select 1 from public.training_occurrences occurrence where occurrence.recorded_by = person.id)
       )
     );
$$;

-- Ruling 9: retries first, then new work, never the same subject twice.
create function private.claim_due_notifications(at_time timestamptz, batch_limit integer)
returns table (delivery_id uuid, profile_id uuid, kind text, subject_key text, payload jsonb, devices jsonb)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  room integer := least(greatest(coalesce(batch_limit, 50), 1), 200);
  retried uuid[];
  created uuid[];
begin
  if at_time is null then
    raise exception using errcode = 'P0001', message = 'invalid_time';
  end if;

  update public.notification_deliveries delivery
     set status = 'failed'
   where delivery.status = 'pending'
     and delivery.attempts >= 3
     and delivery.claimed_at <= at_time - interval '15 minutes';

  with stale as (
    select delivery.id
      from public.notification_deliveries delivery
     where delivery.status = 'pending'
       and delivery.claimed_at <= at_time - interval '15 minutes'
     order by delivery.claimed_at, delivery.id
     limit room
     for update skip locked
  ), touched as (
    update public.notification_deliveries delivery
       set claimed_at = at_time, attempts = delivery.attempts + 1
      from stale
     where delivery.id = stale.id
    returning delivery.id
  )
  select coalesce(array_agg(touched.id), '{}'::uuid[]) into retried from touched;

  with fresh as (
    insert into public.notification_deliveries (profile_id, kind, subject_key, due_at, payload, claimed_at, created_at)
    select due.profile_id, due.kind, due.subject_key, due.due_at, due.payload, at_time, at_time
      from private.due_notifications(at_time) due
     where not exists (
       select 1 from public.notification_deliveries logged
        where logged.profile_id = due.profile_id and logged.kind = due.kind and logged.subject_key = due.subject_key
     )
     order by due.due_at, due.profile_id, due.kind, due.subject_key
     limit greatest(room - cardinality(retried), 0)
    on conflict on constraint notification_deliveries_subject_key do nothing
    returning id
  )
  select coalesce(array_agg(fresh.id), '{}'::uuid[]) into created from fresh;

  return query
  select delivery.id, delivery.profile_id, delivery.kind, delivery.subject_key, delivery.payload,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'subscription_id', device.id, 'endpoint', device.endpoint, 'p256dh', device.p256dh,
             'auth', device.auth, 'locale', device.locale
           ) order by device.created_at, device.id)
             from public.push_subscriptions device
            where device.profile_id = delivery.profile_id
         ), '[]'::jsonb)
    from public.notification_deliveries delivery
   where delivery.id = any(retried || created)
   order by delivery.due_at, delivery.id;
end;
$$;

create function public.claim_due_notifications(at_time timestamptz default now(), batch_limit integer default 50)
returns table (delivery_id uuid, profile_id uuid, kind text, subject_key text, payload jsonb, devices jsonb)
language sql
set search_path = ''
as $$ select * from private.claim_due_notifications(at_time, batch_limit); $$;

-- Ruling 5: only the sender (service role) may claim.
grant usage on schema private to service_role;
revoke execute on function private.in_quiet_hours(timestamptz, text, time, time) from public, anon, authenticated;
revoke execute on function private.after_quiet_hours(timestamptz, text, time, time) from public, anon, authenticated;
revoke execute on function private.can_deliver_now(timestamptz, timestamptz, text, time, time) from public, anon, authenticated;
revoke execute on function private.notification_recipients() from public, anon, authenticated;
revoke execute on function private.due_notifications(timestamptz) from public, anon, authenticated;
revoke execute on function private.claim_due_notifications(timestamptz, integer) from public, anon, authenticated;
grant execute on function private.claim_due_notifications(timestamptz, integer) to service_role;
revoke execute on function public.claim_due_notifications(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_due_notifications(timestamptz, integer) to service_role;
```

- [ ] **Step 4: Apply and run the test to verify it passes**

Run: `npx supabase migration up --local && npx supabase test db supabase/tests/0047_notification_due.test.sql`
Expected: PASS. If one `results_eq` fails, its message names the rule; compare the payload with the Interfaces block above before you change a test.

- [ ] **Step 5: Run the database suite**

Run: `npm run test:db`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/202611010002_notification_claims.sql supabase/tests/0047_notification_due.test.sql
git commit -m "feat: work out which notifications are due

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Results, retries, and dead devices

**Files:**
- Create: `supabase/migrations/202611010003_notification_results.sql`, `supabase/tests/0048_notification_results.test.sql`

**Interfaces:**
- Consumes (Task 3): `public.claim_due_notifications`.
- Produces: `public.report_notification_results(results jsonb) → { status: 'reported', removed_devices: integer }`, executable by `service_role` only. `results` is `[{ delivery_id, outcomes: [{ subscription_id, status: 'sent'|'gone'|'failed' }] }]`. Anything other than a JSON array raises `P0001 invalid_results`.

- [ ] **Step 1: Write the failing database test**

```sql
-- supabase/tests/0048_notification_results.test.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
\set RODA_HELPERS_INCLUDED true
\ir 0000_test_helpers.sql
\unset RODA_HELPERS_INCLUDED
select no_plan();

select has_function('public', 'report_notification_results', array['jsonb'], 'the sender reports what happened');

select tests.create_user('10000000-0000-0000-0000-000000004801', 'ana48@example.test', 'Ana Quarenta Oito');
select tests.create_user('10000000-0000-0000-0000-000000004802', 'bia48@example.test', 'Bia Quarenta Oito');
select tests.create_user('10000000-0000-0000-0000-000000004803', 'caio48@example.test', 'Caio Quarenta Oito');
select tests.create_user('10000000-0000-0000-0000-000000004804', 'dani48@example.test', 'Dani Quarenta Oito');
select tests.create_user('10000000-0000-0000-0000-000000004805', 'eve48@example.test', 'Eve Quarenta Oito');
select tests.create_user('10000000-0000-0000-0000-000000004806', 'fabio48@example.test', 'Fabio Quarenta Oito');
-- Nobody has a city yet, so "Finish setting up" is due two days after sign-up.
update public.profiles set timezone_override = 'Europe/Lisbon', completed_at = '2030-03-01T10:00:00Z'
 where id in ('10000000-0000-0000-0000-000000004801', '10000000-0000-0000-0000-000000004802',
              '10000000-0000-0000-0000-000000004803', '10000000-0000-0000-0000-000000004804');
update public.profiles set timezone_override = 'Europe/Lisbon', completed_at = '2030-02-01T10:00:00Z'
 where id in ('10000000-0000-0000-0000-000000004805', '10000000-0000-0000-0000-000000004806');
insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth, locale, failures) values
  ('10000000-0000-0000-0000-000000004801', 'https://fcm.googleapis.com/fcm/send/ana48-phone', repeat('B', 87), repeat('a', 22), 'en', 3),
  ('10000000-0000-0000-0000-000000004801', 'https://updates.push.services.mozilla.com/wpush/v2/ana48-laptop', repeat('B', 87), repeat('a', 22), 'en', 0),
  ('10000000-0000-0000-0000-000000004802', 'https://fcm.googleapis.com/fcm/send/bia48', repeat('B', 87), repeat('a', 22), 'en', 0),
  ('10000000-0000-0000-0000-000000004803', 'https://fcm.googleapis.com/fcm/send/caio48', repeat('B', 87), repeat('a', 22), 'en', 0),
  ('10000000-0000-0000-0000-000000004804', 'https://fcm.googleapis.com/fcm/send/dani48', repeat('B', 87), repeat('a', 22), 'en', 9),
  ('10000000-0000-0000-0000-000000004805', 'https://fcm.googleapis.com/fcm/send/eve48', repeat('B', 87), repeat('a', 22), 'en', 0),
  ('10000000-0000-0000-0000-000000004806', 'https://fcm.googleapis.com/fcm/send/fabio48', repeat('B', 87), repeat('a', 22), 'en', 0);

-- Batches (Eve and Fábio)
create temp table batch1 as select * from public.claim_due_notifications('2030-02-03T10:00:30Z', 1);
select is((select count(*)::integer from batch1), 1, 'a run never claims more than its batch');
create temp table batch2 as select * from public.claim_due_notifications('2030-02-03T10:01:30Z', 1);
select is((select count(*)::integer from batch2 where profile_id not in (select profile_id from batch1)), 1,
  'the rest go in the next run');
create temp table batch3 as select * from public.claim_due_notifications('2030-02-03T10:02:30Z', 50);
select is((select count(*)::integer from batch3), 0, 'and nothing is claimed twice by overlapping runs');
update public.notification_deliveries set status = 'sent', sent_at = claimed_at
 where profile_id in ('10000000-0000-0000-0000-000000004805', '10000000-0000-0000-0000-000000004806');
delete from public.push_subscriptions
 where profile_id in ('10000000-0000-0000-0000-000000004805', '10000000-0000-0000-0000-000000004806');

-- One run, four outcomes
create temp table claimed as select * from public.claim_due_notifications('2030-03-03T10:00:30Z', 50);
select is((select count(*)::integer from claimed), 4, 'four people are due');
select is((select jsonb_array_length(devices) from claimed where profile_id = '10000000-0000-0000-0000-000000004801'), 2,
  'Ana''s delivery lists both her devices');
select jsonb_build_array(
  jsonb_build_object('delivery_id', (select delivery_id from claimed where profile_id = '10000000-0000-0000-0000-000000004801'),
    'outcomes', jsonb_build_array(
      jsonb_build_object('subscription_id', (select id from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/ana48-phone'), 'status', 'sent'),
      jsonb_build_object('subscription_id', (select id from public.push_subscriptions where endpoint = 'https://updates.push.services.mozilla.com/wpush/v2/ana48-laptop'), 'status', 'gone'))),
  jsonb_build_object('delivery_id', (select delivery_id from claimed where profile_id = '10000000-0000-0000-0000-000000004802'),
    'outcomes', jsonb_build_array(
      jsonb_build_object('subscription_id', (select id from public.push_subscriptions where profile_id = '10000000-0000-0000-0000-000000004802'), 'status', 'failed'))),
  jsonb_build_object('delivery_id', (select delivery_id from claimed where profile_id = '10000000-0000-0000-0000-000000004803'),
    'outcomes', jsonb_build_array(
      jsonb_build_object('subscription_id', (select id from public.push_subscriptions where profile_id = '10000000-0000-0000-0000-000000004803'), 'status', 'gone'))),
  jsonb_build_object('delivery_id', (select delivery_id from claimed where profile_id = '10000000-0000-0000-0000-000000004804'),
    'outcomes', jsonb_build_array(
      jsonb_build_object('subscription_id', (select id from public.push_subscriptions where profile_id = '10000000-0000-0000-0000-000000004804'), 'status', 'failed')))
)::text as report_one \gset
select tests.set_actor(null, 'service_role');
select is(public.report_notification_results(:'report_one'::jsonb) ->> 'removed_devices', '3',
  'the sender reports results; the laptop, Caio''s device, and Dani''s tenth failure are removed');
reset role;
select results_eq(
  $$ select profile_id::text, status, sent_at is not null from public.notification_deliveries
      where profile_id in ('10000000-0000-0000-0000-000000004801', '10000000-0000-0000-0000-000000004802',
                           '10000000-0000-0000-0000-000000004803', '10000000-0000-0000-0000-000000004804')
      order by 1 $$,
  $$ values ('10000000-0000-0000-0000-000000004801', 'sent', true), ('10000000-0000-0000-0000-000000004802', 'pending', false),
            ('10000000-0000-0000-0000-000000004803', 'failed', false), ('10000000-0000-0000-0000-000000004804', 'pending', false) $$,
  'sent when one device took it, retried after a passing failure, failed when no device is left');
select results_eq(
  $$ select endpoint, failures, last_sent_at is not null from public.push_subscriptions order by 1 $$,
  $$ values ('https://fcm.googleapis.com/fcm/send/ana48-phone', 0, true), ('https://fcm.googleapis.com/fcm/send/bia48', 1, false) $$,
  'a success resets the failure count; 404, 410, and ten failures in a row remove the device');

-- Retries
create temp table retry1 as select * from public.claim_due_notifications('2030-03-03T10:10:00Z', 50);
select is((select count(*)::integer from retry1), 0, 'nothing is retried before 15 minutes');
create temp table retry2 as select * from public.claim_due_notifications('2030-03-03T10:16:00Z', 50);
select results_eq($$ select profile_id::text, jsonb_array_length(devices) from retry2 order by 1 $$,
  $$ values ('10000000-0000-0000-0000-000000004802', 1), ('10000000-0000-0000-0000-000000004804', 0) $$,
  'after 15 minutes a pending delivery is claimed again, with the devices still on the account');
select is((select attempts from public.notification_deliveries where profile_id = '10000000-0000-0000-0000-000000004802'), 2,
  'the second try is counted');
select jsonb_build_array(
  jsonb_build_object('delivery_id', (select delivery_id from retry2 where profile_id = '10000000-0000-0000-0000-000000004802'),
    'outcomes', jsonb_build_array(jsonb_build_object('subscription_id',
      (select id from public.push_subscriptions where profile_id = '10000000-0000-0000-0000-000000004802'), 'status', 'failed'))),
  jsonb_build_object('delivery_id', (select delivery_id from retry2 where profile_id = '10000000-0000-0000-0000-000000004804'),
    'outcomes', '[]'::jsonb),
  -- A late report about a delivery that was already sent changes nothing.
  jsonb_build_object('delivery_id', (select delivery_id from claimed where profile_id = '10000000-0000-0000-0000-000000004801'),
    'outcomes', '[]'::jsonb)
)::text as report_two \gset
select public.report_notification_results(:'report_two'::jsonb);
select results_eq(
  $$ select profile_id::text, status from public.notification_deliveries
      where profile_id in ('10000000-0000-0000-0000-000000004801', '10000000-0000-0000-0000-000000004804') order by 1 $$,
  $$ values ('10000000-0000-0000-0000-000000004801', 'sent'), ('10000000-0000-0000-0000-000000004804', 'failed') $$,
  'a delivery with no device left is given up, and a sent one stays sent');
create temp table retry3 as select * from public.claim_due_notifications('2030-03-03T10:32:00Z', 50);
select is((select attempts from public.notification_deliveries where profile_id = '10000000-0000-0000-0000-000000004802'), 3,
  'the third try is the last');
select jsonb_build_array(
  jsonb_build_object('delivery_id', (select delivery_id from retry3 where profile_id = '10000000-0000-0000-0000-000000004802'),
    'outcomes', jsonb_build_array(jsonb_build_object('subscription_id',
      (select id from public.push_subscriptions where profile_id = '10000000-0000-0000-0000-000000004802'), 'status', 'failed')))
)::text as report_three \gset
select public.report_notification_results(:'report_three'::jsonb);
create temp table retry4 as select * from public.claim_due_notifications('2030-03-03T10:48:00Z', 50);
select is((select count(*)::integer from retry4), 0, 'after three tries nothing is claimed again');
select is((select status from public.notification_deliveries where profile_id = '10000000-0000-0000-0000-000000004802'), 'failed',
  'and the delivery is given up');

select throws_ok($$ select public.report_notification_results('{}'::jsonb) $$, 'P0001', 'invalid_results', 'results must be a list');

-- Only the sender may report.
select tests.set_actor('10000000-0000-0000-0000-000000004801');
select throws_ok($$ select public.report_notification_results('[]'::jsonb) $$, '42501', null, 'a signed-in person cannot report results');
reset role;
select tests.set_actor(null, 'anon');
select throws_ok($$ select public.report_notification_results('[]'::jsonb) $$, '42501', null, 'nor can a visitor');

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx supabase test db supabase/tests/0048_notification_results.test.sql`
Expected: FAIL: `has_function` fails for `report_notification_results`, and the script stops at the first report call.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/202611010003_notification_results.sql
-- Phone notifications, part 3: what the sender reports back (Ruling 10).

create function private.report_notification_results(at_time timestamptz, results jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  outcome record;
  removed integer := 0;
  changed integer;
begin
  if jsonb_typeof(results) is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'invalid_results';
  end if;

  for outcome in
    select (item ->> 'subscription_id')::uuid as subscription_id, item ->> 'status' as status
      from jsonb_array_elements(results) delivery_result
      cross join lateral jsonb_array_elements(coalesce(delivery_result -> 'outcomes', '[]'::jsonb)) item
  loop
    if outcome.status = 'sent' then
      update public.push_subscriptions device
         set last_sent_at = at_time, failures = 0
       where device.id = outcome.subscription_id;
    elsif outcome.status = 'gone' then
      delete from public.push_subscriptions device where device.id = outcome.subscription_id;
      get diagnostics changed = row_count;
      removed := removed + changed;
    elsif outcome.status = 'failed' then
      update public.push_subscriptions device
         set failures = device.failures + 1
       where device.id = outcome.subscription_id;
      delete from public.push_subscriptions device
       where device.id = outcome.subscription_id and device.failures >= 10;
      get diagnostics changed = row_count;
      removed := removed + changed;
    end if;
  end loop;

  update public.notification_deliveries delivery
     set status = case when summary.any_sent then 'sent' when summary.any_failed then 'pending' else 'failed' end,
         sent_at = case when summary.any_sent then at_time end
    from (
      select (delivery_result ->> 'delivery_id')::uuid as id,
             coalesce(bool_or(item ->> 'status' = 'sent'), false) as any_sent,
             coalesce(bool_or(item ->> 'status' = 'failed'), false) as any_failed
        from jsonb_array_elements(results) delivery_result
        left join lateral jsonb_array_elements(coalesce(delivery_result -> 'outcomes', '[]'::jsonb)) item on true
       group by 1
    ) summary
   where delivery.id = summary.id
     and delivery.status = 'pending';

  return jsonb_build_object('status', 'reported', 'removed_devices', removed);
end;
$$;

create function public.report_notification_results(results jsonb)
returns jsonb
language sql
set search_path = ''
as $$ select private.report_notification_results(now(), results); $$;

revoke execute on function private.report_notification_results(timestamptz, jsonb) from public, anon, authenticated;
grant execute on function private.report_notification_results(timestamptz, jsonb) to service_role;
revoke execute on function public.report_notification_results(jsonb) from public, anon, authenticated;
grant execute on function public.report_notification_results(jsonb) to service_role;
```

- [ ] **Step 4: Apply and run the test to verify it passes**

Run: `npx supabase migration up --local && npx supabase test db supabase/tests/0048_notification_results.test.sql`
Expected: PASS.

- [ ] **Step 5: Run the database suite**

Run: `npm run test:db`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/202611010003_notification_results.sql supabase/tests/0048_notification_results.test.sql
git commit -m "feat: record notification results and drop dead devices

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The words of each notification

**Files:**
- Create: `supabase/functions/send-notifications/copy.js`
- Test: `tests/unit/notification-copy.test.js`

**Interfaces:**
- Consumes (Task 3): the payload fields listed in Task 3's Interfaces.
- Produces: `formatNotification(kind: string, payload: object, { locale?: 'en'|'pt', now?: Date }) → { url, title, body }`. An unknown locale is treated as `en`, and an unknown kind throws `Error('unknown notification: <kind>')`. Also produces `timeText(iso, zone, locale) → string` and `dayWord(localDate, zone, now) → 'today'|'yesterday'|'other'`.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/notification-copy.test.js
import { describe, expect, it } from 'vitest';

import { dayWord, formatNotification, timeText } from '../../supabase/functions/send-notifications/copy.js';

const BEFORE = {
  url: '/app#/calendar/2030-01-15', role: 'student', class_kind: 'group', group_name: 'Grupo Lua', person_name: 'Mestre Lua',
  starts_at: '2030-01-15T19:00:00+00:00', lead_minutes: 60, zone: 'Europe/Lisbon',
};
const AFTER = { url: '/app#/training/o1', class_kind: 'group', local_date: '2030-01-15', zone: 'Europe/Lisbon' };
const FINISH = {
  url: '/app#/class/s1', reason: 'finish', class_kind: 'group', group_name: 'Grupo Lua', local_date: '2030-01-15', zone: 'Europe/Lisbon',
};
const EVENING = new Date('2030-01-15T21:30:30Z');
const NEXT_MORNING = new Date('2030-01-16T08:00:30Z');

describe('notification copy', () => {
  it('writes Finish setting up in both languages', () => {
    expect(formatNotification('setup', { url: '/app#/', round: 1 })).toEqual({
      url: '/app#/', title: 'Finish setting up roda', body: 'Add your city and your group so classes find you.',
    });
    expect(formatNotification('setup', { url: '/app#/' }, { locale: 'pt' })).toMatchObject({
      title: 'Termina a configuração da roda', body: 'Adiciona a tua cidade e o teu grupo para as aulas te encontrarem.',
    });
  });

  it('names the class and its time in the person\'s zone', () => {
    expect(formatNotification('before_class', BEFORE)).toEqual({
      url: '/app#/calendar/2030-01-15', title: 'Class in 1 hour', body: 'Group class · Grupo Lua at 7:00 PM',
    });
    expect(formatNotification('before_class', BEFORE, { locale: 'pt' })).toMatchObject({
      title: 'Aula daqui a 1 hora', body: 'Aula de grupo · Grupo Lua às 19:00',
    });
    expect(formatNotification('before_class', { ...BEFORE, zone: 'America/New_York' }).body).toBe('Group class · Grupo Lua at 2:00 PM');
    expect(formatNotification('before_class', { ...BEFORE, lead_minutes: 15 }).title).toBe('Class in 15 minutes');
    expect(formatNotification('before_class', { ...BEFORE, lead_minutes: 120 }, { locale: 'pt' }).title).toBe('Aula daqui a 2 horas');
    expect(formatNotification('before_class', { ...BEFORE, class_kind: 'personal_class', group_name: null, person_name: 'Bia Santos' }).body)
      .toBe('Personal class · Bia Santos at 7:00 PM');
  });

  it('asks about today\'s class, or yesterday\'s when quiet hours held it overnight', () => {
    expect(formatNotification('after_class', AFTER, { now: EVENING })).toEqual({
      url: '/app#/training/o1', title: "How did today's class go?", body: "Rate it and add the video while it's fresh.",
    });
    expect(formatNotification('after_class', AFTER, { now: NEXT_MORNING }).title).toBe("How did yesterday's class go?");
    expect(formatNotification('after_class', AFTER, { now: new Date('2030-01-20T10:00:00Z') }).title).toBe('How did your class go?');
    expect(formatNotification('after_class', AFTER, { locale: 'pt', now: NEXT_MORNING })).toMatchObject({
      title: 'Como correu a aula de ontem?', body: 'Avalia-a e adiciona o vídeo enquanto está fresca.',
    });
  });

  it('writes the three coach requests', () => {
    const join = { url: '/app#/group/g1', reason: 'join', person_name: 'Bia Santos', group_name: 'Grupo Lua' };
    expect(formatNotification('coach', join)).toEqual({
      url: '/app#/group/g1', title: 'New join request', body: 'Bia Santos wants to join Grupo Lua.',
    });
    expect(formatNotification('coach', join, { locale: 'pt' })).toMatchObject({
      title: 'Novo pedido de entrada', body: 'Bia Santos quer entrar em Grupo Lua.',
    });
    expect(formatNotification('coach', { url: '/app#/me/teaching', reason: 'coaching', person_name: 'Bia Santos' })).toMatchObject({
      title: 'New coaching request', body: 'Bia Santos asked you to coach them.',
    });
    expect(formatNotification('coach', FINISH, { now: EVENING })).toMatchObject({
      title: "Finish today's class", body: 'Mark who came to Group class · Grupo Lua.',
    });
    expect(formatNotification('coach', FINISH, { locale: 'pt', now: EVENING })).toMatchObject({
      title: 'Termina a aula de hoje', body: 'Marca quem veio: Aula de grupo · Grupo Lua.',
    });
  });

  it('falls back to English, UTC, and plain words when something is missing', () => {
    expect(formatNotification('setup', {}, { locale: 'fr' }).title).toBe('Finish setting up roda');
    expect(formatNotification('setup', {}).url).toBe('/app');
    expect(timeText('2030-01-15T19:00:00Z', 'Not/AZone', 'en')).toBe('7:00 PM');
    expect(formatNotification('coach', { reason: 'join' }).body).toBe('Someone wants to join your group.');
    expect(() => formatNotification('weather', {})).toThrow('unknown notification: weather');
  });

  it('tells today from yesterday in the person\'s zone', () => {
    // 01:00 on the 16th in UTC is still the evening of the 15th in New York.
    expect(dayWord('2030-01-15', 'America/New_York', new Date('2030-01-16T01:00:00Z'))).toBe('today');
    expect(dayWord('2030-01-15', 'Europe/Lisbon', new Date('2030-01-16T01:00:00Z'))).toBe('yesterday');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/notification-copy.test.js`
Expected: FAIL: `Failed to load url ../../supabase/functions/send-notifications/copy.js`.

- [ ] **Step 3: Implement**

```js
// supabase/functions/send-notifications/copy.js
// The words of each notification, in the device's language (Ruling 11). The
// database sends structured fields; this file turns them into text. It is plain
// JavaScript with no imports, so the Edge Function (Deno) and Vitest share it.

const LEADS = Object.freeze({
  en: Object.freeze({ 15: '15 minutes', 30: '30 minutes', 60: '1 hour', 120: '2 hours' }),
  pt: Object.freeze({ 15: '15 minutos', 30: '30 minutos', 60: '1 hora', 120: '2 horas' }),
});

const TEXT = Object.freeze({
  en: Object.freeze({
    setupTitle: 'Finish setting up roda',
    setupBody: 'Add your city and your group so classes find you.',
    beforeTitle: (lead) => `Class in ${lead}`,
    beforeBody: (label, time) => `${label} at ${time}`,
    afterTitle: { today: "How did today's class go?", yesterday: "How did yesterday's class go?", other: 'How did your class go?' },
    afterBody: "Rate it and add the video while it's fresh.",
    joinTitle: 'New join request',
    joinBody: (person, group) => `${person} wants to join ${group}.`,
    coachingTitle: 'New coaching request',
    coachingBody: (person) => `${person} asked you to coach them.`,
    finishTitle: { today: "Finish today's class", yesterday: "Finish yesterday's class", other: 'Finish your class' },
    finishBody: (label) => `Mark who came to ${label}.`,
    groupClass: 'Group class',
    personalClass: 'Personal class',
    someone: 'Someone',
    yourGroup: 'your group',
    minutes: (count) => `${count} minutes`,
  }),
  pt: Object.freeze({
    setupTitle: 'Termina a configuração da roda',
    setupBody: 'Adiciona a tua cidade e o teu grupo para as aulas te encontrarem.',
    beforeTitle: (lead) => `Aula daqui a ${lead}`,
    beforeBody: (label, time) => `${label} às ${time}`,
    afterTitle: { today: 'Como correu a aula de hoje?', yesterday: 'Como correu a aula de ontem?', other: 'Como correu a aula?' },
    afterBody: 'Avalia-a e adiciona o vídeo enquanto está fresca.',
    joinTitle: 'Novo pedido de entrada',
    joinBody: (person, group) => `${person} quer entrar em ${group}.`,
    coachingTitle: 'Novo pedido de treino',
    coachingBody: (person) => `${person} pediu-te para ser treinador.`,
    finishTitle: { today: 'Termina a aula de hoje', yesterday: 'Termina a aula de ontem', other: 'Termina a tua aula' },
    finishBody: (label) => `Marca quem veio: ${label}.`,
    groupClass: 'Aula de grupo',
    personalClass: 'Aula pessoal',
    someone: 'Alguém',
    yourGroup: 'o teu grupo',
    minutes: (count) => `${count} minutos`,
  }),
});

function language(locale) {
  return locale === 'pt' ? 'pt' : 'en';
}

function zoneOf(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone || 'UTC' });
    return zone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function timeText(iso, zone, locale) {
  const pt = language(locale) === 'pt';
  const options = pt
    ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zoneOf(zone) }
    : { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: zoneOf(zone) };
  // Newer ICU puts a narrow no-break space before AM/PM; keep plain text.
  return new Intl.DateTimeFormat(pt ? 'pt-PT' : 'en-US', options).format(new Date(iso)).replace(/ /g, ' ');
}

export function dayWord(localDate, zone, now) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: zoneOf(zone), year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  if (localDate === today) return 'today';
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return localDate === yesterday.toISOString().slice(0, 10) ? 'yesterday' : 'other';
}

function classLabel(text, payload) {
  if (payload.class_kind === 'personal_class') {
    return payload.person_name ? `${text.personalClass} · ${payload.person_name}` : text.personalClass;
  }
  return payload.group_name ? `${text.groupClass} · ${payload.group_name}` : text.groupClass;
}

export function formatNotification(kind, payload = {}, { locale = 'en', now = new Date() } = {}) {
  const lang = language(locale);
  const text = TEXT[lang];
  const base = { url: payload.url || '/app' };
  if (kind === 'setup') return { ...base, title: text.setupTitle, body: text.setupBody };
  if (kind === 'before_class') {
    const lead = LEADS[lang][payload.lead_minutes] ?? text.minutes(payload.lead_minutes ?? 60);
    return {
      ...base,
      title: text.beforeTitle(lead),
      body: text.beforeBody(classLabel(text, payload), timeText(payload.starts_at, payload.zone, lang)),
    };
  }
  if (kind === 'after_class') {
    return { ...base, title: text.afterTitle[dayWord(payload.local_date, payload.zone, now)], body: text.afterBody };
  }
  if (kind === 'coach') {
    const person = payload.person_name || text.someone;
    if (payload.reason === 'join') {
      return { ...base, title: text.joinTitle, body: text.joinBody(person, payload.group_name || text.yourGroup) };
    }
    if (payload.reason === 'coaching') return { ...base, title: text.coachingTitle, body: text.coachingBody(person) };
    if (payload.reason === 'finish') {
      return {
        ...base,
        title: text.finishTitle[dayWord(payload.local_date, payload.zone, now)],
        body: text.finishBody(classLabel(text, payload)),
      };
    }
  }
  throw new Error(`unknown notification: ${kind}`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/notification-copy.test.js`
Expected: PASS.

- [ ] **Step 5: Run the unit suite**

Run: `npm run test:unit`
Expected: PASS (`dead-code.test.js` scans only `src/`).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/send-notifications/copy.js tests/unit/notification-copy.test.js
git commit -m "feat: write notification text in English and Portuguese

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The `send-notifications` Edge Function

**Files:**
- Create: `supabase/functions/send-notifications/run.js`, `supabase/functions/send-notifications/vapid.js`, `supabase/functions/send-notifications/index.ts`
- Modify: `supabase/config.toml`
- Test: `tests/unit/send-notifications.test.js`

**Interfaces:**
- Consumes (Task 3): `claim_due_notifications` rows. Consumes (Task 4): `report_notification_results(results)`. Consumes (Task 5): `formatNotification`.
- Produces (`run.js`):
  - `runSender({ rpc, push, now?, batchLimit = 50 }) → Promise<{ deliveries, sent, gone, failed }>`. Here `rpc(name, params) → Promise<{ data, error }>`, and `push(device, text, { ttl })` resolves, or rejects with an error that has `status`.
  - `handleRequest(request, { cronSecret, run, log? }) → Promise<Response>`.
  - `sameSecret(given, expected) → boolean`, `isPushEndpoint(url) → boolean`, `ttlFor(kind, payload, now) → seconds`.
- Produces (`vapid.js`): `vapidJwks(publicKeyBase64Url, privateKeyBase64Url) → { publicKey: JsonWebKey, privateKey: JsonWebKey }`.
- Produces (deployed later by the owner): `POST /functions/v1/send-notifications` with header `x-roda-cron-secret`. It reads these function secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NOTIFICATIONS_CRON_SECRET`.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/send-notifications.test.js
import { describe, expect, it, vi } from 'vitest';

import {
  handleRequest, isPushEndpoint, runSender, sameSecret, ttlFor,
} from '../../supabase/functions/send-notifications/run.js';
import { vapidJwks } from '../../supabase/functions/send-notifications/vapid.js';

const NOW = new Date('2030-01-15T18:00:30Z');
const device = (id, endpoint, locale = 'en') => ({ subscription_id: id, endpoint, p256dh: 'P'.repeat(87), auth: 'A'.repeat(22), locale });

function fakeRpc(deliveries) {
  const calls = [];
  const rpc = vi.fn(async (name, params) => {
    calls.push([name, params]);
    return name === 'claim_due_notifications' ? { data: deliveries, error: null } : { data: { status: 'reported' }, error: null };
  });
  return { rpc, calls };
}

describe('sender', () => {
  it('sends each delivery to every device in its language and reports what happened', async () => {
    const { rpc, calls } = fakeRpc([
      {
        delivery_id: 'd1', profile_id: 'p1', kind: 'before_class', subject_key: 'class:s1:1',
        payload: { url: '/app#/class/s1', role: 'coach', class_kind: 'group', group_name: 'Grupo Lua', starts_at: '2030-01-15T19:00:00Z', lead_minutes: 60, zone: 'Europe/Lisbon' },
        devices: [device('phone', 'https://fcm.googleapis.com/fcm/send/a', 'pt'), device('laptop', 'https://updates.push.services.mozilla.com/wpush/v2/b')],
      },
      {
        delivery_id: 'd2', profile_id: 'p2', kind: 'coach', subject_key: 'join:r1',
        payload: { url: '/app#/group/g1', reason: 'join', person_name: 'Bia', group_name: 'Grupo Lua' },
        devices: [device('odd', 'https://attacker.example/push'), device('busy', 'https://web.push.apple.com/c')],
      },
    ]);
    const push = vi.fn(async (target) => {
      if (target.subscription_id === 'laptop') throw Object.assign(new Error('gone'), { status: 410 });
      if (target.subscription_id === 'busy') throw Object.assign(new Error('busy'), { status: 503 });
    });
    const totals = await runSender({ rpc, push, now: () => NOW });
    expect(calls[0]).toEqual(['claim_due_notifications', { batch_limit: 50 }]);
    // Never to an address outside the known push services.
    expect(push.mock.calls.map(([target]) => target.subscription_id)).toEqual(['phone', 'laptop', 'busy']);
    const [, text, options] = push.mock.calls[0];
    expect(JSON.parse(text)).toEqual({ url: '/app#/class/s1', title: 'Aula daqui a 1 hora', body: 'Aula de grupo · Grupo Lua às 19:00', tag: 'd1' });
    expect(options).toEqual({ ttl: 3570 });
    expect(calls[1]).toEqual(['report_notification_results', { results: [
      { delivery_id: 'd1', outcomes: [{ subscription_id: 'phone', status: 'sent' }, { subscription_id: 'laptop', status: 'gone' }] },
      { delivery_id: 'd2', outcomes: [{ subscription_id: 'odd', status: 'gone' }, { subscription_id: 'busy', status: 'failed' }] },
    ] }]);
    expect(totals).toEqual({ deliveries: 2, sent: 1, gone: 2, failed: 1 });
  });

  it('reports a delivery with no device left, so it is given up', async () => {
    const { rpc, calls } = fakeRpc([{ delivery_id: 'd3', profile_id: 'p3', kind: 'setup', subject_key: 'setup:1', payload: {}, devices: [] }]);
    await runSender({ rpc, push: vi.fn(), now: () => NOW });
    expect(calls[1]).toEqual(['report_notification_results', { results: [{ delivery_id: 'd3', outcomes: [] }] }]);
  });

  it('counts a notification it cannot word as a passing failure', async () => {
    const { rpc, calls } = fakeRpc([{
      delivery_id: 'd4', profile_id: 'p4', kind: 'weather', subject_key: 'x', payload: {},
      devices: [device('phone', 'https://fcm.googleapis.com/fcm/send/a')],
    }]);
    const push = vi.fn();
    await runSender({ rpc, push, now: () => NOW });
    expect(push).not.toHaveBeenCalled();
    expect(calls[1][1].results[0].outcomes).toEqual([{ subscription_id: 'phone', status: 'failed' }]);
  });

  it('stops after claiming when nothing is due', async () => {
    const { rpc, calls } = fakeRpc([]);
    expect(await runSender({ rpc, push: vi.fn(), now: () => NOW })).toEqual({ deliveries: 0, sent: 0, gone: 0, failed: 0 });
    expect(calls).toHaveLength(1);
  });

  it('fails loudly when the database refuses', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'permission denied' } }));
    await expect(runSender({ rpc, push: vi.fn(), now: () => NOW })).rejects.toThrow('claim failed: permission denied');
  });

  it('keeps a class reminder only until the class starts', () => {
    expect(ttlFor('before_class', { starts_at: '2030-01-15T18:00:40Z' }, NOW)).toBe(60);
    expect(ttlFor('before_class', { starts_at: '2030-01-15T19:00:30Z' }, NOW)).toBe(3600);
    expect(ttlFor('setup', {}, NOW)).toBe(43200);
  });

  it('knows the push services', () => {
    for (const url of ['https://fcm.googleapis.com/fcm/send/a', 'https://updates.push.services.mozilla.com/wpush/v2/a',
      'https://web.push.apple.com/a', 'https://wns2-par02p.notify.windows.com/w/?token=a']) {
      expect(isPushEndpoint(url)).toBe(true);
    }
    for (const url of ['http://fcm.googleapis.com/fcm/send/a', 'https://fcm.googleapis.com.attacker.example/a', 'https://localhost/a', null]) {
      expect(isPushEndpoint(url)).toBe(false);
    }
  });
});

describe('sender request', () => {
  const run = vi.fn(async () => ({ deliveries: 0 }));
  const call = (init, cronSecret = 's3cret-value') => handleRequest(
    new Request('https://project.supabase.co/functions/v1/send-notifications', init), { cronSecret, run, log: () => {} },
  );

  it('accepts only POST with the cron secret', async () => {
    expect((await call({ method: 'GET' })).status).toBe(405);
    expect((await call({ method: 'POST' })).status).toBe(401);
    expect((await call({ method: 'POST', headers: { 'x-roda-cron-secret': 's3cret-valuf' } })).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
    const ok = await call({ method: 'POST', headers: { 'x-roda-cron-secret': 's3cret-value' } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ deliveries: 0 });
  });

  it('refuses everything when no secret is configured', async () => {
    expect((await call({ method: 'POST', headers: { 'x-roda-cron-secret': '' } }, '')).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('answers 500 without details when a run fails', async () => {
    const log = vi.fn();
    const response = await handleRequest(
      new Request('https://project.supabase.co/functions/v1/send-notifications', { method: 'POST', headers: { 'x-roda-cron-secret': 'k' } }),
      { cronSecret: 'k', run: async () => { throw new Error('claim failed: boom'); }, log },
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'send_failed' });
    expect(log).toHaveBeenCalledWith('send-notifications failed: claim failed: boom');
  });

  it('compares secrets in full', () => {
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('ab', 'abc')).toBe(false);
    expect(sameSecret('abcd', 'abc')).toBe(false);
    expect(sameSecret(null, 'abc')).toBe(false);
    expect(sameSecret('', '')).toBe(false);
  });
});

describe('VAPID keys', () => {
  it('turns the base64url pair into keys WebCrypto signs and verifies with', async () => {
    const { subtle } = globalThis.crypto;
    const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const publicKey = Buffer.from(await subtle.exportKey('raw', pair.publicKey)).toString('base64url');
    const exported = await subtle.exportKey('jwk', pair.privateKey);
    const jwks = vapidJwks(publicKey, exported.d);
    expect(jwks.publicKey).toMatchObject({ kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y });
    const algorithm = { name: 'ECDSA', namedCurve: 'P-256' };
    const signer = await subtle.importKey('jwk', jwks.privateKey, algorithm, false, ['sign']);
    const verifier = await subtle.importKey('jwk', jwks.publicKey, algorithm, false, ['verify']);
    const data = new TextEncoder().encode('roda');
    const signature = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signer, data);
    expect(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, signature, data)).toBe(true);
  });

  it('refuses keys of the wrong shape', () => {
    expect(() => vapidJwks('abcd', 'abcd')).toThrow('VAPID keys must be a base64url P-256 key pair');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/send-notifications.test.js`
Expected: FAIL: `Failed to load url ../../supabase/functions/send-notifications/run.js`.

- [ ] **Step 3: Implement the sender logic**

```js
// supabase/functions/send-notifications/run.js
// The sender's logic, free of Deno and of any library (Ruling 19): check the
// cron secret, claim what is due, send it to each device, report back.
import { formatNotification } from './copy.js';

export const BATCH_LIMIT = 50;
const PUSH_SERVICES = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)\/\S+$/;

// Ruling 12: the sender only ever talks to known push services.
export function isPushEndpoint(endpoint) {
  return typeof endpoint === 'string' && endpoint.length <= 2048 && PUSH_SERVICES.test(endpoint);
}

// Ruling 3: compared in full, whatever the lengths, so timing reveals nothing.
export function sameSecret(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let index = 0; index < b.length; index += 1) difference |= (a[index] ?? 0) ^ b[index];
  return difference === 0;
}

// A reminder for a class is useless once the class has started.
export function ttlFor(kind, payload, now) {
  if (kind === 'before_class' && payload?.starts_at) {
    return Math.max(60, Math.floor((new Date(payload.starts_at).getTime() - now.getTime()) / 1000));
  }
  return 12 * 60 * 60;
}

async function sendToDevice({ push, delivery, device, now }) {
  if (!isPushEndpoint(device.endpoint)) return 'gone';
  let message;
  try {
    message = { ...formatNotification(delivery.kind, delivery.payload, { locale: device.locale, now }), tag: delivery.delivery_id };
  } catch {
    return 'failed';
  }
  try {
    await push(device, JSON.stringify(message), { ttl: ttlFor(delivery.kind, delivery.payload, now) });
    return 'sent';
  } catch (error) {
    return error?.status === 404 || error?.status === 410 ? 'gone' : 'failed';
  }
}

export async function runSender({ rpc, push, now = () => new Date(), batchLimit = BATCH_LIMIT }) {
  const claimed = await rpc('claim_due_notifications', { batch_limit: batchLimit });
  if (claimed.error) throw new Error(`claim failed: ${claimed.error.message}`);
  const deliveries = claimed.data ?? [];
  const totals = { deliveries: deliveries.length, sent: 0, gone: 0, failed: 0 };
  const results = [];
  for (const delivery of deliveries) {
    const outcomes = await Promise.all((delivery.devices ?? []).map(async (device) => {
      const status = await sendToDevice({ push, delivery, device, now: now() });
      totals[status] += 1;
      return { subscription_id: device.subscription_id, status };
    }));
    results.push({ delivery_id: delivery.delivery_id, outcomes });
  }
  if (results.length) {
    const reported = await rpc('report_notification_results', { results });
    if (reported.error) throw new Error(`report failed: ${reported.error.message}`);
  }
  return totals;
}

export async function handleRequest(request, { cronSecret, run, log = console.error }) {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!sameSecret(request.headers.get('x-roda-cron-secret'), cronSecret)) {
    return new Response('unauthorized', { status: 401 });
  }
  try {
    return Response.json(await run());
  } catch (error) {
    // Messages come from this file only; they never include keys, endpoints, or secrets.
    log(`send-notifications failed: ${error?.message ?? error}`);
    return Response.json({ error: 'send_failed' }, { status: 500 });
  }
}
```

```js
// supabase/functions/send-notifications/vapid.js
// VAPID keys are kept in the standard base64url form (Ruling 2); the push
// library imports JSON Web Keys, so this turns one into the other.
function decode(text) {
  const base64 = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function vapidJwks(publicKey, privateKey) {
  const point = decode(publicKey);
  const scalar = decode(privateKey);
  if (point.length !== 65 || point[0] !== 4 || scalar.length !== 32) {
    throw new Error('VAPID keys must be a base64url P-256 key pair');
  }
  const x = encode(point.slice(1, 33));
  const y = encode(point.slice(33, 65));
  return {
    publicKey: { kty: 'EC', crv: 'P-256', x, y, ext: true },
    privateKey: { kty: 'EC', crv: 'P-256', x, y, d: encode(scalar), ext: true },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/send-notifications.test.js tests/unit/notification-copy.test.js`
Expected: PASS.

- [ ] **Step 5: Wire the function for Deno**

```ts
// supabase/functions/send-notifications/index.ts
// Wiring only (Ruling 19): read secrets, connect the database and the push
// library, and hand them to run.js, which holds the tested logic.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import * as webpush from 'jsr:@negrel/webpush@0.5.0';

import { handleRequest, runSender } from './run.js';
import { vapidJwks } from './vapid.js';

function env(name: string): string {
  return Deno.env.get(name) ?? '';
}

// Ruling 4: the key Supabase injects; nothing is copied anywhere.
function secretKey(): string {
  try {
    const keys = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}');
    if (typeof keys.default === 'string' && keys.default) return keys.default;
  } catch {
    // Fall back to the legacy key below.
  }
  return env('SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(env('SUPABASE_URL'), secretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const vapidKeys = await webpush.importVapidKeys(vapidJwks(env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY')), {
  extractable: false,
});
const appServer = await webpush.ApplicationServer.new({
  contactInformation: env('VAPID_SUBJECT') || 'mailto:support@roda.fyi',
  vapidKeys,
});

async function push(device: { endpoint: string; p256dh: string; auth: string }, text: string, options: { ttl: number }) {
  const subscriber = appServer.subscribe({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } });
  try {
    await subscriber.pushTextMessage(text, { ttl: options.ttl });
  } catch (error) {
    if (error instanceof webpush.PushMessageError) {
      throw Object.assign(new Error('push rejected'), { status: error.response.status });
    }
    throw error;
  }
}

Deno.serve((request: Request) => handleRequest(request, {
  cronSecret: env('NOTIFICATIONS_CRON_SECRET'),
  run: () => runSender({ rpc: (name: string, params: Record<string, unknown>) => supabase.rpc(name, params), push }),
}));
```

In `supabase/config.toml`, add after the `[edge_runtime.secrets]` comment block (before `[analytics]`):

```toml
# Ruling 3: started only by pg_cron, which sends the x-roda-cron-secret header
# instead of a user's JWT.
[functions.send-notifications]
enabled = true
verify_jwt = false
```

- [ ] **Step 6: (Optional, needs Docker) Smoke the function locally**

This step is not required to finish the task; it checks `index.ts` and is safe because it only runs locally. Create the ignored file `supabase/functions/.env` (the `.env` pattern in `.gitignore` already covers it). Put a throwaway key pair in it from Owner rollout step 1, plus `VAPID_SUBJECT=mailto:support@roda.fyi` and `NOTIFICATIONS_CRON_SECRET=local-secret`. Then run:

```bash
npx supabase functions serve send-notifications --no-verify-jwt --env-file supabase/functions/.env
# in another shell:
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:54321/functions/v1/send-notifications
curl -s -X POST -H 'x-roda-cron-secret: local-secret' http://127.0.0.1:54321/functions/v1/send-notifications
```

Expected: `401`, then `{"deliveries":0,"sent":0,"gone":0,"failed":0}` (or counts for what the local data has due). Delete `supabase/functions/.env` afterwards.

- [ ] **Step 7: Run the unit suite**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/send-notifications/run.js supabase/functions/send-notifications/vapid.js supabase/functions/send-notifications/index.ts supabase/config.toml tests/unit/send-notifications.test.js
git commit -m "feat: send due notifications from a Supabase Edge Function

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The service worker shows pushes and opens the right screen

**Files:**
- Create: `src/app/sw/push-policy.js`
- Modify: `src/app/sw/service-worker.js`, `tests/unit/helpers/worker-harness.js`
- Test: `tests/unit/service-worker.test.js`

**Interfaces:**
- Consumes (Task 6): the push message `{ title, body, url, tag }` as JSON text.
- Produces (`push-policy.js`): `appLink(url) → string` (the link, or `'/app'`), `notificationFromPush(data) → { title, options: { body, icon, badge, tag?, data: { url } } }`, and `NOTIFICATION_ICON = '/assets/icons/app-192.png'`.
- Produces (`worker-harness.js`): `loadWorker(load, { cacheKeys, windowClients })`, where `self.registration.showNotification`, `self.clients.matchAll`, and `self.clients.openWindow` are `vi.fn`. Also `dispatch(handlers, type, event) → Promise` runs an event that uses `waitUntil`.

- [ ] **Step 1: Extend the harness**

In `tests/unit/helpers/worker-harness.js`, change the signature to `export async function loadWorker(load, { cacheKeys = [], windowClients = [] } = {})` and replace the `clients` and `registration` entries of `self` with:

```js
    clients: {
      claim: vi.fn(async () => {}),
      matchAll: vi.fn(async () => windowClients),
      openWindow: vi.fn(async () => null),
    },
    registration: { unregister: vi.fn(async () => true), showNotification: vi.fn(async () => {}) },
```

Append:

```js
// Runs a handler that finishes through waitUntil, such as push or notificationclick.
export async function dispatch(handlers, type, event = {}) {
  let done;
  handlers[type]({ ...event, waitUntil: (promise) => { done = promise; } });
  await done;
}
```

- [ ] **Step 2: Write the failing tests**

Change the harness import in `tests/unit/service-worker.test.js` to `import { ORIGIN, dispatch, lifecycle, loadWorker as load, respond } from './helpers/worker-harness.js';` and append:

```js
describe('service worker notifications', () => {
  const push = (message) => ({ data: { json: () => message } });

  it('shows each push as a notification that remembers its link', async () => {
    const worker = await loadWorker();
    await dispatch(worker.handlers, 'push', push({ title: 'Class in 1 hour', body: 'Group class · Grupo Lua at 7:00 PM', url: '/app#/class/s1', tag: 'd1' }));
    expect(worker.self.registration.showNotification).toHaveBeenCalledWith('Class in 1 hour', {
      body: 'Group class · Grupo Lua at 7:00 PM', icon: '/assets/icons/app-192.png', badge: '/assets/icons/app-192.png',
      tag: 'd1', data: { url: '/app#/class/s1' },
    });
  });

  it('still shows something for a push it cannot read', async () => {
    const worker = await loadWorker();
    await dispatch(worker.handlers, 'push', { data: { json: () => { throw new SyntaxError('bad'); } } });
    await dispatch(worker.handlers, 'push', { data: null });
    expect(worker.self.registration.showNotification).toHaveBeenCalledTimes(2);
    expect(worker.self.registration.showNotification).toHaveBeenLastCalledWith('roda', expect.objectContaining({ body: '', data: { url: '/app' } }));
  });

  it('never links outside the app', async () => {
    const worker = await loadWorker();
    await dispatch(worker.handlers, 'push', push({ title: 'x', url: 'https://attacker.example/app#/' }));
    await dispatch(worker.handlers, 'push', push({ title: 'x', url: 'javascript:alert(1)' }));
    expect(worker.self.registration.showNotification.mock.calls.map(([, options]) => options.data.url)).toEqual(['/app', '/app']);
  });

  it('a tap moves an open app to the right screen', async () => {
    const open = { url: `${ORIGIN}/app#/`, focus: vi.fn(async () => open), navigate: vi.fn(async () => open) };
    const worker = await loadWorker({ windowClients: [{ url: `${ORIGIN}/install`, focus: vi.fn() }, open] });
    const notification = { data: { url: '/app#/training/o1' }, close: vi.fn() };
    await dispatch(worker.handlers, 'notificationclick', { notification });
    expect(notification.close).toHaveBeenCalled();
    expect(open.focus).toHaveBeenCalled();
    expect(open.navigate).toHaveBeenCalledWith(`${ORIGIN}/app#/training/o1`);
    expect(worker.self.clients.openWindow).not.toHaveBeenCalled();
  });

  it('a tap opens the app when it is closed', async () => {
    const worker = await loadWorker();
    await dispatch(worker.handlers, 'notificationclick', { notification: { data: { url: '/app#/me/teaching' }, close: vi.fn() } });
    expect(worker.self.clients.openWindow).toHaveBeenCalledWith('/app#/me/teaching');
  });

  it('a tap on a notification with a strange link opens Today', async () => {
    const worker = await loadWorker();
    await dispatch(worker.handlers, 'notificationclick', { notification: { data: { url: '//attacker.example' }, close: vi.fn() } });
    expect(worker.self.clients.openWindow).toHaveBeenCalledWith('/app');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/service-worker.test.js`
Expected: FAIL: `handlers.push is not a function` (the worker has no push handler).

- [ ] **Step 4: Implement**

```js
// src/app/sw/push-policy.js
// What the service worker shows for a push, and where a tap may lead.
import { SHELL_PATH } from './cache-policy.js';

export const NOTIFICATION_ICON = '/assets/icons/app-192.png';
const APP_LINK = /^\/app(#\/[A-Za-z0-9/_-]*)?$/;

// Ruling 18: a notification only ever opens a screen of the app itself.
export function appLink(url) {
  return typeof url === 'string' && APP_LINK.test(url) ? url : SHELL_PATH;
}

function text(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

// iPhones stop delivering to a site whose pushes show nothing, so every push
// becomes a notification, even one that cannot be read.
export function notificationFromPush(data) {
  let message = {};
  try {
    message = data?.json() ?? {};
  } catch {
    message = {};
  }
  const tag = text(message.tag, 64);
  return {
    title: text(message.title, 120) || 'roda',
    options: {
      body: text(message.body, 240),
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_ICON,
      ...(tag ? { tag } : {}),
      data: { url: appLink(message.url) },
    },
  };
}
```

In `src/app/sw/service-worker.js`, add the import under the existing one:

```js
import { appLink, notificationFromPush } from './push-policy.js';
```

and append:

```js
self.addEventListener('push', (event) => {
  const { title, options } = notificationFromPush(event.data);
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = appLink(event.notification.data?.url);
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
    const open = windows.find((client) => new URL(client.url).pathname === SHELL_PATH);
    if (!open) {
      await self.clients.openWindow(target);
      return;
    }
    await open.focus();
    // If the browser refuses to move the open app, it is at least in front.
    await open.navigate(new URL(target, self.location.origin).href).catch(() => null);
  }));
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/service-worker.test.js tests/unit/cache-policy.test.js tests/unit/dead-code.test.js`
Expected: PASS.

- [ ] **Step 6: Run the suites**

Run: `npm run test:unit && npm run test:e2e`
Expected: PASS (`build:test` rebuilds `app-sw.js` with the new handlers).

- [ ] **Step 7: Commit**

```bash
git add src/app/sw/push-policy.js src/app/sw/service-worker.js tests/unit/helpers/worker-harness.js tests/unit/service-worker.test.js
git commit -m "feat: show pushes and open the right screen when one is tapped

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The device seam, the notification service, and their fakes

**Files:**
- Create: `src/app/push-device.js`, `src/app/notification-service.js`, `src/app/notifications.js`, `tests/unit/helpers/fake-push-device.js`
- Modify: `src/app/create-services.js`, `src/app/testing/fake-services.js`, `src/app/entries/app.js`, `src/app/errors.js`, `src/app/dashboard-i18n.js`
- Test: `tests/unit/push-device.test.js`, `tests/unit/notification-service.test.js`, `tests/unit/notifications.test.js`

**Interfaces:**
- Consumes (Task 1): `publicConfig.vapidPublicKey`. Consumes (Task 2): the four person RPCs.
- Produces (`push-device.js`):
  - `pushSupport({ window, navigator }) → 'supported'|'ios-browser'|'unsupported'`
  - `base64UrlToBytes(text) → Uint8Array`
  - `createPushDevice({ window, navigator, vapidPublicKey }) → PushDevice`, where `PushDevice` is `{ support(), permission() → 'default'|'granted'|'denied', requestPermission() → Promise<string>, subscription() → Promise<Sub|null>, subscribe() → Promise<Sub>, unsubscribe() → Promise<endpoint|null> }` and `Sub = { endpoint, p256dh, auth }`.
- Produces (`notification-service.js`): `createNotificationService(client) → { saveSubscription({ endpoint, p256dh, auth, locale, timezone }), deleteSubscription(endpoint), getPreferences(), updatePreferences(preferences) }`. Also `DEFAULT_PREFERENCES`, `BEFORE_CHOICES = [15, 30, 60, 120]`, `AFTER_CHOICES = [30, 60, 120]`, `QUIET_HOURS = ['00:00' … '23:00']`, and `checkPreferences(input) → preferences` (throws `AppError` `invalid_preferences`).
- Produces (`notifications.js`), where `Link = { device: PushDevice|null, service, locale, timezone }`:
  - `notificationLink(ctx) → Link`
  - `deviceState(device) → Promise<'demo'|'unsupported'|'ios-browser'|'blocked'|'off'|'on'>`
  - `turnOn(link) → Promise<'on'|'off'|'blocked'>`
  - `turnOff(link) → Promise<'off'>`
  - `refreshSubscription(link) → Promise<boolean>`
  - `forgetDevice(link, { timeoutMs = 3000 }) → Promise<boolean>` (never rejects)
- Produces (`fake-services.js`): `createE2EPushDevice({ window })`, driven by `localStorage['roda.e2e.push']` = `{ support?, permission?, answer?, subscribed? }`, which records `push-permission`. Also `createE2ENotificationService({ window })`, which stores `roda.e2e.notificationState` = `{ subscriptions, preferences }` and records `push-subscribe` (`endpoint, locale, timezone`), `push-unsubscribe` (`endpoint`), and `notification-preferences`.
- Produces (app): `services.notifications` and `ctx.pushDevice`. A device that is on is saved again, with the current language and zone, every time the app starts.

- [ ] **Step 1: Write the fake device used by unit tests**

```js
// tests/unit/helpers/fake-push-device.js
// A PushDevice (src/app/push-device.js) whose browser answers are scripted.
import { vi } from 'vitest';

export const SUBSCRIPTION = Object.freeze({
  endpoint: 'https://fcm.googleapis.com/fcm/send/unit-device', p256dh: 'P'.repeat(87), auth: 'A'.repeat(22),
});

export function fakeDevice({ support = 'supported', permission = 'default', answer = 'granted', subscribed = false } = {}) {
  const state = { permission, subscribed };
  return {
    state,
    support: () => support,
    permission: () => state.permission,
    requestPermission: vi.fn(async () => {
      state.permission = answer;
      return answer;
    }),
    subscription: vi.fn(async () => (state.subscribed ? { ...SUBSCRIPTION } : null)),
    subscribe: vi.fn(async () => {
      state.subscribed = true;
      return { ...SUBSCRIPTION };
    }),
    unsubscribe: vi.fn(async () => {
      const was = state.subscribed;
      state.subscribed = false;
      return was ? SUBSCRIPTION.endpoint : null;
    }),
  };
}
```

- [ ] **Step 2: Write the failing tests**

```js
// tests/unit/push-device.test.js
import { describe, expect, it, vi } from 'vitest';

import { base64UrlToBytes, createPushDevice, pushSupport } from '../../src/app/push-device.js';

const KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

const pushSubscription = (endpoint) => ({
  endpoint,
  toJSON: () => ({ endpoint, keys: { p256dh: 'P'.repeat(87), auth: 'A'.repeat(22) } }),
  unsubscribe: vi.fn(async () => true),
});

function browser({ userAgent = ANDROID, standalone = false, push = true, permission = 'default', current = null } = {}) {
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => pushSubscription('https://fcm.googleapis.com/fcm/send/new')),
  };
  const window = {
    matchMedia: () => ({ matches: standalone }),
    ...(push ? { PushManager: function PushManager() {}, Notification: { permission, requestPermission: vi.fn(async () => 'granted') } } : {}),
  };
  const navigator = { userAgent, maxTouchPoints: 5, ...(push ? { serviceWorker: { ready: Promise.resolve({ pushManager }) } } : {}) };
  return { window, navigator, pushManager };
}

describe('push device', () => {
  it('tells an iPhone in Safari to use the Home Screen app first', () => {
    expect(pushSupport(browser({ userAgent: IPHONE, push: false }))).toBe('ios-browser');
    expect(pushSupport(browser({ userAgent: IPHONE, standalone: true }))).toBe('supported');
    expect(pushSupport(browser({ push: false }))).toBe('unsupported');
    expect(pushSupport(browser())).toBe('supported');
  });

  it('decodes the public key the browser needs', () => {
    const bytes = base64UrlToBytes(KEY);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
  });

  it('asks the browser for permission', async () => {
    const env = browser({ permission: 'denied' });
    const device = createPushDevice({ ...env, vapidPublicKey: KEY });
    expect(device.permission()).toBe('denied');
    expect(await device.requestPermission()).toBe('granted');
  });

  it('subscribes with the public key and returns plain keys', async () => {
    const env = browser();
    const device = createPushDevice({ ...env, vapidPublicKey: KEY });
    expect(await device.subscription()).toBeNull();
    expect(await device.subscribe()).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/new', p256dh: 'P'.repeat(87), auth: 'A'.repeat(22) });
    const [options] = env.pushManager.subscribe.mock.calls[0];
    expect(options.userVisibleOnly).toBe(true);
    expect([...options.applicationServerKey]).toEqual([...base64UrlToBytes(KEY)]);
  });

  it('unsubscribes and returns the endpoint it removed', async () => {
    const current = pushSubscription('https://web.push.apple.com/old');
    const device = createPushDevice({ ...browser({ current }), vapidPublicKey: KEY });
    expect(await device.unsubscribe()).toBe('https://web.push.apple.com/old');
    expect(current.unsubscribe).toHaveBeenCalled();
    expect(await createPushDevice({ ...browser(), vapidPublicKey: KEY }).unsubscribe()).toBeNull();
  });
});
```

```js
// tests/unit/notification-service.test.js
import { describe, expect, it, vi } from 'vitest';

import {
  AFTER_CHOICES, BEFORE_CHOICES, DEFAULT_PREFERENCES, QUIET_HOURS, checkPreferences, createNotificationService,
} from '../../src/app/notification-service.js';

const DEVICE = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', p256dh: 'P'.repeat(87), auth: 'A'.repeat(22) };
const client = (data = { status: 'saved' }) => ({ rpc: vi.fn().mockResolvedValue({ data, error: null }) });

describe('notification service', () => {
  it('saves and deletes this device', async () => {
    const supabase = client();
    const service = createNotificationService(supabase);
    await service.saveSubscription({ ...DEVICE, locale: 'pt', timezone: 'Europe/Lisbon' });
    expect(supabase.rpc).toHaveBeenCalledWith('save_push_subscription', {
      endpoint: DEVICE.endpoint, p256dh: DEVICE.p256dh, auth_key: DEVICE.auth, locale: 'pt', timezone: 'Europe/Lisbon',
    });
    await service.deleteSubscription(DEVICE.endpoint);
    expect(supabase.rpc).toHaveBeenLastCalledWith('delete_push_subscription', { endpoint: DEVICE.endpoint });
  });

  it('reads and saves what to send', async () => {
    const supabase = client(DEFAULT_PREFERENCES);
    const service = createNotificationService(supabase);
    expect(await service.getPreferences()).toEqual(DEFAULT_PREFERENCES);
    expect(supabase.rpc).toHaveBeenCalledWith('get_notification_preferences', {});
    await service.updatePreferences({ ...DEFAULT_PREFERENCES, before_minutes: 30, quiet_start: null, quiet_end: null });
    expect(supabase.rpc).toHaveBeenLastCalledWith('update_notification_preferences', {
      setup: true, before_class: true, before_minutes: 30, after_class: true, after_minutes: 60, coach: true, quiet_start: null, quiet_end: null,
    });
  });

  it('refuses what the server would refuse, before asking it', async () => {
    const supabase = client();
    await expect(createNotificationService(supabase).updatePreferences({ ...DEFAULT_PREFERENCES, quiet_end: '22:00' }))
      .rejects.toMatchObject({ code: 'invalid_preferences' });
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(() => checkPreferences({ before_minutes: 45 })).toThrow();
    expect(() => checkPreferences({ quiet_start: '22:00', quiet_end: null })).toThrow();
    expect(checkPreferences({})).toEqual(DEFAULT_PREFERENCES);
    expect([BEFORE_CHOICES, AFTER_CHOICES, QUIET_HOURS.length, QUIET_HOURS[22]]).toEqual([[15, 30, 60, 120], [30, 60, 120], 24, '22:00']);
  });

  it('turns database errors into safe messages', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: 'P0001', message: 'invalid_subscription' } }) };
    await expect(createNotificationService(supabase).saveSubscription({ ...DEVICE, locale: 'en', timezone: null }))
      .rejects.toMatchObject({ code: 'invalid_subscription', message: 'This device could not be set up for notifications.' });
  });
});
```

```js
// tests/unit/notifications.test.js
import { describe, expect, it, vi } from 'vitest';

import {
  deviceState, forgetDevice, notificationLink, refreshSubscription, turnOff, turnOn,
} from '../../src/app/notifications.js';
import { SUBSCRIPTION, fakeDevice } from './helpers/fake-push-device.js';

const service = (overrides = {}) => ({
  saveSubscription: vi.fn().mockResolvedValue({ status: 'saved' }),
  deleteSubscription: vi.fn().mockResolvedValue({ status: 'deleted' }),
  ...overrides,
});
const link = (device, notifications = service()) => ({ device, service: notifications, locale: 'pt', timezone: 'America/New_York' });

describe('notifications on this device', () => {
  it('names the state of this device', async () => {
    expect(await deviceState(null)).toBe('demo');
    expect(await deviceState(fakeDevice({ support: 'unsupported' }))).toBe('unsupported');
    expect(await deviceState(fakeDevice({ support: 'ios-browser' }))).toBe('ios-browser');
    expect(await deviceState(fakeDevice({ permission: 'denied' }))).toBe('blocked');
    expect(await deviceState(fakeDevice())).toBe('off');
    expect(await deviceState(fakeDevice({ permission: 'granted' }))).toBe('off');
    expect(await deviceState(fakeDevice({ permission: 'granted', subscribed: true }))).toBe('on');
  });

  it('asks the browser, subscribes, and saves the device with its language and zone', async () => {
    const device = fakeDevice();
    const notifications = service();
    expect(await turnOn(link(device, notifications))).toBe('on');
    expect(device.requestPermission).toHaveBeenCalledTimes(1);
    expect(notifications.saveSubscription).toHaveBeenCalledWith({ ...SUBSCRIPTION, locale: 'pt', timezone: 'America/New_York' });
  });

  it('does not ask twice, and reuses a subscription the browser already has', async () => {
    const device = fakeDevice({ permission: 'granted', subscribed: true });
    expect(await turnOn(link(device))).toBe('on');
    expect(device.requestPermission).not.toHaveBeenCalled();
    expect(device.subscribe).not.toHaveBeenCalled();
  });

  it('stops when the person says no or closes the prompt', async () => {
    const notifications = service();
    const denied = fakeDevice({ answer: 'denied' });
    expect(await turnOn(link(denied, notifications))).toBe('blocked');
    expect(await turnOn(link(fakeDevice({ answer: 'default' }), notifications))).toBe('off');
    expect(denied.subscribe).not.toHaveBeenCalled();
    expect(notifications.saveSubscription).not.toHaveBeenCalled();
  });

  it('never leaves the device half on when saving fails', async () => {
    const device = fakeDevice();
    const notifications = service({ saveSubscription: vi.fn().mockRejectedValue(new Error('offline')) });
    await expect(turnOn(link(device, notifications))).rejects.toThrow('offline');
    expect(device.unsubscribe).toHaveBeenCalled();
    expect(await deviceState(device)).toBe('off');
  });

  it('turns off in the browser first, then removes the device from the account', async () => {
    const device = fakeDevice({ permission: 'granted', subscribed: true });
    const notifications = service({ deleteSubscription: vi.fn().mockRejectedValue(new Error('offline')) });
    expect(await turnOff(link(device, notifications))).toBe('off');
    expect(notifications.deleteSubscription).toHaveBeenCalledWith(SUBSCRIPTION.endpoint);
    expect(await deviceState(device)).toBe('off');
  });

  it('saves the language and zone again only when the device is on', async () => {
    const notifications = service();
    expect(await refreshSubscription(link(null, notifications))).toBe(false);
    expect(await refreshSubscription(link(fakeDevice(), notifications))).toBe(false);
    expect(await refreshSubscription(link(fakeDevice({ permission: 'granted', subscribed: true }), notifications))).toBe(true);
    expect(notifications.saveSubscription).toHaveBeenCalledTimes(1);
    expect(notifications.saveSubscription).toHaveBeenCalledWith({ ...SUBSCRIPTION, locale: 'pt', timezone: 'America/New_York' });
  });

  it('forgets this device on sign-out without waiting for a slow network', async () => {
    const device = fakeDevice({ permission: 'granted', subscribed: true });
    const notifications = service({ deleteSubscription: vi.fn(() => new Promise(() => {})) });
    expect(await forgetDevice(link(device, notifications), { timeoutMs: 20 })).toBe(false);
    expect(device.unsubscribe).toHaveBeenCalled();
    expect(await deviceState(device)).toBe('off');
    expect(await forgetDevice(link(null, notifications))).toBe(false);
    expect(await forgetDevice(link(fakeDevice({ permission: 'granted', subscribed: true })))).toBe(true);
  });

  it('builds its link from the app context', () => {
    const device = fakeDevice();
    const notifications = service();
    expect(notificationLink({ pushDevice: device, services: { notifications }, i18n: { locale: () => 'en' }, timezone: 'Europe/Lisbon' }))
      .toEqual({ device, service: notifications, locale: 'en', timezone: 'Europe/Lisbon' });
    expect(notificationLink({ services: {}, i18n: { locale: () => 'en' }, timezone: 'UTC' }).device).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/push-device.test.js tests/unit/notification-service.test.js tests/unit/notifications.test.js`
Expected: FAIL: the three modules do not exist.

- [ ] **Step 4: Implement the three modules**

```js
// src/app/push-device.js
// The browser side of notifications: support, permission, and this device's
// push subscription (Ruling 14). Tests use a fake with the same shape.
export function base64UrlToBytes(text) {
  const base64 = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function pushSupport({ window, navigator }) {
  const userAgent = navigator?.userAgent ?? '';
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && (navigator?.maxTouchPoints ?? 0) > 1);
  const standalone = Boolean(window?.matchMedia?.('(display-mode: standalone)').matches || navigator?.standalone === true);
  if (ios && !standalone) return 'ios-browser';
  if (!navigator?.serviceWorker || !window?.PushManager || !window?.Notification) return 'unsupported';
  return 'supported';
}

function plain(subscription) {
  if (!subscription) return null;
  const { endpoint, keys = {} } = subscription.toJSON();
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

export function createPushDevice({ window, navigator, vapidPublicKey }) {
  const pushManager = async () => (await navigator.serviceWorker.ready).pushManager;
  return {
    support: () => pushSupport({ window, navigator }),
    permission: () => window.Notification?.permission ?? 'default',
    requestPermission: () => window.Notification.requestPermission(),
    async subscription() {
      return plain(await (await pushManager()).getSubscription());
    },
    async subscribe() {
      return plain(await (await pushManager()).subscribe({
        userVisibleOnly: true, applicationServerKey: base64UrlToBytes(vapidPublicKey),
      }));
    },
    async unsubscribe() {
      const current = await (await pushManager()).getSubscription();
      if (!current) return null;
      await current.unsubscribe();
      return current.endpoint;
    },
  };
}
```

```js
// src/app/notification-service.js
// This device and the account's notification choices (Rulings 13 and 16).
import { AppError, toAppError } from './errors.js';

export const BEFORE_CHOICES = Object.freeze([15, 30, 60, 120]);
export const AFTER_CHOICES = Object.freeze([30, 60, 120]);
export const QUIET_HOURS = Object.freeze(Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`));
export const DEFAULT_PREFERENCES = Object.freeze({
  setup: true, before_class: true, before_minutes: 60, after_class: true, after_minutes: 60, coach: true,
  quiet_start: '22:00', quiet_end: '08:00',
});

// The same rules as private.update_notification_preferences.
export function checkPreferences(input = {}) {
  const preferences = { ...DEFAULT_PREFERENCES, ...input };
  const switches = ['setup', 'before_class', 'after_class', 'coach'].every((name) => typeof preferences[name] === 'boolean');
  const quietOff = preferences.quiet_start === null && preferences.quiet_end === null;
  const quietOn = QUIET_HOURS.includes(preferences.quiet_start) && QUIET_HOURS.includes(preferences.quiet_end)
    && preferences.quiet_start !== preferences.quiet_end;
  if (!switches || !BEFORE_CHOICES.includes(preferences.before_minutes) || !AFTER_CHOICES.includes(preferences.after_minutes)
    || !(quietOff || quietOn)) {
    throw new AppError('validation', 'invalid_preferences');
  }
  return {
    setup: preferences.setup, before_class: preferences.before_class, before_minutes: preferences.before_minutes,
    after_class: preferences.after_class, after_minutes: preferences.after_minutes, coach: preferences.coach,
    quiet_start: preferences.quiet_start, quiet_end: preferences.quiet_end,
  };
}

export function createNotificationService(client) {
  async function call(name, params = {}) {
    const result = await client.rpc(name, params);
    if (result.error) throw toAppError(result.error);
    return result.data;
  }

  return {
    saveSubscription({ endpoint, p256dh, auth, locale, timezone = null }) {
      return call('save_push_subscription', { endpoint, p256dh, auth_key: auth, locale, timezone });
    },
    deleteSubscription(endpoint) {
      return call('delete_push_subscription', { endpoint });
    },
    getPreferences() {
      return call('get_notification_preferences');
    },
    async updatePreferences(preferences) {
      return call('update_notification_preferences', checkPreferences(preferences));
    },
  };
}
```

```js
// src/app/notifications.js
// Turning phone notifications on and off for this device. The browser parts
// come from a device seam (Ruling 14); the account parts go through the
// notification service.
export function notificationLink(ctx) {
  return {
    device: ctx.pushDevice ?? null,
    service: ctx.services.notifications,
    locale: ctx.i18n.locale(),
    timezone: ctx.timezone,
  };
}

// Ruling 15.
export async function deviceState(device) {
  if (!device) return 'demo';
  const support = device.support();
  if (support !== 'supported') return support;
  const permission = device.permission();
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'off';
  return (await device.subscription()) ? 'on' : 'off';
}

export async function turnOn({ device, service, locale, timezone }) {
  const permission = device.permission() === 'granted' ? 'granted' : await device.requestPermission();
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'off';
  const subscription = (await device.subscription()) ?? await device.subscribe();
  try {
    await service.saveSubscription({ ...subscription, locale, timezone });
  } catch (error) {
    // Never half on: a subscription the account does not know about is removed.
    await device.unsubscribe().catch(() => null);
    throw error;
  }
  return 'on';
}

// The browser forgets first, so even offline this device stops receiving.
export async function turnOff({ device, service }) {
  const endpoint = await device.unsubscribe();
  if (endpoint) await service.deleteSubscription(endpoint).catch(() => null);
  return 'off';
}

// Ruling 7: the server learns this device's current language and zone.
export async function refreshSubscription({ device, service, locale, timezone }) {
  if (!device || device.support() !== 'supported' || device.permission() !== 'granted') return false;
  const subscription = await device.subscription();
  if (!subscription) return false;
  await service.saveSubscription({ ...subscription, locale, timezone });
  return true;
}

// Ruling 13: sign-out turns this device off, but never waits long for it.
export function forgetDevice(link, { timeoutMs = 3000 } = {}) {
  if (!link.device || link.device.support() !== 'supported') return Promise.resolve(false);
  let timer;
  const gaveUp = new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
  const done = turnOff(link).then(() => true, () => false);
  return Promise.race([done, gaveUp]).finally(() => clearTimeout(timer));
}
```

In `src/app/errors.js`, add to `SAFE_MESSAGES` (alphabetical order is not required; keep them next to `invalid_email`):

```js
  invalid_preferences: 'Those notification settings are not allowed. Quiet hours need two different times.',
  invalid_subscription: 'This device could not be set up for notifications.',
```

In `src/app/dashboard-i18n.js`, next to the other `errors.` keys, add to `en`:

```js
    'errors.invalid_preferences': 'Those notification settings are not allowed. Quiet hours need two different times.',
    'errors.invalid_subscription': 'This device could not be set up for notifications.',
```

and to `pt`:

```js
    'errors.invalid_preferences': 'Essas definições de notificações não são permitidas. As horas de silêncio precisam de duas horas diferentes.',
    'errors.invalid_subscription': 'Não foi possível preparar este dispositivo para notificações.',
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/push-device.test.js tests/unit/notification-service.test.js tests/unit/notifications.test.js tests/unit/dashboard-i18n.test.js`
Expected: PASS.

- [ ] **Step 6: Add the fakes and wire the app**

In `src/app/testing/fake-services.js`, add `import { DEFAULT_PREFERENCES, checkPreferences } from '../notification-service.js';` to the imports and append:

```js
// Ruling 14: browser tests script this device through localStorage['roda.e2e.push'].
// Unless a test says otherwise, notifications are unsupported, so no card appears.
const E2E_PUSH_KEY = 'roda.e2e.push';
const E2E_SUBSCRIPTION = Object.freeze({
  endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-device', p256dh: 'B'.repeat(87), auth: 'a'.repeat(22),
});

export function createE2EPushDevice({ window }) {
  const { localStorage: storage } = window;
  const read = () => {
    try {
      return JSON.parse(storage.getItem(E2E_PUSH_KEY)) ?? {};
    } catch {
      return {};
    }
  };
  const write = (changes) => storage.setItem(E2E_PUSH_KEY, JSON.stringify({ ...read(), ...changes }));
  const record = (event) => window.__RODA_E2E_EVENTS__?.push(event);
  return {
    support: () => read().support ?? 'unsupported',
    // Playwright's grantPermissions sets the real permission; a test may also script it.
    permission: () => read().permission ?? window.Notification?.permission ?? 'default',
    async requestPermission() {
      const answer = read().answer ?? await window.Notification?.requestPermission?.() ?? 'denied';
      write({ permission: answer });
      record({ type: 'push-permission', answer });
      return answer;
    },
    async subscription() {
      return read().subscribed ? { ...E2E_SUBSCRIPTION } : null;
    },
    async subscribe() {
      write({ subscribed: true });
      return { ...E2E_SUBSCRIPTION };
    },
    async unsubscribe() {
      if (!read().subscribed) return null;
      write({ subscribed: false });
      return E2E_SUBSCRIPTION.endpoint;
    },
  };
}

export function createE2ENotificationService({ window }) {
  const { localStorage: storage } = window;
  const key = 'roda.e2e.notificationState';
  const read = () => ({ subscriptions: [], preferences: null, ...JSON.parse(storage.getItem(key) ?? '{}') });
  const write = (state) => storage.setItem(key, JSON.stringify(state));
  const record = (event) => window.__RODA_E2E_EVENTS__?.push(event);
  return {
    async saveSubscription({ endpoint, p256dh, auth, locale, timezone = null }) {
      if (!/^https:\/\//.test(endpoint ?? '') || !['en', 'pt'].includes(locale)) {
        throw new AppError('validation', 'invalid_subscription');
      }
      const state = read();
      state.subscriptions = [...state.subscriptions.filter((item) => item.endpoint !== endpoint), { endpoint, p256dh, auth, locale, timezone }];
      write(state);
      record({ type: 'push-subscribe', endpoint, locale, timezone });
      return { status: 'saved', subscription_id: `subscription-${state.subscriptions.length}` };
    },
    async deleteSubscription(endpoint) {
      const state = read();
      const before = state.subscriptions.length;
      state.subscriptions = state.subscriptions.filter((item) => item.endpoint !== endpoint);
      write(state);
      record({ type: 'push-unsubscribe', endpoint });
      return { status: state.subscriptions.length < before ? 'deleted' : 'missing' };
    },
    async getPreferences() {
      return { ...DEFAULT_PREFERENCES, ...(read().preferences ?? {}) };
    },
    async updatePreferences(preferences) {
      const clean = checkPreferences(preferences);
      write({ ...read(), preferences: clean });
      record({ type: 'notification-preferences', preferences: clean });
      return clean;
    },
  };
}
```

In `src/app/create-services.js`, import `createNotificationService` from `./notification-service.js`, add `createE2ENotificationService` to the fake-services import, add `notifications: createE2ENotificationService({ window }),` to the local-mode object, and add `notifications: createNotificationService(client),` to the real one.

In `src/app/entries/app.js`, add these imports:

```js
import { publicConfig } from '../config.js';
import { notificationLink, refreshSubscription } from '../notifications.js';
import { createPushDevice } from '../push-device.js';
import { createE2EPushDevice } from '../testing/fake-services.js';
```

After `const services = createServices(...)`, add:

```js
  // Ruling 14: browser tests drive a fake device; the demo has no account to send to.
  const pushDevice = __RODA_E2E__
    ? createE2EPushDevice({ window })
    : (demoMode ? null : createPushDevice({ window, navigator, vapidPublicKey: publicConfig.vapidPublicKey }));
```

Add `pushDevice,` to the `ctx` object (next to `services`), and right after the `ctx` object is created add:

```js
  // Ruling 7: a device that is on tells the server its current language and zone.
  refreshSubscription(notificationLink(ctx)).catch(() => {});
```

- [ ] **Step 7: Run the suites**

Run: `npm run test:unit && npm run test:e2e`
Expected: PASS. `dead-code.test.js` and `i18n-usage.test.js` pass because `app.js` now loads the three modules, and `errors.${code}` covers the new error keys. Existing browser tests are unchanged: the fake device reports `unsupported` unless a test sets `roda.e2e.push`.

- [ ] **Step 8: Commit**

```bash
git add src/app/push-device.js src/app/notification-service.js src/app/notifications.js src/app/create-services.js src/app/testing/fake-services.js src/app/entries/app.js src/app/errors.js src/app/dashboard-i18n.js tests/unit/helpers/fake-push-device.js tests/unit/push-device.test.js tests/unit/notification-service.test.js tests/unit/notifications.test.js
git commit -m "feat: turn notifications on and off for this device

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Settings → Notifications

**Files:**
- Create: `src/app/screens/notification-settings.js`, `tests/e2e/app-notifications.spec.js`
- Modify: `src/app/screens/me.js`, `src/app/entries/app.js`, `src/app/dashboard-i18n.js`, `assets/app.css`
- Test: `tests/unit/notification-settings.test.js`

**Interfaces:**
- Consumes (Task 8): `notificationLink`, `deviceState`, `turnOn`, `turnOff`, `refreshSubscription`, `forgetDevice`, `BEFORE_CHOICES`, `AFTER_CHOICES`, `QUIET_HOURS`, `services.notifications`, `ctx.pushDevice`.
- Produces: `renderNotificationSettings(ctx) → Promise<HTMLElement|null>`, a `<section aria-label="Notifications">` that returns `null` when `ctx.services.notifications` is missing. Also `minutesLabel(i18n, minutes) → string` and `hourLabel(i18n, 'HH:00') → string`. Changing the language saves the device again, and sign-out turns this device off first.
- DOM contract: `.notification-device` holds `.notification-state[data-state]`, `[data-action="turn-on-notifications"]`, and `[data-action="turn-off-notifications"]`. The form has `input[name="setup"|"before_class"|"after_class"|"coach"|"quiet"]`, `select[name="before_minutes"|"after_minutes"|"quiet_start"|"quiet_end"]`, `[data-action="save-notifications"]`, and `[data-notification-status]`.

- [ ] **Step 1: Write the failing unit test**

```js
// tests/unit/notification-settings.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PREFERENCES } from '../../src/app/notification-service.js';
import { hourLabel, minutesLabel, renderNotificationSettings } from '../../src/app/screens/notification-settings.js';
import { appCtx } from './app-test-context.js';
import { fakeDevice } from './helpers/fake-push-device.js';

function notificationService(overrides = {}) {
  return {
    getPreferences: vi.fn().mockResolvedValue({ ...DEFAULT_PREFERENCES }),
    updatePreferences: vi.fn(async (preferences) => preferences),
    saveSubscription: vi.fn().mockResolvedValue({ status: 'saved' }),
    deleteSubscription: vi.fn().mockResolvedValue({ status: 'deleted' }),
    ...overrides,
  };
}

async function render({ device = fakeDevice(), service = {}, ctx = {} } = {}) {
  const context = appCtx({ services: { notifications: notificationService(service) }, pushDevice: device, ...ctx });
  return { ctx: context, view: await renderNotificationSettings(context) };
}

describe('notification settings', () => {
  it.each([
    [null, 'Notifications are off in the demo.'],
    [fakeDevice({ support: 'unsupported' }), 'Not supported in this browser'],
    [fakeDevice({ support: 'ios-browser' }), 'Add roda to your Home Screen first'],
    [fakeDevice({ permission: 'denied' }), 'Blocked in the browser'],
    [fakeDevice({ permission: 'granted', subscribed: true }), 'On for this device'],
  ])('describes this device (%#)', async (device, words) => {
    const { view } = await render({ device });
    expect(view.getAttribute('aria-label')).toBe('Notifications');
    expect(view.querySelector('.notification-state').textContent).toBe(words);
    expect(view.querySelector('[data-action="turn-on-notifications"]')).toBeNull();
  });

  it('explains how to fix the blocked and iPhone cases', async () => {
    const blocked = (await render({ device: fakeDevice({ permission: 'denied' }) })).view;
    expect(blocked.querySelector('.notification-device').textContent).toContain('Allow them in your browser');
    const iphone = (await render({ device: fakeDevice({ support: 'ios-browser' }) })).view;
    expect(iphone.querySelector('.notification-device a').getAttribute('href')).toBe('/install');
  });

  it('turns this device on and off', async () => {
    const { ctx, view } = await render();
    view.querySelector('[data-action="turn-on-notifications"]').click();
    await vi.waitFor(() => expect(view.querySelector('.notification-state')?.textContent).toBe('On for this device'));
    expect(ctx.services.notifications.saveSubscription).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en', timezone: 'Europe/Lisbon' }));
    view.querySelector('[data-action="turn-off-notifications"]').click();
    await vi.waitFor(() => expect(view.querySelector('[data-action="turn-on-notifications"]')).not.toBeNull());
    expect(ctx.services.notifications.deleteSubscription).toHaveBeenCalled();
  });

  it('shows why turning on failed and offers it again', async () => {
    const { view } = await render({ service: { saveSubscription: vi.fn().mockRejectedValue(new Error('The network request failed. Please try again.')) } });
    view.querySelector('[data-action="turn-on-notifications"]').click();
    await vi.waitFor(() => expect(view.querySelector('.notification-device [role="status"]').textContent)
      .toBe('The network request failed. Please try again.'));
    expect(view.querySelector('[data-action="turn-on-notifications"]')).not.toBeNull();
  });

  it('shows the saved choices and hides Coach requests from people who do not coach', async () => {
    const { view } = await render({ service: { getPreferences: vi.fn().mockResolvedValue({ ...DEFAULT_PREFERENCES, before_minutes: 30, quiet_start: null, quiet_end: null }) } });
    expect(view.querySelector('select[name="before_minutes"]').value).toBe('30');
    expect([...view.querySelectorAll('select[name="before_minutes"] option')].map((option) => option.textContent))
      .toEqual(['15 min', '30 min', '1 hour', '2 hours']);
    expect(view.querySelector('input[name="quiet"]').checked).toBe(false);
    expect(view.querySelector('select[name="quiet_start"]').disabled).toBe(true);
    expect(view.querySelector('input[name="coach"]')).toBeNull();
  });

  it('saves what to send for the whole account', async () => {
    const { ctx, view } = await render({ ctx: { isCoach: () => true } });
    view.querySelector('input[name="after_class"]').click();
    view.querySelector('select[name="before_minutes"]').value = '15';
    view.querySelector('select[name="quiet_start"]').value = '23:00';
    view.querySelector('select[name="quiet_end"]').value = '07:00';
    view.querySelector('input[name="coach"]').click();
    view.querySelector('[data-action="save-notifications"]').click();
    await vi.waitFor(() => expect(view.querySelector('[data-notification-status]').textContent).toBe('Saved.'));
    expect(ctx.services.notifications.updatePreferences).toHaveBeenCalledWith({
      setup: true, before_class: true, before_minutes: 15, after_class: false, after_minutes: 60, coach: false,
      quiet_start: '23:00', quiet_end: '07:00',
    });
    expect(view.querySelector('select[name="after_minutes"]').disabled).toBe(true);
  });

  it('turns quiet hours off, and keeps the coach choice of people who do not coach', async () => {
    const { ctx, view } = await render({ service: { getPreferences: vi.fn().mockResolvedValue({ ...DEFAULT_PREFERENCES, coach: false }) } });
    view.querySelector('input[name="quiet"]').click();
    view.querySelector('[data-action="save-notifications"]').click();
    await vi.waitFor(() => expect(ctx.services.notifications.updatePreferences).toHaveBeenCalled());
    expect(ctx.services.notifications.updatePreferences.mock.calls[0][0]).toMatchObject({ coach: false, quiet_start: null, quiet_end: null });
  });

  it('says when the choices cannot be loaded', async () => {
    const { view } = await render({ service: { getPreferences: vi.fn().mockRejectedValue(new Error('The network request failed. Please try again.')) } });
    expect(view.textContent).toContain('The network request failed. Please try again.');
    expect(view.querySelector('[data-action="save-notifications"]')).toBeNull();
  });

  it('shows nothing without the notification service', async () => {
    expect(await renderNotificationSettings(appCtx())).toBeNull();
  });

  it('labels the choices in both languages', () => {
    const { i18n } = appCtx();
    expect([minutesLabel(i18n, 30), minutesLabel(i18n, 60), minutesLabel(i18n, 120)]).toEqual(['30 min', '1 hour', '2 hours']);
    expect(hourLabel(i18n, '22:00')).toBe('10:00 PM');
    i18n.setLocale('pt');
    expect(minutesLabel(i18n, 60)).toBe('1 hora');
    expect(hourLabel(i18n, '22:00')).toBe('22:00');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/notification-settings.test.js`
Expected: FAIL: `src/app/screens/notification-settings.js` does not exist.

- [ ] **Step 3: Implement the section**

```js
// src/app/screens/notification-settings.js
// Settings → Notifications: this device's switch (Ruling 15) and what to send
// to every device of the account (Ruling 16).
import { AFTER_CHOICES, BEFORE_CHOICES, QUIET_HOURS } from '../notification-service.js';
import { deviceState, notificationLink, turnOff, turnOn } from '../notifications.js';
import { el } from '../shell/page.js';

const STATE_TEXT = Object.freeze({
  on: 'notifications.on', blocked: 'notifications.blocked', 'ios-browser': 'notifications.iosBrowser',
  unsupported: 'notifications.unsupported', demo: 'notifications.demo',
});

export function minutesLabel(i18n, minutes) {
  if (minutes < 60) return i18n.t('notifications.minutes', { count: minutes });
  if (minutes === 60) return i18n.t('notifications.hour');
  return i18n.t('notifications.hours', { count: minutes / 60 });
}

export function hourLabel(i18n, value) {
  const hour = Number(String(value).slice(0, 2));
  return new Intl.DateTimeFormat(i18n.locale() === 'pt' ? 'pt-PT' : 'en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2026, 0, 1, hour))).replace(/ /g, ' ');
}

function choice(document, { name, label, values, value, text }) {
  return el(document, 'select', { className: 'field-input', attrs: { name, 'aria-label': label } },
    values.map((option) => el(document, 'option', { text: text(option), attrs: { value: String(option), selected: option === value } })));
}

function toggle(document, { name, label, checked }) {
  const input = el(document, 'input', { attrs: { type: 'checkbox', name, checked: Boolean(checked) } });
  return { input, row: el(document, 'label', { className: 'notification-row' }, [input, el(document, 'span', { text: label })]) };
}

function deviceBox(ctx) {
  const { document, i18n } = ctx;
  const box = el(document, 'div', { className: 'card notification-device' });
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  let busy = false;

  async function act(action) {
    if (busy) return;
    busy = true;
    status.textContent = '';
    try {
      draw(await action(notificationLink(ctx)));
    } catch (error) {
      status.textContent = error?.message || i18n.t('app.loadError');
    } finally {
      busy = false;
    }
  }

  function draw(state) {
    const parts = [el(document, 'h3', { className: 'notification-heading', text: i18n.t('notifications.device') })];
    if (state === 'off') {
      parts.push(el(document, 'button', {
        className: 'button-primary', text: i18n.t('notifications.turnOn'), attrs: { type: 'button' },
        dataset: { action: 'turn-on-notifications' }, on: { click: () => act(turnOn) },
      }));
    } else {
      parts.push(el(document, 'p', { className: 'notification-state', text: i18n.t(STATE_TEXT[state]), dataset: { state } }));
    }
    if (state === 'on') {
      parts.push(el(document, 'button', {
        className: 'button-secondary', text: i18n.t('notifications.turnOff'), attrs: { type: 'button' },
        dataset: { action: 'turn-off-notifications' }, on: { click: () => act(turnOff) },
      }));
    }
    if (state === 'blocked') parts.push(el(document, 'p', { className: 'muted', text: i18n.t('notifications.blockedHelp') }));
    if (state === 'ios-browser') {
      parts.push(
        el(document, 'p', { className: 'muted', text: i18n.t('notifications.iosHelp') }),
        el(document, 'a', { className: 'button-secondary', text: i18n.t('install.guide'), attrs: { href: '/install' } }),
      );
    }
    box.replaceChildren(...parts, status);
  }

  return { box, draw };
}

async function preferencesForm(ctx) {
  const { document, i18n, services } = ctx;
  let saved;
  try {
    saved = await services.notifications.getPreferences();
  } catch (error) {
    return el(document, 'p', { className: 'muted', text: error?.message || i18n.t('app.loadError') });
  }
  const setup = toggle(document, { name: 'setup', label: i18n.t('notifications.setup'), checked: saved.setup });
  const before = toggle(document, { name: 'before_class', label: i18n.t('notifications.beforeClass'), checked: saved.before_class });
  const beforeWhen = choice(document, {
    name: 'before_minutes', label: i18n.t('notifications.beforeWhen'), values: BEFORE_CHOICES, value: saved.before_minutes,
    text: (minutes) => minutesLabel(i18n, minutes),
  });
  const after = toggle(document, { name: 'after_class', label: i18n.t('notifications.afterClass'), checked: saved.after_class });
  const afterWhen = choice(document, {
    name: 'after_minutes', label: i18n.t('notifications.afterWhen'), values: AFTER_CHOICES, value: saved.after_minutes,
    text: (minutes) => minutesLabel(i18n, minutes),
  });
  const coach = ctx.isCoach?.() ? toggle(document, { name: 'coach', label: i18n.t('notifications.coach'), checked: saved.coach }) : null;
  const quiet = toggle(document, { name: 'quiet', label: i18n.t('notifications.quiet'), checked: saved.quiet_start !== null });
  const quietFrom = choice(document, {
    name: 'quiet_start', label: i18n.t('notifications.quietFrom'), values: QUIET_HOURS, value: saved.quiet_start ?? '22:00',
    text: (hour) => hourLabel(i18n, hour),
  });
  const quietTo = choice(document, {
    name: 'quiet_end', label: i18n.t('notifications.quietTo'), values: QUIET_HOURS, value: saved.quiet_end ?? '08:00',
    text: (hour) => hourLabel(i18n, hour),
  });
  const sync = () => {
    beforeWhen.disabled = !before.input.checked;
    afterWhen.disabled = !after.input.checked;
    quietFrom.disabled = !quiet.input.checked;
    quietTo.disabled = !quiet.input.checked;
  };
  for (const input of [before.input, after.input, quiet.input]) input.addEventListener('change', sync);
  sync();

  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' }, dataset: { notificationStatus: '' } });
  const save = el(document, 'button', {
    className: 'button-primary', text: i18n.t('notifications.save'), attrs: { type: 'button' }, dataset: { action: 'save-notifications' },
  });
  save.addEventListener('click', async () => {
    save.disabled = true;
    status.textContent = '';
    try {
      saved = await services.notifications.updatePreferences({
        setup: setup.input.checked,
        before_class: before.input.checked,
        before_minutes: Number(beforeWhen.value),
        after_class: after.input.checked,
        after_minutes: Number(afterWhen.value),
        coach: coach ? coach.input.checked : saved.coach,
        quiet_start: quiet.input.checked ? quietFrom.value : null,
        quiet_end: quiet.input.checked ? quietTo.value : null,
      });
      status.textContent = i18n.t('notifications.saved');
    } catch (error) {
      status.textContent = error?.message || i18n.t('app.loadError');
    } finally {
      save.disabled = false;
    }
  });

  return el(document, 'div', { className: 'notification-preferences' }, [
    el(document, 'h3', { className: 'notification-heading', text: i18n.t('notifications.what') }),
    el(document, 'p', { className: 'muted', text: i18n.t('notifications.whatHelp') }),
    setup.row,
    el(document, 'div', { className: 'notification-pair' }, [before.row, beforeWhen]),
    el(document, 'div', { className: 'notification-pair' }, [after.row, afterWhen]),
    coach?.row ?? null,
    el(document, 'div', { className: 'notification-pair' }, [quiet.row, quietFrom, quietTo]),
    save,
    status,
  ]);
}

export async function renderNotificationSettings(ctx) {
  if (!ctx.services?.notifications) return null;
  const { document, i18n } = ctx;
  const device = deviceBox(ctx);
  device.draw(await deviceState(ctx.pushDevice ?? null).catch(() => 'unsupported'));
  return el(document, 'section', { className: 'notification-settings', attrs: { 'aria-label': i18n.t('notifications.title') } }, [
    el(document, 'h2', { className: 'section-label', text: i18n.t('notifications.title') }),
    device.box,
    await preferencesForm(ctx),
  ]);
}
```

In `src/app/screens/me.js`, import `renderNotificationSettings` from `./notification-settings.js` and put it right after the Discover settings in `renderSettings`:

```js
    await renderDiscoverSettings(ctx),
    await renderNotificationSettings(ctx),
```

Add to `en` in `src/app/dashboard-i18n.js` (after the `setup.` keys):

```js
    'notifications.title': 'Notifications',
    'notifications.device': 'This device',
    'notifications.turnOn': 'Turn on notifications',
    'notifications.on': 'On for this device',
    'notifications.turnOff': 'Turn off',
    'notifications.blocked': 'Blocked in the browser',
    'notifications.blockedHelp': 'Notifications for roda are blocked. Allow them in your browser’s site settings (on iPhone: Settings → Notifications → roda), then come back here.',
    'notifications.iosBrowser': 'Add roda to your Home Screen first',
    'notifications.iosHelp': 'On iPhone, notifications work once roda opens from your Home Screen.',
    'notifications.unsupported': 'Not supported in this browser',
    'notifications.demo': 'Notifications are off in the demo.',
    'notifications.what': 'What to send',
    'notifications.whatHelp': 'These choices apply to every device where notifications are on.',
    'notifications.setup': 'Finish setting up',
    'notifications.beforeClass': 'Before a class',
    'notifications.beforeWhen': 'How long before a class',
    'notifications.afterClass': 'After a class',
    'notifications.afterWhen': 'How long after a class ends',
    'notifications.coach': 'Coach requests',
    'notifications.quiet': 'Quiet hours',
    'notifications.quietFrom': 'Quiet from',
    'notifications.quietTo': 'Quiet until',
    'notifications.minutes': '{count} min',
    'notifications.hour': '1 hour',
    'notifications.hours': '{count} hours',
    'notifications.save': 'Save notification settings',
    'notifications.saved': 'Saved.',
```

and to `pt` (after the `setup.` keys):

```js
    'notifications.title': 'Notificações',
    'notifications.device': 'Este dispositivo',
    'notifications.turnOn': 'Ativar notificações',
    'notifications.on': 'Ativas neste dispositivo',
    'notifications.turnOff': 'Desativar',
    'notifications.blocked': 'Bloqueadas no navegador',
    'notifications.blockedHelp': 'As notificações da roda estão bloqueadas. Permite-as nas definições do site no navegador (no iPhone: Definições → Notificações → roda) e volta aqui.',
    'notifications.iosBrowser': 'Adiciona primeiro a roda ao ecrã principal',
    'notifications.iosHelp': 'No iPhone, as notificações funcionam quando abres a roda a partir do ecrã principal.',
    'notifications.unsupported': 'Não suportadas neste navegador',
    'notifications.demo': 'As notificações estão desligadas na demonstração.',
    'notifications.what': 'O que enviar',
    'notifications.whatHelp': 'Estas escolhas aplicam-se a todos os dispositivos com notificações ativas.',
    'notifications.setup': 'Terminar a configuração',
    'notifications.beforeClass': 'Antes de uma aula',
    'notifications.beforeWhen': 'Quanto tempo antes da aula',
    'notifications.afterClass': 'Depois de uma aula',
    'notifications.afterWhen': 'Quanto tempo depois de a aula acabar',
    'notifications.coach': 'Pedidos para treinadores',
    'notifications.quiet': 'Horas de silêncio',
    'notifications.quietFrom': 'Silêncio a partir das',
    'notifications.quietTo': 'Silêncio até às',
    'notifications.minutes': '{count} min',
    'notifications.hour': '1 hora',
    'notifications.hours': '{count} horas',
    'notifications.save': 'Guardar definições de notificações',
    'notifications.saved': 'Guardado.',
```

Append to `assets/app.css`:

```css
/* Settings → Notifications */
.notification-settings { margin-bottom: 18px; }
.notification-device { margin: 0 0 12px; }
.notification-heading { font-size: .95rem; font-weight: 700; line-height: 1.3; margin: 0 0 6px; }
.notification-state { margin: 0 0 8px; }
.notification-device .muted { margin: 0 0 8px; }
.notification-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; }
.notification-pair { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.notification-pair .notification-row { flex: 1 1 100%; }
.notification-pair .field-input { width: auto; flex: 1 1 140px; }
```

- [ ] **Step 4: Wire the language change and sign-out**

In `src/app/entries/app.js`, extend the `notifications.js` import to `import { forgetDevice, notificationLink, refreshSubscription } from '../notifications.js';` and change the two Settings callbacks in `meSection`:

```js
        onLocaleChange: () => {
          layout.refreshCopy();
          // The spec: the device's language is updated when the language changes.
          refreshSubscription(notificationLink(ctx)).catch(() => {});
          show(route);
        },
        onSignOut: () => signOutSafely(ctx, {
          signOut: async () => {
            // Ruling 13: the next person on this phone never gets this person's notifications.
            await forgetDevice(notificationLink(ctx));
            await services.auth.signOut();
            location.replace('/');
          },
        }),
```

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `npx vitest run tests/unit/notification-settings.test.js tests/unit/me-screen.test.js tests/unit/dashboard-i18n.test.js tests/unit/i18n-usage.test.js`
Expected: PASS. The existing `me-screen` tests pass no `services.notifications`, so the section is absent there.

- [ ] **Step 6: Write the browser tests**

```js
// tests/e2e/app-notifications.spec.js
import { expect, test } from '@playwright/test';

import { seedAccount } from './app-helpers.js';

const events = (page) => page.evaluate(() => window.__RODA_E2E_EVENTS__ ?? []);
const stored = (page, key) => page.evaluate((name) => JSON.parse(localStorage.getItem(name) ?? 'null'), key);
const section = (page) => page.getByRole('region', { name: 'Notifications' });

test('turning notifications on and off for this device saves and removes it', async ({ page, context }) => {
  await context.grantPermissions(['notifications']);
  await seedAccount(page, { extra: { 'roda.e2e.push': { support: 'supported' } } });
  await page.goto('/app#/me/settings');
  await section(page).getByRole('button', { name: 'Turn on notifications' }).click();
  await expect(section(page).getByText('On for this device', { exact: true })).toBeVisible();
  expect(await events(page)).toContainEqual(expect.objectContaining({ type: 'push-subscribe', locale: 'en', timezone: 'Europe/Lisbon' }));
  await page.reload();
  await expect(section(page).getByText('On for this device', { exact: true })).toBeVisible();
  await section(page).getByRole('button', { name: 'Turn off' }).click();
  await expect(section(page).getByRole('button', { name: 'Turn on notifications' })).toBeVisible();
  expect((await stored(page, 'roda.e2e.notificationState')).subscriptions).toEqual([]);
});

for (const [label, push, words] of [
  ['notifications are blocked', { support: 'supported', permission: 'denied' }, 'Blocked in the browser'],
  ['an iPhone runs roda in Safari', { support: 'ios-browser' }, 'Add roda to your Home Screen first'],
  ['the browser has no notifications', { support: 'unsupported' }, 'Not supported in this browser'],
]) {
  test(`Settings explains what to do when ${label}`, async ({ page }) => {
    await seedAccount(page, { extra: { 'roda.e2e.push': push } });
    await page.goto('/app#/me/settings');
    await expect(section(page).getByText(words, { exact: true })).toBeVisible();
    await expect(section(page).getByRole('button', { name: 'Turn on notifications' })).toHaveCount(0);
    if (push.support === 'ios-browser') {
      await expect(section(page).getByRole('link', { name: 'Show me how' })).toHaveAttribute('href', '/install');
    }
  });
}

test('what to send is saved to the account and comes back', async ({ page }) => {
  await seedAccount(page, { coachProfile: { profile_id: 'practitioner-1' } });
  await page.goto('/app#/me/settings');
  const notifications = section(page);
  await notifications.getByLabel('After a class', { exact: true }).uncheck();
  await notifications.getByLabel('How long before a class').selectOption('30');
  await notifications.getByLabel('Quiet from').selectOption('23:00');
  await notifications.getByLabel('Quiet until').selectOption('07:00');
  await notifications.getByLabel('Coach requests').uncheck();
  await notifications.getByRole('button', { name: 'Save notification settings' }).click();
  await expect(notifications.getByText('Saved.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(notifications.getByLabel('After a class', { exact: true })).not.toBeChecked();
  await expect(notifications.getByLabel('How long before a class')).toHaveValue('30');
  await expect(notifications.getByLabel('Quiet from')).toHaveValue('23:00');
  await expect(notifications.getByLabel('Quiet until')).toHaveValue('07:00');
  await expect(notifications.getByLabel('Coach requests')).not.toBeChecked();
});

test('Coach requests are offered only to people who coach', async ({ page }) => {
  await seedAccount(page);
  await page.goto('/app#/me/settings');
  await expect(section(page).getByLabel('Before a class', { exact: true })).toBeChecked();
  await expect(section(page).getByLabel('Coach requests')).toHaveCount(0);
});

test('signing out turns this device off, so the next person on the phone gets nothing', async ({ page, context }) => {
  await context.grantPermissions(['notifications']);
  await seedAccount(page, { extra: { 'roda.e2e.push': { support: 'supported' } } });
  await page.goto('/app#/me/settings');
  await section(page).getByRole('button', { name: 'Turn on notifications' }).click();
  await expect(section(page).getByText('On for this device', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect((await stored(page, 'roda.e2e.push')).subscribed).toBe(false);
  expect((await stored(page, 'roda.e2e.notificationState')).subscriptions).toEqual([]);
});
```

- [ ] **Step 7: Run the browser tests**

Run: `npm run build:test && npx playwright test tests/e2e/app-notifications.spec.js tests/e2e/app-shell.spec.js tests/e2e/app-me-pages.spec.js`
Expected: PASS in both projects.

- [ ] **Step 8: Run the suites**

Run: `npm run test:unit && npm run test:e2e`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/screens/notification-settings.js src/app/screens/me.js src/app/entries/app.js src/app/dashboard-i18n.js assets/app.css tests/unit/notification-settings.test.js tests/e2e/app-notifications.spec.js
git commit -m "feat: choose notifications in Settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: "Turn on reminders" on Today

**Files:**
- Create: `src/app/screens/reminders-card.js`
- Modify: `src/app/screens/today.js`, `src/app/entries/app.js`, `src/app/dashboard-i18n.js`, `assets/app.css`, `tests/e2e/app-notifications.spec.js`
- Test: `tests/unit/reminders-card.test.js`, `tests/unit/today-screen.test.js`

**Interfaces:**
- Consumes (Task 8): `ctx.pushDevice`, `turnOn`, `notificationLink`.
- Produces: `remindersCardWanted({ device, storage }) → boolean` and `renderRemindersCard({ document, i18n, storage, device, onTurnOn }) → HTMLElement|null`, a `<section class="card reminders-card" aria-label="Turn on reminders">` with `[data-action="turn-on-reminders"]` and `[data-action="reminders-later"]`. The answer is stored as `localStorage['roda.reminders.answered'] = '1'`. Also `ctx.remindersCard() → HTMLElement|null`, and the Today slot order: reminders, checklist, install hint (Ruling 17).

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/reminders-card.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { remindersCardWanted, renderRemindersCard } from '../../src/app/screens/reminders-card.js';
import { fakeDevice } from './helpers/fake-push-device.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

function memory() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

describe('reminders card', () => {
  beforeEach(() => { document.body.replaceChildren(); });

  it('appears only where notifications can be turned on and this device was never asked', () => {
    const storage = memory();
    expect(remindersCardWanted({ device: fakeDevice(), storage })).toBe(true);
    expect(remindersCardWanted({ device: null, storage })).toBe(false);
    expect(remindersCardWanted({ device: fakeDevice({ support: 'ios-browser' }), storage })).toBe(false);
    expect(remindersCardWanted({ device: fakeDevice({ support: 'unsupported' }), storage })).toBe(false);
    expect(remindersCardWanted({ device: fakeDevice({ permission: 'granted' }), storage })).toBe(false);
    expect(remindersCardWanted({ device: fakeDevice({ permission: 'denied' }), storage })).toBe(false);
    storage.setItem('roda.reminders.answered', '1');
    expect(remindersCardWanted({ device: fakeDevice(), storage })).toBe(false);
    expect(remindersCardWanted({ device: fakeDevice(), storage: { getItem: () => { throw new Error('blocked'); } } })).toBe(false);
  });

  it('remembers Not now on this device', () => {
    const storage = memory();
    const card = renderRemindersCard({ document, i18n, storage, device: fakeDevice(), onTurnOn: vi.fn() });
    document.body.append(card);
    expect(card.getAttribute('aria-label')).toBe('Turn on reminders');
    expect(card.textContent).toContain('Get a nudge before class and a reminder to add the video after.');
    card.querySelector('[data-action="reminders-later"]').click();
    expect(document.querySelector('.reminders-card')).toBeNull();
    expect(storage.getItem('roda.reminders.answered')).toBe('1');
  });

  it('turns notifications on and goes away', async () => {
    const storage = memory();
    const onTurnOn = vi.fn().mockResolvedValue('on');
    document.body.append(renderRemindersCard({ document, i18n, storage, device: fakeDevice(), onTurnOn }));
    document.querySelector('[data-action="turn-on-reminders"]').click();
    await vi.waitFor(() => expect(document.querySelector('.reminders-card')).toBeNull());
    expect(onTurnOn).toHaveBeenCalledTimes(1);
    expect(storage.getItem('roda.reminders.answered')).toBe('1');
  });

  it('says what went wrong and lets the person try again', async () => {
    const onTurnOn = vi.fn().mockRejectedValue(new Error('The network request failed. Please try again.'));
    document.body.append(renderRemindersCard({ document, i18n, storage: memory(), device: fakeDevice(), onTurnOn }));
    document.querySelector('[data-action="turn-on-reminders"]').click();
    await vi.waitFor(() => expect(document.querySelector('.reminders-card [role="status"]').textContent)
      .toBe('The network request failed. Please try again.'));
    expect(document.querySelector('[data-action="turn-on-reminders"]').disabled).toBe(false);
  });

  it('is not built when it is not wanted', () => {
    expect(renderRemindersCard({ document, i18n, storage: memory(), device: null, onTurnOn: vi.fn() })).toBeNull();
  });
});
```

Append to `tests/unit/today-screen.test.js`, inside `describe('today screen', …)`:

```js
  it('fills the setup slot with one card: reminders first, the install hint last', async () => {
    const training = { listMyCalendar: vi.fn().mockResolvedValue([]), listRecentTrainings: vi.fn().mockResolvedValue([]) };
    const card = (className) => Object.assign(document.createElement('section'), { className });
    const view = await renderToday({ ...ctx(training), remindersCard: () => card('reminders-card'), installHint: () => card('install-hint') });
    await vi.waitFor(() => expect(view.querySelector('.reminders-card')).not.toBeNull());
    expect(view.querySelector('.install-hint')).toBeNull();
    const later = await renderToday({ ...ctx(training), remindersCard: () => null, installHint: () => card('install-hint') });
    await vi.waitFor(() => expect(later.querySelector('.install-hint')).not.toBeNull());
    expect(later.querySelector('.reminders-card')).toBeNull();
  });
```

(`ctx()` in this file has no `services.discover`, so the checklist is `null` and the slot falls through to the next card.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/reminders-card.test.js tests/unit/today-screen.test.js`
Expected: FAIL: `reminders-card.js` does not exist, and Today shows the install hint instead of the reminders card.

- [ ] **Step 3: Implement**

```js
// src/app/screens/reminders-card.js
// "Turn on reminders" on Today: asked once per device, and only where
// notifications can really be turned on (Ruling 17).
import { el } from '../shell/page.js';

const ANSWERED = 'roda.reminders.answered';

function answered(storage) {
  try {
    return storage?.getItem(ANSWERED) === '1';
  } catch {
    // Unreadable storage: do not risk asking on every visit.
    return true;
  }
}

function remember(storage) {
  try {
    storage?.setItem(ANSWERED, '1');
  } catch {
    // Blocked storage: the card may come back next time.
  }
}

export function remindersCardWanted({ device, storage }) {
  if (!device || device.support() !== 'supported' || device.permission() !== 'default') return false;
  return !answered(storage);
}

export function renderRemindersCard({ document, i18n, storage, device, onTurnOn }) {
  if (!remindersCardWanted({ device, storage })) return null;
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  const turnOnButton = el(document, 'button', {
    className: 'button-primary', text: i18n.t('reminders.turnOn'), attrs: { type: 'button' }, dataset: { action: 'turn-on-reminders' },
  });
  const later = el(document, 'button', {
    className: 'quiet-button', text: i18n.t('reminders.notNow'), attrs: { type: 'button' }, dataset: { action: 'reminders-later' },
  });
  const card = el(document, 'section', { className: 'card reminders-card', attrs: { 'aria-label': i18n.t('reminders.title') } }, [
    el(document, 'h2', { className: 'install-title', text: i18n.t('reminders.title') }),
    el(document, 'p', { text: i18n.t('reminders.body') }),
    el(document, 'div', { className: 'install-actions' }, [turnOnButton, later]),
    status,
  ]);
  turnOnButton.addEventListener('click', async () => {
    remember(storage);
    turnOnButton.disabled = true;
    status.textContent = '';
    try {
      await onTurnOn();
      card.remove();
    } catch (error) {
      status.textContent = error?.message || i18n.t('app.loadError');
      turnOnButton.disabled = false;
    }
  });
  later.addEventListener('click', () => {
    remember(storage);
    card.remove();
  });
  return card;
}
```

In `src/app/screens/today.js`, replace the slot comment and the line that picks the card:

```js
  // One card fills this slot when its data arrives, so Today never waits for it
  // (Ruling 17 of the notifications plan): "Turn on reminders", then
  // "Finish setting up", then the install hint.
```

```js
    const card = ctx.remindersCard?.() ?? checklist ?? ctx.installHint?.() ?? null;
```

In `src/app/entries/app.js`, import `renderRemindersCard` from `../screens/reminders-card.js`, extend the `notifications.js` import with `turnOn`, and add to `ctx` after `installHint`:

```js
    remindersCard: () => renderRemindersCard({
      document, i18n, storage: localStorage, device: pushDevice,
      onTurnOn: () => turnOn(notificationLink(ctx)),
    }),
```

Add to `en` in `src/app/dashboard-i18n.js` (after the `notifications.` keys):

```js
    'reminders.title': 'Turn on reminders',
    'reminders.body': 'Get a nudge before class and a reminder to add the video after.',
    'reminders.turnOn': 'Turn on',
    'reminders.notNow': 'Not now',
```

and to `pt`:

```js
    'reminders.title': 'Ativa os lembretes',
    'reminders.body': 'Recebe um aviso antes da aula e um lembrete para adicionares o vídeo depois.',
    'reminders.turnOn': 'Ativar',
    'reminders.notNow': 'Agora não',
```

Append to `assets/app.css`:

```css
/* "Turn on reminders" on Today */
.reminders-card { margin: 0 0 14px; border-color: var(--gold); }
.reminders-card p { margin: 0 0 8px; color: var(--sand); }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/reminders-card.test.js tests/unit/today-screen.test.js tests/unit/i18n-usage.test.js tests/unit/dashboard-i18n.test.js`
Expected: PASS.

- [ ] **Step 5: Add the browser tests**

Append to `tests/e2e/app-notifications.spec.js`:

```js
test('Today offers reminders once, and Turn on subscribes this device', async ({ page }) => {
  await seedAccount(page, { extra: { 'roda.e2e.push': { support: 'supported', permission: 'default', answer: 'granted' } } });
  await page.goto('/app');
  const card = page.getByRole('region', { name: 'Turn on reminders' });
  await expect(card).toBeVisible();
  await expect(page.getByRole('region', { name: 'Finish setting up' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Turn on' }).click();
  await expect(card).toBeHidden();
  expect(await events(page)).toContainEqual(expect.objectContaining({ type: 'push-subscribe', locale: 'en' }));
  await page.reload();
  await expect(page.locator('.week-day').first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Finish setting up' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Turn on reminders' })).toHaveCount(0);
});

test('Not now on the reminders card is remembered on this device', async ({ page }) => {
  await seedAccount(page, { extra: { 'roda.e2e.push': { support: 'supported', permission: 'default' } } });
  await page.goto('/app');
  const card = page.getByRole('region', { name: 'Turn on reminders' });
  await card.getByRole('button', { name: 'Not now' }).click();
  await expect(card).toBeHidden();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Finish setting up' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Turn on reminders' })).toHaveCount(0);
});
```

- [ ] **Step 6: Run the browser tests**

Run: `npm run build:test && npx playwright test tests/e2e/app-notifications.spec.js tests/e2e/app-install.spec.js tests/e2e/app-today.spec.js`
Expected: PASS in both projects. `app-install.spec.js` still sees the checklist, then the install card, because its iPhone account sets no `roda.e2e.push`.

- [ ] **Step 7: Run the suites**

Run: `npm run test:unit && npm run test:e2e`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/screens/reminders-card.js src/app/screens/today.js src/app/entries/app.js src/app/dashboard-i18n.js assets/app.css tests/unit/reminders-card.test.js tests/unit/today-screen.test.js tests/e2e/app-notifications.spec.js
git commit -m "feat: offer reminders once on Today

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Runbook, checklist, README, and final verification

**Files:**
- Modify: `docs/auth-and-database-operations.md`, `docs/security-checklist.md`, `README.md`
- Test: `tests/unit/release-scan.test.js` (unchanged; it reads the scan pattern from the checklist)

**Interfaces:**
- Consumes: everything above.
- Produces: documentation only. The release scan pattern in both documents becomes `service_role|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|sb_publishable_e2e_test|VAPID_PRIVATE_KEY|NOTIFICATIONS_CRON_SECRET`.

- [ ] **Step 1: Security checklist**

In `docs/security-checklist.md`:

1. Under "Browser and secret boundary", replace the first item with:

```markdown
- [ ] The production build contains only the exact Supabase project URL, the
  `sb_publishable_...` key, and the VAPID public key (`RODA_VAPID_PUBLIC_KEY`).
- [ ] The VAPID private key and the notifications cron secret exist only in
  Supabase function secrets and Vault; never in Vercel, git, chat, or logs.
```

2. Under "Database and API authorization", add after the security-definer item:

```markdown
- [ ] `claim_due_notifications` and `report_notification_results` are executable
  only by `service_role`; `send-notifications` answers 401 without the
  `x-roda-cron-secret` header, and the cron job reads that secret from Vault.
- [ ] Push endpoints are limited to the known push services (FCM, Mozilla,
  Apple, Windows) both when a device is saved and when the sender posts.
```

3. Under "Product privacy and behavior", add at the end:

```markdown
- [ ] Notifications follow each person's kinds, timings, and quiet hours in
  their own time zone; a class hidden from students never notifies them; a
  notification only opens a screen under `/app`; signing out turns the device
  off so the next person on a shared phone receives nothing.
```

4. In "Release evidence commands", change the scan command to:

```bash
rg -n "service_role|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|sb_publishable_e2e_test|VAPID_PRIVATE_KEY|NOTIFICATIONS_CRON_SECRET" assets/generated
```

- [ ] **Step 2: Operations runbook**

In `docs/auth-and-database-operations.md`:

1. In the deployment table, add a row after the Postgres row:

```markdown
| Phone notifications sender (Edge Function, pg_cron, Vault) | Supabase | Code yes; secrets and the cron job no |
```

2. In "Values and secrets", add `RODA_VAPID_PUBLIC_KEY=B...` to the list of public values, add "the VAPID private key and the notifications cron secret" to the never-commit list, and replace the paragraph "roda.fyi currently needs no Supabase secret/service-role key. If privileged server code is added later, it belongs only in that server's secret store." with:

```markdown
The only privileged server code is the `send-notifications` Edge Function. It
uses the secret key Supabase injects into Edge Functions (`SUPABASE_SECRET_KEYS`)
and needs no key copied anywhere. Its own secrets (`VAPID_PRIVATE_KEY`,
`NOTIFICATIONS_CRON_SECRET`) live only in Supabase function secrets and Vault.
```

3. In "Vercel build configuration", add `RODA_VAPID_PUBLIC_KEY` under the two existing names, and add: "The build fails without it, so set it before merging a branch that requires it."
4. In "Preview and production rollout" step 6, change the scan command to the new pattern from Step 1.
5. Add this section before "## Rotation and incident response", with the full text of **Owner rollout** below (steps 1–9) under the heading `## Phone notifications (2026-11)`, preceded by this paragraph:

```markdown
Every minute, `pg_cron` calls the `send-notifications` Edge Function through
`pg_net`, with the function URL and a shared secret read from Vault. The
function claims what is due (`claim_due_notifications`), sends Web Push
messages signed with the VAPID key, and reports the results
(`report_notification_results`). Nothing in git starts the job or holds a
secret; the steps below are done once by an owner, in order.
```

- [ ] **Step 3: README**

In `README.md`, at the end of the `### The app (`/app`)` subsection, add:

```markdown
Phone notifications are turned on per device in Me → Settings → Notifications
(on iPhone, once roda runs from the home screen). People choose which kinds
they get (Finish setting up, Before a class, After a class, Coach requests),
when, and their quiet hours. A Supabase Edge Function sends them every minute;
see "Phone notifications" in `docs/auth-and-database-operations.md`.
```

- [ ] **Step 4: Final verification**

Run:

```bash
npm run test:unit
npm run test:e2e
npm run test:db
npm run build:test
git diff --check
git status --short
```

Expected: every suite passes; `git diff --check` prints nothing; `git status --short` shows only the three documents (or nothing after the commit below). A production build (`npm run build`) needs `RODA_VAPID_PUBLIC_KEY` in `.env.local`. With it set, `rg -n "service_role|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|sb_publishable_e2e_test|VAPID_PRIVATE_KEY|NOTIFICATIONS_CRON_SECRET" assets/generated` prints nothing. Then run `npm run build:test` again so the browser-test bundles are restored.

- [ ] **Step 5: Commit**

```bash
git add docs/auth-and-database-operations.md docs/security-checklist.md README.md
git commit -m "docs: phone notifications runbook and launch checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Owner rollout

Only the owner runs these steps, in this order (Ruling 20), against the production project. Nothing here is part of a task. Run them from a checkout of this branch, linked once with `npx supabase link --project-ref "$RODA_SUPABASE_PROJECT_REF"`. Never paste a secret into chat or commit it.

**1. Generate the VAPID key pair and the cron secret** (once; store all three values in the password manager):

```bash
node -e "(async()=>{const s=globalThis.crypto.subtle;const k=await s.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);console.log('VAPID_PUBLIC_KEY='+Buffer.from(await s.exportKey('raw',k.publicKey)).toString('base64url'));console.log('VAPID_PRIVATE_KEY='+(await s.exportKey('jwk',k.privateKey)).d)})()"
node -e "console.log('NOTIFICATIONS_CRON_SECRET='+require('node:crypto').randomBytes(32).toString('base64url'))"
```

The public key is 87 characters and starts with `B`; the private key is 43 characters.

**2. Set the public key on Vercel, before merging.** In Vercel → Project → Settings → Environment Variables, add `RODA_VAPID_PUBLIC_KEY` with the public key for **Production** and the intended **Preview** environments. Add the same line to your ignored `.env.local`. If this step is skipped, the merged build fails and the live site stays on the previous deploy.

**3. Apply the migrations:**

```bash
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
```

The dry run must list exactly `202611010001_notifications.sql`, `202611010002_notification_claims.sql`, and `202611010003_notification_results.sql`. Afterwards, open Supabase → Advisors → Security and confirm there is no new unexplained finding.

**4. Set the function secrets** from a file outside the repository, then delete it:

```bash
umask 077
printf '%s\n' \
  'VAPID_PUBLIC_KEY=PASTE_PUBLIC_KEY' \
  'VAPID_PRIVATE_KEY=PASTE_PRIVATE_KEY' \
  'VAPID_SUBJECT=mailto:support@roda.fyi' \
  'NOTIFICATIONS_CRON_SECRET=PASTE_CRON_SECRET' > ~/roda-notifications.env
"${EDITOR:-nano}" ~/roda-notifications.env   # replace the three PASTE_ values
npx supabase secrets set --env-file ~/roda-notifications.env
npx supabase secrets list                    # shows the four names
rm ~/roda-notifications.env
```

**5. Deploy the function and check that it refuses strangers:**

```bash
npx supabase functions deploy send-notifications --no-verify-jwt
curl -s -o /dev/null -w '%{http_code}\n' -X POST "https://$RODA_SUPABASE_PROJECT_REF.supabase.co/functions/v1/send-notifications"
read -rs NOTIFICATIONS_CRON_SECRET   # paste the cron secret; nothing is echoed or kept in history
curl -s -X POST -H "x-roda-cron-secret: $NOTIFICATIONS_CRON_SECRET" "https://$RODA_SUPABASE_PROJECT_REF.supabase.co/functions/v1/send-notifications"
unset NOTIFICATIONS_CRON_SECRET
```

Expected: `401`, then `{"deliveries":0,"sent":0,"gone":0,"failed":0}`. A `500` means a secret is missing or malformed; check the function's logs in the dashboard.

**6. Store the Vault secrets and schedule the job.** In Supabase → SQL Editor (production project), replace `PROJECT_REF` and `PASTE_CRON_SECRET`, then run:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://PROJECT_REF.supabase.co/functions/v1/send-notifications', 'notifications_sender_url');
select vault.create_secret('PASTE_CRON_SECRET', 'notifications_cron_secret');

select cron.schedule(
  'send-notifications',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'notifications_sender_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-roda-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notifications_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) as request_id;
  $$
);
```

After two minutes, check it:

```sql
select jobid, schedule, active from cron.job where jobname = 'send-notifications';
select status, return_message, start_time
  from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'send-notifications')
 order by start_time desc limit 3;
select status_code, content::text, created from net._http_response order by created desc limit 3;
```

Expected: `active = true`, recent runs `succeeded`, and responses `200` with the JSON totals.

**7. Deploy the app.** Merge the branch to `main`; Vercel builds with `RODA_VAPID_PUBLIC_KEY`. Open `https://roda.fyi/app` and check that Me → Settings shows Notifications.

**8. Test send to the owner's iPhone.** Open roda from the Home Screen → Me → Settings → Notifications → Turn on notifications → Allow. Then, in the SQL Editor, replace `YOUR_EMAIL` and run:

```sql
-- A pending delivery claimed 16 minutes ago is retried by the next run (Ruling 9).
insert into public.notification_deliveries (profile_id, kind, subject_key, due_at, payload, claimed_at, attempts)
select profile.id, 'setup', 'test:' || to_char(now(), 'YYYYMMDDHH24MISS'), now(),
       '{"url": "/app#/", "round": 1, "zone": "UTC"}'::jsonb, now() - interval '16 minutes', 1
  from auth.users account
  join public.profiles profile on profile.id = account.id
 where account.email = 'YOUR_EMAIL';
```

Within a minute the phone shows "Finish setting up roda", or the Portuguese text if the app language is Portuguese. Tapping it opens Today in the installed app. Confirm the delivery, then remove it, because it would otherwise count as one of the three setup rounds:

```sql
select subject_key, status, attempts, sent_at from public.notification_deliveries where subject_key like 'test:%';
delete from public.notification_deliveries where subject_key like 'test:%';
```

Expected: `status = 'sent'`. If it says `pending`, read `net._http_response` and the function logs. If the logs show the push library failing, see Ruling 1 for the one-function fallback.

**9. Roll back, or rotate.**

- Stop all sending at once, leaving data and the app untouched: `select cron.unschedule('send-notifications');`
- Remove the sender completely: run the step above, then `npx supabase functions delete send-notifications`, `npx supabase secrets unset VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT NOTIFICATIONS_CRON_SECRET`, and in SQL `delete from vault.secrets where name in ('notifications_sender_url', 'notifications_cron_secret');`. People can still turn notifications on in the app; nothing is sent.
- Database changes roll back only through a new forward migration; never reset production.
- Rotate the cron secret: generate a new one (step 1). Run `npx supabase secrets set NOTIFICATIONS_CRON_SECRET=…` from a file as in step 4. Then run `select vault.update_secret((select id from vault.secrets where name = 'notifications_cron_secret'), 'NEW_SECRET');`. Runs in the minute between the two changes get 401 and are harmless.
- Rotate the VAPID keys only after a private-key leak. Every device must turn notifications on again, because push services reject the old subscriptions with 403 or 410. Set the new public key on Vercel, set the new function secrets, then redeploy the app.
