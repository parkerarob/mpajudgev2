import { describe, expect, it } from "vitest";
import {
  getAdminHashForView,
  resolveAdminViewFromHashSegment,
  resolveAdminView,
} from "../../public/modules/admin-navigation.js";

describe("admin navigation hash helper", () => {
  it("maps known admin views", () => {
    expect(getAdminHashForView("eventPrep")).toBe("#admin/event-prep");
    expect(getAdminHashForView("eventDay")).toBe("#admin/event-day");
    expect(getAdminHashForView("setup")).toBe("#admin/setup");
    expect(getAdminHashForView("directory")).toBe("#admin/directory");
    expect(getAdminHashForView("announcer")).toBe("#admin/announcer");
  });

  it("falls back to event-day for missing or blank view when live mode is enabled", () => {
    expect(getAdminHashForView()).toBe("#admin/event-day");
    expect(getAdminHashForView("")).toBe("#admin/event-day");
    expect(getAdminHashForView("   ")).toBe("#admin/event-day");
  });
});

describe("resolveAdminView", () => {
  it("returns canonical known admin views", () => {
    expect(resolveAdminView("eventPrep")).toBe("eventPrep");
    expect(resolveAdminView("eventDay")).toBe("eventDay");
    expect(resolveAdminView("setup")).toBe("setup");
    expect(resolveAdminView("directory")).toBe("directory");
    expect(resolveAdminView("announcer")).toBe("announcer");
  });

  it("falls back to event-day for invalid view", () => {
    expect(resolveAdminView("")).toBe("eventDay");
    expect(resolveAdminView("unknown")).toBe("eventDay");
    expect(resolveAdminView("settings")).toBe("eventDay");
    expect(resolveAdminView("packets")).toBe("eventDay");
    expect(resolveAdminView("submissions")).toBe("eventDay");
    expect(resolveAdminView("readiness")).toBe("eventDay");
    expect(resolveAdminView("ratings")).toBe("eventDay");
  });

  it("respects feature gates for event-day/setup/directory", () => {
    expect(resolveAdminView("eventDay", { liveEnabled: false })).toBe("eventPrep");
    expect(resolveAdminView("setup", { settingsEnabled: false })).toBe("eventDay");
    expect(resolveAdminView("directory", { settingsEnabled: false })).toBe("eventDay");
  });
});

describe("resolveAdminViewFromHashSegment", () => {
  it("maps known segments to canonical views", () => {
    expect(resolveAdminViewFromHashSegment("pre-event")).toBe("eventPrep");
    expect(resolveAdminViewFromHashSegment("registrations")).toBe("eventPrep");
    expect(resolveAdminViewFromHashSegment("live")).toBe("eventDay");
    expect(resolveAdminViewFromHashSegment("flow")).toBe("eventDay");
    expect(resolveAdminViewFromHashSegment("results")).toBe("eventDay");
    expect(resolveAdminViewFromHashSegment("setup")).toBe("setup");
    expect(resolveAdminViewFromHashSegment("directory")).toBe("directory");
  });

  it("maps legacy segments to their new canonical views", () => {
    expect(resolveAdminViewFromHashSegment("settings")).toBe("setup");
    expect(resolveAdminViewFromHashSegment("packet")).toBe("eventDay");
    expect(resolveAdminViewFromHashSegment("packets")).toBe("eventDay");
    expect(resolveAdminViewFromHashSegment("submissions")).toBe("eventDay");
    expect(resolveAdminViewFromHashSegment("readiness")).toBe("eventPrep");
    expect(resolveAdminViewFromHashSegment("ratings")).toBe("eventDay");
  });

  it("applies feature gates while resolving segments", () => {
    expect(resolveAdminViewFromHashSegment("live", { liveEnabled: false })).toBe("eventPrep");
    expect(resolveAdminViewFromHashSegment("setup", { settingsEnabled: false })).toBe("eventDay");
    expect(resolveAdminViewFromHashSegment("settings", { settingsEnabled: false })).toBe("eventDay");
  });

  it("falls back to the active default view for unknown segments", () => {
    expect(resolveAdminViewFromHashSegment("unknown")).toBe("eventPrep");
    expect(resolveAdminViewFromHashSegment("")).toBe("eventPrep");
  });
});
