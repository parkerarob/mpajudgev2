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
  renderMockAdminPacketPreview,
  confirmUser,
  releaseMockPacketForAshleyTesting,
  alertUser,
  createEvent,
  saveAssignments,
  runEventPreflight,
  markReadinessStep,
  setReadinessWalkthrough,
  cleanupRehearsalArtifacts,
  renderAdminReadinessView,
  scheduleAdminPreflightRefresh,
  showStatusMessage,
  withLoading,
  saveSchool,
  resetAdminSchoolForm,
  getSelectedAdminSchool,
  startAdminSchoolEdit,
  deleteSchool,
  deleteEnsemble,
  bulkImportSchools,
  importConfirmedScheduleRows,
  provisionUser,
  updateUserDisplayName,
  deleteUserAccount,
  renderAdminUsersDirectory,
  renderDirectorAssignmentsDirectory,
  getSelectedDirectorForAdmin,
  assignDirectorSchool,
  getSchoolNameById,
  unassignDirectorSchool,
  renderAdminSchoolEnsembleManage,
  fetchRegisteredEnsembles,
  fetchScheduleEntries,
  parseConfirmedScheduleCsv,
  buildConfirmedSchedulePreview,
  summarizeConfirmedSchedulePreview,
  buildProgramRows,
  buildProgramCsv,
  buildProgramHtml,
  publishPublicProgram,
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
    const isRehearsalEvent = String(state.event.active?.eventMode || "").trim().toLowerCase() === "rehearsal";
    const controlState = computeReadinessControlState({
      hasActiveEvent,
      readinessInFlight: state.admin.readinessInFlight,
      isRehearsalEvent,
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
    if (els.adminCleanupRehearsalBtn) {
      els.adminCleanupRehearsalBtn.disabled = controlState.cleanupRehearsal.disabled;
      els.adminCleanupRehearsalBtn.title = controlState.cleanupRehearsal.title;
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

  const updateConfirmedScheduleControls = () => {
    const summary = summarizeConfirmedSchedulePreview(state.admin.confirmedSchedulePreviewRows);
    if (els.confirmedScheduleApplyBtn) {
      els.confirmedScheduleApplyBtn.disabled = !summary.canApply;
    }
  };

  const renderConfirmedSchedulePreview = () => {
    if (!els.confirmedSchedulePreviewBody) return;
    const rows = Array.isArray(state.admin.confirmedSchedulePreviewRows)
      ? state.admin.confirmedSchedulePreviewRows
      : [];
    const summary = summarizeConfirmedSchedulePreview(rows);
    if (els.confirmedScheduleStatus) {
      if (!rows.length) {
        els.confirmedScheduleStatus.textContent = "Choose a CSV file to preview matches.";
      } else {
        const parts = [
          `${summary.selected}/${summary.total} matched`,
          summary.needsReview ? `${summary.needsReview} need review` : null,
          summary.unmatched ? `${summary.unmatched} unmatched` : null,
          summary.duplicateCount ? `${summary.duplicateCount} duplicate target${summary.duplicateCount === 1 ? "" : "s"}` : null,
        ].filter(Boolean);
        els.confirmedScheduleStatus.textContent = parts.join(" - ");
      }
    }
    updateConfirmedScheduleControls();
    if (!rows.length) {
      els.confirmedSchedulePreviewBody.innerHTML =
        "<tr><td colspan='5' class='hint'>No schedule preview loaded.</td></tr>";
      return;
    }
    els.confirmedSchedulePreviewBody.innerHTML = "";
    const selectedIds = rows.map((row) => row.matchedEnsembleId).filter(Boolean);
    const duplicateIds = new Set(
      selectedIds.filter((ensembleId, index) => selectedIds.indexOf(ensembleId) !== index)
    );
    rows.forEach((row, index) => {
      const tr = document.createElement("tr");
      const indexCell = document.createElement("td");
      indexCell.textContent = String(row.rowNumber || index + 1);
      const nameCell = document.createElement("td");
      nameCell.textContent = row.bandName || "";
      const timeCell = document.createElement("td");
      timeCell.textContent = row.performanceAt
        ? row.performanceAt.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
        : row.performanceTime || "Time missing";
      const matchCell = document.createElement("td");
      const select = document.createElement("select");
      select.setAttribute("data-schedule-preview-index", String(index));
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = row.candidates.length ? "Select ensemble" : "No match found";
      select.appendChild(blank);
      const optionMap = new Map();
      row.candidates.forEach((candidate) => {
        optionMap.set(candidate.ensembleId, candidate);
      });
      (row.allCandidates || []).forEach((candidate) => {
        if (!optionMap.has(candidate.ensembleId)) {
          optionMap.set(candidate.ensembleId, candidate);
        }
      });
      Array.from(optionMap.values()).forEach((candidate) => {
        const option = document.createElement("option");
        option.value = candidate.ensembleId;
        const suffix = candidate.score ? ` (${candidate.score})` : "";
        option.textContent = `${candidate.fullLabel}${suffix}`;
        if (candidate.ensembleId === row.matchedEnsembleId) option.selected = true;
        select.appendChild(option);
      });
      matchCell.appendChild(select);

      const matchedCandidate = row.candidates.find((candidate) => candidate.ensembleId === row.matchedEnsembleId);
      const duplicate = row.matchedEnsembleId && duplicateIds.has(row.matchedEnsembleId);
      const statusText = duplicate
        ? "Duplicate target"
        : row.matchedEnsembleId
          ? "Ready"
          : row.status === "unmatched"
            ? "No candidate"
            : "Needs review";
      const statusCell = document.createElement("td");
      statusCell.textContent = `${statusText}${matchedCandidate?.existingPerformanceAt ? ` - currently ${matchedCandidate.existingPerformanceAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`;
      tr.appendChild(indexCell);
      tr.appendChild(nameCell);
      tr.appendChild(timeCell);
      tr.appendChild(matchCell);
      tr.appendChild(statusCell);
      els.confirmedSchedulePreviewBody.appendChild(tr);
    });
  };

  const loadConfirmedSchedulePreview = async (file) => {
    const event = getActiveEvent();
    if (!event?.id) {
      alertUser("Set the active 2026 event first.");
      return;
    }
    if (!file) {
      alertUser("Choose a CSV file first.");
      return;
    }
    const defaultYear = event.startAt?.toDate?.()?.getFullYear?.() || new Date().getFullYear();
    const text = await file.text();
    const parsedRows = parseConfirmedScheduleCsv(text, { defaultYear });
    if (!parsedRows.length) {
      state.admin.confirmedSchedulePreviewRows = [];
      state.admin.confirmedScheduleFileName = file.name || "";
      renderConfirmedSchedulePreview();
      alertUser("No schedule rows were found in that CSV.");
      return;
    }
    const [registeredEntries, scheduleEntries] = await Promise.all([
      fetchRegisteredEnsembles(event.id),
      fetchScheduleEntries(event.id),
    ]);
    state.admin.confirmedScheduleFileName = file.name || "";
    state.admin.confirmedSchedulePreviewRows = buildConfirmedSchedulePreview({
      csvRows: parsedRows,
      registeredEntries,
      scheduleEntries,
      schoolsList: state.admin.schoolsList,
      getSchoolNameById,
      normalizeEnsembleDisplayName,
    });
    renderConfirmedSchedulePreview();
  };

  const applyConfirmedSchedulePreview = async () => {
    const event = getActiveEvent();
    if (!event?.id) {
      alertUser("Set the active 2026 event first.");
      return;
    }
    const previewRows = Array.isArray(state.admin.confirmedSchedulePreviewRows)
      ? state.admin.confirmedSchedulePreviewRows
      : [];
    const summary = summarizeConfirmedSchedulePreview(previewRows);
    if (!summary.canApply) {
      alertUser("Resolve every unmatched or duplicate schedule row before applying.");
      return;
    }
    const payload = previewRows.map((row) => {
      const selected = [...(row.candidates || []), ...(row.allCandidates || [])]
        .find((candidate) => candidate.ensembleId === row.matchedEnsembleId);
      return {
        entryId: selected?.existingScheduleEntryId || "",
        schoolId: selected?.schoolId || "",
        schoolName: selected?.schoolName || "",
        ensembleId: selected?.ensembleId || "",
        ensembleName: selected?.ensembleName || row.bandName || "",
        performanceAtDate: row.performanceAt,
        orderIndex: row.orderIndex,
      };
    });
    const confirmed = confirmUser(
      `Apply ${payload.length} confirmed schedule time${payload.length === 1 ? "" : "s"} to the active event? This updates schedule docs only.`
    );
    if (!confirmed) return;
    await importConfirmedScheduleRows({
      eventId: event.id,
      rows: payload,
    });
    scheduleAdminPreflightRefresh?.({ immediate: true });
    if (els.confirmedScheduleStatus) {
      els.confirmedScheduleStatus.textContent =
        `Applied ${payload.length} schedule row${payload.length === 1 ? "" : "s"} from ${state.admin.confirmedScheduleFileName || "CSV"}.`;
    }
  };

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
        if (view === "liveEvent" && !isAdminLiveEventEnabled()) return;
        if (view === "settings" && !isAdminSettingsEnabled()) return;
        if (view === "preEvent") {
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
        if (view === "preEvent") {
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

    if (els.adminSafeModeLoadBtn) {
      els.adminSafeModeLoadBtn.addEventListener("click", () => {
        const view = state.admin.currentView;
        if (view === "preEvent") state.admin.preEventHeavyLoaded = true;
        if (view === "liveEvent") state.admin.liveEventHeavyLoaded = true;
        applyAdminView(view);
      });
    }

    if (els.adminPacketsSchoolSelect) {
      els.adminPacketsSchoolSelect.addEventListener("change", () => {
        state.admin.packetsSchoolId = els.adminPacketsSchoolSelect?.value || "";
        if (state.admin.currentView === "packets") {
          renderAdminPacketsBySchedule();
        }
      });
    }

    if (els.adminSubmissionsFilter) {
      els.adminSubmissionsFilter.addEventListener("change", () => {
        state.admin.rawAssessmentFilter = els.adminSubmissionsFilter?.value || "pending";
        if (state.admin.currentView === "submissions") {
          renderAdminLiveSubmissions();
        }
      });
    }

    if (els.adminPacketsMockPreviewBtn) {
      els.adminPacketsMockPreviewBtn.addEventListener("click", () => {
        if (!els.adminPacketsMockPanel) return;
        const isHidden = els.adminPacketsMockPanel.classList.contains("is-hidden");
        if (isHidden) {
          renderMockAdminPacketPreview();
          els.adminPacketsMockPanel.classList.remove("is-hidden");
          els.adminPacketsMockPreviewBtn.textContent = "Hide Mock Preview";
        } else {
          els.adminPacketsMockPanel.classList.add("is-hidden");
          els.adminPacketsMockPanel.innerHTML = "";
          els.adminPacketsMockPreviewBtn.textContent = "Preview Full Results Packet (Mock)";
        }
      });
    }
    if (els.adminPacketsReleaseAshleyMockBtn) {
      els.adminPacketsReleaseAshleyMockBtn.addEventListener("click", async () => {
        const ok = confirmUser("Release a mock 4-judge results packet to Ashley High School for testing?");
        if (!ok) return;
        els.adminPacketsReleaseAshleyMockBtn.dataset.loadingLabel = "Releasing...";
        await withLoading(els.adminPacketsReleaseAshleyMockBtn, async () => {
          try {
            const result = await releaseMockPacketForAshleyTesting();
            alertUser(
              `Mock results packet released for ${result.schoolName || "Ashley High School"} - ${result.ensembleName || result.ensembleId}.`
            );
            if (state.admin.currentView === "packets") {
              renderAdminPacketsBySchedule();
            }
          } catch (error) {
            console.error("releaseMockPacketForAshleyTesting failed", error);
            alertUser(error?.message || "Unable to release mock results packet.");
          }
        });
      });
    }

    if (els.createEventBtn) {
      els.createEventBtn.addEventListener("click", async () => {
        const name = els.eventNameInput?.value.trim() || "";
        const eventMode = els.eventModeInput?.value || "live";
        if (!name) {
          alertUser("Enter an event name.");
          return;
        }
        const now = new Date();
        const startAtDate = new Date(now);
        const endAtDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        els.createEventBtn.dataset.loadingLabel = "Creating...";
        await withLoading(els.createEventBtn, async () => {
          await createEvent({ name, eventMode, startAtDate, endAtDate });
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
      if (view === "liveEvent" && !isAdminLiveEventEnabled()) return;
      if (view === "settings" && !isAdminSettingsEnabled()) return;
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
          openAdminView("settings");
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

    if (els.adminCleanupRehearsalBtn) {
      els.adminCleanupRehearsalBtn.addEventListener("click", async () => {
        if (isReadinessBusy()) return;
        const eventId = state.event.active?.id || "";
        if (!eventId) {
          alertUser("Set an active event first.");
          return;
        }
        const ok = confirmUser("Delete unreleased rehearsal packets/open sheets for the active event?");
        if (!ok) return;
        setReadinessControlsDisabled(true);
        try {
          const result = await cleanupRehearsalArtifacts({ eventId });
          alertUser(
            `Cleanup complete. Open deleted: ${result.deletedOpenPackets || 0}; scheduled deleted: ${result.deletedScheduledPackets || 0}; released skipped: ${(result.skippedReleasedOpenPackets || 0) + (result.skippedReleasedScheduledPackets || 0)}.`
          );
          await renderAdminReadinessView?.();
        } catch (error) {
          console.error("cleanupRehearsalArtifacts failed", error);
          alertUser(error?.message || "Unable to cleanup rehearsal artifacts.");
        } finally {
          setReadinessControlsDisabled(false);
        }
      });
    }

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

    renderConfirmedSchedulePreview();

    if (els.confirmedSchedulePreviewBody) {
      els.confirmedSchedulePreviewBody.addEventListener("change", (event) => {
        const select = event.target.closest("[data-schedule-preview-index]");
        if (!select) return;
        const index = Number(select.getAttribute("data-schedule-preview-index") || -1);
        if (!Number.isInteger(index) || index < 0) return;
        const previewRows = Array.isArray(state.admin.confirmedSchedulePreviewRows)
          ? [...state.admin.confirmedSchedulePreviewRows]
          : [];
        const row = previewRows[index];
        if (!row) return;
        row.matchedEnsembleId = select.value || "";
        row.status = row.matchedEnsembleId
          ? "matched"
          : row.candidates.length
            ? "needs_review"
            : "unmatched";
        previewRows[index] = row;
        state.admin.confirmedSchedulePreviewRows = previewRows;
        renderConfirmedSchedulePreview();
      });
    }

    if (els.confirmedScheduleAnalyzeBtn) {
      els.confirmedScheduleAnalyzeBtn.addEventListener("click", async () => {
        const file = els.confirmedScheduleFileInput?.files?.[0] || null;
        els.confirmedScheduleAnalyzeBtn.dataset.loadingLabel = "Analyzing...";
        await withLoading(els.confirmedScheduleAnalyzeBtn, async () => {
          try {
            await loadConfirmedSchedulePreview(file);
          } catch (error) {
            console.error("Confirmed schedule analyze failed", error);
            const message = error?.message || "Unable to analyze confirmed schedule CSV.";
            if (els.confirmedScheduleStatus) els.confirmedScheduleStatus.textContent = message;
            alertUser(message);
          }
        });
      });
    }

    if (els.confirmedScheduleApplyBtn) {
      els.confirmedScheduleApplyBtn.addEventListener("click", async () => {
        els.confirmedScheduleApplyBtn.dataset.loadingLabel = "Applying...";
        await withLoading(els.confirmedScheduleApplyBtn, async () => {
          try {
            await applyConfirmedSchedulePreview();
          } catch (error) {
            console.error("Confirmed schedule apply failed", error);
            const message = error?.message || "Unable to apply confirmed schedule.";
            if (els.confirmedScheduleStatus) els.confirmedScheduleStatus.textContent = message;
            alertUser(message);
          }
        });
      });
    }

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
        if (!schoolId || !name) {
          alertUser("Enter a school ID and name.");
          return;
        }
        await saveSchool({ schoolId, name });
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
      els.adminSchoolManageSelect.addEventListener("change", async () => {
        const hasSelection = Boolean(els.adminSchoolManageSelect?.value);
        if (els.adminSchoolManageEditBtn) {
          els.adminSchoolManageEditBtn.disabled = !hasSelection;
        }
        if (els.adminSchoolManageDeleteBtn) {
          els.adminSchoolManageDeleteBtn.disabled = !hasSelection;
        }
        await renderAdminSchoolEnsembleManage?.();
      });
    }

    if (els.adminSchoolEnsembleManageSelect) {
      els.adminSchoolEnsembleManageSelect.addEventListener("change", () => {
        if (els.adminSchoolEnsembleDeleteBtn) {
          els.adminSchoolEnsembleDeleteBtn.disabled = !els.adminSchoolEnsembleManageSelect?.value;
        }
      });
    }

    if (els.adminSchoolManageEditBtn) {
      els.adminSchoolManageEditBtn.addEventListener("click", () => {
        const school = getSelectedAdminSchool();
        if (!school) return;
        startAdminSchoolEdit(school);
      });
    }

    if (els.adminSchoolManageDeleteBtn) {
      els.adminSchoolManageDeleteBtn.addEventListener("click", async () => {
        const school = getSelectedAdminSchool();
        if (!school) return;
        const label = school.name || school.id;
        const ok = confirmUser(
          `Delete school ${label}? This only works if no ensembles, users, entries, schedule items, or open packets reference it.`
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

    if (els.adminSchoolEnsembleDeleteBtn) {
      els.adminSchoolEnsembleDeleteBtn.addEventListener("click", async () => {
        const school = getSelectedAdminSchool();
        const ensembleId = els.adminSchoolEnsembleManageSelect?.value || "";
        if (!school || !ensembleId) return;
        const ensembleName =
          state.admin.schoolManageEnsembles?.find((item) => item.id === ensembleId)?.name || ensembleId;
        const schoolLabel = school.name || school.id;
        const ok = confirmUser(
          `Delete ensemble ${ensembleName} from ${schoolLabel}? This will fully remove linked schedule, entries, official assessments, supporting release records, and packets.`
        );
        if (!ok) return;
        els.adminSchoolEnsembleDeleteBtn.dataset.loadingLabel = "Deleting...";
        await withLoading(els.adminSchoolEnsembleDeleteBtn, async () => {
          try {
            await deleteEnsemble({ schoolId: school.id, ensembleId, force: true });
            scheduleAdminPreflightRefresh?.({ immediate: true });
            if (els.schoolResult) {
              els.schoolResult.textContent = `Deleted ensemble ${ensembleName} from ${schoolLabel}.`;
            }
            await renderAdminSchoolEnsembleManage?.();
            if (state.admin.currentView === "preEvent") {
              applyAdminView("preEvent");
            }
          } catch (error) {
            console.error("Delete ensemble failed", error);
            const message = error?.message || "Unable to delete ensemble.";
            alertUser(message);
          }
        });
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
            renderDirectorAssignmentsDirectory();
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

    if (els.adminUsersList) {
      els.adminUsersList.addEventListener("click", async (event) => {
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
              renderDirectorAssignmentsDirectory?.();
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
            renderDirectorAssignmentsDirectory?.();
          } catch (error) {
            console.error("deleteUserAccount failed", error);
            if (els.adminUsersResult) {
              els.adminUsersResult.textContent = extractDeleteUserErrorMessage(error);
            }
            alertUser(extractDeleteUserErrorMessage(error));
          }
        });
      });
    }

    if (els.directorAssignDirectorSelect) {
      els.directorAssignDirectorSelect.addEventListener("change", () => {
        renderDirectorAssignmentsDirectory();
      });
    }
    if (els.directorAssignSchoolSelect) {
      els.directorAssignSchoolSelect.addEventListener("change", () => {
        renderDirectorAssignmentsDirectory();
      });
    }
    if (els.directorAssignBtn) {
      els.directorAssignBtn.addEventListener("click", async () => {
        const director = getSelectedDirectorForAdmin();
        const schoolId = els.directorAssignSchoolSelect?.value || "";
        if (!director || !schoolId) return;
        els.directorAssignBtn.dataset.loadingLabel = "Assigning...";
        await withLoading(els.directorAssignBtn, async () => {
          try {
            await assignDirectorSchool({ directorUid: director.uid, schoolId });
            scheduleAdminPreflightRefresh?.();
            if (els.directorManageResult) {
              const schoolName = getSchoolNameById(state.admin.schoolsList, schoolId) || schoolId;
              els.directorManageResult.textContent = `Assigned ${director.displayName || director.email || director.uid} to ${schoolName}.`;
            }
          } catch (error) {
            console.error("assignDirectorSchool failed", error);
            if (els.directorManageResult) {
              els.directorManageResult.textContent = error?.message || "Unable to assign director.";
            }
          }
        });
      });
    }
    if (els.directorUnassignBtn) {
      els.directorUnassignBtn.addEventListener("click", async () => {
        const director = getSelectedDirectorForAdmin();
        if (!director || !director.schoolId) return;
        const label = director.displayName || director.email || director.uid;
        if (!confirmUser(`Remove ${label} from their school assignment?`)) return;
        els.directorUnassignBtn.dataset.loadingLabel = "Removing...";
        await withLoading(els.directorUnassignBtn, async () => {
          try {
            await unassignDirectorSchool({ directorUid: director.uid });
            scheduleAdminPreflightRefresh?.();
            if (els.directorManageResult) {
              els.directorManageResult.textContent = `Removed ${label} from school assignment.`;
            }
          } catch (error) {
            console.error("unassignDirectorSchool failed", error);
            if (els.directorManageResult) {
              els.directorManageResult.textContent = error?.message || "Unable to remove director.";
            }
          }
        });
      });
    }
  };
}
