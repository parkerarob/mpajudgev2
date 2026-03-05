# MPA Judge V2 — Repository Review Report

**Date:** February 2026  
**Scope:** Structure, architecture, security, tests, CI/CD, and readiness.

---

## 1. Executive Summary

MPA Judge is a **Firebase-hosted adjudication web app** for MPA events: judge audio, transcription, caption feedback, ratings, and director-facing results. The repo is well-documented (PRD, AGENTS.md, README.md), uses a clear role model (admin / judge / director), and keeps critical transitions in Cloud Functions. Deploy and security posture are in good shape.

---

## 2. Repository Structure

| Area | Location | Notes |
|------|----------|------|
| **Frontend** | `public/` | Single-page app: `index.html`, `app.js`, `state.js`, `styles.css`, ES modules under `public/modules/` and `public/shared/` |
| **Backend** | `functions/` | Node 24, Firebase Functions v2 (onCall); single `index.js` (~1,971 lines) |
| **Rules** | `firestore.rules`, `storage.rules` | Role-based; directors see only released data |
| **Tests** | `tests/phase1.spec.ts` | Playwright E2E; requires env vars and running app |
| **CI/CD** | `.github/workflows/` | Deploy to Firebase Hosting on push to `main`; PR workflow present |
| **Docs** | `README.md`, `AGENTS.md`, `PRD.md` | Strong guidance for agents and product scope |

---

## 3. Architecture Alignment

- **Deterministic IDs:** Submissions use `{eventId}_{ensembleId}_{judgePosition}`; one submission per key. **Aligned.**
- **State transitions in Cloud Functions:** `releasePacket`, `unreleasePacket`, `lockSubmission`, `unlockSubmission`, packet completion and rating logic live in `functions/index.js`. **Aligned.**
- **One active event:** Enforced in rules and functions (e.g. `isActiveEvent`, schedule/assignment reads). **Aligned.**
- **Roles:** Admin, judge, director with no role leakage in rules and UI. **Aligned.**
- **Release rules:** Grade II–VI require stage1 + stage2 + stage3 + sight; Grade I stage1 + stage2 + stage3 (sight N/A). Implemented in `releasePacket` (e.g. `requiredPositionsForGrade`, `isSubmissionReady`, Grade I map). **Aligned.**

---

## 4. Security

- **Firestore:** Role-based read/write; directors read submissions only when `status == "released"`; judges restricted to own data; admin-only for sensitive writes. **Solid.**
- **Storage:** Audio and director cards scoped by `judgeUid` / `uid` and release status where needed. **Solid.**
- **Functions:** Callables use `assertAdmin` / `assertRole`; no raw admin SDK exposure to client. **Solid.**
- **Auth:** Email/password; anonymous only on emulators (`DEV_FLAGS.allowAnonymousSignIn`). Director self-signup constrained by Firestore rules (allowed keys, school existence). **Appropriate for Phase 1.**

---

## 5. Frontend Health

- **Entrypoint:** `app.js` (~292 lines) wires auth, version check (ETag-based, after auth init), and hash routing. Auth callback is try/catch wrapped to avoid blank/crash on error.
- **Largest module:** `public/modules/ui.js` is **~6,182 lines**. It holds tab/routing, auth UI, admin/director/judge-open rendering, modals, and many helpers. **Risk:** Hard to navigate and refactor; consider splitting by role or feature (e.g. `admin-ui.js`, `director-ui.js`, `judge-open-ui.js`) when touching flows.
- **Other modules:** `director.js` (~1,585), `judge-open.js` (~733), `judge.js` (~439), `admin.js` (~390), `state.js` (~576). `state.js` centralizes `COLLECTIONS`, `FIELDS`, `els`, and `state` — single source of truth for DOM and app state.
- **Bundling:** No build step; ES modules loaded from `public/`. Fine for Phase 1; consider bundling/minification if load time or cache invalidation becomes an issue.

---

## 6. Backend (Cloud Functions)

- **Runtime:** Node 24; Firebase Functions v2 `onCall`.
- **Exports (representative):** `provisionUser`, `createOpenPacket`, `submitOpenPacket`, `lockPacket`, `unlockPacket`, `releaseOpenPacket`, `unreleaseOpenPacket`, `releasePacket`, `unreleasePacket`, `lockSubmission`, `unlockSubmission`, transcription (e.g. `transcribePacketSession`, `transcribePacketTape`), `setUserPrefs`, `deleteEnsemble`, `renameEnsemble`, `deleteSchool`, `deleteEvent`, etc.
- **Predeploy:** `npm run lint` in `functions/` (ESLint). **Good.**
- **Secrets:** README documents `OPENAI_API_KEY` for transcription. No keys in repo.

---

## 7. Testing

- **Framework:** Playwright; config in `playwright.config.ts` (baseURL from `MPA_BASE_URL`, 120s timeout, fake media devices).
- **Phase 1 spec:** `tests/phase1.spec.ts` — serial smoke tests: admin (event + school), director (attach/ensemble/detach), admin (schedule + assignments + packet controls), judge (record/transcribe/draft). Requires env: `MPA_BASE_URL`, `MPA_ADMIN_EMAIL`, `MPA_ADMIN_PASSWORD`, `MPA_JUDGE_EMAIL`, `MPA_JUDGE_PASSWORD`, `MPA_DIRECTOR_EMAIL`, `MPA_DIRECTOR_PASSWORD`.
- **Bug:** Tests use `page.locator("#authStatus")` to assert sign-in/sign-out (e.g. email or "Signed out"). The app has **no element with `id="authStatus"`**; the signed-in/signed-out text is in **`#accountSummary`**. `state.js` has `els.authStatus = document.getElementById("authStatus")` (always `null`). **Action:** Either add an element with `id="authStatus"` and keep it in sync with account summary, or change the tests to use `#accountSummary`. Prefer one source of truth (e.g. `#accountSummary` and update tests).
- **Phase1 tests:** verify required env setup (`MPA_BASE_URL` and role credentials) before execution to avoid false negatives.

---

## 8. CI/CD and Deploy

- **Hosting:** Firebase Hosting; SPA rewrite to `/index.html`.
- **Workflows:** Deploy on merge to `main` (Firebase Hosting, channel `live`, project `mpa-judge-v2`). Uses `FIREBASE_SERVICE_ACCOUNT_MPA_JUDGE_V2`. PR workflow present.
- **Emulators:** Auth, Firestore, Functions, Hosting, Storage + UI on port 4000. Seed scripts: `seed:emulator`, `seed:mpa` (repertoire from PDF).

---

## 9. Documentation

- **README:** Local dev, provisioning, deploy, secrets, Grade I lookup test, repertoire seed. **Sufficient for onboarding.**
- **AGENTS.md:** Philosophy, data model, product rules, refactor policy, UX direction, out-of-scope. **Strong for AI/agent work.**
- **PRD.md:** Purpose, roles, journeys, feature requirements (event admin, auth, schools, ensemble profile, judge/director flows). **Good product reference.**
- **AGENTS.md + PRD.md:** Define implementation constraints and product behavior for ongoing development.

---

## 10. Findings Summary

| Category | Finding | Severity |
|----------|---------|----------|
| **Tests** | Phase 1 spec uses `#authStatus` but HTML only has `#accountSummary`; assertions will fail even with correct env. | **High** |
| **Frontend** | `public/modules/ui.js` is very large (~6.2k lines); consider splitting by role/feature. | **Medium** |
| **Tests** | Phase 1 report shows failures from missing `MPA_BASE_URL`; document env setup for CI or local. | **Medium** |
| **Architecture** | Matches AGENTS/PRD/PLANS: deterministic IDs, functions-owned transitions, one active event, release rules. | **Positive** |
| **Security** | Firestore and Storage rules and function guards are consistent and role-based. | **Positive** |
| **Auth** | Recent auth-init and version-check changes (deferred handleHashChange, try/catch, ETag-only) should reduce sign-in glitches. | **Positive** |

---

## 11. Recommended Next Steps

1. **Fix phase1 test selector:** Use `#accountSummary` in `tests/phase1.spec.ts` (and optionally remove unused `els.authStatus` from `state.js`), or introduce a single `#authStatus` element and keep it in sync with account state. Re-run phase1 with all env vars set.
2. **Document E2E env for CI:** Add a short section in README or a CI doc on setting `MPA_*` (and optionally running against a dedicated test project/emulator) so phase1 can be run in GitHub Actions or locally in a repeatable way.
3. **Plan UI module split:** When touching judge-open or admin/director flows, consider extracting chunks of `ui.js` into role- or feature-specific modules to improve maintainability.
4. **Keep current patterns:** Continue using Cloud Functions for all packet/submission state transitions and avoid client-only release/lock logic.

---

*End of report.*
