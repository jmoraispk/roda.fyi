# Security and Launch Checklist

Use this checklist for every production launch that changes authentication,
authorization, storage, or database structure. Record evidence in the release
or pull request; do not check an item based only on dashboard appearance.

## Account and provider security

- [ ] Supabase organization owners use MFA; GitHub and Google administrators
  use 2FA/MFA.
- [ ] At least two trusted organization owners can recover the project.
- [ ] Google requests only `openid`, email, and profile.
- [ ] The Google Web client contains only approved production/local origins and
  the exact hosted Supabase callback URI.
- [ ] Google client secret exists only in Google and Supabase provider settings.
- [ ] Supabase Site URL is exactly `https://roda.fyi`.
- [ ] Supabase redirect allowlist contains exactly the production and
  `http://127.0.0.1:8137/auth/callback` callback URLs documented in the runbook;
  no wildcard is present.
- [ ] Email confirmations/magic links are enabled with an expiry no longer than
  one hour.
- [ ] Custom SMTP, branded templates, SPF, DKIM, delivery tests, and appropriate
  Auth rate limits are complete before email sign-in is advertised publicly.
- [ ] Google/email automatic identity linking was smoke-tested with the same
  verified address; the app never merges accounts by comparing email strings.

## Browser and secret boundary

- [ ] The production build contains only the exact Supabase project URL and
  `sb_publishable_...` key.
- [ ] No Supabase access token, database password, secret/service-role key,
  Google secret, SMTP password, invitation token, or local environment file is
  tracked or bundled.
- [ ] A repository/history secret scan has no unexplained result.
- [ ] Browser network inspection returns no privileged credential or private
  row outside the signed-in caller's permissions.
- [ ] Vercel Production/Preview scopes contain only the intended public values;
  preview configuration never points at production data unless explicitly
  approved.
- [ ] Error messages are safe and do not reveal SQL, tokens, credentials, user
  existence, or cross-group private data.

## Database and API authorization

- [ ] Every exposed table has RLS enabled, including tables created outside the
  migration workflow. Automatic RLS is enabled as a guardrail for new public
  tables.
- [ ] RLS policies and grants pass tests for anonymous, member, coach, owner,
  immediate-parent coach, and higher-ancestor callers.
- [ ] Clients cannot directly insert coach profiles, groups, memberships,
  invitations, discovery links, relationships, or ownership audit rows.
- [ ] Every mutation goes through the documented RPC boundary and rechecks
  authorization server-side; hidden buttons are never treated as security.
- [ ] No security-definer function exists in an exposed schema. Every approved
  private definer has an empty `search_path` and fully qualified object names.
- [ ] Invitation and discovery tokens are cryptographically random and stored
  only as hashes; expiry, one-time acceptance, rotation, and revocation pass.
- [ ] Group relationships reject self-links, cycles, and a second active parent.
- [ ] Named/full parent access is immediate-parent-only; higher ancestors cannot
  read raw foundation rows.
- [ ] Profile and group storage policies constrain type, size, ownership prefix,
  read scope, replacement, and deletion.
- [ ] Supabase Security Advisor has no unexplained finding.

## Migration and deployment safety

- [ ] `npm ci`, production build, unit tests, browser tests, local Supabase reset,
  and database tests pass from a clean checkout.
- [ ] `npx supabase db diff` against a linked non-production project shows no
  unexplained drift.
- [ ] The migration chain rebuilds from zero; deployed migrations were not
  edited in place.
- [ ] GitHub integration uses repository `jmoraispk/roda.fyi`, working directory
  `.`, production branch `main`, and production deploys only from `main`.
- [ ] The Supabase migration check is required by branch protection.
- [ ] A forward rollback migration and data-preservation impact were considered.
- [ ] Free-plan pause/backup limitations are acceptable, or the project plan and
  backup/PITR policy have been upgraded for the required recovery objective.

## Product privacy and behavior

- [ ] Member, coach, and group invitations survive sign-in but their tokens are
  removed from the visible URL immediately after capture.
- [ ] Revoked membership/relationship access fails on the next private read and
  clears cached private UI.
- [ ] Coaches remain practitioners and can record their own training; Coaching
  is an explicit binary mode, not a separate account.
- [ ] Leaderboard participation remains optional. No ranking or training data is
  fabricated before those models are implemented.
- [ ] Workout, feedback, music-training, named ranking, and anonymous aggregate
  features remain absent or clearly labeled as future work in this foundation
  release.
- [ ] Data retention, account deletion, privacy notice, and support contact are
  approved before collecting real training/feedback history.

## Incident drill

- [ ] Operators know how to distinguish an expected public publishable-key
  disclosure from a privileged-key leak.
- [ ] Privileged-key response covers immediate revocation, secret-store and git
  cleanup, log/data-integrity review, session/token invalidation, redeployment,
  affected-user assessment, and incident documentation.
- [ ] Google, SMTP, database-password, and Supabase key rotation have named
  owners and a tested verification sequence.
- [ ] Audit evidence is preserved before destructive cleanup.

Operational procedures and exact settings live in
[auth-and-database-operations.md](auth-and-database-operations.md). Supabase's
current baseline is its [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod).
