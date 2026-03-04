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
});

describe("computeScheduleTimeline", () => {
  const base = new Date("2025-03-01T09:00:00Z"); // 9:00 perform for first band

  it("returns empty array for empty roster", () => {
    expect(
      computeScheduleTimeline(base, [], [], () => null)
    ).toEqual([]);
  });

  it("one band: perform at firstPerformanceAt, holding/warm-up before, sight after", () => {
    const roster = [{ id: "e1", ensembleId: "ens1" }];
    const getGrade = () => "II"; // 25 min
    const result = computeScheduleTimeline(base, roster, [], getGrade);
    expect(result).toHaveLength(1);
    expect(result[0].entryId).toBe("e1");
    expect(result[0].slotMins).toBe(25);
    expect(result[0].performStart.getTime()).toBe(base.getTime());
    // Holding and warm-up are 3 and 2 slot(s) before perform
    expect(result[0].holdingStart.getTime()).toBe(base.getTime() - 3 * 25 * 60 * 1000);
    expect(result[0].warmUpStart.getTime()).toBe(base.getTime() - 2 * 25 * 60 * 1000);
    expect(result[0].sightStart.getTime()).toBe(base.getTime() + 25 * 60 * 1000);
  });

  it("two bands: second starts when first sight ends", () => {
    const roster = [
      { id: "e1", ensembleId: "ens1" },
      { id: "e2", ensembleId: "ens2" },
    ];
    const getGrade = () => "III"; // 30 min
    const result = computeScheduleTimeline(base, roster, [], getGrade);
    expect(result).toHaveLength(2);
    const firstSightEnd = result[0].sightStart.getTime() + 30 * 60 * 1000;
    expect(result[1].holdingStart.getTime()).toBe(firstSightEnd);
    expect(result[1].performStart.getTime()).toBe(
      firstSightEnd + 30 * 60 * 1000 * 2
    );
  });

  it("two bands with break: 30 min gap before second band holding", () => {
    const roster = [
      { id: "e1", ensembleId: "ens1" },
      { id: "e2", ensembleId: "ens2" },
    ];
    const getGrade = () => "I"; // 25 min
    const result = computeScheduleTimeline(base, roster, ["e1"], getGrade);
    expect(result).toHaveLength(2);
    const firstSightEnd = result[0].sightStart.getTime() + 25 * 60 * 1000;
    const expectedSecondHolding = firstSightEnd + 30 * 60 * 1000;
    expect(result[1].holdingStart.getTime()).toBe(expectedSecondHolding);
  });

  it("different grades use correct slot durations", () => {
    const roster = [
      { id: "e1", ensembleId: "ens1" },
      { id: "e2", ensembleId: "ens2" },
    ];
    const getGrade = (entry) => (entry.id === "e1" ? "VI" : "I"); // 40 then 25
    const result = computeScheduleTimeline(base, roster, [], getGrade);
    expect(result[0].slotMins).toBe(40);
    expect(result[1].slotMins).toBe(25);
    const firstSightEnd = result[0].sightStart.getTime() + 40 * 60 * 1000;
    expect(result[1].holdingStart.getTime()).toBe(firstSightEnd);
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
