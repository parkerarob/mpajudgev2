# MPA Judge – Product Requirements Document (PRD)

## 1. Purpose

MPA Judge is a Firebase-hosted adjudication web app that keeps *all* MPA event materials in one place: judge audio, transcription, caption feedback, ratings, and director-facing results. It replaces the current multi-step workflow (standalone voice recorders → manual upload → separate sharing of audio and paper sheets) with a single judge-facing interface and an admin-controlled release pipeline.

Core judge-centric promise: judges can focus on *talking* and listening during the performance. The system captures full-session audio, generates a transcript, drafts rubric-aligned captions from that transcript, and lets judges quickly edit/confirm those captions instead of writing full comments by hand.

Secondary promise: directors provide required ensemble-day information in advance (school + director identity, instrumentation, seating, repertoire, special requests). The system ports only the pertinent details into the judge sheet automatically, so judges start with accurate context and consistent formatting.

Admin is the intermediary and orchestrator: sets up the event, connects schools/ensembles to schedule slots and judge assignments, monitors submissions, and controls when results are released to directors.

## 2. Problem Statement

Current MPA workflows often rely on paper forms and/or separate recording devices. This creates friction (manual data entry, lost audio, inconsistent feedback) and delays (directors receiving results later). MPA Judge should unify recording, feedback entry, and submission into a single web-based system.

## 3. Goals and Non-Goals

### 3.1 Goals

1. Judges can complete a full adjudication session end-to-end on a single device.
2. Audio recording is reliable for long sessions (15–45 minutes).
3. Transcription and AI-assisted captioning reduce judge typing burden without compromising judge control.
4. Directors can view results (audio + transcript + captions + rating) quickly after submission.
5. Admins can set up events (schools, ensembles, schedules, judge assignments) with minimal friction.
6. Data access is secure and role-based.

### 3.2 Non-Goals (for initial release)

* Full offline-first operation (optional future).
* Automated scoring/rating decisions (AI may assist text, not decide ratings).
* Full repertoire compliance enforcement (4-year rule, etc.) beyond basic data capture.

## 4. Users and Roles

### 4.1 Roles

* Judge: conducts adjudication using a single screen; records audio; relies on transcription and AI-drafted captions; edits/approves captions; assigns final rating; submits.
* Director: maintains school/ensemble information required for the event day; reviews released submissions (audio + feedback + rating) for their school.
* Admin: event owner/intermediary; creates and manages schools, ensembles, judge accounts, director accounts; builds schedule; assigns judges; monitors that submissions came through; releases results.

### 4.2 Role Permissions (Plain-English)

Judge

* Can view assigned schedule slots (or select from permitted ensembles if free-select mode is chosen).
* Can record and submit for their assigned ensembles.
* Can view/edit only their own in-progress judge sheets and submitted sheets they authored (unless admin grants broader review).

Director

* Can view and edit their own school/ensemble profile information.
* Can view submissions for their school after admin releases them.

Admin

* Full control: create schools; create director accounts; create judge accounts; assign roles; build schedules; assign judges; edit event metadata; monitor submission health; release or withhold results.

### 4.3 Primary User Journeys

1. Judge workflow (intended): login → open assigned slot/ensemble → judge sheet auto-populated with ensemble context → start recording → speak comments naturally → stop recording → transcription completes → AI drafts captions → judge edits/approves + sets rating → submit → confirmation → advance to next slot.
2. Director workflow: login → complete/maintain ensemble profile before event → after performance, open results list → open a released submission → play audio + read feedback.
3. Admin workflow: create event → create/import schools → create accounts/roles (judges/directors) → build schedule + assignments → monitor live submissions → quality-check and release to directors.

## 5. Scope: Features and Requirements

### 5.1 Event Admin (Single Source of Truth)

Problem addressed: eliminate scattered artifacts (voice recorders, uploads, separate shares).

Requirements:

* Admin can configure event(s) and ensure all event-day data lives inside the system.
* Admin can monitor whether judge submissions are arriving correctly.
* Admin controls result release to directors (manual release only).

Acceptance:

* A complete event can be run without external audio recorders, manual uploads, or paper sheet distribution.

### 5.2 Authentication and Authorization

Requirements:

* Email/password auth.
* User doc: users/{uid} with role.
* **Admin/chair can create judge accounts** by entering judge profile fields (name, email, optional title/affiliation) and setting role=judge.
* **Event judge assignment**: for the active event, admin assigns existing judge users to fixed positions:

  * Stage Judge 1
  * Stage Judge 2
  * Stage Judge 3
  * Sight-Reading Judge

Acceptance:

* Judges, directors, and admins see only the UI and data they are permitted to see.
* A judge’s live form type/position is determined by their assignment for the active event.

### 5.3 School and Director Identity

Requirements:

* Admin can create schools.
* Directors are tied to a school.

Acceptance:

* Director identity and school association are unambiguous in the system.

### 5.4 Ensemble Profile (Director Dashboard)

Purpose: capture required information *before* event day and reuse it.

Requirements:

* Director can create/edit multiple ensembles per school.
* Ensemble profile fields:

  * instrumentation counts (standard winds), total percussion, non-standard, other instrumentation free text
  * seating (rows 1–6: chairs, stands)
  * current rep: march + piece 1 + piece 2 (title + composer/arranger)
  * special requests
  * percussion instruments available list
  * policy/rules compliance fields as needed (see 5.11)

Acceptance:

* Director can complete all required pre-event data entry without spreadsheets or separate forms.

### 5.5 Schedule and Assignment (Admin → Judge Context)

Purpose: provide an “expected order” while preserving day-of flexibility.

Decision: **Free-select with schedule assist**.

Requirements:

* Admin can build a schedule of slots (time + room) tied to school + ensemble.
* Judges can see the schedule context (e.g., “Up next”, “Current block”) but are not forced to follow it.
* Judge can select any ensemble/slot at any time.
* Judges and admins can correct a submission’s association (slot/ensemble) if mis-selected.
* Auditability: store both the *selected* slot/ensemble and optionally the *scheduled* slot at the time, if they differ.

Acceptance:

* If the schedule changes in real time (late arrival, swap order), the judge can immediately select the correct ensemble and proceed without admin reconfiguration.

### 5.6 Judge Sheet (Capture + Edit)

#### 5.6.1 What auto-populates at the top of the judge sheet (pertinent info)

From director + event admin data, the judge sheet should auto-fill only the information judges typically need *in the moment*:

* School name
* Ensemble name
* Event header information:

  * Event name (e.g., MPA)
  * Day/date (or event day label)
  * District/region (e.g., Eastern District)
  * Optional: site/venue and room
* Repertoire information:

  * Pieces being performed and order
  * Grade/difficulty level for each selection (where applicable)
* Instrumentation snapshot:

  * The instrumentation counts (e.g., number of each instrument family/instrument)
  * Optional: total percussion and other/non-standard notes if provided

Optional supporting artifact:

* **Access sheet PDF** (or equivalent) can be viewable/linked from the judge sheet for reference, but is not required for submission.

Non-goal for judge sheet header:

* Seating charts, extensive director-only notes, or administrative compliance details should not clutter the judge’s judging interface unless explicitly requested.

#### 5.6.2 Judge-entered content

Requirements:

* Judge enters/edits narrative captions by rubric category.
* Each caption includes:

  * comment text
  * **caption grade**: A, B, C, D, F with optional +/- (no +/- for F)
* The system computes the judge’s **judge rating (1–5)** automatically from the set of caption grades (see 5.12.1).

Acceptance:

* Judge can complete the sheet with minimal typing and clear validation.
* The computed judge rating updates live as caption grades change.

### 5.7 Recording and Transcription (Judge-Centric)

Intended workflow: judges talk more; the system transcribes after the fact.

Requirements:

* Full-session recording (single playable file).
* Chunked recording for transcription.
* Transcript assembly that is ordered, resilient, and finalizes after stop.
* UI indicates recording state and transcription progress.

Acceptance:

* 15–45 minute sessions reliably produce playable audio and a near-complete transcript.

### 5.8 AI-Assisted Caption Drafting

Requirements:

* After transcript exists, system can draft captions aligned to rubric categories.
* Caption drafting must use the *correct caption schema for the current form*:

  * Stage: Intonation, Precision, Balance/Blend, Basic Musicianship, Interpretive Musicianship, Tone Quality, General Factors
  * Sight-Reading: Intonation, Balance, Technique, Rhythm, Musicianship, Tone Quality, Utilization of Preparatory Time
* Judge can edit/override all drafts.

Prompting/training requirements:

* Because the sight-reading form does not include a long back-page rubric, the AI prompts should embed short definitions/keywords for each sight-reading caption (derived from the caption label text on the form) and reuse any shared vocabulary from the stage rubric where applicable.

Acceptance:

* AI reduces typing but does not remove judge agency.

### 5.9 Submission, Admin Review, and Director Release

Purpose: a controlled pipeline from judge → admin/chair → director, while preserving judges’ own records for review and professional development.

Decisions:

* **Director access is gated by admin/chair release.**
* **Release is 100% manual.** No auto-release timers or time-based release logic.
* **Release is packet-level and only when complete.** Directors receive one packet per ensemble per event.

Rationale:

* Ensures quality control before directors see results.
* Prevents partial information release.
* Allows judge/admin corrections without accidental disclosure.

Packet definition and completeness:

* A director packet consists of submissions from:

  * Stage Judge 1
  * Stage Judge 2
  * Stage Judge 3
  * Sight-Reading Judge (Grades II–VI only)
* **Grade I exception:** Grade I ensembles do not sight-read; packet completeness is satisfied with the three stage submissions and an explicit “No sight-reading (Grade I)” confirmation.

Requirements (Submission lifecycle):

* Judges submit individual forms; each form creates/updates one submission with status **submitted**.
* Admin/chair releases at the **packet level** (not per individual submission).
* Directors can only view packets with status **released**.

Required fields on each submission:

* status: submitted | released (released is set when its packet is released)
* releasedAt (timestamp, set only on packet release)
* releasedBy (admin uid)
* judgeId (uid)
* eventId
* schoolId, ensembleId
* judgePosition: stage1 | stage2 | stage3 | sight
* formType: stage | sight
* audioUrl
* transcript
* captions (text + letter grade)
* captionScoreTotal (numeric total from Appendix A)
* computedFinalRatingJudge (1–5) + label (I–V)
* lastEditedAt, lastEditedBy
* unlockedAt, unlockedBy (if unlocked)

Packet-level fields (recommended):

* packetStatus: pending | ready | released
* gradeLevel (I–VI)
* noSightReadingConfirmed (boolean, Grade I only)
* computedOverallRating (I–V) + labels

Corrections and control:

* Submitted sheets are locked; admin/chair must unlock to allow edits.
* When unlocked, both chair/admin and the original judge can edit.
* Track lastEditedAt/lastEditedBy and unlockedAt/unlockedBy.
* Admin can correct ensemble association if mis-selected.

Acceptance:

* No director can access any materials until the packet is released.
* A packet cannot be released unless complete (3 stage + sight for Grades II–VI; 3 stage + Grade I no-sight confirmation for Grade I).
* All release actions are attributable to a specific admin user.

#### 5.9.1 Chair/Admin Verification Panel (pre-release)

Goal: make chair review fast, consistent, and aligned to adjudication procedures.

UI requirements:

* A “Release Queue” view sorted by newest submissions (filterable by room/judge/school).
* Clicking a submission opens a **Verification Panel** with:

  * header (school, ensemble, judge, room/time if available)
  * audio playback control + recorded duration
  * transcript present indicator
  * caption completion summary
  * **captionScoreTotal + computedFinalRatingJudge** (computed from Appendix A)
  * **packet completeness summary** (see 5.9.2)
  * overall rating preview (computed when packet is complete)
  * release controls (packet-level)

Verification checklist (recommended defaults; configurable per event):

1. Association check

   * Correct school + ensemble selected
   * Correct event/slot/room (if used)
2. Audio check

   * Audio file attached and playable
   * Duration is plausible (not obviously truncated)
3. Caption completeness

   * All required captions have a letter grade
   * Comments present (not empty). Optional rule: prevent “see tape” as the only text.
4. Caption scoring integrity (Appendix A)

   * Display per-caption numeric scores (A=1…F=5)
   * Display captionScoreTotal
   * Display computedFinalRatingJudge (1–5 / I–V)
   * Highlight any mismatch between entered “final rating” (if shown) and computed (system should compute to avoid mismatch)
5. Professionalism / compliance flags (lightweight)

   * Optional: profanity/PII warning flag
   * Optional: disqualification/admin notes marker (not shown to directors unless desired)

Chair actions:

* **Release** (manual; single submission)
* **Release batch** (selected submissions)
* **Hold** (keeps submitted; adds optional internal note)
* **Return to judge** (creates a task/note; does not auto-notify unless you implement notifications)
* **Admin correction** (change association; edit metadata; add chair note)

Audit requirements:

* Any chair/admin action is logged with who/when/what.
* Release action writes releasedAt and releasedBy.

Acceptance:

* Chair can validate and release a typical submission in under 30 seconds.
* Common failure modes (wrong ensemble, missing grades, truncated audio) are obvious before release.

Admin/chair dashboard requirements:

* **Event Overview Table (Phase 1 desired UX):** on the event dashboard, show the schedule rows with live status indicators:

  * School + ensemble
  * scheduled time/room (if used)
  * Stage1 submitted? + Stage1 rating (1–5 / I–V)
  * Stage2 submitted? + Stage2 rating
  * Stage3 submitted? + Stage3 rating
  * Sight submitted? + Sight rating (or “N/A – Grade I”)
  * Packet ready? (all required submissions present)
  * Packet released? (released status)
  * Overall rating (computed when ready)
  * Quick actions: open packet, release (when ready), unrelease (admin only)

* Review queue of recently submitted sheets (optional if overview table is sufficient).

* Packet view for detailed verification when needed.

Actions:

* Release (single or batch)
* Return to judge / hold (procedural)
* Correct association (school/ensemble/slot)

Acceptance:

* No director can access an unreleased submission.
* There is no system feature to auto-release based on time.
* All release actions are attributable to a specific admin user.

### 5.10 Security and Data Access

Requirements:

* Firestore/Storage rules enforce:

  * directors: only their own school/ensembles + released submissions for their school
  * judges: only assigned-permitted scope and their authored submissions
  * admins: full access

Acceptance:

* No cross-school data leakage; admin is the only role with broad visibility.

### 5.11 Policy/Rules Support (Director/Admin)

Purpose: store and surface policy-relevant data needed for compliance and event operations. This section captures requirements derived from NCBAED district procedures and referenced state policies.

Requirements:

* Store district identity and policy references at the event level (e.g., “NCBA Eastern District”).
* Store repertoire selections with grade level classification per selection.
* Store “comments only” participation flag and sight-reading participation flag.
* Store duplicate personnel counts and enforce/display the “max 5 duplicates per instrument across ensembles” constraint (state policy reference 2025–26 as provided).
* Track whether the ensemble is eligible for sight-reading requirement (Grades II–VI required; Grade I does not sight-read).
* Provide admin-facing reminders/flags for common disqualification triggers (e.g., non-list literature, amplification restrictions), without forcing automation where the data is not available.

Acceptance:

* The system can display relevant policy flags and reduce day-of errors without over-automating.

### 5.12 Scoring and Ratings (NCBA Concert Band MPA)

Purpose: align the app with the actual adjudication workflow and prevent arithmetic/aggregation errors at both levels:

1. caption grades → per-judge rating (1–5)
2. per-judge ratings (stage + sight-reading) → overall rating (I–V)

#### 5.12.1 Caption grades → Judge rating (1–5)

Workflow requirement:

* Each judge assigns a letter grade to each rubric caption: **A, B, C, D, F**, with optional plus/minus.
* The judge’s **single Final Rating** on that form is a numeric rating **1–5** (equivalent to Roman I–V terminology), derived from the caption grades using **Appendix A** rules.

Appendix A scoring (official method):

* Convert each caption grade to a numeric score (lower is better):

  * A → 1
  * B → 2
  * C → 3
  * D → 4
  * F → 5
* **Plus/minus does not change the numeric score** (e.g., B+ still counts as 2; A- still counts as 1).
* Sum the numeric scores across all captions on the form.

Stage form caption count:

* Stage uses **7 captions** (as on the stage sheet). Therefore totals range from **7** (all A) to **35** (all F).

Final Rating mapping (7 captions):

* Superior (I) = total **7–10**
* Excellent (II) = total **11–17**
* Average (III) = total **18–24**
* Below Average (IV) = total **25–31**
* Poor (V) = total **32–35**

Validation requirements:

* Final Rating (1–5 / I–V) must be computed by the system from caption grades.
* Submission must be blocked if any required caption grade is missing.
* Chair/admin review step: admin UI should surface the caption total and computed Final Rating for quick verification.

Data requirements:

* Store:

  * per-caption letter grade (including +/- as entered)
  * per-caption numeric score (derived)
  * caption score total
  * computed Final Rating (1–5) and its Roman/label equivalent (I–V)

#### 5.12.2 Per-judge ratings → Overall rating (Grades II–VI)

Inputs:

* Stage judge ratings: three numbers (each 1–5), derived from caption grades on the Stage form.
* Sight-reading rating: one number (1–5), derived from caption grades on the Sight-Reading form.

Sight-Reading caption set (7 categories):

* Intonation
* Balance
* Technique
* Rhythm
* Musicianship
* Tone Quality
* Utilization of Preparatory Time

Computation:

* Base rule: sum the four ratings.

  * Rating I: totals 4–6
  * Rating II: totals 7–10
  * Rating III: totals 11–14
  * Rating IV: totals 15–18
  * Rating V: totals 19–20

Unanimous stage rule:

* If the three stage ratings are all 3s, all 4s, or all 5s, then the ensemble receives that rating overall regardless of the sight-reading rating.

Validation requirements:

* Overall rating (I–V) must be computed by the system from the four ratings.
* The unanimous stage override must be applied automatically.

#### 5.12.3 Grade I overall rating logic

Inputs:

* Stage judge ratings: three numbers (1–5), derived from caption grades.

Computation:

* Use the Grade I chart mapping of three ratings to overall (as provided).

Validation requirements:

* Overall rating must be computed or strictly validated from the three inputs.

#### 5.12.4 Labels

* I = Superior
* II = Excellent
* III = Average
* IV = Below Average
* V = Poor

Acceptance:

* The system prevents submission/release where a judge rating or overall rating is inconsistent with the underlying caption grades.
* Judges and admins can review both the narrative feedback and the computed ratings with full traceability.

## 6. UX Requirements

Judge experience:

* Clear record state + timer.
* Progress indicators: “Recording”, “Transcribing (n remaining)”, “Ready to submit”.
* Autosave draft captions locally.
* Post-submit confirmation + reset to next slot.

Director experience:

* Simple ensemble select + edit.
* Submission list filtered to current event + school.
* Submission detail view: audio player, transcript, captions.

Admin experience:

* Minimal-click event setup.
* Bulk import schools/ensembles (future if needed).
* Schedule grid view.
* Submission monitoring dashboard.

## 7. Technical Architecture

Frontend:

* Static HTML/CSS/JS (no build step).
* Firebase Auth + Firestore + Storage.

Backend:

* Firebase Cloud Functions:

  * transcribeChunk (multipart audio → OpenAI transcription)
  * parseTranscript (transcript → structured captions)

## 8. Metrics of Success

* 95%+ sessions complete without transcription pipeline stalls.
* Median time from stop → submit under 60 seconds for typical sessions.
* Director can access results within 1 minute of submission.
* No cross-school data leakage (security).

## 9. Risks and Mitigations

* Browser recording quirks (Safari): maintain MIME fallbacks, document supported browsers.
* Long-session stability: queue backpressure + retries + finalization.
* Network dependence: optional “record-only then upload” fallback mode.

## 10. Open Questions (to finalize before more build)

1. Judge workflow mode: **Free-select with schedule assist** (chosen)
2. What rubric categories are final (exact keys and label text)?
3. Rating scale (I/II/III/IV/V? Excellent/Good/etc.) and required fields.
4. Director visibility: what is shown on released sheets (audio, captions, rating, transcript visibility policy).
5. How should multi-judge rooms be handled (separate submissions vs combined view)?
6. Data retention policy (how long to keep audio/transcripts).
7. Release timing defaults per event (chosen conceptually: 1–2 ensembles behind or ~30 minutes; confirm event-level configuration).

## 11. Phased Delivery Plan

Phase 1 – Event-ready MVP:

* Free-select with schedule assist
* Robust long recording + transcription
* Director packet view (all judges)
* Chair/admin verification + manual packet release/unrelease
* Judge archive (submitted only)
* Security rules locked down
* **Test mode / Test ensemble (no Firestore writes)**

Phase 2 – Admin power tools:

* Bulk imports, richer schedule tooling
* Reporting/overview enhancements

Phase 3 – Quality-of-life:

* Optional safeguards (school join code)
* Notifications
* Additional analytics and exports

## 12. Test Mode (Judge Training)

Purpose: allow judges to practice the workflow without risking real event data.

Requirements:

* Provide a dedicated **Test Ensemble** option visible to judges.
* Test mode mimics the full workflow (record → transcript → AI captions → edit) but **does not write to Firestore** and does not create submissions.
* Audio and transcript may exist only locally during the session; optionally allow a “download audio” later (future) but do not store server-side.
* A prominent **Clear Test** action resets the form and deletes any local autosave for test data.

Acceptance:

* Judges can practice safely and then switch to real ensembles with a clean state.
