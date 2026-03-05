import { describe, it, expect } from "vitest";
import {
  deriveAutoScheduleDayBreaks,
  mergeScheduleDayBreaks,
} from "../../public/modules/ui-admin-formatters.js";

describe("deriveAutoScheduleDayBreaks", () => {
  it("creates anchor at each calendar-day boundary", () => {
    const rows = [
      { id: "e1", performanceAt: new Date("2026-03-19T11:00:00") },
      { id: "e2", performanceAt: new Date("2026-03-19T11:30:00") },
      { id: "e3", performanceAt: new Date("2026-03-20T10:00:00") },
      { id: "e4", performanceAt: new Date("2026-03-20T10:25:00") },
      { id: "e5", performanceAt: new Date("2026-03-21T09:00:00") },
    ];
    const breaks = deriveAutoScheduleDayBreaks(rows);
    expect(Object.keys(breaks).sort()).toEqual(["e2", "e4"]);
    expect(new Date(breaks.e2).getTime()).toBe(new Date("2026-03-20T10:00:00").getTime());
    expect(new Date(breaks.e4).getTime()).toBe(new Date("2026-03-21T09:00:00").getTime());
  });

  it("returns empty object for single-day schedules", () => {
    const rows = [
      { id: "e1", performanceAt: new Date("2026-03-19T11:00:00") },
      { id: "e2", performanceAt: new Date("2026-03-19T11:30:00") },
    ];
    expect(deriveAutoScheduleDayBreaks(rows)).toEqual({});
  });
});

describe("mergeScheduleDayBreaks", () => {
  it("keeps explicit persisted day break values over auto-derived values", () => {
    const explicit = { e2: new Date("2026-03-20T10:15:00") };
    const auto = { e2: new Date("2026-03-20T10:00:00"), e4: new Date("2026-03-21T09:00:00") };
    const merged = mergeScheduleDayBreaks(explicit, auto);
    expect(new Date(merged.e2).getTime()).toBe(new Date("2026-03-20T10:15:00").getTime());
    expect(new Date(merged.e4).getTime()).toBe(new Date("2026-03-21T09:00:00").getTime());
  });
});
