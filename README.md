# MPA Judge V2

MPA Judge V2 is a Firebase web app for running NCBA MPA events end-to-end:

- Admin: pre-event setup, live-event operations, packet review/release, directory/settings
- Judge: open judge flow (record, score, submit)
- Director: profile, ensembles, registration/day-of data, released packet access

## Current Architecture

Frontend (`public/`):
- SPA with `index.html` + ES modules
- Central state/DOM registry in `public/state.js`
- UI orchestration in `public/modules/ui.js` with feature modules extracted for:
  - admin handlers/render helpers
  - director handlers/renderers
  - judge-open handlers/renderers/session logic

Backend (`functions/`):
- Firebase Functions v2 callable APIs
- Cloud Functions own packet/submission state transitions

Data/security:
- Firestore + Storage rules enforce role boundaries (`admin`, `judge`, `director`)
- One active event model
- Deterministic submission identity by event/ensemble/judge position

## Local Development

Start emulators:

```bash
firebase emulators:start
```

Install Functions dependencies if needed:

```bash
npm --prefix functions install
```

Optional emulator seed:

```bash
npm --prefix functions run seed:emulator
```

## Deployment

Frontend/UI-only changes:

```bash
firebase deploy --only hosting
```

Functions-only changes:

```bash
firebase deploy --only functions
```

Full deploy:

```bash
firebase deploy
```

## Operational Notes

- Prefer stability over feature density in admin flows.
- Avoid loading hidden heavy views until needed.
- Remove dead/legacy UI paths when replacing workflows.
- For production event prep, validate the active event, judge assignments, and packet release flow before event day.
