/**
 * Regression tests for createAdminPreEventController.
 * Specifically guards against the P0 bug where safe mode rendered undefined
 * variable references (participationSummaryHint etc.) instead of els.adminParticipationSummaryHint.
 *
 * Run with: npx vitest run tests/unit/adminPreEventController.test.js
 */
import { describe, it, expect } from "vitest";
import { createAdminPreEventController } from "../../public/modules/ui-admin-preevent.js";

function makeMockEls(overrides = {}) {
  return {
    adminViewEvents: { classList: { contains: () => false, toggle: () => {}, add: () => {} } },
    preEventFlowPanel: { classList: { add: () => {} } },
    adminRegisteredEnsemblesSection: { classList: { toggle: () => {} } },
    adminParticipationSummarySection: { classList: { toggle: () => {} } },
    adminScheduleSection: { classList: { toggle: () => {} } },
    adminPizzaTotalsSection: { classList: { toggle: () => {} } },
    adminPizzaBySchoolSection: { classList: { toggle: () => {} } },
    adminSchoolDetailSection: { classList: { toggle: () => {} } },
    adminRegisteredEnsemblesList: { innerHTML: "" },
    adminParticipationSummaryHint: { textContent: "" },
    adminParticipationSummaryStats: { innerHTML: "" },
    adminParticipationSummaryBody: { innerHTML: "" },
    adminPizzaTotalsHint: { textContent: "" },
    adminPizzaBySchoolHint: { textContent: "" },
    ...overrides,
  };
}

describe("createAdminPreEventController safe mode (regression: P0 ReferenceError fix)", () => {
  it("does not throw when safe mode is active (heavyLoaded = false)", () => {
    const els = makeMockEls();
    const controller = createAdminPreEventController({
      els,
      renderAdminSchoolDetail: () => {},
      renderRegisteredEnsemblesList: () => {},
      renderAdminPizzaTotals: () => {},
    });
    expect(() => controller.render({ showSchoolDetail: false, heavyLoaded: false })).not.toThrow();
  });

  it("writes safe mode copy to els.adminParticipationSummaryHint", () => {
    const els = makeMockEls();
    const controller = createAdminPreEventController({
      els,
      renderAdminSchoolDetail: () => {},
      renderRegisteredEnsemblesList: () => {},
      renderAdminPizzaTotals: () => {},
    });
    controller.render({ showSchoolDetail: false, heavyLoaded: false });
    expect(els.adminParticipationSummaryHint.textContent).toBe(
      "Admin safe mode is on. Load this view to refresh participation totals."
    );
  });

  it("writes safe mode markup to els.adminParticipationSummaryStats", () => {
    const els = makeMockEls();
    const controller = createAdminPreEventController({
      els,
      renderAdminSchoolDetail: () => {},
      renderRegisteredEnsemblesList: () => {},
      renderAdminPizzaTotals: () => {},
    });
    controller.render({ showSchoolDetail: false, heavyLoaded: false });
    expect(els.adminParticipationSummaryStats.innerHTML).toContain("Safe mode");
  });

  it("writes safe mode markup to els.adminParticipationSummaryBody", () => {
    const els = makeMockEls();
    const controller = createAdminPreEventController({
      els,
      renderAdminSchoolDetail: () => {},
      renderRegisteredEnsemblesList: () => {},
      renderAdminPizzaTotals: () => {},
    });
    controller.render({ showSchoolDetail: false, heavyLoaded: false });
    expect(els.adminParticipationSummaryBody.innerHTML).toContain("Safe mode");
  });

  it("hides participation summary section when school detail is shown", () => {
    const toggleCalls = [];
    const els = makeMockEls({
      adminParticipationSummarySection: {
        classList: { toggle: (cls, val) => toggleCalls.push({ cls, val }) },
      },
    });
    const controller = createAdminPreEventController({
      els,
      renderAdminSchoolDetail: () => {},
      renderRegisteredEnsemblesList: () => {},
      renderAdminPizzaTotals: () => {},
    });
    controller.render({ showSchoolDetail: true, heavyLoaded: false });
    expect(toggleCalls).toContainEqual({ cls: "is-hidden", val: true });
  });
});
