import { getSlotMinutesForGrade } from "./scheduleTimeline.js";

const BREAK_DURATION_MINS = 30;

/**
 * Given a local date object and a "HH:MM" string, return a new Date with that time.
 * @param {Date} baseDate
 * @param {string} timeStr  "HH:MM"
 * @returns {Date}
 */
export function applyTimeToDate(baseDate, timeStr) {
  const [hStr, mStr] = String(timeStr || "08:00").split(":");
  const h = Math.min(23, Math.max(0, parseInt(hStr, 10) || 0));
  const m = Math.min(59, Math.max(0, parseInt(mStr, 10) || 0));
  const d = new Date(baseDate.getTime());
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * Format a Date to "HH:MM" (24-hour, local) for use with <input type="time">.
 * @param {Date} date
 * @returns {string}
 */
export function dateToTimeStr(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "08:00";
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Compute display times for all slots in a single day.
 * Returns an array parallel to day.slots with { performStart: Date, slotMins: number } per slot.
 * Break slots always consume BREAK_DURATION_MINS of the timeline gap.
 *
 * @param {{ startDate: Date, startTime: string, slots: Array<{type:string, ensembleId:string|null}> }} day
 * @param {(ensembleId: string) => string} getGrade  returns grade string for an ensembleId
 * @returns {Array<{ performStart: Date, slotMins: number }>}
 */
export function computeDaySlotTimes(day, getGrade) {
  const { startDate, startTime, slots } = day;
  const anchor = applyTimeToDate(startDate, startTime);
  const times = [];
  let cursor = anchor.getTime();

  for (const slot of slots) {
    if (slot.type === "break") {
      times.push({ performStart: new Date(cursor), slotMins: BREAK_DURATION_MINS });
      cursor += BREAK_DURATION_MINS * 60 * 1000;
    } else {
      const grade = slot.ensembleId ? getGrade(slot.ensembleId) : null;
      const slotMins = getSlotMinutesForGrade(grade);
      times.push({ performStart: new Date(cursor), slotMins });
      cursor += slotMins * 60 * 1000;
    }
  }
  return times;
}

/**
 * Build the in-memory slot model from saved Firestore data.
 * If no schedule exists, returns a single empty day initialized to the event's startAt date.
 *
 * @param {Array<{id:string, ensembleId:string, performanceAt:any}>} scheduleEntries - sorted by performanceAt
 * @param {string[]} scheduleBreaks - entry IDs followed by a 30-min break
 * @param {Object<string,any>} scheduleDayBreaks - entry ID → timestamp of next day start
 * @param {Date|null} eventStartAt - fallback date for empty schedule
 * @returns {{ days: Array<{dateLabel:string, startDate:Date, startTime:string, slots:Array}> }}
 */
export function buildSlotModelFromFirestore(scheduleEntries, scheduleBreaks, scheduleDayBreaks, eventStartAt) {
  const entries = Array.isArray(scheduleEntries) ? scheduleEntries.filter((e) => e.hidden !== true) : [];
  const breakSet = new Set(Array.isArray(scheduleBreaks) ? scheduleBreaks : []);
  const dayBreakIds = new Set(
    scheduleDayBreaks && typeof scheduleDayBreaks === "object" ? Object.keys(scheduleDayBreaks) : []
  );

  if (!entries.length) {
    const fallbackDate = eventStartAt instanceof Date && !Number.isNaN(eventStartAt.getTime())
      ? eventStartAt
      : new Date();
    return {
      days: [
        {
          dateLabel: fallbackDate.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
          startDate: new Date(fallbackDate.getFullYear(), fallbackDate.getMonth(), fallbackDate.getDate()),
          startTime: "08:00",
          slots: [],
        },
      ],
    };
  }

  // Group consecutive entries by calendar day (local date).
  // A day boundary is triggered when scheduleDayBreaks has the previous entry's id.
  const days = [];
  let currentDaySlots = [];
  let currentDayDate = null;
  let currentDayStartTime = "08:00";

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const perfAt = toDate(entry.performanceAt);
    if (!perfAt) continue;

    const entryDayDate = new Date(perfAt.getFullYear(), perfAt.getMonth(), perfAt.getDate());

    if (currentDayDate === null) {
      currentDayDate = entryDayDate;
      currentDayStartTime = dateToTimeStr(perfAt);
    } else if (entryDayDate.getTime() !== currentDayDate.getTime()) {
      // New calendar day — flush current
      days.push(makeDayRecord(currentDayDate, currentDayStartTime, currentDaySlots));
      currentDayDate = entryDayDate;
      currentDayStartTime = dateToTimeStr(perfAt);
      currentDaySlots = [];
    }

    currentDaySlots.push({ type: "ensemble", ensembleId: entry.ensembleId || entry.id });

    if (dayBreakIds.has(entry.id)) {
      // End of day — flush on next iteration (handled by date change above)
    } else if (breakSet.has(entry.id)) {
      currentDaySlots.push({ type: "break" });
    }
  }

  if (currentDayDate && currentDaySlots.length) {
    days.push(makeDayRecord(currentDayDate, currentDayStartTime, currentDaySlots));
  }

  return { days: days.length ? days : [makeEmptyDay(eventStartAt)] };
}

function makeDayRecord(startDate, startTime, slots) {
  return {
    dateLabel: startDate.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
    startDate: new Date(startDate.getTime()),
    startTime,
    slots: [...slots],
  };
}

function makeEmptyDay(eventStartAt) {
  const base = eventStartAt instanceof Date && !Number.isNaN(eventStartAt.getTime())
    ? eventStartAt : new Date();
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  return makeDayRecord(d, "08:00", []);
}

function toDate(val) {
  if (!val) return null;
  if (typeof val.toDate === "function") return val.toDate();
  if (val instanceof Date) return val;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Serialize the slot model into the three Firestore fields and a rows list
 * ready for importConfirmedScheduleRows().
 *
 * @param {{ days: Array }} model
 * @param {Map<string, { schoolId:string, schoolName:string, ensembleName:string, grade:string }>} entryMeta
 * @returns {{
 *   rows: Array<{ensembleId, schoolId, schoolName, ensembleName, performanceAtDate, orderIndex}>,
 *   firstPerformanceAt: Date|null,
 *   scheduleBreaks: string[],
 *   scheduleDayBreaks: Object<string, Date>,
 * }}
 */
export function serializeSlotModel(model, entryMeta) {
  const rows = [];
  const scheduleBreaks = [];
  const scheduleDayBreaks = {};
  let firstPerformanceAt = null;
  let orderIndex = 1;

  const days = Array.isArray(model?.days) ? model.days : [];

  for (let d = 0; d < days.length; d++) {
    const day = days[d];
    const getGrade = (ensembleId) => entryMeta.get(ensembleId)?.grade || "";
    const times = computeDaySlotTimes(day, getGrade);

    let lastEnsembleRowId = null;

    for (let s = 0; s < day.slots.length; s++) {
      const slot = day.slots[s];
      if (slot.type === "break") continue; // breaks are captured via scheduleBreaks on the preceding row

      if (!slot.ensembleId) continue; // empty placeholder — skip

      const meta = entryMeta.get(slot.ensembleId) || {};
      const performStart = times[s]?.performStart;
      if (!performStart) continue;

      if (!firstPerformanceAt) firstPerformanceAt = performStart;

      // Assign a stable temp ID we'll use to reference breaks & day breaks.
      // The real Firestore ID is generated by importConfirmedScheduleRows.
      const tempId = `slot_d${d}_s${s}`;

      rows.push({
        tempId,
        ensembleId: slot.ensembleId,
        schoolId: meta.schoolId || "",
        schoolName: meta.schoolName || "",
        ensembleName: meta.ensembleName || slot.ensembleId,
        performanceAtDate: performStart,
        orderIndex: orderIndex++,
      });

      // Check if next slot is a break
      const nextSlot = day.slots[s + 1];
      if (nextSlot?.type === "break") {
        scheduleBreaks.push(tempId);
      }

      lastEnsembleRowId = tempId;
    }

    // If there is a next day, mark the last ensemble of this day as a day break
    if (d < days.length - 1 && lastEnsembleRowId) {
      const nextDay = days[d + 1];
      const nextDayStart = applyTimeToDate(nextDay.startDate, nextDay.startTime);
      scheduleDayBreaks[lastEnsembleRowId] = nextDayStart;
    }
  }

  return { rows, firstPerformanceAt, scheduleBreaks, scheduleDayBreaks };
}

/**
 * Return the set of ensembleIds already placed in the model (ignoring empty slots).
 * @param {{ days: Array }} model
 * @returns {Set<string>}
 */
export function getScheduledEnsembleIds(model) {
  const ids = new Set();
  for (const day of (model?.days || [])) {
    for (const slot of (day.slots || [])) {
      if (slot.type === "ensemble" && slot.ensembleId) ids.add(slot.ensembleId);
    }
  }
  return ids;
}

/**
 * Count only ensemble slots (not breaks) across all days.
 * @param {{ days: Array }} model
 * @returns {number}
 */
export function countEnsembleSlots(model) {
  let count = 0;
  for (const day of (model?.days || [])) {
    for (const slot of (day.slots || [])) {
      if (slot.type === "ensemble") count++;
    }
  }
  return count;
}

/**
 * Validate the model. Returns an array of error strings (empty = valid).
 * @param {{ days: Array }} model
 * @returns {string[]}
 */
export function validateSlotModel(model) {
  const errors = [];
  const seen = new Map(); // ensembleId → "Day N slot M"
  const days = model?.days || [];

  if (!days.length) {
    errors.push("At least one day is required.");
    return errors;
  }

  for (let d = 0; d < days.length; d++) {
    const day = days[d];
    if (!day.startTime) {
      errors.push(`Day ${d + 1}: start time is required.`);
    }
    for (let s = 0; s < (day.slots || []).length; s++) {
      const slot = day.slots[s];
      if (slot.type !== "ensemble") continue;
      if (!slot.ensembleId) continue;
      const label = `Day ${d + 1} slot ${s + 1}`;
      if (seen.has(slot.ensembleId)) {
        errors.push(`Ensemble appears twice: ${label} and ${seen.get(slot.ensembleId)}.`);
      } else {
        seen.set(slot.ensembleId, label);
      }
    }
  }
  return errors;
}
