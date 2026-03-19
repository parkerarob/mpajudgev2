import { normalizeEnsembleNameForSchool, toDateLike } from "./utils.js";

export function escapeHtml(s) {
  if (s == null) return "";
  const t = String(s);
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function normalizeEnsembleDisplayName({ schoolName, ensembleName, ensembleId }) {
  const fallback = String(ensembleName || ensembleId || "").trim();
  return normalizeEnsembleNameForSchool({
    schoolName: String(schoolName || "").trim(),
    ensembleName: fallback,
  }) || fallback;
}

export function formatSchoolEnsembleLabel({ schoolName, ensembleName, ensembleId }) {
  const school = String(schoolName || "").trim();
  const ensemble = normalizeEnsembleDisplayName({ schoolName: school, ensembleName, ensembleId });
  if (school && ensemble) return `${school} ${ensemble}`;
  return school || ensemble || "—";
}

export function formatTimeRange(startDate, endDate) {
  if (!startDate || !endDate) return "";
  const start = startDate instanceof Date ? startDate : startDate.toDate?.() || new Date(startDate);
  const end = endDate instanceof Date ? endDate : endDate.toDate?.() || new Date(endDate);
  const opts = { hour: "2-digit", minute: "2-digit" };
  return `${start.toLocaleTimeString([], opts)} - ${end.toLocaleTimeString([], opts)}`;
}

export function toLocalDatetimeValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}`;
}

export function formatStartTime(dateLike) {
  const d = dateLike instanceof Date ? dateLike : dateLike?.toDate?.() || new Date(dateLike);
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function toDateSafe(value) {
  if (!value) return null;
  if (value?.toDate) {
    const d = value.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayKeyLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Build automatic day anchors from sorted schedule rows so each day's first
 * performance stays fixed to its saved performanceAt.
 * @param {Array<{id:string, performanceAt:any}>} sortedScheduleRows
 * @returns {Object<string, Date>}
 */
export function deriveAutoScheduleDayBreaks(sortedScheduleRows = []) {
  const merged = {};
  if (!Array.isArray(sortedScheduleRows) || sortedScheduleRows.length < 2) return merged;
  let prevKey = null;
  let prevId = null;
  sortedScheduleRows.forEach((row) => {
    const date = toDateSafe(row?.performanceAt);
    if (!date || !row?.id) return;
    const key = dayKeyLocal(date);
    if (prevKey !== null && key !== prevKey && prevId) {
      merged[prevId] = new Date(date.getTime());
    }
    prevKey = key;
    prevId = row.id;
  });
  return merged;
}

/**
 * Explicit persisted day breaks win; auto-derived fills missing boundaries.
 * @param {Object<string, any>} explicitDayBreaks
 * @param {Object<string, Date>} autoDayBreaks
 * @returns {Object<string, any>}
 */
export function mergeScheduleDayBreaks(explicitDayBreaks = {}, autoDayBreaks = {}) {
  return {
    ...(autoDayBreaks && typeof autoDayBreaks === "object" ? autoDayBreaks : {}),
    ...(explicitDayBreaks && typeof explicitDayBreaks === "object" ? explicitDayBreaks : {}),
  };
}

export function getEntryLunchRequestCount(entry = {}) {
  const lunchOrder = entry?.lunchOrder || {};
  const cheese = Number(lunchOrder.cheeseQty) || 0;
  const pepperoni = Number(lunchOrder.pepperoniQty) || 0;
  const fromOrder = cheese + pepperoni;
  const fromCount = Number(entry?.lunchCount) || 0;
  return Math.max(fromOrder, fromCount, 0);
}

export function toDateOrNull(value) {
  return toDateLike(value);
}

export function isDirectorNafmeValid(profile = {}) {
  const membership = String(profile.nafmeMembershipNumber || "").trim();
  if (!membership) return false;
  const expDate = toDateOrNull(profile.nafmeMembershipExp);
  if (!expDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return expDate.getTime() >= today.getTime();
}

export function computeEnsembleCheckinStatus({ entry = {}, directorProfile = {} }) {
  const lunchRequired = getEntryLunchRequestCount(entry) > 0;
  const nafmeValidFromProfile = isDirectorNafmeValid(directorProfile);
  const nafmeManualVerified = Boolean(entry.checkinNafmeManualVerified);
  const nafmeValid = nafmeValidFromProfile || nafmeManualVerified;
  const scoresReceived = Boolean(entry.checkinScoresReceived);
  const changesReviewed = Boolean(entry.checkinChangesReviewed);
  const lunchConfirmed = lunchRequired ? Boolean(entry.checkinLunchConfirmed) : true;
  const checkedIn = nafmeValid && scoresReceived && changesReviewed && lunchConfirmed;
  return {
    nafmeValidFromProfile,
    nafmeManualVerified,
    nafmeValid,
    scoresReceived,
    changesReviewed,
    lunchRequired,
    lunchConfirmed,
    checkedIn,
  };
}

export function computeEnsembleCheckinProgress(checkin = {}) {
  const completed = [
    Boolean(checkin.nafmeValid),
    Boolean(checkin.scoresReceived),
    Boolean(checkin.changesReviewed),
    ...(checkin.lunchRequired ? [Boolean(checkin.lunchConfirmed)] : []),
  ].filter(Boolean).length;
  const total = checkin.lunchRequired ? 4 : 3;
  return { completed, total };
}
