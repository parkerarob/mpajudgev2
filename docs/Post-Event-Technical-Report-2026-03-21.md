# Post-Event Technical Report

Date: 2026-03-21

Baseline tag: `event-release-v2` (`f720a29`)

Current tag: `post-event-fixes-director-packets-release` (`201e521`)

Range covered: `event-release-v2..post-event-fixes-director-packets-release`

## Purpose

This document records the major technical and operational changes made after the event-release baseline and through the post-event stabilization window. It is intended as the durable engineering record of what changed, why it changed, and what the system now assumes.

This is not a commit-by-commit changelog. It is a structured summary of the important product, workflow, and backend changes that materially affected event operations.

## Scope Summary

Change volume over the covered range:

- 15 commits
- 48 files changed
- ~10.7k insertions
- ~2.7k deletions

Most change volume landed in:

- `functions/index.js`
- `public/modules/ui-admin-renderers.js`
- `public/styles.css`
- `public/modules/ui.js`
- `public/index.html`
- `public/modules/ui-checkin.js`

## Covered Commits

Commits in range:

1. `e892ed3` Harden event release branch
2. `759e8ca` Add admin pizza totals reports
3. `bda0494` Update pizza order text
4. `90bb352` Simplify judge view UI - remove redundant hint text and clutter
5. `4a6876f` Remove verbose header text from judge view
6. `3ec8a9d` Remove judge summary hero card and redundant event name
7. `4e5162d` Reduce judge step clutter - spacing, mic text, tape empty text
8. `fabbb92` Continue judge view declutter
9. `78f1c9a` Judge view UI overhaul - navigation, grading, and layout improvements
10. `47393a9` Director workspace UI overhaul and user guide docs
11. `9b5736f` Add event ops workflow and admin packet editing tools
12. `5776269` Add packet repair tools and admin ratings view
13. `026f1ba` Stabilize event routing and admin packet recovery
14. `b74ef41` Stabilize packet release and audio recovery
15. `201e521` Fix Grade II sight release and scoring

## Major Product And Workflow Changes

### 1. Judge flow simplification

The judge experience was significantly decluttered and reframed toward live-event reliability.

Key outcomes:

- Reduced visual noise in judge views.
- Removed redundant hero/header text and step clutter.
- Simplified judge navigation and grading layout.
- Reworked judge live/open-sheet rendering into more focused modules.
- Clarified empty-state and tape-related wording.

Files primarily involved:

- `public/modules/ui.js`
- `public/modules/judge-open.js`
- `public/modules/ui-judge-open-core.js`
- `public/modules/ui-judge-open-handlers.js`
- `public/modules/ui-judge-open-reference.js`
- `public/modules/ui-judge-open-renderers.js`
- `public/styles.css`

Operational impact:

- Faster judging flow.
- Less confusion around live submission vs in-progress work.
- Better event-day usability under pressure.

### 2. Director workspace overhaul

The director side was upgraded from a lighter viewer into a more complete released-results experience.

Key outcomes:

- Director workspace UI overhaul.
- Added director user guide documentation.
- Director Results Packet page now begins with a ratings overview.
- Released sheet sections are collapsible to reduce page overload.
- File generation wording changed from "Load" to "Generate Score Sheets".
- Director-side released packet ordering now matches the ratings overview.
- Director packet discovery was changed to load from released export records instead of reconstructing solely from fragile client-side watcher paths.

Files primarily involved:

- `public/modules/director.js`
- `public/modules/ui-director-packets.js`
- `public/modules/ui-director-ensemble-table.js`
- `public/modules/ui-director-entry-form.js`
- `docs/Director-User-Guide.md`

Operational impact:

- Directors now receive a more stable released-results surface.
- Director-side access issues can be traced more deterministically.
- Released packet delivery is tied more directly to the packet export path.

### 3. Admin event operations workflow expansion

Admin operations were expanded significantly to support live event management, packet auditing, and targeted repair.

Key outcomes:

- Added school-first and ensemble-level event operations surfaces.
- Added admin packet editing and recovery tools.
- Added release audit view for all ensembles.
- Added row-level tracing for:
  - release status
  - director access
  - packet/source linkage
- Added more explicit packet maintenance surfaces.

Files primarily involved:

- `public/modules/admin-event-tools.js`
- `public/modules/admin.js`
- `public/modules/ui-admin-handlers.js`
- `public/modules/ui-admin-live-renderers.js`
- `public/modules/ui-admin-renderers.js`
- `public/modules/ui-admin-announcer.js`
- `public/modules/ui-admin-formatters.js`
- `public/modules/ui-admin-preevent.js`
- `public/index.html`

Operational impact:

- Admin has much better visibility into why a packet is or is not releasable.
- Packet recovery no longer requires as much blind database guessing.
- Post-event audit and repair is materially easier.

### 4. Ratings and packet reporting improvements

The ratings/reporting surfaces were hardened and cleaned up for both admin and director use.

Key outcomes:

- Added admin ratings view.
- Fixed ratings-page duplicate rendering.
- Added clearer column dividers in ratings tables.
- Results views now prefer `performanceGrade` over declared grade where appropriate.
- Director results now show ratings overview first.

Files primarily involved:

- `public/modules/ui-admin-renderers.js`
- `public/modules/firestore.js`
- `public/modules/ui-director-packets.js`
- `public/index.html`
- `public/styles.css`

Operational impact:

- Ratings reports are easier to scan.
- Less duplicate/noisy rendering.
- Better alignment between displayed grade data and event reality.

## Canonical Packet And Source-Sheet Model Changes

### 5. Queue-first submission model

One of the most important shifts in this range was simplifying live routing by separating source capture from canonical event packet state.

The intended model after the change:

- judges work on Source Sheets
- Event Day submit creates review intake, not automatic canonical placement
- canonical Results Packet slots are created or updated only when admin explicitly approves or restores into the slot

This replaced a more ambiguous model where source-sheet actions and canonical placement were more tightly coupled and easier to confuse.

Key outcomes:

- Stronger separation between source artifacts and canonical packet state.
- Reduced accidental early canonical linkage.
- Improved admin control over what becomes official.

Files primarily involved:

- `functions/index.js`
- `public/modules/ui-admin-renderers.js`
- `public/modules/ui.js`

### 6. Terminology cleanup

User-facing language was adjusted to better match actual system behavior while preserving the existing Firestore model.

Key vocabulary shift:

- one judge form = `Source Sheet`
- official ensemble bundle = `Results Packet`
- judge audio = `Tape`

Important constraints:

- Firestore/collection names were not renamed.
- Internal code still uses some legacy naming, but the UI language is clearer.

Operational impact:

- Reduced confusion between a single judge record and the full ensemble packet.
- Better alignment with real operator mental models.

## Audio And Tape Recovery Changes

### 7. Canonical stitched tape as the required packet audio

Audio handling was tightened so release logic relies on stitched canonical packet tape rather than loosely falling back to partial or source-only audio.

Key outcomes:

- Canonical packet audio is treated as the official release/review tape.
- Admin and director packet views were moved away from silently trusting partial fallback audio.
- Missing stitched tape now blocks release explicitly.

Important result:

- The system now surfaces "stitched tape missing" as a real blocker instead of quietly releasing partial audio.

### 8. Repair and recovery tools for audio

Audio repair tooling was expanded significantly.

Repair paths added or improved:

- `repairOpenSubmissionAudioMetadata`
- `restoreCanonicalFromOpenPacket`
- `repairPacketSubmissionLinkage`
- targeted per-packet tape restitch
- better diagnostics for failed restitch attempts
- UI flow to jump directly to the failing Source Sheet

Later improvements added:

- support for using stored Source Sheet audio even if original session docs were gone
- support for replacing the primary tape vs attaching supplemental audio
- more readable failure messages when Storage objects were missing

Files primarily involved:

- `functions/index.js`
- `public/modules/admin.js`
- `public/modules/ui-admin-renderers.js`

Operational impact:

- Better recovery from broken/missing audio state.
- More explicit distinction between source audio, supplemental audio, and primary packet tape.
- Better debugging when packet release is blocked by tape readiness.

## Release And Unrelease Hardening

### 9. Release-path hardening

Packet release logic was hardened to prevent invalid or ambiguous release states.

Key outcomes:

- clearer release blockers
- more explicit per-slot diagnostics
- prevention of release when stitched canonical tape is missing
- stronger completion checks

### 10. Partial release detection and repair

One class of failures during operations involved partial release states, where one or more canonical slots were marked released while the full packet was not consistently released.

To address that:

- invalid partial-release packet state is now surfaced more clearly in admin
- a targeted repair action was added to reset a packet back to a clean unreleased state
- release tracing now shows `Ready`, `Released`, or `Blocked` rather than misleading status text

Files primarily involved:

- `functions/index.js`
- `public/modules/admin.js`
- `public/modules/ui-admin-renderers.js`
- `public/modules/ui.js`

Operational impact:

- Reduced risk of directors seeing inconsistent packet states.
- Better recovery from bad mixed-status canonical packets.

## Director Access And Visibility Diagnostics

### 11. Director access tracing

There were cases where admin showed a packet as released but the director could not see it. To debug those cases, new comparison surfaces were added.

Tracing now allows inspection of:

- schedule entry school linkage
- event entry school linkage
- canonical packet slot school linkage
- packet export linkage
- assigned director user linkage
- school ensemble roster existence

Files primarily involved:

- `functions/scripts/inspect-director-packet-access.js`
- `public/modules/ui-admin-renderers.js`

Operational impact:

- Mismatches are now easier to prove or rule out.
- Debugging shifted from guesswork to explicit state comparison.

### 12. Director debug instrumentation

Temporary director-side debug output was added during troubleshooting to verify:

- current user
- resolved school id
- selected event id
- ensemble cache count
- packet group count
- released group count

This helped isolate cases where the director runtime was correctly initialized but the old watcher path still returned no results.

## Comments Only Mode

### 13. Comments Only as a real packet mode

`commentsOnly` stopped being just a registration flag and became an operational packet mode.

Key outcomes:

- Admin can force or clear Comments Only retroactively.
- Comments Only packets display `CO` overall.
- Caption grade presentation is suppressed appropriately.
- Director exports regenerate with the Comments Only presentation.

Files primarily involved:

- `functions/index.js`
- `functions/shared/constants.js`
- `public/modules/judge-shared.js`
- `public/modules/firestore.js`
- `public/modules/admin.js`
- `public/modules/ui-admin-renderers.js`
- `public/modules/ui-director-packets.js`
- `public/modules/ui.js`

Operational impact:

- Supports both preselected comments-only participation and retroactive forced non-rated handling.
- Provides a cleaner administrative path for disqualification-like outcomes or unrecoverable judging exceptions.

## Rule Corrections And Scoring Fixes

### 14. Grade I lookup correction

The Grade I lookup table was corrected to match the rule chart, including canonical sorted-key handling such as:

- `332` represented as `233`
- similar sorted-key normalization fixes

Files primarily involved:

- `functions/shared/grade1-lookup.js`
- `public/shared/grade1-lookup.js`
- `functions/scripts/test-grade1-lookup.js`

### 15. Grade I / Grade II sight-reading rule correction

One of the final operational corrections in this range was the grade/sight rule.

Final correct rule after the fix:

- `Grade I`: no sight required
- `Grade I/II`: no sight required
- `Grade II`: sight required
- Grades III-VI: sight required

This affected:

- release validation
- packet completion logic
- director packet generation
- ratings/overall display

Files primarily involved:

- `functions/index.js`
- `public/modules/judge-shared.js`
- `public/modules/ui-director-packets.js`

### 16. Final Grade II overall display correction

A final bug remained after the rule correction: the client-side summary logic was still treating plain `Grade II` like `Grade I/II`, causing sight to be ignored in some displays.

This was corrected in the final commit:

- `201e521` Fix Grade II sight release and scoring

Operational impact:

- Grade II packets now include sight in overall display again.
- Brewster-style cases now show the correct overall.

## PDF And Export Notes

### 17. PDF score sheet mapping adjustment

The score-sheet generation path was corrected so stage PDF grade letters align with the correct caption rows rather than being offset relative to the comments.

Primary implementation area:

- `functions/index.js`

### 18. Director export stabilization

Director packet export generation was made more central to director consumption, particularly after moving away from the more fragile client-side released-packet discovery path.

Operational impact:

- Directors now depend more directly on released packet export state.
- Re-release or regeneration is the right corrective tool when admin data and director view diverge.

## Security And Rules

### 19. Firestore and Storage rules adjustments

Security tests and rules were updated as part of the operational hardening work.

Files involved:

- `firestore.rules`
- `storage.rules`
- `tests/security/firestoreRules.test.mjs`
- `tests/security/storageRules.test.mjs`

This did not represent a wholesale security redesign, but it is part of the release hardening and should be treated as relevant to the event operations window.

## Debug And Inspection Tooling Added

Inspection scripts added in this range:

- `functions/scripts/inspect-director-packet-access.js`
- `functions/scripts/inspect-ensemble-grade.js`
- `functions/scripts/inspect-open-sheet.js`

These scripts exist to reduce blind debugging during event operations and support targeted inspection of live-state problems.

## Documentation Added Or Updated

New/updated docs in this range:

- `docs/Director-User-Guide.md`
- `docs/Judge-User-Guide.md`
- `README.md`

These are not the main technical artifact of the range, but they reflect the shift toward clearer, more supportable operational workflows.

## Net System Impact

From the event-release baseline to the current post-event tag, the system moved materially in these directions:

- more explicit separation between source capture and canonical official packet state
- stronger release/unrelease invariants
- much better admin diagnostics and repair tooling
- tighter handling of canonical audio/tape requirements
- more reliable director released-packet discovery
- clearer terminology and UI mental models
- more complete support for exceptional event-day operations

## Important Final-State Assumptions

As of `post-event-fixes-director-packets-release`, the system should be understood with these assumptions:

1. Canonical packet state is the official source of truth for release.
2. Source Sheets can persist behind the Results Packet as source artifacts or recovery inputs.
3. Release should not proceed when required stitched canonical tape is missing.
4. Partial release state is invalid and should be repaired before normal operations continue.
5. Comments Only is a real operational mode, not just a registration annotation.
6. Grade II requires sight.
7. Only Grade I and Grade I/II are no-sight packet paths.

## Remaining Recommendation

The codebase is materially stronger than it was at `event-release-v2`, but several important fixes in this range were repair-oriented and added under live operational pressure. The next recommended engineering phase should be a cleanup and consolidation pass focused on:

- reducing repair-path duplication in `functions/index.js`
- centralizing packet readiness logic so UI and server never drift
- further separating source-sheet, queue, and canonical packet models in both code and naming
- adding tests around release, partial-release repair, stitched-tape readiness, comments-only mode, and grade-rule edge cases

