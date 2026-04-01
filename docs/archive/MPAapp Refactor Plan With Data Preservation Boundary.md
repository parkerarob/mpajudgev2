# MPAapp Refactor Plan

## Status

Phase 1 of this plan is now implemented on `main` and deployed to production.

Completed outcomes:
- capture-first judge workflow with required caption scoring
- admin `Live Submissions` review and officialization workflow
- canonical `officialAssessments` results path
- director ensemble-first workspace shell
- admin Phase 1 workspace shell

What remains from this plan is follow-on cleanup and future-phase work, not the initial baseline.

## Product Direction

This refactor moves MPAapp toward a clearer operating model:

- **Director side** is for submission, preparation, and event/site information.
- **Judge side** is for low-friction capture.
- **Admin side** is for oversight, correction, officialization, and release.

The goal is not a rewrite. The goal is to reduce live-event risk while improving the workflow for the people who actually use the system under pressure.

## Platform Decision Note

Current decision: keep Firebase for this refactor.

Reason:

- the highest current risk is product and codebase structure, not Firebase itself
- protected director/school/event-entry data should not be exposed to extra migration risk
- the immediate goal is to stabilize director, judge, and admin workflows inside the current stack

Revisit later if:

- admin operations outgrow Firestore document/query ergonomics
- release/reporting/audit needs become strongly relational
- the frontend is ready for a larger framework shift

Future migration candidate:

- React + TypeScript frontend
- Postgres-backed operational core
- object storage for audio

Default stance until then:

- refactor architecture first
- replatform only after the product model is proven

---

# 1. Hard Data Boundary

## Protected Data

The following current data is operationally sacred and must be preserved exactly:

- `schools`
- `schools/{schoolId}/ensembles`
- director user records and school attachment
- `events/{eventId}/entries/{ensembleId}`
- current saved director-entry values, including:
  - pizza/lunch orders
  - repertoire/music selections
  - instrumentation
  - seating
  - percussion/equipment needs
  - notes and day-of data

## Non-Negotiable Rules

No refactor phase may:

- delete protected records
- rename protected fields
- move protected records to new collections
- change protected document IDs
- overwrite unrelated saved values
- require backfill or migration of existing director-entered data

## Allowed Changes

New work may:

- add new collections for adjudication/admin architecture
- add additive admin-only metadata to existing entry docs when needed
- build new UI/read models on top of protected records
- mirror data for compatibility, but never replace the protected records as the source of truth

## Disposable Data

Current judge submission/test artifacts are disposable and do not need migration protection.

This includes current test-era:

- `submissions`
- `packets`
- judge recordings/transcripts/caption payloads
- intermediate draft/session artifacts

---

# 2. Director Portal Incremental Refactor

## Summary

Refactor the director portal into an **ensemble-first workspace** without changing Firestore document shapes, field names, or saved values.

Reuse the existing `events/{eventId}/entries/{ensembleId}` record as the canonical writable form payload. Derive dashboard and readiness views from current entry, schedule, packet, and event data.

## Product Goal

A director should be able to:

- enter everything the event needs
- clearly see what is incomplete
- access event and site information without hunting through email
- move between ensembles cleanly
- view packets/results in the same workspace

## Core Decisions

- Keep the current persisted entry model.
- Do **not** introduce new collections, document moves, field renames, or backfill.
- Treat readiness labels as **derived UI state only**, not new persisted workflow state.
- Keep event information and site information read-only and admin-managed.
- Keep packets/results read-focused and attached to the same director workspace.

## Delivered Director IA

- Dashboard
- Registration
- My Ensembles
- Ensemble Workspace
- Event Info
- Official Results Packet

## Ensemble Workspace Sections

Use sections that map only to existing saved data:

- Registration
- Repertoire
- Instrumentation
- Seating
- Percussion / Equipment
- Lunch / Day-of Notes

## Implementation Changes

- Replace the current landing/registration/registered/dayOfForms split with a stable workspace shell.
- Keep `selectedEventId` and `selectedEnsembleId` as primary navigation state.
- Expand the current ensemble list into the main work queue:
  - ensemble name
  - derived readiness
  - next missing requirement
  - quick actions
- Reuse the current readiness logic for derived status presentation.
- Preserve all existing save paths in `director.js` and `ui-director-registration.js`.

## Derived UI Statuses

These are UI-only labels:

- Not Started
- In Progress
- Ready to Submit
- Submitted / Ready
- Results Available

Do **not** add richer admin workflow states here in Phase 1.

## Test Plan

- Director with one school and one ensemble can still:
  - attach school
  - create/select ensemble
  - save registration
  - save form sections
  - mark ready
  - reopen saved data unchanged
- Director with multiple ensembles can switch without losing unsaved warnings or loading the wrong entry.
- Existing saved entries render correctly with no migration.
- Event/site information remains read-only.
- Packets/results visibility remains unchanged.
- Current security tests continue to pass.

## Assumptions

- No Firestore schema changes for the director refactor.
- Existing saved values are authoritative.
- New readiness labels are presentation only.
- Event Info and Site Info use current admin/event content, even if partial.

---

# 3. Capture-First Adjudication Redesign

## Summary

Shift adjudication to a two-stage architecture:

1. judges create a raw capture artifact
2. admin reviews and creates the official assessment

This is a staged redesign, but current judge-era test data does not need long-term preservation.

## Product Goal

A judge should always be able to produce a usable assessment artifact during a live event.

Admin should then be able to:

- find every submission
- correct association
- officialize the right record
- control what is released

## Judge Responsibility Boundary

The judge is responsible for:

- making a recording
- providing caption comments
- assigning caption scores
- producing the judge's overall rating through caption scoring

The judge is **not** responsible for:

- packet completeness
- ensemble final event rating
- release readiness
- metadata repair
- officialization
- adjudication workflow state
- admin correction tasks

## LLM Boundary

The LLM may help, but must never interfere with capture.

Allowed:

- optional transcript help
- optional caption-draft assistance
- optional summarization after capture
- optional admin-side extraction assistance

Not allowed:

- blocking save/submit because AI is incomplete
- requiring transcript success before submit
- changing judge meaning without explicit confirmation
- making release depend on LLM completion
- adding AI-driven workflow burdens to the judge
- treating AI-generated caption language as a substitute for required human review

## Core Decisions

- Replace the current test-era judge pipeline with a simpler raw-capture model.
- Use a new canonical raw object for live judge capture.
- `officialAssessments` becomes the canonical approved record for release.
- Admin is the only actor who can:
  - officialize
  - exclude
  - reassign
  - prepare release-ready records

## Firestore Collections

### `rawAssessments/{rawAssessmentId}`

Canonical live judge capture object.

Suggested fields:

- `eventId`
- `schoolId`
- `ensembleId`
- `judgeUid`
- `judgeName`
- `judgeEmail`
- `judgePosition`
- `formType`
- `audioUrl`
- `audioPath`
- `audioDurationSec`
- `writtenComments`
- `transcript`
- `transcriptStatus`
- `submittedAt`
- `status`
- `associationState`
- `reviewState`
- `officialAssessmentId`
- `createdAt`
- `updatedAt`

Suggested statuses:

- `draft`
- `submitted`
- `review_needed`
- `officialized`
- `excluded`

Suggested association states:

- `attached`
- `unattached`
- `uncertain`

### `officialAssessments/{eventId}_{ensembleId}_{judgePosition}`

Canonical approved record for release.

Suggested fields:

- `eventId`
- `schoolId`
- `ensembleId`
- `judgePosition`
- `formType`
- `sourceRawAssessmentId`
- `judgeUid`
- `judgeName`
- `judgeEmail`
- `audioUrl`
- `audioPath`
- `audioDurationSec`
- `writtenComments`
- `transcript`
- `status`
- `releaseEligible`
- `releasedAt`
- `reviewedAt`
- `reviewedByUid`
- `reviewedByName`
- `createdAt`
- `updatedAt`

### `officialAssessments/{id}/history/{historyId}`

Audit trail for:

- reassignment
- re-officialization
- exclusion
- release changes

## Callable / Server Interfaces

### `createRawAssessment`
New callable.

Behavior:

- create draft raw assessment
- require only judge auth and basic live-capture inputs

### `submitRawAssessment`
New callable.

Behavior:

- validate ownership and basic payload integrity
- require recording, caption comments, and caption scores
- save successfully even if transcript/LLM help is incomplete
- mark raw assessment submitted
- never create official release output directly

### `officializeRawAssessment`
New callable.

Inputs:

- `rawAssessmentId`
- `eventId`
- `ensembleId`
- `judgePosition`
- `formType`

Behavior:

- create/update `officialAssessments/{eventId}_{ensembleId}_{judgePosition}`
- stamp review metadata
- link the source raw assessment

### `excludeRawAssessment`
New callable.

Inputs:

- `rawAssessmentId`
- `reason`

Behavior:

- mark raw assessment excluded
- never delete the underlying capture artifact automatically

### `reassignRawAssessment`
New callable.

Inputs:

- `rawAssessmentId`
- `eventId`
- `ensembleId`
- `judgePosition`
- `formType`

Behavior:

- update target metadata
- set association state appropriately

## Judge UX Changes

### Judge Home

- Start New Assessment
- Resume In Progress
- Recent Submissions

### Judge Flow

- create or resume assessment
- record/upload audio
- complete caption comments and caption scores
- submit for admin review
- show clear confirmation: **Saved for admin review**

### Judge Constraints

Judge UI should **not** show:

- packet completeness
- release state
- official event status
- admin repair controls
- AI dependency messaging that blocks core capture

## Admin Review Flow

Admin needs an incoming-submissions workflow:

- queue built from submitted/review-needed raw assessments
- detail view with audio, caption comments/scores, transcript if available, and target association
- actions:
  - reassign
  - officialize
  - mark review needed
  - exclude

## Migration and Compatibility

- No migration protection is required for current judge test data.
- Legacy judge test flows may be hidden, replaced, or removed after the new path is stable.
- Existing released director-facing outputs remain valid.
- New live-event judging should use the new raw-assessment path only.

## Test Plan

- Judge can submit a recording plus required caption comments/scores even if transcript help fails.
- Judge submit does not depend on LLM completion.
- Admin can find every submitted raw assessment.
- Admin can reassign and officialize quickly.
- Excluded raw assessments remain visible to admin.
- Directors cannot read raw judge capture records.

## Assumptions

- Current judge submission data is test data and can be discarded.
- The simplest reliable judge flow is recording plus required caption comments/scores, with transcript help optional.
- AI is assistive only and must degrade gracefully.

---

# 4. Admin Phase 1 Plan

## Summary

Build the first admin expansion around the protected director data and the new judge raw-capture path.

Phase 1 adds the admin surfaces that most directly reduce live-event risk:

- Dashboard
- Registrations
- Live Submissions

Additional retained/admin-controlled workspaces:

- Packets & Results
- Schedule & Flow
- Settings

## Product Goal

Give event staff a real control layer for live operations without trying to build the entire site-host / volunteer / hospitality system in the first release.

## Core Decisions

- Phase 1 incrementally remaps the current admin shell rather than fully rewriting it.
- Phase 1 workspaces are:
  - Dashboard
  - Registrations
  - Live Submissions
  - Packets & Results
  - Schedule & Flow
  - Settings
- Existing `admin` remains the practical compatibility umbrella during rollout.
- Build Live Submissions from `rawAssessments`.
- Build Registrations from existing event entries and readiness-derived state.
- Build Dashboard as an aggregated read model from current collections plus raw-assessment review state.
- Keep Schedule & Flow lightweight in Phase 1.

## Phase 1 Roles

Use additive role flags on user profiles.

Canonical auth model:
- `roles` map is primary
- legacy `role` is fallback only during transition

Phase 1 roles:

- `admin`
- `superAdmin`
- `eventChair`
- `registrationLead`
- `judgeCoordinator`
- `announcerFlow`

Do **not** introduce `siteHost`, `volunteerCoordinator`, or `hospitalityLead` yet.

## Authorization Rules

- `admin` or `superAdmin` = access to all Phase 1 workspaces
- `eventChair` = dashboard, registrations, live submissions, packets/results, schedule/flow
- `registrationLead` = dashboard subset, registrations, limited schedule/flow read
- `judgeCoordinator` = dashboard subset, live submissions, limited schedule/flow read
- `announcerFlow` = schedule/flow read + limited status update only

## Firestore Object Changes

### Existing event entry records

Add only minimum admin metadata you know you will actively use in Phase 1.

Recommended candidates:

- `paymentState`
- `approvalState`
- `checkInState`
- `adminIssueFlag`
- `adminNotes`

These are additive admin-only fields.
All current director-entered values remain untouched.

## Workspace Specs

### Dashboard

Purpose:
one-screen event awareness and action entry point

Widgets:

- incomplete registrations
- payment/form issues
- incoming submissions needing review
- unattached submissions
- current live ensemble status
- packets not ready for release
- active alerts

Requirements:

- every widget links to a filtered workspace view
- dashboard emphasizes active problems, not passive reporting

### Registrations

Purpose:
manage ensembles, director data, readiness, and day-of registration issues

Core list columns:

- school
- director
- ensemble
- registration status
- payment status
- forms status
- repertoire status
- equipment request
- approval state
- check-in state
- flags

Filters:

- missing payment
- missing forms
- needs review
- equipment request present
- not approved
- checked in
- issue flagged

Actions:

- approve registration
- flag issue
- add note
- mark payment received
- mark check-in state
- escalate issue

### Live Submissions

Purpose:
admin repair queue for incoming judge artifacts

Queue columns:

- judge
- submitted time
- tentative ensemble
- target event / position
- audio present
- caption completion present
- transcript status
- association state
- review state

Actions:

- open detail
- reassign
- officialize
- mark review needed
- exclude

Detail view:

- audio player
- caption comments and scores
- transcript if available
- current target slot
- ensemble chooser
- form type chooser
- audit notes

### Packets & Results

Purpose:
release authority surface

Phase 1 behavior:

- use `officialAssessments` as the source of approved adjudication
- keep director-facing release controlled and coherent
- do not use raw assessments directly as release items

### Schedule & Flow

Purpose:
lightweight operational flow view

Phase 1 scope:

- reuse current live-event / announcer foundations
- show running order and basic live state
- avoid turning this into full room/site ops yet

### Settings

Purpose:
event/admin configuration and non-live controls

## Implementation Priorities

### Phase 1A
- lock the protected-data boundary into the implementation plan
- director portal refactor over current entry data only

### Phase 1B
- build new judge raw-capture flow
- make AI assistance optional and non-blocking

### Phase 1C
- build Live Submissions queue
- build officialize / exclude / reassign callables

### Phase 1D
- build Dashboard and Registrations
- add lightweight role flags and role-aware nav

### Phase 1E
- connect Packets & Results to `officialAssessments`
- clean up legacy judge test flows
- regression hardening

## Test Plan

- Existing schools, ensembles, directors, and entries render unchanged.
- Existing pizza orders, repertoire, instrumentation, seating, and equipment values remain intact.
- No director save drops unrelated fields.
- Judge can submit recording + required caption comments/scores without LLM dependency.
- Admin can find every submitted raw assessment.
- Admin can reassign and officialize in under one minute.
- Role flags correctly limit view access.
- Director-facing release remains coherent and separate from raw capture.

## Non-Negotiables

- Protected school/director/event-entry data must not be lost or reshaped.
- Judge flow must remain simple: recording, caption comments, and caption scores.
- AI may help but must never interfere with capture.
- Admin must be able to find, repair, and officialize submissions.
- Director-facing release must remain controlled and coherent.

## Deferred Work After Phase 1

These are valid next steps, but not part of the first implementation wave:

- Site Host workspace
- Volunteer workspace
- Hospitality workspace
- richer check-in / live flow state machine
- full room/equipment/signage operations
- archive/clone improvements

## Final Recommendation

Treat this as one coordinated product move:

- ensemble-first director workflow
- capture-first judge workflow
- admin-controlled officialization

That is the cleanest path to making the app safer on event day without risking the current school-side data.
