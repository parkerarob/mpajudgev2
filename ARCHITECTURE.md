# MPAJudgeV2 Architecture

## Overview

MPAJudgeV2 is a Firebase-backed adjudication system for Music Performance Adjudication events.

The app is a browser SPA served from `public/`. Business-critical transitions live in Firebase Functions in `functions/`. Firestore and Storage rules enforce the role boundary between `admin`, `judge`, and `director`.

## Runtime Shape

```text
Browser SPA (public/index.html + ES modules)
  -> Firebase Auth
  -> Firestore
  -> Cloud Functions callable APIs
  -> Firebase Storage
```

## Frontend

Primary frontend files:

- `public/index.html`: shell markup and role workspaces
- `public/state.js`: shared client state
- `public/modules/ui.js`: orchestration layer
- `public/modules/admin-navigation.js`: canonical admin route mapping
- `public/modules/ui-admin-shell.js`: admin view switching
- `public/modules/ui-admin-renderers.js`: admin-heavy rendering logic

Current admin information architecture:

- `Setup`
- `Directory`
- `Event Prep`
- `Event Day`
- `Announcer`

Important frontend rule:

- Heavy admin rendering should happen only for the active surface. Hidden views should not fully render just to keep legacy paths alive.

## Backend

Primary backend files:

- `functions/index.js`: callable APIs, packet transitions, raw-assessment review, packet release, export generation
- `firestore.rules`: Firestore authorization

Critical transitions owned by Cloud Functions:

- packet release and unrelease
- submission lock and unlock
- raw assessment officialization and exclusion
- packet completion validation
- overall rating computation

## Data Model

Key collections and records:

- `events`
- `schools`
- `rawAssessments`
- `packets`
- `officialAssessments`
- `submissions`

Deterministic submission identity:

```text
{eventId}_{ensembleId}_{judgePosition}
```

This invariant matters because packet release, officialization, and director visibility all assume exactly one canonical record per event, ensemble, and judge position.

## Role Boundary

Supported roles:

- `admin`
- `judge`
- `director`

The old `teamLead` / `opsLead` role is intentionally removed from the production role model. Admin-only transitions now use the existing admin boundary directly.

## Release Flow

The release path is:

1. Judge submits a locked assessment.
2. Admin reviews raw assessments in `Event Day`.
3. Admin officializes into `officialAssessments`.
4. Packet release validates completeness by grade.
5. Directors see only released packet artifacts.

Grade-specific completeness:

- Grade I: `stage1`, `stage2`, `stage3`
- Grades II-VI: `stage1`, `stage2`, `stage3`, `sight`

## Deployment

- Hosting and functions deploy through Firebase
- Pushes to `main` trigger the production Hosting workflow
- Production health endpoint: `https://mpa-judge-v2.web.app/version.json`

## Verification

Primary verification commands:

```bash
npm run test:unit
npm run test:security
npm --prefix functions run lint
```
