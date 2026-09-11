# Authentication and Group Foundation Design

**Date:** 2026-09-11
**Status:** Approved in conversation; awaiting written-spec review

## Purpose

This specification defines the first delivery of roda.fyi's training platform:
authentication, profiles, group membership, group hierarchy, authorization,
and the authenticated dashboard shell. It establishes a secure foundation for
workout plans, session history, feedback, calendars, statistics, rankings, and
future music practice without implementing those later domains prematurely.

The broader platform is intentionally divided into four deliveries:

1. Account and group foundation
2. Training plans and session history
3. Dashboards, analytics, and rankings
4. Music practice, recommendations, partner combinations, and traveling drills

This document specifies delivery 1 only. The approved cross-delivery product
decisions are also recorded in `docs/training-platform-design-decisions.md`.

## Existing Product Constraints

roda.fyi is currently a dependency-light static site deployed by Vercel. Its
public movement library must remain available without authentication. The new
account system must not require migrating the existing public pages into a
framework or putting the movement library behind a login.

Supabase supplies authentication, Postgres, storage, and the Data API. The
repository's GitHub integration deploys database migrations and supported
Supabase resources from the `supabase/` directory. Vercel continues to deploy
the website. Supabase dashboard settings and secrets are not assumed to deploy
from ordinary Git commits.

## Scope

The foundation includes:

- One unified sign-in entry point
- Google OAuth as the recommended primary method
- Passwordless email as the secondary method
- Authenticated profiles and profile pictures
- Automatic timezone detection with an optional override
- A binary My Training / Coaching dashboard mode switch
- Self-service coach registration on an existing profile
- Group creation and ownership
- Searchable and unlisted groups
- Membership requests and student invitations
- Group-to-group invitations and multi-level hierarchy
- Relationship-specific upward data-sharing permissions
- Row Level Security, explicit grants, and storage policies
- A dashboard shell and group/context switcher
- Authorization, state-transition, and browser-flow tests

The foundation does not include workout builders, scheduled plans, training
sessions, rounds, movement sequences, feedback entry, calendars, statistics,
rank calculations, music practice, or recommendations. The dashboard may show
clear empty states for these later features, but it does not create speculative
data models for them.

## Architecture

### Public site and dashboard

The public movement library remains static and anonymous. A single **Sign in**
button is added to the public navigation. After authentication, that entry point
becomes the user's profile/dashboard entry.

The authenticated product lives at `/dashboard`. It uses small browser modules
with separate responsibilities for the Supabase client, authentication state,
profiles, group operations, dashboard context, and UI rendering. Foundation
work does not migrate the existing homepage or studio into a frontend
framework.

The browser receives only the Supabase project URL and publishable key. These
are public client configuration. The database password, service-role key,
Google client secret, SMTP credentials, and Supabase personal access token must
never appear in browser code or committed files.

### Supabase responsibilities

Supabase Auth owns login identities and sessions. Postgres owns application
profiles, coach registration, groups, memberships, invitations, and group
relationships. Storage owns profile and group pictures. RLS and explicit
database grants are the authorization boundary; hiding a control in the UI is
never treated as authorization.

Sensitive multi-row transitions run through narrowly scoped database functions.
Examples include creating a group and its owner membership, approving a coach,
accepting an invitation, accepting a group relationship, transferring
ownership, and changing upward sharing. Each function is transactional,
idempotent where practical, restricted to authenticated callers, and configured
with a fixed search path.

## Authentication and Profile Experience

### Unified sign-in

There are no separate Register and Login buttons. The sign-in dialog contains:

1. **Continue with Google** as the primary recommended action
2. A divider
3. An email field and **Email me a sign-in link** secondary action

The first successful authentication creates an account; subsequent uses sign
into the same account. The application uses Supabase's stable user ID as the
profile key and does not infer permissions from an email address.

Google OAuth uses only OpenID, email, and profile scopes. Production and local
callback URLs must be explicitly allowlisted. Passwordless email requires a
production SMTP provider before public launch; Supabase's default mail service
is suitable only for limited setup and testing.

### Minimal profile

On first sign-in the user confirms a display name and may add a picture. The
Google-provided name and picture may prefill these fields but remain editable.
No student-versus-coach choice is required.

Timezone is optional and defaults to **Automatic**. The browser supplies an IANA
timezone such as `America/Los_Angeles`. A manual override is available in
settings. Later training records will store UTC timestamps together with the
local date and timezone used for that practice, so travel does not rewrite
historical calendar days.

### Universal practitioner model

Every account is a practitioner and may eventually record personal training.
Coaching is an additional capability, not a mutually exclusive identity.
Coaches and group owners may train, receive feedback, and participate in
rankings like any other member.

The dashboard always uses a binary **My Training / Coaching** mode switch above
any tabs that belong to the active mode. A person without coaching capability
sees **Register as a coach** in Coaching mode. Registering as a coach extends the
existing profile and enables group creation and coach-access requests. It does
not create a second account or grant access to an existing group.

## Data Model

### `profiles`

One application profile per Supabase Auth user. It stores the editable display
name, profile-picture path, optional timezone override, leaderboard visibility
preference, and timestamps. It does not duplicate credentials or OAuth secrets.

### `coach_profiles`

An optional one-to-one extension of `profiles` created by **Register as a
coach**. Initially it records only activation and timestamps. Future
coach-specific public information may extend this record without duplicating
the person's base profile.

### `groups`

A group stores its owner, name, stable identifier, picture, description,
location, discoverability, archive state, and timestamps. Groups are searchable
by name and location by default. An owner may make a group unlisted.

Anonymous discovery receives only a limited projection containing group name,
picture, location, description, and public umbrella affiliation. It never
exposes owner IDs, member lists, requests, invitations, or training data. A
read-only search function returns this projection instead of granting anonymous
access to the base `groups` table. An umbrella affiliation appears publicly
only when both groups are discoverable.

### `group_memberships`

A membership connects one profile to one group. Every membership represents a
practitioner. Its access level is either member or coach; coaching access adds
management permissions without removing the person's ability to train.

The group's owner is stored as the single owner on `groups` and must also have
an active coach membership. Ownership is therefore a unique responsibility,
not a mutually exclusive practitioner identity. One account may have different
membership access in different groups.

### `group_join_requests`

A signed-in person may request member or coach access to a discoverable or
directly linked group. Requests have pending, approved, declined, cancelled,
and expired states. Only one pending request per person, group, and requested
access level is allowed. Requesting coach access requires an active
`coach_profiles` record. Pending requests expire after 30 days and may be
submitted again.

Any active coach in the target group may approve member access. Only the group
owner may approve coach access. Approval and membership creation occur in one
transaction. Any active coach may later remove an ordinary member; only the
owner may remove another coach.

### `group_member_invitations`

Active group coaches may invite students as members by email or shareable link.
The invitation contains an expiring single-use token whose stored form is a
hash. Invitation email addresses and state are visible only to authorized group
coaches and the accepting user. Foundation invitations expire after seven days
and may be reissued.

### `group_discovery_links`

An active group coach may create or rotate a random link/code that reveals the
same limited group projection as public search and allows a signed-in person to
submit a join request. This lets unlisted groups accept requests without
appearing in search. A discovery link never grants membership directly. Its
stored token is hashed, and the link remains active until a coach revokes or
rotates it.

### `group_relationships`

A relationship connects a parent group to a child group. The parent owner sends
the invitation, and the child owner accepts or declines it. Pending,
active, declined, revoked, and expired states are stored separately from
person-to-group membership. Pending group invitations expire after 30 days and
may be reissued.

Each child has at most one active parent. A group may be both a child and a
parent, allowing local → regional → global trees. Self-links and cycles are
prohibited. Revoking an active relationship removes inherited visibility
immediately without deleting either group.

Each active relationship has a sharing level exposed in the UI as one toggle:

- Toggle off: **Named progress**. Immediate-parent coaches may see names,
  practice totals, progress summaries, and rankings, but not detailed plans,
  session contents, difficulty ratings, or feedback.
- Toggle on: **Full coaching access**. Immediate-parent coaches may additionally
  access those detailed coaching records when later deliveries create them.

Only the child-group owner may change this toggle. The parent cannot grant
itself additional access.

Anonymous aggregate statistics will eventually roll up through every ancestor.
Named progress and full coaching access stop at the immediate parent and never
cascade automatically. A new global relationship therefore cannot silently
expose identifiable data from local descendant groups.

## User Flows

### Create and use an account

1. The person selects Sign in.
2. They use Google or request an email link.
3. The callback returns them to their intended destination.
4. A missing application profile is created and minimally completed.
5. The dashboard opens in My Training mode and restores the last-used group
   context when that membership still exists.

An expired session returns to sign-in while preserving the intended invitation
or dashboard destination.

### Become a coach and create a group

1. The person switches to Coaching mode.
2. If not registered, they select Register as a coach.
3. The existing profile gains its coach extension.
4. They may create a group.
5. One transaction creates the group, assigns ownership, and creates the active
   coach membership.

### Join an existing group

A person searches discoverable groups or opens an unlisted link. They request
member or coach access. Duplicate submissions reopen the existing request
instead of creating extra rows. Coaches may decide member requests; the owner
alone may decide coach requests.

A member invitation may be opened before authentication. After sign-in, the
same destination resumes. Expired, revoked, or already-used invitations show a
specific explanation and a safe way to request fresh access.

### Switch contexts

My Training and Coaching remain a binary top-level mode switch, not tabs. Tabs
may organize pages inside either mode. A separate context switcher chooses the
active group when an account belongs to or coaches multiple groups. The last
valid mode and group are remembered locally as a convenience, never as an
authorization source.

### Associate groups

1. A parent-group owner invites a child group.
2. The child-group owner accepts or declines.
3. Acceptance checks that the child has no active parent and that the new edge
   cannot form a cycle.
4. The relationship activates with Named progress sharing.
5. The child owner may later enable or disable Full coaching access.

Either group's owner may revoke the active relationship. Revocation immediately
removes inherited visibility while preserving the relationship's audit history.

## Authorization Rules

RLS is enabled on every table exposed through the Data API. New tables are not
automatically exposed; grants and policies are added explicitly in migrations.

- A user reads and edits their own complete profile.
- Direct coaches may read the display name and picture of active members in
  their group.
- Members may see another member's display name and picture only through an
  approved group surface such as an opted-in leaderboard.
- Anonymous visitors may query the limited discoverable-group projection.
- A member reads their own memberships, requests, and relevant invitations.
- Any authenticated person may register their existing profile as a coach.
- Only a registered coach may create a group or request coach access.
- Active coaches read the membership roster of groups they coach.
- Active coaches invite, approve, and remove ordinary members.
- Only the owner approves coaches, transfers ownership, changes group-level
  settings, removes another coach, archives the group, or creates parent-group
  invitations.
- Either owner may revoke a parent-child relationship; only the child owner may
  change its upward sharing level.
- Immediate-parent coaches receive the relationship's approved visibility.
- Higher ancestors receive anonymous aggregates only.
- A member's leaderboard opt-out hides their identity from individual
  leaderboards while retaining anonymous contribution to group totals.
- Direct coaching access is unaffected by leaderboard visibility.

The service-role key is reserved for trusted server-side or administrative
maintenance and is not required by ordinary dashboard flows.

### Permission interface for later deliveries

Later training tables must reuse tested database permission helpers rather than
reimplement hierarchy rules in browser code or in every policy. The foundation
provides narrowly scoped checks for direct coaching, group management, named
immediate-parent progress, full immediate-parent coaching access, and anonymous
ancestor aggregation. Raw training rows will never become readable merely
because a caller belongs to an ancestor group; aggregate reporting will use a
separate protected database interface.

## Storage Rules

Group images and member profile pictures use separate storage paths and
policies. Group owners control group-image writes. A person controls their own
profile-picture writes. Reads follow the same public, membership, and hierarchy
visibility rules as the corresponding records. Replacing a picture cannot
overwrite another user or group's object path.

## State Integrity and Error Handling

Database constraints and transactional functions enforce these invariants:

- Every active group has exactly one owner.
- The owner has an active coach membership.
- The sole owner cannot leave until ownership is transferred.
- Each child has at most one active parent.
- Group relationships cannot contain self-links or cycles.
- Approval cannot create duplicate active memberships.
- An ordinary member may leave at any time; the sole owner may not leave.
- An invitation cannot be accepted after expiry, revocation, or prior use.
- A group cannot grant itself inherited access.

Functions return stable outcomes for already-completed operations so a retry
after a network failure does not create duplicates. The UI distinguishes
validation errors, expired state, lost authorization, and temporary network
failures. When membership or a relationship is revoked, subsequent reads fail
closed and cached private views are cleared.

Groups, memberships, and relationships are archived or revoked in the initial
interface rather than hard-deleted. Ownership transfer is explicit and audited
with actor and timestamp fields.

## Verification Strategy

### Database and RLS tests

Migrations must build a clean local Supabase database from zero. SQL tests cover
constraints, state transitions, and an access matrix for:

- Anonymous visitor
- Authenticated outsider
- Ordinary group member
- Group coach
- Group owner
- Immediate-parent coach with Named progress
- Immediate-parent coach with Full coaching access
- Higher-ancestor coach

The matrix proves that users cannot self-promote, inspect unrelated private
rows, approve beyond their authority, bypass leaderboard privacy, create a
second active parent, form a hierarchy cycle, or obtain detailed data through
an ancestor relationship.

### Browser and module tests

Browser-facing tests cover the unified sign-in dialog, passwordless email flow,
OAuth callback routing, sign-out, session expiry, profile completion, timezone
detection, the My Training / Coaching switch, context switching, search,
requests, invitations, and revoked access. Google OAuth receives a manual
end-to-end smoke test against the configured provider because the external
Google consent screen is not suitable for a deterministic local test.

Pure browser modules keep state selection and permission-dependent rendering
separate from DOM wiring so their behavior can be tested without exercising
the whole page.

### Security review checks

Before deployment, verification checks that no privileged secret is committed
or sent to the browser, all public-schema tables have RLS, grants are explicit,
security-definer functions have fixed search paths and restricted execution,
redirect allowlists are exact, and private storage objects cannot be read by an
unrelated account.

## Deployment and External Configuration

The repository gains a `supabase/` directory containing configuration,
migrations, and database tests. Supabase's GitHub integration must be configured
to deploy production migrations from `main`. Vercel continues to publish the
static site and dashboard files.

The following configuration remains outside Git:

- Supabase project URL and publishable key in local/Vercel public configuration
- Supabase personal access token used by the CLI
- Database password and service-role key
- Google OAuth client ID and secret
- Production SMTP credentials

The project URL and publishable key may safely be supplied to browser code.
All other values must be entered through local environment variables or the
appropriate provider dashboard. Google OAuth and email SMTP configuration must
be verified separately because they are not deployed by ordinary schema
migrations.

## Acceptance Criteria

The foundation is complete when:

1. Google-first and passwordless-email sign-in share one entry experience.
2. The public movement library remains usable without an account.
3. Every account can use My Training, and an existing profile can register as a
   coach without creating a second identity.
4. Coaches can create groups; owners, coaches, and members have the approved
   management boundaries.
5. Searchable and unlisted group discovery work without leaking membership or
   training data.
6. Person-to-group and group-to-group invitation flows are resumable,
   transactional, and permission checked.
7. Multi-level group trees enforce one active parent and reject cycles.
8. Permission helpers distinguish Named progress, Full coaching access, and
   anonymous higher-ancestor aggregation without exposing future raw training
   rows.
9. RLS and storage tests pass for every actor in the authorization matrix.
10. No privileged secret is present in committed files or browser responses.
