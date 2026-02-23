# AGENTS.md — MPA Judge Development Guidelines

You are Codex, working in the MPA Judge repository.

Your job is not just to implement features, but to improve clarity, correctness, maintainability, and product quality.

---

## 1. Development Philosophy

This is a production-bound adjudication system.

Priorities (in order):

1. Correctness and rule enforcement
2. Data integrity
3. Security
4. Maintainability
5. UX clarity
6. Performance
7. Visual polish

You are allowed — and encouraged — to refactor when it meaningfully improves:
- Readability
- Separation of concerns
- Determinism
- State management
- Security
- UX structure

Avoid cosmetic churn without functional benefit.

---

## 2. Architectural Principles

### A. Deterministic Data Model

- All submissions use deterministic IDs:  
  `{eventId}_{ensembleId}_{judgePosition}`
- Exactly one submission per key.
- All packet-level actions must be atomic.

---

### B. Clear Role Boundaries

Roles:
- `admin`
- `judge`
- `director`

No role leakage in UI or security rules.

---

### C. Event-Centric System

- Exactly one active event at a time.
- Schedule is the source of truth.
- Judges may only act on scheduled ensembles for the active event.

---

### D. Cloud Functions Own State Transitions

The following must never be client-only logic:

- `releasePacket`
- `unreleasePacket`
- `lockSubmission`
- `unlockSubmission`
- Packet completion validation
- Overall rating computation

All cross-document state transitions must be atomic.

---

## 3. Product Rules (Non-Negotiable)

These must always be enforced:

- One active event.
- Judges assigned to exactly one `judgePosition` per event.
- Live mode locks `judgePosition` and `formType`.
- Submissions are locked immediately after submit.
- Directors see only released packets.
- Release allowed only if packet is complete:
  - Grades II–VI: stage1 + stage2 + stage3 + sight required
  - Grade I: stage1 + stage2 + stage3 required (sight N/A)

### Scoring Rules

- 7 captions per form.
- Caption grades: A/B/C/D/F (± allowed for display only).
- Numeric scoring ignores ±:
  - A = 1
  - B = 2
  - C = 3
  - D = 4
  - F = 5
- `captionScoreTotal` range: 7–35.
- Judge rating computed deterministically from total.
- Overall rating computed from:
  - 3 stage judges + sight (if required)
  - NCBA chart
  - Unanimous stage rule

If uncertain, enforce stricter logic.

---

## 4. Refactoring Policy

You may:

- Split large files (e.g., `app.js`) into modules.
- Extract UI logic from business logic.
- Improve naming for clarity.
- Consolidate duplicated logic.
- Improve performance bottlenecks.
- Improve mobile UX structure.

You must:

- Preserve deterministic submission IDs.
- Avoid silent rule changes.
- Maintain backward compatibility of data model unless explicitly migrating.
- Keep release logic atomic.

---

## 5. UX Direction

The app is mobile-first.

Aim for:

- Clear step-based judge flows (Record → Score → Review → Submit)
- Minimal cognitive load
- Strong visual state indicators (Draft / Submitted / Locked / Released)
- Clear separation between roles
- Reduced nesting and dashboard-style density

Avoid:

- Admin-dashboard-style complexity in judge flow
- Deep panel nesting
- Overly dense layouts
- Unclear state transitions

---

## 6. Explicitly Out of Scope (Unless Requested)

- Notifications
- Data exports
- School join codes
- Multi-event concurrency
- Complex approval workflows

---

## 7. Deliverables

A successful Phase 1 implementation allows:

- Admin to run an event end-to-end.
- Judges to record, score, and submit.
- Admin to release packets atomically.
- Directors to view released history only.
- No duplicate submissions.
- No partial release states.
- No manual Firestore patching required.