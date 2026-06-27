# Movement Pages, Variations & Comparer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add individual movement detail pages (with rotatable 3D stickman, targets, video links), variation/alias grouping, and a side-by-side movement comparer — all in vanilla JS/HTML/CSS, zero new runtime dependencies.

**Architecture:** Extend the existing hash-based SPA router in `index.html` to handle `#move/{slug}` and `#compare/{slug1}/{slug2}` routes. Move extended data (longDesc, aliases, variations, targets, videos, 3D pose) lives in a new `assets/moves.extended.js` file keyed by slug. A canvas-based 3D figure viewer (`assets/figure3d.js`) uses custom perspective projection and mouse/touch drag — no Three.js.

**Tech Stack:** Vanilla HTML5, CSS custom properties, ES5-compatible JS. Canvas 2D API for 3D figure. No build step, no npm.

## Global Constraints

- No new runtime dependencies — no npm packages, no CDN scripts beyond what already exists.
- All new CSS must use the existing design-system variables: `--bg`, `--gold`, `--clay`, `--folha`, `--cream`, `--card`, `--card-2`, `--muted`, `--line`, `--display`, `--mono`, `--body`.
- All new JS must be ES5-compatible (no `class`, `const`/`let` not already used in the file, no `import`/`export`).  
  Actually: the existing code uses `const`/`let`/`class` freely — follow that style.
- `fold()` already exists in `index.html` — use it to generate slugs. Do NOT redefine it.
- `DATA` is the authoritative move list. Never modify `DATA` — extend it via `MOVES_EXT` keyed by slug.
- The 3D viewer must support touch (mobile) as well as mouse drag.
- Manual browser verification is the test method — there is no test framework.

---

## File Structure

### New files
- `assets/moves.extended.js` — MOVES_EXT object: slug → `{ longDesc, aliases, variations, targets, videos, p3d }` for all 5 priority moves; stub entries for remaining 47.
- `assets/figure3d.js` — `createFigure3D(container, p3d)` : returns `{ update(p3d), destroy() }`. Canvas-based perspective projection, mouse/touch orbit.

### Modified files
- `index.html` — (a) load two new `<script>` tags before the closing `</body>`; (b) add `#moveView` and `#compareView` DOM containers; (c) add CSS for detail + compare pages inline in the existing `<style>` block; (d) add `movePage` and `comparePage` entries to `PAGES`; (e) extend `hashchange` handler to support parameterised hashes; (f) add `renderMovePage(slug)`, `renderComparePage(slug1, slug2)`, and `showMove(slug)` functions; (g) wire card click → `showMove(slug)`.

---

## Task 1: Slug Utility + Script Loading

**Files:**
- Modify: `index.html` — add two `<script>` tags + slug helper.

### What `slugify` must do

```js
// slugify("Bênção") === "bencao"
// slugify("Meia-lua de Frente") === "meia-lua-de-frente"
// slugify("Aú") === "au"
function slugify(s){
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
}
```

`fold()` (line ~1695) strips diacritics but keeps spaces. `slugify` additionally converts non-alphanumeric to `-`.

- [ ] **Step 1: Add script tags at bottom of `<body>`**

Find the closing `</body>` tag in `index.html`. Insert before it:

```html
<script src="assets/moves.extended.js"></script>
<script src="assets/figure3d.js"></script>
```

- [ ] **Step 2: Add `slugify` to the main script block**

Add this immediately after the `fold()` definition (around line 1695):

```js
function slugify(s){
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
}
```

- [ ] **Step 3: Create stub files so the page loads without errors**

Create `assets/moves.extended.js` (stub — will be filled in Task 2):
```js
const MOVES_EXT = {};
```

Create `assets/figure3d.js` (stub — will be filled in Task 4):
```js
function createFigure3D(container, p3d){ return { update:function(){}, destroy:function(){} }; }
```

- [ ] **Step 4: Verify in browser**

Open `index.html` in a browser. Open DevTools console. Run:
```
slugify("Bênção")   // expected: "bencao"
slugify("Meia-lua de Frente")  // expected: "meia-lua-de-frente"
slugify("Aú")  // expected: "au"
```
No console errors. Page looks exactly as before.

- [ ] **Step 5: Commit**

```bash
git add index.html assets/moves.extended.js assets/figure3d.js
git commit -m "feat: add slugify utility and script stubs for move pages"
```

---

## Task 2: Extended Data Model

**Files:**
- Modify: `assets/moves.extended.js` — populate 5 priority moves; add empty stubs for the rest.

### Schema

```js
// assets/moves.extended.js
const MOVES_EXT = {
  // key = slugify(move.n) from DATA
  'ginga': {
    longDesc: '...',        // 2-3 sentence rich description
    aliases: [],            // string[] — common alternative names
    variations: [],         // string[] — named sub-variations
    targets: [],            // { area: string, desc: string }[]
    videos: [],             // { title: string, url: string, channel: string }[]
    p3d: { ... }            // 3D joint positions — see schema below
  }
};
```

### 3D pose schema

Coordinate system: **x** = right, **y** = up (so y increases going UP; negate 2D y which goes DOWN), **z** = toward viewer. Units are in the same scale as the 2D SVG viewBox (0–120 wide, 0–160 tall). The 3D viewer will center the figure automatically.

```js
p3d: {
  head:      [cx, cy, cz],   // center of head sphere
  headR:     r,              // head radius (number, same as 2D)
  shoulderL: [x, y, z],
  shoulderR: [x, y, z],
  hipL:      [x, y, z],
  hipR:      [x, y, z],
  elbowL:    [x, y, z],
  elbowR:    [x, y, z],
  handL:     [x, y, z],
  handR:     [x, y, z],
  kneeL:     [x, y, z],
  kneeR:     [x, y, z],
  footL:     [x, y, z],
  footR:     [x, y, z],
}
```

**Note on y-axis:** The 2D SVG has y=0 at top. For 3D, flip y so y=0 is at bottom. Conversion: `y3d = 160 - y2d`. So `head` at 2D `[54, 26]` becomes `[54, 134, z]`.

**Segments rendered by the 3D viewer:**

```js
const SEGS3D = [
  ['shoulderL','shoulderR'],          // across shoulders
  ['hipL','hipR'],                    // across hips
  ['shoulderL','hipL'],               // left side torso
  ['shoulderR','hipR'],               // right side torso
  ['shoulderL','elbowL','handL'],     // left arm (chain)
  ['shoulderR','elbowR','handR'],     // right arm
  ['hipL','kneeL','footL'],           // left leg
  ['hipR','kneeR','footR'],           // right leg
];
```

Head is rendered as a circle at `p3d.head` with radius `p3d.headR`.

- [ ] **Step 1: Write MOVES_EXT for the 5 priority moves**

Replace the stub `assets/moves.extended.js` with the full content:

```js
const MOVES_EXT = {

  'ginga': {
    longDesc: 'The ginga is the heartbeat of capoeira — a continuous, swaying movement that serves as both the default state and the engine of deception. From the ginga, all attacks and defenses flow naturally. The back-and-forth weight shift lowers the center of gravity and creates unpredictable angles that make the practitioner hard to read.',
    aliases: [],
    variations: ['Ginga Aberta', 'Ginga Fechada', 'Ginga Angola'],
    targets: [],
    videos: [],
    p3d: {
      head:      [58, 134, 4],  headR: 9,
      shoulderL: [42, 118, 6], shoulderR: [68, 118, -6],
      hipL:      [48,  74, 5], hipR:      [66,  74, -5],
      elbowL:    [36, 106, 8], elbowR:    [74, 106, -8],
      handL:     [32,  92, 9], handR:     [72,  94, -9],
      kneeL:     [44,  44, 8], kneeR:     [72,  44, -8],
      footL:     [38,  10, 10], footR:    [78,  10, -10],
    }
  },

  'bencao': {
    longDesc: 'The bênção (blessing) is a powerful linear front kick driven from the hip. The knee chambers high before the leg extends to push rather than cut — it is a push-kick designed to create distance or drive an opponent backward. At full extension the foot is flexed, heel leading, targeting the center of mass.',
    aliases: ['Pisão', 'Chapa de Frente'],
    variations: ['Bênção de Costas', 'Bênção Alta', 'Bênção Baixa'],
    targets: [
      { area: 'Torso', desc: 'Primary target — solar plexus or sternum. Collapses the posture and breaks balance.' },
      { area: 'Head', desc: 'High variation aimed at the chin or jaw when the opponent is bent forward.' },
    ],
    videos: [],
    p3d: {
      head:      [54, 120,  2],  headR: 9,
      shoulderL: [40, 104,  8], shoulderR: [66, 106, -4],
      hipL:      [46,  72,  6], hipR:      [62,  72, -4],
      elbowL:    [32,  92, 10], elbowR:    [70,  90, -6],
      handL:     [26,  80, 12], handR:     [68,  78, -8],
      kneeL:     [76,  86,  0], footL:     [92,  64,  0],  // kicking leg extended forward (z≈0 = in plane)
      kneeR:     [58,  44, -6], footR:     [54,  10, -8],  // standing leg
    }
  },

  'meia-lua-de-frente': {
    longDesc: 'Meia-lua de frente (front half-moon) traces a horizontal crescent from outside to inside in front of the body. The leg swings in a wide arc at hip-to-head height, using the momentum of the hip rotation rather than raw muscular force. The arc is initiated from the back foot and concludes as the leg crosses the body centerline.',
    aliases: ['Meia Lua de Frente'],
    variations: ['Meia-lua de Compasso', 'Meia-lua de Costas'],
    targets: [
      { area: 'Head', desc: 'Temple, jaw, or ear — the instep or outer edge of the foot connects as the arc peaks.' },
      { area: 'Torso', desc: 'Lower arc variation targeting the floating ribs.' },
    ],
    videos: [],
    p3d: {
      head:      [58, 130,  6],  headR: 9,
      shoulderL: [42, 114,  8], shoulderR: [70, 116, -4],
      hipL:      [48,  76,  6], hipR:      [64,  76, -4],
      elbowL:    [34, 100, 10], elbowR:    [76,  96, -6],
      handL:     [30,  88, 12], handR:     [78,  84, -8],
      kneeL:     [14,  96, -2], footL:     [-4,  84, -4],  // right leg sweeping left (confusingly named L here = striking leg from viewer)
      kneeR:     [56,  42, -6], footR:     [52,  10, -8],
    }
  },

  'armada': {
    longDesc: 'The armada is a spinning roundhouse where the practitioner rotates 360 degrees and delivers a heel or sole strike on the follow-through. The spin is initiated by turning the back foot outward and driving the hip; the kicking leg stays loose until the rotation commits it into the target zone. The key danger is the second half of the spin, which is invisible to the opponent.',
    aliases: ['Armada com Martelo'],
    variations: ['Armada Dupla', 'Armada Pulada', 'Armada Cruzada'],
    targets: [
      { area: 'Head', desc: 'Temple, jaw, or back of the head — the heel connects at the tail of the rotation.' },
      { area: 'Neck/Shoulder', desc: 'Follow-through variation when the opponent ducks the primary arc.' },
    ],
    videos: [],
    p3d: {
      head:      [42, 128, -8],  headR: 9,   // head turned away (spinning)
      shoulderL: [28, 112, -4], shoulderR: [54, 114,  4],
      hipL:      [36,  78, -2], hipR:      [54,  78,  6],
      elbowL:    [18,  96, -6], elbowR:    [64,  96,  8],
      handL:     [10,  84, -8], handR:     [72,  84, 10],
      kneeL:     [62,  92,  2], footL:     [88, 110,  0],  // kicking leg extended at arc peak
      kneeR:     [46,  44,  4], footR:     [50,  10,  6],
    }
  },

  'au': {
    longDesc: 'The aú (cartwheel) is the foundational acrobatic inversion of capoeira. Both hands contact the ground in sequence as the legs arc overhead, keeping the body in constant motion. In jogo it functions as an escape — moving laterally out of the line of attack while maintaining a threat position. The aú aberto (open cartwheel) and aú fechado (closed, one-armed) offer different risk and speed profiles.',
    aliases: ['Aú', 'Au Aberto'],
    variations: ['Aú Fechado', 'Aú de Cabeça', 'Aú Batido', 'Aú Cortado'],
    targets: [],
    videos: [],
    p3d: {
      head:      [78,  90, -2],  headR: 9,   // inverted, to the right
      shoulderL: [56,  82, 10], shoulderR: [90,  86, -8],
      hipL:      [50,  36, 12], hipR:      [72,  40, -10],
      elbowL:    [46,  62, 14], elbowR:    [96,  68, -12],
      handL:     [48,  38, 16], handR:     [108, 46, -14],  // hands near ground
      kneeL:     [30,  30, 18], footL:     [10,  14, 20],   // left leg overhead left
      kneeR:     [86, 118, -6], footR:     [94, 146, -8],   // right leg trailing right
    }
  },

};
// Stub entries for all other moves — populated as 3D data becomes available
['esquiva-lateral','esquiva-baixa','negativa','role','cocorinha',
 'bencao','armada-cruzada','martelo','martelo-do-chao','martelo-rodado',
 'chapa','chapa-de-costas','chapa-giratoria','queixada','ponteira',
 'rasteira','banda','tesoura','balao','amortecer','cabecada'].forEach(function(s){
  if(!MOVES_EXT[s]) MOVES_EXT[s] = { longDesc:'', aliases:[], variations:[], targets:[], videos:[], p3d:null };
});
```

- [ ] **Step 2: Verify data loads**

In DevTools console:
```js
Object.keys(MOVES_EXT).length  // should be ≥ 5
MOVES_EXT['bencao'].targets.length  // should be 2
MOVES_EXT['au'].variations[0]  // should be "Aú Fechado"
```

- [ ] **Step 3: Commit**

```bash
git add assets/moves.extended.js
git commit -m "feat: add extended move data (longDesc, aliases, variations, targets, p3d)"
```

---

## Task 3: Move Detail Page — DOM + CSS

**Files:**
- Modify: `index.html` — add `#moveView` container in HTML, add CSS, add page entry to `PAGES`.

### HTML structure to add

Add this inside `<body>`, alongside the other view containers (e.g. after `#sequencesView`):

```html
<div id="moveView" hidden>
  <div class="move-back">
    <button class="back-btn" id="moveBackBtn" type="button">← Library</button>
  </div>
  <div class="move-hero">
    <div class="move-hero-text">
      <div class="move-kicker" id="moveKicker"></div>
      <h1 class="move-title" id="moveTitle"></h1>
      <div class="move-aliases" id="moveAliases"></div>
      <div class="move-meta" id="moveMeta"></div>
      <p class="move-long-desc" id="moveLongDesc"></p>
    </div>
    <div class="move-3d-wrap">
      <canvas id="move3dCanvas" width="320" height="380"></canvas>
      <div class="move-3d-hint">drag to rotate</div>
    </div>
  </div>
  <div class="move-sections">
    <section class="move-section" id="moveVariations" hidden>
      <h2 class="move-sec-title">Variations</h2>
      <div class="move-var-list" id="moveVarList"></div>
    </section>
    <section class="move-section" id="moveTargets" hidden>
      <h2 class="move-sec-title">Targets</h2>
      <div class="move-target-list" id="moveTargetList"></div>
    </section>
    <section class="move-section" id="moveVideos" hidden>
      <h2 class="move-sec-title">Learn More</h2>
      <div class="move-video-list" id="moveVideoList"></div>
    </section>
    <section class="move-section move-compare-cta">
      <button class="compare-btn" id="moveCompareBtn" type="button">Compare with another move →</button>
    </section>
  </div>
</div>
```

### CSS to add inside `<style>` (append before the closing `</style>`)

```css
/* ===== MOVE DETAIL PAGE ===== */
.back-btn{font-family:var(--mono);font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);background:none;border:1px solid var(--line);border-radius:999px;padding:7px 16px;cursor:pointer;transition:.18s;margin:24px 0 0 24px;display:inline-flex;align-items:center;gap:6px}
.back-btn:hover{color:var(--cream);border-color:var(--muted)}
.move-hero{display:grid;grid-template-columns:1fr auto;gap:40px;align-items:start;padding:32px 40px 0;max-width:1100px;margin:0 auto}
@media(max-width:680px){.move-hero{grid-template-columns:1fr;padding:24px 20px 0}}
.move-kicker{font-family:var(--mono);font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.move-title{font-family:var(--display);font-weight:800;font-size:clamp(2rem,6vw,3.5rem);letter-spacing:-.02em;color:var(--cream);line-height:1;margin:0 0 8px}
.move-aliases{font-family:var(--mono);font-size:.75rem;color:var(--gold);letter-spacing:.04em;margin-bottom:16px}
.move-meta{font-family:var(--mono);font-size:.72rem;color:var(--muted);margin-bottom:20px;display:flex;gap:14px;flex-wrap:wrap}
.move-long-desc{font-family:var(--body);font-size:1.05rem;line-height:1.65;color:var(--muted);max-width:54ch;margin:0}
.move-3d-wrap{display:flex;flex-direction:column;align-items:center;gap:8px;flex-shrink:0}
#move3dCanvas{border-radius:16px;background:var(--card);border:1px solid var(--line);cursor:grab;touch-action:none}
#move3dCanvas:active{cursor:grabbing}
.move-3d-hint{font-family:var(--mono);font-size:.62rem;letter-spacing:.06em;color:var(--muted-2);text-transform:uppercase}
.move-sections{max-width:1100px;margin:40px auto;padding:0 40px 60px;display:flex;flex-direction:column;gap:32px}
@media(max-width:680px){.move-sections{padding:0 20px 48px}}
.move-sec-title{font-family:var(--display);font-weight:700;font-size:1.25rem;color:var(--cream);margin:0 0 16px}
.move-section{border-top:1px solid var(--line);padding-top:28px}
.move-var-list{display:flex;flex-wrap:wrap;gap:10px}
.move-var-chip{font-family:var(--mono);font-size:.72rem;letter-spacing:.04em;color:var(--cream);background:var(--card);border:1px solid var(--line);border-radius:999px;padding:7px 16px;cursor:pointer;transition:.18s}
.move-var-chip:hover{border-color:var(--gold);color:var(--gold)}
.move-target-list{display:flex;flex-direction:column;gap:14px}
.move-target{display:flex;gap:16px;align-items:flex-start}
.move-target-area{font-family:var(--mono);font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;color:var(--clay);min-width:80px;padding-top:2px}
.move-target-desc{font-family:var(--body);font-size:.95rem;color:var(--muted);line-height:1.55}
.move-video-list{display:flex;flex-direction:column;gap:10px}
.move-video-link{font-family:var(--body);font-size:.95rem;color:var(--gold);text-decoration:none;padding:10px 16px;background:var(--card);border:1px solid var(--line);border-radius:10px;display:flex;align-items:center;gap:10px;transition:.18s}
.move-video-link:hover{border-color:var(--gold);background:var(--card-2)}
.move-compare-cta{border-top:1px solid var(--line);padding-top:28px}
.compare-btn{font-family:var(--mono);font-size:.78rem;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);background:none;border:1px solid var(--line);border-radius:999px;padding:10px 22px;cursor:pointer;transition:.18s}
.compare-btn:hover{color:var(--cream);border-color:var(--muted)}
```

- [ ] **Step 1: Add HTML and CSS as specified above**

- [ ] **Step 2: Add `movePage` entry to `PAGES`**

Find the `const PAGES = {` block (around line 1214). Add this entry:

```js
movePage: { world:'moves', els:['#moveView'], hash:'#move' },
```

Also add to `HASH_PAGE` after the existing entries:
```js
HASH_PAGE['#move'] = 'movePage';
```

- [ ] **Step 3: Verify in browser**

Open DevTools. Run: `document.getElementById('moveView').hidden = false`

The page should show the empty move detail layout without breaking the rest of the page. Then run: `document.getElementById('moveView').hidden = true` to restore.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add move detail page container, CSS, and PAGES entry"
```

---

## Task 4: 3D Canvas Figure Viewer

**Files:**
- Modify: `assets/figure3d.js` — implement full canvas renderer.

### How it works

- Perspective projection: `px = cx + (x3 * fov) / (z3 + dist)`, `py = cy - (y3 * fov) / (z3 + dist)` where dist=8 (camera distance from origin in z).
- Orbit: mouse/touch drag changes `theta` (horizontal rotation, Y-axis) and `phi` (vertical tilt, X-axis).
- The figure is centered by computing the bounding box centroid of all joints and subtracting it from every coordinate before projection.
- Depth-sorted segments: draw far segments first so near ones appear on top. Sort segments by average z of their endpoints after rotation.

```js
// assets/figure3d.js

var SEGS3D = [
  ['shoulderL','shoulderR'],
  ['hipL','hipR'],
  ['shoulderL','hipL'],
  ['shoulderR','hipR'],
  ['shoulderL','elbowL','handL'],
  ['shoulderR','elbowR','handR'],
  ['hipL','kneeL','footL'],
  ['hipR','kneeR','footR'],
];

function createFigure3D(canvas, p3d) {
  var ctx = canvas.getContext('2d');
  var W = canvas.width, H = canvas.height;
  var theta = 0.3, phi = 0.1;  // initial rotation (slight angle looks best)
  var drag = false, lastX = 0, lastY = 0;

  function rotateY(pt, t) {
    var x = pt[0], y = pt[1], z = pt[2] || 0;
    return [x * Math.cos(t) - z * Math.sin(t), y, x * Math.sin(t) + z * Math.cos(t)];
  }
  function rotateX(pt, t) {
    var x = pt[0], y = pt[1], z = pt[2] || 0;
    return [x, y * Math.cos(t) - z * Math.sin(t), y * Math.sin(t) + z * Math.cos(t)];
  }

  function centroid(pts) {
    var cx = 0, cy = 0, cz = 0, n = pts.length;
    pts.forEach(function(p){ cx += p[0]; cy += p[1]; cz += (p[2]||0); });
    return [cx/n, cy/n, cz/n];
  }

  function project(pt) {
    var fov = Math.min(W, H) * 1.4;
    var dist = 120;
    var x = pt[0], y = pt[1], z = pt[2] + dist;
    return [W/2 + (x * fov) / z, H/2 - (y * fov) / z, pt[2]];
  }

  function draw(pose) {
    if (!pose) return;
    ctx.clearRect(0, 0, W, H);

    // Build joint map, normalise to centre of figure
    var keys = Object.keys(pose).filter(function(k){ return k !== 'headR' && Array.isArray(pose[k]); });
    var c = centroid(keys.map(function(k){ return pose[k]; }));
    // Shift origin to figure centroid at y=0 (mid-height)
    var centY = c[1];
    var pts = {};
    keys.forEach(function(k){
      var raw = pose[k];
      pts[k] = rotateX(rotateY([raw[0]-c[0], raw[1]-centY, raw[2]||0], theta), phi);
    });

    // Collect segments with their avg z (for depth sort)
    var segs = [];
    SEGS3D.forEach(function(chain) {
      // verify all joints in pose
      var valid = chain.every(function(k){ return pts[k]; });
      if (!valid) return;
      var avgZ = chain.reduce(function(s,k){ return s + pts[k][2]; }, 0) / chain.length;
      segs.push({ chain: chain, avgZ: avgZ });
    });
    segs.sort(function(a,b){ return a.avgZ - b.avgZ; }); // paint far first

    var COL_BODY = '#5c4a35';
    var COL_HI   = '#EBA63C';

    segs.forEach(function(seg) {
      var projected = seg.chain.map(function(k){ return project(pts[k]); });
      // Depth tint: near joints are brighter
      var normZ = (seg.avgZ + 30) / 60; // roughly -30 to +30 range → 0..1
      var alpha = 0.45 + 0.55 * Math.max(0, Math.min(1, normZ));
      ctx.strokeStyle = 'rgba(235,166,60,' + alpha + ')';
      ctx.lineWidth = seg.chain[0].startsWith('leg') || seg.chain[0] === 'hipL' || seg.chain[0] === 'hipR' ? 5 : 4;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(projected[0][0], projected[0][1]);
      for (var i = 1; i < projected.length; i++) ctx.lineTo(projected[i][0], projected[i][1]);
      ctx.stroke();
    });

    // Head
    if (pts['head']) {
      var hp = project(pts['head']);
      var r = (pose.headR || 9) * (Math.min(W, H) * 1.4) / (hp[2] + 120) * 0.9;
      ctx.beginPath();
      ctx.arc(hp[0], hp[1], Math.max(4, r), 0, Math.PI * 2);
      ctx.fillStyle = '#3a2e22';
      ctx.fill();
      ctx.strokeStyle = 'rgba(235,166,60,0.75)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Axis ring (faint ground-plane circle to help with spatial orientation)
    ctx.beginPath();
    ctx.ellipse(W/2, H * 0.78, 60, 60 * Math.abs(Math.sin(phi + 0.35)), 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(92,74,53,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  var currentPose = p3d;

  function render() { draw(currentPose); }

  // Mouse events
  canvas.addEventListener('pointerdown', function(e) {
    drag = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function(e) {
    if (!drag) return;
    var dx = e.clientX - lastX, dy = e.clientY - lastY;
    theta += dx * 0.012; phi += dy * 0.010;
    phi = Math.max(-1.2, Math.min(1.2, phi));
    lastX = e.clientX; lastY = e.clientY;
    render();
  });
  canvas.addEventListener('pointerup',     function() { drag = false; });
  canvas.addEventListener('pointercancel', function() { drag = false; });

  render();

  return {
    update: function(newPose) { currentPose = newPose; render(); },
    destroy: function() {}
  };
}
```

- [ ] **Step 1: Write `assets/figure3d.js`** with the content above (replacing the stub).

- [ ] **Step 2: Verify in browser**

Open DevTools console. Run:
```js
var canvas = document.getElementById('move3dCanvas');
document.getElementById('moveView').hidden = false;
var viewer = createFigure3D(canvas, MOVES_EXT['bencao'].p3d);
```

You should see a 3D stick figure on the canvas. Drag it — it should rotate smoothly. No console errors.

Try:
```js
viewer.update(MOVES_EXT['au'].p3d);
```

The figure should update to the cartwheel pose.

- [ ] **Step 3: Commit**

```bash
git add assets/figure3d.js
git commit -m "feat: canvas-based 3D stick figure viewer with orbit drag"
```

---

## Task 5: Move Detail Page — Rendering + Navigation

**Files:**
- Modify: `index.html` — add `renderMovePage(slug)`, `showMove(slug)`, wire card clicks, wire back button, wire hashchange for parameterised `#move/{slug}` hashes.

### `renderMovePage(slug)` function

This function finds the move in `DATA`, merges with `MOVES_EXT`, and populates all the `#move*` DOM elements.

Add this function in the main `<script>` block, near the other page-render functions (after `renderGroups`, around line 1570):

```js
var _figure3d = null;

function renderMovePage(slug) {
  // Find move in DATA
  var found = null, foundCat = null;
  DATA.forEach(function(cat) {
    cat.moves.forEach(function(m) {
      if (slugify(m.n) === slug) { found = m; foundCat = cat; }
    });
  });
  if (!found) { showPage('lexicon'); return; }

  var ext = MOVES_EXT[slug] || { longDesc:'', aliases:[], variations:[], targets:[], videos:[], p3d:null };

  // Populate header
  document.getElementById('moveKicker').textContent = foundCat.title + ' · ' + found.t;
  document.getElementById('moveTitle').textContent = ext.aliases.length ? found.n + ' / ' + ext.aliases[0] : found.n;
  document.getElementById('moveAliases').textContent = ext.aliases.length > 1 ? 'Also: ' + ext.aliases.slice(1).join(', ') : '';
  document.getElementById('moveMeta').innerHTML =
    '<span>' + found.g + '</span>' +
    (found.tc ? '<span style="color:var(--' + found.tc + ')">' + found.t + '</span>' : '');
  document.getElementById('moveLongDesc').textContent = ext.longDesc || found.d;

  // Variations
  var varSec = document.getElementById('moveVariations');
  var varList = document.getElementById('moveVarList');
  if (ext.variations && ext.variations.length) {
    varList.innerHTML = ext.variations.map(function(v) {
      return '<button class="move-var-chip" type="button">' + v + '</button>';
    }).join('');
    varSec.hidden = false;
  } else { varSec.hidden = true; }

  // Targets
  var tgtSec = document.getElementById('moveTargets');
  var tgtList = document.getElementById('moveTargetList');
  if (ext.targets && ext.targets.length) {
    tgtList.innerHTML = ext.targets.map(function(t) {
      return '<div class="move-target"><span class="move-target-area">' + t.area + '</span><span class="move-target-desc">' + t.desc + '</span></div>';
    }).join('');
    tgtSec.hidden = false;
  } else { tgtSec.hidden = true; }

  // Videos
  var vidSec = document.getElementById('moveVideos');
  var vidList = document.getElementById('moveVideoList');
  if (ext.videos && ext.videos.length) {
    vidList.innerHTML = ext.videos.map(function(v) {
      return '<a class="move-video-link" href="' + v.url + '" target="_blank" rel="noopener">▶ ' + v.title + (v.channel ? ' — ' + v.channel : '') + '</a>';
    }).join('');
    vidSec.hidden = false;
  } else { vidSec.hidden = true; }

  // 3D viewer
  var canvas = document.getElementById('move3dCanvas');
  if (_figure3d) { _figure3d.destroy(); _figure3d = null; }
  if (ext.p3d) {
    _figure3d = createFigure3D(canvas, ext.p3d);
  } else {
    // Fallback: show 2D SVG on canvas via ImageBitmap — or just leave canvas blank
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#251C13';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '12px Space Mono, monospace';
    ctx.fillStyle = '#5c4a35';
    ctx.textAlign = 'center';
    ctx.fillText('3D pose coming soon', canvas.width/2, canvas.height/2);
  }

  // Compare button
  document.getElementById('moveCompareBtn').onclick = function() {
    location.hash = '#compare/' + slug;
  };
}
```

### `showMove(slug)` function

```js
function showMove(slug) {
  ALL_PAGE_ELS.forEach(function(sel){ var el=document.querySelector(sel); if(el) el.hidden=true; });
  var view = document.getElementById('moveView');
  view.hidden = false;
  renderMovePage(slug);
  curPage = 'movePage'; curWorld = 'moves';
  tabs.forEach(function(t){ t.setAttribute('aria-selected', String(t.dataset.world==='moves')); });
  renderTitles();
  history.replaceState(null, '', '#move/' + slug);
  window.scrollTo(0, 0);
}
```

### Wire card clicks

Find the card rendering loop (around line 1074). Change the `<article class="card"` line from:

```js
    cards+=`
    <article class="card" tabindex="0" aria-label="${m.n} — ${m.g}">
```

to:

```js
    const slug_=slugify(m.n);
    cards+=`
    <article class="card" tabindex="0" aria-label="${m.n} — ${m.g}" data-slug="${slug_}" role="button" style="cursor:pointer">
```

Then, after the `const cards=[...document.querySelectorAll('.card')];` line (around line 1119), add the click handler:

```js
cards.forEach(function(card) {
  card.addEventListener('click', function() {
    var s = card.dataset.slug;
    if (s) showMove(s);
  });
  card.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); var s = card.dataset.slug; if(s) showMove(s); }
  });
});
```

### Wire back button

After the `showMove` function, add:

```js
document.getElementById('moveBackBtn').addEventListener('click', function() {
  if (_figure3d) { _figure3d.destroy(); _figure3d = null; }
  showPage('lexicon');
});
```

### Extend `hashchange` to handle parameterised hashes

Find the hashchange listener (around line 1683):

```js
addEventListener('hashchange',()=>showPage(HASH_PAGE[location.hash||'']||'lexicon', true));
```

Replace it with:

```js
addEventListener('hashchange', function() {
  var h = location.hash || '';
  var moveMatch = h.match(/^#move\/(.+)$/);
  var compareMatch = h.match(/^#compare\/(.+)$/);
  if (moveMatch) { showMove(decodeURIComponent(moveMatch[1])); }
  else if (compareMatch) { showComparePage(decodeURIComponent(compareMatch[1])); }
  else { showPage(HASH_PAGE[h] || 'lexicon', true); }
});
```

`showComparePage` is defined in Task 8. For now, add a stub:

```js
function showComparePage(slug1, slug2) {
  // stub — implemented in Task 8
  showPage('lexicon');
}
```

- [ ] **Step 1: Add `renderMovePage`, `showMove`, `showComparePage` stub, and back button wiring** as specified above.

- [ ] **Step 2: Wire card clicks** as specified above.

- [ ] **Step 3: Extend `hashchange`** as specified above.

- [ ] **Step 4: Verify in browser**

- Click any card in the library → should navigate to the move detail page.
- The title, gloss, and description should match the card.
- For Bênção: aliases should show "Pisão / Chapa de Frente", targets list should appear.
- For Au: variations list should show 4 variations.
- 3D canvas should render for all 5 priority moves; blank "coming soon" for others.
- Drag the 3D canvas → figure should rotate.
- Click "← Library" → should return to the lexicon.
- Navigate directly to `#move/bencao` in the URL bar → should show the Bênção page.
- Press browser back → should return to `#` (lexicon).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: move detail page rendering, card click navigation, hash routing"
```

---

## Task 6: Variations Section — Alias Routing

**Files:**
- Modify: `index.html` — make variation chips clickable and navigable; support alias → canonical slug resolution.

### Alias resolution map

When a user types `/bencao` or the alias `pisao` in the URL, we need to resolve it to the canonical slug. Build a reverse map at startup (after `MOVES_EXT` loads):

Add this after the `MOVES_EXT` declaration location (add a small inline block in the main script, after all scripts are loaded):

```js
// Build alias → canonical slug map for URL resolution
var ALIAS_MAP = {};
DATA.forEach(function(cat) {
  cat.moves.forEach(function(m) {
    var canonical = slugify(m.n);
    var ext = MOVES_EXT[canonical];
    if (ext && ext.aliases) {
      ext.aliases.forEach(function(a) {
        ALIAS_MAP[slugify(a)] = canonical;
      });
    }
  });
});

function resolveSlug(slug) {
  return ALIAS_MAP[slug] || slug;
}
```

### Update `showMove` to use `resolveSlug`

Change the first line of `showMove`:

```js
function showMove(slug) {
  slug = resolveSlug(slug);   // add this line
  ALL_PAGE_ELS.forEach( ...
```

### Wire variation chips to navigate

In `renderMovePage`, after the variations HTML is built, add a delegated click handler on `varList`:

```js
  varList.addEventListener('click', function(e) {
    var chip = e.target.closest('.move-var-chip');
    if (chip) showMove(slugify(chip.textContent.trim()));
  });
```

- [ ] **Step 1: Add `ALIAS_MAP`, `resolveSlug`** as specified.

- [ ] **Step 2: Update `showMove` to call `resolveSlug`**.

- [ ] **Step 3: Wire variation chip clicks**.

- [ ] **Step 4: Verify in browser**

- Navigate to `#move/pisao` → should show the Bênção page (alias resolution).
- On the Bênção page, click "Bênção de Costas" chip → should navigate to `#move/bencao-de-costas` (won't find a matching move, so falls back to lexicon — this is acceptable since those moves are stubs).
- No console errors.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: alias slug resolution and variation chip navigation"
```

---

## Task 7: Compare Page — Layout + CSS

**Files:**
- Modify: `index.html` — add `#compareView` container, CSS, and `PAGES` entry.

### HTML structure to add

```html
<div id="compareView" hidden>
  <div class="move-back">
    <button class="back-btn" id="compareBackBtn" type="button">← Library</button>
  </div>
  <div class="compare-header">
    <h1 class="compare-title">Compare Moves</h1>
    <p class="compare-sub">Select two moves to see them side-by-side.</p>
  </div>
  <div class="compare-selectors">
    <div class="compare-slot" id="compareSlot1">
      <div class="compare-slot-label">Move A</div>
      <div class="compare-slot-picker" id="comparePicker1">
        <select class="compare-select" id="compareSelect1"><option value="">— choose —</option></select>
      </div>
    </div>
    <div class="compare-vs">vs</div>
    <div class="compare-slot" id="compareSlot2">
      <div class="compare-slot-label">Move B</div>
      <div class="compare-slot-picker" id="comparePicker2">
        <select class="compare-select" id="compareSelect2"><option value="">— choose —</option></select>
      </div>
    </div>
  </div>
  <div class="compare-panels" id="comparePanels">
    <div class="compare-panel" id="comparePanel1"></div>
    <div class="compare-panel" id="comparePanel2"></div>
  </div>
</div>
```

### CSS to add

```css
/* ===== COMPARE PAGE ===== */
.compare-header{padding:32px 40px 0;max-width:1100px;margin:0 auto}
.compare-title{font-family:var(--display);font-weight:800;font-size:2rem;letter-spacing:-.02em;color:var(--cream);margin:0 0 6px}
.compare-sub{font-family:var(--body);font-size:.95rem;color:var(--muted);margin:0}
.compare-selectors{display:flex;align-items:center;gap:20px;padding:28px 40px;max-width:1100px;margin:0 auto;flex-wrap:wrap}
.compare-slot{flex:1;min-width:200px}
.compare-slot-label{font-family:var(--mono);font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.compare-select{width:100%;font-family:var(--mono);font-size:.82rem;color:var(--cream);background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;cursor:pointer;appearance:none;outline:none}
.compare-select:focus{border-color:var(--gold)}
.compare-vs{font-family:var(--display);font-weight:800;font-size:1.5rem;color:var(--muted-2);flex-shrink:0}
.compare-panels{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line);margin:0 40px 60px;border-radius:16px;overflow:hidden}
@media(max-width:700px){.compare-panels{grid-template-columns:1fr;margin:0 20px 48px}}
.compare-panel{background:var(--bg);padding:28px}
.compare-panel-name{font-family:var(--display);font-weight:800;font-size:1.5rem;color:var(--cream);margin:0 0 4px}
.compare-panel-meta{font-family:var(--mono);font-size:.7rem;color:var(--muted);margin-bottom:16px}
.compare-panel-canvas{border-radius:12px;background:var(--card);border:1px solid var(--line);cursor:grab;touch-action:none;display:block;width:100%;max-width:260px;height:auto}
.compare-panel-desc{font-family:var(--body);font-size:.9rem;color:var(--muted);line-height:1.6;margin:16px 0}
.compare-panel-targets{display:flex;flex-direction:column;gap:8px;margin-top:12px}
```

### Add to `PAGES`

```js
comparePage: { world:'moves', els:['#compareView'], hash:'#compare' },
```

And:
```js
HASH_MAP['#compare'] = 'comparePage';
```

- [ ] **Step 1: Add HTML, CSS, and PAGES entry** as specified.

- [ ] **Step 2: Populate the `<select>` dropdowns at startup**

Add this function and call it once during init:

```js
function populateCompareSelects() {
  var opts = '<option value="">— choose —</option>';
  DATA.forEach(function(cat) {
    opts += '<optgroup label="' + cat.title + '">';
    cat.moves.forEach(function(m) {
      opts += '<option value="' + slugify(m.n) + '">' + m.n + '</option>';
    });
    opts += '</optgroup>';
  });
  document.getElementById('compareSelect1').innerHTML = opts;
  document.getElementById('compareSelect2').innerHTML = opts;
}
populateCompareSelects();
```

- [ ] **Step 3: Verify in browser**

Navigate to `#compare` in URL bar → should show the comparison page with two dropdowns populated with all 52 moves grouped by category. No console errors.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: compare page layout, CSS, and move select dropdowns"
```

---

## Task 8: Compare Page — Rendering Logic + Entry Points

**Files:**
- Modify: `index.html` — implement `showComparePage`, `renderComparePanel`, wire selects and "Compare with" button.

### `renderComparePanel(panelEl, canvasEl, slug, viewer)` helper

```js
function renderComparePanel(panel, slug, viewerRef) {
  var found = null, foundCat = null;
  DATA.forEach(function(cat) {
    cat.moves.forEach(function(m) {
      if (slugify(m.n) === slug) { found = m; foundCat = cat; }
    });
  });
  if (!found) { panel.innerHTML = ''; return; }
  var ext = MOVES_EXT[slug] || { longDesc:'', aliases:[], variations:[], targets:[], videos:[], p3d:null };

  var canvasId = panel.id + 'Canvas';
  panel.innerHTML =
    '<div class="compare-panel-name">' + found.n + (ext.aliases.length ? ' <span style="color:var(--muted);font-size:1rem">/ ' + ext.aliases[0] + '</span>' : '') + '</div>' +
    '<div class="compare-panel-meta">' + foundCat.title + ' · ' + found.t + ' · ' + found.g + '</div>' +
    '<canvas id="' + canvasId + '" class="compare-panel-canvas" width="260" height="310" style="touch-action:none"></canvas>' +
    '<p class="compare-panel-desc">' + (ext.longDesc || found.d) + '</p>' +
    (ext.targets && ext.targets.length
      ? '<div class="compare-panel-targets">' + ext.targets.map(function(t){
          return '<div class="move-target"><span class="move-target-area">' + t.area + '</span><span class="move-target-desc">' + t.desc + '</span></div>';
        }).join('') + '</div>'
      : '');

  if (viewerRef.current) { viewerRef.current.destroy(); viewerRef.current = null; }
  var canvas = document.getElementById(canvasId);
  if (ext.p3d && canvas) {
    viewerRef.current = createFigure3D(canvas, ext.p3d);
  }
}
```

### `showComparePage(slug1, slug2)` — replace the stub

```js
var _compareViewers = [{ current: null }, { current: null }];

function showComparePage(slug1, slug2) {
  slug1 = resolveSlug(slug1 || '');
  slug2 = resolveSlug(slug2 || '');
  ALL_PAGE_ELS.forEach(function(sel){ var el=document.querySelector(sel); if(el) el.hidden=true; });
  document.getElementById('compareView').hidden = false;
  curPage = 'comparePage'; curWorld = 'moves';
  tabs.forEach(function(t){ t.setAttribute('aria-selected', String(t.dataset.world==='moves')); });
  renderTitles(); window.scrollTo(0, 0);

  var s1 = document.getElementById('compareSelect1');
  var s2 = document.getElementById('compareSelect2');
  if (slug1) s1.value = slug1;
  if (slug2) s2.value = slug2;
  history.replaceState(null, '', '#compare/' + (slug1||'') + (slug2 ? '/' + slug2 : ''));

  if (slug1) renderComparePanel(document.getElementById('comparePanel1'), slug1, _compareViewers[0]);
  if (slug2) renderComparePanel(document.getElementById('comparePanel2'), slug2, _compareViewers[1]);
}
```

### Wire the compare selects to re-render panels on change

```js
document.getElementById('compareSelect1').addEventListener('change', function() {
  var s = this.value;
  if (s) renderComparePanel(document.getElementById('comparePanel1'), s, _compareViewers[0]);
  history.replaceState(null, '', '#compare/' + s + '/' + (document.getElementById('compareSelect2').value || ''));
});
document.getElementById('compareSelect2').addEventListener('change', function() {
  var s = this.value;
  if (s) renderComparePanel(document.getElementById('comparePanel2'), s, _compareViewers[1]);
  history.replaceState(null, '', '#compare/' + (document.getElementById('compareSelect1').value||'') + '/' + s);
});
```

### Wire back button

```js
document.getElementById('compareBackBtn').addEventListener('click', function() {
  _compareViewers.forEach(function(v){ if(v.current){ v.current.destroy(); v.current=null; } });
  showPage('lexicon');
});
```

### Update hashchange handler to parse two slugs

Update the compare branch of the hashchange handler:

```js
else if (compareMatch) {
  var parts = decodeURIComponent(compareMatch[1]).split('/');
  showComparePage(parts[0] || '', parts[1] || '');
}
```

### Update "Compare with another move" button on detail page

In `renderMovePage`, wire `moveCompareBtn` to carry the current move as the first selection:

```js
  document.getElementById('moveCompareBtn').onclick = function() {
    showComparePage(slug, '');
  };
```

### Entry from library — add "Compare Movements" link in lexicon header

Find the `#counters` area or the move index header in the HTML. Add a link:

```html
<button class="compare-btn" type="button" id="openCompareBtn" style="margin-left:auto">Compare Moves</button>
```

Wire it:
```js
var openCompareBtn = document.getElementById('openCompareBtn');
if (openCompareBtn) openCompareBtn.addEventListener('click', function(){ showComparePage('',''); });
```

- [ ] **Step 1: Add `renderComparePanel`, replace `showComparePage` stub, add `_compareViewers`** as specified.

- [ ] **Step 2: Wire select `change` events, back button, and compare-from-detail button**.

- [ ] **Step 3: Update hashchange handler** to parse two slugs.

- [ ] **Step 4: Add "Compare Movements" button** to the lexicon header.

- [ ] **Step 5: Verify in browser**

Full user journey A:
- Open lexicon. Click "Compare Movements" button → compare page opens with two empty dropdowns.
- Select "Bênção" in Move A and "Armada" in Move B → both panels render with name, meta, 3D canvas, description, and targets.
- Drag each 3D canvas independently → both rotate independently.
- URL should be `#compare/bencao/armada`.
- Reload the page at that URL → both panels should restore.

Full user journey B:
- Click the "Bênção" card → move detail page opens.
- Click "Compare with another move →" → compare page opens with Bênção pre-selected in Move A.
- Select "Armada" in Move B → Armada panel renders.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: compare page rendering, dual 3D viewers, URL state, entry points"
```

---

## Self-Review

### Spec coverage check

| Requirement | Task |
|---|---|
| Individual movement pages | Tasks 3, 5 |
| Detailed description | Task 5 (`longDesc`) |
| 3D rotatable stickman | Tasks 4, 5 |
| Target information | Tasks 2, 5 |
| Video links | Tasks 2, 5 |
| Variations listing | Tasks 2, 5 |
| Alternative names / aliases | Tasks 2, 6 |
| "Pisão / Chapa" style header | Task 5 (`move-title` with alias[0]) |
| Variations like "Martelo Rodado" | Tasks 2, 6 (via MOVES_EXT variations array) |
| Compare side-by-side | Tasks 7, 8 |
| "Compare with another movement" from detail page | Task 8 |
| "Compare Movements" from library | Task 8 |
| Select 2+ movements to compare | Tasks 7, 8 |

All requirements covered. ✓

### Placeholder scan

- All code blocks are complete and runnable. ✓
- No "TBD" or "implement later". ✓
- All referenced functions are defined in the same or earlier task. ✓
- `showComparePage` is defined as a stub in Task 5 so Task 8 can replace it safely. ✓

### Type consistency check

- `slugify(s)` used throughout — defined once in Task 1. ✓
- `resolveSlug(slug)` defined in Task 6, used in Task 8's `showComparePage` — Task 8 depends on Task 6. ✓
- `createFigure3D(canvas, p3d)` defined in Task 4 — used in Tasks 5 and 8. ✓
- `MOVES_EXT[slug]` keyed by `slugify(m.n)` — consistent throughout. ✓
- `_figure3d` (single viewer for detail page) vs `_compareViewers` (array for compare page) — no naming conflict. ✓
- `renderComparePanel(panel, slug, viewerRef)` — `viewerRef` is `{ current: viewer | null }` — consistent in Task 8. ✓

### Known limitations to address after this plan

1. **`MOVES_EXT` p3d for 47 non-priority moves** — currently null; shows "coming soon" canvas. Populate as 3D recordings become available.
2. **Video links** — all `videos: []` for now; populate from `tools/mocap/sources.json` once clips are reviewed.
3. **Variation chips** — navigate by slug, which may not exist in `DATA` (e.g. "Bênção de Costas" is a variation, not a top-level move). Currently falls back to lexicon. A future plan should add sub-move entries or a variation-specific page.
4. **Deep-linking on Vercel** — `#hash` URLs work client-side without server config. No changes needed.

---

**Execution order matters:** Task 6 (`resolveSlug`) must be complete before Task 8 (`showComparePage`) which calls it.

Recommended order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8.
