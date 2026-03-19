import { normalizeEnsembleNameForSchool, normalizeGradeBand, toDateLike } from "./utils.js";

function escapeHtml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseCsvLine(line = "") {
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\"") {
      const nextChar = line[i + 1];
      if (inQuotes && nextChar === "\"") {
        current += "\"";
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells.map((cell) => String(cell || "").trim());
}

function canonicalizeName(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/\bhigh school\b/g, "hs")
    .replace(/\bmiddle school\b/g, "ms")
    .replace(/\belementary school\b/g, "es")
    .replace(/\bconcert band\b/g, "concertband")
    .replace(/\bsymphonic band\b/g, "symphonicband")
    .replace(/\bwind ensemble\b/g, "windensemble")
    .replace(/\bband\b/g, "band")
    .replace(/[^a-z0-9]/g, "");
}

function extractScheduleDate(raw = "", defaultYear = new Date().getFullYear()) {
  const text = String(raw || "").trim();
  const match = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\b/i
  );
  if (!match) return null;
  const parsed = new Date(`${match[1]} ${match[2]}, ${defaultYear} 12:00 PM`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function combineDateAndTime(baseDate, timeText) {
  if (!(baseDate instanceof Date) || Number.isNaN(baseDate.getTime())) return null;
  const parsed = new Date(`${baseDate.toDateString()} ${String(timeText || "").trim()}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseConfirmedScheduleCsv(text, { defaultYear } = {}) {
  const rows = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => parseCsvLine(line));

  const result = [];
  let sectionDate = null;
  let sectionLabel = "";

  rows.forEach((row, rowIndex) => {
    const cells = row.filter(Boolean);
    if (!cells.length) return;
    const firstCell = String(row[0] || "").trim();
    const fullText = cells.join(" ").trim();

    const detectedDate = extractScheduleDate(fullText, defaultYear);
    if (detectedDate) {
      sectionDate = detectedDate;
      sectionLabel = fullText;
    }

    const isDataRow = /^\d+$/.test(firstCell) && String(row[1] || "").trim();
    if (!isDataRow) return;

    const bandName = String(row[1] || "").trim();
    const grade = String(row[2] || row[3] || "").trim();
    const performanceTime = String(row[6] || "").trim();
    const performanceAt = combineDateAndTime(sectionDate, performanceTime);

    result.push({
      csvRowNumber: rowIndex + 1,
      orderIndex: result.length + 1,
      sectionLabel,
      sectionDate,
      rowNumber: Number(firstCell),
      bandName,
      grade,
      performanceTime,
      performanceAt,
      rawRow: row,
    });
  });

  return result;
}

function buildCandidateMap({
  registeredEntries = [],
  scheduleEntries = [],
  schoolsList = [],
  getSchoolNameById,
  normalizeEnsembleDisplayName,
} = {}) {
  const scheduleByEnsemble = new Map(
    (Array.isArray(scheduleEntries) ? scheduleEntries : []).map((entry) => [entry.ensembleId || entry.id, entry])
  );

  return (Array.isArray(registeredEntries) ? registeredEntries : []).map((entry) => {
    const ensembleId = String(entry.ensembleId || entry.id || "").trim();
    const schoolId = String(entry.schoolId || "").trim();
    const schoolName = getSchoolNameById(schoolsList, schoolId) || schoolId || "Unknown school";
    const ensembleName = normalizeEnsembleDisplayName({
      schoolName,
      ensembleName: entry.ensembleName || entry.name || "",
      ensembleId,
    }) || ensembleId;
    const fullLabel = `${schoolName} ${ensembleName}`.trim();
    const existingSchedule = scheduleByEnsemble.get(ensembleId) || null;
    return {
      entry,
      schoolId,
      schoolName,
      ensembleId,
      ensembleName,
      fullLabel,
      grade: normalizeGradeBand(entry.declaredGradeLevel || entry.performanceGrade || ""),
      existingScheduleEntryId: existingSchedule?.id || "",
      existingPerformanceAt: toDateLike(existingSchedule?.performanceAt),
      canonicalFull: canonicalizeName(fullLabel),
      canonicalEnsemble: canonicalizeName(ensembleName),
    };
  });
}

function scoreCandidate(csvRow, candidate) {
  const csvBandCanonical = canonicalizeName(csvRow.bandName);
  const csvEnsembleCanonical = canonicalizeName(
    normalizeEnsembleNameForSchool({
      schoolName: candidate.schoolName,
      ensembleName: csvRow.bandName,
    })
  );
  const candidateGrade = normalizeGradeBand(candidate.grade || "");
  const csvGrade = normalizeGradeBand(csvRow.grade || "");
  let score = 0;

  if (csvBandCanonical && csvBandCanonical === candidate.canonicalFull) score = Math.max(score, 100);
  if (csvEnsembleCanonical && csvEnsembleCanonical === candidate.canonicalEnsemble) {
    score = Math.max(score, csvBandCanonical.includes(canonicalizeName(candidate.schoolName)) ? 96 : 88);
  }
  if (csvBandCanonical && csvBandCanonical === candidate.canonicalEnsemble) {
    score = Math.max(score, 72);
  }
  if (csvBandCanonical && candidate.canonicalFull && (
    csvBandCanonical.includes(candidate.canonicalFull) || candidate.canonicalFull.includes(csvBandCanonical)
  )) {
    score = Math.max(score, 68);
  }
  if (csvEnsembleCanonical && candidate.canonicalEnsemble && (
    csvEnsembleCanonical.includes(candidate.canonicalEnsemble) ||
    candidate.canonicalEnsemble.includes(csvEnsembleCanonical)
  )) {
    score = Math.max(score, 64);
  }
  if (csvGrade && candidateGrade && csvGrade === candidateGrade) {
    score += 2;
  }

  return score;
}

export function buildConfirmedSchedulePreview({
  csvRows = [],
  registeredEntries = [],
  scheduleEntries = [],
  schoolsList = [],
  getSchoolNameById,
  normalizeEnsembleDisplayName,
} = {}) {
  const candidates = buildCandidateMap({
    registeredEntries,
    scheduleEntries,
    schoolsList,
    getSchoolNameById,
    normalizeEnsembleDisplayName,
  });

  return (Array.isArray(csvRows) ? csvRows : []).map((row) => {
    const ranked = candidates
      .map((candidate) => ({ ...candidate, score: scoreCandidate(row, candidate) }))
      .filter((candidate) => candidate.score >= 60)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.fullLabel.localeCompare(b.fullLabel);
      })
      .slice(0, 8);

    const top = ranked[0] || null;
    const second = ranked[1] || null;
    const autoSelected =
      top && (!second || top.score - second.score >= 6) && top.score >= 88
        ? top.ensembleId
        : "";

    return {
      ...row,
      matchedEnsembleId: autoSelected,
      status: autoSelected ? "matched" : ranked.length ? "needs_review" : "unmatched",
      allCandidates: [...candidates]
        .sort((a, b) => a.fullLabel.localeCompare(b.fullLabel))
        .map((candidate) => ({
          schoolId: candidate.schoolId,
          schoolName: candidate.schoolName,
          ensembleId: candidate.ensembleId,
          ensembleName: candidate.ensembleName,
          fullLabel: candidate.fullLabel,
          grade: candidate.grade || "",
          score: candidate.score || 0,
          existingScheduleEntryId: candidate.existingScheduleEntryId,
          existingPerformanceAt: candidate.existingPerformanceAt,
        })),
      candidates: ranked.map((candidate) => ({
        schoolId: candidate.schoolId,
        schoolName: candidate.schoolName,
        ensembleId: candidate.ensembleId,
        ensembleName: candidate.ensembleName,
        fullLabel: candidate.fullLabel,
        grade: candidate.grade || "",
        score: candidate.score,
        existingScheduleEntryId: candidate.existingScheduleEntryId,
        existingPerformanceAt: candidate.existingPerformanceAt,
      })),
    };
  });
}

export function summarizeConfirmedSchedulePreview(previewRows = []) {
  const rows = Array.isArray(previewRows) ? previewRows : [];
  const selected = rows.filter((row) => row.matchedEnsembleId).length;
  const unmatched = rows.filter((row) => row.status === "unmatched").length;
  const needsReview = rows.filter((row) => row.status === "needs_review").length;
  const selectedIds = rows.map((row) => row.matchedEnsembleId).filter(Boolean);
  const duplicateIds = new Set(
    selectedIds.filter((ensembleId, index) => selectedIds.indexOf(ensembleId) !== index)
  );
  return {
    total: rows.length,
    selected,
    unmatched,
    needsReview,
    duplicateCount: duplicateIds.size,
    canApply: rows.length > 0 && selected === rows.length && unmatched === 0 && needsReview === 0 && duplicateIds.size === 0,
  };
}

export function buildProgramRows({
  scheduleEntries = [],
  registeredEntries = [],
  directorProfiles = [],
  schoolsList = [],
  getSchoolNameById,
  normalizeEnsembleDisplayName,
} = {}) {
  const entryMap = new Map(
    (Array.isArray(registeredEntries) ? registeredEntries : []).map((entry) => [entry.ensembleId || entry.id, entry])
  );
  const directorsBySchool = new Map();
  (Array.isArray(directorProfiles) ? directorProfiles : []).forEach((profile) => {
    const isDirector = profile.role === "director" || profile.roles?.director === true;
    const schoolId = String(profile.schoolId || "").trim();
    if (!isDirector || !schoolId || directorsBySchool.has(schoolId)) return;
    directorsBySchool.set(schoolId, profile);
  });

  return (Array.isArray(scheduleEntries) ? scheduleEntries : [])
    .map((scheduleEntry, index) => {
      const ensembleId = String(scheduleEntry.ensembleId || scheduleEntry.id || "").trim();
      const entry = entryMap.get(ensembleId) || {};
      const schoolId = String(scheduleEntry.schoolId || entry.schoolId || "").trim();
      const schoolName =
        scheduleEntry.schoolName ||
        entry.schoolName ||
        getSchoolNameById(schoolsList, schoolId) ||
        schoolId ||
        "Unknown school";
      const ensembleName = normalizeEnsembleDisplayName({
        schoolName,
        ensembleName: scheduleEntry.ensembleName || entry.ensembleName || "",
        ensembleId,
      }) || ensembleId;
      const director = directorsBySchool.get(schoolId) || {};
      const repertoire = entry.repertoire || {};
      const programLines = [repertoire.march, repertoire.selection1, repertoire.selection2]
        .map((piece) => {
          const title = String(piece?.title || "").trim();
          const composer = String(piece?.composer || "").trim();
          if (!title) return "";
          return composer ? `${title} - ${composer}` : title;
        })
        .filter(Boolean);

      return {
        orderIndex: Number.isFinite(Number(scheduleEntry.orderIndex))
          ? Number(scheduleEntry.orderIndex)
          : index + 1,
        performanceAt: toDateLike(scheduleEntry.performanceAt),
        schoolName,
        ensembleName,
        directorName: String(director.displayName || director.email || "").trim(),
        grade: normalizeGradeBand(entry.declaredGradeLevel || entry.performanceGrade || "") || "",
        programLines,
      };
    })
    .sort((a, b) => {
      const aTime = a.performanceAt?.getTime?.() || 0;
      const bTime = b.performanceAt?.getTime?.() || 0;
      if (aTime !== bTime) return aTime - bTime;
      return a.orderIndex - b.orderIndex;
    });
}

export function buildProgramCsv(rows = []) {
  const header = [
    "Date",
    "Performance Time",
    "School",
    "Ensemble",
    "Director",
    "Grade",
    "Program 1",
    "Program 2",
    "Program 3",
  ];
  const csvRows = [header];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const dateLabel = row.performanceAt
      ? row.performanceAt.toLocaleDateString([], { year: "numeric", month: "2-digit", day: "2-digit" })
      : "";
    const timeLabel = row.performanceAt
      ? row.performanceAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : "";
    csvRows.push([
      dateLabel,
      timeLabel,
      row.schoolName || "",
      row.ensembleName || "",
      row.directorName || "",
      row.grade || "",
      row.programLines?.[0] || "",
      row.programLines?.[1] || "",
      row.programLines?.[2] || "",
    ]);
  });
  return csvRows
    .map((row) => row.map((cell) => `"${String(cell || "").replace(/"/g, "\"\"")}"`).join(","))
    .join("\n");
}

export function buildProgramHtml({ eventName = "Program", rows = [] } = {}) {
  const safeEventName = String(eventName || "Program");
  const dates = (Array.isArray(rows) ? rows : [])
    .map((row) => row.performanceAt)
    .filter((value) => value instanceof Date && !Number.isNaN(value.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  const firstDate = dates[0] || null;
  const lastDate = dates[dates.length - 1] || null;
  const sameDay = firstDate && lastDate &&
    firstDate.getFullYear() === lastDate.getFullYear() &&
    firstDate.getMonth() === lastDate.getMonth() &&
    firstDate.getDate() === lastDate.getDate();
  const dateLabel = firstDate
    ? sameDay
      ? firstDate.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })
      : `${firstDate.toLocaleDateString([], { month: "long", day: "numeric" })} - ${lastDate.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })}`
    : "Date TBD";
  const venueName = "Minnie Evans Arts Center at Ashley High School";
  const venueCity = "Wilmington, North Carolina";

  const groupedRows = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = row.performanceAt
      ? row.performanceAt.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })
      : "Schedule";
    if (!groupedRows.has(key)) groupedRows.set(key, []);
    groupedRows.get(key).push(row);
  });

  const sectionsHtml = Array.from(groupedRows.entries()).map(([heading, sectionRows]) => {
    const bodyHtml = sectionRows.map((row) => {
      const timeLabel = row.performanceAt
        ? row.performanceAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : "Time TBD";
      const programHtml = row.programLines?.length
        ? row.programLines.map((line) => `<div class="program-line">${escapeHtml(line)}</div>`).join("")
        : "<div class=\"muted\">Program not submitted</div>";
      return `
        <article class="program-entry">
          <div class="entry-grid">
            <div class="entry-time">${escapeHtml(timeLabel)}</div>
            <div class="entry-grade">Grade: ${escapeHtml(row.grade || "—")}</div>
            <div class="entry-ensemble">${escapeHtml(row.schoolName || "")} ${escapeHtml(row.ensembleName || "")}</div>
            <div class="entry-spacer"></div>
            <div class="entry-spacer"></div>
            <div class="entry-director">Director(s): ${escapeHtml(row.directorName || "Not listed")}</div>
            <div class="entry-spacer"></div>
            <div class="entry-spacer"></div>
            <div class="entry-program">${programHtml}</div>
          </div>
        </article>
      `;
    }).join("");

    return `
      <section class="program-section">
        <h2>${escapeHtml(heading)}</h2>
        <div class="program-entry-list">${bodyHtml}</div>
      </section>
    `;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(safeEventName)} Program</title>
  <style>
    body { font-family: "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif; margin: 0; color: #111; background: #fff; }
    .page { page-break-after: always; min-height: 100vh; box-sizing: border-box; }
    .page:last-child { page-break-after: auto; }
    .cover { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 28px 36px 36px; gap: 20px; }
    .cover-kicker { font-size: 26px; line-height: 1.2; }
    .cover-title { font-size: 30px; line-height: 1.16; max-width: 820px; }
    .cover-logo { width: 520px; max-width: 84vw; height: auto; }
    .cover-date { font-size: 28px; line-height: 1.2; }
    .cover-venue { font-size: 26px; line-height: 1.22; max-width: 860px; }
    .cover-city { font-size: 20px; line-height: 1.2; }
    .content { padding: 0.6in; }
    h1 { margin: 0 0 6px; font-size: 28px; text-align: center; }
    .subtitle { margin: 0 0 24px; color: #444; text-align: center; }
    h2 { margin: 28px 0 18px; font-size: 22px; text-align: center; text-decoration: underline; text-underline-offset: 4px; }
    .program-entry-list { display: flex; flex-direction: column; gap: 22px; }
    .program-entry { break-inside: avoid; page-break-inside: avoid; }
    .entry-grid { display: grid; grid-template-columns: 92px 92px minmax(0, 560px); column-gap: 16px; row-gap: 2px; max-width: 780px; margin: 0 auto; align-items: start; justify-content: center; }
    .entry-time { font-size: 14px; text-align: left; }
    .entry-grade { font-size: 14px; text-align: left; }
    .entry-ensemble { font-size: 16px; line-height: 1.3; text-align: left; }
    .entry-director { font-size: 14px; line-height: 1.25; text-align: left; padding-left: 26px; }
    .entry-program { margin-top: 2px; font-size: 14px; line-height: 1.25; text-align: left; padding-left: 26px; }
    .entry-spacer { min-height: 1px; }
    .program-line { margin: 1px 0; }
    .muted { color: #666; }
    .actions { position: sticky; top: 0; background: #fff; padding: 12px 16px; border-bottom: 1px solid #ddd; text-align: right; }
    button { font: inherit; padding: 8px 12px; }
    @media print {
      .actions { display: none; }
      .content { padding: 0; }
      @page { margin: 0.6in; }
    }
  </style>
</head>
<body>
  <div class="actions"><button onclick="window.print()">Print</button></div>
  <section class="page cover">
    <div class="cover-kicker">North Carolina Bandmasters Association</div>
    <div class="cover-title">${escapeHtml(safeEventName)}<br>Music Performance Adjudication</div>
    <img class="cover-logo" src="/ncba-logo.png" alt="North Carolina Bandmasters Association logo">
    <div class="cover-date">${escapeHtml(dateLabel)}</div>
    <div class="cover-venue">${escapeHtml(venueName)}</div>
    <div class="cover-city">${escapeHtml(venueCity)}</div>
  </section>
  <section class="page content">
    <h1>${escapeHtml(safeEventName)}</h1>
    <p class="subtitle">Generated from the active event schedule and current repertoire submissions.</p>
    ${sectionsHtml}
  </section>
</body>
</html>`;
}
