# Authentication and Database Operations

This guide explains which service owns each part of roda.fyi, how changes move
from this repository to production, and where credentials belong.

## What runs where

Vercel serves the public movement library, authentication callback, dashboard,
styles, and browser bundles. Supabase provides user registration and sessions,
Postgres data, file storage, and authorization through Row Level Security
(RLS).

The public website remains usable without an account. The dashboard uses the
same Supabase account for personal training and coaching; registering as a
coach adds a capability to the existing profile.

## What GitHub deploys

The Supabase GitHub integration reads the root `supabase/` directory. Its
working directory must be `.`. Migrations in `supabase/migrations/` and
supported resources declared in `supabase/config.toml` can deploy from Git.

The integration does not make every dashboard setting portable. Google OAuth
credentials, production redirect URLs, custom SMTP credentials, database
passwords, and access tokens still require the appropriate provider dashboard
or secret store. Vercel deploys the static website separately.

For production, configure the integration to deploy only from `main` and make
its migration check a required GitHub status check. Do not merge a partial
migration chain.

References:

- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [Supabase GitHub integration](https://supabase.com/docs/guides/deployment/branching/github-integration)
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Google sign-in with Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)

## Credential boundary

Only these values may be embedded in browser JavaScript:

- `RODA_SUPABASE_URL`
- `RODA_SUPABASE_PUBLISHABLE_KEY`

They identify the public API and are protected by database grants and RLS, not
by secrecy. Put them in `.env.local` for local builds and in Vercel environment
settings for deployed builds.

Never commit or bundle:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- the Supabase service-role key
- the Google OAuth client secret
- SMTP credentials

The service-role key bypasses normal RLS and is not used by dashboard flows.
The browser build intentionally rejects keys that do not start with
`sb_publishable_`.

## Local environment

Use Node.js 22.22.2 from `.nvmrc`. Install dependencies and build with:

```bash
npm ci
npm run build
```

Create an ignored `.env.local` with the two public browser variables. To link
the CLI without pasting secrets into commands or chat, the project owner may
also place these local-only values there:

```text
RODA_SUPABASE_PROJECT_REF=
SUPABASE_ACCESS_TOKEN=
SUPABASE_DB_PASSWORD=
```

Before invoking the CLI, load the ignored file into the current shell. Do not
print its contents. `supabase/.temp/` contains local link state and is ignored.

Initialize/link commands:

```bash
npx supabase login
npx supabase link --project-ref "$RODA_SUPABASE_PROJECT_REF"
```

Interactive login is unnecessary when `SUPABASE_ACCESS_TOKEN` is already in
the environment. The CLI may prompt for the database password rather than
reading it from a command argument.

## Environment separation

- **Local:** Supabase CLI stack on `127.0.0.1`; disposable test data only.
- **Preview:** Optional Supabase branch paired with a Vercel preview; never copy
  production user data into it.
- **Production:** Hosted Supabase project and canonical roda.fyi deployment.

Local database tests require a Docker-compatible runtime. Run:

```bash
npm run supabase:start
npm run supabase:reset
npm run test:db
```

`supabase:reset` is destructive to the local database. Never aim it at the
hosted production database. Production schema changes move forward through a
new migration; do not edit an already-deployed migration or reset production.

## Authentication configuration

Local Auth uses:

```text
Site URL: http://127.0.0.1:8137
Callback: http://127.0.0.1:8137/auth/callback
```

Production uses the canonical HTTPS roda.fyi origin and its exact
`/auth/callback` URL. Avoid wildcard production redirects.

Google is the recommended primary method. Configure only OpenID, email, and
profile scopes. Put the Google client ID and secret directly in the Supabase
Auth provider settings. Passwordless email is the secondary method; configure
a production SMTP provider before relying on it publicly.

## Routine migration workflow

1. Start the local stack.
2. Add a new timestamped SQL file under `supabase/migrations/`.
3. Rebuild from zero with `npm run supabase:reset`.
4. Run `npm run test:db` and the browser/unit tests.
5. Inspect `npx supabase db diff` for unexplained drift.
6. Commit the migration and its tests together.
7. Let the GitHub check validate the complete branch before merging.

If a deployed change must be undone, write a new forward migration that safely
reverses it. Preserve membership, invitation, relationship, and ownership
history rather than deleting rows during ordinary product operations.
