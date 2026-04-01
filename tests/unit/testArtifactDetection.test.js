/**
 * Unit tests for test artifact detection and instrumentation student count functions.
 * Run with: npx vitest run tests/unit/testArtifactDetection.test.js
 */
import { describe, it, expect } from "vitest";
import {
  isTestArtifactText,
  hasExplicitTestArtifactFlag,
  isProductionRegistration,
  calculateInstrumentationStudentCount,
} from "../../public/modules/utils.js";

describe("isTestArtifactText", () => {
  it("detects 'test' keyword", () => {
    expect(isTestArtifactText("test")).toBe(true);
    expect(isTestArtifactText("Test Data")).toBe(true);
    expect(isTestArtifactText("test ensemble")).toBe(true);
  });

  it("detects 'smoke' keyword", () => {
    expect(isTestArtifactText("smoke test")).toBe(true);
    expect(isTestArtifactText("smoke")).toBe(true);
  });

  it("detects 'e2e' keyword", () => {
    expect(isTestArtifactText("e2e")).toBe(true);
    expect(isTestArtifactText("e2e test")).toBe(true);
  });

  it("detects 'release e2e' phrase", () => {
    expect(isTestArtifactText("release e2e")).toBe(true);
    expect(isTestArtifactText("Release E2E")).toBe(true);
  });

  it("detects 'demo' keyword", () => {
    expect(isTestArtifactText("demo")).toBe(true);
    expect(isTestArtifactText("demo school")).toBe(true);
  });

  it("detects 'sandbox' keyword", () => {
    expect(isTestArtifactText("sandbox")).toBe(true);
    expect(isTestArtifactText("sandbox ensemble")).toBe(true);
  });

  it("detects 'qa' keyword", () => {
    expect(isTestArtifactText("qa")).toBe(true);
    expect(isTestArtifactText("qa testing")).toBe(true);
  });

  it("returns false for empty strings", () => {
    expect(isTestArtifactText("")).toBe(false);
    expect(isTestArtifactText(null)).toBe(false);
    expect(isTestArtifactText(undefined)).toBe(false);
  });

  it("returns false for whitespace-only strings", () => {
    expect(isTestArtifactText("   ")).toBe(false);
    expect(isTestArtifactText("\t\n")).toBe(false);
  });

  it("returns false for production names", () => {
    expect(isTestArtifactText("Lincoln High School")).toBe(false);
    expect(isTestArtifactText("Concert Band")).toBe(false);
    expect(isTestArtifactText("Orchestra")).toBe(false);
  });

  it("matches whole words only (not partial)", () => {
    expect(isTestArtifactText("testing")).toBe(false); // 'test' is not a word boundary match
    expect(isTestArtifactText("attest")).toBe(false); // 'test' embedded
    expect(isTestArtifactText("tester")).toBe(false); // 'test' not at word boundary
  });

  it("is case-insensitive", () => {
    expect(isTestArtifactText("TEST")).toBe(true);
    expect(isTestArtifactText("Test")).toBe(true);
    expect(isTestArtifactText("DEMO")).toBe(true);
  });

  it("handles whitespace gracefully", () => {
    expect(isTestArtifactText("  test  ")).toBe(true);
    expect(isTestArtifactText("\tqa\n")).toBe(true);
  });
});

describe("hasExplicitTestArtifactFlag", () => {
  it("detects isTestArtifact = true", () => {
    expect(hasExplicitTestArtifactFlag({ isTestArtifact: true })).toBe(true);
  });

  it("detects testArtifact = true", () => {
    expect(hasExplicitTestArtifactFlag({ testArtifact: true })).toBe(true);
  });

  it("detects 'test-artifact' tag", () => {
    expect(hasExplicitTestArtifactFlag({ tags: ["test-artifact"] })).toBe(true);
  });

  it("detects 'test' tag", () => {
    expect(hasExplicitTestArtifactFlag({ tags: ["test"] })).toBe(true);
  });

  it("returns false when flags are false", () => {
    expect(hasExplicitTestArtifactFlag({ isTestArtifact: false })).toBe(false);
    expect(hasExplicitTestArtifactFlag({ testArtifact: false })).toBe(false);
  });

  it("returns false for empty or missing tags", () => {
    expect(hasExplicitTestArtifactFlag({ tags: [] })).toBe(false);
    expect(hasExplicitTestArtifactFlag({})).toBe(false);
  });

  it("returns false for non-matching tags", () => {
    expect(hasExplicitTestArtifactFlag({ tags: ["production", "confirmed"] })).toBe(false);
  });

  it("is case-insensitive for tags", () => {
    expect(hasExplicitTestArtifactFlag({ tags: ["TEST-ARTIFACT"] })).toBe(true);
    expect(hasExplicitTestArtifactFlag({ tags: ["Test"] })).toBe(true);
  });

  it("returns false for null or non-object input", () => {
    expect(hasExplicitTestArtifactFlag(null)).toBe(false);
    expect(hasExplicitTestArtifactFlag(undefined)).toBe(false);
    expect(hasExplicitTestArtifactFlag("string")).toBe(false);
  });

  it("finds matching tag in mixed array", () => {
    expect(hasExplicitTestArtifactFlag({ tags: ["prod", "test", "verified"] })).toBe(true);
  });

  it("handles tags that are not strings gracefully", () => {
    expect(hasExplicitTestArtifactFlag({ tags: [null, "test-artifact", undefined] })).toBe(true);
  });
});

describe("isProductionRegistration", () => {
  it("returns false if explicit test flag is present", () => {
    expect(isProductionRegistration({ isTestArtifact: true }, "Lincoln High")).toBe(false);
    expect(isProductionRegistration({ testArtifact: true }, "Lincoln High")).toBe(false);
  });

  it("returns false if schoolId contains test artifact text", () => {
    expect(isProductionRegistration({ schoolId: "test-001" }, "Lincoln")).toBe(false);
  });

  it("returns false if schoolName contains test artifact text", () => {
    expect(isProductionRegistration({ schoolId: "001" }, "test school")).toBe(false);
  });

  it("returns false if ensembleId contains test artifact text", () => {
    expect(isProductionRegistration({ ensembleId: "demo-ensemble" }, "Lincoln")).toBe(false);
  });

  it("returns false if ensembleName contains test artifact text", () => {
    expect(isProductionRegistration({ ensembleName: "E2E Test Band" }, "Lincoln")).toBe(false);
  });

  it("returns true if only entry.id contains test artifact text (id is not checked)", () => {
    // entry.id is not checked to avoid false positives on human-specified Firestore document IDs
    expect(isProductionRegistration({ id: "qa-123" }, "Lincoln")).toBe(true);
  });

  it("returns true for valid production registration", () => {
    expect(
      isProductionRegistration(
        { schoolId: "001", ensembleId: "ens-001", ensembleName: "Concert Band", id: "reg-001" },
        "Lincoln High School"
      )
    ).toBe(true);
  });

  it("returns true when all fields are missing", () => {
    expect(isProductionRegistration({}, "Lincoln High")).toBe(true);
  });

  it("returns false if any field matches test artifact pattern", () => {
    // All fields are valid except one
    expect(
      isProductionRegistration(
        { schoolId: "001", ensembleId: "ens-001", ensembleName: "sandbox", id: "reg-001" },
        "Lincoln"
      )
    ).toBe(false);
  });

  it("handles empty strings for schoolName", () => {
    expect(
      isProductionRegistration(
        { schoolId: "001", ensembleId: "ens-001", ensembleName: "Concert Band", id: "reg-001" },
        ""
      )
    ).toBe(true);
  });

  it("is case-insensitive when checking field values", () => {
    expect(isProductionRegistration({ schoolId: "TEST-001" }, "Lincoln")).toBe(false);
    expect(isProductionRegistration({ ensembleName: "DEMO Band" }, "Lincoln")).toBe(false);
  });
});

describe("calculateInstrumentationStudentCount", () => {
  it("returns 0 for empty entry data", () => {
    expect(calculateInstrumentationStudentCount({})).toBe(0);
    expect(calculateInstrumentationStudentCount()).toBe(0);
  });

  it("sums standardCounts correctly", () => {
    const data = {
      instrumentation: {
        standardCounts: {
          violin: 10,
          viola: 5,
          cello: 3,
        },
      },
    };
    expect(calculateInstrumentationStudentCount(data)).toBe(18);
  });

  it("ignores negative or invalid standardCounts", () => {
    const data = {
      instrumentation: {
        standardCounts: {
          violin: 10,
          viola: -5,
          cello: "invalid",
        },
      },
    };
    expect(calculateInstrumentationStudentCount(data)).toBe(10);
  });

  it("sums nonStandard array counts correctly", () => {
    const data = {
      instrumentation: {
        standardCounts: {},
        nonStandard: [
          { count: 5 },
          { count: 3 },
          { count: 2 },
        ],
      },
    };
    expect(calculateInstrumentationStudentCount(data)).toBe(10);
  });

  it("ignores nonStandard entries with missing or invalid count", () => {
    const data = {
      instrumentation: {
        standardCounts: {},
        nonStandard: [
          { count: 5 },
          { count: undefined },
          { count: -1 },
          { count: "invalid" },
        ],
      },
    };
    expect(calculateInstrumentationStudentCount(data)).toBe(5);
  });

  it("includes totalPercussion correctly", () => {
    const data = {
      instrumentation: {
        standardCounts: { violin: 10 },
        totalPercussion: 3,
      },
    };
    expect(calculateInstrumentationStudentCount(data)).toBe(13);
  });

  it("combines all count types", () => {
    const data = {
      instrumentation: {
        standardCounts: {
          violin: 10,
          viola: 5,
        },
        nonStandard: [{ count: 2 }, { count: 3 }],
        totalPercussion: 4,
      },
    };
    expect(calculateInstrumentationStudentCount(data)).toBe(24);
  });

  it("returns 0 when instrumentation is missing", () => {
    expect(calculateInstrumentationStudentCount({ other: "data" })).toBe(0);
  });

  it("handles non-object standardCounts gracefully", () => {
    const data = {
      instrumentation: {
        standardCounts: "not an object",
      },
    };
    expect(calculateInstrumentationStudentCount(data)).toBe(0);
  });

  it("handles non-array nonStandard gracefully", () => {
    const data = {
      instrumentation: {
        standardCounts: { violin: 10 },
        nonStandard: "not an array",
      },
    };
    expect(calculateInstrumentationStudentCount(data)).toBe(10);
  });

  it("rounds values to nearest integer", () => {
    const data = {
      instrumentation: {
        standardCounts: { violin: 10.4, viola: 5.6 },
        nonStandard: [{ count: 2.5 }],
        totalPercussion: 3.8,
      },
    };
    expect(calculateInstrumentationStudentCount(data)).toBe(10 + 6 + 3 + 4); // 23
  });

  it("handles null values in objects", () => {
    const data = {
      instrumentation: {
        standardCounts: { violin: 10, viola: null, cello: undefined },
        nonStandard: [{ count: 5 }, { count: null }],
      },
    };
    expect(calculateInstrumentationStudentCount(data)).toBe(15);
  });

  it("handles deeply nested missing instrumentation", () => {
    const data = {
      instrumentation: {
        standardCounts: null,
        nonStandard: null,
        totalPercussion: null,
      },
    };
    expect(calculateInstrumentationStudentCount(data)).toBe(0);
  });
});
