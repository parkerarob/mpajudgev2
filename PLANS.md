# PLANS.md — Phase 1 Product Plan

Phase 1 defines a complete, deterministic event adjudication cycle.

The goal is not just feature completion — it is a stable, enforceable adjudication workflow.

---

# System Overview

An event moves through five states:

1. Event created
2. Judges assigned
3. Judges submit
4. Packet verified complete
5. Packet released to director

All transitions must be deterministic and secure.

---

# Phase 1 Milestones

---

## Milestone 1 — Event Foundation

- Enforce single active event.
- Schedule stored under:
  `events/{eventId}/schedule`
- Judges assigned per-event with fixed position.
- Active event clearly surfaced in UI.

### Definition of Done

- Judges cannot act outside active event.
- No ambiguity in assignment.
- Schedule is the authoritative roster.

---

## Milestone 2 — Deterministic Submissions

- Submission ID format:
  `{eventId}_{ensembleId}_{judgePosition}`
- No Firestore record until Submit.
- Submission locked immediately after submit.
- Unlock flow handled via Cloud Function.

### Definition of Done

- No duplicate submissions possible.
- Locked state enforced in security rules.
- Client cannot override locked submission.

---

## Milestone 3 — Scoring Engine

- 7 captions per form (stage and sight).
- Caption numeric conversion ignores ±.
- `captionScoreTotal` computed client-side and validated server-side.
- Judge rating computed deterministically from total.

### Definition of Done

- No invalid totals possible.
- Judge cannot submit incomplete captions.
- Rating ranges strictly enforced.

---

## Milestone 4 — Packet Completion Logic

- Determine required positions by grade.
- Validate packet completeness.
- Compute overall rating dynamically.
- Admin packet verification checklist.

### Definition of Done

- Incomplete packet cannot be released.
- Grade I correctly omits sight.
- Overall rating calculation matches NCBA rules.

---

## Milestone 5 — Atomic Chair Actions

Cloud Functions must implement:

- `releasePacket`
- `unreleasePacket`
- `lockSubmission`
- `unlockSubmission`

All packet-level changes must:

- Use batch writes or transactions.
- Never leave partial state.
- Validate completeness before release.

### Definition of Done

- Release/unrelease always atomic.
- Directors only see fully released packets.
- No partial release states possible.

---

## Milestone 6 — Security Rules

- Role-based access control.
- Judges limited to their assigned position.
- Directors read-only on released packets.
- Admin full access.
- Test Mode isolated from production data.

### Definition of Done

- No client-side bypass possible.
- Rules mirror product logic exactly.
- Role leakage impossible.

---

## Milestone 7 — Test Mode

- No Firestore writes.
- Allows switching stage/sight.
- Uses transcription + AI caption drafting.
- Fully isolated from live mode.

### Definition of Done

- No test data pollutes production data.
- Live constraints remain enforced.
- Judge experience mirrors live flow without persistence.

---

# Definition of Phase 1 Complete

The system supports:

- One full event lifecycle.
- Deterministic scoring.
- Atomic release.
- Secure role isolation.
- Mobile-usable judge flow.
- Zero duplicate submissions.
- Zero partial state transitions.

The system should not require manual database corrections.