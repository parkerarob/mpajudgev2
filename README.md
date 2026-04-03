# MPAJudgeV2

Adjudication and event operations system for MPA events.

## Architecture

Frontend (`public/`)
- Single-page app built from `index.html` and ES modules
- Global state and constants in `public/state.js`
- Main orchestration in `public/modules/ui.js`
- Role-focused modules for admin, judge, and director flows
- Admin navigation is centered on `Setup`, `Directory`, `Event Prep`, `Event Day`, and `Announcer`

Backend (`functions/`)
- Firebase Functions v2 callables
- Packet, raw assessment, officialization, release, and export workflows live here

Data and security
- Firestore + Storage rules enforce role boundaries
- One active event model
- Protected director/school/event-entry data remains in place
- Official results now flow through `officialAssessments`

## Documentation

- [AGENTS.md](AGENTS.md): repo guardrails for engineering and product work
- [USER_INSTRUCTIONS.md](USER_INSTRUCTIONS.md): event-day operating guide by role
- [PRD.md](PRD.md): current product requirements
- [docs/Domain-Language.md](docs/Domain-Language.md): canonical glossary for domain terms
- [docs/Director-User-Guide.md](docs/Director-User-Guide.md): director workflow details
- [docs/Judge-User-Guide.md](docs/Judge-User-Guide.md): judge workflow details

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
