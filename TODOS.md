# TODOS

Last updated: 2026-03-31

---

## Completed (2026-03-31)

### 1. Move test artifact + student count functions to utils.js and add unit tests ✓
**What:** Extract `isTestArtifactText`, `hasExplicitTestArtifactFlag`, `isProductionRegistration`, and `calculateInstrumentationStudentCount` from inside the `createAdminRenderers` closure in `ui-admin-renderers.js`. Move to `utils.js` and export them. Write unit tests.

**Done:** Moved all 4 functions to utils.js. Created `tests/unit/testArtifactDetection.test.js` with 48 comprehensive unit tests covering edge cases, regex patterns, and all code paths. All tests pass.

**Commits:** Functions refactored and tested.

---

### 2. Add test for `resolveProgramGrade` (grade field priority) ✓
**What:** Write a unit test in `tests/unit/` that asserts `resolveProgramGrade` prefers `performanceGrade` over `declaredGradeLevel`, and add a code comment explaining why.

**Done:** Exported `resolveProgramGrade` from admin-event-tools.js. Added detailed JSDoc comment explaining the domain rule: judges' performanceGrade is authoritative (overrides director's declaredGradeLevel). Created `tests/unit/resolveProgramGrade.test.js` with 11 unit tests. All tests pass.

**Commits:** Function exported with documentation and tests.

---

### 3. Add error state to `renderParticipationSummary` for Firestore fetch failure ✓
**What:** If the `entriesSnap` Firestore fetch fails, `renderParticipationSummary` currently shows 0s for all student counts with no indication of failure. Add an error state that clearly tells the operator "student counts unavailable" vs. "no instrumentation saved."

**Done:** Added `error` parameter to `renderParticipationSummary`. When error is present, displays "Student counts unavailable" with guidance to check connection and refresh. Added try/catch to `renderRegisteredEnsemblesList` to catch Firestore failures and pass them to the render function. Operator now sees clear error state vs. silent failure.

**Commits:** Error handling implemented and tested.

---

### 4. Remove redundant `|| document.getElementById(...)` fallbacks ✓
**What:** In `ui-admin-preevent.js` and `ui-admin-renderers.js`, the participation summary elements are looked up as `els.adminX || document.getElementById("adminX")`. The `els` object already has these cached from `state.js:500-503`. Remove the redundant fallbacks.

**Done:** Removed 7 redundant fallback patterns across both files. Updated all references to use direct `els` object access. Confirmed all elements are always available in `els` from state.js initialization. Code is now clearer without misleading fallback patterns.

**Commits:** Redundant fallbacks removed.

---

## Active (Phase A — Design Review 2026-03-31)

### 5. Fix stat card design system violations + apply Fraunces display font
**What:** The new `admin-participation-stat` cards in `styles.css` use hardcoded `border-radius: 16px`, `background: rgba(8, 12, 22, 0.42)`, and `border: 1px solid rgba(116, 145, 216, 0.18)` instead of CSS variable tokens. Also: use `var(--font-display)` (Fraunces) for the large stat value to differentiate from generic dashboard output.

**Why:** Design system drift. Every new component that doesn't use CSS vars makes the system harder to maintain. The fix is ~5 CSS lines.

**Pros:** System consistency, visual differentiation for stat values, prevents future drift.
**Cons:** Minimal — pure CSS change, no functional impact.
**Context:** Caught in design review. The rest of the app uses CSS vars consistently; this panel was the exception.
**Depends on:** Nothing.

---

### 6. Add loading state to Participation Summary panel
**What:** When an active event exists but Firestore data is still fetching, the Participation Summary panel shows "Set an active event to begin." An operator reads this and thinks something is wrong. Show "Loading participation data..." as the interim state.

**Why:** Event-day WiFi at schools is unreliable. 2-4 second loads happen. A stale "no event" message creates false negatives for the operator.

**Pros:** Correct operator feedback, reduces confusion during slow loads.
**Cons:** Requires knowing whether event is active but data is in flight. Small JS addition.
**Context:** Phase A goal is operator independence. False negatives during loading are operator load.
**Depends on:** Nothing.

---

### 7. Add explicit pre-release copy to Director Results Packet tab
**What:** When a director opens "Results Packet" and no packet has been released, show: "Results are released after your packet is reviewed and approved by the event chair. Check back after your performance."

**Why:** Directors on event day will navigate to Results Packet and see nothing. The current empty state is ambiguous. Clear copy eliminates support calls to the admin.

**Pros:** Reduces operator load during live event, eliminates director confusion.
**Cons:** Requires finding the director packets empty state and adding copy.
**Context:** Operator independence goal: the operator shouldn't need to answer "where are my results?" from every director.
**Depends on:** Nothing.

---

### 8. Reorder admin subnav to match operator workflow
**What:** Current tab order: Dashboard | Registrations | Schedule & Flow | Review Queue | Packets & Results | Ratings | Announcer | Readiness | Settings. Proposed: Settings | Registrations | Schedule & Flow | Review Queue | Packets & Results | Ratings | Announcer | Readiness | Dashboard. (Settings first — it's needed before anything else. Dashboard last — it's a summary view.)

**Why:** A new operator opens the app and goes left-to-right. Settings is where they create the event and assign judges. It's currently last. First-use experience is wrong.

**Pros:** Tab order matches actual workflow, better first-run experience.
**Cons:** Existing operators will have muscle memory. Low impact since there's only one operator currently.
**Context:** Phase A: "system can run without the developer present." A new operator should not need to be told "ignore Dashboard, go to Settings first."
**Depends on:** Nothing — HTML attribute order change only.

---

### 9. Reorder director workspace nav: Results Packet first
**What:** Current: Registration | My Ensembles | Event Info | Site Info | Program | Results Packet. Proposed: Results Packet | Registration | My Ensembles | Event Info | Site Info | Program.

**Why:** On event day, a director's primary goal after performing is to check their results. Results Packet is last. Directors will click through the wrong tabs first.

**Pros:** First-click success for directors checking results after performance.
**Cons:** Pre-event directors use Registration first. Both are valid orders for different moments.
**Context:** Phase A is operator hardening but director UX errors create operator load (questions and calls). This is a one-line HTML fix.
**Depends on:** Nothing.

---

### 10. Add mobile breakpoint to Participation Summary stats grid
**What:** The stats grid uses `grid-template-columns: repeat(3, minmax(0, 1fr))` with no mobile breakpoint. At ≤480px, stack to single column using `grid-template-columns: 1fr`.

**Why:** Admins use iPads (fine at 3 columns), directors and judges use phones (cramped at 3 columns).

**Pros:** Clean mobile layout.
**Cons:** None — 4 lines of CSS.
**Context:** Phase A hardening. Real events have operators with iPads + judges/directors with phones.
**Depends on:** Nothing.

---

### 11. Add aria-label to Participation Summary stat cards
**What:** In `renderParticipationSummary()`, add `card.setAttribute('aria-label', \`${value} ${label}\`)` to each stat card. Screen reader will announce "8 Schools", "14 Ensembles", "342 Students" instead of bare numbers.

**Why:** Screen readers announce "8" with no context. District coordinators may have accessibility needs.

**Pros:** Accessibility without visual change.
**Cons:** None.
**Context:** Low-cost fix during Phase A — cheaper to add now than retrofit later.
**Depends on:** Todo #5 (stat card refactor is a good time to add this).

---

### 12. Create DESIGN.md documenting the existing design system
**What:** Extract the CSS custom properties, typography choices, spacing tokens, color palette, radius system, button variants, and component patterns from `styles.css` into a `DESIGN.md` in the project root.

**Why:** No DESIGN.md means every new component re-infers the system from existing code. That's how `border-radius: 16px` appears instead of `var(--radius-sm)`.

**Pros:** Prevents future drift, makes AI-assisted development more consistent.
**Cons:** Maintenance burden if CSS changes without updating DESIGN.md.
**Context:** Design review surfaced 3 CSS var violations in one new component. This will keep happening.
**Depends on:** Nothing.

---

## Deferred (Phase B)

- Multi-site Firestore architecture — one Firebase project vs. separate projects per district
- District-level event configuration via admin panel
- Operator permissions model (district admin vs. site admin vs. judge)
- Phase B entry gate: confirmed handoff of Phase A to non-developer operator
