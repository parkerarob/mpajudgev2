# MPAJudgeV2

Adjudication and event operations system for MPA events.

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
