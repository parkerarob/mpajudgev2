import { describe, expect, it } from "vitest";
import {
  getAdminHashForView,
  resolveAdminViewFromHashSegment,
  resolveAdminView,
} from "../../public/modules/admin-navigation.js";

describe("admin navigation hash helper", () => {
  it("maps known admin views", () => {
    expect(getAdminHashForView("preEvent")).toBe("#admin");
    expect(getAdminHashForView("liveEvent")).toBe("#admin/live");
    expect(getAdminHashForView("readiness")).toBe("#admin/readiness");
  });

  it("falls back to #admin for missing or blank view", () => {
    expect(getAdminHashForView()).toBe("#admin");
    expect(getAdminHashForView("")).toBe("#admin");
    expect(getAdminHashForView("   ")).toBe("#admin");
  });

  it("maps custom views to #admin/<view>", () => {
    expect(getAdminHashForView("settings")).toBe("#admin/settings");
  });
});

describe("resolveAdminView", () => {
  it("returns canonical known admin views", () => {
    expect(resolveAdminView("preEvent")).toBe("preEvent");
    expect(resolveAdminView("liveEvent")).toBe("liveEvent");
    expect(resolveAdminView("packets")).toBe("packets");
    expect(resolveAdminView("readiness")).toBe("readiness");
    expect(resolveAdminView("settings")).toBe("settings");
  });

  it("falls back to preEvent for invalid view", () => {
    expect(resolveAdminView("")).toBe("preEvent");
    expect(resolveAdminView("unknown")).toBe("preEvent");
  });

  it("respects feature gates for live/settings", () => {
    expect(resolveAdminView("liveEvent", { liveEnabled: false })).toBe("preEvent");
    expect(resolveAdminView("settings", { settingsEnabled: false })).toBe("preEvent");
  });
});

describe("resolveAdminViewFromHashSegment", () => {
  it("maps known legacy segments to canonical views", () => {
    expect(resolveAdminViewFromHashSegment("pre-event")).toBe("preEvent");
    expect(resolveAdminViewFromHashSegment("eventChair")).toBe("preEvent");
    expect(resolveAdminViewFromHashSegment("live")).toBe("liveEvent");
    expect(resolveAdminViewFromHashSegment("packet")).toBe("packets");
    expect(resolveAdminViewFromHashSegment("directory")).toBe("settings");
  });

  it("applies feature gates while resolving segments", () => {
    expect(resolveAdminViewFromHashSegment("live", { liveEnabled: false })).toBe("preEvent");
    expect(resolveAdminViewFromHashSegment("settings", { settingsEnabled: false })).toBe("preEvent");
  });

  it("falls back to preEvent for unknown segments", () => {
    expect(resolveAdminViewFromHashSegment("unknown")).toBe("preEvent");
    expect(resolveAdminViewFromHashSegment("")).toBe("preEvent");
  });
});
