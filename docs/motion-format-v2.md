# Motion format v2

Shared contract between the capture tooling (`tools/mocap/`, producer) and the
character/animation side (consumer). One JSON document per **move variant**,
fused from two single-phone takes (front + side) of the same move.

v1 (`assets/moves3d/*.js`, 13 joints, viewBox units) is still produced for the
site's stick figure, but it is now **derived from v2** — see
[Deriving v1](#deriving-v1).

## Files

```
assets/motion/v2/index.json                          # {slug: [variantKey, ...]}
assets/motion/v2/<slug>/<variantKey>.json            # one move variant
```

- `slug` — the move slug used by the site: `slugify(name)` over
  `assets/moves.data.js` (e.g. `au`, `armada`, `meia-lua-de-frente`).
- `variantKey` — `<start>.<middle>.<end>` from the document's `variant` object
  (e.g. `default.default.default`, `ginga-left-back.default.default`). Each part
  is a lowercase slug (`[a-z0-9-]+`); `.` never appears inside a part.

## Document

```jsonc
{
  "version": 2,
  "kind": "move",                       // "move" | "transition" (reserved, see below)
  "slug": "au",
  "variant": { "start": "ginga-left-back", "middle": "default", "end": "default" },
  "fps": 30,
  "units": "m",
  "axes": "x right, y up, z toward viewer",
  "joints": ["pelvis", "left_hip", ... 29 names ...],
  "frames": [ [[x, y, z], ... per joint], ... per frame ],
  "contacts": {
    "left_foot":  [1, 1, 0, ...],       // one 0/1 flag per frame
    "right_foot": [1, 1, 1, ...],
    "left_hand":  [0, 0, 0, ...],
    "right_hand": [0, 0, 0, ...]
  },
  "stances": { "start": "ginga-left-back", "end": "ginga-right-back" },
  "source": {
    "session": "2026-09-24-joao",
    "front": { "video": "front.orig.mov", "rep": 2, "start": 812, "end": 901 },
    "side":  { "video": "side.orig.mov",  "rep": 1, "start": 455, "end": 548 },
    "reps":  { "front": 3, "side": 4 },  // good reps available per view
    "method": "twoview-dtw-fusion/1"
  },
  "quality": {                          // optional, informational
    "dtw_cost": 0.21,
    "reproj_px": { "front": 6.3, "side": 8.1 },
    "fallback": { "x": 0.02, "z": 0.17 } // fraction of joint-frames that used monocular lift
  }
}
```

### Coordinates
- **Units:** metres. **Axes:** right-handed; `x` = right, `y` = up, `z` = toward
  the viewer. The "viewer" is the front camera, so at the start of the move the
  performer faces `+z` and their left hand is on `+x`.
- **Floor:** `y = 0` is the ground plane (robustly estimated from the lowest
  point over the clip, so individual frames may dip a few mm below 0).
- **Origin:** at frame 0 the pelvis sits at `x = 0, z = 0`. Root travel is kept
  (a travelling aú really moves along `x`).
- **Precision:** values are rounded to 3 decimals (1 mm). Every value is finite —
  gaps are filled by the producer.
- `frames.length` is the frame count `F`; every per-frame array (`contacts.*`)
  has length `F`. `frames[f].length == joints.length`.

### Joints
`joints` lists names in this exact order (indices are stable):

| # | name | # | name | # | name |
|---|---|---|---|---|---|
| 0 | pelvis | 10 | left_foot | 20 | left_wrist |
| 1 | left_hip | 11 | right_foot | 21 | right_wrist |
| 2 | right_hip | 12 | neck | 22 | nose |
| 3 | spine1 | 13 | left_collar | 23 | left_ear |
| 4 | left_knee | 14 | right_collar | 24 | right_ear |
| 5 | right_knee | 15 | head | 25 | left_heel |
| 6 | spine2 | 16 | left_shoulder | 26 | right_heel |
| 7 | left_ankle | 17 | right_shoulder | 27 | left_hand_tip |
| 8 | right_ankle | 18 | left_elbow | 28 | right_hand_tip |
| 9 | spine3 | 19 | right_elbow | | |

0–21 are the SMPL body joints (same names/order as SMPL). 22–28 are
orientation helpers so the consumer can recover head yaw, foot pitch and hand
direction, which the SMPL joint positions alone don't pin down.

**Observed vs derived.** The cameras see 17 landmarks directly: nose, ears,
shoulders, elbows, wrists, hand tips (index finger), hips, knees, ankles, heels,
and toes (`left_foot`/`right_foot` = SMPL foot joint ≈ ball of the foot). The
others are geometric estimates from those:

| joint | derivation |
|---|---|
| pelvis | mid-point of the hips |
| spine1 / spine2 / spine3 | 25% / 50% / 75% of the way from pelvis to mid-shoulder |
| neck | 30% of the way from mid-shoulder to head |
| left/right_collar | 40% from mid-shoulder toward the shoulder, pulled 20% toward spine3 |
| head | mid-point of the ears (skull centre) |

Consumers retargeting to a full SMPL rig should treat the derived joints as a
soft hint and the observed ones as ground truth.

### Contacts
`contacts[effector][f] == 1` means that effector is on the ground at frame `f`:
the lowest of its points (foot: ankle/heel/toe; hand: wrist/hand tip) is within a
few cm of the floor **and** nearly stationary. Useful for foot-locking/IK.

### Stances and variants
- `stances.start` / `stances.end` — the base the move starts from / ends in.
  Open vocabulary of lowercase slugs; current names include `ginga-left-back`,
  `ginga-right-back`, `paralela`, `cocorinha`, `negativa-left`,
  `negativa-right`, `stand`. Unknown names must be tolerated.
- `variant` — how this capture varies the move, split into its **start**,
  **middle**, and **end** (e.g. an aú entered from ginga vs from paralela; a
  one-handed vs two-handed middle; landing in negativa vs ginga). `"default"`
  means the standard form for that part. Several variants of one slug are
  separate files.

### Transitions (reserved)
The capture data model already records transition spans (move A → move B).
When they are emitted they will use `"kind": "transition"`, `"slug":
"<from>--to--<to>"`, and extra fields `"from": {"slug", "variant"}` and
`"to": {"slug", "variant"}`; everything else is identical. Consumers that only
handle moves should skip documents whose `kind` isn't `"move"`.

### Versioning
Additive fields may appear without a version bump; consumers must ignore
unknown keys. Any change to joint order, axes, units or required fields bumps
`version`.

## Deriving v1
`uv run tools/mocap/capture_moves.py --from-v2` rebuilds
`assets/moves3d/<slug>.js` for every slug in `assets/motion/v2/`:

1. Map 29 → 13 joints: `head` = mid-ears, `shoulderL/R`, `elbowL/R`,
   `handL/R` = wrists, `hipL/R`, `kneeL/R`, `footL/R` = ankles.
2. Run the existing `retarget.normalize_sequence` (constant 40-unit torso,
   x centred on 60, per-frame grounding at y = 20). Axes already match.
3. Variants: the v2 file whose key is `default.default.default` (or else the
   first) becomes v1 `default`; every v2 variant is also exposed under its
   `variantKey`.

Slugs without a v2 file keep their existing v1 file untouched.
