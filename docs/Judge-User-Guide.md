# Judge User Guide

## Purpose
- Judges deliver official adjudications through the judge workspace, capturing audio, completing caption comments, assigning scores, and submitting assessments for each ensemble/judge position.
- Every submission maps to a deterministic ID (`{eventId}_{ensembleId}_{judgePosition}`) and locks automatically on submit. Do not attempt to edit a locked submission yourself; contact admin if a redo is required.

## Before you start
1. Sign in with your judge credentials.
2. Open the `Judge` workspace.
3. Confirm you are assigned to only one judge position for the active event; the system enforces this, so any extra assignments indicate an admin mistake.
4. Choose **Official Workspace** unless you are explicitly practicing in the optional practice mode.
5. Verify you are connected to the correct ensemble and grade (Grade I vs Grades II–VI affects later stages).

## Recording the performance
1. Select the target ensemble.
2. Press **Start Recording** and capture the full performance.
3. Speak naturally—no special cues unless the admin asked for them.
4. Press **Stop** when the performance ends.
5. Confirm the recording appears in the audio panel before proceeding to captions.

## Caption scoring breakdown
- Each form contains **exactly seven captions**.
- Caption grades are limited to `A`, `B`, `C`, `D`, or `F` (displayed with optional `+`/`-`/` +/-` hints but ignored numerically).
- Numeric conversion for totals is `A=1`, `B=2`, `C=3`, `D=4`, `F=5`. The **caption score total** thus ranges between 7 and 35.
- The sticky footer shows:
  - Current caption total.
  - Derived judge overall rating (formula is deterministic based on caption total and stage data).

## Filling out the form
1. Enter required caption comments for each of the seven captions.
2. Assign a grade to each caption. Do not leave any caption blank; the form will block submission until all captions are complete.
3. Add transcript or reference notes if they help, but they are optional.
4. Use AI assist only if your event admin enabled it; do not rely on it for mandatory information.

## Submitting and locking
1. Double-check that:
  - All seven captions are scored.
  - Stage-specific inputs are complete (Grades II–VI need Stage 1, Stage 2, Stage 3, and sight; Grade I needs Stage 1–3 only).
  - Sight is recorded when required; the form will enforce it.
2. Click **Submit**.
3. Wait for the confirmation that the submission is locked—**submissions lock immediately** and cannot be edited without admin intervention.
4. If you realize you submitted in error, flag it to admin right away; they are responsible for unlocking and reassigning if necessary.

## After submission
- Move on only after the lock is confirmed. Do not interrupt a subsequent judge or return to the same ensemble unless admin unlocked you.
- Use the `Live Submissions` workspace only if admin explicitly routes you there for reassignment or practice corrections.

## Practice mode notes
- Use **Practice Workspace** when rehearsing. Practice submissions are not visible to directors or included in release logic.
- Always switch back to **Official Workspace** for actual event work.

## Troubleshooting
- **App says captions incomplete**: verify each of the seven captions has a grade and comment; the system enforces this strictly.
- **Still waiting for the recording**: replay the captured audio before you proceed. If playback fails, stop and restart the capture, then reenter captions if necessary.
- **Sight stage missing on Grades II–VI**: confirm you filled the sight inputs; it is required for the packet release path.
- **Submission locked but you need changes**: contact admin—they control all unlock/reassign actions for deterministic IDs.

## Tips for reliability
1. Refresh once per session before starting to avoid stale assignments.
2. Use a stable internet connection; broken submissions may leave judge positions blocked for release.
3. Keep one tab per ensemble/judge role to avoid accidentally working on multiple ensembles simultaneously.
