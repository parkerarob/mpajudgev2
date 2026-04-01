/**
 * Unit tests for resolveProgramGrade function.
 * Run with: npx vitest run tests/unit/resolveProgramGrade.test.js
 */
import { describe, it, expect } from "vitest";
import { resolveProgramGrade } from "../../public/modules/admin-event-tools.js";

describe("resolveProgramGrade", () => {
  it("prefers performanceGrade over declaredGradeLevel", () => {
    const entry = {
      performanceGrade: "III",
      declaredGradeLevel: "II",
    };
    expect(resolveProgramGrade(entry)).toBe("III");
  });

  it("falls back to declaredGradeLevel when performanceGrade is absent", () => {
    const entry = {
      declaredGradeLevel: "II",
    };
    expect(resolveProgramGrade(entry)).toBe("II");
  });

  it("returns empty string when both grades are absent", () => {
    const entry = {};
    expect(resolveProgramGrade(entry)).toBe("");
  });

  it("ignores declaredGradeLevel when performanceGrade is present", () => {
    const entry = {
      performanceGrade: "V",
      declaredGradeLevel: "I",
    };
    expect(resolveProgramGrade(entry)).toBe("V");
  });

  it("returns empty string when both grades are null", () => {
    const entry = {
      performanceGrade: null,
      declaredGradeLevel: null,
    };
    expect(resolveProgramGrade(entry)).toBe("");
  });

  it("normalizes numeric grades to Roman numerals", () => {
    const entry = {
      performanceGrade: "3",
    };
    expect(resolveProgramGrade(entry)).toBe("III");
  });

  it("normalizes grade ranges", () => {
    const entry = {
      performanceGrade: "II/III",
    };
    expect(resolveProgramGrade(entry)).toBe("II/III");
  });

  it("returns empty string for invalid grades", () => {
    const entry = {
      performanceGrade: "invalid",
      declaredGradeLevel: "also invalid",
    };
    expect(resolveProgramGrade(entry)).toBe("");
  });

  it("handles default parameter", () => {
    expect(resolveProgramGrade()).toBe("");
  });

  it("handles empty object", () => {
    expect(resolveProgramGrade({})).toBe("");
  });

  it("uses performanceGrade even if it normalizes to empty (validation test)", () => {
    // This test documents that we don't fall back to declaredGradeLevel
    // if performanceGrade exists but is invalid
    const entry = {
      performanceGrade: "invalid",
      declaredGradeLevel: "II",
    };
    // performanceGrade exists but normalizes to empty, so we get empty string
    expect(resolveProgramGrade(entry)).toBe("");
  });
});
