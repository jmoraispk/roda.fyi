# Mobile-First App Redesign

**Status:** Approved conversational design; awaiting review of this written specification.

## Purpose

The dashboard works, but it is hard to use. On a phone it is one page about
three screens tall: a group selector, group buttons, a month calendar, totals,
a day detail made of stacked forms, and a connections section. Recording
training is a long dialog that does not fit the screen, and nothing tells the
person what to do next.

This redesign replaces the dashboard's information architecture and screens
with a mobile-first app that can later ship as a phone app. Features and data
from the training-input delivery stay; what changes is how they are reached
and presented. It also adds a first, small Discover: people at city level and
groups on a map.

## Principles

1. **Phone first.** Every screen is designed at about 390 px wide; desktop is a
   wider arrangement of the same screens.
2. **One app, no modes.** There is no My Training / Coaching switch. Coaching
   appears where it is relevant. A Train · Both · Teach setting changes
   emphasis, never access.
3. **The training is the shared object.** Everyone sees the same training page;
   a person's role in it decides the available actions.
4. **Logging is one tap away** from every top-level screen.
5. **Time is always visible.** A class shows its date, start time, and duration
   whether or not it has a recording.
6. **Privacy by default for students.** Discover shows city-level places only;
   students are hidden unless they choose otherwise.

## Scope

### Included

- App shell: hash router, bottom tab bar, desktop sidebar, bottom sheets,
  full-screen detail pages, installable web app.
- Screens: Today, Calendar, Log training, training page, coach's class page,
  Me with Progress, Repertoire, Teaching, Groups, Catalog, Settings.
- First-sign-in welcome and the Train · Both · Teach setting.
- Discover v1: people at city level and groups on an OpenStreetMap map, person
  and group cards, search, and Discover settings.
- Switching `/dashboard` to the new app and removing the old views.
- English and Portuguese copy (English in American spelling).

### Deferred

- Teaching addresses, weekly class times, students' training places,
  precision finer than city, and address deduplication (locations spec).
- The public "Find a class" page on index.html (locations spec).
- App-store packaging (for example with Capacitor).
- Offline data access; v1 caches the app's files only.
- Video timestamps on rounds.

## Navigation

### Destinations

| Tab | Purpose |
|-----|---------|
| **Today** | What to do now: next class, quick logging, recent trainings |
| **Calendar** | The month and every past and upcoming training |
| **+** | Create: log training, schedule a class, record a past class |
| **Discover** | Map and search of people and groups |
| **Me** | Profile, mode, Progress, Repertoire, Teaching, Groups, Catalog, Settings |

### Routes

All routes live under `/dashboard` (during development, `/app`) as hash
routes, so no server configuration is needed and links can be shared:

| Route | Screen |
|-------|--------|
| `#/` | Today |
| `#/calendar` and `#/calendar/<yyyy-mm>` | Calendar |
| `#/log` | Log training |
| `#/training/<occurrence-id>` | Training page |
| `#/class/<schedule-id>` | Coach's upcoming class page |
| `#/discover` | Discover |
| `#/person/<profile-id>` | Person card page |
| `#/group/<group-id>` | Group page |
| `#/me` | Me |
| `#/me/progress`, `#/me/repertoire`, `#/me/groups`, `#/me/catalog`, `#/me/settings` | Me subpages |
| `#/me/teaching`, `#/me/teaching/plans/<plan-id>`, `#/me/teaching/students/<profile-id>` | Teaching |
| `#/welcome` | First sign-in |

Unknown routes go to Today. Routes a person cannot use (Teaching for Train
mode without coaching, Catalog for non-curators) redirect to Me.

### Phone layout

- Top-level screens show a title bar and the bottom tab bar. The **+** sits in
  the middle of the bar, raised.
- Detail pages slide in full-screen with a back arrow and hide the tab bar.
- Short choices (a day's items, the + menu, filters) open as bottom sheets
  that close on swipe down, Escape, or a tap outside, returning focus to the
  control that opened them.
- No modal dialogs remain from the old dashboard.

### Desktop layout (at least 900 px wide)

- The five destinations become a left sidebar; **+** becomes a "Log training"
  button at its top.
- Today and Calendar show their list or month on the left and the selected
  training on the right instead of navigating away.
- Content has a comfortable maximum width.

### Things that move

- The group selector is removed. Group context appears only in Teaching, the
  group ranking in Progress, and Me → Groups.
- Language and Sign out move to Me → Settings.

### Installable web app

- A web app manifest with name, icons, theme colors, and `display: standalone`
  so the app can be added to a phone's home screen.
- A service worker caches the app's own files so it opens instantly. Data is
  never cached; when offline, screens say so and keep entered text.
- A training being written is kept in browser storage until it syncs, as class
  resources already are.

## Screens

Mockups of the agreed layouts are in
`docs/superpowers/specs/2026-10-11-mobile-first-app-mockups/`.

### Today

1. **Week strip** at the top: the seven days of the current week with dots for
   training. Tapping a day opens Calendar on that day.
2. **Now or next card**, the first match of:
   - a class the person teaches that ends less than 12 hours ago and is not
     finished: "Finish class";
   - a class the person attended in the last 12 hours without a felt rating:
     "How did it go?" opening Rate;
   - the next scheduled class the person teaches or attends today or tomorrow;
   - nothing.
3. **Recent**: the last ten trainings as cards with type, date, duration, the
   first round's text, resource icons (🎥 🎙️ 📄), and a quiet felt label when
   rated. Tapping opens the training page.

Empty state: "Nothing logged yet. Tap + to log your first training."

### + menu

| Mode | Behavior |
|------|----------|
| Train | Opens Log training directly |
| Teach | Sheet: Schedule a class · Record a past class |
| Both | Sheet: Log my training · Schedule a class · Record a past class |

### Log training

One full-screen page:

- Header: close, title, and training type (Alone in v1).
- **Chips**: Today · Yesterday · date picker · duration.
- **Round cards** using the existing round editor: text, recognized-move chips,
  quick Easy/Okay/Hard, and Rate parts.
- **Chat box** pinned above the keyboard: each send adds a round; pasting
  several rounds splits them into cards; tapping a card edits it.
- **Shortcut chips**: 🥋 Moves (picker sheet) · 📚 Saved (repertoire sheet) ·
  📝 Notes · 🎥 Link · 🎙️ Transcript · 📄 Summary.
- **Save** pinned at the bottom. A failed save keeps everything and shows the
  reason; the draft also survives a reload.

### Training page

- **Video first**: when a video resource exists, an embedded player sits at the
  top. Its caption names the resource and, when the title includes a length,
  notes how much of the class it covers. Without a video, the page starts with
  the title.
- **Title**: the training type and group or student, for example
  "Group class · Grupo Lua".
- **Small text**: date, start time, and coach.
- **Tags**: ⏱ duration and 👥 attendees (attendees only for group classes).
- **Resource buttons**: one per resource; video opens the player or the link,
  transcripts and summaries open a readable page.
- **Rounds** as numbered chapters with the round text and a quiet "felt" label.
- **Notes** (the person's own) and **coach feedback**.
- **Bottom bar**:
  - participant: ★ Rate · 📝 Notes · 📎 Add;
  - the coach of that class: Feedback · 📎 Add · Edit.

The planned-versus-felt comparison is not shown on this page.

### Coach's class page

For a scheduled class the person teaches:

- Title, small text (date, time, "you teach", plan name), tags (⏱ duration,
  👥 coming).
- The plan's rounds.
- **Who's here**: the group's members (or the one student) with tap-to-mark
  checkboxes, all checked by default.
- **Cancel class** and **Finish class**. Finishing records the class for the
  checked people with the planned duration, then offers Add resources.

### Calendar

- The **full month**, every week shown, with colored dots: Alone, Group,
  Personal class; outlined dots for upcoming items.
- Previous and next month buttons, and swiping left or right on phones.
- Tapping a day opens a **bottom sheet** listing its items with time,
  duration, attendees, and resource icons. Tapping an item opens its page.

### Me

- Profile photo and name; tapping opens profile settings.
- **Train · Both · Teach** three-position slider, with "log my training" and
  "teach classes" hints under the ends.
- Rows:
  - **Progress**: personal statistics, hardest transitions, group ranking;
  - **Repertoire**: saved sequences with Log, Rename, Delete;
  - **Teaching** (Both or Teach): plans, students and their history, schedule;
  - **Groups**: the person's groups; owners and coaches manage members,
    invitations, hierarchy, and the group's Discover place and contacts;
  - **Catalog**: curators only;
  - **Settings**: profile, Discover visibility, city, contacts, language,
    timezone, leaderboard visibility, sign out.

### First sign-in

`#/welcome` appears once for a profile without `completed_at`:

1. Name and photo.
2. The Train · Both · Teach slider.
3. Optional city and "Who can find you".

Choosing Both or Teach registers coaching on the profile. Finishing sets
`completed_at` and opens Today.

## Train · Both · Teach

- Stored on the profile as `usage_mode` (`train`, `both`, `teach`).
- Choosing Both or Teach creates the coach profile when missing.
- Choosing Train never deletes the coach profile, plans, groups, or students;
  Teaching simply leaves the Me list until Both or Teach is chosen again.
- Effects: what the + does, which Today card types appear first, whether
  Teaching is listed in Me, and the default Discover visibility.
- Existing accounts get `both` if they have a coach profile, otherwise `train`.

## Discover v1

### Screen

- A full-screen map (OpenStreetMap tiles through Leaflet, OSM attribution
  shown), a search bar at the top, and a bottom sheet listing what is in view.
- **People pins** are grouped per city with a count, for example "Lisbon · 12".
  Tapping one lists those people in the sheet.
- **Group pins** for discoverable groups with a place.
- **Person card**: name, photo, mode, city, the discoverable groups they train
  in, the groups they teach (coach or owner), and contacts.
- **Group card**: name, picture, place label, coaches, contacts, and the
  existing request-to-join action.
- **Search** finds people, groups, or a city by name.

### Settings

In Me → Settings → Discover:

- **Your city**: search a city or tap the map. The app keeps the city's name,
  region, country, and coordinate rounded to two decimals.
- **Who can find you**: Everyone · Signed-in people · Nobody. When the person
  never chose, Both and Teach count as Everyone and Train as Nobody.
- **Contacts**: Instagram handle, website (https), WhatsApp number, contact
  email. All optional.

Group owners set the group's place and contacts in Me → Groups.

### Geocoding

City search runs in the browser against the OpenStreetMap Nominatim service:
one request per search after the person stops typing, never bulk requests,
with attribution. Only the chosen city's fields are saved.

### Visibility rules

| Viewer | Sees people whose effective visibility is |
|--------|-------------------------------------------|
| Signed-in person | Everyone or Signed-in people |
| The person themself | Always themself |
| Anonymous (future public page) | Everyone |

Nobody-visible profiles never appear in map points, cards, or search.
Contacts are returned only with a visible card. Leaderboard visibility is a
separate, unchanged setting.

## Data Model

### `profiles` additions

| Column | Type | Rule |
|--------|------|------|
| `usage_mode` | text | `train`, `both`, or `teach`; not null, default `train` |
| `discover_visibility` | text | null, `everyone`, `signed_in`, or `nobody` |
| `place_city` | text | ≤ 120 characters |
| `place_region` | text | ≤ 120 characters |
| `place_country` | text | ≤ 120 characters |
| `place_lat` | numeric(5,2) | −90 to 90; set together with `place_lng` |
| `place_lng` | numeric(5,2) | −180 to 180 |
| `contact_instagram` | text | `^[A-Za-z0-9._]{1,30}$` |
| `contact_website` | text | starts with `https://`, ≤ 2,048 |
| `contact_whatsapp` | text | `^\+?[0-9 ]{6,20}$` |
| `contact_email` | text | simple email shape, ≤ 254 |

Effective visibility = `discover_visibility` when set, otherwise `everyone`
when `usage_mode` is `both` or `teach` and `nobody` when it is `train`.

### `groups` additions

The same `place_*` columns and `contact_instagram`, `contact_website`,
`contact_email`. The existing `location` text stays as the display label.

### Functions

All are `private` security-definer functions with an empty `search_path`,
exposed through `public` SQL wrappers that pass `auth.uid()`:

- `public.update_discover_profile(...)`: the caller's mode, visibility, place,
  and contacts. Setting `both` or `teach` creates the coach profile.
- `public.update_group_discover(group_id, ...)`: group place and contacts;
  owner only.
- `public.discover_points(min_lat, min_lng, max_lat, max_lng)`: city clusters
  `(lat, lng, city, region, country, person_count)` and group pins
  `(group_id, name, lat, lng, location)` inside the box, at most 500 rows.
- `public.discover_person(profile_id)`: the person card or nothing.
- `public.discover_search(text, limit)`: up to 20 people, groups, and cities.

## Implementation Approach

- Same stack: ES modules bundled by esbuild, Vitest, Playwright, Supabase.
- `src/app/shell/` holds the router, layout (tab bar and sidebar), sheet, and
  page primitives; `src/app/screens/` holds one module per screen.
- Existing services and components are reused: training, statistics,
  repertoire, catalog, connection, group, and profile services; the parser;
  the round editor; the rating strip; the move picker; the resource view
  (restyled).
- Leaflet is added as a pinned dependency and bundled by esbuild.
- During development the new app is served at `/app` from `app.html` with its
  own entry. At switch-over, `dashboard.html` loads the new entry, `/app`
  redirects to `/dashboard`, and the old `src/app/ui/*-view.js` page views,
  `dashboard.html` markup, and their tests are removed.

## Delivery Increments

Each increment ships with its tests and can merge on its own.

1. **Shell**: router, tab bar, sidebar, sheets, pages, manifest, service
   worker, Me with Settings (language, sign out), demo mode.
2. **Reading screens**: Today, Calendar, training page.
3. **Logging**: + menu, Log training, rating, resources, local drafts.
4. **Teaching and Me**: coach's class page, schedule a class, record a past
   class, plans, students, Progress, Repertoire, Groups, Catalog.
5. **Onboarding and mode**: welcome, Train · Both · Teach, + behavior.
6. **Discover v1**: migration, functions, map, cards, search, settings.
7. **Switch-over**: `/dashboard` serves the new app; old code removed; docs
   updated.

## Testing

- **Unit (jsdom)**: router matching and redirects, screen state, + behavior
  per mode, the Now or next card rules, the composer and chat box, sheet focus
  and closing, draft persistence, Discover settings validation.
- **Browser (phone and desktop sizes)**: log a training and see it in Today
  and Calendar; open a training and its resources; rate a round; a coach
  finishes a class; record a past class; change mode and see + change; set a
  city and find yourself on the map; set Nobody and disappear.
- **Database**: Discover visibility for anonymous, signed-in, owner, and
  hidden profiles; owner-only group updates; coach profile creation on mode
  change; constraint checks on contacts and coordinates.
- **Other**: English and Portuguese key parity, keyboard navigation, focus
  return from sheets, and a manual "Add to Home Screen" check on a phone.

## Acceptance Criteria

1. On a phone, every top-level screen fits the viewport with the tab bar
   visible, and logging is one tap away.
2. Today shows the week strip, the right Now or next card, and recent
   trainings with resource icons.
3. Log training records multi-round training typed in the chat box, with
   rating and resources, and survives a failed save or reload.
4. The training page always shows date, time, duration, and (for group
   classes) attendees; resources open when tapped; a video plays at the top.
5. Coaches finish a class from its page with tap-to-mark attendance.
6. Calendar shows the full month and opens a day's items in a sheet.
7. The Train · Both · Teach setting changes + and Me as specified, without
   removing data.
8. Discover shows people per city and groups on the map, person and group
   cards, and search; hidden people never appear.
9. Desktop shows the sidebar layout with list and detail side by side.
10. The app can be added to a phone's home screen and opens full-screen.
11. Unit, browser, and database suites pass.
