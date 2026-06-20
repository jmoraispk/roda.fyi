# Roda — Project Brief & Roadmap

## What we're building

**Roda** is a polished, modern web reference for the *vocabulary of capoeira* —
a "field guide to the language of the roda." It catalogs 52 movements across
four families (golpes / esquivas / floreios / quedas), each with a name, a
literal translation, a one-line description, a category tag, and an **original
animated SVG pictogram** that shows the shape of the move (the active limb lit
gold). The aesthetic is a Bahian *terreiro at dusk*: espresso background,
dendê-gourd gold, Bahian clay, with a living **ginga** and a berimbau in the
hero. It is deliberately not photo-based — the pictograms are custom so the set
is visually cohesive and free of any image/licensing entanglements.

Goal: something that's genuinely useful as a reference *and* feels like capoeira
— playful, rhythmic, a little malandro.

## Tech

Vanilla HTML/CSS/JS, single self-contained `index.html`, no build step. Google
Fonts (Syne / Hanken Grotesk / Space Mono) via CDN. A small SVG **figure engine**
(joint skeleton + keyframe tweening) drives all the animation. No framework is
needed for anything below; split into `data.js` / `app.js` / `styles.css` once
it grows (see README).

## Done so far
- ✅ Full catalog of 52 moves, 4 categories, with glosses, descriptions, tags.
- ✅ Custom SVG pictogram per move; gold-lit action limb.
- ✅ **Animated figures** — cards idle at their peak pose, play the move's motion
  on hover/focus/tap, autoplay once on scroll-in, settle back. Reduced-motion +
  keyboard focus handled.
- ✅ **Hero ginga** rebuilt front-facing — rocks between lunges, opposite hand
  guards the face (now reads as a real ginga, not a wobble).
- ✅ Hero layout fix — figure holds a strong size on the right at any width and
  no longer overlaps the title (verified against a font wider than Syne).

## Roadmap (agreed, in priority order)

### 1. Relationships — attack → possible defenses  ⭐ next
For each kick, which esquivas/quedas answer it; and the reverse (what each
defense counters). Capoeira is call-and-response, so this is the most
"capoeira-native" feature.
- Add a relations map in `DATA` (e.g. `move.counters: ['Esquiva baixa', ...]`,
  `move.beats: [...]`). Curate from the move semantics (a high armada → duck
  with esquiva baixa / answer with rasteira to the support leg, etc.).
- UI: on a card, a "defends against / answered by" list; ideally a click jumps
  between related cards. A small relationship view (even a simple linked list)
  is enough to start.

### 2. Study mode — name↔move quiz
Two modes: pick the move from a name, and pick the name from a (playing) figure.
- **Important constraint:** a single silhouette can't distinguish
  armada/queixada/rabo de arraia (they differ by spin and travel). So: let the
  figure **play its animation** during the question, lean on the family/motion
  tag, and keep easily-confused moves in **separate question pools**. Pictograms
  give a fair, playable quiz — not a substitute for video.
- Score/streak can use `localStorage` (works when run locally/hosted).

### 3. Sequence builder — ship as "Coming soon" + brainstorm
Keep a teaser card; design later. Ideas to explore:
- Chain moves into a *sequência*; validate legal transitions using the
  relationships graph (a kick flows into a defense flows into a counter).
- Surface the combinatorics we computed earlier (kick→esquiva→kick etc.,
  KE(K+E) for triples) as a live count of possible sequences.
- Bimba-style fixed sequences as presets; a "random roda" generator.
- Animate the chain end-to-end; export/share a sequence by URL.

### 4. Music — the other half of the art
- Instruments: berimbau, pandeiro, atabaque, agogô, reco-reco.
- Toques: Angola, São Bento Grande, Iúna, Cavalaria — short looping audio.
- A glossary for the terms the page already uses (roda, ginga, malícia, chamada,
  volta ao mundo, axé) and a lineage toggle (Angola / Regional / Contemporânea),
  since naming/emphasis differ by style.

### 5. History strip
Afro-Brazilian origins; Mestre Bimba (Regional) & Mestre Pastinha (Angola); 1890
criminalization → 1937 legalization; UNESCO intangible heritage (2014).

### Cross-cutting / nice-to-haves
- **Search + filter** (by category, family, motion, difficulty) — practical at
  52+ entries; the data is already tagged for it.
- **Self-host the fonts** (base64 into CSS) for true offline / single-file.
- Deep-linkable anchors per move; a "study list"/favorites.

## Name ideas (the site)
Working title is **RODA**. Shortlist if you want something more ownable:
- **Roda** — clean, central, but common.
- **Mandinga** — the cunning/magic of a good capoeirista. Evocative, ownable.
- **Gingado** — "the sway"; movement-first, friendly.
- **Dendê** — the palm oil / the "axé" energy; short, warm, on-brand with the palette.
- **A Linguagem da Roda** — the current hero line; great as a tagline.

My pick: **Mandinga** for the name, "A linguagem da roda" as the tagline.
(Domains unverified — worth a quick check before committing.)
