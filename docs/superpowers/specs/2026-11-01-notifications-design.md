# Notifications

Phone notifications for roda, sent from Supabase, configurable by each person.

## Purpose

roda is a web app installed from the browser (see `docs/superpowers/specs/2026-10-11-mobile-first-app-design.md`
and `/install`). People forget to rate a class, add its video, finish a class they taught, or finish
setting up their profile. Notifications bring them back at the right moment. Decisions from the
2026-11-01 design session with the product owner:

- **Phone notifications only** (Web Push). No email. On iPhone they work only once roda is on the
  home screen (iOS 16.4 or later); on Android and desktop Chrome/Edge they work from the browser too.
- **All four kinds** in the first version: Finish setting up, After a class, Before a class, Coach requests.
- **Sending runs inside Supabase** (option A): a scheduled job every minute runs an Edge Function
  that sends what is due. Free tier is enough at this size.
- **Defaults** (approved): before a class 1 hour; after a class 1 hour after it ends, only if it still
  has no rating or video; Finish setting up 2 days after sign-up, then at most weekly, at most 3 times;
  coach requests right away; nothing from 22:00 to 08:00 in the person's own time zone.
- **Configurable** (owner, 2026-11-01): each kind on or off, the before- and after-class timings, and
  the quiet hours.

## Scope

Included: the four kinds below, device subscription and unsubscription, Settings → Notifications,
a one-time "Turn on reminders" card on Today, tapping a notification opens the right screen, the
scheduled sender, delivery log, cleanup of dead subscriptions.

Deferred: email, native apps (Capacitor), per-group mute, digests. Portuguese copy for people whose
app language is Portuguese is included (see Copy).

## Notification kinds

| Kind | Who gets it | When | Opens |
|------|-------------|------|-------|
| `setup` | A person whose setup checklist is incomplete: no city, or no active group and no active coaching connection, or no training yet | 2 days after `completed_at`, then at most every 7 days, at most 3 in total; stops as soon as setup is complete | `/app#/` (Today shows the checklist) |
| `before_class` | Students who will see the class (active members of the group for a group class, if `visible_in_advance`; the student of a personal class) and the coach who arranged it | `lead` minutes before `starts_at` (default 60); skipped if that moment falls in quiet hours or is already past | `/app#/class/<id>` for the coach, `/app#/calendar/<yyyy-mm-dd>` for students |
| `after_class` | Each attendee of a finished group or personal class (not the coach, not Alone trainings they logged themselves) whose participation has no felt rating **and** whose class has no video resource | `delay` minutes after the class ended (default 60); deferred to the end of quiet hours | `/app#/training/<occurrence-id>` |
| `coach` | Coaches: a new join request for a group they coach; a student asking them to coach; a class they arranged that ended 30 minutes ago and is not finished | Right away (within a minute); deferred to the end of quiet hours | the group page, Teaching, or `/app#/class/<id>` |

Each notification is sent at most once per person, kind, and subject (the class, request, or setup
round), recorded in a delivery log.

## Copy

Short, American English, with Portuguese versions chosen by the person's app language (stored on the
subscription when the device subscribes, updated when the language changes):

- setup: "Finish setting up roda" / "Add your city and your group so classes find you."
- before_class: "Class in 1 hour" (or the configured lead) / "Group class · Grupo Lua at 7:00 PM"
- after_class: "How did today's class go?" / "Rate it and add the video while it's fresh."
- coach: "New join request" / "Bia Santos wants to join Grupo Lua." — "Bia Santos asked you to coach them." — "Finish today's class" / "Mark who came to Group class · Grupo Lua."

Times in notification text use the person's own time zone.

## Settings → Notifications

- **This device**: one button whose label follows the state — "Turn on notifications" (asks the
  browser), "On for this device" (with Turn off), "Blocked in the browser" (explains how to allow it),
  "Add roda to your Home Screen first" on an iPhone that isn't running it from the home screen (links
  `/install`), "Not supported in this browser".
- **What to send** (saved to the account, apply to every device):
  - Finish setting up — on/off.
  - Before a class — on/off, and when: 15 min, 30 min, 1 hour, 2 hours (default 1 hour).
  - After a class — on/off, and when: 30 min, 1 hour, 2 hours after it ends (default 1 hour).
  - Coach requests — on/off (shown only to people who coach).
  - Quiet hours — from / to (default 22:00–08:00), or off.
- Everything is on by default; nothing is sent until a device is turned on.

## Today card

Once, when roda runs from the home screen (or in a browser that supports notifications) and this
device has never been asked: "Turn on reminders — Get a nudge before class and a reminder to add the
video after." with Turn on and Not now. Not now is remembered per device.

## Architecture

- **Client**: the service worker (`src/app/sw/service-worker.js`) gains `push` (show the notification)
  and `notificationclick` (focus or open `/app` at the notification's URL). A `notifications` module
  subscribes with the VAPID public key (a public build value, like the Supabase URL) and saves the
  subscription through an RPC; turning off unsubscribes and deletes it.
- **Database** (new migration; RLS on every table; clients never write tables directly):
  - `push_subscriptions(id, profile_id, endpoint unique, p256dh, auth, locale, created_at, last_sent_at, failures)`.
  - `notification_preferences(profile_id pk, setup, before_class, before_minutes, after_class, after_minutes, coach, quiet_start, quiet_end, updated_at)` with checks on the allowed values; a missing row means the defaults.
  - `notification_deliveries(id, profile_id, kind, subject_key, due_at, sent_at, status)` with `unique(profile_id, kind, subject_key)`.
  - Public RPCs for the signed-in person: `save_push_subscription`, `delete_push_subscription`,
    `get_notification_preferences`, `update_notification_preferences`.
  - Service-role-only functions: `claim_due_notifications(now, limit)` (computes what is due for all
    kinds, honoring preferences and quiet hours, inserts `pending` deliveries so nothing is claimed
    twice, and returns each with its devices and copy fields) and `report_notification_results(results)`
    (marks sent or failed, removes subscriptions that answered 404/410).
- **Sender**: Edge Function `send-notifications` (Deno). Called every minute by `pg_cron` through
  `pg_net` with a shared secret header; rejects calls without it. It claims due notifications, sends
  each with Web Push (VAPID keys from function secrets), and reports results. Small batches; a crash
  leaves claimed rows `pending`, retried after 15 minutes.
- **Secrets**: VAPID private key and the cron secret live only in Supabase (function secrets and Vault);
  the VAPID public key is a public build value. The service-role key is never sent to browsers.

## Testing

- Database (pgTAP): who is due for each kind and when; preferences and quiet hours; at-most-once per
  subject; RLS (people see only their own subscriptions, preferences, deliveries); service-role-only
  functions refused to `authenticated` and `anon`; subscription cleanup.
- Unit: settings states and saving; the Today card rules; the service worker's push and click handlers
  (harness from `tests/unit/helpers/worker-harness.js`); the Edge Function's send-and-report loop with a
  fake push sender.
- Browser: turning notifications on in Chromium (permission granted by Playwright) saves a subscription
  in the fake services; settings round-trip; the Today card appears once.
- Manual: one real notification on the owner's iPhone from the home-screen app.

## Rollout

1. Apply the migration (`npx supabase db push`).
2. Generate VAPID keys; set the public key as a build variable on Vercel and the private key plus a cron
   secret as Supabase function secrets.
3. Deploy the Edge Function; schedule the `pg_cron` job.
4. Deploy the app; turn on notifications on a phone and send a test.

## Acceptance

1. A person can turn notifications on and off per device and choose kinds, timings, and quiet hours.
2. Each kind arrives at its configured time, never twice, never in quiet hours, and only to people it
   is meant for.
3. Tapping a notification opens the right screen in the installed app.
4. Unit, browser, and database suites pass; one real notification reaches the owner's iPhone.
