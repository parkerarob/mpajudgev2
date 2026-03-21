# Production Readiness Technical Review

Date: 2026-03-21

Reviewer scope: Senior staff engineer / architecture / production readiness

Baseline: `post-event-fixes-director-packets-release` (`201e521`)

Total application code: ~46,000 lines (excluding node_modules)

Key reference: `docs/Post-Event-Technical-Report-2026-03-21.md`

---

## 1. Executive Summary

### What This Is

MPAJudgeV2 is a Firebase-based music adjudication platform that supports live MPA events for the North Carolina Bandmasters Association. It manages judge audio capture and scoring, admin event operations, packet officialization and release, and director access to released results. It successfully ran a real ~30-ensemble event at Ashley High School and survived a significant operational hardening cycle during and after that event.

### Current Maturity Level: Operational Prototype (Late MVP)

Evidence:

- Successfully operated a real event end-to-end
- 15 post-event commits totaling ~10.7k insertions of stabilization, repair tooling, and workflow hardening
- No staging environment; single Firebase project for all deployments
- 10,073-line monolithic Cloud Functions file with 64 callable functions
- ~70% of Firestore security rule paths have no test coverage
- Critical business logic (grade computation, release validation) runs correctly but with duplicated client/server implementations
- Admin recovery tooling was built reactively during the event itself

### Top 5 Strengths

1. **Correct architectural instincts.** Critical state transitions (release, lock, officialize) are server-side via Cloud Functions, not client-side. Deterministic submission IDs (`eventId_ensembleId_judgePosition`) prevent duplicates by design. Queue-first submission model where admin must explicitly approve canonical packet state.

2. **Strong Firestore security rules.** Rules (351 lines) enforce role-based access with field-level write constraints, school-scoped director isolation, status-gated visibility, and locked-state enforcement. Better than most Firebase MVPs.

3. **Operational repair tooling.** Post-event repair functions (`repairPacketReleaseState`, `repairOpenSubmissionAudioMetadata`, `restoreCanonicalFromOpenPacket`, `repairPacketSubmissionLinkage`) and diagnostic scripts. Shows real operational thinking.

4. **Audio pipeline robustness.** Multi-segment audio with explicit canonical stitched-tape requirements, release blocking when tape is missing, multiple repair paths, FFmpeg server-side stitching.

5. **Clear product domain model.** Source Sheet / Results Packet / Tape terminology, raw vs official assessments separation, Comments Only operational mode all reflect strong domain understanding.

### Top 5 Risks

1. **No staging environment.** All code deploys directly to production. No pre-production validation.

2. **10K-line monolithic Cloud Functions file.** 64 callable functions, all authorization, AI, PDF, audio, and workflow logic in one file.

3. **Security rule test coverage gap (~70% untested).** Packet, submission, schedule, and cross-collection rules lack test coverage.

4. **Client/server grade computation duplication.** `grade1-lookup.js` exists in both `functions/shared/` and `public/shared/` with manual sync.

5. **OpenAI cost exposure without global limits.** Per-user rate limits exist but no global daily spend cap.

### Readiness Assessment

| Target | Ready? | Blockers |
|--------|--------|----------|
| Another similar local event | Yes, with cleanup | Grade lookup sync, smoke tests, security rules review |
| Regional expansion (2-3 events) | Not yet | Staging env, security test expansion, multi-event isolation, runbook |
| Statewide deployment | No | Architectural rebuild, multi-tenant model, org isolation, formal security audit, load testing |

---

## 2. Architecture Snapshot

### Current Architecture

Client-heavy single-page application backed by Firebase services:

- **Frontend:** Vanilla JS SPA, no framework, no build system, no TypeScript
- **Backend:** Firebase Cloud Functions (64 onCall functions in one file)
- **Database:** Firestore (document-based, security rules for access control)
- **Storage:** Firebase Storage (audio files, PDFs, director cards)
- **Auth:** Firebase Authentication (email/password)
- **AI:** OpenAI (Whisper transcription + GPT caption drafting)
- **Hosting:** Firebase Hosting
- **CI/CD:** GitHub Actions → Firebase deploy

### Major Modules

| Module | Lines | Responsibility |
|--------|-------|---------------|
| `functions/index.js` | 10,073 | ALL backend logic |
| `public/modules/ui.js` | 6,485 | UI orchestration, tab/modal lifecycle |
| `public/modules/ui-admin-renderers.js` | 3,766 | Admin DOM rendering |
| `public/modules/director.js` | 2,242 | Director entry management |
| `public/modules/judge-open.js` | 1,418 | Judge recording and scoring |
| `public/modules/ui-admin-handlers.js` | 1,250 | Admin event handlers |
| `public/modules/admin.js` | 1,129 | Admin data operations |
| `public/state.js` | 1,105 | Global mutable state |
| `public/index.html` | 1,769 | Single HTML file with all views |
| `public/styles.css` | 5,375 | All styles |

### Trust Boundaries

1. **Client to Cloud Functions:** Critical mutations gated by `assertAdmin()`/`assertOpsLead()`/`assertRole()` server-side
2. **Cloud Functions to Firestore:** Admin SDK bypasses rules. Client writes constrained by Firestore rules.
3. **Client to Firestore Direct:** Rules enforce school-scoped access, locked-state gates, field-level constraints
4. **Cloud Functions to OpenAI:** API key in Firebase Secrets, per-user rate limits, no global cap

### High Coupling Areas

- `functions/index.js` couples all backend concerns in one file
- `state.js` is the global coupling point — all modules mutate it directly, no change notification
- Grade computation duplicated between client and server

---

## 3. Security Review

### Authentication

- Firebase Auth with email/password only
- No MFA (medium risk for admin accounts)
- Anonymous sign-in properly gated to emulator mode
- No password policy enforcement

### Authorization

- Four-tier RBAC: admin, teamLead (opsLead), judge, director, checkin
- Server: `assertAdmin()`, `assertOpsLead()`, `assertRole()` on Cloud Functions
- Client: CSS class toggling (`is-hidden`) for UI hiding — not security
- 25+ functions use assertion pattern, 15+ use inline checks (inconsistent)

### Firestore Security Rules — Key Findings

| Finding | Severity | Location |
|---------|----------|----------|
| Wildcard admin catch-all bypasses per-collection deny rules | Critical | `firestore.rules:347-349` |
| Director `list` on ensembles not school-scoped | Medium | `firestore.rules:188` |
| Checkin can read all director profiles | Medium | `firestore.rules:104-110` |
| `userData()` assumes user doc exists | Medium | `firestore.rules:22-23` |

### Storage Rules — Key Findings

| Finding | Severity | Location |
|---------|----------|----------|
| Wildcard admin catch-all | Critical | `storage.rules:113-115` |
| No audio path validation in Cloud Functions | Medium | `functions/index.js` `attachManualPacketAudio` |

### Other Security

- App Check in deferred mode (no abuse protection active)
- No audit trail for admin mutations (packet audit subcollection exists in rules but unused)
- Firebase config in source (expected for client SDK, not a vulnerability)

---

## 4. Data and Backend Review

### Schema Strengths

- Deterministic IDs prevent duplicate submissions
- Clear collection separation: rawAssessments → officialAssessments → packetExports
- Status fields enable state machine enforcement
- School-scoped isolation via schoolId

### Schema Risks

- Flat collections (all submissions for all events in one collection)
- No archive/partition strategy
- Only 4 composite indexes defined (missing several needed patterns)

### Transaction Usage

- Good: `releasePacket`, `unreleasePacket`, `checkRateLimit`, `setPacketCommentsOnly` use transactions
- Missing: `submitOpenPacket` session creation, director export generation, repair operations

### Cloud Functions Issues

- PDF template errors throw `Error` not `HttpsError` (opaque 500s)
- Release succeeds even if export generation fails
- `maxInstances: 10` global cap blocks operations under concurrent load
- `releaseMockPacketForAshleyTesting` test function deployed to production
- Create operations not idempotent (retry creates duplicates)

---

## 5. Frontend Review

### Architecture

- Vanilla JS SPA, no framework, no TypeScript, no build system
- All HTML in one 1,769-line file
- Global mutable state object (1,105 lines) with no change notification
- Manual DOM manipulation with innerHTML (58 uses in admin renderers, XSS risk)

### Fragile Workflows

- Judge recording auto-rollover: no max-attempts counter, cascade risk under network stress
- Autosave: no timeout on in-flight flag, Firestore hang = permanent block
- Packet release → export: release succeeds even if export fails

### Duplication

- `calculateCaptionTotal`/`computeFinalRating` duplicated in judge-open.js and judge-shared.js
- Role checking duplicated across multiple files

---

## 6. Operational Readiness

| Area | Status |
|------|--------|
| Cloud Functions logging | Good (structured logger throughout) |
| Client-side logging | Basic (console.warn/error only) |
| Error tracking | Missing (no Sentry/Crashlytics) |
| Performance monitoring | Missing |
| Audit trail | Missing (subcollection exists but unused) |
| Staging environment | Missing |
| Rollback procedure | Missing |
| Test coverage | ~20% critical paths, ~30% security rules |
| Operational runbook | Missing |

---

## 7. Scalability Assessment

| Component | Current | Breaking Point |
|-----------|---------|----------------|
| `maxInstances: 10` | ~30 ensembles | 3+ concurrent events |
| Flat Firestore collections | ~120 submissions | 10K+ across events/years |
| Single Firebase project | 1 event site | Multi-site concurrent events |
| OpenAI rate limits | Per-user only | Coordinated usage |
| Single HTML file | ~30 views | 50+ views at statewide scale |

### Multi-Tenant Gaps

- Hardcoded org branding in index.html
- No organization/district/site abstraction in data model
- Schools and users are global, not org-scoped
- No org-admin vs site-admin distinction

---

## 8. Technical Debt Register

| Priority | Severity | Area | Finding | Effort | Timing |
|----------|----------|------|---------|--------|--------|
| P0 | Critical | Security | Wildcard catch-all in Firestore rules | S | Now |
| P0 | Critical | Security | Wildcard catch-all in Storage rules | S | Now |
| P0 | High | Ops | No staging environment | M | Now |
| P0 | High | Data | Duplicated grade computation | S | Now |
| P1 | High | Security | Director ensemble list not scoped | S | Before next event |
| P1 | High | Security | App Check in deferred mode | S | Before next event |
| P1 | High | Audit | No admin mutation audit trail | M | Before next event |
| P1 | High | Backend | 10K-line monolith | L | Before next event |
| P1 | High | Test | ~70% security rules untested | M | Before next event |
| P1 | Medium | Backend | Release succeeds despite export failure | S | Before next event |
| P1 | Medium | Backend | PDF errors throw wrong error type | S | Before next event |
| P1 | Medium | Frontend | innerHTML XSS in admin renderers | S | Before next event |
| P1 | Medium | Backend | maxInstances: 10 too low | S | Before next event |
| P2 | Medium | Frontend | Autosave in-flight no timeout | S | Before regional |
| P2 | Medium | Backend | No global OpenAI spend cap | M | Before regional |
| P2 | Medium | Frontend | Global mutable state, no events | M | Before regional |

---

## 9. Conclusion

The system proved the product concept works. The code served its purpose under event-day pressure. The domain model, role boundaries, and critical-path server enforcement are sound architectural decisions that should carry forward.

The codebase is not a production platform and should not be treated as one. It is a reference implementation that informed the real requirements. The next step is a clean rebuild on a stack designed for the relational data model, multi-tenant isolation, transactional integrity, and operational observability that statewide adoption demands.
