# MPAapp

`MPAJudgeV2` is the current repo name for MPAapp, the NCBA-style adjudication and event operations web app.

Phase 1 is now live in production on `main`. The current operating model is:

- Admin: `Dashboard`, `Registrations`, `Schedule & Flow`, `Live Submissions`, `Packets & Results`, `Announcer`, `Readiness`, `Settings`
- Judge: capture-first official/practice workspaces with required caption scoring
- Director: `Dashboard`, `Registration`, `My Ensembles`, `Event Info`, `Official Results Packet`

## Current Product Model

- Judges record audio, complete caption comments, assign caption scores, and submit.
- AI assist is optional. It may help with transcript and caption drafting later, but it is not required for completion.
- Admin reviews raw assessments in `Live Submissions`, corrects association when needed, and officializes assessments into results slots.
- `officialAssessments` is the canonical released-results record. Legacy `submissions` remains as compatibility output where still needed.
- Directors see released official results packets, audio, and generated files after admin release.

## Architecture

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

## Local Development

Install dependencies as needed:

```bash
npm install
npm --prefix functions install
```

Start emulators:

```bash
firebase emulators:start
```

Optional emulator seed:

```bash
npm --prefix functions run seed:emulator
```

Optional staging seed:

```bash
npm --prefix functions run seed:staging
```

## Verification

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

Smoke E2E:

```bash
npm run test:e2e:smoke
npm run report:e2e:smoke
```

Release E2E:

```bash
npm run test:e2e:release
npm run report:e2e:release
```

Combined baseline:

```bash
npm run verify:baseline
```

Notes:
- E2E requires the appropriate `MPA_*` env vars for admin, director, and judge logins.
- `verify:baseline` skips E2E when the required env vars are not present unless `MPA_REQUIRE_E2E=true`.

## Deployment

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

- Prefer operational clarity over feature breadth.
- Do not reintroduce hidden legacy judge/admin paths as primary workflows.
- Use `Admin > Live Submissions` for review, reassignment, exclusion, and raw-assessment cleanup.
- Use `Admin > Packets & Results` for official packet review, per-position management, release/unrelease, and result file generation.
- Use `Admin > Readiness` for preflight checks, walkthroughs, and rehearsal cleanup.
- Generated results packet PDFs now use the current stage and sight form templates and current district/site labels.
