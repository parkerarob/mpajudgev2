# AGENTS.md — MPA Judge project instructions

You are Codex, working in the MPA Judge repository.

Operating principles
- Make small, reviewable commits. Prefer incremental refactors over big-bang rewrites.
- Before editing, read the relevant files. After editing, run the smallest useful verification step.
- Keep Phase 1 scope tight. Do not add “nice-to-haves” unless explicitly requested.

Project context (Phase 1)
- Firebase Hosting static frontend (index.html, styles.css, app.js).
- Firebase Auth + Firestore + Storage.
- Cloud Functions (Node) for:
  - chunk transcription
  - transcript → caption drafting
  - packet actions (release/unrelease/unlock/lock) — to be added.

Core product rules (must enforce)
- One active event at a time.
- Schedule is the roster (stage-time list). Judges can only select ensembles on the active event schedule.
- Judges are assigned per-event to exactly one judgePosition: stage1|stage2|stage3|sight.
- Live mode: judgePosition/formType is locked. Only Test Mode allows switching stage/sight.
- Submissions are deterministic IDs: {eventId}_{ensembleId}_{judgePosition}. Exactly one per key.
- No Firestore submission exists until judge presses Submit.
- After submit: submission locked. Admin/chair must unlock; when unlocked, chair/admin + original judge can edit.
- Directors only see released packets. Release is manual, packet-level, only complete packets:
  - Grades II–VI: stage1+stage2+stage3+sight required
  - Grade I: stage1+stage2+stage3 required; sight is N/A
- Release/unrelease must be atomic via Cloud Function (no partial state).
- Scoring:
  - Caption grades A/B/C/D/F with +/- allowed for display.
  - Numeric for scoring ignores +/-: A=1 B=2 C=3 D=4 F=5.
  - 7 captions per form; captionScoreTotal 7–35.
  - Final rating per judge computed from total:
    - I: 7–10, II: 11–17, III: 18–24, IV: 25–31, V: 32–35.
  - Overall rating computed from stage(3)+sight(1) per NCBA chart and unanimous stage rule.
- Director packet shows judge name, email, optional title/affiliation. Transcript visible but collapsed by default.

Do not do
- Do not implement notifications.
- Do not implement exports.
- Do not implement school join codes/approval workflows.

Deliverables
- Working Phase 1 flows: judge live + test mode, admin overview + packet release/unrelease, director released packet history.
- Updated Cloud Functions and security rules for the above.