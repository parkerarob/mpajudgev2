/**
 * Event schedule timeline: derives holding, warm-up, perform, sight-reading
 * from first performance time, roster order, grades, and breaks.
 * Grade I/II = 25 min, III/IV = 30 min, V = 35 min, VI = 40 min per slot.
 * Break adds 30 min before next band's holding.
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
 * Compute timeline for all roster entries.
 * @param {Date|import('firebase/firestore').Timestamp} firstPerformanceAt - Start of perform slot for first band
 * @param {Array<{ id: string, ensembleId: string, [key: string]: unknown }>} rosterEntries - Ordered roster (by performanceAt)
 * @param {Set<string>|Array<string>} scheduleBreaks - Entry IDs after which a 30-min break is inserted
 * @param {(entry: { id: string, ensembleId: string }) => string|null} getGrade - Returns grade I–VI or null for each entry
 * @returns {Array<{ entryId: string, ensembleId: string, grade: string|null, slotMins: number, holdingStart: Date, warmUpStart: Date, performStart: Date, sightStart: Date }>}
 */
export function computeScheduleTimeline(firstPerformanceAt, rosterEntries, scheduleBreaks, getGrade) {
  const breakSet = Array.isArray(scheduleBreaks)
    ? new Set(scheduleBreaks)
    : scheduleBreaks instanceof Set
      ? scheduleBreaks
      : new Set();

  const performStartFirst =
    firstPerformanceAt && typeof firstPerformanceAt.toDate === "function"
      ? firstPerformanceAt.toDate()
      : firstPerformanceAt instanceof Date
        ? firstPerformanceAt
        : new Date(firstPerformanceAt);

  if (!rosterEntries.length) return [];

  const result = [];
  let nextAvailable = new Date(0);

  for (let i = 0; i < rosterEntries.length; i++) {
    const entry = rosterEntries[i];
    const grade = getGrade(entry);
    const slotMins = getSlotMinutesForGrade(grade);

    let holdingStart;
    let warmUpStart;
    let performStart;
    let sightStart;

    if (i === 0) {
      performStart = new Date(performStartFirst.getTime());
      warmUpStart = new Date(performStart.getTime() - 2 * slotMins * 60 * 1000);
      holdingStart = new Date(performStart.getTime() - 3 * slotMins * 60 * 1000);
      sightStart = new Date(performStart.getTime() + slotMins * 60 * 1000);
    } else {
      if (breakSet.has(rosterEntries[i - 1].id)) {
        nextAvailable = new Date(nextAvailable.getTime() + 30 * 60 * 1000);
      }
      holdingStart = new Date(nextAvailable.getTime());
      warmUpStart = new Date(holdingStart.getTime() + slotMins * 60 * 1000);
      performStart = new Date(warmUpStart.getTime() + slotMins * 60 * 1000);
      sightStart = new Date(performStart.getTime() + slotMins * 60 * 1000);
    }

    nextAvailable = new Date(sightStart.getTime() + slotMins * 60 * 1000);

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
