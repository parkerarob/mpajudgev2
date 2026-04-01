# Supabase Migration Plan

Historical note: this file remains in `MPAJudgeV2` as a snapshot copy after the March 22, 2026 repo split. The authoritative active version now lives in `/Users/parkerarob/Documents/Workspaces/Desktop-Projects/NCBA-MPA-Event-Management-App/docs/Supabase-Migration-Plan.md`.

Date: 2026-03-21

Purpose: translate `docs/Schema-Design.md` into ordered, reviewable Supabase SQL migrations without losing domain rules, atomic release behavior, or role boundaries.

## Working Rule

`docs/Schema-Design.md` is the domain-model source. This file is the implementation source for how that design becomes PostgreSQL objects, trigger functions, and RLS.

`docs/Domain-Language.md` is the canonical source for human-facing language, workflow meaning, and domain distinctions. It governs UI labels, user-facing copy, and documentation language.

Technical identifiers do not need to mirror glossary formatting exactly. Database values, enum labels, function names, and column names should be chosen for long-term system clarity, consistency, and maintainability. When a technical identifier differs from glossary presentation, the mapping must be documented explicitly so drift does not emerge silently.

## Naming Decision Rule

Use the glossary as truth for what concepts mean and how they are described to humans:

- `grade` = music difficulty classification
- `caption rating` = A-F on one caption
- `caption score total` = numeric sum for one score sheet
- `final judge rating` = I-V derived from one score sheet
- `final overall rating` = I-V or `CO` for the packet
- `score sheet` != `results packet`
- `verified` != `released`

For internal implementation:

- prefer snake_case in SQL
- prefer stable, closed enums for business-critical value sets
- prefer one canonical database value per concept
- document UI/display wording separately from storage identifiers when they differ

Known naming decisions to document before `0001_extensions_and_types.sql`:

- judge position:
  glossary uses `sightReading`
  database candidate: `sight_reading`
- form type:
  glossary uses `stageForm`, `sightReadingForm`
  database candidate: `stage_form`, `sight_reading_form`

Recommendation: keep database enum values in snake_case and add a dedicated naming-decision section to `Schema-Design.md` so glossary terms and storage identifiers are intentionally mapped rather than assumed.

## Rebuild Lane Structure

Use this layout in the repo:

- `supabase/migrations/`
  Ordered SQL migrations.
- `supabase/seeds/`
  Deterministic seed data for districts, instrument families, instruments, and initial graded list versions.
- `supabase/tests/`
  SQL or integration tests for trigger logic, RLS, and packet-release invariants.
- `supabase/README.md`
  Conventions for migration naming, local execution, and seeding.

## Migration Strategy

Do not write one giant schema file. Split the work into dependency-ordered migrations so each unit can be reviewed and tested independently.

### Phase A: Foundations

1. `0001_extensions_and_types.sql`
   Create required extensions and all shared enum-like domains or constrained types.
   Candidate categories:
   - event status
   - judge position
   - score sheet status
   - packet assembly status
   - packet release status
   - overall/final judge ratings
   - letter ratings and modifiers
   - repertoire slot
   - schedule slot type
   - lunch pickup timing
   - fee/payment types

2. `0002_base_functions.sql`
   Create reusable SQL helpers that do not depend on later application tables:
   - `set_updated_at()`
   - `current_user_id()`
   - actor-resolution helper for audit logging
   - auth/user sync helpers

3. `0003_users_and_identity.sql`
   Create `public.users` and auth-sync trigger/function from `auth.users`.

### Phase B: Reference Data

4. `0010_organizations.sql`
   `districts`, `schools`, `director_schools`

5. `0011_graded_list.sql`
   `graded_list_versions`, `pieces`, `marches`

6. `0012_sites_and_instruments.sql`
   `sites`, `instrument_families`, `instruments`, `site_percussion_inventory`

### Phase C: Event Core

7. `0020_events_and_roles.sql`
   `events`, `event_chairs`, `judge_assignments`, `event_volunteers`, `event_day_start_times`

8. `0021_ensembles_and_entries.sql`
   `ensembles`, `event_entries`

9. `0022_repertoire_and_registration_details.sql`
   `repertoire`, `instrumentation`, `event_entry_percussion_requests`, `event_entry_seating`, `event_lunch_items`, `event_entry_lunch_orders`, `event_fees`, `event_entry_fees`

10. `0023_shared_players_and_history.sql`
   `shared_players` or normalized replacement, plus `school_repertoire_history`

11. `0024_scheduling.sql`
   `schedule_slots`

12. `0025_access_helper_functions.sql`
   Create membership helpers after the required tables exist:
   - `is_admin()`
   - `is_event_chair(event_id uuid)`
   - `is_event_judge(event_id uuid)`
   - `is_director_for_school(school_id uuid)`

### Phase D: Adjudication Core

13. `0030_score_sheets.sql`
   `score_sheets`, `caption_ratings`

14. `0031_audio.sql`
   `tape_segments`, `canonical_tapes`

15. `0032_packets_and_audit.sql`
   `packets`, `audit_log`

### Phase E: Computed Logic

16. `0040_score_computation_functions.sql`
   Functions for:
   - letter rating -> numeric value
   - caption total -> final judge rating
   - split-rating detection

17. `0041_repertoire_grade_functions.sql`
   Functions for:
   - event entry grade derivation from repertoire
   - comments-only and no-sight requirements

18. `0042_packet_computation_functions.sql`
   Functions for:
   - packet assembly status
   - overall rating calculation
   - required score sheet / tape counts by entry grade and mode

19. `0043_audit_functions.sql`
   Trigger functions to write audit rows for key transitions.

20. `0044_triggers.sql`
   Register all triggers only after their tables and functions exist.

### Phase F: Security

21. `0050_rls_enable.sql`
   Enable RLS on all application tables.

22. `0051_rls_reference_data.sql`
   Policies for read-mostly reference tables.

23. `0052_rls_director_workflows.sql`
   Policies for director-managed entities.

24. `0053_rls_judge_workflows.sql`
   Policies for judge-owned score sheets, captions, and tapes.

25. `0054_rls_chair_admin_workflows.sql`
   Policies for chair and admin event operations.

### Phase G: RPC and Storage

26. `0060_release_rpc.sql`
   Security-definer RPCs for:
   - release packet
   - unrelease packet
   - optional verify/return transitions if those must remain atomic

27. `0061_storage_policies.sql`
   Storage bucket setup and policies for tapes, rendered PDFs, and other artifacts.

## SQL-Level Decisions To Lock Before Writing Migrations

These are the main places where the schema prose is not yet specific enough for safe migration authoring.

1. Use PostgreSQL enums or `text + check` consistently.
   The schema uses many constrained text columns. The migration set should pick one pattern and keep it uniform. My recommendation: use enums for tightly closed value sets that drive business logic.

   Before creating enums, publish the canonical database value set and its human-facing glossary mapping.

2. Normalize `shared_players`.
   `ensemble_ids uuid[]` in the schema is not good relational shape for constraints or joins. Use:
   - `shared_players`
   - `shared_player_entries(shared_player_id, event_entry_id)`

3. `event_chairs` and `event_volunteers` allow one user to hold multiple roles in the same event.
   Use composite primary keys `(event_id, user_id, role)` so role multiplicity is explicit and non-duplicative.

4. Add `unique (event_id, user_id)` to `judge_assignments` if one judge must have exactly one position per event.
   The prose says judges are assigned to exactly one position per event. The current schema only guarantees one judge per position.

5. Strengthen `repertoire` checks by `piece_slot`.
   The current XOR constraint is not enough. SQL should also enforce:
   - `piece_slot = 'march'` => `march_id is not null` and `piece_id is null`
   - `piece_slot in ('selection_1','selection_2')` => `piece_id is not null` and `march_id is null`

6. Decide whether grade derivation lives in triggers only or also in a stored function called by app code and RPCs.
   My recommendation: single SQL function used by both trigger and tests.

7. Decide how `packets` rows are created.
   Best option: create the packet automatically when `event_entries` is inserted, so packet existence is guaranteed.

8. Decide how audit triggers learn the actor.
   Trigger code needs a stable source for `performed_by`. The usual approach is:
   - authenticated requests: `auth.uid()`
   - privileged server jobs/RPCs: set `request.jwt.claim.sub` or a custom config value before mutation

9. Decide whether the release flow is trigger-driven or RPC-driven.
   Release/unrelease should be RPC-driven inside a transaction. Triggers should compute derived state, not own the user-intent workflow.

10. Clarify comments-only and sight-reading constraints on `event_entries`.
   The schema says `sight_reading_opted_out` is only relevant when `comments_only = true`, but SQL should express the allowed combinations explicitly.

11. Add event-consistency constraints that the prose implies but tables alone do not guarantee.
   Example: a `score_sheet` must pair an `event_entry` with a `judge_assignment` from the same event. This needs a trigger or composite foreign-key strategy.

12. Decide whether `users.email` is immutable cache or sync-on-change.
   Recommendation: sync from `auth.users` on insert and email update.

## Constraints That Should Be SQL, Not App-Only

Keep the app thin where the database can enforce the rule safely.

- one score sheet per `(event_entry_id, judge_assignment_id)`
- one packet per `event_entry_id`
- one entry per `(event_id, ensemble_id)`
- one judge position per event
- exactly one active graded-list version
- `pieces.is_masterwork` only on Grade VI
- comments-only / sight-reading valid combinations
- positive-count checks on seating, lunch quantity, fees, durations, and member counts
- slot type checks on `schedule_slots`

## Constraints That Need Trigger or RPC Enforcement

These are cross-row or cross-table rules and should not be left to the client.

- packet assembly completeness
- final judge rating derivation
- overall packet rating derivation
- split-rating flag
- event entry grade derivation from repertoire
- release/unrelease transaction
- judge/event consistency on score sheets
- max 5 shared players per instrument across a school's ensembles at an event

## RLS Implementation Pattern

Do not write policies with repeated inline join logic everywhere. Create helper functions first, then keep policies readable.

Recommended role interpretation:

- Admin: `public.users.is_admin = true`
- Chair: membership in `event_chairs`
- Judge: membership in `judge_assignments`
- Director: school access via `director_schools`

Recommended policy style:

- `FOR SELECT`, `FOR INSERT`, `FOR UPDATE`, `FOR DELETE` explicitly separated
- use `USING` for visibility
- use `WITH CHECK` for ownership/membership on writes
- no broad “authenticated can read” shortcuts

## Seed Data Plan

Create deterministic seed files for:

- districts
- instrument families
- instruments
- initial graded list version row

Later seed files can load:

- pieces from the official graded list
- marches reference data
- sites

## Suggested Immediate Build Order

1. Scaffold `supabase/` directories and README.
2. Write `0001_extensions_and_types.sql`.
3. Write `0002_base_functions.sql`.
4. Write `0003_users_and_identity.sql`.
5. Convert organizations/reference tables next.
6. Add access-helper functions after the relevant event/school tables exist.
7. Pause and review before adjudication tables, triggers, and RLS.

This keeps the early migration work low-risk while locking naming and helper conventions before the more sensitive packet logic.
