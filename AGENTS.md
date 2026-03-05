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
4. Stability and reliability
5. Maintainability
6. UX clarity
7. Performance
8. Visual polish

Refactor when it materially improves readability, determinism, separation of concerns, or runtime stability.

Avoid cosmetic churn without functional benefit.

---

## 2. Architectural Principles

### A. Deterministic Data Model

- Submissions use deterministic IDs:
  `{eventId}_{ensembleId}_{judgePosition}`
- Exactly one submission per deterministic key.
- Packet-level state transitions must remain atomic.

### B. Clear Role Boundaries

Roles:
- `admin`
- `judge`
- `director`

No role leakage in UI or security rules.

### C. Event-Centric System

- Exactly one active event at a time.
- Schedule is the source of truth.
- Judges act only on scheduled ensembles for the active event.

### D. Cloud Functions Own Critical Transitions

The following are never client-only logic:

- `releasePacket`
- `unreleasePacket`
- `lockSubmission`
- `unlockSubmission`
- Packet completion validation
- Overall rating computation

---

## 3. Product Rules (Non-Negotiable)

Always enforce:

- One active event.
- Judges assigned to exactly one `judgePosition` per event.
- Live mode locks `judgePosition` and `formType`.
- Submissions lock immediately after submit.
- Directors see only released packets.
- Release allowed only when packet is complete:
  - Grades II–VI: `stage1 + stage2 + stage3 + sight`
  - Grade I: `stage1 + stage2 + stage3` (sight N/A)

### Scoring Rules

- 7 captions per form.
- Caption grades: A/B/C/D/F (`+/-` display only).
- Numeric conversion ignores `+/-`:
  - A=1, B=2, C=3, D=4, F=5
- `captionScoreTotal` range: 7–35.
- Judge rating computed deterministically from total.
- Overall rating uses NCBA chart + unanimous stage rule.

If uncertain, enforce stricter logic.

---

## 4. Working Agreements From Recent Sessions

These reflect how this project has actually been run and should guide future work:

- Stability-first execution:
  - If UI instability appears (jank, crashes, full refresh behavior), simplify/disable unstable paths first.
  - Prefer a smaller reliable surface over preserving legacy UI.
- Replace, then remove:
  - When a new flow is accepted, remove legacy UI/render paths instead of keeping both.
- Incremental refactor strategy:
  - Extract large `ui.js` areas into focused modules.
  - Keep `ui.js` as orchestration/delegation, not feature implementation.
- Avoid expensive hidden rendering:
  - Do not fully render heavy views that are not active.
  - Load detailed data only on explicit user action.
- UX priority for this app:
  - Desktop-first readability and workflow speed.
  - Mobile compatibility is required, but secondary.
- Admin workflow shaping:
  - School-first drill-down for pre-event management.
  - Ensemble-level live-event actions where operationally required.

---

## 5. Refactoring Policy

You may:

- Split large files into modules.
- Extract UI logic from business logic.
- Consolidate duplicated logic.
- Remove dead code that is no longer referenced.
- Reduce watcher/render churn.

You must:

- Preserve deterministic IDs and release invariants.
- Avoid silent rule changes.
- Keep data model compatibility unless explicitly migrating.
- Keep release logic atomic.

---

## 6. Scope Guardrails

Out of scope unless explicitly requested:

- Notifications
- School join codes
- Multi-event concurrency
- Complex approval workflows

Exports are allowed when explicitly requested.

---

## 7. Definition of Success

A stable release supports:

- Admin running event operations without manual DB patching
- Judges recording/scoring/submitting reliably
- Atomic packet release/unrelease
- Directors seeing only released packet history
- No duplicate submissions
- No partial release states
