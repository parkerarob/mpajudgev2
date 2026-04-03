import {
  WALKTHROUGH_STEP_KEYS,
  computeReadinessControlState,
  isMissingWalkthroughCallableError,
  shouldRetryBulkResetCallable,
} from "./readiness-walkthrough.js";
import { getAdminHashForView } from "./admin-navigation.js";

export function createAdminHandlerBinder({
  els,
  state,
  windowObj,
  isAdminLiveEventEnabled,
  isAdminSettingsEnabled,
  applyAdminView,
  closeAdminSchoolDetail,
  renderAdminPacketsBySchedule,
  renderAdminLiveSubmissions,
  confirmUser,
  alertUser,
  createEvent,
  saveAssignments,
  runEventPreflight,
  markReadinessStep,
  setReadinessWalkthrough,
  renderAdminReadinessView,
  scheduleAdminPreflightRefresh,
  showStatusMessage,
  withLoading,
  saveSchool,
  resetAdminSchoolForm,
  getSelectedAdminSchool,
  deleteSchool,
  deleteEnsemble,
  bulkImportSchools,
  provisionUser,
  updateUserDisplayName,
  deleteUserAccount,
  saveJudgeBio,
  openJudgeBioModal,
  closeJudgeBioModal,
  renderAdminUsersDirectory,
  assignDirectorSchool,
  getSchoolNameById,
  unassignDirectorSchool,
  fetchRegisteredEnsembles,
  fetchScheduleEntries,
  buildProgramRows,
  buildProgramCsv,
  buildProgramHtml,
  getPacketData,
  publishPublicProgram,
  publishEventResultsOverviewPdf,
  collection,
  getDocs,
  query,
  db,
  COLLECTIONS,
  normalizeEnsembleDisplayName,
  } = {}) {
  let adminHandlersBound = false;
  const extractDeleteUserErrorMessage = (error) => {
    const blockers = Array.isArray(error?.details?.blockers) ? error.details.blockers : [];
    if (!blockers.length) {
      return error?.message || "Unable to delete user.";
    }
    const details = blockers.map((blocker) => `- ${blocker.message || blocker.code || "Unknown blocker"}`);
    return `Unable to delete user:\n${details.join("\n")}`;
  };

  const syncProvisionSchoolField = () => {
    const role = els.provisionRoleSelect?.value || "judge";
    const isDirector = role === "director";
    if (els.provisionSchoolSelect) {
      els.provisionSchoolSelect.disabled = !isDirector;
      if (!isDirector) {
        els.provisionSchoolSelect.value = "";
      }
    }
  };

  const setReadinessControlsDisabled = (disabled) => {
    state.admin.readinessInFlight = Boolean(disabled);
    const hasActiveEvent = Boolean(state.event.active?.id);
    const controlState = computeReadinessControlState({
      hasActiveEvent,
      readinessInFlight: state.admin.readinessInFlight,
    });
    if (els.adminWalkthroughStartBtn) {
      els.adminWalkthroughStartBtn.disabled = controlState.walkthroughStart.disabled;
      els.adminWalkthroughStartBtn.title = controlState.walkthroughStart.title;
    }
    if (els.adminWalkthroughResetBtn) {
      els.adminWalkthroughResetBtn.disabled = controlState.walkthroughReset.disabled;
      els.adminWalkthroughResetBtn.title = controlState.walkthroughReset.title;
    }
    if (els.adminRunPreflightBtn) {
      els.adminRunPreflightBtn.disabled = controlState.runPreflight.disabled;
      els.adminRunPreflightBtn.title = controlState.runPreflight.title;
    }
    Array.from(document.querySelectorAll("[data-readiness-step]")).forEach((btn) => {
      btn.disabled = controlState.readinessStepsDisabled;
    });
    Array.from(document.querySelectorAll("[data-readiness-open-view]")).forEach((btn) => {
      btn.disabled = controlState.readinessOpenViewDisabled;
    });
  };
  const isReadinessBusy = () => Boolean(state.admin.readinessInFlight);

  const getActiveEvent = () => state.event.active || null;

  const loadProgramRows = async () => {
    const event = getActiveEvent();
    if (!event?.id) throw new Error("Set the active 2026 event first.");
    const [scheduleEntries, registeredEntries, usersSnap] = await Promise.all([
      fetchScheduleEntries(event.id),
      fetchRegisteredEnsembles(event.id),
      getDocs(query(collection(db, COLLECTIONS.users))),
    ]);
    const directorProfiles = usersSnap.docs.map((docSnap) => ({ uid: docSnap.id, ...docSnap.data() }));
    return buildProgramRows({
      scheduleEntries,
      registeredEntries,
      directorProfiles,
      schoolsList: state.admin.schoolsList,
      getSchoolNameById,
      normalizeEnsembleDisplayName,
    });
  };

  const getResultsRatingLabel = (submission, { commentsOnly = false } = {}) => {
    if (commentsOnly || submission?.commentsOnly) return "CO";
    return String(submission?.computedFinalRatingLabel || "").trim() || "N/A";
  };

  const formatJudgeHeaderName = (value) => {
    const text = String(value || "").trim();
    if (!text) return "";
    const parts = text.split(/\s+/).filter(Boolean);
    const last = parts[parts.length - 1] || "";
    return last.replace(/[^a-zA-Z'-]/g, "").toUpperCase();
  };

  const loadResultsOverviewRows = async () => {
    const event = getActiveEvent();
    if (!event?.id) throw new Error("Set the active 2026 event first.");
    const [scheduleEntries, registeredEntries, usersSnap] = await Promise.all([
      fetchScheduleEntries(event.id),
      fetchRegisteredEnsembles(event.id),
      getDocs(query(collection(db, COLLECTIONS.users))),
    ]);
    const directorProfiles = usersSnap.docs.map((docSnap) => ({ uid: docSnap.id, ...docSnap.data() }));
    const baseRows = buildProgramRows({
      scheduleEntries,
      registeredEntries,
      directorProfiles,
      schoolsList: state.admin.schoolsList,
      getSchoolNameById,
      normalizeEnsembleDisplayName,
    });
    const entriesByEnsembleId = new Map(
      (Array.isArray(registeredEntries) ? registeredEntries : [])
        .map((entry) => [String(entry.ensembleId || entry.id || "").trim(), entry])
        .filter(([ensembleId]) => ensembleId)
    );

    const rows = await Promise.all(baseRows.map(async (row) => {
      const ensembleId = String(row.ensembleId || "").trim();
      const entry = entriesByEnsembleId.get(ensembleId) || {
        ensembleId,
        schoolId: row.schoolId || "",
      };
      const packet = await getPacketData({ eventId: event.id, entry });
      const submissions = packet?.submissions || {};
      const summary = packet?.summary || {};
      const commentsOnly = Boolean(summary.commentsOnly);
      const requiredPositions = Array.isArray(summary.requiredPositions) ? summary.requiredPositions : [];
      const normalizedGrade = String(packet?.grade || row.grade || "")
        .trim()
        .toUpperCase()
        .replace(/[–—-]+/g, "/")
        .replace(/\s+/g, "");
      const repertoireText = (Array.isArray(row.programLines) ? row.programLines : [])
        .filter(Boolean)
        .join("\n");

      return {
        schoolName: row.schoolName || "",
        ensembleName: row.ensembleName || "",
        grade: packet?.grade || row.grade || "",
        repertoireText: repertoireText || "No repertoire saved.",
        stage1: getResultsRatingLabel(submissions.stage1, { commentsOnly }),
        stage1JudgeName: String(submissions.stage1?.judgeName || "").trim(),
        stage2: getResultsRatingLabel(submissions.stage2, { commentsOnly }),
        stage2JudgeName: String(submissions.stage2?.judgeName || "").trim(),
        stage3: getResultsRatingLabel(submissions.stage3, { commentsOnly }),
        stage3JudgeName: String(submissions.stage3?.judgeName || "").trim(),
        sight: commentsOnly
          ? "CO"
          : ["I", "I/II"].includes(normalizedGrade)
            ? "N/A"
            : requiredPositions.includes("sight")
              ? getResultsRatingLabel(submissions.sight, { commentsOnly })
              : "N/A",
        sightJudgeName: String(submissions.sight?.judgeName || "").trim(),
        overall: commentsOnly ? "CO" : String(summary?.overall?.label || "N/A"),
      };
    }));
    const judgeHeaders = {
      stage1: "",
      stage2: "",
      stage3: "",
      sight: "",
    };
    rows.forEach((row) => {
      if (!judgeHeaders.stage1 && row.stage1JudgeName) judgeHeaders.stage1 = row.stage1JudgeName;
      if (!judgeHeaders.stage2 && row.stage2JudgeName) judgeHeaders.stage2 = row.stage2JudgeName;
      if (!judgeHeaders.stage3 && row.stage3JudgeName) judgeHeaders.stage3 = row.stage3JudgeName;
      if (!judgeHeaders.sight && row.sightJudgeName) judgeHeaders.sight = row.sightJudgeName;
    });
    return {
      rows,
      judgeHeaders,
    };
  };

  const buildResultsOverviewPdf = ({ eventName, eventDateLabel, rows = [], judgeHeaders = {} } = {}) => {
    const pdfWidth = 792;
    const pdfHeight = 612;
    const left = 24;
    const right = pdfWidth - 24;
    const bottom = pdfHeight - 26;
    const columns = [
      { key: "ensembleName", label: "Ensemble", width: 170, align: "left" },
      { key: "grade", label: "Grade", width: 38, align: "center" },
      { key: "repertoireText", label: "Repertoire", width: 228, align: "left" },
      { key: "stage1", label: `S1-${formatJudgeHeaderName(judgeHeaders.stage1) || "S1"}`, width: 58, align: "center" },
      { key: "stage2", label: `S2-${formatJudgeHeaderName(judgeHeaders.stage2) || "S2"}`, width: 58, align: "center" },
      { key: "stage3", label: `S3-${formatJudgeHeaderName(judgeHeaders.stage3) || "S3"}`, width: 58, align: "center" },
      { key: "sight", label: `SR-${formatJudgeHeaderName(judgeHeaders.sight) || "SR"}`, width: 64, align: "center" },
      { key: "overall", label: "Overall", width: 58, align: "center" },
    ];
    const escapePdfText = (value) => String(value || "")
      .replace(/[^\x20-\x7E]/g, "?")
      .replaceAll("\\", "\\\\")
      .replaceAll("(", "\\(")
      .replaceAll(")", "\\)");
    const wrapText = (value, maxChars) => {
      const chunks = String(value || "").split(/\n+/);
      const lines = [];
      chunks.forEach((chunk) => {
        const words = String(chunk || "").split(/\s+/).filter(Boolean);
        if (!words.length) {
          lines.push("");
          return;
        }
        let current = "";
        words.forEach((word) => {
          const next = current ? `${current} ${word}` : word;
          if (next.length > maxChars && current) {
            lines.push(current);
            current = word;
          } else {
            current = next;
          }
        });
        if (current) lines.push(current);
      });
      return lines;
    };
    const maxCharsByColumn = {
      ensembleName: 24,
      grade: 6,
      repertoireText: 52,
      stage1: 11,
      stage2: 11,
      stage3: 11,
      sight: 12,
      overall: 8,
    };
    const glyphWidthUnits = {
      " ": 0.28,
      "/": 0.32,
      "-": 0.34,
      ".": 0.28,
      "0": 0.56,
      "1": 0.42,
      "2": 0.56,
      "3": 0.56,
      "4": 0.56,
      "5": 0.56,
      "6": 0.56,
      "7": 0.52,
      "8": 0.56,
      "9": 0.56,
      A: 0.67,
      B: 0.67,
      C: 0.72,
      D: 0.72,
      E: 0.67,
      F: 0.61,
      G: 0.78,
      H: 0.72,
      I: 0.28,
      J: 0.50,
      K: 0.67,
      L: 0.56,
      M: 0.83,
      N: 0.72,
      O: 0.78,
      P: 0.67,
      Q: 0.78,
      R: 0.72,
      S: 0.67,
      T: 0.61,
      U: 0.72,
      V: 0.67,
      W: 0.94,
      X: 0.67,
      Y: 0.67,
      Z: 0.61,
    };
    const estimatePdfTextWidth = (value, fontSize = 9) => {
      const text = String(value || "");
      const units = Array.from(text).reduce((sum, char) => (
        sum + (glyphWidthUnits[char] ?? 0.56)
      ), 0);
      return units * fontSize;
    };
    const getAlignedTextX = (column, cellText, baseX, charWidth) => {
      if (column?.align !== "center") return baseX + 2;
      const estimatedTextWidth = estimatePdfTextWidth(cellText, charWidth);
      return baseX + Math.max(2, (column.width - estimatedTextWidth) / 2);
    };
    const measureWrappedRow = (row) => {
      const wrapped = columns.map((column) =>
        wrapText(String(row?.[column.key] || ""), maxCharsByColumn[column.key] || 12)
      );
      const lineCount = Math.max(...wrapped.map((value) => Math.max(value.length, 1)), 1);
      return {
        wrapped,
        rowHeight: Math.max(16, lineCount * 10 + 6),
      };
    };
    const groupedRows = (() => {
      const sorted = [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
        const schoolCompare = String(a?.schoolName || "").localeCompare(String(b?.schoolName || ""));
        if (schoolCompare !== 0) return schoolCompare;
        const ensembleCompare = String(a?.ensembleName || "").localeCompare(String(b?.ensembleName || ""));
        if (ensembleCompare !== 0) return ensembleCompare;
        return String(a?.grade || "").localeCompare(String(b?.grade || ""));
      });
      const groups = [];
      let currentSchool = "";
      sorted.forEach((row) => {
        const schoolName = String(row?.schoolName || "Unknown School");
        if (schoolName !== currentSchool) {
          groups.push({ type: "school", schoolName });
          currentSchool = schoolName;
        }
        groups.push({ type: "entry", row });
      });
      return groups;
    })();
    const pages = [];
    let lines = [];
    const addText = (text, x, yTop, size = 9, font = "F1", align = "left") => {
      const y = pdfHeight - yTop;
      const safe = escapePdfText(text);
      if (align === "center") {
        lines.push(`BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${safe}) Tj ET`);
        return;
      }
      lines.push(`BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${safe}) Tj ET`);
    };
    const addLine = (x1, y1Top, x2, y2Top) => {
      const y1 = pdfHeight - y1Top;
      const y2 = pdfHeight - y2Top;
      lines.push(`${x1} ${y1} m ${x2} ${y2} l S`);
    };
    const pushPage = () => {
      pages.push(lines.join("\n"));
      lines = [];
    };
    const drawHeader = () => {
      addText("NCBA MPA Event Results Overview", left, 30, 16, "F2");
      addText(String(eventName || "Active Event"), left, 48, 11, "F1");
      if (eventDateLabel) addText(String(eventDateLabel), left, 63, 11, "F1");
      let x = left;
      const headerY = eventDateLabel ? 90 : 78;
      addLine(left, headerY + 8, right, headerY + 8);
      columns.forEach((column) => {
        const headerFontSize = column.align === "center" ? 7.5 : 9;
        const textX = getAlignedTextX(column, column.label || "", x, headerFontSize);
        addText(column.label, textX, headerY, headerFontSize, "F2");
        x += column.width;
      });
      return headerY + 18;
    };

    let y = drawHeader();
    groupedRows.forEach((item, index) => {
      if (item.type === "school") {
        const schoolHeight = 18;
        const nextEntry = groupedRows[index + 1]?.type === "entry" ? groupedRows[index + 1].row : null;
        const nextEntryHeight = nextEntry ? measureWrappedRow(nextEntry).rowHeight : 0;
        if (y + schoolHeight + nextEntryHeight > bottom) {
          pushPage();
          y = drawHeader();
        }
        if (index > 0) {
          addLine(left, y - 4, right, y - 4);
        }
        addText(item.schoolName, left + 2, y + 9, 10, "F2");
        y += schoolHeight;
        return;
      }
      const row = item.row || {};
      const { wrapped, rowHeight } = measureWrappedRow(row);
      if (y + rowHeight > bottom) {
        pushPage();
        y = drawHeader();
      }
      if (index > 0) {
        addLine(left, y - 4, right, y - 4);
      }
      let x = left;
      wrapped.forEach((cellLines, columnIndex) => {
        const column = columns[columnIndex];
        cellLines.forEach((cellLine, lineIndex) => {
          const textX = getAlignedTextX(column, cellLine || "", x, 9);
          addText(cellLine, textX, y + 8 + (lineIndex * 10), 9, "F1");
        });
        x += column.width;
      });
      y += rowHeight;
    });
    pushPage();

    const encoder = new TextEncoder();
    const objects = ["<< /Type /Catalog /Pages 2 0 R >>"];
    const kids = [];
    const pageObjectNumbers = [];
    const fontHelveticaObj = 3;
    const fontHelveticaBoldObj = 4;
    let nextObjectNumber = 5;

    pages.forEach((content, index) => {
      const contentLength = encoder.encode(content).length;
      const pageObjectNumber = nextObjectNumber++;
      const contentObjectNumber = nextObjectNumber++;
      pageObjectNumbers.push(pageObjectNumber);
      kids.push(`${pageObjectNumber} 0 R`);
      objects.push(
        index === 0
          ? ""
          : ""
      );
      objects[pageObjectNumber - 1] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfWidth} ${pdfHeight}] /Resources << /Font << /F1 ${fontHelveticaObj} 0 R /F2 ${fontHelveticaBoldObj} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`;
      objects[contentObjectNumber - 1] = `<< /Length ${contentLength} >>\nstream\n${content}\nendstream`;
    });
    objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
    objects[2] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
    objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((objectBody, index) => {
      offsets.push(encoder.encode(pdf).length);
      pdf += `${index + 1} 0 obj\n${objectBody}\nendobj\n`;
    });
    const xrefOffset = encoder.encode(pdf).length;
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += "0000000000 65535 f \n";
    offsets.slice(1).forEach((offset) => {
      pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return new Blob([pdf], { type: "application/pdf" });
  };

  const buildPublicProgramSnapshot = ({ eventName, rows }) => {
    const programRows = Array.isArray(rows) ? rows : [];
    const dates = programRows
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
    const sections = new Map();
    programRows.forEach((row) => {
      const heading = row.performanceAt
        ? row.performanceAt.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })
        : "Schedule";
      if (!sections.has(heading)) sections.set(heading, []);
      sections.get(heading).push({
        timeLabel: row.performanceAt
          ? row.performanceAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
          : "Time TBD",
        grade: row.grade || "",
        schoolName: row.schoolName || "",
        ensembleName: row.ensembleName || "",
        directorName: row.directorName || "",
        programLines: Array.isArray(row.programLines) ? row.programLines.filter(Boolean) : [],
      });
    });
    return {
      eventName: String(eventName || "South Site Program"),
      dateLabel,
      venueName: "Minnie Evans Arts Center at Ashley High School",
      venueCity: "Wilmington, North Carolina",
      sections: Array.from(sections.entries()).map(([heading, entries]) => ({ heading, entries })),
    };
  };

  const resetWalkthroughSteps = async ({ eventId, note }) => {
    const nowMs = Date.now();
    const retryCooldownMs = 5 * 60 * 1000;
    const canRetryBulkCallable = shouldRetryBulkResetCallable({
      supportState: state.admin.readinessBulkResetSupport,
      checkedAt: state.admin.readinessBulkResetCheckedAt,
      nowMs,
      retryCooldownMs,
    });
    if (canRetryBulkCallable) {
      try {
        await setReadinessWalkthrough({
          eventId,
          status: "incomplete",
          note,
        });
        state.admin.readinessBulkResetSupport = "available";
        state.admin.readinessBulkResetCheckedAt = nowMs;
        return;
      } catch (error) {
        const missingCallable = isMissingWalkthroughCallableError(error);
        if (!missingCallable) throw error;
        state.admin.readinessBulkResetSupport = "unavailable";
        state.admin.readinessBulkResetCheckedAt = nowMs;
      }
    }
    for (const stepKey of WALKTHROUGH_STEP_KEYS) {
      await markReadinessStep({
        eventId,
        stepKey,
        status: "incomplete",
        note,
      });
    }
  };

  return function bindAdminHandlers() {
    if (adminHandlersBound) return;
    adminHandlersBound = true;
    Array.from(els.adminSubnav?.querySelectorAll("[data-admin-view]") || []).forEach((btn) => {
      const view = btn.getAttribute("data-admin-view");
      if (!view) return;
      btn.addEventListener("click", () => {
        if (isReadinessBusy()) return;
        if (view === "eventDay" && !isAdminLiveEventEnabled()) return;
        if ((view === "setup" || view === "directory") && !isAdminSettingsEnabled()) return;
        if (view === "eventPrep") {
          state.admin.selectedSchoolId = null;
          state.admin.selectedSchoolName = "";
        }
        state.admin.currentView = view;
        applyAdminView(view);
        const hash = getAdminHashForView(view);
        if (windowObj.location.hash !== hash) {
          windowObj.location.hash = hash;
        }
      });
    });

    Array.from(document.querySelectorAll("[data-admin-go-view]") || []).forEach((btn) => {
      const view = btn.getAttribute("data-admin-go-view");
      if (!view) return;
      btn.addEventListener("click", () => {
        if (isReadinessBusy()) return;
        if (view === "eventPrep") {
          state.admin.selectedSchoolId = null;
          state.admin.selectedSchoolName = "";
        }
        state.admin.currentView = view;
        applyAdminView(view);
        const hash = getAdminHashForView(view);
        if (windowObj.location.hash !== hash) {
          windowObj.location.hash = hash;
        }
      });
    });

    if (els.adminSchoolDetailBackBtn) {
      els.adminSchoolDetailBackBtn.addEventListener("click", () => {
        closeAdminSchoolDetail();
      });
    }

    if (els.adminPacketsSchoolSelect) {
      els.adminPacketsSchoolSelect.addEventListener("change", () => {
        state.admin.packetsSchoolId = els.adminPacketsSchoolSelect?.value || "";
        if (state.admin.currentView === "eventDay") {
          renderAdminPacketsBySchedule();
        }
      });
    }

    if (els.adminSubmissionsFilter) {
      els.adminSubmissionsFilter.addEventListener("change", () => {
        state.admin.rawAssessmentFilter = els.adminSubmissionsFilter?.value || "pending";
        if (state.admin.currentView === "eventDay") {
          renderAdminLiveSubmissions();
        }
      });
    }

    if (els.createEventBtn) {
      els.createEventBtn.addEventListener("click", async () => {
        const name = els.eventNameInput?.value.trim() || "";
        if (!name) {
          alertUser("Enter an event name.");
          return;
        }
        const now = new Date();
        const startAtDate = new Date(now);
        const endAtDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        els.createEventBtn.dataset.loadingLabel = "Creating...";
        await withLoading(els.createEventBtn, async () => {
          await createEvent({ name, startAtDate, endAtDate });
          if (els.eventNameInput) els.eventNameInput.value = "";
          scheduleAdminPreflightRefresh?.();
        });
      });
    }

    if (els.assignmentsForm) {
      const assignmentSelects = [
        { select: els.stage1JudgeSelect, key: "stage1Uid" },
        { select: els.stage2JudgeSelect, key: "stage2Uid" },
        { select: els.stage3JudgeSelect, key: "stage3Uid" },
        { select: els.sightJudgeSelect, key: "sightUid" },
      ].filter((entry) => Boolean(entry.select));
      assignmentSelects.forEach(({ select, key }) => {
        select.addEventListener("change", () => {
          state.admin.assignmentsDirty = true;
          state.admin.assignmentsDraft = {
            ...(state.admin.assignmentsDraft || {}),
            [key]: select.value || "",
          };
        });
      });
      els.assignmentsForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!state.event.active) {
          if (els.assignmentsError) {
            els.assignmentsError.textContent = "Create and activate an event first.";
          }
          return;
        }
        const stage1Uid = els.stage1JudgeSelect?.value || state.admin.assignmentsDraft?.stage1Uid || "";
        const stage2Uid = els.stage2JudgeSelect?.value || state.admin.assignmentsDraft?.stage2Uid || "";
        const stage3Uid = els.stage3JudgeSelect?.value || state.admin.assignmentsDraft?.stage3Uid || "";
        const sightUid = els.sightJudgeSelect?.value || state.admin.assignmentsDraft?.sightUid || "";
        if (!stage1Uid || !stage2Uid || !stage3Uid || !sightUid) {
          if (els.assignmentsError) {
            els.assignmentsError.textContent = "Select all judge assignments.";
          }
          return;
        }
        const unique = new Set([stage1Uid, stage2Uid, stage3Uid, sightUid]);
        if (unique.size !== 4) {
          if (els.assignmentsError) {
            els.assignmentsError.textContent = "Each judge position must be assigned to a unique user.";
          }
          return;
        }
        if (els.assignmentsError) els.assignmentsError.textContent = "";
        try {
          await saveAssignments({
            eventId: state.event.active.id,
            stage1Uid,
            stage2Uid,
            stage3Uid,
            sightUid,
          });
          state.admin.assignmentsDirty = false;
          state.admin.assignmentsDraft = {
            stage1Uid,
            stage2Uid,
            stage3Uid,
            sightUid,
          };
          scheduleAdminPreflightRefresh?.({ immediate: true });
          showStatusMessage(els.assignmentsError, "Assignments saved.");
        } catch (error) {
          console.error("Assignments save failed", error);
          showStatusMessage(
            els.assignmentsError,
            "Unable to save assignments. Check console for details.",
            "error"
          );
        }
      });
    }

    const openAdminView = (view) => {
      if (!view) return;
      if (isReadinessBusy()) return;
      if (view === "eventDay" && !isAdminLiveEventEnabled()) return;
      if ((view === "setup" || view === "directory") && !isAdminSettingsEnabled()) return;
      state.admin.currentView = view;
      applyAdminView(view);
      const hash = getAdminHashForView(view);
      if (windowObj.location.hash !== hash) {
        windowObj.location.hash = hash;
      }
    };

    if (els.adminRunPreflightBtn) {
      els.adminRunPreflightBtn.addEventListener("click", async () => {
        if (isReadinessBusy()) return;
        const eventId = state.event.active?.id || "";
        if (!eventId) {
          alertUser("Set an active event first.");
          return;
        }
        setReadinessControlsDisabled(true);
        try {
          await runEventPreflight({ eventId });
          await renderAdminReadinessView?.();
        } catch (error) {
          console.error("runEventPreflight failed", error);
          alertUser(error?.message || "Unable to run preflight.");
        } finally {
          setReadinessControlsDisabled(false);
        }
      });
    }

    if (els.adminWalkthroughStartBtn) {
      els.adminWalkthroughStartBtn.addEventListener("click", async () => {
        if (isReadinessBusy()) return;
        const eventId = state.event.active?.id || "";
        if (!eventId) {
          alertUser("Set an active event first.");
          return;
        }
        const confirmed = confirmUser(
          "Start walkthrough? This resets walkthrough checkpoints to incomplete."
        );
        if (!confirmed) return;
        setReadinessControlsDisabled(true);
        try {
          await resetWalkthroughSteps({
            eventId,
            note: "Walkthrough started",
          });
          await runEventPreflight({ eventId });
          scheduleAdminPreflightRefresh?.({ immediate: true });
          await renderAdminReadinessView?.();
          openAdminView("setup");
        } catch (error) {
          console.error("walkthrough start failed", error);
          alertUser(error?.message || "Unable to start walkthrough.");
        } finally {
          setReadinessControlsDisabled(false);
        }
      });
    }

    if (els.adminWalkthroughResetBtn) {
      els.adminWalkthroughResetBtn.addEventListener("click", async () => {
        if (isReadinessBusy()) return;
        const eventId = state.event.active?.id || "";
        if (!eventId) {
          alertUser("Set an active event first.");
          return;
        }
        const confirmed = confirmUser("Reset walkthrough checkpoints to incomplete?");
        if (!confirmed) return;
        setReadinessControlsDisabled(true);
        try {
          await resetWalkthroughSteps({
            eventId,
            note: "Walkthrough reset",
          });
          scheduleAdminPreflightRefresh?.({ immediate: true });
          await renderAdminReadinessView?.();
        } catch (error) {
          console.error("walkthrough reset failed", error);
          alertUser(error?.message || "Unable to reset walkthrough.");
        } finally {
          setReadinessControlsDisabled(false);
        }
      });
    }

    Array.from(document.querySelectorAll("[data-readiness-open-view]")).forEach((btn) => {
      btn.addEventListener("click", () => {
        if (isReadinessBusy()) return;
        const view = btn.getAttribute("data-readiness-open-view") || "";
        if (!view) return;
        openAdminView(view);
      });
    });

    Array.from(document.querySelectorAll("[data-readiness-step]")).forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (isReadinessBusy()) return;
        const eventId = state.event.active?.id || "";
        const stepKey = btn.getAttribute("data-readiness-step") || "";
        const status = String(btn.dataset.targetStatus || "complete").trim().toLowerCase() === "incomplete" ?
          "incomplete" :
          "complete";
        if (!eventId || !stepKey) {
          alertUser("Set an active event first.");
          return;
        }
        setReadinessControlsDisabled(true);
        try {
          const note = status === "complete" ?
            "Marked complete in Readiness UI" :
            "Marked incomplete in Readiness UI";
          await markReadinessStep({
            eventId,
            stepKey,
            status,
            note,
          });
          scheduleAdminPreflightRefresh?.({ immediate: true });
          await renderAdminReadinessView?.();
        } catch (error) {
          console.error("markReadinessStep failed", error);
          alertUser(error?.message || "Unable to update readiness step.");
        } finally {
          setReadinessControlsDisabled(false);
        }
      });
    });

    if (els.programPreviewBtn) {
      els.programPreviewBtn.addEventListener("click", async () => {
        const previewWindow = windowObj.open("", "_blank");
        if (previewWindow) {
          previewWindow.document.open();
          previewWindow.document.write("<!doctype html><title>Building program preview...</title><p>Building program preview...</p>");
          previewWindow.document.close();
        }
        els.programPreviewBtn.dataset.loadingLabel = "Building...";
        await withLoading(els.programPreviewBtn, async () => {
          try {
            const rows = await loadProgramRows();
            if (!rows.length) {
              throw new Error("No scheduled ensembles are available for program export.");
            }
            const eventName = getActiveEvent()?.name || "Active Event";
            const html = buildProgramHtml({ eventName, rows });
            if (previewWindow && !previewWindow.closed) {
              previewWindow.document.open();
              previewWindow.document.write(html);
              previewWindow.document.close();
            } else {
              const blob = new Blob([html], { type: "text/html;charset=utf-8" });
              const url = windowObj.URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = `${String(eventName || "Program").replace(/[^a-zA-Z0-9]+/g, "_")}_Program_Preview.html`;
              document.body.appendChild(link);
              link.click();
              link.remove();
              window.setTimeout(() => windowObj.URL.revokeObjectURL(url), 1000);
            }
            if (els.programExportStatus) {
              els.programExportStatus.textContent = `Opened print preview for ${rows.length} scheduled ensemble${rows.length === 1 ? "" : "s"}.`;
            }
          } catch (error) {
            console.error("Program preview failed", error);
            if (previewWindow && !previewWindow.closed) {
              previewWindow.close();
            }
            const message = error?.message || "Unable to build program preview.";
            if (els.programExportStatus) els.programExportStatus.textContent = message;
            alertUser(message);
          }
        });
      });
    }

    if (els.resultsPdfBtn) {
      els.resultsPdfBtn.addEventListener("click", async () => {
        const previewWindow = windowObj.open("", "_blank");
        if (previewWindow) {
          previewWindow.document.open();
          previewWindow.document.write("<!doctype html><title>Building event results PDF...</title><p>Building event results PDF...</p>");
          previewWindow.document.close();
        }
        els.resultsPdfBtn.dataset.loadingLabel = "Building...";
        await withLoading(els.resultsPdfBtn, async () => {
          try {
            const event = getActiveEvent();
            if (!event?.id) {
              throw new Error("Set the active 2026 event first.");
            }
            const { rows, judgeHeaders } = await loadResultsOverviewRows();
            if (!rows.length) {
              throw new Error("No scheduled ensembles are available for results export.");
            }
            const eventStartDate = event.startAt?.toDate ? event.startAt.toDate() : null;
            const eventEndDate = event.endAt?.toDate ? event.endAt.toDate() : null;
            const eventDateLabel = (() => {
              if (!eventStartDate) return "";
              if (!eventEndDate) {
                return eventStartDate.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
              }
              const sameDay =
                eventStartDate.getFullYear() === eventEndDate.getFullYear() &&
                eventStartDate.getMonth() === eventEndDate.getMonth() &&
                eventStartDate.getDate() === eventEndDate.getDate();
              if (sameDay) {
                return eventStartDate.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
              }
              const sameMonth =
                eventStartDate.getFullYear() === eventEndDate.getFullYear() &&
                eventStartDate.getMonth() === eventEndDate.getMonth();
              if (sameMonth) {
                return `${eventStartDate.toLocaleDateString([], { month: "long" })} ${eventStartDate.getDate()}-${eventEndDate.getDate()}, ${eventEndDate.getFullYear()}`;
              }
              return `${eventStartDate.toLocaleDateString([], { month: "long", day: "numeric" })} - ${eventEndDate.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })}`;
            })();
            const pdf = buildResultsOverviewPdf({
              eventName: event.name || "Active Event",
              eventDateLabel,
              rows,
              judgeHeaders,
            });
            const safeEventName = String(event.name || "Active_Event").replace(/[^a-zA-Z0-9]+/g, "_");
            const fileName = `${safeEventName}_Results_Overview.pdf`;
            const result = await publishEventResultsOverviewPdf({
              eventId: event.id,
              blob: pdf,
              fileName,
            });
            if (!result?.url) {
              throw new Error("Results PDF was created, but no file URL was returned.");
            }
            if (previewWindow && !previewWindow.closed) {
              previewWindow.location.replace(result.url);
            } else {
              windowObj.open(result.url, "_blank", "noopener");
            }
            if (els.programExportStatus) {
              els.programExportStatus.textContent = `Created event results PDF for ${rows.length} scheduled ensemble${rows.length === 1 ? "" : "s"}.`;
            }
          } catch (error) {
            console.error("Results PDF export failed", error);
            if (previewWindow && !previewWindow.closed) {
              previewWindow.close();
            }
            const message = error?.message || "Unable to create event results PDF.";
            if (els.programExportStatus) els.programExportStatus.textContent = message;
            alertUser(message);
          }
        });
      });
    }

    if (els.programCsvBtn) {
      els.programCsvBtn.addEventListener("click", async () => {
        els.programCsvBtn.dataset.loadingLabel = "Exporting...";
        await withLoading(els.programCsvBtn, async () => {
          try {
            const rows = await loadProgramRows();
            if (!rows.length) {
              throw new Error("No scheduled ensembles are available for program export.");
            }
            const csv = buildProgramCsv(rows);
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
            const url = windowObj.URL.createObjectURL(blob);
            const link = document.createElement("a");
            const eventName = String(getActiveEvent()?.name || "Program").replace(/[^a-zA-Z0-9]+/g, "_");
            link.href = url;
            link.download = `${eventName}_Program.csv`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => windowObj.URL.revokeObjectURL(url), 1000);
            if (els.programExportStatus) {
              els.programExportStatus.textContent = `Downloaded CSV for ${rows.length} scheduled ensemble${rows.length === 1 ? "" : "s"}.`;
            }
          } catch (error) {
            console.error("Program CSV export failed", error);
            const message = error?.message || "Unable to export program CSV.";
            if (els.programExportStatus) els.programExportStatus.textContent = message;
            alertUser(message);
          }
        });
      });
    }

    if (els.programPublishBtn) {
      els.programPublishBtn.addEventListener("click", async () => {
        els.programPublishBtn.dataset.loadingLabel = "Publishing...";
        await withLoading(els.programPublishBtn, async () => {
          try {
            const rows = await loadProgramRows();
            if (!rows.length) {
              throw new Error("No scheduled ensembles are available to publish.");
            }
            const eventName = getActiveEvent()?.name || "Active Event";
            const snapshot = {
              ...buildPublicProgramSnapshot({ eventName, rows }),
              published: true,
            };
            await publishPublicProgram({ snapshot });
            windowObj.dispatchEvent(new CustomEvent("public-program-updated", { detail: snapshot }));
            if (els.programExportStatus) {
              els.programExportStatus.textContent = `Published homepage program for ${rows.length} scheduled ensemble${rows.length === 1 ? "" : "s"}.`;
            }
          } catch (error) {
            console.error("Program publish failed", error);
            const message = error?.message || "Unable to publish homepage program.";
            if (els.programExportStatus) els.programExportStatus.textContent = message;
            alertUser(message);
          }
        });
      });
    }

    if (els.schoolForm) {
      els.schoolForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const schoolId = state.admin.schoolEditId || (els.schoolIdCreateInput?.value.trim() || "");
        const name = els.schoolNameCreateInput?.value.trim() || "";
        const district = els.districtSelect?.value.trim() || "";
        if (!schoolId || !name) {
          alertUser("Enter a school ID and name.");
          return;
        }
        await saveSchool({ schoolId, name, district });
        scheduleAdminPreflightRefresh?.();
        if (els.schoolResult) {
          els.schoolResult.textContent = state.admin.schoolEditId
            ? `Updated ${schoolId}.`
            : `Added ${schoolId}.`;
        }
        resetAdminSchoolForm();
      });
    }

    if (els.schoolEditCancelBtn) {
      els.schoolEditCancelBtn.addEventListener("click", () => {
        resetAdminSchoolForm();
        if (els.schoolResult) els.schoolResult.textContent = "";
      });
    }

    if (els.adminSchoolManageSelect) {
      els.adminSchoolManageSelect.addEventListener("change", () => {
        const hasSelection = Boolean(els.adminSchoolManageSelect?.value);
        if (els.adminSchoolManageDeleteBtn) {
          els.adminSchoolManageDeleteBtn.disabled = !hasSelection;
        }
      });
    }

    if (els.adminSchoolManageDeleteBtn) {
      els.adminSchoolManageDeleteBtn.addEventListener("click", async () => {
        const school = getSelectedAdminSchool();
        if (!school) return;
        const label = school.name || school.id;
        const ok = confirmUser(
          `WARNING: Permanently delete "${label}"? This cannot be undone. All ensembles, entries, and data linked to this school will be removed.`
        );
        if (!ok) return;
        try {
          await deleteSchool({ schoolId: school.id });
          scheduleAdminPreflightRefresh?.();
          if (state.admin.schoolEditId === school.id) {
            resetAdminSchoolForm();
          }
          if (els.schoolResult) {
            els.schoolResult.textContent = `Deleted ${school.id}.`;
          }
        } catch (error) {
          console.error("Delete school failed", error);
          const message = error?.message || "Unable to delete school.";
          alertUser(message);
        }
      });
    }

    if (els.schoolBulkBtn) {
      els.schoolBulkBtn.addEventListener("click", async () => {
        els.schoolBulkBtn.dataset.loadingLabel = "Importing...";
        await withLoading(els.schoolBulkBtn, async () => {
          try {
            const raw = els.schoolBulkInput?.value || "";
            const lines = raw
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => {
                const [schoolId, ...nameParts] = line.split(",");
                return { schoolId: (schoolId || "").trim(), name: nameParts.join(",").trim() };
              });
            const result = await bulkImportSchools(lines);
            scheduleAdminPreflightRefresh?.();
            if (els.schoolResult) {
              els.schoolResult.textContent = `Imported ${result.count} schools.`;
            }
          } catch (error) {
            console.error("bulkImportSchools failed", error);
            const message = error?.message || "Unable to import schools.";
            if (els.schoolResult) {
              els.schoolResult.textContent = message;
            }
            alertUser(message);
          }
        });
      });
    }

    if (els.provisionForm) {
      syncProvisionSchoolField();
      if (els.provisionRoleSelect) {
        els.provisionRoleSelect.addEventListener("change", syncProvisionSchoolField);
      }
      els.provisionForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const email = els.provisionEmailInput?.value.trim() || "";
        const name = els.provisionNameInput?.value.trim() || "";
        const role = els.provisionRoleSelect?.value || "judge";
        const schoolId = role === "director" ? (els.provisionSchoolSelect?.value || null) : null;
        const tempPassword = els.provisionTempPasswordInput?.value.trim() || "";
        if (!email) {
          alertUser("Email is required.");
          return;
        }
        const submitBtn = els.provisionForm.querySelector("button[type='submit']");
        if (submitBtn) submitBtn.dataset.loadingLabel = "Provisioning...";
        await withLoading(submitBtn, async () => {
          try {
            const result = await provisionUser({
              email,
              displayName: name || null,
              role,
              schoolId,
              tempPassword: tempPassword || null,
            });
            if (els.provisionResult) {
              const password = result?.generatedPassword || tempPassword || "";
              els.provisionResult.textContent = password
                ? `Provisioned. Temp password: ${password}`
                : "Provisioned.";
            }
            if (els.provisionForm) els.provisionForm.reset();
            syncProvisionSchoolField();
            renderAdminUsersDirectory?.();
            scheduleAdminPreflightRefresh?.();
          } catch (error) {
            console.error("provisionUser failed", error);
            const message = error?.message || "Unable to provision user.";
            if (els.provisionResult) {
              els.provisionResult.textContent = message;
            }
            alertUser(message);
          }
        });
      });
    }

    const userListHandler = async (event) => {
        const manageSchoolButton = event.target.closest("button[data-manage-director-school-uid]");
        if (manageSchoolButton) {
          const targetUid = manageSchoolButton.getAttribute("data-manage-director-school-uid") || "";
          if (!targetUid) return;
          const isOpen = state.admin.directorSchoolManageUid === targetUid;
          state.admin.directorSchoolManageUid = isOpen ? "" : targetUid;
          state.admin.directorSchoolManageSchoolId = isOpen
            ? ""
            : (((state.admin.directorsList || []).find((item) => item.uid === targetUid)?.schoolId) || "");
          state.admin.directorSchoolManageResultUid = "";
          state.admin.directorSchoolManageResultMessage = "";
          renderAdminUsersDirectory?.();
          return;
        }
        const cancelSchoolButton = event.target.closest("button[data-cancel-director-school-uid]");
        if (cancelSchoolButton) {
          state.admin.directorSchoolManageUid = "";
          state.admin.directorSchoolManageSchoolId = "";
          state.admin.directorSchoolManageResultUid = "";
          state.admin.directorSchoolManageResultMessage = "";
          renderAdminUsersDirectory?.();
          return;
        }
        const saveSchoolButton = event.target.closest("button[data-save-director-school-uid]");
        if (saveSchoolButton) {
          const targetUid = saveSchoolButton.getAttribute("data-save-director-school-uid") || "";
          const director = (state.admin.directorsList || []).find((item) => item.uid === targetUid);
          const schoolId = String(state.admin.directorSchoolManageSchoolId || "");
          if (!director || !schoolId) return;
          saveSchoolButton.dataset.loadingLabel = "Saving...";
          await withLoading(saveSchoolButton, async () => {
            try {
              await assignDirectorSchool({ directorUid: director.uid, schoolId });
              const directorEntry = (state.admin.directorsList || []).find((item) => item.uid === director.uid);
              if (directorEntry) directorEntry.schoolId = schoolId;
              const userEntry = (state.admin.usersList || []).find((item) => item.uid === director.uid);
              if (userEntry) userEntry.schoolId = schoolId;
              state.admin.directorSchoolManageUid = director.uid;
              state.admin.directorSchoolManageSchoolId = schoolId;
              state.admin.directorSchoolManageResultUid = director.uid;
              const schoolName = getSchoolNameById(state.admin.schoolsList, schoolId) || schoolId;
              state.admin.directorSchoolManageResultMessage =
                `Assigned ${director.displayName || director.email || director.uid} to ${schoolName}.`;
              scheduleAdminPreflightRefresh?.();
              renderAdminUsersDirectory?.();
            } catch (error) {
              console.error("assignDirectorSchool failed", error);
              state.admin.directorSchoolManageUid = director.uid;
              state.admin.directorSchoolManageResultUid = director.uid;
              state.admin.directorSchoolManageResultMessage =
                error?.message || "Unable to assign director.";
              renderAdminUsersDirectory?.();
            }
          });
          return;
        }
        const removeSchoolButton = event.target.closest("button[data-remove-director-school-uid]");
        if (removeSchoolButton) {
          const targetUid = removeSchoolButton.getAttribute("data-remove-director-school-uid") || "";
          const director = (state.admin.directorsList || []).find((item) => item.uid === targetUid);
          if (!director || !director.schoolId) return;
          const label = director.displayName || director.email || director.uid;
          if (!confirmUser(`Remove ${label} from their school assignment?`)) return;
          removeSchoolButton.dataset.loadingLabel = "Removing...";
          await withLoading(removeSchoolButton, async () => {
            try {
              await unassignDirectorSchool({ directorUid: director.uid });
              const directorEntry = (state.admin.directorsList || []).find((item) => item.uid === director.uid);
              if (directorEntry) directorEntry.schoolId = "";
              const userEntry = (state.admin.usersList || []).find((item) => item.uid === director.uid);
              if (userEntry) userEntry.schoolId = "";
              state.admin.directorSchoolManageUid = director.uid;
              state.admin.directorSchoolManageSchoolId = "";
              state.admin.directorSchoolManageResultUid = director.uid;
              state.admin.directorSchoolManageResultMessage =
                `Removed ${label} from school assignment.`;
              scheduleAdminPreflightRefresh?.();
              renderAdminUsersDirectory?.();
            } catch (error) {
              console.error("unassignDirectorSchool failed", error);
              state.admin.directorSchoolManageUid = director.uid;
              state.admin.directorSchoolManageResultUid = director.uid;
              state.admin.directorSchoolManageResultMessage =
                error?.message || "Unable to remove director.";
              renderAdminUsersDirectory?.();
            }
          });
          return;
        }
        const bioButton = event.target.closest("button[data-bio-user-uid]");
        if (bioButton) {
          const targetUid = bioButton.getAttribute("data-bio-user-uid") || "";
          if (!targetUid) return;
          const user = (state.admin.usersList || []).find((item) => item.uid === targetUid);
          if (!user) return;
          openJudgeBioModal?.({ uid: targetUid, name: user.displayName || user.email || "", bio: user.bio || "" });
          return;
        }
        const editButton = event.target.closest("button[data-edit-user-uid]");
        if (editButton) {
          const targetUid = editButton.getAttribute("data-edit-user-uid") || "";
          if (!targetUid) return;
          const user = (state.admin.usersList || []).find((item) => item.uid === targetUid);
          if (!user) return;
          const currentName = String(user.displayName || "").trim();
          const nextName = windowObj.prompt(
            `Edit display name for ${user.email || user.uid}:`,
            currentName
          );
          if (nextName == null) return;
          const trimmed = nextName.trim();
          if (!trimmed) {
            alertUser("Name cannot be blank.");
            return;
          }
          editButton.dataset.loadingLabel = "Saving...";
          await withLoading(editButton, async () => {
            try {
              await updateUserDisplayName({ targetUid, displayName: trimmed });
              const localUser = (state.admin.usersList || []).find((item) => item.uid === targetUid);
              if (localUser) localUser.displayName = trimmed;
              if (els.adminUsersResult) {
                els.adminUsersResult.textContent = `Updated name for ${user.email || user.uid}.`;
              }
              renderAdminUsersDirectory?.();
            } catch (error) {
              console.error("updateUserDisplayName failed", error);
              const message = error?.message || "Unable to update user name.";
              if (els.adminUsersResult) {
                els.adminUsersResult.textContent = message;
              }
              alertUser(message);
            }
          });
          return;
        }
        const button = event.target.closest("button[data-delete-user-uid]");
        if (!button) return;
        const targetUid = button.getAttribute("data-delete-user-uid") || "";
        if (!targetUid) return;
        const user = (state.admin.usersList || []).find((item) => item.uid === targetUid);
        if (!user) return;
        const label = user.displayName || user.email || user.uid;
        const role = user.role || "unknown";
        const confirmed = confirmUser(
          `Full delete ${label} (${role})?\n\nThis removes Auth and the user profile, and will fail if linked records still exist.`
        );
        if (!confirmed) return;
        button.dataset.loadingLabel = "Deleting...";
        await withLoading(button, async () => {
          try {
            await deleteUserAccount({ targetUid });
            scheduleAdminPreflightRefresh?.({ immediate: true });
            if (els.adminUsersResult) {
              els.adminUsersResult.textContent = `Deleted ${label}.`;
            }
            renderAdminUsersDirectory?.();
          } catch (error) {
            console.error("deleteUserAccount failed", error);
            if (els.adminUsersResult) {
              els.adminUsersResult.textContent = extractDeleteUserErrorMessage(error);
            }
            alertUser(extractDeleteUserErrorMessage(error));
          }
        });
    };
    [els.adminAdminsList, els.adminJudgesList, els.adminDirectorsList].forEach((list) => {
      if (list) list.addEventListener("click", userListHandler);
    });
    if (els.adminDirectorsList) {
      els.adminDirectorsList.addEventListener("change", (event) => {
        const schoolSelect = event.target.closest("select[data-director-school-select]");
        if (!schoolSelect) return;
        state.admin.directorSchoolManageUid = schoolSelect.getAttribute("data-director-school-select") || "";
        state.admin.directorSchoolManageSchoolId = schoolSelect.value || "";
        state.admin.directorSchoolManageResultUid = "";
        state.admin.directorSchoolManageResultMessage = "";
        renderAdminUsersDirectory?.();
      });
    }
    if (els.judgeBioCloseBtn) {
      els.judgeBioCloseBtn.addEventListener("click", () => closeJudgeBioModal?.());
    }
    if (els.judgeBioCancelBtn) {
      els.judgeBioCancelBtn.addEventListener("click", () => closeJudgeBioModal?.());
    }
    if (els.judgeBioForm) {
      els.judgeBioForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const targetUid = els.judgeBioModal?.dataset.targetUid || "";
        if (!targetUid) return;
        const bio = els.judgeBioTextarea?.value.trim() || "";
        els.judgeBioSaveBtn.dataset.loadingLabel = "Saving...";
        await withLoading(els.judgeBioSaveBtn, async () => {
          try {
            await saveJudgeBio({ targetUid, bio });
            const user = (state.admin.usersList || []).find((u) => u.uid === targetUid);
            if (user) user.bio = bio;
            closeJudgeBioModal?.();
            renderAdminUsersDirectory?.();
          } catch (error) {
            console.error("saveJudgeBio failed", error);
            if (els.judgeBioResult) {
              els.judgeBioResult.textContent = error?.message || "Unable to save bio.";
            }
          }
        });
      });
    }

  };
}
