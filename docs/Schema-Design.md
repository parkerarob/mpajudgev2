# PostgreSQL Schema Design

Status: DRAFT — v1, 2026-03-21

All terminology follows `docs/Domain-Language.md`. Column names use snake_case. UUIDs are used for all primary keys.

---

## Table of Contents

1. [Core Identity](#core-identity)
2. [Organizations](#organizations)
3. [Graded List](#graded-list)
4. [Events](#events)
5. [People and Roles](#people-and-roles)
6. [Ensembles and Event Entries](#ensembles-and-event-entries)
7. [Instrumentation Reference](#instrumentation-reference)
8. [Repertoire History](#repertoire-history)
9. [Scheduling](#scheduling)
10. [Score Sheets and Captions](#score-sheets-and-captions)
11. [Audio](#audio)
12. [Packets](#packets)
11. [Audit](#audit)
12. [Computed Values and Triggers](#computed-values-and-triggers)
13. [RLS Policy Summary](#rls-policy-summary)
14. [Open Design Questions](#open-design-questions)

---

## Core Identity

### `users`
Extends Supabase `auth.users`. One row per person.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | References `auth.users.id` |
| display_name | text | Full name |
| email | text | Synced from auth |
| is_admin | boolean | Global admin flag. Default false. |
| created_at | timestamptz | |

Role is contextual (per event), not stored on this table. One person can be a director, judge, or chair across different events.

---

## Organizations

### `districts`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text | e.g., "Eastern" |
| slug | text UNIQUE | e.g., "eastern" |

Seven rows: Northwest, Western, South Central, Central, East Central, Southeast, Eastern.

### `schools`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text | |
| district_id | uuid FK districts | |

### `director_schools`
Many-to-many: a director can have ensembles at multiple schools; a school can have multiple directors.

| Column | Type | Notes |
|--------|------|-------|
| director_id | uuid FK users | |
| school_id | uuid FK schools | |
| PRIMARY KEY | (director_id, school_id) | |

---

## Graded List

### `graded_list_versions`
The Graded List is updated annually. Each event is pinned to a specific version.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| label | text | e.g., "2025-2026" |
| published_date | date | |
| is_current | boolean | Only one row true at a time |

### `pieces`
Approved NCBA selections (Grade I–VI). One row per piece per list version.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| graded_list_version_id | uuid FK graded_list_versions | |
| grade | text | I, II, III, IV, V, VI |
| title | text | |
| composer | text | |
| publisher | text | |
| distributor | text | |
| special_instructions | text | Movement requirements, restrictions |
| is_masterwork | boolean | True = MW* on Grade VI list |
| status | text | active \| archive \| pop \| pod \| moved |
| supplier_item_no | text | |
| year_added | text | |
| tags | text[] | e.g., ["NC Composer", "Underrepresented"] |

**CONSTRAINT:** `grade = 'VI' OR is_masterwork = false` — only Grade VI pieces can be Masterwork.

### `marches`
Director's choice march. Not from the Graded List. Directors can add new entries.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| title | text | |
| composer | text | |
| is_user_submitted | boolean | True = added by a director (vs pre-loaded) |
| submitted_by | uuid FK users | Null if pre-loaded |
| created_at | timestamptz | |

---

## Events

### `sites`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text | e.g., "Minnie Evans Arts Center at Ashley High School" |
| address | text | |
| city | text | |
| state | text | Default "NC" |

### `events`
One event = one site, one date (or range of dates for multi-day events).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| district_id | uuid FK districts | |
| site_id | uuid FK sites | |
| graded_list_version_id | uuid FK graded_list_versions | Locked at event creation |
| name | text | e.g., "Eastern District South Site MPA" |
| season_year | text | e.g., "2025-2026" |
| start_date | date | |
| end_date | date | Null if single day |
| schedule_start_time | time | First performance slot start time |
| status | text | setup \| active \| completed |
| created_at | timestamptz | |

**Note on Graded List version:** When creating an event, the system prompts the Chair to confirm the Graded List version that applies. This is stored on the event and does not change. Repertoire validation uses the event's pinned version.

### `event_chairs`
Chair role is per-event. Two sub-roles exist (from NCBA practice): the primary MPA Chair and the Site Chair (who may be a different person at a split site).

| Column | Type | Notes |
|--------|------|-------|
| event_id | uuid FK events | |
| user_id | uuid FK users | |
| role | text | chair \| site_chair |
| PRIMARY KEY | (event_id, user_id) | |

---

## People and Roles

### `judge_assignments`
A judge is assigned to an event with a specific position. Same 4 judges for every ensemble — judges do not rotate.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| event_id | uuid FK events | |
| user_id | uuid FK users | |
| position | text | stage1 \| stage2 \| stage3 \| sight_reading |
| UNIQUE | (event_id, position) | One judge per position per event |

`form_type` is derived from position: `stage1/2/3` → `stage_form`, `sight_reading` → `sight_reading_form`.

### `event_volunteers`
Volunteer roles that interact with the system. Full volunteer role design is deferred.

| Column | Type | Notes |
|--------|------|-------|
| event_id | uuid FK events | |
| user_id | uuid FK users | |
| role | text | check_in \| stage_crew \| announcer |
| PRIMARY KEY | (event_id, user_id) | |

---

## Ensembles and Event Entries

### `ensembles`
A persistent performing group at a school. Exists independently of any event.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| school_id | uuid FK schools | |
| name | text | e.g., "Wind Ensemble", "Symphonic Band" |
| created_at | timestamptz | |

### `event_entries`
An ensemble's participation in a specific event. Created when the director registers.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| event_id | uuid FK events | |
| ensemble_id | uuid FK ensembles | |
| registered_by | uuid FK users | Director who registered |
| grade | text | Cached from repertoire. I, I/II, II, II/III, III, III/IV, IV, IV/V, V, V/VI, VI |
| comments_only | boolean | Default false |
| sight_reading_opted_out | boolean | Only relevant when comments_only = true |
| total_members | integer | Total number of performers |
| checkin_completed | boolean | Volunteer confirms physical conductor scores verified |
| checkin_completed_by | uuid FK users | |
| checkin_completed_at | timestamptz | |
| UNIQUE | (event_id, ensemble_id) | One entry per ensemble per event |

**Grade caching:** `grade` is computed from `repertoire` and stored here for fast access. Updated automatically when repertoire is saved.

**Duplicate personnel rule:** When a school registers multiple ensembles at the same event, the system enforces max 5 shared players per instrument across those ensembles.

### `repertoire`
3 pieces per event entry: 1 march + up to 2 graded selections. Selection #2 is nullable (Masterwork-only programs).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| event_entry_id | uuid FK event_entries | |
| piece_slot | text | march \| selection_1 \| selection_2 |
| march_id | uuid FK marches | Set when piece_slot = 'march' |
| piece_id | uuid FK pieces | Set when piece_slot = 'selection_1' or 'selection_2' |
| UNIQUE | (event_entry_id, piece_slot) | |
| CHECK | (march_id IS NOT NULL) != (piece_id IS NOT NULL) | Exactly one must be set |

**Grade derivation rules (enforced at application layer):**
- `selection_1.piece.grade == selection_2.piece.grade` → grade is that single value
- `selection_1` and `selection_2` from adjacent grades → split grade (e.g., III/IV)
- Non-adjacent selections are invalid
- `selection_1.is_masterwork = true` → `selection_2` is optional

### `instrumentation`
Exact instrument counts per event entry. References the standard instrument list where possible; non-standard instruments use the free-text path.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| event_entry_id | uuid FK event_entries | |
| instrument_id | uuid FK instruments NULLABLE | Set for standard instruments |
| custom_instrument_name | text NULLABLE | Set for non-standard / "Other" |
| player_count | integer | |
| notes | text NULLABLE | Free-text notes for this instrument entry |
| CHECK | (instrument_id IS NOT NULL) != (custom_instrument_name IS NOT NULL) | Exactly one must be set |
| UNIQUE | (event_entry_id, instrument_id) | Prevents duplicate standard entries |

---

## Instrumentation Reference

### `instrument_families`
Groups instruments for display organization.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text | e.g., "Woodwinds", "Brass", "Percussion - Keyboard", "Percussion - Battery" |
| display_order | integer | |

### `instruments`
Pre-defined standard instrument list. Based on the current system's instrument list, expanded with percussion.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| family_id | uuid FK instrument_families | |
| name | text | Canonical name |
| display_order | integer | Order within family |
| is_active | boolean | Soft-delete for deprecated instruments |

**Pre-loaded standard instruments:**

*Woodwinds:* Flute, Oboe, Bassoon, Clarinet in Bb, Bass Clarinet, Alto Saxophone, Tenor Saxophone, Baritone Saxophone

*Brass:* Trumpet, Horn in F, Trombone, Euphonium, Tuba

*Percussion — Keyboard/Mallet:* Marimba, Vibraphone, Xylophone, Glockenspiel/Bells, Chimes, Crotales, Concert Grand Piano

*Percussion — Battery:* Timpani, Concert Bass Drum, Concert Toms, Snare Drum, Crash Cymbals, Suspended Cymbal, Tam-tam/Gong

*Other:* Directors use the `custom_instrument_name` field on `instrumentation` for non-standard instruments (e.g., harp, contrabassoon, piccolo, string bass).

### `site_percussion_inventory`
Site-provided percussion equipment available for ensembles to request. Site-specific — what Ashley HS provides is not what every site provides.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| site_id | uuid FK sites | |
| item_name | text | e.g., "Marimba (Adams) 4 1/3 Octave" |
| display_order | integer | |
| notes | text | e.g., "Directors must provide their own sticks and mallets" |

### `event_entry_percussion_requests`
Which site percussion items an ensemble is requesting to use.

| Column | Type | Notes |
|--------|------|-------|
| event_entry_id | uuid FK event_entries | |
| inventory_item_id | uuid FK site_percussion_inventory | |
| notes | text NULLABLE | Special requests or notes |
| PRIMARY KEY | (event_entry_id, inventory_item_id) | |

---

## Repertoire History

**Rule (per NCBA Policies 7.d):** A piece performed at MPA cannot be performed again by any ensemble at the same **school** for 4 years. This is a school-level restriction, not an ensemble-level restriction.

*Example: If Ashley HS Wind Ensemble performs "Vesuvius" in 2026, no ensemble at Ashley HS (Wind Ensemble, Symphonic Band, Concert Band, etc.) may perform "Vesuvius" again until 2030.*

The system enforces this during event entry repertoire selection by checking past event entries for any ensemble at the same school.

### `school_repertoire_history`
Pre-system historical repertoire records. Once entered, these are permanent and pre-populate for the school's ensembles going forward. Uses the same Graded List piece reference where the piece exists in the system, or free-text for older/unlisted pieces.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| school_id | uuid FK schools | History is per school, not per ensemble |
| season_year | text | e.g., "2024-2025" |
| piece_id | uuid FK pieces NULLABLE | Set if piece is on the Graded List |
| piece_title | text | Always stored for display (even if piece_id is set) |
| piece_composer | text | |
| piece_grade | text NULLABLE | Grade at time of performance |
| entered_by | uuid FK users | Director who entered the history |
| created_at | timestamptz | |

**Note:** Active-season repertoire is tracked automatically from `event_entries` + `repertoire` tables — no separate record needed. The 4-year window is enforced by querying both `school_repertoire_history` (for pre-system history) and live `repertoire` records (for system-era events), filtering by school across all ensembles.

---

## Scheduling

The Chair orders ensembles and sets the first performance time. The system computes all subsequent start times based on grade-based time limits and inserted breaks.

**Performance time limits by grade (staging + performance):**
- Grade I, II: 25 min
- Grade III, IV: 30 min
- Grade V: 35 min
- Grade VI: 40 min

### `schedule_slots`
Ordered list of performance slots and breaks for an event.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| event_id | uuid FK events | |
| day | date | The calendar date this slot falls on. Most events are multi-day. |
| slot_order | integer | Order within the day |
| slot_type | text | performance \| break |
| event_entry_id | uuid FK event_entries NULLABLE | Null if break |
| break_duration_minutes | integer NULLABLE | Null if performance |
| UNIQUE | (event_id, day, slot_order) | |
| CHECK | slot_type = 'performance' implies event_entry_id IS NOT NULL | |
| CHECK | slot_type = 'break' implies break_duration_minutes IS NOT NULL | |

**Computed start times:** `event.schedule_start_time` is the anchor for the first slot of each day. Each slot's start time = day anchor + sum of all preceding slot durations for that day. Performance duration is determined by the entry's grade. This is computed in the application layer, not stored.

The Chair sets the start time per day (stored on `event.schedule_start_time` for day 1; additional day start times are stored on the first slot of each day as an override, or via a separate `event_day_start_times` record — see Open Design Questions).

---

## Score Sheets and Captions

### `score_sheets`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| event_entry_id | uuid FK event_entries | |
| judge_assignment_id | uuid FK judge_assignments | |
| status | text | draft \| submitted \| returned \| verified |
| caption_score_total | integer | Sum of 7 numeric caption values. Computed, stored. |
| final_judge_rating | text | I \| II \| III \| IV \| V. Derived from caption_score_total. |
| submitted_at | timestamptz | |
| returned_at | timestamptz | |
| verified_at | timestamptz | |
| verified_by | uuid FK users | Chair who verified |
| created_at | timestamptz | |
| UNIQUE | (event_entry_id, judge_assignment_id) | One score sheet per judge per ensemble |

**Split rating flag:** When a packet has all 3 stage score sheets verified, the system checks if the spread between the highest and lowest Final Judge Rating is ≥ 2. If so, the packet is flagged for Chair review before release.

### `caption_ratings`
7 rows per score sheet. Canonical order is enforced by `caption_order`.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| score_sheet_id | uuid FK score_sheets | |
| caption_order | integer | 1–7, enforces canonical display order |
| caption_name | text | Canonical name from Domain-Language.md |
| rating | text | A \| B \| C \| D \| F |
| modifier | text | plus \| none \| minus (display only, no numeric effect) |
| numeric_value | integer | 1–5. Stored for performance. Derived from rating. |
| comment | text | Judge's written feedback for this caption |
| UNIQUE | (score_sheet_id, caption_order) | |

**Stage form canonical captions (caption_order 1–7):**
1. Tone Quality, 2. Intonation, 3. Balance/Blend, 4. Precision, 5. Basic Musicianship, 6. Interpretive Musicianship, 7. General Factors

**Sight-reading form canonical captions (caption_order 1–7):**
1. Tone Quality, 2. Intonation, 3. Balance, 4. Technique, 5. Rhythm, 6. Musicianship, 7. Utilization of Preparatory Time

---

## Audio

### `tape_segments`
One or more continuous audio recordings per score sheet.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| score_sheet_id | uuid FK score_sheets | |
| segment_order | integer | Determines stitch order |
| storage_path | text | Supabase Storage path |
| duration_seconds | integer | |
| created_at | timestamptz | |

### `canonical_tapes`
The single official audio artifact per judge per ensemble. One row per score sheet.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| score_sheet_id | uuid FK score_sheets UNIQUE | |
| storage_path | text | Supabase Storage path |
| duration_seconds | integer | |
| is_stitched | boolean | False = single segment pointer. True = FFmpeg-stitched result. |
| created_at | timestamptz | |

---

## Packets

### `packets`
One per event entry. Assembly status is computed by trigger.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| event_entry_id | uuid FK event_entries UNIQUE | |
| assembly_status | text | incomplete \| complete. Computed by trigger on score_sheet status changes. |
| has_split_rating_flag | boolean | True if stage ratings have ≥ 2 point spread. Computed. |
| release_status | text | unreleased \| released. Manually set by Chair. |
| overall_rating | text | I \| II \| III \| IV \| V \| CO. Computed when assembly_status = complete. |
| released_at | timestamptz | |
| released_by | uuid FK users | |

**Assembly complete when:** all required score sheets are `verified` AND all canonical tapes are present.
- Grade I or I/II: 3 stage score sheets + 3 canonical tapes
- All other grades: 3 stage + 1 sight-reading score sheets + 4 canonical tapes

**Overall rating computation** (see Domain-Language.md for full rules):
- Comments only → `CO`
- Grade I / I/II → 3-judge lookup table (with sum-based fallback for unlisted combinations)
- Grade II–VI and Masterworks → 4-judge sum lookup, with Unanimous Stage Rule override

---

## Audit

### `audit_log`
Automatic record of key state changes. Written by database triggers — cannot be bypassed.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| table_name | text | |
| record_id | uuid | |
| action | text | created \| submitted \| returned \| verified \| released \| unreleased \| etc. |
| performed_by | uuid FK users | |
| old_value | jsonb | Previous state snapshot |
| new_value | jsonb | New state snapshot |
| created_at | timestamptz | |

---

## Computed Values and Triggers

| Trigger | When | What it does |
|---------|------|-------------|
| `update_caption_score_total` | After INSERT/UPDATE on `caption_ratings` | Recomputes `score_sheets.caption_score_total` and `final_judge_rating` |
| `update_packet_assembly_status` | After UPDATE on `score_sheets.status` or INSERT on `canonical_tapes` | Recomputes `packets.assembly_status`, `overall_rating`, and `has_split_rating_flag` |
| `update_entry_grade` | After INSERT/UPDATE/DELETE on `repertoire` | Recomputes `event_entries.grade` |
| `write_audit_log` | After key state transitions | Inserts row into `audit_log` |

---

## RLS Policy Summary

| Table | Director | Judge | Chair | Admin |
|-------|----------|-------|-------|-------|
| `districts`, `schools` | SELECT | SELECT | SELECT | ALL |
| `ensembles` | SELECT own school; INSERT/UPDATE own | SELECT | SELECT | ALL |
| `director_schools` | SELECT/INSERT own | — | SELECT | ALL |
| `events` | SELECT | SELECT | SELECT/UPDATE own | ALL |
| `event_entries` | SELECT/INSERT/UPDATE own | SELECT | ALL for event | ALL |
| `repertoire`, `instrumentation` | SELECT/INSERT/UPDATE own entry | SELECT | ALL for event | ALL |
| `judge_assignments` | — | SELECT own | SELECT/INSERT for event | ALL |
| `score_sheets` | SELECT if packet released | SELECT/INSERT/UPDATE own | ALL for event | ALL |
| `caption_ratings` | SELECT if packet released | SELECT/INSERT/UPDATE own sheet | ALL for event | ALL |
| `tape_segments` | — | SELECT/INSERT own sheet | SELECT for event | ALL |
| `canonical_tapes` | SELECT if packet released | SELECT own sheet | SELECT for event | ALL |
| `packets` | SELECT if released | — | ALL for event | ALL |
| `audit_log` | — | — | SELECT for event | ALL |
| `pieces`, `marches`, `graded_list_versions` | SELECT | SELECT | SELECT | ALL |

---

## Event Day Start Times

Multi-day events have a separate start time per day.

### `event_day_start_times`

| Column | Type | Notes |
|--------|------|-------|
| event_id | uuid FK events | |
| day | date | Calendar date |
| start_time | time | First performance slot start for this day |
| PRIMARY KEY | (event_id, day) | |

Computed slot start times use the `start_time` from this table as the anchor for each day, then add the cumulative durations of preceding slots within that day.

---

## Site-Specific Event Entry Fields

Site-specific operational data (lunch orders, seating setup) is stored in typed tables, matching the approach of the current system. These fields are defined per event (the Chair configures what fields are relevant for the site) and filled in by the director during event entry.

### `event_entry_seating`
Chair and stand counts by row. Directors enter this to communicate stage setup needs.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| event_entry_id | uuid FK event_entries | |
| row_number | integer | 1–N |
| chairs | integer | |
| stands | integer | |

### `event_entry_lunch_orders`
Lunch order details. Specific items are configured per event by the Chair (what food is available varies by site).

### `event_lunch_items`
The food items available for a given event, configured by the Chair.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| event_id | uuid FK events | |
| item_name | text | e.g., "Pepperoni Pizza", "Cheese Pizza" |
| display_order | integer | |

### `event_entry_lunch_orders`
Director's lunch order for their ensemble.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| event_entry_id | uuid FK event_entries | |
| lunch_item_id | uuid FK event_lunch_items | |
| quantity | integer | |
| pickup_timing | text | before_performance \| after_performance |

---

## Shared Players (Rule 3C)

When a school enters more than one ensemble, directors must declare students who perform in multiple ensembles on the same instrument. Max 5 shared players per instrument across ensembles at the same event.

### `shared_players`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| event_id | uuid FK events | |
| school_id | uuid FK schools | |
| student_identifier | text | Name or ID — not linked to a user account |
| instrument_id | uuid FK instruments NULLABLE | Standard instrument |
| custom_instrument_name | text NULLABLE | Non-standard instrument |
| ensemble_ids | uuid[] | The event_entry IDs this student appears in |
| notes | text NULLABLE | |

The system validates that no instrument has more than 5 shared players across the school's ensembles at an event.

---

## Registration Fees

Fees are configurable per event. Districts set their own fee amounts.

### `event_fees`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| event_id | uuid FK events | |
| fee_type | text | per_ensemble \| comments_only \| waiver |
| amount_cents | integer | Stored in cents to avoid float precision issues |
| description | text | e.g., "Ensemble registration fee" |

### `event_entry_fees`
Tracks the fee status for each event entry.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| event_entry_id | uuid FK event_entries | |
| event_fee_id | uuid FK event_fees | Which fee type applies |
| is_waived | boolean | Fee waiver granted |
| waiver_reason | text NULLABLE | |
| payment_status | text | pending \| paid \| waived |
| notes | text NULLABLE | |

---

## Open Design Questions

No open questions remaining. Schema is ready for SQL implementation.
