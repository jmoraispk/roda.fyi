# Authentication and Database Operations

This runbook explains how roda.fyi authentication, database changes, and
deployment fit together. It deliberately separates public browser
configuration from privileged credentials.

## Current deployment boundary

| Concern | Owner | Repository-driven? |
|---|---|---|
| Static site, callback, the app at /app, service worker, browser bundles | Vercel | Yes, from GitHub |
| User registration, Google/email sign-in, sessions | Supabase Auth | Code yes; provider settings no |
| Application data and authorization | Supabase Postgres + RLS | Yes, through migrations |
| Profile/group pictures | Supabase Storage + RLS | Yes, through migrations |
| Google OAuth client and consent screen | Google Auth Platform | No |
| Passwordless-email delivery | External SMTP through Supabase | No |

The public movement library remains available without an account. Every
signed-in account is a practitioner. Choosing Both or Teach in the app adds
coaching to the same profile; it does not create another user.

`https://roda.fyi` was rechecked on 2026-09-14 and responds directly from
Vercel without redirecting to a different host. It is therefore the canonical
production origin unless the domain configuration intentionally changes.

## Hosted security baseline

The linked hosted project was rechecked on 2026-09-22 after applying the
tracked migration chain:

- the hosted migration history is up to date and the tracked schema has no
  drift across `public`, `private`, and `storage`;
- database SSL enforcement is enabled;
- anonymous group discovery succeeds through `public.search_groups`, while
  anonymous direct profile access is rejected;
- Supabase Security Advisor reports four informational
  `rls_enabled_no_policy` findings: `coach_student_connections`,
  `group_discovery_links`, `group_member_invitations`, and
  `group_relationships`, plus the compromised-password-protection warning.

Those four informational findings are intentional. The tables have RLS
enabled, no direct client table grants, and no policies because access is
mediated by the checked RPC/projection boundary. Do not add a broad policy
merely to silence the advisor. A future migration that intentionally
introduces direct reads must add a narrowly tested policy and update this
exception list.

The compromised-password warning does not affect the current Google and
passwordless-email flows because roda.fyi does not offer password sign-in.
Enable leaked-password protection before adding password authentication.

SSL enforcement applies to direct Postgres and pooler connections. HTTP APIs
already require TLS. Any future server-side database client must explicitly
use SSL (preferably full certificate verification) before it is deployed.

## Values and secrets

Only these public values may be embedded in browser JavaScript:

```text
RODA_SUPABASE_URL=https://PROJECT_REF.supabase.co
RODA_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

The publishable key identifies a browser client; it is not an authorization
boundary. Database grants, RPC checks, and RLS must remain correct even when a
visitor can read and reuse that key.

Never commit, paste into chat, or include in a browser build:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- a Supabase secret/service-role key
- a Google OAuth client secret
- SMTP credentials

roda.fyi currently needs no Supabase secret/service-role key. If privileged
server code is added later, it belongs only in that server's secret store.

## Exact Auth URL configuration

In **Supabase → Authentication → URL Configuration**, set:

```text
Site URL
https://roda.fyi

Redirect URLs
https://roda.fyi/auth/callback
http://127.0.0.1:8137/auth/callback
http://localhost:*/auth/callback
```

Keep the production and fixed local callbacks exact. The narrow
`localhost:*` development wildcard is required because Codex previews use an
ephemeral port; the callback path remains fixed at `/auth/callback`. Do not add
`/**`, production-host wildcards, Vercel preview wildcards, or a second
production hostname. Add any other preview callback only when its environment
and data-isolation policy have been approved.

The application uses PKCE. It captures a safe relative return route, exchanges
the code at `/auth/callback`, and removes callback, invitation, and discovery
tokens from the visible URL after capture.

## Google: primary sign-in

1. In Google Auth Platform, configure Branding and Audience for roda.fyi.
2. Under Data Access, allow only `openid`, email, and profile. Do not request
   Drive, Calendar, offline access, or a Google refresh token.
3. Create an OAuth client of type **Web application**.
4. Set authorized JavaScript origins to:

   ```text
   https://roda.fyi
   http://127.0.0.1:8137
   ```

5. Copy the exact hosted callback shown in **Supabase → Authentication →
   Providers → Google** into Google's **Authorized redirect URIs**. It normally
   has this form, but the dashboard value is authoritative:

   ```text
   https://PROJECT_REF.supabase.co/auth/v1/callback
   ```

6. Enter the Google client ID and secret directly in Supabase's Google
   provider form, enable the provider, and save.

The client secret never belongs in `.env.local` for this static app. Google
brand verification can take time, so start it before public launch. See
[Supabase's Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google).

Supabase automatically links non-SSO identities that share the same verified,
unique email. Test Google-first then email-link, and email-link then Google,
with a disposable address before launch. Never implement an application-level
merge based only on equal email strings. See
[Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking).

## Email link: secondary sign-in

Keep email-link signup enabled so the single **Sign in** entry can offer a
secondary address field. Until custom SMTP is configured, treat this option as
setup/testing-only: Supabase's built-in sender is best-effort, restricted to
project-team addresses, and heavily rate-limited.

Before public launch:

1. Choose an SMTP provider and verify a roda.fyi sender domain.
2. Enter SMTP host, port, user, password, sender address, and sender name in
   **Supabase → Authentication → Emails → SMTP Settings**.
3. Brand the magic-link template and keep its redirect data intact.
4. Set an OTP expiry of no more than one hour and review Auth rate limits.
5. Send real tests to at least two providers (for example Gmail and Outlook),
   check spam placement, and test an expired link.

See [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) and
[Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).

## Vercel build configuration

In **Vercel → Project → Settings → Environment Variables**, add the public
project URL and publishable key for **Production** and only the intended
**Preview** environments:

```text
RODA_SUPABASE_URL
RODA_SUPABASE_PUBLISHABLE_KEY
```

Redeploy after changing either value. Do not configure the database password,
Supabase access token, Google secret, SMTP password, or any service-role/secret
API key in a static Vercel build. `vercel.json` already runs `npm ci`,
`npm run build`, and serves this repository root with clean URLs.

## Supabase GitHub integration

In the connected Supabase deployment settings, verify all of the following:

- repository: `jmoraispk/roda.fyi`
- working directory: `.`
- production branch: `main`
- **Deploy to production**: enabled only for `main`
- the Supabase migration check is required by GitHub branch protection
- preview branching: disabled unless the selected plan supports it and a
  separate-data policy has been approved

The integration consumes `supabase/config.toml` and committed files under
`supabase/migrations/`. It does not configure Google secrets, Auth URLs, SMTP,
database passwords, or Vercel variables.

## Local setup

Use Node.js 22.22.2 from `.nvmrc`:

```bash
npm ci
npm run build:test
npm run test:unit
npm run test:e2e
```

For a production-style local build, create an ignored `.env.local` containing
the two public browser values. Optional CLI linking values may also live there:

```text
RODA_SUPABASE_PROJECT_REF=
SUPABASE_ACCESS_TOKEN=
SUPABASE_DB_PASSWORD=
```

Load the ignored file without printing it. With the access token in the
environment, interactive `supabase login` is unnecessary:

```bash
npx supabase link --project-ref "$RODA_SUPABASE_PROJECT_REF"
```

`supabase/.temp/` contains ignored local link state. Local database tests need
a Docker-compatible runtime:

```bash
npm run supabase:start
npm run supabase:reset
npm run test:db
```

`supabase:reset` destroys the local Supabase database. Never point a reset at a
hosted project.

For the exact migration and verification sequence used by this release, run:

```bash
npx --yes node@22 node_modules/supabase/dist/supabase.js db reset
npx --yes node@22 node_modules/supabase/dist/supabase.js test db
npx --yes node@22 scripts/build.mjs
```

The reset is local-only and rebuilds the schema from every tracked migration.
The final build must run after browser tests because the E2E build deliberately
writes test-configured bundles before the production build replaces them.

## Migration and rollback workflow

1. Start the local Supabase stack.
2. Add a new timestamped migration; never rewrite one already deployed.
3. Rebuild locally with `npm run supabase:reset`.
4. Run database, unit, and browser tests.
5. Link a non-production project and inspect `npx supabase db diff` for drift.
6. Commit each migration with the authorization tests that prove it.
7. Require the Supabase GitHub check before merging to `main`.

After a hosted migration, also rerun Supabase Security Advisor and review every
new finding. Recheck SSL enforcement rather than assuming a project default.

Rollback means a new forward migration that safely reverses the faulty change.
Do not reset production or delete membership, invitation, relationship, or
ownership history during an ordinary rollback.

## Catalog curators

Catalog curators see the dashboard Catalog tab and may map, merge, or ignore
uncatalogued move terms. The role is granted only from the Supabase SQL editor;
there is no in-app management yet.

Grant:

```sql
insert into public.catalog_curators (profile_id)
select id from auth.users where email = '<owner email>';
```

Revoke:

```sql
delete from public.catalog_curators where profile_id = '<profile id>';
```

## Invitations and discovery links

- A member invitation is random, stored only as a hash, valid once, and expires
  after seven days. An optional email is normalized but roda.fyi only creates a
  shareable link; it does not send privileged invitation email itself.
- A group discovery link reveals the group's public projection. It never grants
  membership. Rotating or revoking it invalidates the previous token.
- A group relationship invitation expires after 30 days. A child may have only
  one active parent and cycles are rejected.
- `Named progress` and `Full coaching access` apply only to the immediate
  parent. They do not cascade to higher ancestors.
- The app creates `/app?member_invite=…` and `/app?group_link=…` links; links
  shared earlier as `/dashboard?…` forward to `/app` with their query. Tokens
  survive sign-in through the `next` return route and are removed from the
  address bar as soon as the app starts; the token then waits in that tab's
  session storage until the invitation or group sheet opens.

## Smoke tests after configuration

Use disposable accounts and inspect the browser network panel while testing:

1. New Google account → callback → profile completion → sign out → sign in.
2. Email link in a new tab → same safe callback → welcome or the app.
3. Google and email for the same verified address → one Supabase user/profile.
4. Cancelled Google consent, malformed callback, and expired email link.
5. Member invitation before sign-in, then resume and accept once.
6. Unlisted discovery link, rotation, revocation, and no automatic membership.
7. Owner, direct coach, member, immediate-parent coach, and higher ancestor:
   confirm every allowed and forbidden group action.
8. Revoke membership/relationship access and confirm the next private read
   fails and clears the private app screens.
9. Record an Alone session, create a direct coaching connection, arrange Group
   and Personal class sessions, confirm attendance, and verify that only
   confirmed participation changes calendars and statistics.
10. Keep a plan hidden before training and verify the student sees the schedule
    without plan details; reveal it and verify the plan becomes visible.
11. Add coach feedback through a direct context and a group context. Verify an
    unrelated coach and another group cannot read either entry.
12. Disable one profile's leaderboard visibility. Verify their name disappears,
    their activity remains in the anonymous aggregate, and group totals do not
    change.
13. Verify named or full access from the immediate parent group, then verify a
    higher ancestor receives anonymous aggregates only and cannot search member
    names or fetch raw training history.

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

## Preview and production rollout

Do not link, push migrations, deploy, merge, or change OAuth settings without
explicit authorization for the named target. For an approved non-production
HTTPS preview:

1. Create or select a Supabase preview project with isolated test data.
2. Link it explicitly and inspect the target before applying anything:

   ```bash
   npx --yes node@22 node_modules/supabase/dist/supabase.js link --project-ref PREVIEW_PROJECT_REF
   npx --yes node@22 node_modules/supabase/dist/supabase.js migration list
   npx --yes node@22 node_modules/supabase/dist/supabase.js db push --dry-run
   ```

3. Apply migrations only after the dry run identifies the intended preview:

   ```bash
   npx --yes node@22 node_modules/supabase/dist/supabase.js db push
   ```

4. Configure the preview Vercel environment with only its Supabase URL and
   publishable key, deploy HTTPS, and add the exact
   `https://PREVIEW_HOST/auth/callback` to that preview project's Auth redirect
   allowlist. Never use a broad Vercel wildcard.
5. Complete the smoke checks above with disposable coach, student, unrelated,
   immediate-parent, and higher-ancestor accounts. Confirm Google returns to
   the exact HTTPS preview callback and then `/app`.
6. Inspect the generated bundles before promoting:

   ```bash
   rg -n "service_role|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|sb_publishable_e2e_test" assets/generated
   ```

   The command must print nothing after the final production build.

Production promotion is a separate approval. Re-run the full clean-checkout
suite, inspect migration drift and the Security Advisor, take the backup
required by the recovery policy, apply migrations before deploying code that
depends on them, then repeat the smoke checks on `https://roda.fyi`. Rollback is
always a new forward migration plus an application redeploy; never reset or
rewrite production history.

## Rotation and incident response

Public publishable key exposed: this value is expected to be visible. Check for
abuse and RLS/grant failures. If rotation is still warranted, create a new
publishable key, update Vercel and local configuration, redeploy, verify, then
revoke the old key.

Privileged Supabase key exposed: treat as full database exposure. Revoke/rotate
it immediately in Supabase, remove it from every secret store and git history,
review Auth/database logs and data integrity, invalidate affected sessions or
tokens, redeploy, and document the incident. A secret/service-role key bypasses
RLS.

Google or SMTP secret exposed: rotate it at the owning provider first, update
Supabase directly, test sign-in/delivery, and revoke the old credential. For a
database-password leak, rotate it in Supabase, update only approved operator/CI
stores, and review connection logs.

Always preserve evidence before cleanup, record the exposure window, and
identify any personal data affected. Follow the launch gate in
[security-checklist.md](security-checklist.md) and Supabase's
[production checklist](https://supabase.com/docs/guides/deployment/going-into-prod).
