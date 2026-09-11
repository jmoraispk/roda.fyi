# Training Platform Design Decisions

This document records product and architecture decisions approved while the
training platform is being designed. It is a decision log, not yet the complete
implementation specification.

## Decision 1: Group ownership and membership

People sign in through one account and may belong to multiple groups with a
different role in each group.

- A person may register as a coach without platform-administrator approval.
- Coaches may create groups. The creator becomes that group's owner.
- Students and coaches may request access to an existing group.
- Any coach in a group may approve student requests and invite students.
- Only the group owner may approve additional coaches.
- There is no platform-administrator workflow for ordinary group management.

Groups are searchable by name and location by default. An owner may make a
group unlisted, in which case it can be reached only through an invitation link
or code. Public discovery exposes only the group's name, picture, location,
description, and umbrella affiliation—never its membership or training data.

Session feedback is shared between the student and the student's direct group
coaches. Other students cannot see it. The initial version does not include
hidden coach-only notes.

## Decision 2: Hierarchical group associations

Capoeira organizations may contain smaller training groups. For example,
`Shake Up Capoeira` may be an umbrella group containing separately managed
groups led by individual professors.

Groups join a hierarchy through an explicit group-to-group invitation:

1. An umbrella-group owner invites a local training group.
2. The local training-group owner accepts or declines the invitation.
3. Acceptance creates a parent-child association between the groups.
4. The association stores its own upward-sharing permission.

The normal sharing level is **named progress**. Coaches in the umbrella group
may see student names, practice totals, progress summaries, and rankings across
the associated local groups. They cannot see detailed plans, individual
session contents, difficulty ratings, or feedback at this level.

Each association has a **Share full coaching details with umbrella coaches**
toggle. Enabling it gives umbrella coaches access to the local group's detailed
plans, sessions, difficulty ratings, and shared feedback. Only the local group
owner may enable or disable this setting; an umbrella group cannot grant itself
additional access.

Direct coaches retain detailed access to their own students regardless of the
umbrella relationship. Statistics continue to feed upward for comparisons and
rankings according to the accepted association, even when detailed coaching
data is not shared.

Individual leaderboards show members by display name by default. Each member
may opt out of appearing in those rankings. Their activity still contributes
anonymously to their training group's aggregate totals, and opting out does not
change the access their direct coaches need for coaching.

The database should represent hierarchy as relationship records rather than a
single field embedded in a group. This supports invitation state, acceptance,
relationship-specific permissions, and future hierarchy levels without mixing
them into ordinary person-to-group memberships.

Each group may have at most one active parent. A group may still be both a
child and a parent, allowing hierarchies such as local → regional → global.
This keeps each hierarchy a tree, prevents ambiguous access paths, and avoids
counting the same activity more than once in an ancestor's rankings.

Anonymous aggregate statistics roll up through every ancestor in that tree.
Named progress and detailed coaching access apply only to the immediate parent
and never cascade automatically. Attaching a regional group to a global group
therefore cannot expose the local groups' identifiable student data without a
separate, explicit permission model.

The same group hierarchy and membership system should eventually support music
practice. Movement training and music remain separate activity domains while
sharing accounts, groups, permissions, and aggregate reporting infrastructure.

## Decision 3: Universal practitioner accounts and dashboard modes

Every account may record personal training, including accounts that coach or
own groups. Coaching is an additional group capability rather than a mutually
exclusive account type. A member may therefore practice, receive feedback, and
appear in rankings while also coaching other members.

The dashboard uses a binary **My Training / Coaching** mode switch above any
tabs belonging to the selected mode. My Training is always available. A person
without coaching capabilities sees **Register as a coach** in Coaching mode.
Registering as a coach extends the existing profile and enables group creation
and coach-access requests; it does not create a separate account or grant
access to an existing group.

Timezone is an optional profile setting whose default value is **Automatic**.
The browser supplies the initial IANA timezone. Timestamps are stored in UTC,
while practice records preserve their local date and timezone so later travel
does not move historical activity between calendar days.
