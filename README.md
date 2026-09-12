# roda.fyi

A visual field guide and training-platform foundation for capoeira. The public
movement library is account-free; the authenticated dashboard uses one
practitioner profile with optional coaching capabilities and self-managed group
hierarchies.

Production: [https://roda.fyi](https://roda.fyi)

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
- [Roadmap](ROADMAP.md)
