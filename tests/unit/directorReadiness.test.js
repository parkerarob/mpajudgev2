import { describe, it, expect } from "vitest";
import { computeDirectorReadiness } from "../../public/modules/director-readiness.js";

function buildBaseEntry() {
  return {
    performanceGrade: "III",
    repertoire: {
      repertoireRuleMode: "standard",
      march: { title: "March" },
      selection1: { pieceId: "s1", grade: "III", title: "Sel 1", composer: "Comp 1" },
      selection2: { pieceId: "s2", grade: "III", title: "Sel 2", composer: "Comp 2" },
    },
    instrumentation: {
      standardCounts: { flute: 1 },
    },
    seating: {
      rows: [{ chairs: 10, stands: 5 }],
    },
    percussionNeeds: {
      selected: [],
    },
    lunchOrder: {
      pepperoniQty: 0,
      cheeseQty: 0,
      pickupTiming: "",
    },
  };
}

describe("computeDirectorReadiness", () => {
  it("returns ready for complete standard entry", () => {
    const entry = buildBaseEntry();
    const result = computeDirectorReadiness(entry, {
      selectedEnsembleId: "ens1",
      hasSchool: true,
      mpaCacheByGrade: new Map(),
    });
    expect(result.flags.ready).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("allows masterwork mode with only selection #1 when it is marked masterwork", () => {
    const entry = buildBaseEntry();
    entry.repertoire.repertoireRuleMode = "masterwork";
    entry.repertoire.selection2 = { pieceId: null, grade: "", title: "", composer: "" };
    entry.performanceGrade = "VI";
    const cache = new Map([
      ["III", [{ id: "s1", isMasterwork: true, specialInstructions: "", status: "", tags: [] }]],
    ]);
    const result = computeDirectorReadiness(entry, {
      selectedEnsembleId: "ens1",
      hasSchool: true,
      mpaCacheByGrade: cache,
    });
    expect(result.flags.repertoire).toBe(true);
    expect(result.flags.ready).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("fails masterwork mode when selection #1 is not masterwork", () => {
    const entry = buildBaseEntry();
    entry.repertoire.repertoireRuleMode = "masterwork";
    entry.repertoire.selection2 = { pieceId: null, grade: "", title: "", composer: "" };
    entry.performanceGrade = "VI";
    const cache = new Map([
      ["III", [{ id: "s1", isMasterwork: false, specialInstructions: "", status: "", tags: [] }]],
    ]);
    const result = computeDirectorReadiness(entry, {
      selectedEnsembleId: "ens1",
      hasSchool: true,
      mpaCacheByGrade: cache,
    });
    expect(result.flags.repertoire).toBe(false);
    expect(result.flags.ready).toBe(false);
    expect(result.issues).toContain("Masterwork Exception requires Selection #1 to be a Masterwork.");
  });
});
