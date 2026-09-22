# Training Calendar and Statistics Design

**Status:** Approved conversational design; awaiting review of this written specification.

## Purpose

Turn roda.fyi's authentication and group foundation into a practical tool for
coordinating training and tracking progress. The first delivery serves the same
person in two modes:

- **My Training** for practitioners to review their calendar, record independent
  practice, complete assigned work, and understand progress.
- **Coaching** for coaches to arrange personal and group training, confirm what
  happened, and follow connected students.

The calendar is the core interface. Statistics and rankings are derived from
confirmed training records rather than entered or cached totals.

## Product Principles

1. One account has one identity, photograph, history, and set of statistics.
   My Training and Coaching are modes, not separate accounts or duplicate
   profiles.
2. Training history belongs to the practitioner. A group or coach receives
   permission to read it through an active coaching relationship.
3. The training context stays simple: **Alone**, **Group**, or
   **Personal class**.
4. Practitioners record Alone training. Coaches arrange Group and Personal
   class training and confirm completion.
5. Plans, schedules, actual training, and individual participation are separate
   records. Editing future intent must never rewrite history.
6. Statistics are calculated from confirmed participation records.
7. Database authorization enforces every privacy rule; the interface is not a
   security boundary.

## Existing Foundation

This design extends the approved authentication and group foundation:

- Google-first unified sign-in and one practitioner profile per account.
- Optional coach registration on the same profile.
- My Training / Coaching mode switch.
- Self-managed groups, memberships, invitations, and requests.
- Group hierarchy with relationship-specific `named_progress` and
  `full_details` sharing.
- Automatic profile timezone with historical local dates preserved.
- Member-controlled leaderboard visibility.

The existing group and hierarchy rules remain authoritative unless this
document explicitly refines them.

## Scope

### Included

- Direct coach-student connections through a reciprocal invitation or request.
- Group membership deriving student access for every active coach in that
  group.
- Versioned workout plans containing ordered rounds and movement sequences.
- Coach-arranged Group and Personal class schedules.
- Practitioner-recorded Alone training.
- Coach-confirmed attendance and actual duration.
- Practitioner notes, movement difficulty assessments, and coach feedback.
- A calendar of upcoming and completed training.
- Personal activity and movement statistics.
- Privacy-safe member rankings inside a selected group.
- English and Portuguese copy for all new user-facing interfaces.

### Deferred

- Coach news feed, pinned announcements, and reactions.
- Richer capoeira profile fields and redesigned profile cards.
- A combined ranking display such as `3h 31m (4 sessions)`.
- Group-versus-group umbrella leaderboards. The underlying participation model
  must support later aggregate rollups, but the first ranking UI compares
  members inside one selected group.
- Music-practice tracking.
- Automated workout or movement recommendations.
- Payments, subscriptions, documents, billing, and unrelated fields visible in
  the reference application.
- New movement artwork and missing arm-strike content. These remain a parallel
  movement-library track.

## Identity and Coaching Relationships

### One identity, two modes

Every account remains a practitioner. Registering as a coach adds coaching
capabilities and metadata to the existing profile. It does not create another
person record, calendar, avatar, or history.

### Direct connection

A coach or practitioner may initiate a direct coaching connection. The other
party must accept it. The connection has a lifecycle of `pending`, `active`,
`declined`, or `ended`. Either participant may end an active direct connection.

An active direct connection lets that coach:

- read the practitioner's shared calendar and training history,
- arrange a Personal class,
- assign an individual workout plan, and
- add direct-coaching feedback.

### Group-derived connection

An active student membership in a group derives coaching access for every
active coach in that group. No duplicate direct-connection rows are created.
Leaving the group or losing the relevant membership ends the derived access
immediately. An independent active direct connection, if one exists, remains.

A group connection grants access to history; it does not make the group the
owner of that history. Group coaches may arrange Group training and may arrange
a Personal class for a student when acting through the shared group.

### Student discovery

Students may see privacy-safe member summaries for groups they share: display
name, avatar, capoeira graduation when available, and leaderboard information.
They may not query another student's raw calendar, notes, movement assessments,
or feedback. A direct coaching connection alone does not expose one coach's
students to one another.

## Training Contexts

### Alone

- Recorded by the practitioner.
- Has no group or coach requirement.
- May be entered after training or started from an individual plan.
- Becomes confirmed activity when saved successfully.

### Group

- Arranged by an active coach of one specific group.
- May be visible in advance or hidden until the coach reveals it.
- Produces activity only for attendees confirmed by a group coach.
- Retains the group tag as the location/context of the training.

### Personal class

- Arranged by a coach for one connected practitioner.
- May use a direct connection or a group-derived coaching context.
- Produces activity after the responsible coach confirms completion.
- Feedback remains scoped to the direct or group coaching context used.

All three contexts contribute to the practitioner's personal history and
statistics. Every currently connected direct or group coach may read the shared
underlying training details. Context-specific coach feedback follows the
narrower rules below.

## Plans, Schedules, Occurrences, and Participation

### Workout plan

A workout plan describes intended content:

- title and coach instructions,
- expected duration,
- ordered rounds,
- ordered movements within each round,
- repetitions or time targets,
- rest targets, side, and movement-specific notes.

A plan may be a one-off or reusable. Drafts may change. Publishing creates an
immutable numbered version. A later edit creates another version so scheduled
and historical training continues to reference exactly what was assigned.

### Scheduled training

A schedule applies a published plan version to a future Group or Personal class
training. It stores the coaching context, start time, local date, timezone,
expected duration, and whether members may see the details in advance.

Before completion, a Personal class schedule and its plan are visible only to
the target practitioner and the arranging direct coach, or to the active
coaches of the source group when the arrangement uses a group-derived
connection. Other coaches connected to the practitioner do not receive another
context's future plan. After completion, the shared facts about what the
practitioner actually did follow the normal training-history rules, while coach
feedback remains context-specific.

Schedules have `scheduled`, `cancelled`, or `completed` state. Cancelling
preserves the audit record and produces no participation or statistics.

### Training occurrence

An occurrence describes what actually happened. It may reference a schedule,
but its actual rounds and movement sequence are stored as a historical snapshot
because practice may differ from the plan. Alone training creates an occurrence
directly without requiring a schedule.

### Participation

A participation is the person-owned fact that a practitioner trained. Group
training creates one participation for every confirmed attendee. Alone and
Personal class training each normally create one participation.

Participation stores:

- practitioner,
- actual duration,
- completion time, local date, and timezone,
- personal notes,
- creation and confirmation metadata.

Statistics read participation records only. Scheduled, cancelled, and
unconfirmed training never contributes.

### Movement assessment

A practitioner may rate each practiced movement with a deliberately small
difficulty scale, initially **Easy**, **Okay**, or **Hard**, plus an optional
note. Progression is derived from changes across repeated assessments; a coach
does not manually enter a progression score.

### Coach feedback

Coach feedback belongs to one participation and the coaching context from which
the coach is acting:

- Group-context feedback is readable by the practitioner and active coaches of
  that group.
- Direct-context feedback is readable by the practitioner and the authoring
  direct coach.
- Unrelated coaches cannot read feedback from another context even when they
  can read the underlying shared training facts.

The practitioner retains received feedback after a relationship ends. The
former coach loses access through that ended relationship.

## Proposed Database Model

Names may be adjusted mechanically during planning, but these responsibilities
and boundaries are normative.

### `coach_student_connections`

- `id`
- `coach_profile_id`
- `student_profile_id`
- `state`
- initiator, decision, end, and timestamp metadata

Constraints prevent self-connections, require the coach profile to be
registered, and allow at most one open or active connection for a pair.

### `workout_plans`

- stable plan identity
- creator profile
- optional source group
- title, description, and lifecycle state

### `workout_plan_versions`

- plan and monotonically increasing version number
- expected duration and general instructions
- publication metadata

Published rows and their children are immutable.

### `workout_plan_rounds`

- plan version
- ordered position
- label, repeat/time target, and rest target

### `workout_plan_movements`

- plan round and ordered position
- stable movement key
- movement-name snapshot
- side, repetition/time target, and instructions

Movement keys correspond to the existing movement library. The name snapshot
keeps history readable if the library later renames or reorganizes an entry.

### `scheduled_trainings`

- `group` or `personal_class` kind
- published plan version
- arranging coach
- source group when the coach is acting through a group
- target practitioner for Personal class
- start time, local date, timezone, and expected duration
- advance-visibility setting
- lifecycle and cancellation metadata

Constraints enforce the required target for each kind. Authorization verifies
that the arranger has the relevant active coaching relationship.

### `training_occurrences`

- `alone`, `group`, or `personal_class` kind
- optional schedule and source group
- recorder/confirming coach
- actual time, local date, timezone, and default duration

A schedule produces at most one occurrence. Alone occurrences must be owned by
their practitioner creator.

### `training_occurrence_rounds` and `training_occurrence_movements`

These hold the actual historical sequence. A scheduled session initially copies
the published plan version, after which the responsible coach can record what
was really completed. Alone training uses the same structure.

### `training_participations`

- occurrence and practitioner
- actual participant duration
- personal notes
- confirmation metadata

The `(occurrence_id, profile_id)` pair is unique. Participant duration may
override the occurrence default when someone arrived late or left early.

### `training_movement_assessments`

- participation and occurrence movement
- `easy`, `okay`, or `hard` rating
- optional practitioner note

Only the participating practitioner writes these fields.

### `training_feedback`

- participation and coach author
- exactly one valid group or direct-connection context
- feedback body and timestamps

The context must grant the author access at creation time. Feedback remains
part of the practitioner's record after that context later ends.

### Group timezone

Group rankings use the selected group's IANA timezone for week, month, and year
boundaries. A new group defaults to the creating coach's browser timezone and
the owner may edit it. Personal calendar days continue using the local date and
timezone saved with each participation.

## Calendar Experience

### My Training

The default dashboard surface is a monthly calendar. Days show distinct markers
for Alone, Group, and Personal class activity. Upcoming items are visually
different from completed items and never look like completed practice.

Selecting a day shows:

- training context and duration,
- source group or coach when applicable,
- rounds and movements,
- practitioner difficulty assessments and notes,
- feedback visible to the practitioner.

Primary actions are **Record Alone training** and, when an assigned plan exists,
**Open plan**. The practitioner cannot create Group or Personal class records.

### Coaching

Coaching mode starts with connected students, coached groups, and upcoming
training. A coach can:

- arrange Personal class for one connected student,
- arrange Group training for a group they coach,
- create or select a workout plan,
- hide or reveal future plan details,
- confirm completion, actual content, duration, and attendance,
- inspect permitted student calendars, and
- add context-scoped feedback.

The existing group selector determines the active group context. Direct
students remain reachable outside a group context.

### Loading strategy

The calendar loads summary markers for one visible month. Day details load on
selection. Statistics load by explicit date range and metric. This avoids
downloading a practitioner's entire history as it grows.

## Statistics and Rankings

### Personal statistics

- calendar activity and current streak,
- average trainings per week,
- average training hours per month,
- total sessions and duration,
- most-practiced movements,
- movements becoming easier across repeated assessments,
- distribution across Alone, Group, and Personal class.

### Group statistics

The first group view ranks active members. It offers:

- **This week**, **This month**, **This year**, and **All time** periods;
- **Training time** and **Number of trainings** metrics;
- training time as the default metric;
- top-three member cards followed by the complete list;
- the current member's position even when outside the visible top rows.

The later combined metric may display `3h 31m (4 sessions)` but is not required
for this delivery.

### Counting rules

- Every confirmed participation contributes once to the practitioner.
- All three training contexts contribute.
- Each active direct group may include the member's qualifying activity in its
  ranking, regardless of which context produced the session.
- A group's ranking counts activity only from the interval during which that
  practitioner was an active member of that group.
- Joining a group does not import earlier activity into its historical ranking.
- The coach may still read earlier shared history for development context.
- A member who disables leaderboard visibility remains absent by name but still
  contributes to anonymous group aggregates.

Other students receive only ranking-safe fields: display name, avatar,
graduation when available, position, and selected metric value. They never
receive raw participation rows.

### Query boundary

Database functions return personal summaries and group leaderboard results
after checking the caller's relationship and membership. The browser never
downloads every member's training history to calculate a ranking, and no
client-provided total is trusted.

## Authorization Rules

- A practitioner creates and edits their own Alone occurrence before it is
  finalized, their own participation notes, and their own assessments.
- An active group coach creates Group schedules and confirms attendance only
  for that group.
- A connected coach creates Personal class schedules and feedback only through
  the active direct or group-derived context used.
- Active direct coaches and group coaches read shared training facts for their
  connected students.
- Context-specific feedback uses the narrower feedback rules above.
- Other students read group-member summaries and leaderboard results only.
- Umbrella coaches receive named progress or full details according to the
  existing immediate-parent relationship setting. Identifiable access does not
  cascade through multiple hierarchy levels.
- Service-role credentials are never present in browser code.

Shared helper functions should extend the existing private permission interface
instead of duplicating relationship logic across policies.

## State Integrity and Error Handling

- A practitioner has at most one participation in an occurrence.
- A schedule produces at most one occurrence.
- Cancelled schedules cannot create occurrences or participations.
- Group attendance confirmation is transactional: all requested changes apply
  or none do.
- Repeated requests use idempotency keys or uniqueness constraints and cannot
  duplicate sessions or attendance.
- Published plan versions and historical occurrence snapshots are immutable.
- Statistics are recomputed from source records rather than mutable total rows.
- Ending a connection removes future access immediately without deleting the
  practitioner's history.
- Failed forms preserve entered content, explain the failure, and permit retry.
- Empty calendars and rankings explain how the first record is created.
- Concurrent edits return a recognizable conflict instead of silently
  overwriting newer data.

## Time and Date Rules

- Instants are stored in UTC.
- Schedules, occurrences, and participations preserve their IANA timezone and
  local calendar date.
- Personal calendar placement uses the preserved local date, so travel does
  not move old practice between days.
- Group ranking ranges use the group's timezone.
- Weeks begin Monday in both English and Portuguese interfaces.
- Boundary logic is tested around daylight-saving transitions, month/year
  changes, and sessions near midnight.

## Application Boundaries

The existing dashboard shell remains responsible for session state, profile,
mode, and selected group. New modules have narrower responsibilities:

- relationship service and connection UI,
- plan service and plan editor,
- calendar/history service and calendar view,
- coaching schedule and attendance service,
- statistics service and ranking view.

The dashboard composes these modules but does not absorb their data access or
rendering logic. Each module exposes a small state interface that unit tests can
exercise without Supabase or a browser.

## Verification Strategy

### Database tests

Cover constraints, lifecycle transitions, and RLS for:

- the practitioner,
- an active direct coach,
- an active coach derived through a group,
- another student in the same group,
- an unrelated authenticated account,
- immediate umbrella coaches at each sharing level,
- a second-level ancestor that must not inherit identifiable access.

Tests also cover revoked relationships, cancelled schedules, duplicate
attendance, immutable versions, ranking opt-outs, membership intervals, and
transactional group confirmation.

### Unit tests

Cover calendar range calculations, timezone boundaries, dashboard/mode state,
plan editing state, assessment trends, ranking formatting, and localized labels.

### Browser tests

Exercise these complete flows:

1. Record Alone training and see it on the calendar and in personal totals.
2. Create and accept a direct coaching connection.
3. Arrange and complete a Personal class.
4. Arrange Group training, confirm multiple attendees, and see each history.
5. Add practitioner assessment and context-scoped coach feedback.
6. Switch ranking period and metric and enforce leaderboard opt-out.
7. Prove unrelated users cannot reveal detail by navigating directly or calling
   the public data API.

### Production-readiness checks

Run the full build, unit, browser, database, and security suites; apply migrations
to a clean local database; validate the hosted configuration; and perform a
Google-authenticated preview smoke test before production deployment.

## Delivery Increments

1. **Relationships and secure records:** database schema, helper permissions,
   RLS, storage-independent services, and direct connection flow.
2. **My Training:** calendar, day details, Alone entry, notes, and assessments.
3. **Coaching:** plan editor, scheduling, visibility, completion, attendance,
   and feedback.
4. **Statistics:** personal summaries, group ranking functions, member cards,
   period/metric selectors, and opt-out behavior.

Each increment must pass its database and browser authorization tests before the
next increment begins.

## Acceptance Criteria

The subsystem is complete when:

1. One identity can use My Training and Coaching modes without duplicate
   profile or history records.
2. A practitioner can record Alone training and immediately find it on the
   correct calendar day.
3. An authorized coach can arrange and complete Personal class and Group
   training, while an unauthorized user cannot.
4. Group completion creates exactly one participation for each confirmed
   attendee and none for absent members.
5. Practitioners can record movement difficulty and personal notes.
6. Connected coaches can read permitted history and add feedback only in their
   valid context.
7. Personal statistics and group rankings match confirmed source records for
   every supported period and metric.
8. Leaderboard opt-out hides the member's identity without removing anonymous
   aggregate contribution.
9. English and Portuguese flows are complete, responsive, keyboard-accessible,
   and usable on mobile and desktop.
10. The full local verification suite and authenticated HTTPS preview smoke test
    pass before production deployment.

## Inspiration Assets

The user-supplied interface and movement-art references are stored in the
top-level `Inspiration/` folder with descriptive names. They are internal design
references, not production assets. No referenced image may ship or be reproduced
without confirmed usage rights; future artwork should be original.
