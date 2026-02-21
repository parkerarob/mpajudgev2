# PLANS.md — Phase 1 implementation plan

Checkpoint 0: Baseline
- Confirm Firebase project builds/deploys.
- Document current collections and UI entry points.

Checkpoint 1: Data model refactor
- Add active event concept (events.isActive).
- Replace schedule structure with stage-time roster under events/{eventId}/schedule.
- Add per-event judge assignments positions doc.

Checkpoint 2: Submission refactor
- Deterministic submission IDs.
- No server record until Submit.
- Locked-by-default after submit; unlock flow.

Checkpoint 3: Forms and scoring
- Stage + Sight form templates (7 captions each).
- Compute captionScoreTotal and computedFinalRatingJudge (I–V).
- Update parseTranscript to be template-aware.

Checkpoint 4: Packet views
- Admin packet view + verification checklist.
- Director packet view (released only).
- Compute overall rating dynamically.

Checkpoint 5: Atomic chair actions (Cloud Functions)
- releasePacket / unreleasePacket (atomic batch writes).
- unlockSubmission / lockSubmission.

Checkpoint 6: Security rules
- Firestore + Storage rules align with roles and release gating.

Checkpoint 7: Test Mode
- Test Ensemble, no Firestore writes, uses transcription + AI drafting.
- Allow switching stage/sight only in test.

Definition of done
- Admin can run an event end-to-end with dummy data.
- Directors only see released packets.
- Judges cannot submit wrong form type/position.
- No duplicate submissions possible.
- Release/unrelease is atomic.