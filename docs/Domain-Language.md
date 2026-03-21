# MPA Domain Language Glossary

Status: DRAFT — Core Q&A complete (rounds 1-3). Ready for schema design.

Last updated: 2026-03-21

---

## Purpose

This document defines every domain term used in the MPA adjudication system. All code, database schemas, UI labels, documentation, and AI agent prompts must use these terms exactly as defined here. Ambiguous language was the #1 source of development confusion during the initial build. This glossary exists to prevent that from happening again.

Rules:

1. If a term is in this glossary, use it exactly as written. Do not invent synonyms.
2. If a concept is not in this glossary, add it before using it in code or conversation.
3. Terms that look similar but mean different things are explicitly distinguished below.
4. Where the domain uses a term differently than common English, the domain definition wins.

---

## Event Structure

### MPA (Music Performance Adjudication)

The formal evaluation process where school music ensembles perform for qualified judges and receive ratings and written feedback. Governed by NCBA rules.

Currently the system is being built for **Concert Band MPA** specifically. Future event types may include All-District Auditions or Solo/Ensemble MPA, but those are out of scope. The system should be aware that "Concert Band MPA" is a type of event, not the only type that will ever exist. MPA events are district-level only — there is no state-level MPA event.

### Event

A specific MPA event held at a specific site on a specific date (or dates). Example: "Eastern District MPA — South Site — March 2026." An event has a schedule, assignments, entries, and produces results.

**NOT:** a generic calendar item or notification. In this system, "event" always means an MPA adjudication event.

**Performance time limits (includes staging and performance):**

| Grade | Stage Time | Warmup Time |
|-------|-----------|-------------|
| I, II | 25 min | 25 min |
| III, IV | 30 min | 30 min |
| V | 35 min | 35 min |
| VI | 40 min | 40 min |

These time limits are important for scheduling — they determine how many ensembles can perform per day and the spacing between performance slots.

An event has two phases:
- **Before:** Setup, registration, scheduling, judge assignment. Some things lock once the event starts and cannot change.
- **During/After:** Live management, score sheet submission and verification, packet assembly and release. The Chair can make schedule adjustments and manage judge flows during the event. Packets are released as soon as they are verified and complete — there is no "wait until the end" convention.

### Site

The physical location where an event takes place. Usually a school, but not required to be one. A site hosts one event at a time. At statewide scale, multiple sites may run events concurrently.

A site has multiple rooms with specific purposes:
- **Stage** — The performance space where the adjudicated concert performance takes place. This is a stage in the theatrical sense (a music/theater performance space built to showcase a performance to an audience). A stage is a room, but a room is not a stage.
- **Sight-reading room** — Where sight-reading performances take place.
- **Holding room** — Where ensembles wait before their performance.
- **Warmup room** — Where ensembles warm up before going to the stage.
- **Other rooms** — Volunteer check-in, registration (director arrival check-in), food distribution, equipment storage, etc.

The system does not model or track rooms. Room flow is managed by humans. The system only models the schedule (what time each ensemble performs).

### District

A regional grouping within NCBA. There are 7 districts: Northwest, Western, South Central, Central, East Central, Southeast, Eastern. Each district runs its own MPA events independently.

### Organizational Hierarchy

```
NAfME (National Association for Music Education)
  └── NCMEA (North Carolina Music Educators Association)
        └── NCBA (North Carolina Bandmasters Association)
              ├── Northwest District
              ├── Western District
              ├── South Central District
              ├── Central District
              ├── East Central District
              ├── Southeast District
              └── Eastern District
```

NCBA does not have its own membership — it is formed from the collective Districts. NCBA is a governing body with leadership positions from each District. NCBA considers itself part of NCMEA as equals, not in a strict hierarchy. NCMEA allows access to NAfME support.

For the system, NCBA is the top-level organization. Future support for other state MEAs (e.g., TMEA — Texas) is possible but out of scope for the foreseeable future.

---

## People and Roles

### Chair (MPA Chair)

The person responsible for all aspects of the MPA event. Full title: "Concert Band MPA Chair" (or equivalent for the specific discipline). The Chair is the final decision maker for the event.

**Chair responsibilities include:**
- Pre-event: manage registration, schedule, judge assignments
- During event: review and verify score sheets, manage judge flows, make schedule adjustments, modify ensemble event form details
- Post-event: compile ratings, release packets to directors, track expenses and payments

**Critical design principle:** The Chair should not need technical knowledge to operate the system. A person with limited computer knowledge should feel absolutely comfortable using it. The software makes the Chair's job easier — it should never create new work for the Chair.

**The Chair is NOT the Admin.** During the pilot event, the developer (Parker) served as both Chair and Admin. This should not be considered the norm.

### Admin

The technical overseer of the software. Ensures the system is working and running properly. Can diagnose and fix technical problems with minimal impact to the event. This is a system-level role, not an event-operations role.

### Judge

A qualified adjudicator who evaluates ensemble performances. Judges are assigned to an event with a specific **judge position** and **form type**.

**Judge workflow (per ensemble):**

1. Login. Open a new draft score sheet.
2. Select the ensemble and view ensemble details.
3. Check microphone (optional, not forced).
4. Start recording (tape).
5. Stop recording.
6. Optionally use AI to draft caption comments from the transcript.
7. Write/edit caption comments for each caption.
8. Assign caption ratings (A–F for each of 7 captions).
9. Visually confirm the computed Final Judge Rating.
10. Submit the score sheet.
11. Open a new draft score sheet for the next ensemble.

The judge repeats this for every ensemble that performs during the event.

### Director

A school band director whose ensemble is performing at the event.

**Director workflow:**

Pre-event:
1. Register as a user in the system.
2. Attach to their school. (Must have an approval process to unattach — this needs design review.)
3. Create ensemble(s) at their school.
4. Register ensemble(s) for a specific event.
5. Fill out event entry information: repertoire selections, instrumentation, seating chart, percussion assignments, lunch orders, etc.

Event day:
6. Complete check-in at the site (volunteer verifies NAfME card, physical conductor scores).
7. Physically move ensemble through the event flow: Holding → Warmup → Stage Performance → Sight-Reading.

Post-event:
8. Review released results packets as they become available.

**Student teacher rule:** A student teacher who is a current NAfME Collegiate member may conduct one piece during a performance. Out of scope for system enforcement, but event information/rules should mention it.

Director results access is **indefinite**. Historical records of ensemble, grade, repertoire, and ratings/overall should be kept permanently. Audio/PDF storage may be limited if costs require it.

### Multiple Roles

A person can hold multiple roles. For example, a director at one school could serve as a judge at a different event. The system must support this — role is contextual, not fixed per person.

### Volunteer Roles

Volunteers are people who assist at the event. Some volunteer roles touch the software:

- **Check-in** — Handles ensemble arrival. Verifies required documents (NAfME membership card, 3 physical conductor scores with measures numbered). Can make limited edits on behalf of the director (e.g., adjust stage setup numbers if a student is out sick). The system confirms that document checks were completed.
- **Stage crew** — Has read access to schedule/flow information.
- **Announcer** — Has read access to ensemble information for announcements.

Volunteer roles will be reviewed after the core Chair, Judge, and Director workflows are established.

**Note:** The TeamLead/OpsLead role from the current system is an artifact and will not carry forward.

---

## Musical Entities

### School

An educational institution with a music program. A school has one or more **ensembles** and one or more **directors**. Schools are identified by name.

The Director-to-School relationship is **many-to-many**: multiple directors can be associated with one school, and one director can have ensembles at multiple schools.

### Ensemble

A specific performing group at a school. Examples: "Symphonic Band," "Concert Band," "Wind Ensemble." An ensemble performs at an event.

**Key distinction:** An ensemble is a persistent entity at a school. An **event entry** is that ensemble's participation in a specific event.

### Grade (Music Difficulty Classification)

The difficulty classification of the music an ensemble performs. **Grade always refers to music difficulty, never to assessment results.** Assessment results are called **ratings**.

**Grade I is the LOWEST difficulty. Grade VI is the HIGHEST difficulty.**

This is counterintuitive and is the single most common source of confusion. To remember: think of it as "Grade level" in school — a 6th grader is more advanced than a 1st grader.

A band's grade classification is **derived from its repertoire selections**, not declared. The grade is determined by which Graded Lists the ensemble's selections come from. A pre-event declaration may be made for scheduling purposes (to group similar difficulty levels together), but the official grade is determined by the actual pieces performed.

### Repertoire (Performance Program)

Every ensemble performs **3 pieces** at the event:

1. **March** — Does not come from a Graded List (any march is acceptable). Does not affect grade classification.
2. **Selection #1** — From a Graded List. Determines (or co-determines) the ensemble's grade.
3. **Selection #2** — From a Graded List (same or adjacent to Selection #1). **Optional if Selection #1 is a Masterwork.**

**Grade derivation rules:**
- If Selection #1 and Selection #2 are from the same Graded List → single grade (e.g., both Grade IV → Grade IV)
- If Selection #1 and Selection #2 are from adjacent Graded Lists → split grade (e.g., Grade III + Grade IV → Grade III/IV)
- Selections must be from adjacent lists — Grade I + Grade III is not valid
- If Selection #1 is a Masterwork (Grade VI), Selection #2 is optional. Both selections may be Masterwork.
- The March does not factor into grade classification

**All grade values (11 total):**

| Grade | Sight-Reading Required? | Notes |
|-------|------------------------|-------|
| I | No | Lowest difficulty. No sight-reading at this level. |
| I/II | No | Split grade. Would sight-read at Grade I level, but Grade I has no sight-reading, so I/II also does not sight-read. |
| II | Yes | |
| II/III | Yes | |
| III | Yes | |
| III/IV | Yes | |
| IV | Yes | |
| IV/V | Yes | |
| V | Yes | |
| V/VI | Yes | |
| VI | Yes | Highest difficulty. May include a Masterwork selection. |

### Split Grade

A grade classification where an ensemble performs pieces from two adjacent Graded Lists. Example: an ensemble performing one Grade III piece and one Grade IV piece is classified as Grade III/IV. Split grades are always adjacent — Grade I/III or Grade II/V are not valid.

For sight-reading, all split-grade ensembles sight-read at the lower of the two levels. Since Grade I has no sight-reading, Grade I/II also does not sight-read. **The system only needs to handle Grade I/II specially** — it is the only grade that changes the required number of score sheets (3 instead of 4) and omits sight-reading from the packet and Overall Rating calculation.

### Masterwork (MW)

A flag on a specific Grade VI piece, not on the ensemble. Masterwork pieces are considered substantive works of the literature. A Masterwork piece may be performed on its own or with another selection. Only Grade VI pieces can be designated as Masterwork.

**Masterwork = Grade VI, but Grade VI ≠ Masterwork.**

A Masterwork ensemble follows the same 4-judge structure as any other Grade VI ensemble (3 stage + 1 sight-reading). The Masterwork flag affects Overall Rating calculation — Appendix B groups "Grades II–VI and Masterworks" together for the 4-adjudicator formula.

### Graded List

The official NCBA-controlled list of approved music pieces for each grade level. The system stores these lists. When a director selects repertoire, they are shown only pieces from the appropriate Graded List for their grade level.

**Graded List data per piece:**
- Grade (I–VI)
- Title
- Composer/Arranger
- Distributor/Publisher
- Special Instructions (performance requirements, movement restrictions, MW designation)
- Status (active, archive, POP/out-of-print, moved)
- Supplier ID / Item Number
- Year Added
- Composer tags (e.g., "NC Composer", "Underrepresented")

The 2025–2026 list contains ~2,760 pieces across Grades I–VI.

**Performance requirements** are common, especially at higher grades. Examples: "Play any three movements OR MW* - Play all," "Must play Mvt 1 and 6," "May omit one movement." These requirements are stored with the piece and displayed as help text when the piece is selected. Masterwork pieces are marked with "MW*" in the Special Instructions field.

**Any band that performs music not on the NCBA approved list will be disqualified and receive comments only** (no rating). The system should validate repertoire selections against the Graded List.

**List versioning:** The Graded List is updated annually by NCBA. Pieces can be added, removed, archived, or moved between grade levels. The system should store the list version (e.g., "2025–2026") and its last-updated date. When creating an event, the system should confirm which Graded List version applies. Historical events retain their original list version for reference — a piece's grade at the time of the event is what matters, not its current grade.

### Duplicate Personnel Rule

When a school enters more than one ensemble, no more than **5 students playing the same instrument** may appear in multiple ensembles. If a student plays different instruments (as classified by All-State Honor Band audition categories) across ensembles, they do not count as duplicates. The system enforces this during event registration.

---

## Judging Structure

### Judge Position

The specific evaluation slot a judge fills for an ensemble's performance. Each position produces one **score sheet**.

**Stage positions:**

| Position | ID | What They Evaluate |
|----------|----|--------------------|
| Stage Judge 1 | `stage1` | Stage (concert) performance |
| Stage Judge 2 | `stage2` | Stage (concert) performance |
| Stage Judge 3 | `stage3` | Stage (concert) performance |

**Sight-reading position:**

| Position | ID | What They Evaluate |
|----------|----|--------------------|
| Sight-Reading Judge | `sightReading` | Sight-reading performance |

### Form Type

The type of evaluation form a judge fills out. Determines which captions are required.

| Form Type | ID | Used By |
|-----------|-----|---------|
| Stage Form | `stageForm` | Stage judges (stage1, stage2, stage3) |
| Sight-Reading Form | `sightReadingForm` | Sight-reading judge |

### Required Positions Per Grade

| Grade | Required Positions | Total Score Sheets |
|-------|-------------------|---------------------|
| Grade I | stage1, stage2, stage3 | 3 |
| Grade I/II | stage1, stage2, stage3 | 3 |
| Grade II+ (all others) | stage1, stage2, stage3, sightReading | 4 |

### Ensemble Performance Flow

1. Ensemble performs on stage (all 3 stage judges evaluate simultaneously)
2. If the ensemble's grade requires sight-reading, they go directly to the sight-reading room immediately after the stage performance
3. The sight-reading judge evaluates in the sight-reading room

Sight-reading always happens directly after the stage performance, never before.

**Sight-reading prep time** (managed by the sight-reading judge, not the system):

| Grade | Prep Time |
|-------|-----------|
| II, III, IV | 5 min |
| V | 6 min |
| VI | 7 min |

During prep time, the director may clap rhythms, sing parts, count out loud, and finger instruments, but students may not play their instruments. Only one director may work with the band. The sight-reading judge should not have heard the band's stage performance.

---

## Scoring

### Caption

A specific evaluation criterion on a judge's form. Each caption receives a **caption rating** and a **written comment**.

**Stage form captions (7, in canonical order):**

1. Tone Quality
2. Intonation
3. Balance/Blend
4. Precision
5. Basic Musicianship
6. Interpretive Musicianship
7. General Factors

**Sight-reading form captions (7, in canonical order):**

1. Tone Quality
2. Intonation
3. Balance
4. Technique
5. Rhythm
6. Musicianship
7. Utilization of Preparatory Time

Both forms have 7 captions. Both use the same numeric scale and Final Judge Rating lookup. **This order is canonical** — all UI views, score sheet PDFs, and data exports must list captions in this order.

### Caption Rating

The assessment a judge assigns to a single caption. **Never called a "grade" in this system.** Always called a "caption rating."

**NCBA terminology note:** The official NCBA forms and manual use the word "grade" for caption assessments (e.g., "caption grades"). This system deliberately uses "caption rating" instead to avoid confusion with music difficulty Grade (I–VI). When reading NCBA source documents, "caption grade" = our "caption rating."

| Caption Rating | Display Variants | Numeric Value |
|---------------|-----------------|---------------|
| A | A+, A, A- | 1 |
| B | B+, B, B- | 2 |
| C | C+, C, C- | 3 |
| D | D+, D, D- | 4 |
| F | F | 5 |

**The +/- modifiers are display only. They do not affect the numeric value.** A+ = A = A- = 1.

### Caption Score Total

The sum of all 7 caption numeric values on one score sheet. Range: 7–35 (7 captions × 1–5 each). Same range for both stage and sight-reading forms.

### Final Judge Rating

The rating derived from one judge's caption score total. This is a **deterministic lookup**, not a judgment call. The same lookup table applies to both stage and sight-reading forms.

| Caption Score Total | Final Judge Rating | Label |
|--------------------|--------------------|-------|
| 7–10 | I | Superior |
| 11–17 | II | Excellent |
| 18–24 | III | Average |
| 25–31 | IV | Below Average |
| 32–35 | V | Poor |

**The word "Rating" always refers to a Final Judge Rating or a Final Overall Rating.** It is a Roman numeral (I–V) with a corresponding label.

### Final Overall Rating

The final combined rating for an ensemble at the event. Computed from the individual Final Judge Ratings.

**For Grades II–VI and Masterworks (4 adjudicators: 3 stage + 1 sight-reading):**

Each Final Judge Rating is converted numerically: I=1, II=2, III=3, IV=4, V=5.

Add all four numeric ratings together:

| Sum of 4 Ratings | Final Overall Rating | Label |
|------------------|---------------------|-------|
| 4–6 | I | Superior |
| 7–10 | II | Excellent |
| 11–14 | III | Average |
| 15–18 | IV | Below Average |
| 19–20 | V | Poor |

**Unanimous Stage Rule:** If all three stage judges give the same Final Judge Rating of III, IV, or V, that becomes the Final Overall Rating regardless of the sight-reading rating.

Affected combinations (stage1 + stage2 + stage3 + sightReading = Overall):
- 3+3+3+1 = Overall III (not II despite sum of 10)
- 4+4+4+1 = Overall IV (not III despite sum of 13)
- 4+4+4+2 = Overall IV (not III despite sum of 14)
- 5+5+5+1 = Overall V (not IV despite sum of 16)
- 5+5+5+2 = Overall V (not IV despite sum of 17)
- 5+5+5+3 = Overall V (not IV despite sum of 18)

**For Grades I and I/II (3 adjudicators: stage only, no sight-reading):**

Uses a specific combination lookup table (ratings are sorted ascending):

| Sorted Ratings | Final Overall Rating |
|---------------|---------------------|
| 1, 1, 1 | I (Superior) |
| 1, 1, 2 | I |
| 1, 1, 3 | I |
| 1, 1, 4 | I |
| 1, 1, 5 | I |
| 1, 2, 2 | II (Excellent) |
| 1, 2, 3 | II |
| 2, 2, 2 | II |
| 2, 2, 3 | II |
| 2, 2, 4 | II |
| 2, 2, 5 | II |
| 1, 3, 3 | III (Average) |
| 2, 3, 3 | III |
| 2, 3, 4 | III |
| 3, 3, 3 | III |
| 3, 3, 4 | III |
| 3, 3, 5 | III |
| 1, 4, 4 | IV (Below Average) |
| 2, 4, 4 | IV |
| 3, 4, 5 | IV |
| 4, 4, 3 | IV |
| 4, 4, 4 | IV |
| 4, 4, 5 | IV |
| 1, 5, 5 | V (Poor) |
| 2, 5, 5 | V |
| 3, 5, 5 | V |
| 4, 5, 5 | V |
| 5, 5, 5 | V |

**Note:** This table has known gaps for extreme-spread combinations (e.g., 1,4,5 and 2,3,5 are not listed). These combinations are essentially unheard of in practice (a rating of V requires extreme incompetence). **The implementation should use the sum-based formula as a fallback for any combination not in the lookup table.** Sum-based: add three numeric ratings, then: 3–5=I, 6–8=II, 9–11=III, 12–14=IV, 15=V.

### Rating Labels (for certificates and publication)

| Rating | Label |
|--------|-------|
| I | Superior |
| II | Excellent |
| III | Average |
| IV | Below Average |
| V | Poor |

### Comments Only

An operational mode where an ensemble receives judge comments and audio feedback but no numeric ratings. The ensemble is not rated.

This can be:
- **Pre-selected:** Director registers the ensemble as comments-only before the event
- **Retroactive:** Chair forces comments-only during or after the event (e.g., for disqualification, procedural exceptions, or unrecoverable judging issues)

A comments-only ensemble displays "CO" as its overall rating.

**Sight-reading is optional for comments-only ensembles.** The director may choose whether the ensemble participates in sight-reading. If they do, the judge provides comments only — no caption ratings or Final Rating. Adjudicators must make no reference, verbal or written, to what ratings would have been assigned.

---

## Artifacts

### Score Sheet

One judge's completed evaluation of one ensemble. A score sheet contains:
- Audio recording (tape)
- Caption comments (written text for each caption)
- Caption ratings (A-F for each caption)
- Computed Final Judge Rating (I-V, derived from caption score total)

A score sheet is produced by one judge in one position for one ensemble. It is the raw artifact of judging.

**The term "score sheet" refers to both the data record AND the generated PDF form.** When the distinction matters, use "score sheet" for the data and "score sheet PDF" for the physical/digital form.

Score sheet PDFs use the official NCBA form template. They are both printed on paper and available as downloadable PDFs.

**Types:**
- **Stage score sheet** — Uses the stage form template
- **Sight-reading score sheet** — Uses the sight-reading form template

### Tape

The audio recording made by a judge during an ensemble's performance. A judge records while the ensemble plays and while providing verbal commentary.

The intention is one continuous tape per judge per performance. However, judges may stop and restart recording (to handle downtime, pre-record an intro, pause to write, or discuss with other judges). The system supports this by allowing **multiple segments**.

**Types of tape:**
- **Segment** — One continuous recording chunk.
- **Stitched tape** — Multiple segments concatenated into one continuous audio file (server-side via FFmpeg).
- **Canonical tape** — The single official audio artifact that the director receives from this judge. For one-segment recordings, the canonical tape IS the segment. For multi-segment recordings, the canonical tape is the stitched result.

The tape is the one audio artifact per judge that the director receives.

### Results Packet

The official bundle of all judge score sheets for one ensemble at one event. A complete results packet contains:
- One score sheet per required position (3 for Grade I/I-II, 4 for all others)
- One canonical tape per judge position
- The Final Overall Rating

**A results packet is NOT a score sheet.** A score sheet is one judge's work. A results packet is the complete, official result for the ensemble.

### Director Export

What a director sees when they access their released results. Per ensemble:
- Snapshot overview: School, Ensemble, Grade, Stage1 Rating, Stage2 Rating, Stage3 Rating, Sight-Reading Rating, Overall Rating
- All score sheet PDFs (3 or 4)
- All canonical tapes (3 or 4)

---

## Workflow States

### Score Sheet Status

| Status | Meaning |
|--------|---------|
| `draft` | Judge is actively working on the score sheet |
| `submitted` | Judge has completed and sent the score sheet for Chair review |
| `returned` | Chair has returned the score sheet to the judge with a visible flag (no justification text required; Chair handles explanation in person). Judge can fix ratings/comments and optionally append additional audio, but is not required to re-record. |
| `verified` | Chair has validated the score sheet; it is now official and **automatically included in the packet** |

**Key rules:**
- A judge sees a visible flag when their score sheet has been returned
- `returned` puts the score sheet back in `draft`-like state for the judge to correct and resubmit
- Once `verified`, the score sheet is automatically part of the packet — there is no separate "add to packet" action

### Packet Status (Two Independent Dimensions)

**Assembly status** (computed, not manually set):

| Status | Meaning |
|--------|---------|
| `incomplete` | Packet is missing required verified score sheets |
| `complete` | All required score sheets are verified and included |

**Release status** (manually set by Chair):

| Status | Meaning |
|--------|---------|
| `unreleased` | Internal only — not visible to directors |
| `released` | Visible to directors and public-facing users |

**Core concept:**
- **Verification controls validity and inclusion** — a score sheet is part of the packet because it's verified
- **Release controls visibility** — a packet is visible to directors because it's released
- A packet can be `complete` + `unreleased` (all score sheets verified, but Chair hasn't released yet)
- A packet can be `released` then set back to `unreleased` if corrections are needed

**Database representation:**
```
score_sheets.status = draft | submitted | returned | verified
packets.assembly_status = incomplete | complete  (computed)
packets.release_status = unreleased | released
```

---

## Operations

### Verify

The act of the Chair reviewing a submitted score sheet, confirming the math is correct (caption ratings sum to the expected total, Final Judge Rating matches the lookup), and marking it as verified. Once verified, the score sheet is automatically part of the ensemble's results packet.

**Split rating flag:** If the Final Judge Ratings from the panel have a 2+ point spread (e.g., I–II–III or II–III–IV), the system should flag this for the Chair. Per NCBA rules, the Chair must intervene to attempt to resolve the discrepancy. The adjudicators' ratings are ultimately final, but the flag ensures the Chair is aware.

The Chair can also **return** a score sheet to the judge if a problem is found.

### Release

The act of the Chair publishing a completed results packet so the director can access it. Release is:
- Manual only (never automatic)
- All-or-nothing per packet (no partial release)
- Requires all positions to have verified score sheets
- Requires all canonical tapes to be present
- Expected to happen as soon as the packet is complete — during the event, not after

### Unrelease

The act of pulling back a released packet. The director can no longer see it. Used when corrections are needed after release.

---

## Terms That Are NOT Interchangeable

| Term A | Term B | Difference |
|--------|--------|------------|
| Grade (music difficulty) | Caption Rating | Music difficulty (I–VI) vs assessment letter (A–F). **Never use "grade" for assessment.** |
| Grade I/II | Grade I or Grade II | "Grade I/II" is ONE specific split grade value |
| Grade I | Highest/Best | Grade I is the LOWEST difficulty, not the best result |
| Rating | Score | Rating = Final Judge Rating or Overall Rating (I–V). Score = numeric caption total (7–35). |
| Caption Rating | Final Judge Rating | Letter on one caption (A–F) vs derived rating for the whole form (I–V) |
| Final Judge Rating | Final Overall Rating | One judge's rating vs the ensemble's combined rating from all judges |
| Score Sheet | Results Packet | One judge's evaluation vs the complete bundle for an ensemble |
| Tape | Score Sheet | The audio recording vs the complete evaluation (audio + comments + ratings) |
| Submitted | Released | Judge has sent for Chair review vs Chair has published for director access |
| Verified | Released | Chair has approved a score sheet vs Chair has made a packet visible |
| Chair | Admin | Event operator (non-technical) vs system technical overseer |
| Stage | Room | Performance space (specific) vs any physical space at the site (general) |
| Masterwork | Grade | A flag on a Grade VI piece, not a separate grade level |
| Caption Rating (our term) | Caption Grade (NCBA term) | Same concept. We use "rating" to avoid overloading "grade." |

---

## Scale

| Metric | Typical Value | Notes |
|--------|--------------|-------|
| Ensembles per event | 15–20 | Up to ~30 possible |
| Judges per event | 4 | 3 stage + 1 sight-reading. Same 4 judges for every ensemble — judges do NOT rotate. |
| Events per season | ~15 | Across all 7 districts statewide |
| Events per district | 1–3 | Districts with more schools may split across multiple sites/dates |
| Concurrent events | Yes | Two events at different sites on the same day with different users is expected at scale |

---

## Other Event Documents

Beyond score sheet PDFs and canonical tapes, the event produces:

- **Program** — The printed event schedule listing all ensembles, their schools, directors, repertoire, and performance times. This is handed out at the event.
- **Ratings Recap** — A summary document listing all ensembles and their final ratings. Published after the event.

---

## Expenses

Tracking expenses and payments (judge fees, site costs, etc.) is **out of scope** for this system. Handled separately by district leadership.

---

## Check-In Verification

At check-in, the volunteer verifies one physical item; the system handles everything else:

1. **Three physical conductor scores** — Paper scores with measures numbered. Must be published scores or E-Print copies with proof of purchase. The volunteer verifies the physical scores are present and that titles match the repertoire in the system. This is the only physical check-in item. The system confirms that the check was completed.

**Handled digitally by the system (no physical documents needed):**
- **NAfME/NCMEA membership** — Tracked in the system. NCMEA membership is obtained through NAfME.
- **Instrumentation** — Part of the digital event entry form.
- **Repertoire history** — Tracked automatically from historical event data. The 4-year non-repeat rule applies per **school**, not per ensemble — if any ensemble at a school performed a piece, no other ensemble at that school may perform it for 4 years.
- **Repertoire validation** — The system already has the registered repertoire from the event entry form for title matching.

---

## Open Questions

All core Q&A is complete. The glossary is ready for schema design.

Remaining items for future review:
- Director school attachment approval/detachment process (mentioned in Director workflow)
- Volunteer role details (deferred until core workflows are established)
- Performance requirements on Graded List pieces (display and enforcement rules)
