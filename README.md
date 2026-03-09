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
- `public/modules/ui.js` remains a large compatibility/orchestration layer while extraction continues.

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

## Testing Baseline

Unit tests:

```bash
npm run test:unit
```

Smoke E2E suite:

```bash
npm run test:e2e:smoke
npm run report:e2e:smoke
```

Release E2E suite:

```bash
npm run test:e2e:release
npm run report:e2e:release
```

Combined baseline verification:

```bash
npm run verify:baseline
```

Security/emulator suite:

```bash
npm run test:security
```

Notes:
- E2E suites require env vars: `MPA_BASE_URL`, `MPA_ADMIN_EMAIL`, `MPA_ADMIN_PASSWORD`, `MPA_DIRECTOR_EMAIL`, `MPA_DIRECTOR_PASSWORD`.
- Smoke E2E also requires judge credentials: `MPA_JUDGE_EMAIL`, `MPA_JUDGE_PASSWORD`.
- `verify:baseline` runs unit + smoke by default and only runs release E2E when `MPA_RUN_RELEASE_E2E=true`.
- `verify:baseline` skips E2E when required env vars are missing unless `MPA_REQUIRE_E2E=true`.

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
- Use `Admin > Readiness` to run go/no-go preflight checks, track runbook milestones, and cleanup unreleased rehearsal artifacts.
- Use `Admin > Readiness > Full Rehearsal Walkthrough` to run the live-day sequence with start/reset controls, step-level status, and direct links into the right admin view for each checkpoint.
- Walkthrough status now records `not-started`/`in-progress`/`complete` metadata (who/when) in event readiness history, and Start/Reset gracefully falls back to per-step updates if the new callable is not yet deployed.
- The `setReadinessWalkthrough` callable is reset-only (`incomplete`) by design to prevent one-call bypass of checklist completion.
- If the walkthrough bulk-reset callable is unavailable, the client falls back to per-step updates and periodically retries callable support detection.
- Current preflight checks cover active-event status, assignment completeness/uniqueness/role validity, schedule presence, scheduled-entry readiness coverage, and walkthrough completion for live events.
- Rehearsal cleanup is intentionally limited to rehearsal-mode events; the Readiness UI disables cleanup controls for live-mode events.
- Readiness actions share a common in-flight lock to prevent overlapping preflight/walkthrough/cleanup mutations.
- `Admin > Readiness` also shows readiness history (latest preflight and runbook step updates with timestamps and actor UIDs) for operational auditability.
- Use event mode (`Live` vs `Rehearsal`) at event creation time; the active mode is shown globally in the event banner after sign-in.

## App Check Rollout Status

- Client App Check rollout is currently `deferred` by default.
- Manual local override for troubleshooting: set `localStorage["mpa.enableAppCheck"] = "1"`.
- Functions App Check enforcement is controlled by `APP_CHECK_ENFORCEMENT_MODE`:
  - `deferred` (default): does not enforce App Check on callables currently using sensitive options.
  - `enforced`: requires App Check on those callables.

## Signed URL Fallback Guardrail

- `signStorageReadPath` prefers short-lived signed URLs.
- If URL signing fails, token URL fallback is disabled by default (fail closed).
- Emergency override only: set `ALLOW_STORAGE_TOKEN_FALLBACK=1` to allow use of existing token URLs.
