# roda.fyi

A visual field guide and training-platform foundation for capoeira. The public
movement library is account-free; the signed-in app at `/app` uses one
practitioner profile with optional coaching capabilities and self-managed group
hierarchies.

Production: [https://roda.fyi](https://roda.fyi)

## Training input

Practitioners and coaches write what they trained in their own words, one
round at a time, for example `10x (armada, aú, 3x ginga)`. A rules-based parser
recognizes moves from the shared movement catalog, keeps unknown words in place,
and shows the result as chips under each round. The move picker and saved
sequences only insert text.

Each round can be rated Easy, Okay, or Hard; coaches set a planned difficulty
and practitioners record how it felt. "Rate parts" rates the setup, single
moves, transitions, and loops of a round, which feeds the "Hardest
transitions" statistic.

Saved sequences live in the account. The public Sequences page saves to the
account when signed in and imports sequences previously saved in the browser
once.

Trainings can carry text resources: a video link, a voice transcript, and a
markdown summary. Coaches can record a class that already happened, including
its attendees and resources.

Catalog curators see Catalog under Me, listing uncatalogued words with totals only
and can map, merge, or ignore them.

### The app (`/app`)

Signed-in people use a mobile-first app at `/app`: Today,
Calendar, Log training, the training page, the coach's class page, and Me with
Progress, Repertoire, Teaching (plans, students, scheduling, past classes),
Groups, Catalog for curators, and Settings. New accounts start with a short
welcome, and a Train · Both · Teach setting in Me changes what **+** offers and
whether Teaching is listed, without removing any data. The app has a bottom tab
bar on phones and a sidebar on desktop and can be added to a phone's home
screen.

Discover (`#/discover`) shows people per city and discoverable groups on an
OpenStreetMap map, with search and person and group cards. People choose their
city, who can find them, and their contacts in Me → Settings; group owners set
the group's city and contacts on the group's page. Only city-level places are
stored, and Train-mode profiles stay hidden until the person chooses otherwise.

Every sign-in lands on `/app`. The old address `/dashboard` forwards there and
keeps the rest of the link, so older bookmarks, invitation links, and group
links keep working. Times are shown in your own time zone; a class recorded in
another zone also shows its local time, for example "07:00 PM in Lisbon".

## Local browser development

Use Node.js 22.22.2 from `.nvmrc`:

```bash
npm ci
npm run build:test
python3 tools/serve.py 8137
```

Open `http://127.0.0.1:8137`. The test build uses deterministic local browser
services. A production-style build requires the public Supabase URL and
publishable key in an ignored `.env.local`:

```text
RODA_SUPABASE_URL=https://PROJECT_REF.supabase.co
RODA_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Never place a database password, Supabase access token, secret/service-role
key, Google client secret, or SMTP credential in browser configuration.

## Verification

```bash
npm run test:unit
npm run test:e2e
```

Database verification additionally requires a Docker-compatible runtime:

```bash
npm run supabase:start
npm run supabase:reset
npm run test:db
```

## Documentation

- [How the movement and capture system works](docs/README.md)
- [Authentication and database operations](docs/auth-and-database-operations.md)
- [Security and launch checklist](docs/security-checklist.md)
- [Approved authentication/group design](docs/superpowers/specs/2026-09-11-auth-group-foundation-design.md)
- [Implementation plan](docs/superpowers/plans/2026-09-11-auth-group-foundation.md)
- [Training-platform design decisions](docs/training-platform-design-decisions.md)
- [Training input and catalog design](docs/superpowers/specs/2026-10-10-training-input-catalog-design.md)
- [Roadmap](ROADMAP.md)
