/**
 * Unit tests for schedule timeline computation.
 * Run with: npx vitest run tests/unit/scheduleTimeline.test.js
 */
import { describe, it, expect } from "vitest";
import {
  getSlotMinutesForGrade,
  computeScheduleTimeline,
} from "../../public/modules/scheduleTimeline.js";

describe("getSlotMinutesForGrade", () => {
  it("returns 25 for I and II", () => {
    expect(getSlotMinutesForGrade("I")).toBe(25);
    expect(getSlotMinutesForGrade("II")).toBe(25);
  });
  it("returns 30 for III and IV", () => {
    expect(getSlotMinutesForGrade("III")).toBe(30);
    expect(getSlotMinutesForGrade("IV")).toBe(30);
  });
  it("returns 35 for V", () => {
    expect(getSlotMinutesForGrade("V")).toBe(35);
  });
  it("returns 40 for VI", () => {
    expect(getSlotMinutesForGrade("VI")).toBe(40);
  });
  it("returns 30 for null or unknown", () => {
    expect(getSlotMinutesForGrade(null)).toBe(30);
    expect(getSlotMinutesForGrade(undefined)).toBe(30);
    expect(getSlotMinutesForGrade("")).toBe(30);
  });
  it("supports adjacent grade ranges", () => {
    expect(getSlotMinutesForGrade("I/II")).toBe(25);
    expect(getSlotMinutesForGrade("II/III")).toBe(30);
    expect(getSlotMinutesForGrade("III/IV")).toBe(30);
    expect(getSlotMinutesForGrade("IV/V")).toBe(35);
    expect(getSlotMinutesForGrade("V/VI")).toBe(40);
  });
  it("supports numeric and dashed grade ranges", () => {
    expect(getSlotMinutesForGrade("2/3")).toBe(30);
    expect(getSlotMinutesForGrade("4-5")).toBe(35);
    expect(getSlotMinutesForGrade(" 5 / 6 ")).toBe(40);
  });
  it("falls back to default for invalid grade ranges", () => {
    expect(getSlotMinutesForGrade("I/III")).toBe(30);
    expect(getSlotMinutesForGrade("7/8")).toBe(30);
  });
});

describe("computeScheduleTimeline", () => {
  const base = new Date("2025-03-01T09:00:00Z"); // 9:00 perform for first band

  it("returns empty array for empty roster", () => {
    expect(
      computeScheduleTimeline(base, [], [], () => null)
    ).toEqual([]);
  });

  it("one band: warm-up and performance each use one slot", () => {
    const roster = [{ id: "e1", ensembleId: "ens1" }];
    const getGrade = () => "II"; // 25 min
    const result = computeScheduleTimeline(base, roster, [], getGrade);
    expect(result).toHaveLength(1);
    expect(result[0].entryId).toBe("e1");
    expect(result[0].slotMins).toBe(25);
    expect(result[0].performStart.getTime()).toBe(base.getTime());
    expect(result[0].warmUpStart.getTime()).toBe(base.getTime() - 25 * 60 * 1000);
    expect(result[0].holdingStart.getTime()).toBe(base.getTime() - 2 * 25 * 60 * 1000);
    expect(result[0].sightStart.getTime()).toBe(base.getTime() + 25 * 60 * 1000);
  });

  it("same slot length: next warm-up starts when previous moves to stage", () => {
    const roster = [
      { id: "e1", ensembleId: "ens1" },
      { id: "e2", ensembleId: "ens2" },
    ];
    const getGrade = () => "III"; // 30 min
    const result = computeScheduleTimeline(base, roster, [], getGrade);
    expect(result).toHaveLength(2);
    const firstPerform = result[0].performStart.getTime();
    expect(result[1].warmUpStart.getTime()).toBe(firstPerform);
    expect(result[1].performStart.getTime()).toBe(firstPerform + 30 * 60 * 1000);
    expect(result[1].holdingStart.getTime()).toBe(
      firstPerform - 30 * 60 * 1000
    );
  });

  it("longer next band creates stage gap after first band", () => {
    const roster = [
      { id: "e1", ensembleId: "ens1" },
      { id: "e2", ensembleId: "ens2" },
    ];
    const getGrade = (entry) => (entry.id === "e1" ? "II" : "VI"); // 25 then 40
    const result = computeScheduleTimeline(base, roster, [], getGrade);
    expect(result).toHaveLength(2);
    const firstPerform = result[0].performStart.getTime();
    expect(result[1].warmUpStart.getTime()).toBe(firstPerform);
    expect(result[1].performStart.getTime()).toBe(firstPerform + 40 * 60 * 1000);
  });

  it("shorter next band waits if stage is still occupied", () => {
    const roster = [
      { id: "e1", ensembleId: "ens1" },
      { id: "e2", ensembleId: "ens2" },
    ];
    const getGrade = (entry) => (entry.id === "e1" ? "VI" : "I"); // 40 then 25
    const result = computeScheduleTimeline(base, roster, [], getGrade);
    const firstPerform = result[0].performStart.getTime();
    expect(result[1].warmUpStart.getTime()).toBe(firstPerform);
    expect(result[1].performStart.getTime()).toBe(firstPerform + 40 * 60 * 1000);
  });

  it("break after previous band shifts warm-up and performance anchors", () => {
    const roster = [
      { id: "e1", ensembleId: "ens1" },
      { id: "e2", ensembleId: "ens2" },
    ];
    const getGrade = (entry) => (entry.id === "e1" ? "I" : "VI"); // 25 then 40
    const result = computeScheduleTimeline(base, roster, ["e1"], getGrade);
    const firstPerform = result[0].performStart.getTime();
    expect(result[1].performStart.getTime()).toBe(firstPerform + 55 * 60 * 1000); // 25 + 30 break
    expect(result[1].warmUpStart.getTime()).toBe(firstPerform + 15 * 60 * 1000); // perform - next slot (40)
  });

  it("day-break overrides default/break anchors", () => {
    const roster = [
      { id: "e1", ensembleId: "ens1" },
      { id: "e2", ensembleId: "ens2" },
    ];
    const dayJump = new Date("2025-03-01T13:00:00Z");
    const result = computeScheduleTimeline(
      base,
      roster,
      ["e1"],
      () => "II",
      { e1: dayJump }
    );
    expect(result[1].performStart.getTime()).toBe(dayJump.getTime());
    expect(result[1].warmUpStart.getTime()).toBe(dayJump.getTime() - 25 * 60 * 1000);
  });

  it("range grade uses the correct slot duration", () => {
    const roster = [
      { id: "e1", ensembleId: "ens1" },
      { id: "e2", ensembleId: "ens2" },
    ];
    const getGrade = (entry) => (entry.id === "e1" ? "II/III" : "I");
    const result = computeScheduleTimeline(base, roster, [], getGrade);
    expect(result[0].slotMins).toBe(30);
    expect(result[1].warmUpStart.getTime()).toBe(result[0].performStart.getTime());
  });

  it("accepts Firestore-like Timestamp with toDate()", () => {
    const roster = [{ id: "e1", ensembleId: "ens1" }];
    const timestamp = {
      toDate: () => new Date("2025-03-01T10:00:00Z"),
    };
    const result = computeScheduleTimeline(timestamp, roster, [], () => "IV");
    expect(result[0].performStart.getTime()).toBe(
      new Date("2025-03-01T10:00:00Z").getTime()
    );
  });
});
