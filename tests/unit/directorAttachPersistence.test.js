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
    expect(resolveAdminDirectorReturnView("preEvent")).toBe("preEvent");
    expect(resolveAdminDirectorReturnView("liveEvent")).toBe("liveEvent");
    expect(resolveAdminDirectorReturnView("packets")).toBe("packets");
    expect(resolveAdminDirectorReturnView("readiness")).toBe("readiness");
    expect(resolveAdminDirectorReturnView("settings")).toBe("settings");
  });

  it("falls back to preEvent for unknown views", () => {
    expect(resolveAdminDirectorReturnView("unknown")).toBe("preEvent");
    expect(resolveAdminDirectorReturnView("")).toBe("preEvent");
  });

  it("uses a valid custom fallback when provided", () => {
    expect(resolveAdminDirectorReturnView("unknown", "packets")).toBe("packets");
    expect(resolveAdminDirectorReturnView("unknown", "bad")).toBe("preEvent");
  });
});
