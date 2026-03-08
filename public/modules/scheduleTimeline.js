import { normalizeGradeBand } from "./utils.js";

/**
 * Event timeline model:
 * - Slot minutes by grade (I/II=25, III/IV=30, V=35, VI=40).
 * - Warm-up for band N starts when band N-1 moves to stage (its performStart),
 *   unless a configured break/day-break overrides the next transition.
 * - Warm-up and performance each use the band's slot duration.
 * - Performance cannot start until the stage is available.
 */

const SLOT_MINUTES_BY_GRADE = {
  I: 25,
  II: 25,
  III: 30,
  IV: 30,
  V: 35,
  VI: 40,
};

const DEFAULT_SLOT_MINUTES = 30;

/**
 * @param {string} grade - Roman I–VI or null/undefined
 * @returns {number} Slot duration in minutes
 */
export function getSlotMinutesForGrade(grade) {
  const normalized = normalizeGradeBand(grade);
  if (grade && !normalized) {
    console.warn("scheduleTimeline: invalid grade for slot mapping, using default 30", grade);
  }
  if (normalized && Object.prototype.hasOwnProperty.call(SLOT_MINUTES_BY_GRADE, normalized)) {
    return SLOT_MINUTES_BY_GRADE[normalized];
  }
  if (normalized && normalized.includes("/")) {
    const parts = normalized.split("/");
    const right = parts[1] || "";
    if (Object.prototype.hasOwnProperty.call(SLOT_MINUTES_BY_GRADE, right)) {
      return SLOT_MINUTES_BY_GRADE[right];
    }
    if (Object.prototype.hasOwnProperty.call(SLOT_MINUTES_BY_GRADE, parts[0])) {
      return SLOT_MINUTES_BY_GRADE[parts[0]];
    }
  }
  return DEFAULT_SLOT_MINUTES;
}

/**
 * Resolve a value that may be a Firestore Timestamp, Date, or date string to a Date.
 * @param {*} val
 * @returns {Date|null}
 */
function toDate(val) {
  if (!val) return null;
  if (typeof val.toDate === "function") return val.toDate();
  if (val instanceof Date) return val;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Compute timeline for all roster entries. Schedule is performance-time only:
 * - Default pipeline: next performance follows existing warm-up/stage availability rules.
 * - Break rule: a break after entry N forces entry N+1 performance start to
 *   entryN performance end + 30 minutes (ignoring sightreading for the break gap).
 * A day break (entry in dayBreaks map) jumps the timeline to a specific date/time,
 * superseding a regular 30-min break on the same entry.
 * Also returns holding/warmUp/sight derived from each perform time for display.
 *
 * @param {Date|import('firebase/firestore').Timestamp} firstPerformanceAt
 * @param {Array<{ id: string, ensembleId: string, [key: string]: unknown }>} rosterEntries
 * @param {Set<string>|Array<string>} scheduleBreaks - Entry IDs after which a 30-min break is inserted
 * @param {(entry: { id: string, ensembleId: string }) => string|null} getGrade
 * @param {Object<string, Date|import('firebase/firestore').Timestamp>} [dayBreaks] - Entry IDs mapped to a jump-to datetime
 * @returns {Array<{ entryId: string, ensembleId: string, grade: string|null, slotMins: number, holdingStart: Date, warmUpStart: Date, performStart: Date, sightStart: Date }>}
 */
export function computeScheduleTimeline(firstPerformanceAt, rosterEntries, scheduleBreaks, getGrade, dayBreaks) {
  const breakSet = Array.isArray(scheduleBreaks)
    ? new Set(scheduleBreaks)
    : scheduleBreaks instanceof Set
      ? scheduleBreaks
      : new Set();

  const dayBreakMap = new Map();
  if (dayBreaks && typeof dayBreaks === "object") {
    for (const [key, val] of Object.entries(dayBreaks)) {
      const d = toDate(val);
      if (d) dayBreakMap.set(key, d);
    }
  }

  const performStartFirst = toDate(firstPerformanceAt) || new Date();

  if (!rosterEntries.length) return [];

  const result = [];
  let nextWarmUpAnchor = null;
  let nextStageAvailable = null;
  let nextPerformStartOverride = null;

  for (let i = 0; i < rosterEntries.length; i++) {
    const entry = rosterEntries[i];
    const grade = normalizeGradeBand(getGrade(entry));
    const slotMins = getSlotMinutesForGrade(grade);
    let performStart;
    let warmUpStart;
    let holdingStart;

    if (i === 0) {
      performStart = new Date(performStartFirst.getTime());
      warmUpStart = new Date(performStart.getTime() - slotMins * 60 * 1000);
      holdingStart = new Date(warmUpStart.getTime() - slotMins * 60 * 1000);
    } else if (nextPerformStartOverride) {
      performStart = new Date(nextPerformStartOverride.getTime());
      warmUpStart = new Date(performStart.getTime() - slotMins * 60 * 1000);
      holdingStart = new Date(warmUpStart.getTime() - slotMins * 60 * 1000);
      nextPerformStartOverride = null;
    } else {
      const warmUpAnchor = new Date(nextWarmUpAnchor.getTime());
      const stageAvailable = new Date(nextStageAvailable.getTime());
      warmUpStart = warmUpAnchor;
      holdingStart = new Date(warmUpStart.getTime() - slotMins * 60 * 1000);
      const warmUpReady = new Date(warmUpStart.getTime() + slotMins * 60 * 1000);
      performStart =
        warmUpReady.getTime() >= stageAvailable.getTime()
          ? warmUpReady
          : stageAvailable;
    }

    const sightStart = new Date(performStart.getTime() + slotMins * 60 * 1000);

    result.push({
      entryId: entry.id,
      ensembleId: entry.ensembleId,
      grade: grade || null,
      slotMins,
      holdingStart,
      warmUpStart,
      performStart,
      sightStart,
    });

    let anchor = new Date(performStart.getTime());
    let stageAvailable = new Date(performStart.getTime() + slotMins * 60 * 1000);
    if (dayBreakMap.has(entry.id)) {
      const jump = dayBreakMap.get(entry.id);
      // Day breaks anchor the next ensemble's PERFORMANCE start directly.
      nextPerformStartOverride = new Date(jump.getTime());
    } else if (breakSet.has(entry.id)) {
      nextPerformStartOverride = new Date(stageAvailable.getTime() + 30 * 60 * 1000);
    }
    nextWarmUpAnchor = anchor;
    nextStageAvailable = stageAvailable;
  }

  return result;
}
