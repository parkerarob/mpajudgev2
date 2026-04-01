# MPA Domain Language Glossary

Status: DRAFT — Core Q&A complete (rounds 1-3). Ready for schema design.

Last updated: 2026-03-25

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

**Current active scope: Concert Band MPA only.** All other event types listed below are placeholders — their workflows, entry models, and judging structures are not yet designed. Event type is a first-class property of every event; "Concert Band MPA" is one type, not the default. MPA events are district-level only — there is no state-level MPA event.

### Event

A specific NCBA event held at a specific site on a specific date (or dates). Example: "Eastern District Concert Band MPA — South Site — March 2026." An event has a schedule, assignments, entries, and produces results.

**NOT:** a generic calendar item or notification. In this system, "event" always means an MPA adjudication event.

**Event naming convention:**

Event names should follow a compact NCBA naming format:

`NCBA` + `{district label}` + `{optional site designation}` + `{event type label}`

Rules:
- `NCBA` always comes first.
- Use the district shorthand label, not the full district name, in the event name.
- For Eastern District, the district label is `E`.
- If a site designation exists, place it after the district label.
- The event type label comes last.
- For Concert Band MPA, the event type label is `MPA`.
- Future event types may use different ending labels, such as Jazz MPA or Solo/Ensemble MPA variants.

Example:
- Eastern District Concert Band MPA, South Site → `NCBAE South MPA`

The physical site name is separate from the event name. For example, `Ashley High School` is the site, while `South` is the event's site designation.

**Event identity fields:**

An event is defined by:
- Organization: currently always `NCBA`
- District: e.g., `Eastern`
- Site designation: optional event label such as `South`, `HS`, or `MS`
- Location: the physical site, such as `Ashley High School`
- Event type: e.g., `Concert Band MPA`
- Graded List version
- Season year
- Start/end dates
- Schedule start time
- Status

The system should not ask a user to choose `ensemble` vs `individual` as a separate event setting. That behavior is implied by the event type and will be modeled in future workflows as additional event types are introduced.

### Event Type

The discipline or workflow category for an event. This is a first-class event property.

Event types and their current implementation status:

| Event Type | Status | Entry Model | Judge Structure | Audio | Sight-Reading |
|-----------|--------|------------|----------------|-------|---------------|
| Concert Band MPA | **Active** | Persistent ensemble | 3 stage + 1 SR | Yes | Yes (Grade II+) |
| Solo/Ensemble MPA | Placeholder | Entry-contained participants | 1 judge per entry | No | No |
| Jazz Band MPA | Placeholder | TBD | TBD | TBD | TBD |
| Marching Band | Placeholder | TBD | TBD | TBD | TBD |
| All-District Auditions | Placeholder | Individual records | TBD | TBD | TBD |
| All-District Honor Band | Placeholder | TBD | TBD | TBD | TBD |
| All-State Auditions | Placeholder | Individual records | TBD | TBD | TBD |
| All-State Honor Band | Placeholder | TBD | TBD | TBD | TBD |

The event type controls naming and determines the entry model, judging structure, and scoring workflow. Placeholder event types exist in the system as selectable options to establish the taxonomy early, but have no implementation behind them. Do not build workflows or UI for placeholder types until they are moved to Active.

**Note on Solo/Ensemble MPA:** The SE/MPA entry model and judging structure are fully documented in this glossary and in `docs/Schema-Design.md`. Despite being documented, the SE/MPA workflow is not yet built — it remains a placeholder in the implementation. The documentation reflects the design intent for when it is built.

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

If a district uses labels like `South Site` or `North Site`, those labels belong to the **event**, not the **site**. The site is the physical place; the designation is event-specific.

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

Judges work inside one worksheet UI with two modes:

- **Official sheet** — a real adjudication record that saves to the event system, stores caption ratings and judge tape audio, and enters chair review on submit
- **Practice** — a browser-local training mode that uses the same worksheet layout, never creates official records, and clears itself when the judge finishes practice

Official sheets can begin in one of two identity states:

- **Assignment-backed official sheet** — started from a real judge assignment and event entry
- **Manual-started official sheet** — started by a judge for a real event entry and form when they need to begin official work directly

Manual-started official sheets are still official event work. They are not practice sheets.

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

**Practice workflow:**

1. Login.
2. Open a practice sheet at any time.
3. Enter or confirm the ensemble context manually if needed.
4. Work through the same 7-caption scoring structure used by the official sheet.
5. Use the sheet for rehearsal or training.

Practice is browser-local only. It is **not** an official adjudication record, it does **not** enter chair review, and it is cleared when the judge submits practice.

### Director

A school band director whose ensemble is performing at the event.

**The director is the authenticated user, but the school is the operating context.** The director profile establishes identity and eligibility (who they are, whether their NAfME is valid). The school dashboard is where they actually work.

This distinction matters for routing, permissions, and mental model:
- **Director profile** = identity and eligibility layer (personal contact info, NAfME membership)
- **School profile** = organizational record
- **School dashboard** = primary workspace

A director who is linked to more than one school uses a school selector to choose which school context to enter. All work — ensembles, event entries, results — happens in the context of a specific school.

**Director workflow:**

Account/onboarding:
1. Sign in via OAuth.
2. Complete director profile (name, contact info, NAfME).
3. Link to a school.
4. Land on the school dashboard — this is the primary working home.

Pre-event (from school dashboard):
5. Review state-level and district-level reference information relevant to Concert Band MPA.
6. Review event-specific notices published by the Chair for available district events.
7. Create ensemble(s) at their school.
8. Register ensemble(s) for a specific event.
9. Fill out event entry information: repertoire selections, instrumentation, seating chart, percussion assignments, lunch orders, etc.

Event day:
10. Complete check-in at the site (volunteer verifies NAfME card, physical conductor scores).
11. Physically move ensemble through the event flow: Holding → Warmup → Stage Performance → Sight-Reading.

Post-event:
12. Review released results packets as they become available.

**Student teacher rule:** A student teacher who is a current NAfME Collegiate member may conduct one piece during a performance. Out of scope for system enforcement, but event information/rules should mention it.

Director results access is **indefinite**. Historical records of ensemble, grade, repertoire, and ratings/overall should be kept permanently. Audio/PDF storage may be limited if costs require it.

### Director Onboarding

When a director signs in for the first time (or has an incomplete profile), the system routes them through a setup flow before they can access their dashboard.

**Onboarding steps:**

1. **Confirm identity** — Full name and primary email are pre-filled from OAuth. Director confirms they are correct.
2. **Complete director profile** — Full name, primary email (from OAuth, not editable here), optional secondary email, and phone number.
3. **Select school** — Director searches for their school. If found, they link directly — no approval required. If not found, they submit a school creation request (see School Creation Request below) and are blocked from continuing until the school is created by an admin and they return to link it manually.
4. **Add NAfME information** — NAfME membership number, expiration date, and a visual confirmation (photo or screenshot of the membership card). Membership status is **derived from the expiration date** — it is not manually chosen by the director.
5. **Review and confirm** — Director reviews all entered information (contact info, school, NAfME) and saves.
6. **Director home** — Onboarding is complete. Director lands on their school dashboard.

**Onboarding is complete when all of the following are true:**
- A director profile exists with required contact info (name, primary email, phone)
- Director is linked to at least one school
- NAfME membership number, expiration date, and visual confirmation are on file

**Access before onboarding is complete:** The system should route incomplete directors into the setup flow. Directors who have completed onboarding but have expired or missing NAfME can still use the app — event-related actions should show warnings or be blocked only where NAfME status is a formal requirement (e.g., check-in verification).

### School Creation Request

When a director cannot find their school during onboarding, they submit a creation request. This is not the same as creating a school — it is a request for admin to create one.

**Director provides:**
- School name
- School level (High School, Middle School, or Elementary School)
- District

**Admin reviews** the request and creates the school profile with the official name, level, and district assignment. The director's submitted district is informational — the admin controls the official district assignment on the school record.

**After admin creates the school**, the director must return to onboarding and manually search for and link the new school. The director is not automatically linked.

**Director is blocked** from completing onboarding until they are linked to a school. A pending creation request does not satisfy the school link requirement.

### School Linking and Unlinking

**Linking** is self-service. A director can link themselves to any existing school without approval. A director may be linked to more than one school.

**Unlinking** requires admin action. A director may request to be unlinked from a school, but only an admin can execute the removal. This prevents accidental or unauthorized detachment from a school that has active event entries or ensembles.

### NAfME Membership

NAfME (National Association for Music Education) membership is required for directors participating in NCBA events. The system tracks three pieces of information:

- **Membership number** — The director's NAfME member ID
- **Expiration date** — The date the current membership expires
- **Visual confirmation** — A photo or screenshot of the director's membership card, uploaded by the director

**Membership status is derived from the expiration date**, not manually set. If the expiration date is in the past, the membership is expired. The system does not allow the director to manually select "active" or "expired."

NCMEA membership is obtained through NAfME. At check-in, the volunteer verifies the physical card; the system confirms that the director's NAfME information is on file and that the check was completed.

### Multiple Roles

A person can hold multiple roles. For example, a director at one school could serve as a judge at a different event. The system must support this — role is contextual, not fixed per person.

### Volunteer Roles

Volunteers are people who assist at the event. Some volunteer roles touch the software:

- **Check-in** — Handles ensemble arrival. Verifies required documents (NAfME membership card, 3 physical conductor scores with measures numbered). Can make limited edits on behalf of the director (e.g., adjust stage setup numbers if a student is out sick). The system confirms that document checks were completed.
- **Stage crew** — Has read access to schedule/flow information.
- **Announcer** — Has read access to ensemble information for announcements.

Volunteer roles will be reviewed after the core Chair, Judge, and Director workflows are established.

**Note:** The TeamLead/OpsLead role from the current system is an artifact and will not carry forward.

### School Dashboard

The primary workspace for a director. After completing onboarding and linking to a school, the director lands here. All program management happens in this context.

**The director does not primarily land on a personal dashboard.** If a personal/account-level view exists at all, it is a lightweight school selector or account settings page — not a working home. The school dashboard is the center of gravity for the role.

**School dashboard sections:**

| Section | Purpose |
|---------|---------|
| School summary | School name, district, level, linked directors, active season at a glance |
| Alerts / action items | Outstanding tasks, missing required event entry fields, upcoming deadlines, NAfME expiration warnings |
| Ensembles | Manage the school's performing groups |
| Events | Browse available district events, view event notices and details |
| Registrations | Manage active event entries, complete entry requirements |
| Results / packets / reports | Access released packets, historical results, and reporting |

**Multi-school directors:** A director linked to more than one school sees a school selector before entering a dashboard. The selector is lightweight — once they choose a school, the full school dashboard loads for that context. There is no cross-school aggregate view.

This applies in two common situations:
- A director holds roles at two separate institutions (e.g., Ashley High School and Murray Middle School)
- A director runs both the high school and middle school programs at the same campus (e.g., Cape Fear Academy HS and Cape Fear Academy MS, which are two separate school records in the system)

**Account-level vs. school-level:**

| Level | What lives here |
|-------|----------------|
| Account (global) | Director profile, login/account settings, NAfME membership info |
| School | School profile, ensembles, event registrations, results, reporting |

---

## Musical Entities

### School

An educational institution with a music program. A school has one or more **ensembles** and one or more **directors**. Schools are identified by name.

The Director-to-School relationship is **many-to-many**: multiple directors can be associated with one school, and one director can have ensembles at multiple schools.

**School profiles are admin-controlled.** Directors do not create or edit school profiles directly. They may submit a school creation request if their school is not found, but the admin creates the official record. District assignment on a school is always set by an admin — a director cannot reassign a school to a different district.

**School profile fields:**
- **Name** — Official school name
- **Level** — High School, Middle School, or Elementary School
- **District** — The NCBA district this school belongs to. Admin-controlled.
- **Address** — Street address. Optional at creation; filled in later.
- **City** — City. Optional at creation.
- **State** — State. Defaults to NC.
- **Phone** — School phone number. Optional at creation.

### School Level

The grade-level classification of a school. One of: **High School**, **Middle School**, **Elementary School**.

School level is part of the school profile and is set by the admin. It is used for reporting and may affect registration rules in future event types (e.g., separate MPA events for middle vs. high school).

**A single physical campus that serves multiple grade levels is modeled as separate school records — one per level.** For example, Cape Fear Academy, which serves both high school and middle school students, would appear in the system as two records: `Cape Fear Academy (High School)` and `Cape Fear Academy (Middle School)`. A director who runs both programs would be linked to both records and would use the school selector to switch between them.

### Ensemble Type

A label on a persistent ensemble that indicates its discipline. Used for filtering and display — not hard enforcement, but a jazz ensemble will not appear as a registration option for Concert Band MPA events.

| Ensemble Type | Examples |
|--------------|---------|
| Concert Band | Wind Ensemble, Symphonic Band, Concert Band, Freshman Band |
| Jazz Band | Jazz Ensemble, Jazz Band, Stage Band |

Ensemble type does not affect how the ensemble is judged — that is determined by the event type it registers for.

### Ensemble

A specific performing group at a school. Examples: "Symphonic Band," "Concert Band," "Wind Ensemble." An ensemble performs at an event and has an **ensemble type**.

**Key distinction:** An ensemble is a persistent entity at a school. An **event entry** is that ensemble's participation in a specific event.

**Ensembles are only used for Concert Band MPA and Jazz MPA.** Solo/Ensemble MPA entries are not linked to persistent ensembles — their participants are listed directly on the entry.

### Grade (Music Difficulty Classification)

The difficulty classification of the music an ensemble performs. **Grade always refers to music difficulty, never to assessment results.** Assessment results are called **ratings**.

**Grade I is the LOWEST difficulty. Grade VI is the HIGHEST difficulty.**

This is counterintuitive and is the single most common source of confusion. To remember: think of it as "Grade level" in school — a 6th grader is more advanced than a 1st grader.

A band's grade classification is **derived from its repertoire selections**, not declared. The grade is determined by which Graded Lists the ensemble's selections come from. A pre-event declaration may be made for scheduling purposes (to group similar difficulty levels together), but the official grade is determined by the actual pieces performed.

### Repertoire (Performance Program)

Every ensemble performs **3 pieces** at the event:

1. **March** — Does not come from a Graded List (any march is acceptable). Does not affect grade classification.
2. **Selection #1** — From a Graded List. Determines (or co-determines) the ensemble's grade.
3. **Selection #2** — From a Graded List (same or adjacent to Selection #1). Required unless Selection #1 is a Masterwork.

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

**Director repertoire selection workflow:** For Selection #1 and Selection #2, the director first chooses a grade level (I-VI), then uses two search inputs: one for piece title and one for composer/arranger. The search results must be limited to official Graded List pieces from that selected grade only. Directors must never be shown free-text graded-piece entry for these slots.

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

### Declared Grade

The grade a director states they intend to perform at registration time. Example: a director registers and declares "Grade IV" before their repertoire selections are finalized.

**Declared grade exists for one purpose only: to help the Chair build the initial schedule** before all repertoire is locked. Directors sometimes declare a grade that differs from their eventual official grade (e.g., declares Grade IV, ends up performing Grade IV/V).

**Declared grade must never be treated as authoritative.** It must not appear in the event program, judge score sheets, results, packets, or any reporting. The only official grade is the one derived from the ensemble's actual repertoire selections. No part of the system should fall back to declared grade if the official grade is unavailable — in that case, the repertoire is incomplete.

### Duplicate Personnel Rule

When a school enters more than one ensemble, no more than **5 students playing the same instrument** may appear in multiple ensembles. If a student plays different instruments (as classified by All-State Honor Band audition categories) across ensembles, they do not count as duplicates. The system enforces this during event registration.

**Rule 3C entry UX:** Each ensemble has its own Rule 3C section in the event entry form. The director gets a fixed five-row form. Each row has student name, instrument, and the other ensemble from a dropdown. The system automatically reflects that entry on the other ensemble's Rule 3C view — the director does not enter the same student twice.

Each ensemble's Rule 3C view shows only that ensemble's perspective: the student name, instrument, and which OTHER ensemble they share. Example:
- Concert Band view: John Smith | Trumpet | Wind Ensemble
- Wind Ensemble view: John Smith | Trumpet | Concert Band

The 5-student limit applies per instrument across all the school's ensembles at the event. The system warns if adding a student would exceed this limit.

### SE/MPA Entry

A single performance at a Solo/Ensemble MPA event. One entry = one performance, regardless of the number of participants. A school may submit any number of entries.

**Examples:**
- One student performing a clarinet solo = 1 entry
- Three students performing a brass trio = 1 entry
- Ten students performing a percussion ensemble = 1 entry

Each SE/MPA entry has an **event number** assigned by the Chair, scoped to the entire event. This number is the primary identifier used during the event — judges select an event number to pull up the correct entry and form.

**SE/MPA entries are not linked to persistent ensembles.** Participants are listed directly on the entry. No ensemble record is created or required.

**Entry fields:**
- Event number (Chair-assigned, unique within the event)
- Category (determines the form type used by the judge)
- Entry name (e.g., "Smith — Clarinet Solo" or "Ashley HS Percussion Ensemble")
- Selection(s) and composer
- Participant list (see SE/MPA Entry Participant)

### SE/MPA Entry Category

The classification of an SE/MPA entry. Determines which adjudication form the judge uses.

| Category | Form Used | Typical Size |
|----------|-----------|-------------|
| Solo Wind | Solo Wind form | 1 performer |
| Solo Percussion | Solo Percussion form | 1 performer |
| Small Ensemble | Small Ensemble Wind form | 2–9 performers (winds) |
| Percussion Ensemble | Percussion Ensemble form | 2+ performers (percussion) |

Category is set by the director when creating the entry. The system uses it to auto-select the correct form when a judge opens the entry.

### SE/MPA Entry Participant

A performer listed on an SE/MPA entry. Participants are entry-contained — they do not exist as independent records outside the entry.

**Participant fields:**
- Name
- Instrument
- Student grade level (K-12 school grade, e.g., 9th, 10th — not music difficulty grade)
- Multiple events flag (true if this student appears in more than one entry at this event)

**Multiple events flag:** When a student is flagged as appearing in multiple entries, the system surfaces a scheduling warning to prevent two of their entries from being assigned the same time slot. The Chair resolves conflicts manually.

**Student grade level** on SE/MPA forms refers to the student's school grade (e.g., 9th grade), not the music difficulty Grade (I–VI). These are entirely different concepts.

---

## Judging Structure

The judging structure differs significantly between Concert Band MPA and SE/MPA. The sections below cover both.

---

### Concert Band MPA — Judging

#### Judge Position

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

#### Form Type (Concert Band MPA)

| Form Type | ID | Used By |
|-----------|-----|---------|
| Stage Form | `stageForm` | Stage judges (stage1, stage2, stage3) |
| Sight-Reading Form | `sightReadingForm` | Sight-reading judge |

#### Required Positions Per Grade

| Grade | Required Positions | Total Score Sheets |
|-------|-------------------|---------------------|
| Grade I | stage1, stage2, stage3 | 3 |
| Grade I/II | stage1, stage2, stage3 | 3 |
| Grade II+ (all others) | stage1, stage2, stage3, sightReading | 4 |

#### Ensemble Performance Flow

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

### SE/MPA — Judging

#### SE/MPA Judge Assignment

SE/MPA uses **one judge per entry**. There are no fixed positions (stage1, stage2, etc.). Judges are assigned to the SE/MPA event generally and may judge any category. In practice judges specialize — one judge may handle all wind solos, another all percussion entries — but the system does not enforce this. Any judge at the event can open any entry.

#### SE/MPA Form Types

The form type for an SE/MPA entry is determined by its category. The judge does not choose the form — it is auto-selected when the judge opens the entry by event number.

| Category | Form Type ID | Notes |
|----------|-------------|-------|
| Solo Wind | `sempa_solo_wind` | 7 captions |
| Solo Percussion | `sempa_solo_percussion` | 7 captions, includes Position |
| Small Ensemble | `sempa_small_ensemble` | 7 captions, includes Balance |
| Percussion Ensemble | `sempa_percussion_ensemble` | 7 captions, includes Position + Balance |

#### SE/MPA Judge Workflow (per entry)

1. Judge selects the entry by event number
2. System displays the entry details (category, participants, selection) and the correct form type
3. Judge fills in 7 caption ratings (A–F) and written comments
4. System computes the Caption Score Total and Final Rating (same I–V lookup as Concert Band MPA)
5. Judge submits the score sheet
6. Chair verifies — verification triggers immediate release to the director
7. Judge moves to the next entry number

No audio recording. No sight-reading. One score sheet per entry, one Final Rating.

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

Both Concert Band MPA forms have 7 captions. Both use the same numeric scale and Final Judge Rating lookup. **This order is canonical** — all UI views, score sheet PDFs, and data exports must list captions in this order.

**SE/MPA form captions (7 each, in canonical order):**

*Solo Wind:*
1. Tone Quality, 2. Intonation, 3. Precision, 4. Rhythm, 5. Musicianship, 6. Interpretation, 7. General Factors

*Small Ensemble (Wind):*
1. Tone Quality, 2. Intonation, 3. Balance, 4. Precision, 5. Rhythm, 6. Musicianship, 7. General Factors

*Solo Percussion:*
1. Tone Quality, 2. Intonation, 3. Position, 4. Precision, 5. Rhythm, 6. Musicianship, 7. General Factors

*Percussion Ensemble:*
1. Tone Quality, 2. Position, 3. Balance, 4. Precision, 5. Rhythm, 6. Musicianship, 7. General Factors

All four SE/MPA forms use the same A–F caption rating system and the same I–V Final Rating lookup as Concert Band MPA. The difference is only in which 7 captions appear and their order. The canonical caption order for each form is fixed — UIs and PDFs must follow it exactly.

**Caption definitions vary by form.** The subdefinitions below are taken directly from the official NCBA SEMPA adjudication forms (version 1.3.15). They are display text on the form — the caption name itself is what the system stores.

| Caption | Solo Wind | Small Ensemble (Wind) | Solo Percussion | Percussion Ensemble |
|---------|-----------|----------------------|----------------|---------------------|
| Tone Quality | Characteristic Sound, Clarity, Consistency, Control, Resonance | Characteristic Sound, Clarity, Consistency, Control, Matching within Section, Resonance | Characteristic Sound, Clarity, Consistency, Control, Matching within Section, Resonance | Characteristic Sound, Clarity, Consistency, Control, Matching within Section, Resonance |
| Intonation | Initial Pitch, Adjustments are Made, Melodic Line | Initial Pitch, Chords, Individual, Melodic Line, Makes Adjustments | Pitch, Adjustments are Made | _(not present)_ |
| Position | _(not present)_ | _(not present)_ | Body, Hand, Instrument | Body, Hand, Instrument |
| Balance | _(not present)_ | Blend, Ensemble, Melodic, Section | _(not present)_ | Blend, Ensemble, Melodic, Section |
| Precision | Accuracy, Articulation, Facility, Note Accuracy, Releases, Rudiments | Accuracy, Articulation, Entrances, Releases, Facility, Technique | Accuracy, Articulation, Facility, Note Accuracy, Releases, Rudiments | Accuracy, Articulation, Entrances, Releases, Facility, Technique |
| Rhythm | Accuracy, Meter, Steadiness, Tempo | Accuracy, Meter, Steadiness, Tempo | Accuracy, Meter, Steadiness, Tempo | Accuracy, Meter, Steadiness, Tempo |
| Musicianship | Adherence to printed musical directions not addressed by previous captions | Artistry, Dynamics, Energy, Expression, Interpretation, Phrasing, Style, Dynamic Contrast | Artistry, Dynamics, Energy, Expression, Interpretation, Phrasing, Style, Dynamic Contrast | Artistry, Dynamics, Energy, Expression, Interpretation, Phrasing, Style, Dynamic Contrast |
| Interpretation | Choice of Tempos, Dynamic Contrast, Phrasing, Style, Energy, Expression | _(not present)_ | _(not present)_ | _(not present)_ |
| General Factors | Choice of Appropriate Literature, Instrumentation, Etiquette, Confidence, Discipline, Appearance, Posture | Choice of Appropriate Literature, Instrumentation, Etiquette, Confidence, Discipline, Appearance, Posture | Choice of Appropriate Literature, Instrumentation, Etiquette, Confidence, Discipline, Appearance | Choice of Appropriate Literature, Instrumentation, Etiquette, Confidence, Discipline, Appearance |

Note: Solo Wind is the only form with an **Interpretation** caption as a distinct item. For all other forms, interpretive elements are folded into **Musicianship**.

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

One judge's completed evaluation of one performance. A score sheet contains:
- Caption comments (written text for each caption)
- Caption ratings (A–F for each caption)
- Computed Final Judge Rating (I–V, derived from caption score total)
- For Concert Band MPA only: audio recording (tape)

A score sheet is produced by one judge for one performance. It is the raw artifact of judging.

**The term "score sheet" refers to both the data record AND the generated PDF form.** When the distinction matters, use "score sheet" for the data and "score sheet PDF" for the physical/digital form.

Score sheet PDFs use the official NCBA form template. They are both printed on paper and available as downloadable PDFs.

**Concert Band MPA score sheet types:**
- **Stage score sheet** — Uses the stage form template
- **Sight-reading score sheet** — Uses the sight-reading form template

**SE/MPA score sheet types:**
- **Solo Wind score sheet** — Uses the Solo Wind form template
- **Small Ensemble score sheet** — Uses the Small Ensemble Wind form template
- **Solo Percussion score sheet** — Uses the Solo Percussion form template
- **Percussion Ensemble score sheet** — Uses the Percussion Ensemble form template

### Official Adjudication Sheet

The official event-bound score sheet used during live adjudication.

An official adjudication sheet is:
- tied to one event entry
- tied to one form type
- part of the chair review and verification flow
- part of packet/release state once verified

An official adjudication sheet may be:

- **assignment-backed** — tied to one judge assignment
- **manual-started** — started by a judge without a bound assignment, but still saved as a real official score sheet

The Chair handles both as official adjudication records.

Unless otherwise stated, Concert Band MPA event operations should assume "score sheet" means official adjudication sheet.

### Practice Sheet

A browser-local non-official version of the judge worksheet used for:
- practice
- training
- familiarization with the digital judging workflow

A practice sheet:
- is always available to the judge
- is not part of the official packet
- must be visually labeled as non-official
- must not appear in official score-sheet queues
- must not save score-sheet, caption-rating, or official tape records
- is cleared after practice submit

The practice sheet exists to make the judge's work easier while learning the workflow. It is not an adoption or rescue path.

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

### Director Results View

What a director sees when they access results for their school. This is the primary post-event view and is read-only.

**Event context:**
- Defaults to the current active event for the school
- If no active event, defaults to the most recently released event
- Event selector is prominent — director can switch to any past event

**Ratings overview (top of page):**

A summary table showing all of the school's entries for the selected event. Visible only once at least one packet has been released.

| Column | Source |
|--------|--------|
| School + Ensemble name | `schools.name` + `ensembles.name` |
| Grade | `event_entries.grade` — derived from repertoire. Never `declared_grade`. |
| Stage 1 / Stage 2 / Stage 3 / SR rating | `score_sheets.final_judge_rating` per position |
| Judge last name under each position header | `users.display_name` via `judge_assignments`. Shown when assigned; blank otherwise. |
| Overall Rating | `packets.overall_rating` |

Ratings are centered in their columns. Judge last names appear beneath each position header (e.g., PURVIS under Stage 1). The overall rating column is visually separated.

**Entry detail (below the overview table):**

Shown when a director selects an ensemble row. Displays:
- School, ensemble name, director name, event name, official grade, overall rating
- Full performed repertoire: all pieces listed (march + selection 1 + selection 2 if present). Masterwork-only programs show correctly with a single graded selection.

**Released packet view (below entry detail):**

Visible only once the Chair has released the packet. One section per judge position, in order: Stage 1, Stage 2, Stage 3, SR (omitted for Grade I / I/II).

Each section contains:
1. **Section header** — position label (Stage 1 / Stage 2 / Stage 3 / SR), judge full name, Final Judge Rating
2. **Audio player** — canonical tape for this judge's position
3. **Caption-by-caption view** — all 7 captions in canonical order, each showing: caption name, caption rating (A/B/C/D/F with modifier), and the judge's written comment. Non-editable.

Caption 7 (General Factors for stage form; Utilization of Preparatory Time for sight-reading form) is the final caption and serves as the judge's closing commentary. There is no separate "overall comments" field — the 7-caption structure is complete.

**Grade displayed in results is always the official derived grade** from `event_entries.grade`, with `-Flex` appended when either graded selection is marked Flex on the entry. The `declared_grade` field (used only for pre-event scheduling) never appears anywhere in the results view.

---

## Workflow States

### Score Sheet Status

The same status lifecycle applies to both Concert Band MPA and SE/MPA score sheets.

| Status | Meaning |
|--------|---------|
| `draft` | Judge is actively working on the score sheet |
| `submitted` | Judge has completed and sent the score sheet for Chair review |
| `returned` | Chair has returned the score sheet to the judge with a visible flag (no justification text required; Chair handles explanation in person). Judge can fix ratings/comments and resubmit. |
| `verified` | Chair has validated the score sheet; it is now official |

**Key rules:**
- A judge sees a visible flag when their score sheet has been returned
- `returned` puts the score sheet back in `draft`-like state for the judge to correct and resubmit
- Once `verified`, behavior diverges by event type (see below)

### Concert Band MPA — Packet Status (Two Independent Dimensions)

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

### SE/MPA — Score Sheet Status and Release

SE/MPA has no packet concept. Each entry has exactly one score sheet from one judge. **Verification triggers immediate automatic release** — there is no separate release step and no packet assembly.

| Status | Visible to Director? |
|--------|---------------------|
| `draft` | No |
| `submitted` | No |
| `returned` | No |
| `verified` | Yes — released automatically |

The Chair can still return a verified SE/MPA score sheet if corrections are needed. Setting it back to `returned` immediately removes director visibility until it is re-verified.

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
| Declared Grade | Grade | Director's stated intent at registration (scheduling only) vs official grade derived from repertoire (used everywhere else) |
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
- **NAfME/NCMEA membership** — Tracked in the system via the director's NAfME profile (membership number, expiration date, visual confirmation). The volunteer verifies the physical card is present; the system confirms NAfME information is on file and marks the check as completed. See Director Onboarding and NAfME Membership sections above.
- **Instrumentation** — Part of the digital event entry form.
  The director enters fixed counts for: Flute, Oboe, Bassoon, Clarinet, Bass Clarinet, Alto Sax, Tenor Sax, Bari Sax, Trumpet, Horn, Trombone, Euphonium, Tuba, and Percussion, plus optional non-standard instrument rows chosen from a dropdown list. Each row has an instrument choice, quantity, and an `Other` path with a typed name.
- **Stage setup** — Part of the digital event entry form.
  The director first saves the seating chart for the ensemble, then places percussion equipment on a shared stage preview. The seating editor supports a `Wind Ensemble` view for the current wifi-style spread and a `Symphonic Band` view that carries the same chair spacing farther toward the podium for larger semicircle setups. The seating chart can also include a grouped timpani set rendered as four scaled circles so directors can place timpani directly on the chart and keep that placement between sessions. Requested site inventory items and local percussion items can both be positioned, rotated, resized, and saved so the layout persists until the director changes it.
- **Repertoire history** — Tracked automatically from historical event data. The 4-year non-repeat rule applies per **school**, not per ensemble — if any ensemble at a school performed a piece, no other ensemble at that school may perform it for 4 years.
- **Repertoire validation** — The system already has the registered repertoire from the event entry form for title matching.

---

## Open Questions

All core Q&A is complete. The glossary is ready for schema design.

Remaining items for future review:
- Director school attachment approval/detachment process (mentioned in Director workflow)
- Volunteer role details (deferred until core workflows are established)
- Performance requirements on Graded List pieces (display and enforcement rules)
