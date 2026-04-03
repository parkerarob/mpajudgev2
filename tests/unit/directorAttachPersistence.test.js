import { describe, it, expect } from "vitest";
import {
  resolveAdminDirectorPersistPrimary,
  resolveAdminDirectorReturnView,
} from "../../public/modules/director-attach-policy.js";

describe("resolveAdminDirectorPersistPrimary", () => {
  it("defaults to non-persistent when persistPrimary is omitted", () => {
    expect(resolveAdminDirectorPersistPrimary(undefined)).toBe(false);
  });

  it("respects explicit false", () => {
    expect(resolveAdminDirectorPersistPrimary(false)).toBe(false);
  });

  it("respects explicit true", () => {
    expect(resolveAdminDirectorPersistPrimary(true)).toBe(true);
  });
});

describe("resolveAdminDirectorReturnView", () => {
  it("returns known admin views", () => {
    expect(resolveAdminDirectorReturnView("eventPrep")).toBe("eventPrep");
    expect(resolveAdminDirectorReturnView("eventDay")).toBe("eventDay");
    expect(resolveAdminDirectorReturnView("setup")).toBe("setup");
    expect(resolveAdminDirectorReturnView("directory")).toBe("directory");
  });

  it("falls back to eventPrep for unknown views", () => {
    expect(resolveAdminDirectorReturnView("unknown")).toBe("eventPrep");
    expect(resolveAdminDirectorReturnView("")).toBe("eventPrep");
  });

  it("uses a valid custom fallback when provided", () => {
    expect(resolveAdminDirectorReturnView("unknown", "eventDay")).toBe("eventDay");
    expect(resolveAdminDirectorReturnView("unknown", "bad")).toBe("eventPrep");
  });
});
