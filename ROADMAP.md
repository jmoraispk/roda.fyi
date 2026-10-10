# Roadmap

The next major opportunity is to turn the movement library into guided training
experiences. Pose detection is good enough for this direction; the current
bottleneck is reviewing, labelling, and composing movements into useful drills.

## Training coordination and tracking

Build the calendar-centered training platform described in
`docs/superpowers/specs/2026-09-22-training-calendar-statistics-design.md`.

The first delivery includes:

- one identity with My Training and Coaching modes,
- direct and group-derived coach-student connections,
- practitioner-recorded Alone training,
- coach-arranged Group and Personal class training,
- versioned plans, rounds, movement sequences, attendance, and feedback,
- personal statistics and privacy-safe group member rankings,
- This week, This month, This year, and All time ranking periods, and
- Training time and Number of trainings ranking metrics.

A later ranking enhancement may combine both metrics in one label, such as
`3h 31m (4 sessions)`.

Delivered in the training-input increment
(`docs/superpowers/specs/2026-10-10-training-input-catalog-design.md`):

- one movement catalog keyed by capture slug, used by every picker,
- free-text round cards with a rules-based parser and repeat groups,
- planned and felt round difficulty plus per-part ratings,
- an account repertoire with a one-time browser import,
- a curator Catalog tab for uncatalogued moves,
- text class resources (video link, voice transcript, summary), and
- recording past classes.

Next:

- **Locations and class map** (spec pending): coaches' teaching addresses and
  online classes, weekly class times, students' training places, optional home
  location, an address deduplicator, and an OpenStreetMap-based map on the
  public site and in the dashboard.
- **Coach scheduling redesign.**
- **Curator role management in the app.** The role is currently granted only
  from the Supabase SQL editor.
- **AI parsing** of training text, transcripts, and summaries.

## Group communication and richer profiles

After the training core is reliable:

- add a coach news feed with pinned announcements and lightweight reactions,
- enrich profiles with capoeira-relevant details such as apelido, graduation,
  group affiliations, country, and coaching role, and
- redesign member/profile cards around the circular portrait references in
  `Inspiration/dashboard-ui/`.

Billing, tax identifiers, weight, subscriptions, and other fields visible in
the reference application are not planned without a specific roda.fyi need.

## Movement content and original artwork

Continue improving the movement library in parallel:

- add missing arm strikes including galopante, godeme, elbow strike, and escala,
- review names, descriptions, safety notes, and movement phases with a qualified
  capoeira practitioner,
- explore original human-figure sequence illustrations inspired by the
  references in `Inspiration/movement-art/`, and
- do not ship or reproduce the supplied reference artwork without confirmed
  usage rights.

## Training modes

### Two-person training

Create a page where two people can practise a coordinated sequence together.
The experience would place two independently animated figures in the same scene
and synchronize complementary movements—for example, one person performing an
Armada while the other responds with an Aú.

Each combination needs authored labels for:

- the two roles and their movement sequences,
- relative position, distance, and facing,
- timing and synchronization points,
- safe entry, response, and recovery phases.

The same combination should support swapping or mirroring roles so both people
can practise each side.

### Traveling drills

Create a page for exercises that move through physical space instead of staying
in one place. A practitioner with, for example, a 20-metre stretch could choose
a drill designed to cover that distance through repeated movements and
transitions.

Traveling drills need labels for:

- expected displacement and direction per repetition,
- the sequence of movements and transitions,
- required space and target distance,
- when to turn, reset, or switch sides.

## Enabling work

Both modes build on the existing movement animations. The main prerequisite is
a richer labelled library: clean movement ranges, entry and exit stances,
direction and displacement, partner roles, and synchronization points. Once
those labels exist, combinations can be composed without changing the pose
detection pipeline.
