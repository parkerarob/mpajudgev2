# MPAapp

`MPAJudgeV2` is the legacy repo name for the NCBA-style adjudication and event operations system.

## Project State

- `MPAJudgeV2` remains the live Firebase production/archive system.
- Unless a new production issue arises, the current Firebase app is now in maintenance freeze.
- Active rebuild development has moved to:
  - `/Users/parkerarob/Documents/Workspaces/Desktop-Projects/NCBA-MPA-Event-Management-App`
- The new active rebuild repo contains:
  - the Next.js app in `apps/web/`
  - the Supabase schema and migrations in `supabase/`
  - rebuild design and migration docs in `docs/`
- The current repo should receive only:
  - production bug fixes
  - reliability fixes
  - archival/access preservation work

## Legacy Architecture

Frontend (`public/`)
- Single-page app built from `index.html` and ES modules
- Global state and constants in `public/state.js`
- Main orchestration in `public/modules/ui.js`
- Role-focused modules for admin, judge, and director flows

Backend (`functions/`)
- Firebase Functions v2 callables
- Packet, raw assessment, officialization, release, and export workflows live here

Data and security
- Firestore + Storage rules enforce role boundaries
- One active event model
- Protected director/school/event-entry data remains in place
- Official results now flow through `officialAssessments`

## Legacy Local Development

Install dependencies as needed:

```bash
npm install
npm --prefix functions install
```

Start emulators:

```bash
firebase emulators:start
```

## Legacy Verification

Unit tests:

```bash
npm run test:unit
```

Functions lint:

```bash
npm --prefix functions run lint
```

Security suite:

```bash
npm run test:security
```

## Legacy Deployment

Hosting only:

```bash
firebase deploy --only hosting
```

Functions only:

```bash
firebase deploy --only functions
```

Rules only:

```bash
firebase deploy --only firestore:rules,storage
```

Full deploy:

```bash
firebase deploy --only hosting,functions,firestore:rules,storage
```

## Operational Notes

- Treat this repo as the legacy support lane by default.
- Do not add new product architecture to this repo unless the task explicitly requires legacy-system work.
- Prefer the new rebuild repo for workflow, UX, schema, and platform evolution.
