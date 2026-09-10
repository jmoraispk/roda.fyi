# Roadmap

The next major opportunity is to turn the movement library into guided training
experiences. Pose detection is good enough for this direction; the current
bottleneck is reviewing, labelling, and composing movements into useful drills.

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
