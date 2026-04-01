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

### 5. Fix stat card design system violations + apply Fraunces display font ✓
**What:** The new `admin-participation-stat` cards in `styles.css` use hardcoded `border-radius: 16px`, `background: rgba(8, 12, 22, 0.42)`, and `border: 1px solid rgba(116, 145, 216, 0.18)` instead of CSS variable tokens. Also: use `var(--font-display)` (Fraunces) for the large stat value to differentiate from generic dashboard output.

**Done:** Replaced all hardcoded values with CSS variables: `border-radius` → `var(--radius-md)`, `background` → `var(--panel)`, `border` → `var(--border)`. Applied `var(--font-display)` (Fraunces) to stat values for visual differentiation. Design system is now consistent across the admin panel.

**Commits:** Design system compliance restored.

---

### 6. Add loading state to Participation Summary panel ✓
**What:** When an active event exists but Firestore data is still fetching, the Participation Summary panel shows "Set an active event to begin." An operator reads this and thinks something is wrong. Show "Loading participation data..." as the interim state.

**Done:** Added `loading` parameter to `renderParticipationSummary()`. When active event exists but data is in flight, displays "Loading participation data..." with "Fetching registration and schedule data from Firestore." guidance. Updated `renderRegisteredEnsemblesList()` to call with `loading: true` during async Firestore fetch. Eliminates operator confusion during 2-4 second WiFi delays.

**Commits:** Loading state implemented and integrated.

---

### 7. Add explicit pre-release copy to Director Results Packet tab ✓
**What:** When a director opens "Results Packet" and no packet has been released, show: "Results are released after your packet is reviewed and approved by the event chair. Check back after your performance."

**Done:** Updated director empty state in `index.html` from generic "No results released yet." to explicit workflow guidance. Clear message eliminates director confusion on event day and reduces operator support load.

**Commits:** Director pre-release messaging added.

---

### 8. Reorder admin subnav to match operator workflow ✓
**What:** Current tab order: Dashboard | Registrations | Schedule & Flow | Review Queue | Packets & Results | Ratings | Announcer | Readiness | Settings. Proposed: Settings | Registrations | Schedule & Flow | Review Queue | Packets & Results | Ratings | Announcer | Readiness | Dashboard. (Settings first — it's needed before anything else. Dashboard last — it's a summary view.)

**Done:** Reordered tabs in `index.html`: Settings first (event creation, judge assignment), Dashboard last (summary view). Updated aria-selected flags accordingly. New operator workflow now matches left-to-right navigation.

**Commits:** Admin nav reordered to match workflow.

---

### 9. Reorder director workspace nav: Results Packet first ✓
**What:** Current: Registration | My Ensembles | Event Info | Site Info | Program | Results Packet. Proposed: Results Packet | Registration | My Ensembles | Event Info | Site Info | Program.

**Done:** Reordered tabs in both `directorWorkspaceNav` and `eventDetailDirectorNav` in `index.html`. Results Packet now first for post-performance result checking. Eliminates directors clicking through wrong tabs.

**Commits:** Director nav reordered to match post-performance goals.

---

### 10. Add mobile breakpoint to Participation Summary stats grid ✓
**What:** The stats grid uses `grid-template-columns: repeat(3, minmax(0, 1fr))` with no mobile breakpoint. At ≤480px, stack to single column using `grid-template-columns: 1fr`.

**Done:** Added media query in `styles.css` for ≤480px breakpoint. Stats grid now stacks to single column on phones/small tablets. Clean mobile layout for judges and directors using phones.

**Commits:** Mobile responsiveness added to stats grid.

---

### 11. Add aria-label to Participation Summary stat cards ✓
**What:** In `renderParticipationSummary()`, add `card.setAttribute('aria-label', \`${value} ${label}\`)` to each stat card. Screen reader will announce "8 Schools", "14 Ensembles", "342 Students" instead of bare numbers.

**Done:** Added aria-label attributes in `ui-admin-renderers.js` with pattern `${value} ${label}`. Screen readers now announce stat context. Accessibility improvement for district coordinators with accessibility needs.

**Commits:** Accessibility labels added to stat cards.

---

### 12. Create DESIGN.md documenting the existing design system ✓
**What:** Extract the CSS custom properties, typography choices, spacing tokens, color palette, radius system, button variants, and component patterns from `styles.css` into a `DESIGN.md` in the project root.

**Done:** Created comprehensive `DESIGN.md` (593 lines, 20KB) documenting: 39 CSS custom properties, typography, spacing scale, color palette, radius system, button variants, form styling, component patterns, responsive guidelines, and maintenance checklist. Prevents future design system drift and guides AI-assisted development.

**Commits:** Design system documentation created.

---


## Active (Phase B — Pending)

*Phase A (operator hardening) complete as of 2026-03-31.*

---

## Deferred (Phase B — Post-Operator Handoff)

- Multi-site Firestore architecture — one Firebase project vs. separate projects per district
- District-level event configuration via admin panel
- Operator permissions model (district admin vs. site admin vs. judge)
- Phase B entry gate: confirmed handoff of Phase A to non-developer operator
