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
    preEventSubtabBar: { classList: { toggle: () => {} } },
    adminRegisteredEnsemblesSection: { classList: { toggle: () => {}, add: () => {} } },
    adminScheduleBuilderSection: { classList: { add: () => {}, toggle: () => {} } },
    adminSchoolDetailSection: { classList: { toggle: () => {}, add: () => {} } },
    adminRegisteredEnsemblesList: { innerHTML: "" },
    adminSchoolDetailHint: { textContent: "" },
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

  it("writes safe mode copy to the registered ensembles list", () => {
    const els = makeMockEls();
    const controller = createAdminPreEventController({
      els,
      renderAdminSchoolDetail: () => {},
      renderRegisteredEnsemblesList: () => {},
      renderScheduleBuilder: () => {},
    });
    controller.render({ showSchoolDetail: false, heavyLoaded: false });
    expect(els.adminRegisteredEnsemblesList.innerHTML).toContain("Safe mode");
  });

  it("writes safe mode copy to the school detail hint when school detail is visible", () => {
    const els = makeMockEls();
    const controller = createAdminPreEventController({
      els,
      renderAdminSchoolDetail: () => {},
      renderRegisteredEnsemblesList: () => {},
      renderScheduleBuilder: () => {},
    });
    controller.render({ showSchoolDetail: true, heavyLoaded: false });
    expect(els.adminSchoolDetailHint.textContent).toContain("Safe mode active");
  });

  it("hides the subtab bar when school detail is shown", () => {
    const toggleCalls = [];
    const els = makeMockEls({
      preEventSubtabBar: {
        classList: { toggle: (cls, val) => toggleCalls.push({ cls, val }) },
      },
    });
    const controller = createAdminPreEventController({
      els,
      renderAdminSchoolDetail: () => {},
      renderRegisteredEnsemblesList: () => {},
      renderScheduleBuilder: () => {},
    });
    controller.render({ showSchoolDetail: true, heavyLoaded: false });
    expect(toggleCalls).toContainEqual({ cls: "is-hidden", val: true });
  });
});
