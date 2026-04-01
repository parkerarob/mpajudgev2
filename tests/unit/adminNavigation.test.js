import { describe, expect, it } from "vitest";
import {
  getAdminHashForView,
  resolveAdminViewFromHashSegment,
  resolveAdminView,
} from "../../public/modules/admin-navigation.js";

describe("admin navigation hash helper", () => {
  it("maps known admin views", () => {
    expect(getAdminHashForView("dashboard")).toBe("#admin");
    expect(getAdminHashForView("preEvent")).toBe("#admin/pre-event");
    expect(getAdminHashForView("liveEvent")).toBe("#admin/live");
    expect(getAdminHashForView("setup")).toBe("#admin/setup");
    expect(getAdminHashForView("directory")).toBe("#admin/directory");
    expect(getAdminHashForView("results")).toBe("#admin/results");
    expect(getAdminHashForView("announcer")).toBe("#admin/announcer");
  });

  it("falls back to #admin for missing or blank view", () => {
    expect(getAdminHashForView()).toBe("#admin");
    expect(getAdminHashForView("")).toBe("#admin");
    expect(getAdminHashForView("   ")).toBe("#admin");
  });
});

describe("resolveAdminView", () => {
  it("returns canonical known admin views", () => {
    expect(resolveAdminView("dashboard")).toBe("dashboard");
    expect(resolveAdminView("preEvent")).toBe("preEvent");
    expect(resolveAdminView("liveEvent")).toBe("liveEvent");
    expect(resolveAdminView("results")).toBe("results");
    expect(resolveAdminView("setup")).toBe("setup");
    expect(resolveAdminView("directory")).toBe("directory");
    expect(resolveAdminView("announcer")).toBe("announcer");
  });

  it("falls back to dashboard for invalid view", () => {
    expect(resolveAdminView("")).toBe("dashboard");
    expect(resolveAdminView("unknown")).toBe("dashboard");
    // removed views now fall back to dashboard
    expect(resolveAdminView("settings")).toBe("dashboard");
    expect(resolveAdminView("packets")).toBe("dashboard");
    expect(resolveAdminView("submissions")).toBe("dashboard");
    expect(resolveAdminView("readiness")).toBe("dashboard");
    expect(resolveAdminView("ratings")).toBe("dashboard");
  });

  it("respects feature gates for live/setup/directory", () => {
    expect(resolveAdminView("liveEvent", { liveEnabled: false })).toBe("dashboard");
    expect(resolveAdminView("setup", { settingsEnabled: false })).toBe("dashboard");
    expect(resolveAdminView("directory", { settingsEnabled: false })).toBe("dashboard");
  });
});

describe("resolveAdminViewFromHashSegment", () => {
  it("maps known segments to canonical views", () => {
    expect(resolveAdminViewFromHashSegment("pre-event")).toBe("preEvent");
    expect(resolveAdminViewFromHashSegment("registrations")).toBe("preEvent");
    expect(resolveAdminViewFromHashSegment("live")).toBe("liveEvent");
    expect(resolveAdminViewFromHashSegment("flow")).toBe("liveEvent");
    expect(resolveAdminViewFromHashSegment("results")).toBe("results");
    expect(resolveAdminViewFromHashSegment("setup")).toBe("setup");
    expect(resolveAdminViewFromHashSegment("directory")).toBe("directory");
  });

  it("maps legacy segments to their new canonical views", () => {
    expect(resolveAdminViewFromHashSegment("settings")).toBe("setup");
    expect(resolveAdminViewFromHashSegment("packet")).toBe("results");
    expect(resolveAdminViewFromHashSegment("packets")).toBe("results");
    expect(resolveAdminViewFromHashSegment("submissions")).toBe("liveEvent");
    expect(resolveAdminViewFromHashSegment("readiness")).toBe("preEvent");
    expect(resolveAdminViewFromHashSegment("ratings")).toBe("results");
  });

  it("applies feature gates while resolving segments", () => {
    expect(resolveAdminViewFromHashSegment("live", { liveEnabled: false })).toBe("dashboard");
    expect(resolveAdminViewFromHashSegment("setup", { settingsEnabled: false })).toBe("dashboard");
    expect(resolveAdminViewFromHashSegment("settings", { settingsEnabled: false })).toBe("dashboard");
  });

  it("falls back to dashboard for unknown segments", () => {
    expect(resolveAdminViewFromHashSegment("unknown")).toBe("dashboard");
    expect(resolveAdminViewFromHashSegment("")).toBe("dashboard");
  });
});
