/**
 * Event schedule timeline: performance times only.
 * First band performs at firstPerformanceAt; each next band performs at
 * previous performance time + previous band's slot length (by grade).
 * Break adds 30 min before the next band's performance.
 * Grade I/II = 25 min, III/IV = 30 min, V = 35 min, VI = 40 min per slot.
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
  if (grade && Object.prototype.hasOwnProperty.call(SLOT_MINUTES_BY_GRADE, grade)) {
    return SLOT_MINUTES_BY_GRADE[grade];
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
 * next performance = previous performance + previous slot (plus 30 min if break).
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
  let nextPerformTime = new Date(performStartFirst.getTime());

  for (let i = 0; i < rosterEntries.length; i++) {
    const entry = rosterEntries[i];
    const grade = getGrade(entry);
    const slotMins = getSlotMinutesForGrade(grade);

    if (i > 0) {
      const prevId = rosterEntries[i - 1].id;
      if (dayBreakMap.has(prevId)) {
        nextPerformTime = new Date(dayBreakMap.get(prevId).getTime());
      } else if (breakSet.has(prevId)) {
        nextPerformTime = new Date(nextPerformTime.getTime() + 30 * 60 * 1000);
      }
    }

    const performStart = new Date(nextPerformTime.getTime());
    nextPerformTime = new Date(performStart.getTime() + slotMins * 60 * 1000);

    const holdingStart = new Date(performStart.getTime() - 3 * slotMins * 60 * 1000);
    const warmUpStart = new Date(performStart.getTime() - 2 * slotMins * 60 * 1000);
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
  }

  return result;
}
