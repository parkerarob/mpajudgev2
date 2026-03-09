# MPA Judge V2 Full App Review

Date: March 8, 2026
Reviewer: Codex (automated + code audit)

## Automated Verification

- Unit tests: `63 passed`
- Functions lint: `pass`
- E2E smoke (prod): `4/4 passed`
- E2E release (prod): `2/2 passed`

## Overall Status

- Core workflows are operational and stable in current smoke/release coverage.
- No critical regressions were detected in the tested user paths.
- Key improvement opportunities remain in safety guardrails, responsiveness on heavy admin views, and interaction feedback consistency.

## Ranked Findings

### High: Test data cleanup matcher is too broad for destructive operation

- Location: `functions/index.js` (`isTestArtifactText`, `cleanupTestArtifacts`)
- Current behavior:
  - Matches any event/school id or name containing generic tokens like `test`, `demo`, `qa`, `sandbox`.
  - The callable is destructive and can recursively delete events/schools and linked artifacts.
- Risk:
  - Legitimate production entities with those words can be selected and deleted unintentionally.
  - Confirmation phrase helps, but does not reduce false-positive matching.
- Recommended fix:
  - Require explicit `tag` or metadata flag (e.g. `isTestArtifact: true`) for deletion candidates.
  - Keep keyword matching only for `dryRun` suggestion mode.
  - Add explicit exclusion for active event unless a separate stronger confirmation flag is provided.

### Medium: Admin packet review renders sequential network calls per ensemble

- Location: `public/modules/ui-admin-renderers.js` (loop over `filtered` with `await getPacketData`)
- Current behavior:
  - Packet data for each scheduled ensemble is fetched serially in a loop.
- Risk:
  - Noticeable slowdown/jank in schools with many ensembles.
  - UI appears unresponsive longer than necessary.
- Recommended fix:
  - Fetch packet data in parallel with bounded concurrency (e.g. 4-8 at a time) and render progressively.
  - Keep existing stale-view guards.

### Medium: Bulk school import lacks loading/error feedback guard

- Location: `public/modules/ui-admin-handlers.js` (`schoolBulkBtn` click handler)
- Current behavior:
  - No loading wrapper, button lock, or try/catch around async import.
- Risk:
  - Duplicate submits on repeated clicks.
  - Weak user feedback on long-running import or failure.
- Recommended fix:
  - Wrap action in `withLoading`.
  - Disable trigger while running.
  - Add explicit error message handling to `schoolResult` and alert fallback.

### Low: Coverage gap for UX polish/feedback states in automated tests

- Location: overall test suite (`tests/e2e/*`)
- Current behavior:
  - E2E validates key flows and release gating but not broad UI state quality (loading indicators, empty states, disabled states, focus behavior).
- Risk:
  - Regressions in UX polish can ship undetected.
- Recommended fix:
  - Add a small “UX contract” E2E suite for key interactive components:
    - loading state visibility
    - disabled button while in-flight
    - success/error status text presence
    - modal accessibility and focus return behavior

## Functionality and UX Assessment

- Functionality: Core intended flows currently pass.
- Cleanup: Tools exist and are usable; test-data cleanup needs safer targeting.
- Speed/responsiveness: Generally good; admin packet review likely to degrade at scale due to serial fetches.
- Interaction visuals: Most high-impact actions show status; bulk import remains an outlier.
- UI polish: Current interface is coherent and increasingly professional; next gain comes from consistency passes and UX-state regression tests.

## Priority Fix Plan

1. Harden `cleanupTestArtifacts` candidate selection and active-event safeguards.
2. Parallelize/batch packet data retrieval in admin packets view.
3. Add `withLoading` + error handling to bulk school import.
4. Add UX-state E2E coverage for interaction feedback and modal behavior.
