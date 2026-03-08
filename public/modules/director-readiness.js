import { normalizeGrade } from "./utils.js";

function isMasterworkSelection(selection, mpaCacheByGrade) {
  const id = selection?.pieceId || null;
  const grade = normalizeGrade(selection?.grade);
  if (!id || !grade) return false;
  const options = mpaCacheByGrade instanceof Map ? mpaCacheByGrade.get(grade) || [] : [];
  const match = options.find((item) => item.id === id);
  if (!match) return false;
  if (match.isMasterwork) return true;
  const haystack = `${match.specialInstructions || ""} ${match.status || ""} ${Array.isArray(match.tags) ? match.tags.join(" ") : ""}`.toLowerCase();
  return haystack.includes("masterwork") || haystack.includes("mw*");
}

export function computeDirectorReadiness(entry, context = {}) {
  const selectedEnsembleId = context.selectedEnsembleId || null;
  const hasSchool = Boolean(context.hasSchool);
  const mpaCacheByGrade = context.mpaCacheByGrade instanceof Map ? context.mpaCacheByGrade : new Map();
  const issues = [];

  const hasEnsemble = Boolean(selectedEnsembleId);
  if (!hasSchool) issues.push("Select a school.");
  if (!hasEnsemble) issues.push("Select an ensemble.");

  const repertoireRuleMode = entry?.repertoire?.repertoireRuleMode === "masterwork" ? "masterwork" : "standard";
  const marchTitle = entry?.repertoire?.march?.title?.trim();
  const selection1Title = entry?.repertoire?.selection1?.title?.trim();
  const selection2Title = entry?.repertoire?.selection2?.title?.trim();
  const selection1Grade = entry?.repertoire?.selection1?.grade;
  const selection2Grade = entry?.repertoire?.selection2?.grade;
  const hasSelection1 = Boolean(selection1Title) && Boolean(selection1Grade);
  const hasSelection2 = Boolean(selection2Title) && Boolean(selection2Grade);

  let repertoireComplete = false;
  if (repertoireRuleMode === "masterwork") {
    const selection1Masterwork = hasSelection1 &&
      isMasterworkSelection(entry?.repertoire?.selection1, mpaCacheByGrade);
    repertoireComplete = Boolean(marchTitle) && hasSelection1 && selection1Masterwork;
    if (!marchTitle) issues.push("March title is required.");
    if (!hasSelection1) issues.push("Masterwork Exception requires Selection #1.");
    if (hasSelection1 && !selection1Masterwork) {
      issues.push("Masterwork Exception requires Selection #1 to be a Masterwork.");
    }
  } else {
    repertoireComplete =
      Boolean(marchTitle) &&
      hasSelection1 &&
      hasSelection2;
    if (!marchTitle) issues.push("March title is required.");
    if (!selection1Grade) issues.push("Grade level is required for Selection #1.");
    if (!selection1Title) issues.push("Title is required for Selection #1.");
    if (!selection2Grade) issues.push("Grade level is required for Selection #2.");
    if (!selection2Title) issues.push("Title is required for Selection #2.");
  }

  const standardCounts = entry?.instrumentation?.standardCounts || {};
  const hasStandardCount = Object.values(standardCounts).some((value) => Number(value) > 0);
  const instrumentationComplete = hasStandardCount;
  if (!instrumentationComplete) {
    issues.push("Instrumentation and seating counts are required.");
  }

  const seatingComplete = Boolean(
    entry?.seating && Array.isArray(entry.seating.rows) && entry.seating.rows.length > 0
  );
  if (!seatingComplete) {
    issues.push("Instrumentation and seating counts are required.");
  }

  const percussionComplete = Boolean(
    entry?.percussionNeeds && Array.isArray(entry.percussionNeeds.selected)
  );
  if (!percussionComplete) {
    issues.push("Percussion needs must be saved.");
  }

  const lunchPepperoni = Number(entry?.lunchOrder?.pepperoniQty || 0);
  const lunchCheese = Number(entry?.lunchOrder?.cheeseQty || 0);
  const lunchCount = lunchPepperoni + lunchCheese;
  const lunchTiming = String(entry?.lunchOrder?.pickupTiming || "");
  const lunchComplete = Boolean(entry?.lunchOrder) && (lunchCount > 0 ? Boolean(lunchTiming) : true);
  if (!entry?.lunchOrder) {
    issues.push("Pizza order must be saved.");
  } else if (lunchCount > 0 && !lunchTiming) {
    issues.push("Select whether pizza is needed before or after performance time.");
  }

  const gradeComputed = Boolean(entry?.performanceGrade?.trim?.());

  const ready =
    hasSchool &&
    hasEnsemble &&
    repertoireComplete &&
    instrumentationComplete &&
    seatingComplete &&
    percussionComplete &&
    lunchComplete &&
    gradeComputed;

  return {
    flags: {
      ensemble: hasEnsemble,
      repertoire: repertoireComplete,
      instrumentation: instrumentationComplete,
      seating: seatingComplete,
      percussion: percussionComplete,
      lunch: lunchComplete,
      grade: gradeComputed,
      ready,
    },
    issues: Array.from(new Set(issues)),
  };
}
