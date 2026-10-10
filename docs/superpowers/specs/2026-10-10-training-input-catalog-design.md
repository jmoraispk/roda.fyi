# Training Input, Movement Catalog, and Class Resources Design

**Status:** Approved conversational design; awaiting review of this written specification.

## Purpose

Practitioners and coaches find composing training in the dashboard awkward.
My Training offers four hardcoded moves in per-row dropdowns, the coach plan
editor offers nine free-typed names with five fields per movement, and the
well-liked public Sequences builder uses a third list and stores its
repertoire only in the browser.

This delivery makes training input fast and natural:

- people **write** what they trained in their own words, round by round;
- a rules-based parser recognizes moves, order, repetitions, and repeat
  groups, and keeps everything it does not recognize;
- one movement catalog backs every picker and every recognized move;
- difficulty is rated per round, and optionally per part of a round;
- saved sequences live in the account;
- each training can carry text resources: a video link, a voice transcript,
  and a summary; and
- coaches can record classes that already happened.

It is the first of several sub-projects. Locations and the class map have
their own specification. Coach scheduling improvements, the coach feed, and
richer profiles follow later.

## Product Principles

1. **Text first.** Free text is the primary input. Pickers and saved
   sequences only insert text. Unrecognized words never block saving.
2. **Keep what was written.** The original text of every round is stored
   unchanged next to its parsed result.
3. **One catalog.** Every recognized move resolves to a catalog slug that
   matches the capture pipeline (`au`, `armada`, `meia-lua-de-compasso`, …).
4. **Precision is optional.** A round needs at most one rating. Rating
   individual parts of a round is available when someone wants it.
5. **No inherited ratings.** A round's difficulty never counts as the
   difficulty of the moves inside it.
6. **Rules first, AI later.** Version 1 parses deterministically in the
   browser. No training text leaves the app.
7. **Text, not files.** Resources are links and text. roda.fyi hosts no video
   or audio.

## Scope

### Included

- Movement catalog module and generator.
- Round notation and rules-based parser, including repeat groups.
- Round cards with live structure chips, a move picker, and repertoire
  insertion, used in My Training and the coach plan editor.
- Planned (coach) and felt (practitioner) difficulty per round, plus an
  optional per-segment sequence strip.
- Account-backed repertoire with a one-time import from browser storage.
- Logging a saved sequence as training.
- Uncatalogued-term curation with a platform curator role.
- Class resources: video link, voice transcript, and markdown summary.
- Recording a past Group or Personal class.
- English and Portuguese copy for all new interfaces. English copy uses
  American spelling.

### Deferred

- AI parsing of training text, transcripts, or summaries.
- Automatic rating from recordings.
- Practitioner self-scheduling and the coach scheduling redesign.
- New movement artwork and video capture for uncatalogued moves.
- Bulk import tooling beyond the manual flows in this document.
- In-app management of the catalog curator role (granted from the SQL editor
  for now).

## Movement Catalog

### Module

`src/app/movement-catalog.js` exposes:

- `listCategories()` — ordered categories with localized labels;
- `listMoves({ category })` — catalog entries;
- `getMove(slug)` — one entry or `null`;
- `matchTable()` — normalized names and aliases for the parser.

Each entry has `slug`, `name`, `aliases`, `category`, and optional pose data
(`pose`, `highlight`) for its figure tile.

### Source and generation

`scripts/build-movement-catalog.mjs` reads `assets/moves.data.js` and the
aliases in `assets/moves.extended.js` in a sandbox and writes
`src/app/generated/movement-catalog.data.js`, which is committed. Slugs use
the existing `slugify` rules from `index.html`. A unit test regenerates the
data in memory and fails when the committed file is stale. `tools/` is not
modified.

The generator appends entries that have no figure yet:

| Category | Entries |
|----------|---------|
| Essentials | Ginga (`ginga`) |
| Arm strikes | Galopante (`galopante`), Godeme (`godeme`), Elbow strike (`elbow-strike`), Escala (`escala`) |

Entries without pose data render a plain placeholder tile.

### Figures

`src/app/ui/move-figure.js` renders the same stick-figure SVG as the public
site's `fig()` from the catalog pose data so dashboard tiles match the
Sequences builder.

## Round Notation and Parser

### Notation

A round's text is a sequence of steps:

```
round  = step (separator step)*
step   = [N "x"] move [modifier] | move "x" N [modifier] | N "x" "(" round ")"
separator = "," | "→" | "->" | "then" | "and then" | "depois" | "e depois"
modifier  = duration such as "10 min" or "30s" | "(" note ")" such as "(left)"
```

Examples:

- `ginga 10 min` — one step with a duration.
- `10x armada` and `armada x10` — one step with ten repetitions.
- `armada, meia lua de compasso → aú` — three steps in order.
- `10x (armada, meia lua de compasso, aú, 3x ginga)` — a repeat group run ten
  times; Ginga is repeated three times inside each pass.

Groups may have any length and may nest. A parenthesis that directly follows a
move is a note, not a group.

### Rounds

`+ Round` creates a new round card. Pasting or typing text containing a blank
line, or a line starting with `Round N`, `R N:`, `Rodada N`, or `N.`, splits it
into consecutive round cards. Each card stores its own text.

### Matching

`src/app/training-text-parser.js` is a pure function:

```js
parseRound(text, { matchTable, termMappings }) → {
  steps,            // tree of move, unknown, and group steps
  warnings,         // e.g. unbalanced parentheses
}
```

- Matching ignores case and accents and treats hyphens and spaces as
  equivalent.
- The longest catalog name or alias wins, so "meia lua de compasso" matches
  before "meia lua".
- A plural `s` after a recognized name is accepted (`10 armadas`).
- Curator term mappings (see Curation) act as extra aliases, merges, or
  ignored terms.
- Text between separators that matches nothing becomes an **unknown step**
  that keeps its original spelling and its position in the sequence. A slug
  derived from the text identifies it (`galopante`).
- Filler words in English and Portuguese (`and`, `e`, `worked on`,
  `trabalhei`, `treino`) are dropped when they surround a step.
- Unbalanced parentheses produce a warning; the remainder is parsed as a plain
  sequence. Parsing never throws on user text.

### Structure chips

Under each round text, chips show the parsed sequence: recognized moves with a
check mark, unknown steps labeled **new**, arrows between steps, and repeat
groups as a bracketed box labeled `×N`. Pressing × on a chip marks that word
"not a move" for this entry only; the text is unchanged and the step is
excluded from the parsed result.

## Input Interface

### Round card

Used by My Training **Record training** and the coach plan editor:

1. Round text box.
2. Structure chips.
3. Difficulty: **Easy / Okay / Hard**. In plans this is the planned
   difficulty; in recorded training it is the felt difficulty. When a round
   comes from a plan, the planned value is shown beside the felt control.
4. **Add moves** — reveals the picker.
5. **Insert saved sequence** and **Save as sequence**.
6. **Rate parts** — reveals the sequence strip.

Only the text box and the round difficulty are visible by default.

### Move picker

The picker reuses the Sequences builder's interaction: category chips (All,
Essentials, Kicks, Dodges, Acrobatics, Takedowns, Arm strikes) above a grid of
figure tiles. Tapping a tile appends the move name to the round text with a
`, ` separator. The picker never holds separate state.

### Sequence strip

**Rate parts** shows the round as segments derived from the parsed steps:

```
[setup] → [Armada] → [transition] → [Meia-lua de compasso] → [transition] → [Aú] → [transition] → [Ginga ×3] → [↺ loop]
```

- **setup** — entering the first move;
- **move** — each move or unknown step;
- **transition** — between consecutive steps;
- **loop** — from the last step of a repeat group back to its first.

Tapping a segment sets Easy, Okay, or Hard and an optional note. Unmarked
segments have no rating. Coaches use the same strip in plans to mark predicted
trouble spots.

Each segment has a stable key derived from its position, for example `s`,
`m:1.3`, `t:1.3>1.4`, and `l:1`. Keys are stable because published plans and
recorded rounds are immutable.

### Forms

- **Record training:** date, duration, round cards, and personal notes.
- **Coach plan editor:** title, expected duration, instructions, and round
  cards. The per-movement side, repetitions, seconds, and instruction fields
  are removed; their information is written in the round text.

## Difficulty and Statistics

- Ratings use the existing `easy`, `okay`, and `hard` scale.
- A round-level rating describes the round only.
- Move statistics use only `move` segment ratings plus historical per-movement
  assessments.
- Transition statistics use only `transition` and `loop` segment ratings. The
  personal statistics view adds **Hardest transitions**, listing move pairs
  with the most Hard ratings.
- **Planned vs. felt** compares a plan's round expectation to the
  practitioner's round rating in day detail.

## Repertoire

### Behavior

- **Signed out:** the public Sequences page stores sequences in
  `localStorage` (`roda.seqs`) as today.
- **Signed in:** saving writes to the account.
- **Import:** on the first signed-in visit, each browser entry is converted to
  notation text (for example `Armada, Aú, Ginga`) and inserted with an import
  reference derived from its content. A browser flag records completion. The
  browser copy is kept and never imported twice; failed imports retry on the
  next visit.
- **Dashboard:** My Training gains a **Repertoire** tab listing saved
  sequences with **Log**, **Rename**, and **Delete**. **Log** opens Record
  training with the sequence in round 1.
- Coaches insert saved sequences into plan rounds with **Insert saved
  sequence**.

### Public page

The Sequences builder keeps its markup and tiles. A new
`src/app/entries/public-sequences.js` bundle reads the shared catalog and
exposes repertoire load, save, and delete operations to the builder. The
builder uses the account when a session exists and `localStorage` otherwise.
All `index.html` changes stay inside the Sequences section and its script.

## Curation

### Curator role

`catalog_curators(profile_id)` lists platform curators. Rows are granted only
through a migration or the database console; there is no interface for
granting the role. The initial curator is the project owner.

### Uncatalogued tab

Curators see a **Catalog** tab next to Calendar and Statistics. It lists every
unknown term with:

- number of distinct people;
- number of uses;
- most common spelling;
- first and last seen dates; and
- a **needs video** tag.

It never shows names, notes, or round text.

Actions:

- **Map to move** — choose a catalog slug. Matching rows across plans and
  occurrences are re-linked to that slug and marked catalogued. Name
  snapshots keep the original spelling.
- **Merge into term** — treat one unknown term as another.
- **Not a move** — the parser ignores it from then on.
- **Needs video** — toggle the filming-list tag.

All actions are curator-only database functions that check the caller's role
in the database.

## Class Resources

### Kinds

| Kind | Content | Icon |
|------|---------|------|
| Video | One `https` link, normally YouTube | 🎥 |
| Voice | Transcript text of a voice recording | 🎙️ |
| Summary | Markdown text | 📄 |

A training may hold any number of each, each with an optional title. roda.fyi
stores links and text only.

### Interface

- Calendar days and training cards show the resource icons present.
- **Add resources** on a training card opens a form: paste a link, or paste or
  choose `.txt` and `.md` files, which are read in the browser and saved as
  text. Several files can be added at once.
- Video opens the link in a new tab with `rel="noopener noreferrer"`.
  Transcripts display as plain text. Summaries render through a restricted
  markdown renderer that escapes HTML and allows headings, paragraphs, lists,
  emphasis, code, and `https` links only.

### Permissions

- Readers: everyone who can read that training's details.
- Writers: the coach who recorded or confirmed a Group or Personal class, the
  practitioner for their own Alone training, and active coaches of the class's
  group.
- Authors may edit and delete their own resources.

## Recording a Past Class

Coaches can record a Group or Personal class that already happened without
scheduling it first:

1. **Record a past class** in Coaching.
2. Choose Group (current group context) or Personal class (a connected
   student).
3. Enter date, start time, duration, optional rounds, and attendees for Group.
4. Optionally add resources in the same flow.

The result is a confirmed occurrence with participations for the chosen
practitioners, created by one transactional function with the same
authorization as completing a scheduled class. The start time must be in the
past. An idempotency key prevents duplicates.

## Data Model

New and changed objects; existing responsibilities are unchanged.

### Rounds

`workout_plan_rounds` and `training_occurrence_rounds` gain:

- `source_text text` — up to 4,000 characters; and
- `sequence jsonb` — the parsed step tree.

### Movements

`workout_plan_movements` and `training_occurrence_movements` keep one row per
move or unknown step in sequence order and gain:

- `catalogued boolean not null default true`; and
- `segment_key text`.

Repetitions store the step's own count; repeat-group counts remain in
`sequence`. The movement-key normalizer strips accents with the `unaccent`
extension so `Aú` becomes `au`.

### Ratings

```
workout_plan_segment_expectations
  plan_round_id, segment_key, segment_kind, difficulty, note,
  from_movement_key, to_movement_key

training_segment_assessments
  participation_id, occurrence_round_id, segment_key, segment_kind,
  difficulty, note, from_movement_key, to_movement_key
```

`segment_kind` is `round`, `setup`, `move`, `transition`, or `loop`.
Transition and loop rows store their neighboring keys. Each table is unique on
its round and segment key, plus participation for assessments. Expectations
are immutable once their plan version is published. Only the participating
practitioner writes assessments. `training_movement_assessments` remains
readable history; new writes use segment assessments.

### Repertoire

```
practice_sequences
  id, profile_id, title, source_text, sequence, import_ref,
  created_at, updated_at
```

`(profile_id, import_ref)` is unique when `import_ref` is present. Text is
limited to 4,000 characters.

### Curation

```
catalog_curators       profile_id, granted_at
catalog_term_mappings  term, action (alias | merge | ignore), target_slug,
                       target_term, needs_video, updated_by, updated_at
```

### Resources

```
training_resources
  id, occurrence_id, kind (video | voice | summary), title, url, body,
  added_by, created_at, updated_at
```

Video rows require an `https` URL of at most 2,048 characters and no body.
Voice and summary rows require a body of at most 262,144 characters and no
URL.

## Authorization

Every new table has row-level security, following
`docs/security-checklist.md`.

| Table | Read | Write |
|-------|------|-------|
| `practice_sequences` | owner | owner |
| `workout_plan_segment_expectations` | readers of the plan | plan editors while draft |
| `training_segment_assessments` | readers of the participation | the participating practitioner |
| `catalog_curators` | curators | none from clients |
| `catalog_term_mappings` | everyone, including anonymous | curator functions only |
| `training_resources` | readers of the training details | writers listed above |

Unknown-term aggregates are returned only by a curator-only function and never
include personal data. New functions reuse the existing private permission
helpers such as `private.can_coach_practitioner`.

## Error Handling

- Parser warnings never block saving.
- Failed saves keep entered content and permit retry.
- Repertoire import failures keep the browser copy and retry later.
- Resource validation errors name the field: link must start with `https://`,
  text too long, or unsupported file type.
- Concurrent plan edits keep the existing conflict behavior.

## Verification

### Unit tests

- Parser: separators, repetitions, durations, notes, nested groups, English
  and Portuguese filler, accents, plurals, longest match, unbalanced
  parentheses, and term mappings.
- Round splitting and segment-key generation.
- Catalog generator freshness, and every figure-bearing catalog slug equal to
  the move slugs in `tools/mocap/sources.json`.
- Round card, picker, strip, repertoire import, and resource form state.
- Restricted markdown renderer escaping.

### Database tests

- Owner-only repertoire and import uniqueness.
- Segment assessments by the participant only; expectations immutable after
  publishing.
- Curator-only functions, aggregate-only term listing, and re-linking on
  mapping.
- Resource read and write permissions across practitioner, direct coach, group
  coach, other student, and unrelated user.
- Past-class recording authorization, past-only start time, and idempotency.
- Accent-stripping movement keys.

### Browser tests

1. Record multi-round training by typing, rate a transition, save, and see it
   in the calendar.
2. Save a sequence signed out, sign in, see it imported once, and log it.
3. Coach plans rounds with predicted difficulty, schedules, and the student
   sees planned and felt difficulty.
4. Coach records a past class with a video link and summary; the student sees
   the icons and opens the summary.
5. Curator maps an unknown term; it becomes a recognized chip.

`npm run test:unit`, `npm run test:e2e`, and `npm run test:db` pass.

## Delivery Increments

1. Catalog, parser, and round cards in Record training.
2. Plan editor round cards, expectations, and the sequence strip.
3. Repertoire table, import, dashboard tab, and public page integration.
4. Curator role and Catalog tab.
5. Class resources and recording past classes.

## Acceptance Criteria

1. My Training, the plan editor, and Sequences use one catalog with matching
   slugs.
2. Free text with separators and repeat groups is parsed into ordered steps;
   unrecognized words are kept and shown as new.
3. The original text of every round is stored and displayed unchanged.
4. Rounds carry planned and felt difficulty; segments can be rated
   individually, and no rating is inherited.
5. Saved sequences follow the account, browser sequences import exactly once,
   and a saved sequence can be logged as training.
6. Only curators see aggregated unknown terms and can map, merge, or ignore
   them.
7. Trainings show video, voice, and summary resources to exactly the people
   allowed to read them.
8. Coaches can record past classes with attendees and resources.
9. English and Portuguese flows are complete, keyboard-accessible, and usable
   on mobile and desktop.
