# Authentication and Database Operations

This runbook explains how roda.fyi authentication, database changes, and
deployment fit together. It deliberately separates public browser
configuration from privileged credentials.

## Current deployment boundary

| Concern | Owner | Repository-driven? |
|---|---|---|
| Static site, callback, dashboard, browser bundles | Vercel | Yes, from GitHub |
| User registration, Google/email sign-in, sessions | Supabase Auth | Code yes; provider settings no |
| Application data and authorization | Supabase Postgres + RLS | Yes, through migrations |
| Profile/group pictures | Supabase Storage + RLS | Yes, through migrations |
| Google OAuth client and consent screen | Google Auth Platform | No |
| Passwordless-email delivery | External SMTP through Supabase | No |

The public movement library remains available without an account. Every
signed-in account is a practitioner. “Register as a coach” adds a capability
to the same profile; it does not create another user.

`https://roda.fyi` was rechecked on 2026-09-14 and responds directly from
Vercel without redirecting to a different host. It is therefore the canonical
production origin unless the domain configuration intentionally changes.

## Hosted security baseline

The linked hosted project was rechecked on 2026-09-14 after applying the
tracked migration chain:

- the hosted migration history is up to date and the tracked schema has no
  drift across `public`, `private`, and `storage`;
- database SSL enforcement is enabled;
- anonymous group discovery succeeds through `public.search_groups`, while
  anonymous direct profile access is rejected;
- Supabase Security Advisor reports only three informational
  `rls_enabled_no_policy` findings: `group_discovery_links`,
  `group_member_invitations`, and `group_relationships`.

Those three findings are intentional. The tables have RLS enabled, no direct
client table grants, and no policies because access is mediated by the checked
RPC/projection boundary. Do not add a broad policy merely to silence the
advisor. A future migration that intentionally introduces direct reads must
add a narrowly tested policy and update this exception list.

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
```

Do not add `*`, `/**`, Vercel preview wildcards, `localhost` aliases, or a
second production hostname. Add a preview callback only when a specific
preview environment and its data-isolation policy have been approved.

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
- Query-string tokens are captured before sign-in when necessary and scrubbed
  from the address bar as soon as the dashboard receives them.

## Smoke tests after configuration

Use disposable accounts and inspect the browser network panel while testing:

1. New Google account → callback → profile completion → sign out → sign in.
2. Email link in a new tab → same safe callback → profile/dashboard.
3. Google and email for the same verified address → one Supabase user/profile.
4. Cancelled Google consent, malformed callback, and expired email link.
5. Member invitation before sign-in, then resume and accept once.
6. Unlisted discovery link, rotation, revocation, and no automatic membership.
7. Owner, direct coach, member, immediate-parent coach, and higher ancestor:
   confirm every allowed and forbidden group action.
8. Revoke membership/relationship access and confirm the next private read
   fails and clears the private dashboard surface.

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
