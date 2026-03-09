import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import {
  COLLECTIONS,
  FIELDS,
  STATUSES,
  JUDGE_POSITIONS,
  JUDGE_POSITION_LABELS,
  FORM_TYPES,
  REPERTOIRE_FIELDS,
  STANDARD_INSTRUMENTS,
  PERCUSSION_OPTIONS,
  MAX_RULE3C_ENTRIES,
  SEATING_ROWS,
  CAPTION_TEMPLATES,
  els,
  state,
} from "../state.js";
import {
  bulkImportSchools,
  createEvent,
  createScheduleEntry,
  cleanupRehearsalArtifacts,
  deleteUserAccount,
  deleteEvent,
  deleteEnsemble,
  deleteAllUnreleasedPackets,
  cleanupTestArtifacts,
  deleteOpenPacket,
  deleteScheduledPacket,
  attachManualAudioToScheduledPacket,
  attachManualAudioToOpenPacket,
  createAudioOnlyResultFromFile,
  releaseAudioOnlyResult,
  unreleaseAudioOnlyResult,
  repairManualAudioOverrides,
  deleteScheduleEntry,
  deleteSchool,
  assignDirectorSchool,
  getPacketData,
  getLunchTotalsBySchool,
  renameEvent,
  lockOpenPacket,
  lockSubmission,
  linkOpenPacketToEnsemble,
  provisionUser,
  releasePacket,
  releaseMockPacketForAshleyTesting,
  runEventPreflight,
  saveAssignments,
  saveSchool,
  markReadinessStep,
  setReadinessWalkthrough,
  setActiveEvent,
  releaseOpenPacket,
  unreleasePacket,
  unreleaseOpenPacket,
  unassignDirectorSchool,
  unlockOpenPacket,
  unlockSubmission,
  updateEventSchedulerFields,
  updateScheduleEntryTime,
  watchAssignmentsForActiveEvent,
  watchActiveEvent,
  watchDirectors,
  watchEvents,
  watchJudges,
  watchRoster,
  watchSchools,
  watchUsers,
  fetchRegisteredEnsembles,
  fetchScheduleEntries,
  updateEntryCheckinFields,
} from "./admin.js";
import { computeScheduleTimeline } from "./scheduleTimeline.js";
import {
  WALKTHROUGH_STEP_KEYS,
  buildFallbackReadinessChecks,
  buildWalkthroughSummary,
  computeReadinessControlState,
  mergeReadinessChecks,
  summarizeReadinessChecks,
} from "./readiness-walkthrough.js";
import {
  attachDirectorSchool,
  createDirectorEnsemble,
  computeDirectorCompletionState,
  discardDirectorDraftChanges,
  handleDeleteEnsemble,
  isDirectorManager,
  hasDirectorUnsavedChanges,
  getMpaRepertoireForGrade,
  getDirectorSchoolId,
  invalidateDirectorSchoolLunchTotalCache,
  loadDirectorEntry,
  loadDirectorSchoolLunchTotal,
  markDirectorDirty,
  markEntryDraft,
  markEntryReady,
  renameDirectorEnsemble,
  saveDirectorProfile,
  saveInstrumentationSection,
  saveLunchSection,
  savePercussionSection,
  saveRepertoireSection,
  saveRule3cSection,
  saveSeatingSection,
  setDirectorEvent,
  selectDirectorEnsemble,
  uploadDirectorProfileCard,
  uploadSignedSignatureForm,
  fetchDirectorPacketAssets,
  fetchDirectorAudioResultAsset,
  upsertRegistrationForEnsemble,
  watchDirectorEnsembles,
  watchDirectorPackets,
  watchDirectorSchool,
  watchDirectorSchoolDirectors,
} from "./director.js";
import {
  draftCaptionsFromTranscript,
} from "./judge.js";
import {
  calculateCaptionTotal,
  computeFinalRating,
} from "./judge-shared.js";
import {
  createOpenPacket,
  fetchOpenEnsembleIndex,
  fetchOfficialOpenEnsembleIndex,
  getOpenCaptionTemplate,
  isOpenPacketEditable,
  loadDirectorEntrySnapshotForJudge,
  loadOpenPrefs,
  markJudgeOpenDirty,
  resetJudgeOpenState,
  retryOpenSessionUploads,
  setJudgeOpenAutoTranscriptionHooks,
  selectOpenPacket,
  saveOpenPrefs,
  saveOpenPrefsToServer,
  startOpenRecording,
  stopOpenRecording,
  submitOpenPacket,
  finalizeOpenTapeAutoTranscription,
  transcribeOpenSegment,
  transcribeOpenTape,
  updateOpenPacketDraft,
  watchOpenPackets,
} from "./judge-open.js";
import {
  createDirectorAccount,
  requestPasswordReset,
  signIn,
  signOut,
} from "./auth.js";
import { saveUserDisplayName } from "./profile.js";
import {
  getDefaultTabForRole,
  hasUnsavedChanges,
  isTabAllowed,
  resolveHash,
  setTab as setTabState,
} from "./navigation.js";
import { DEV_FLAGS, db, storage } from "../firebase.js";
import { collection, doc, getDoc, getDocs, orderBy, query, updateDoc, serverTimestamp, where, fetchEnsembleGrade, fetchEntryStatus } from "./firestore.js";
import {
  formatPerformanceAt,
  formatDateHeading,
  getEventCardLabel,
  getEventLabel,
  getSchoolNameById,
  normalizeEnsembleNameForSchool,
  normalizeGrade,
  derivePerformanceGrade,
  levelToRoman,
  romanToLevel,
} from "./utils.js";
import { createAdminViewController } from "./ui-admin-shell.js";
import { createAdminRenderers } from "./ui-admin-renderers.js";
import { createAdminLiveRenderers } from "./ui-admin-live-renderers.js";
import { createJudgeOpenRenderers } from "./ui-judge-open-renderers.js";
import { createJudgeOpenHandlerBinder } from "./ui-judge-open-handlers.js";
import { createDirectorEnsembleRenderer } from "./ui-director-ensembles.js";
import { createDirectorDashboardRenderer } from "./ui-director-dashboard.js";
import { createDirectorContextPanelRenderer } from "./ui-director-context-panel.js";
import { createDirectorEditorShellRenderer } from "./ui-director-editor-shell.js";
import { createDirectorHandlerBinder } from "./ui-director-handlers.js";
import { createDirectorPacketRenderers } from "./ui-director-packets.js";
import { createDirectorDayOfRenderer } from "./ui-director-dayof.js";
import { createDirectorRegistrationRenderers } from "./ui-director-registration.js";
import { createDirectorEventRenderers } from "./ui-director-events.js";
import { createJudgeOpenCore } from "./ui-judge-open-core.js";
import { createJudgeOpenDirectorReference } from "./ui-judge-open-reference.js";
import { createAppHandlerBinder } from "./ui-app-handlers.js";
import { createJudgeOpenSession } from "./ui-judge-open-session.js";
import { createAuthHandlerBinder } from "./ui-auth-handlers.js";
import { createAdminHandlerBinder } from "./ui-admin-handlers.js";
import { getAdminHashForView, resolveAdminView } from "./admin-navigation.js";
import { resolveAdminDirectorReturnView } from "./director-attach-policy.js";
import { createAdminMockPacketPreviewRenderer } from "./ui-admin-mock-packet.js";
import { createDirectorEntryFormRenderers } from "./ui-director-entry-form.js";
import {
  escapeHtml,
  normalizeEnsembleDisplayName,
  formatSchoolEnsembleLabel,
  formatTimeRange,
  toLocalDatetimeValue,
  formatStartTime,
  toDateOrNull,
  deriveAutoScheduleDayBreaks,
  mergeScheduleDayBreaks,
  computeEnsembleCheckinStatus,
} from "./ui-admin-formatters.js";

export function alertUser(message) {
  window.alert(message);
}

export function confirmUser(message) {
  return window.confirm(message);
}

function getEffectiveRole(profile) {
  if (!profile) return null;
  const rawRole = String(profile.role || "").trim();
  if (rawRole) {
    const lower = rawRole.toLowerCase();
    if (lower === "admin") return "admin";
    if (lower === "judge") return "judge";
    if (lower === "director") return "director";
    if (lower === "teamlead" || lower === "team_lead" || lower === "team lead") return "teamLead";
  }
  if (profile.roles?.admin) return "admin";
  if (profile.roles?.teamLead) return "teamLead";
  if (profile.roles?.judge) return "judge";
  if (profile.roles?.director) return "director";
  return null;
}


function canUseOpenJudge(profile) {
  if (state.app.features?.enableJudgeOpen === false) return false;
  const role = getEffectiveRole(profile);
  return role === "judge" || role === "admin";
}

function isAdminLiveEventEnabled() {
  return state.app.features?.enableAdminLiveEvent !== false;
}

function isAdminSettingsEnabled() {
  return (
    state.app.features?.enableAdminSettings !== false &&
    state.app.features?.enableAdminDirectory !== false &&
    getEffectiveRole(state.auth.userProfile) === "admin"
  );
}

function detectOpenJudgeAssignment(assignments, uid) {
  if (!assignments || !uid) return null;
  if (assignments.stage1Uid === uid) return JUDGE_POSITIONS.stage1;
  if (assignments.stage2Uid === uid) return JUDGE_POSITIONS.stage2;
  if (assignments.stage3Uid === uid) return JUDGE_POSITIONS.stage3;
  if (assignments.sightUid === uid) return JUDGE_POSITIONS.sight;
  return null;
}

function getOpenEventDefaultsPreference() {
  return true;
}

function syncOpenEventDefaultsUI() {
  if (!els.judgeOpenEventDefaultsStatus) return;
  const assignment = state.judgeOpen.activeEventAssignment;
  const activeEventName = state.event.active?.name || "Active Event";
  if (!state.event.active?.id) {
    els.judgeOpenEventDefaultsStatus.textContent = "";
    return;
  }
  if (!assignment) {
    els.judgeOpenEventDefaultsStatus.textContent = `${activeEventName}`;
    return;
  }
  const label = JUDGE_POSITION_LABELS[assignment.judgePosition] || assignment.judgePosition;
  els.judgeOpenEventDefaultsStatus.textContent = `${activeEventName} · ${label}`;
}

function updateJudgeOpenModeUI() {
  const mode = state.judgeOpen.mode;
  const showModeSelect = !mode;
  if (els.judgeOpenModeSelectView) {
    els.judgeOpenModeSelectView.classList.toggle("is-hidden", !showModeSelect);
  }
  if (els.judgeOpenWorkspace) {
    els.judgeOpenWorkspace.classList.toggle("is-hidden", showModeSelect);
  }
  if (els.judgeOpenWorkspaceModeLabel) {
    if (!mode) {
      els.judgeOpenWorkspaceModeLabel.textContent = "";
    } else if (mode === "official") {
      els.judgeOpenWorkspaceModeLabel.textContent = "Official Adjudication Mode";
    } else {
      els.judgeOpenWorkspaceModeLabel.textContent = "Practice Adjudication Mode";
    }
  }
  if (els.judgeOpenModeHint) {
    if (!state.event.active?.id) {
      els.judgeOpenModeHint.textContent = "No active event is set. Practice adjudication is available.";
    } else if (!state.judgeOpen.activeEventAssignment) {
      els.judgeOpenModeHint.textContent =
        `Active event "${state.event.active.name || state.event.active.id}" is set, but your account has no judge assignment.`;
    } else {
      const label =
        JUDGE_POSITION_LABELS[state.judgeOpen.activeEventAssignment.judgePosition] ||
        state.judgeOpen.activeEventAssignment.judgePosition;
      els.judgeOpenModeHint.textContent =
        `Official adjudications will use ${label} in ${state.event.active.name || "the active event"}.`;
    }
  }
  if (els.judgeOpenStatusBadge) {
    if (!mode) {
      els.judgeOpenStatusBadge.textContent = "Choose Mode";
    } else if (mode === "official") {
      els.judgeOpenStatusBadge.textContent = "Official";
    } else {
      els.judgeOpenStatusBadge.textContent = "Practice";
    }
  }
  syncJudgeOpenStickyBarVisibility();
}

async function chooseJudgeOpenMode(mode) {
  const nextMode = mode === "official" ? "official" : "practice";
  state.judgeOpen.mode = nextMode;
  state.judgeOpen.currentPacketId = null;
  state.judgeOpen.currentPacket = null;
  state.judgeOpen.selectedExisting = null;
  state.judgeOpen.existingEnsembleIndexDirty = true;
  state.judgeOpen.openPacketsLastSig = "";
  state.judgeOpen.openPacketsPendingRender = state.judgeOpen.packets || [];
  state.judgeOpen.restoreAttempted = false;
  if (nextMode === "official") {
    state.judgeOpen.useActiveEventDefaults = true;
  }
  saveOpenPrefs({ judgeAdjudicationMode: nextMode });
  try {
    await saveOpenPrefsToServer({ judgeAdjudicationMode: nextMode });
  } catch (error) {
    console.error("saveOpenPrefsToServer mode failed", error);
  }
  updateJudgeOpenModeUI();
  maybeRefreshJudgeOpenExistingEnsembles({ force: true });
  scheduleOpenPacketOptionsRender();
  await restoreOpenPacketFromPrefs();
  updateOpenHeader();
  updateOpenEmptyState();
  updateOpenSubmitState();
}

function resetJudgeOpenModeSelection() {
  state.judgeOpen.mode = null;
  updateJudgeOpenModeUI();
}

async function backToJudgeOpenLanding() {
  if (state.judgeOpen.mediaRecorder?.state === "recording") {
    setOpenPacketHint("Stop recording before leaving this adjudication.");
    return;
  }
  resetJudgeOpenState();
  state.judgeOpen.mode = null;
  if (els.judgeOpenPacketSelect) els.judgeOpenPacketSelect.value = "";
  if (els.judgeOpenExistingSelect) els.judgeOpenExistingSelect.value = "";
  if (els.judgeOpenTranscriptInput) els.judgeOpenTranscriptInput.value = "";
  if (els.judgeOpenDraftStatus) els.judgeOpenDraftStatus.textContent = "";
  updateJudgeOpenModeUI();
  renderOpenPacketOptions([]);
  renderOpenExistingOptions([]);
  updateOpenHeader();
  updateOpenEmptyState();
  updateOpenSubmitState();
  setOpenPacketHint("Choose Practice or Official to begin.");
}

function syncJudgeOpenStickyBarVisibility() {
  if (!els.judgeOpenStickyBar) return;
  const shouldShow =
    Boolean(state.judgeOpen.mode) &&
    state.judgeOpen.detailViewIntent === "detail";
  els.judgeOpenStickyBar.style.display = shouldShow ? "" : "none";
}

function applyOpenEventAssignmentDefaults() {
  if (!getOpenEventDefaultsPreference()) return;
  if (state.judgeOpen.currentPacketId) return;
  const assignment = state.judgeOpen.activeEventAssignment;
  if (!assignment) return;
  const nextFormType =
    assignment.judgePosition === JUDGE_POSITIONS.sight ? FORM_TYPES.sight : FORM_TYPES.stage;
  if (state.judgeOpen.formType !== nextFormType) {
    state.judgeOpen.formType = nextFormType;
    if (els.judgeOpenFormTypeSelect) {
      els.judgeOpenFormTypeSelect.value = nextFormType;
    }
    syncOpenFormTypeSegmented();
    renderOpenCaptionForm();
    updateOpenSubmitState();
  }
}

function refreshOpenEventDefaultsState() {
  const uid = state.auth.currentUser?.uid || null;
  const judgePosition = detectOpenJudgeAssignment(state.event.assignments, uid);
  if (judgePosition && state.event.active?.id) {
    state.judgeOpen.activeEventAssignment = {
      eventId: state.event.active.id,
      judgePosition,
      source: "activeEventDefault",
    };
  } else {
    state.judgeOpen.activeEventAssignment = null;
  }
  syncOpenEventDefaultsUI();
  applyOpenEventAssignmentDefaults();
  updateJudgeOpenModeUI();
}

function startActiveAssignmentsWatcher() {
  watchAssignmentsForActiveEvent((assignments) => {
    if (!state.admin.assignmentsDirty) {
      setStageJudgeSelectValues(assignments || {});
    }
    renderAdminReadiness();
    if (state.app.currentTab === "admin" && state.admin.currentView === "readiness") {
      renderAdminReadinessView();
    }
    refreshOpenEventDefaultsState();
  });
}

function updateDirectorReadyControlsFromState(completionState) {
  if (!state.director.entryDraft) {
    setDirectorReadyControls({ status: "disabled" });
    return;
  }
  if (state.director.entryDraft.status === "ready") {
    setDirectorReadyControls({ status: "ready" });
    return;
  }
  const ready = Boolean(completionState?.ready);
  setDirectorReadyControls({ status: ready ? "draft" : "disabled" });
}

function applyDirectorDirty(section) {
  const completion = markDirectorDirty(section);
  renderDirectorChecklist(state.director.entryDraft, completion);
  updateDirectorReadyControlsFromState(completion);
}

function updateLunchTotalCost() {
  if (!els.lunchTotalCost || !state.director.entryDraft) return;
  const pepperoni = Number(state.director.entryDraft.lunchOrder?.pepperoniQty || 0);
  const cheese = Number(state.director.entryDraft.lunchOrder?.cheeseQty || 0);
  const totalMeals = Math.max(pepperoni + cheese, 0);
  const total = totalMeals * 8;
  els.lunchTotalCost.textContent = `Pizza Order Total: $${total.toFixed(2)}`;
}

async function handleDirectorEnsembleSelection(ensembleId) {
  if (!ensembleId || ensembleId === state.director.selectedEnsembleId) return;
  if (hasDirectorUnsavedChanges() && !confirmUser("You have unsaved changes. Leave anyway?")) {
    return;
  }
  discardDirectorDraftChanges();
  selectDirectorEnsemble(ensembleId);
  updateDirectorActiveEnsembleLabel();
  renderDirectorEnsembles(state.director.ensemblesCache);
  await loadDirectorEntry({
    onUpdate: applyDirectorEntryUpdate,
    onClear: applyDirectorEntryClear,
  });
}

async function handleDirectorEnsembleOpenForms(ensembleId) {
  if (!ensembleId) return;
  if (ensembleId !== state.director.selectedEnsembleId) {
    await handleDirectorEnsembleSelection(ensembleId);
  }
  state.director.view = "dayOfForms";
  state.director.activePath = "ensembles";
  updateDirectorAttachUI();
  renderDayOfEnsembleSelector();
  await loadDirectorEntry({
    onUpdate: applyDirectorEntryUpdate,
    onClear: applyDirectorEntryClear,
  });
}

async function handleDirectorEnsembleDelete(ensembleId, ensembleName) {
  const label = ensembleName || ensembleId || "this ensemble";
  if (!confirmUser(`Delete ${label}?`)) return;
  const result = await handleDeleteEnsemble(ensembleId, ensembleName);
  if (!result?.ok) {
    alertUser(result?.message || "Unable to delete ensemble.");
    return;
  }
  if (!state.director.selectedEnsembleId) {
    applyDirectorEntryClear({
      hint: "Select an ensemble and event to begin.",
      status: "Draft",
      readyStatus: "disabled",
    });
  }
}

function setDirectorEnsembleFormMode({ mode = "create", ensemble = null } = {}) {
  const isEdit = mode === "edit" && ensemble?.id;
  state.director.editingEnsembleId = isEdit ? ensemble.id : null;
  if (els.directorEnsembleSubmitBtn) {
    els.directorEnsembleSubmitBtn.textContent = isEdit ? "Save Ensemble" : "Create Ensemble";
  }
  if (els.directorEnsembleNameInput && isEdit) {
    els.directorEnsembleNameInput.value = ensemble.name || "";
  }
  if (els.directorEnsembleForm) {
    els.directorEnsembleForm.classList.remove("is-hidden");
  }
  if (els.directorEnsembleError) {
    els.directorEnsembleError.textContent = "";
  }
}

function closeDirectorEnsembleForm() {
  state.director.editingEnsembleId = null;
  if (els.directorEnsembleForm) {
    els.directorEnsembleForm.reset();
    els.directorEnsembleForm.classList.add("is-hidden");
  }
  if (els.directorEnsembleSubmitBtn) {
    els.directorEnsembleSubmitBtn.textContent = "Create Ensemble";
  }
  if (els.directorEnsembleError) {
    els.directorEnsembleError.textContent = "";
  }
}

function applyDirectorEntryUpdate({
  entry,
  status,
  readyStatus,
  performanceGrade,
  completionState,
  updatedAt,
} = {}) {
  if (entry) {
    renderDirectorEntryForm(entry);
  }
  renderDirectorEditorShell();
    setDirectorEntryStatusLabel(status || "Incomplete");
  setDirectorPerformanceGradeValue(performanceGrade || entry?.performanceGrade || "");
  setPerformanceGradeError("");
  renderDirectorChecklist(entry, completionState);
  updateDirectorReadyControlsFromState(completionState);
  if (updatedAt) {
    setDirectorEntryHint(`Last updated ${updatedAt.toLocaleString()}`);
  } else {
    setDirectorEntryHint("");
  }
  renderDirectorWorkflowGuidance();
  refreshDirectorSchoolLunchTotal();
}

function applyDirectorEntryClear({ hint, status, readyStatus } = {}) {
  clearDirectorEntryPanels();
  renderDirectorEditorShell();
  setDirectorEntryHint(hint || "");
    setDirectorEntryStatusLabel(status || "Incomplete");
  setDirectorReadyControls({ status: readyStatus || "disabled" });
  setDirectorPerformanceGradeValue("");
  setPerformanceGradeError("");
  renderDirectorChecklist(null, computeDirectorCompletionState(null));
  invalidateDirectorSchoolLunchTotalCache({
    eventId: state.director.selectedEventId || state.event.active?.id || null,
    schoolId: getDirectorSchoolId() || null,
  });
  renderDirectorWorkflowGuidance();
  refreshDirectorSchoolLunchTotal();
}

function applyDirectorSaveResult(section, result) {
  if (!result) return;
  let messageShown = false;
  if (result.ok) {
    showDirectorSectionStatus(section, result.message);
    messageShown = Boolean(result.message);
    if (result.statusChangedToDraft) {
      setDirectorEntryStatusLabel("Incomplete");
    }
  } else if (result.reason === "validation") {
    showDirectorSectionStatus(section, result.message, "error");
    messageShown = Boolean(result.message);
  } else if (result.message) {
    showDirectorSectionStatus(section, result.message, "error");
    messageShown = true;
  }
  if (!messageShown) {
    showDirectorSectionStatus(section, "");
  }
  if (result.performanceGrade) {
    setDirectorPerformanceGradeValue(result.performanceGrade);
  }
  if (result.performanceGradeError) {
    setPerformanceGradeError(result.performanceGradeError);
  } else if (result.ok) {
    setPerformanceGradeError("");
  }
  const completion = computeDirectorCompletionState(state.director.entryDraft);
  renderDirectorChecklist(state.director.entryDraft, completion);
  updateDirectorReadyControlsFromState(completion);
  if (section === "lunch") {
    invalidateDirectorSchoolLunchTotalCache({
      eventId: state.director.selectedEventId || state.event.active?.id || null,
      schoolId: getDirectorSchoolId() || null,
    });
    refreshDirectorSchoolLunchTotal();
  }
}

export function setRoleHint(message) {
  els.roleHint.textContent = message;
}

export function setAuthSuccess(message) {
  if (!els.authSuccess) return;
  if (!message) {
    els.authSuccess.hidden = true;
    els.authSuccess.textContent = "";
    return;
  }
  els.authSuccess.hidden = false;
  els.authSuccess.textContent = message;
  window.setTimeout(() => {
    if (els.authSuccess.textContent === message) {
      setAuthSuccess("");
    }
  }, 5000);
}

export function setProvisioningNotice(message) {
  if (!els.provisioningNotice) return;
  if (!message) {
    els.provisioningNotice.hidden = true;
    els.provisioningNotice.textContent = "";
    return;
  }
  els.provisioningNotice.hidden = false;
  els.provisioningNotice.textContent = message;
}

export function setDirectorSaveStatus(message) {
  if (!els.directorSaveStatus) return;
  els.directorSaveStatus.textContent = message || "";
}

export function setDirectorHint(message) {
  if (!els.directorHint) return;
  els.directorHint.textContent = message || "";
}

export function setDirectorSchoolName(name) {
  if (els.directorSchoolName) {
    els.directorSchoolName.textContent = name || "";
  }
  if (els.directorSummarySchool) {
    els.directorSummarySchool.textContent = name || "";
  }
  renderDirectorContextPanel();
}

function setDirectorSchoolLunchTotalText(text) {
  if (!els.directorSchoolLunchTotal) return;
  els.directorSchoolLunchTotal.textContent = text || "";
}

async function refreshDirectorSchoolLunchTotal() {
  if (!els.directorSchoolLunchTotal) return;
  const schoolId = getDirectorSchoolId();
  const eventId = state.director.selectedEventId || state.event.active?.id || null;
  if (!isDirectorManager() || !schoolId || !eventId) {
    setDirectorSchoolLunchTotalText("");
    return;
  }

  const version = (state.director.lunchTotalLoadVersion || 0) + 1;
  state.director.lunchTotalLoadVersion = version;
  try {
    const result = await loadDirectorSchoolLunchTotal({ eventId, schoolId });
    if (state.director.lunchTotalLoadVersion !== version) return;
    const total = Number(result?.total || 0);
    setDirectorSchoolLunchTotalText(
      `Total for Pizza Orders: $${total.toFixed(2)} - check payable to Ashley High School Band Boosters`
    );
  } catch (error) {
    console.error("refreshDirectorSchoolLunchTotal failed", error);
    if (state.director.lunchTotalLoadVersion !== version) return;
    setDirectorSchoolLunchTotalText("");
  }
}

export function renderDirectorSchoolDirectors(directors = []) {
  if (!els.directorSchoolDirectors) return;
  els.directorSchoolDirectors.innerHTML = "";
  if (!directors.length) {
    els.directorSchoolDirectors.style.display = "grid";
    const empty = document.createElement("div");
    empty.className = "note";
    empty.textContent = "No director profiles attached.";
    els.directorSchoolDirectors.appendChild(empty);
    return;
  }
  els.directorSchoolDirectors.style.display = "grid";
  directors.forEach((director) => {
    const row = document.createElement("div");
    row.className = "director-school-director";
    const name = document.createElement("div");
    name.className = "director-school-director-name";
    name.textContent = director.displayName || "Director";
    row.appendChild(name);
    els.directorSchoolDirectors.appendChild(row);
  });
}

export function setDirectorSummaryName(name) {
  if (!els.directorSummaryName) return;
  els.directorSummaryName.textContent = name || "Director";
}

export function setPerformanceGradeError(message) {
  if (!els.performanceGradeError) return;
  els.performanceGradeError.textContent = message || "";
}

export function setSavingState(button, isSaving, savingLabel = "Saving...") {
  if (!button) return;
  if (isSaving) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = savingLabel;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    ensureButtonSpinner(button);
    button.classList.add("is-loading");
    beginLoadingAction();
  } else {
    const original = button.dataset.originalLabel;
    button.textContent = original || button.textContent;
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.classList.remove("is-loading");
    endLoadingAction();
    delete button.dataset.originalLabel;
  }
}

function setAuthFormDisabled(disabled) {
  if (els.emailInput) els.emailInput.disabled = disabled;
  if (els.passwordInput) els.passwordInput.disabled = disabled;
  if (els.emailSignInBtn) els.emailSignInBtn.disabled = disabled;
  if (els.forgotPasswordBtn) els.forgotPasswordBtn.disabled = disabled;
}

export function ensureButtonSpinner(button) {
  if (!button) return null;
  if (button.querySelector(".button-spinner")) {
    return button.querySelector(".button-spinner");
  }
  const spinner = document.createElement("span");
  spinner.className = "button-spinner";
  spinner.setAttribute("aria-hidden", "true");
  button.appendChild(spinner);
  return spinner;
}

let activeLoadingActionCount = 0;

function beginLoadingAction() {
  activeLoadingActionCount += 1;
  if (activeLoadingActionCount <= 0) activeLoadingActionCount = 1;
  document.body.classList.add("app-busy");
}

function endLoadingAction() {
  activeLoadingActionCount = Math.max(0, activeLoadingActionCount - 1);
  if (activeLoadingActionCount === 0) {
    document.body.classList.remove("app-busy");
  }
}

export async function withLoading(buttonElement, asyncFn) {
  if (!buttonElement) {
    return asyncFn();
  }
  if (buttonElement.dataset.loading === "true") return;
  buttonElement.dataset.loading = "true";
  const labelEl = buttonElement.querySelector("[data-button-label]");
  const originalLabel = labelEl ? labelEl.textContent : buttonElement.textContent;
  const loadingLabel = buttonElement.dataset.loadingLabel || "Saving...";
  buttonElement.dataset.originalLabel = originalLabel;
  buttonElement.disabled = true;
  if (labelEl) {
    labelEl.textContent = loadingLabel;
  } else {
    buttonElement.textContent = loadingLabel;
  }
  buttonElement.setAttribute("aria-busy", "true");
  ensureButtonSpinner(buttonElement);
  buttonElement.classList.add("is-loading");
  beginLoadingAction();
  try {
    await asyncFn();
  } catch (error) {
    console.error("Async action failed", error);
  } finally {
    buttonElement.disabled = false;
    if (labelEl) {
      labelEl.textContent = originalLabel;
    } else {
      buttonElement.textContent = originalLabel;
    }
    buttonElement.classList.remove("is-loading");
    buttonElement.removeAttribute("aria-busy");
    endLoadingAction();
    delete buttonElement.dataset.loading;
    delete buttonElement.dataset.originalLabel;
  }
}

export function showStatusMessage(targetEl, message, type = "info") {
  if (!targetEl) return;
  targetEl.textContent = message || "";
  if (!message) return;
  if (type === "error") {
    targetEl.classList.add("error");
  } else {
    targetEl.classList.remove("error");
  }
  window.setTimeout(() => {
    if (targetEl.textContent === message) {
      targetEl.textContent = "";
      targetEl.classList.remove("error");
    }
  }, 2000);
}

export function setDirectorEntryStatusLabel(status) {
  if (els.directorEntryStatus) {
    els.directorEntryStatus.textContent = status || "Incomplete";
    els.directorEntryStatus.classList.toggle("status--ready", status === "Ready");
    els.directorEntryStatus.classList.toggle("status--incomplete", status !== "Ready");
  }
  if (els.directorEntryStatusBadge) {
    els.directorEntryStatusBadge.textContent = status || "Incomplete";
  }
  renderDirectorWorkflowGuidance();
}

function setDirectorStepChip(el, { label, done = false, active = false } = {}) {
  if (!el) return;
  el.textContent = label || "";
  el.classList.toggle("is-done", Boolean(done));
  el.classList.toggle("is-active", Boolean(active));
}

function renderDirectorWorkflowGuidance() {
  if (!els.directorWorkflowCard) return;
  const hasSchool = Boolean(getDirectorSchoolId());
  const hasEvent = Boolean(state.director.selectedEventId);
  const hasEnsemble = Boolean(state.director.selectedEnsembleId);
  const completion = computeDirectorCompletionState(state.director.entryDraft);
  const view = state.director.view || "landing";
  const inFormsView = view === "dayOfForms";

  let currentStep = "Start";
  let nextTitle = "Attach a school to begin.";
  let nextHint = "Once attached, choose an event and open Event Forms.";

  if (hasSchool && !hasEvent) {
    currentStep = "Choose Event";
    nextTitle = "Select the event you are preparing for.";
    nextHint = "Use Event Forms to open registration or day-of forms for that event.";
  } else if (hasSchool && hasEvent && !hasEnsemble) {
    currentStep = "Choose Ensemble";
    nextTitle = "Select or create an ensemble.";
    nextHint = "Pick an active ensemble so forms and readiness can be tracked.";
  } else if (hasSchool && hasEvent && hasEnsemble && !inFormsView) {
    currentStep = "Open Forms";
    nextTitle = "Open Event Forms to continue.";
    nextHint = "Directors should work from Event Forms to complete and verify day-of details.";
  } else if (hasSchool && hasEvent && hasEnsemble && !completion.ready) {
    currentStep = "Complete Forms";
    nextTitle = "Finish required day-of sections for this ensemble.";
    nextHint = "Repertoire, instrumentation, seating, percussion, lunch, and grade must be complete.";
  } else if (hasSchool && hasEvent && hasEnsemble && completion.ready) {
    currentStep = "Ready";
    nextTitle = "This ensemble is ready for the event.";
    nextHint = "Review schedule times and update forms only when details change.";
  }

  if (els.directorCurrentStepPill) {
    els.directorCurrentStepPill.textContent = currentStep;
  }
  if (els.directorNextStepTitle) {
    els.directorNextStepTitle.textContent = nextTitle;
  }
  if (els.directorNextStepHint) {
    els.directorNextStepHint.textContent = nextHint;
  }

  setDirectorStepChip(els.directorStepChipSchool, {
    label: "School",
    done: hasSchool,
    active: !hasSchool,
  });
  setDirectorStepChip(els.directorStepChipEvent, {
    label: "Event",
    done: hasEvent,
    active: hasSchool && !hasEvent,
  });
  setDirectorStepChip(els.directorStepChipEnsemble, {
    label: "Ensemble",
    done: hasEnsemble,
    active: hasEvent && !hasEnsemble,
  });
  setDirectorStepChip(els.directorStepChipForms, {
    label: "Forms",
    done: inFormsView || completion.ready,
    active: hasSchool && hasEvent && hasEnsemble && !inFormsView,
  });
  setDirectorStepChip(els.directorStepChipReady, {
    label: "Ready",
    done: completion.ready,
    active: inFormsView && hasEnsemble && !completion.ready,
  });
}

export function setDirectorReadyControls({ status } = {}) {
  if (!els.directorEntryReadyBtn) return;
  if (els.directorEntryReadyBtn) {
    if (status === "ready") {
      els.directorEntryReadyBtn.textContent = "Mark as Incomplete";
      els.directorEntryReadyBtn.disabled = false;
    } else if (status === "disabled") {
      els.directorEntryReadyBtn.textContent = "Mark as Ready";
      els.directorEntryReadyBtn.disabled = true;
    } else {
      els.directorEntryReadyBtn.textContent = "Mark as Ready";
      els.directorEntryReadyBtn.disabled = false;
    }
  }
}

export function setDirectorPerformanceGradeValue(value) {
  if (!els.directorPerformanceGradeInput) return;
  const base = value || "";
  const flex = Boolean(state.director.entryDraft?.performanceGradeFlex);
  const display = base && flex ? `${base}-Flex` : base;
  els.directorPerformanceGradeInput.value = display;
  if (display) {
    els.directorPerformanceGradeInput.size = Math.max(display.length, 4);
  } else {
    els.directorPerformanceGradeInput.size = 4;
  }
}

export function clearDirectorEntryPanels() {
  if (els.directorEntryForm) els.directorEntryForm.reset?.();
  if (els.repertoireFields) els.repertoireFields.innerHTML = "";
  if (els.instrumentationStandard) els.instrumentationStandard.innerHTML = "";
  if (els.instrumentationNonStandard) els.instrumentationNonStandard.innerHTML = "";
  if (els.rule3cRows) els.rule3cRows.innerHTML = "";
  if (els.seatingRows) els.seatingRows.innerHTML = "";
  if (els.percussionOptions) els.percussionOptions.innerHTML = "";
}

export function showDirectorSectionStatus(section, message, type = "info") {
  const map = {
    repertoire: els.saveRepertoireStatus,
    instrumentation: els.saveInstrumentationStatus,
    nonStandard: els.saveNonStandardStatus,
    rule3c: els.saveRule3cStatus,
    seating: els.saveSeatingStatus,
    percussion: els.savePercussionStatus,
    lunch: els.saveLunchStatus,
  };
  showStatusMessage(map[section], message, type);
}

export function setDirectorProfileStatus(message) {
  if (!els.directorProfileCardStatus) return;
  els.directorProfileCardStatus.textContent = message || "";
}

export function showDirectorAutosaveIndicator() {
  if (!els.directorAutosaveIndicator) return;
  els.directorAutosaveIndicator.classList.add("is-visible");
  if (state.director.autosaveIndicatorTimeout) {
    window.clearTimeout(state.director.autosaveIndicatorTimeout);
  }
  state.director.autosaveIndicatorTimeout = window.setTimeout(() => {
    els.directorAutosaveIndicator.classList.remove("is-visible");
  }, 3000);
}

export function renderDirectorProfile() {
  if (!els.directorProfileForm) return;
  if (!state.auth.userProfile) return;
  if (els.directorProfileNameInput) {
    els.directorProfileNameInput.value = state.auth.userProfile.displayName || "";
  }
  if (els.directorProfileNafmeNumberInput) {
    els.directorProfileNafmeNumberInput.value =
      state.auth.userProfile.nafmeMembershipNumber || "";
  }
  if (els.directorProfileNafmeExpInput) {
    els.directorProfileNafmeExpInput.value =
      state.auth.userProfile.nafmeMembershipExp || "";
  }
  if (els.directorProfileCellPhoneInput) {
    els.directorProfileCellPhoneInput.value =
      state.auth.userProfile.cellPhone || "";
  }
  if (els.directorProfileCardPreview) {
    const url = state.auth.userProfile.nafmeCardImageUrl || "";
    if (url) {
      els.directorProfileCardPreview.src = url;
      els.directorProfileCardPreview.classList.remove("is-hidden");
    } else {
      els.directorProfileCardPreview.src = "";
      els.directorProfileCardPreview.classList.add("is-hidden");
    }
  }
}

export function renderSchoolOptions(selectEl, placeholder) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  const baseOption = document.createElement("option");
  baseOption.value = "";
  baseOption.textContent = placeholder || "Select a school";
  selectEl.appendChild(baseOption);

  state.admin.schoolsList.forEach((school) => {
    const option = document.createElement("option");
    option.value = school.id;
    const label = school.name || school.id;
    option.textContent = label;
    selectEl.appendChild(option);
  });
}

function setAdminSchoolFormMode(editSchoolId = null) {
  state.admin.schoolEditId = editSchoolId || null;
  const isEditing = Boolean(state.admin.schoolEditId);
  if (els.schoolIdCreateInput) {
    els.schoolIdCreateInput.disabled = isEditing;
  }
  if (els.schoolSubmitBtn) {
    els.schoolSubmitBtn.textContent = isEditing ? "Save School" : "Add School";
  }
  if (els.schoolEditCancelBtn) {
    els.schoolEditCancelBtn.classList.toggle("is-hidden", !isEditing);
  }
}

function resetAdminSchoolForm() {
  if (els.schoolForm) els.schoolForm.reset?.();
  setAdminSchoolFormMode(null);
}

function startAdminSchoolEdit(school) {
  if (!school) return;
  if (els.schoolIdCreateInput) els.schoolIdCreateInput.value = school.id || "";
  if (els.schoolNameCreateInput) els.schoolNameCreateInput.value = school.name || "";
  if (els.adminSchoolManageSelect && school.id) {
    els.adminSchoolManageSelect.value = school.id;
  }
  setAdminSchoolFormMode(school.id);
  els.schoolNameCreateInput?.focus();
}

function getSelectedAdminSchool() {
  const schoolId = els.adminSchoolManageSelect?.value || "";
  if (!schoolId) return null;
  return state.admin.schoolsList.find((school) => school.id === schoolId) || null;
}

export async function renderAdminSchoolEnsembleManage() {
  if (!els.adminSchoolEnsembleManageSelect) return;
  const schoolId = els.adminSchoolManageSelect?.value || "";
  const previousValue = els.adminSchoolEnsembleManageSelect.value || "";
  els.adminSchoolEnsembleManageSelect.innerHTML = "";
  if (!schoolId) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a school first";
    els.adminSchoolEnsembleManageSelect.appendChild(placeholder);
    els.adminSchoolEnsembleManageSelect.disabled = true;
    if (els.adminSchoolEnsembleDeleteBtn) {
      els.adminSchoolEnsembleDeleteBtn.disabled = true;
    }
    state.admin.schoolManageEnsembles = [];
    return;
  }
  const snap = await getDocs(
    query(collection(db, COLLECTIONS.schools, schoolId, COLLECTIONS.ensembles), orderBy("name"))
  );
  const ensembles = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  state.admin.schoolManageEnsembles = ensembles;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = ensembles.length ? "Select an ensemble" : "No ensembles in this school";
  els.adminSchoolEnsembleManageSelect.appendChild(placeholder);
  ensembles.forEach((ensemble) => {
    const option = document.createElement("option");
    option.value = ensemble.id;
    option.textContent = ensemble.name || ensemble.id;
    els.adminSchoolEnsembleManageSelect.appendChild(option);
  });
  const nextValue = ensembles.some((ensemble) => ensemble.id === previousValue) ? previousValue : "";
  els.adminSchoolEnsembleManageSelect.value = nextValue;
  els.adminSchoolEnsembleManageSelect.disabled = ensembles.length === 0;
  if (els.adminSchoolEnsembleDeleteBtn) {
    els.adminSchoolEnsembleDeleteBtn.disabled = !nextValue;
  }
}

function getSelectedDirectorForAdmin() {
  const uid = els.directorAssignDirectorSelect?.value || "";
  if (!uid) return null;
  return (state.admin.directorsList || []).find((director) => director.uid === uid) || null;
}

export function renderAdminSchoolsDirectory() {
  if (!els.adminSchoolManageSelect) return;
  const schools = state.admin.schoolsList || [];
  const previousValue = els.adminSchoolManageSelect.value || "";
  els.adminSchoolManageSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = schools.length ? "Select a school" : "No schools added yet";
  els.adminSchoolManageSelect.appendChild(placeholder);
  schools.forEach((school) => {
    const option = document.createElement("option");
    option.value = school.id;
    option.textContent = school.name || school.id;
    els.adminSchoolManageSelect.appendChild(option);
  });
  const nextValue = schools.some((school) => school.id === previousValue)
    ? previousValue
    : (state.admin.schoolEditId && schools.some((school) => school.id === state.admin.schoolEditId)
      ? state.admin.schoolEditId
      : "");
  els.adminSchoolManageSelect.value = nextValue;
  els.adminSchoolManageSelect.disabled = schools.length === 0;

  const hasSelection = Boolean(els.adminSchoolManageSelect.value);
  if (els.adminSchoolManageEditBtn) {
    els.adminSchoolManageEditBtn.disabled = !hasSelection;
  }
  if (els.adminSchoolManageDeleteBtn) {
    els.adminSchoolManageDeleteBtn.disabled = !hasSelection;
  }
  void renderAdminSchoolEnsembleManage();
}

export function renderDirectorAssignmentsDirectory() {
  const directors = state.admin.directorsList || [];
  if (els.directorAssignDirectorSelect) {
    const previousValue = els.directorAssignDirectorSelect.value || "";
    els.directorAssignDirectorSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = directors.length ? "Select a director" : "No directors found";
    els.directorAssignDirectorSelect.appendChild(placeholder);
    directors.forEach((director) => {
      const option = document.createElement("option");
      option.value = director.uid;
      const label = director.displayName || director.email || director.uid;
      option.textContent = director.schoolId
        ? `${label} (${getSchoolNameById(state.admin.schoolsList, director.schoolId) || director.schoolId})`
        : `${label} (Unassigned)`;
      els.directorAssignDirectorSelect.appendChild(option);
    });
    if (directors.some((director) => director.uid === previousValue)) {
      els.directorAssignDirectorSelect.value = previousValue;
    }
  }

  renderSchoolOptions(els.directorAssignSchoolSelect, "Select a school");

  if (els.directorManageList) {
    els.directorManageList.innerHTML = "";
    directors.forEach((director) => {
      const tr = document.createElement("tr");
      const label = director.displayName || "—";
      const email = director.email || "—";
      const schoolName = director.schoolId
        ? (getSchoolNameById(state.admin.schoolsList, director.schoolId) || director.schoolId)
        : "Unassigned";
      tr.innerHTML = `
        <td>${escapeHtml(label)}</td>
        <td>${escapeHtml(email)}</td>
        <td>${escapeHtml(schoolName)}</td>
      `;
      els.directorManageList.appendChild(tr);
    });
  }

  const selectedDirector = getSelectedDirectorForAdmin();
  if (els.directorUnassignBtn) {
    els.directorUnassignBtn.disabled = !selectedDirector || !selectedDirector.schoolId;
  }
  if (els.directorAssignBtn) {
    const selectedSchoolId = els.directorAssignSchoolSelect?.value || "";
    els.directorAssignBtn.disabled = !selectedDirector || !selectedSchoolId;
  }
}

export function renderAdminUsersDirectory() {
  if (!els.adminUsersList) return;
  const users = state.admin.usersList || [];
  const currentUid = state.auth.currentUser?.uid || "";
  els.adminUsersList.innerHTML = "";
  if (!users.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = "<td colspan='5'>No users found.</td>";
    els.adminUsersList.appendChild(tr);
    return;
  }

  users.forEach((user) => {
    const role = getEffectiveRole(user) || user.role || "unknown";
    const schoolName = user.schoolId
      ? (getSchoolNameById(state.admin.schoolsList, user.schoolId) || user.schoolId)
      : "—";
    const tr = document.createElement("tr");
    const label = user.displayName || "—";
    const email = user.email || "—";
    tr.innerHTML = `
      <td>${escapeHtml(label)}</td>
      <td>${escapeHtml(email)}</td>
      <td>${escapeHtml(role)}</td>
      <td>${escapeHtml(schoolName)}</td>
      <td></td>
    `;
    const actionCell = tr.querySelector("td:last-child");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost danger";
    button.textContent = "Delete User";
    button.setAttribute("data-delete-user-uid", user.uid || "");
    if (!user.uid || user.uid === currentUid) {
      button.disabled = true;
      button.title = "You cannot delete your own account.";
    }
    actionCell?.appendChild(button);
    els.adminUsersList.appendChild(tr);
  });
}

export function refreshSchoolDropdowns() {
  renderSchoolOptions(els.directorSchoolSelect, "Select a school");
  renderSchoolOptions(els.directorAttachSelect, "Select a school");
  renderSchoolOptions(els.provisionSchoolSelect, "Select a school (optional)");
  renderSchoolOptions(els.directorAssignSchoolSelect, "Select a school");
}

const modalReturnFocusMap = new WeakMap();
const MODAL_FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(MODAL_FOCUSABLE_SELECTOR)).filter((el) => {
    if (!(el instanceof HTMLElement)) return false;
    if (el.hidden) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    return true;
  });
}

function getTopOpenModal() {
  const openModals = Array.from(document.querySelectorAll(".modal.is-open"));
  return openModals.length ? openModals[openModals.length - 1] : null;
}

function applyBodyModalLock() {
  const shouldLock = state.app.modalOpenCount > 0;
  if (shouldLock) {
    if (!document.body.classList.contains("modal-open")) {
      state.app.modalScrollY = window.scrollY || window.pageYOffset || 0;
      document.body.style.top = `-${state.app.modalScrollY}px`;
      document.body.classList.add("modal-open");
    }
    if (!state.app.modalKeyHandler) {
      state.app.modalKeyHandler = (event) => {
        const topModal = getTopOpenModal();
        if (!topModal) return;
        const dismissible = topModal.dataset.dismissible !== "false";
        if (event.key === "Escape") {
          if (!dismissible) return;
          event.preventDefault();
          if (topModal === els.authModal) {
            closeAuthModal();
          } else if (topModal === els.directorProfileModal) {
            closeDirectorProfileModal();
          } else if (topModal === els.userProfileModal) {
            closeUserProfileModal();
          } else if (topModal === els.liveEventCheckinModal) {
            closeLiveEventCheckinModal();
          }
          return;
        }
        if (event.key !== "Tab") return;
        const panel = topModal.querySelector(".modal-panel") || topModal;
        const focusable = getFocusableElements(panel);
        if (!focusable.length) {
          event.preventDefault();
          if (panel instanceof HTMLElement) panel.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };
      document.addEventListener("keydown", state.app.modalKeyHandler);
    }
    return;
  }
  document.body.classList.remove("modal-open");
  document.body.style.top = "";
  if (state.app.modalScrollY > 0) {
    window.scrollTo(0, state.app.modalScrollY);
  }
  state.app.modalScrollY = 0;
  if (state.app.modalKeyHandler) {
    document.removeEventListener("keydown", state.app.modalKeyHandler);
    state.app.modalKeyHandler = null;
  }
}

function openManagedModal(modalEl, { dismissible = true, initialFocus = null } = {}) {
  if (!modalEl) return;
  const alreadyOpen = modalEl.classList.contains("is-open");
  if (!alreadyOpen) {
    state.app.modalOpenCount += 1;
    modalReturnFocusMap.set(modalEl, document.activeElement);
  }
  modalEl.classList.add("is-open");
  modalEl.setAttribute("aria-hidden", "false");
  modalEl.dataset.dismissible = dismissible ? "true" : "false";
  applyBodyModalLock();
  window.setTimeout(() => {
    const target = initialFocus || getFocusableElements(modalEl.querySelector(".modal-panel") || modalEl)[0];
    if (target && typeof target.focus === "function") target.focus();
  }, 0);
}

function closeManagedModal(modalEl, { restoreFocus = true } = {}) {
  if (!modalEl) return;
  const wasOpen = modalEl.classList.contains("is-open");
  modalEl.classList.remove("is-open");
  modalEl.setAttribute("aria-hidden", "true");
  if (wasOpen) {
    state.app.modalOpenCount = Math.max(0, Number(state.app.modalOpenCount || 0) - 1);
  }
  applyBodyModalLock();
  if (!restoreFocus) return;
  const prior = modalReturnFocusMap.get(modalEl);
  if (prior && typeof prior.focus === "function" && document.contains(prior)) {
    prior.focus();
  }
  modalReturnFocusMap.delete(modalEl);
}

export function openAuthModal() {
  if (!els.authModal) return;
  openManagedModal(els.authModal, {
    dismissible: true,
    initialFocus: els.emailInput || null,
  });
  if (state.auth.currentUser) {
    setAuthView("account");
    if (els.modalAuthActions && els.signOutBtn.parentElement !== els.modalAuthActions) {
      els.modalAuthActions.appendChild(els.signOutBtn);
    }
    if (els.headerAuthButtons && els.directorProfileToggleBtn && els.signOutBtn) {
      els.headerAuthButtons.insertBefore(els.directorProfileToggleBtn, els.signOutBtn);
    }
  } else {
    setAuthView("signIn");
  }
}

export function closeAuthModal() {
  if (!els.authModal) return;
  closeManagedModal(els.authModal, { restoreFocus: true });
  if (state.auth.currentUser && els.headerAuthButtons && els.signOutBtn.parentElement !== els.headerAuthButtons) {
    els.headerAuthButtons.appendChild(els.signOutBtn);
    if (els.directorProfileToggleBtn) {
      els.headerAuthButtons.insertBefore(els.directorProfileToggleBtn, els.signOutBtn);
    }
  }
}

export function showSessionExpiredModal() {
  if (!els.sessionExpiredModal) return;
  openManagedModal(els.sessionExpiredModal, {
    dismissible: false,
    initialFocus: els.sessionExpiredSignInBtn || null,
  });
}

export function hideSessionExpiredModal() {
  if (!els.sessionExpiredModal) return;
  closeManagedModal(els.sessionExpiredModal, { restoreFocus: false });
}

export function setMainInteractionDisabled(disabled) {
  const controls = document.querySelectorAll(
    ".main input, .main textarea, .main select, .main button"
  );
  controls.forEach((control) => {
    if (disabled) {
      if (control.dataset.prevDisabled == null) {
        control.dataset.prevDisabled = control.disabled ? "true" : "false";
      }
      control.disabled = true;
      return;
    }
    const prev = control.dataset.prevDisabled;
    if (prev === "false") {
      control.disabled = false;
    } else if (prev === "true") {
      control.disabled = true;
    }
    delete control.dataset.prevDisabled;
  });
}

function startOpenLevelMeter(stream) {
  if (!els.judgeOpenLevelMeterFill || !stream) return;
  if (state.judgeOpen.levelMeter) return;
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.fftSize);
    const meter = {
      audioContext,
      analyser,
      source,
      dataArray,
      rafId: null,
    };
    const tick = () => {
      analyser.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i += 1) {
        const value = (dataArray[i] - 128) / 128;
        sum += value * value;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      const level = Math.min(1, Math.max(0.05, rms * 2.4));
      els.judgeOpenLevelMeterFill.style.width = `${Math.round(level * 100)}%`;
      meter.rafId = window.requestAnimationFrame(tick);
    };
    state.judgeOpen.levelMeter = meter;
    if (els.judgeOpenLevelMeter) {
      els.judgeOpenLevelMeter.style.display = "block";
    }
    tick();
  } catch (error) {
    console.warn("Level meter unavailable", error);
  }
}

export function stopOpenLevelMeter() {
  const meter = state.judgeOpen.levelMeter;
  if (!meter) return;
  if (meter.rafId) {
    window.cancelAnimationFrame(meter.rafId);
  }
  if (meter.source) {
    try {
      meter.source.disconnect();
    } catch (error) {
      // no-op
    }
  }
  if (meter.audioContext) {
    meter.audioContext.close().catch(() => {});
  }
  state.judgeOpen.levelMeter = null;
  if (els.judgeOpenLevelMeterFill) {
    els.judgeOpenLevelMeterFill.style.width = "0%";
  }
  if (els.judgeOpenLevelMeter) {
    els.judgeOpenLevelMeter.style.display = "none";
  }
}

export function updateConnectivityUI() {
  state.app.isOffline = !navigator.onLine;
  if (els.offlineBanner) {
    els.offlineBanner.classList.toggle("is-hidden", !state.app.isOffline);
  }
  if (els.submitBtn) {
    if (state.app.isOffline) {
      els.submitBtn.disabled = true;
      els.submitBtn.dataset.offline = "true";
    } else {
      els.submitBtn.dataset.offline = "false";
      if (els.submitBtn.dataset.locked !== "true") {
        els.submitBtn.disabled = false;
      }
    }
  }
  updateOpenSubmitState();
}

export function setAuthView(view) {
  if (!els.authSignInView || !els.authDirectorView || !els.authAccountView) return;
  const isSignIn = view === "signIn";
  const isDirector = view === "director";
  const isAccount = view === "account";
  els.authSignInView.classList.toggle("is-hidden", !isSignIn);
  els.authDirectorView.classList.toggle("is-hidden", !isDirector);
  els.authAccountView.classList.toggle("is-hidden", !isAccount);
}

export function openDirectorProfileModal() {
  if (!els.directorProfileModal) return;
  if (state.auth.userProfile) {
    if (els.directorProfileNameInput) {
      els.directorProfileNameInput.value = state.auth.userProfile.displayName || "";
    }
    if (els.directorProfileNafmeNumberInput) {
      els.directorProfileNafmeNumberInput.value =
        state.auth.userProfile.nafmeMembershipNumber || "";
    }
    if (els.directorProfileNafmeExpInput) {
      const exp = state.auth.userProfile.nafmeMembershipExp;
      els.directorProfileNafmeExpInput.value =
        exp && exp.toDate ? exp.toDate().toISOString().slice(0, 10) : exp || "";
    }
    if (els.directorProfileCellPhoneInput) {
      els.directorProfileCellPhoneInput.value =
        state.auth.userProfile.cellPhone || "";
    }
    if (els.directorProfileCardPreview) {
      const url = state.auth.userProfile.nafmeCardImageUrl || "";
      if (url) {
        els.directorProfileCardPreview.src = url;
        els.directorProfileCardPreview.classList.remove("is-hidden");
      } else {
        els.directorProfileCardPreview.src = "";
        els.directorProfileCardPreview.classList.add("is-hidden");
      }
    }
  }
  if (els.directorProfileResetPasswordStatus) {
    els.directorProfileResetPasswordStatus.textContent = "";
  }
  openManagedModal(els.directorProfileModal, {
    dismissible: true,
    initialFocus: els.directorProfileNameInput || null,
  });
}

export function closeDirectorProfileModal() {
  if (!els.directorProfileModal) return;
  closeManagedModal(els.directorProfileModal, { restoreFocus: true });
}

export function openUserProfileModal() {
  if (!els.userProfileModal) return;
  if (els.userProfileNameInput) {
    els.userProfileNameInput.value =
      state.auth.userProfile?.displayName || state.auth.currentUser?.displayName || "";
  }
  if (els.userProfileStatus) {
    els.userProfileStatus.textContent = "";
  }
  if (els.userProfileResetPasswordStatus) {
    els.userProfileResetPasswordStatus.textContent = "";
  }
  openManagedModal(els.userProfileModal, {
    dismissible: true,
    initialFocus: els.userProfileNameInput || null,
  });
}

export function closeUserProfileModal() {
  if (!els.userProfileModal) return;
  closeManagedModal(els.userProfileModal, { restoreFocus: true });
}

export function updateAuthUI() {
  if (state.auth.currentUser) {
    const label = state.auth.currentUser.email ? state.auth.currentUser.email : "Signed in";
    els.signOutBtn.disabled = false;
    if (els.accountSummary) {
      els.accountSummary.textContent = `Signed in as ${label}`;
    }
    if (els.authIdentityBanner) {
      const displayName =
        state.auth.userProfile?.displayName ||
        state.auth.currentUser?.displayName ||
        "Signed in";
      const email = state.auth.userProfile?.email || state.auth.currentUser?.email || "";
      if (els.authIdentityName) {
        els.authIdentityName.textContent = displayName || "Signed in";
      }
      if (els.authIdentityEmail) {
        els.authIdentityEmail.textContent = email;
        els.authIdentityEmail.style.display = email ? "block" : "none";
      }
      els.authIdentityBanner.classList.remove("is-hidden");
    }
    updateEventModeBanner();
    if (els.headerAuthButtons) {
      if (els.signOutBtn.parentElement !== els.headerAuthButtons) {
        els.headerAuthButtons.appendChild(els.signOutBtn);
      }
      if (els.directorProfileToggleBtn) {
        els.headerAuthButtons.insertBefore(els.directorProfileToggleBtn, els.signOutBtn);
      }
    }
    if (els.signInBtn) {
      els.signInBtn.style.display = "none";
    }
  } else {
    els.signOutBtn.disabled = true;
    closeDirectorProfileModal();
    closeUserProfileModal();
    if (els.userProfileNameInput) {
      els.userProfileNameInput.value = "";
    }
    if (els.userProfileStatus) {
      els.userProfileStatus.textContent = "";
    }
    if (els.directorProfileNameInput) {
      els.directorProfileNameInput.value = "";
    }
    if (els.directorProfileNafmeNumberInput) {
      els.directorProfileNafmeNumberInput.value = "";
    }
    if (els.directorProfileNafmeExpInput) {
      els.directorProfileNafmeExpInput.value = "";
    }
    if (els.directorProfileCellPhoneInput) {
      els.directorProfileCellPhoneInput.value = "";
    }
    if (els.directorProfileCardInput) {
      els.directorProfileCardInput.value = "";
    }
    if (els.directorProfileCardStatus) {
      els.directorProfileCardStatus.textContent = "";
    }
    if (els.directorProfileCardPreview) {
      els.directorProfileCardPreview.src = "";
      els.directorProfileCardPreview.classList.add("is-hidden");
    }
    if (els.accountSummary) {
      els.accountSummary.textContent = "Signed out";
    }
    if (els.authIdentityBanner) {
      els.authIdentityBanner.classList.add("is-hidden");
    }
    updateEventModeBanner();
    if (els.modalAuthActions && els.signOutBtn.parentElement !== els.modalAuthActions) {
      els.modalAuthActions.appendChild(els.signOutBtn);
    }
    if (els.adminProfileToggleBtn) els.adminProfileToggleBtn.style.display = "none";
    if (els.judgeProfileToggleBtn) els.judgeProfileToggleBtn.style.display = "none";
    if (els.judgeOpenProfileToggleBtn) els.judgeOpenProfileToggleBtn.style.display = "none";
    if (els.directorProfileToggleBtn) els.directorProfileToggleBtn.style.display = "none";
    if (els.signInBtn) {
      els.signInBtn.style.display = "inline-flex";
    }
  }
}

export function bindAuthHandlers() {
  return getAuthHandlerBinder()();
}

export function updateDirectorAttachUI() {
  renderDirectorDashboardLayout();
  const isDirector = isDirectorManager();
  const hasSchool = Boolean(getDirectorSchoolId());
  const view = state.director.view; // "landing" | "registration" | "registered" | "dayOfForms"
  const isLandingView = view === "landing";
  const hasActivePath = Boolean(state.director.activePath);
  const isChildView = isDirector && (hasActivePath || !isLandingView);
  const showLandingChrome = isDirector && !isChildView;
  const activePath = state.director.activePath || (
    view === "registration" || view === "registered" ? "register" :
    view === "ensembles" ? "ensembles" :
    view === "results" ? "results" :
    view === "dayOfForms" ? "ensembles" :
    null
  );
  const showWorkspaceNav = isChildView;
  const showBackToAdminPreEvent =
    state.auth.userProfile?.role === "admin" &&
    Boolean(state.director.adminLaunchContext) &&
    view === "dayOfForms";
  const workspaceNavButtons = [
    {el: els.directorWorkspaceRegisterBtn, path: "register"},
    {el: els.directorWorkspaceEnsemblesBtn, path: "ensembles"},
    {el: els.directorWorkspaceInfoBtn, path: "info"},
    {el: els.directorWorkspaceResultsBtn, path: "results"},
  ];

  if (els.directorCard) {
    els.directorCard.classList.toggle("is-child-view", isChildView);
  }
  if (els.directorTabHeader) {
    els.directorTabHeader.style.display = showLandingChrome ? "flex" : "none";
  }
  if (els.directorSummary) {
    els.directorSummary.classList.toggle("is-landing", isLandingView);
    els.directorSummary.style.display = showLandingChrome ? "grid" : "none";
  }
  if (els.directorWorkspaceNav) {
    els.directorWorkspaceNav.classList.toggle("is-hidden", !showWorkspaceNav);
  }
  if (els.directorWorkspaceLandingBtn) {
    els.directorWorkspaceLandingBtn.disabled = !showWorkspaceNav;
  }
  workspaceNavButtons.forEach(({el, path}) => {
    if (!el) return;
    el.disabled = !(isDirector && hasSchool);
    el.classList.toggle("is-active", activePath === path);
  });

  if (els.directorAttachControls) {
    els.directorAttachControls.style.display =
      isDirector && !hasSchool ? "flex" : "none";
  }
  if (els.directorSchoolDirectors) {
    els.directorSchoolDirectors.style.display =
      isDirector && hasSchool && isLandingView ? "grid" : "none";
    if (!hasSchool) els.directorSchoolDirectors.innerHTML = "";
  }
  if (els.directorWorkflowCard) {
    els.directorWorkflowCard.style.display = "none";
  }
  if (els.directorEventSelectBlock) {
    els.directorEventSelectBlock.style.display =
      isDirector && hasSchool && view === "ensembles" ? "block" : "none";
  }
  if (els.directorLandingActions) {
    els.directorLandingActions.style.display =
      isDirector && hasSchool && isLandingView ? "grid" : "none";
  }
  if (els.directorNavRegisterBtn) {
    els.directorNavRegisterBtn.disabled = !(isDirector && hasSchool);
  }
  if (els.directorNavEnsemblesBtn) {
    els.directorNavEnsemblesBtn.disabled = !(isDirector && hasSchool);
  }
  if (els.directorNavInfoBtn) {
    els.directorNavInfoBtn.disabled = !(isDirector && hasSchool);
  }
  if (els.directorNavResultsBtn) {
    els.directorNavResultsBtn.disabled = !(isDirector && hasSchool);
  }
  if (els.directorEnsemblesSection) {
    const showEnsembles = isDirector && hasSchool && view === "ensembles";
    els.directorEnsemblesSection.style.display = showEnsembles ? "grid" : "none";
    if (showEnsembles) {
      renderDirectorEnsembles(state.director.ensemblesCache || []);
      updateDirectorActiveEnsembleLabel();
    } else {
      closeDirectorEnsembleForm();
    }
  }
  if (els.directorEventSelect) {
    els.directorEventSelect.disabled = !(isDirector && hasSchool);
  }
  if (els.directorRegistrationPanel) {
    els.directorRegistrationPanel.style.display =
      isDirector && hasSchool && view === "registration" ? "block" : "none";
  }
  if (els.directorPostRegistration) {
    els.directorPostRegistration.style.display =
      isDirector && hasSchool && view === "registered" ? "block" : "none";
  }
  if (els.directorDayOfFormsBlock) {
    els.directorDayOfFormsBlock.style.display =
      isDirector && hasSchool && view === "dayOfForms" ? "block" : "none";
  }
  if (els.directorBackToAdminPreEventBtn) {
    els.directorBackToAdminPreEventBtn.classList.toggle("is-hidden", !showBackToAdminPreEvent);
    els.directorBackToAdminPreEventBtn.disabled = !showBackToAdminPreEvent;
  }
  if (els.directorResultsSection) {
    els.directorResultsSection.style.display =
      isDirector && hasSchool && view === "results" ? "block" : "none";
  }
  if (els.directorEntryPanel) {
    els.directorEntryPanel.style.display =
      isDirector && hasSchool && view === "dayOfForms" ? "grid" : "none";
  }
  if (els.directorProfileToggleBtn) {
    els.directorProfileToggleBtn.style.display = isDirector ? "inline-flex" : "none";
  }
  if (els.directorEntryStatusBadge) {
    els.directorEntryStatusBadge.classList.toggle(
      "is-hidden",
      !(isDirector && hasSchool && view === "dayOfForms")
    );
  }
  if (isDirector && hasSchool && view === "registration") {
    renderDirectorRegistrationPanel();
  }
  if (isDirector && hasSchool && view === "registered") {
    renderDirectorPostRegistration();
  }
  renderDirectorContextPanel();
  renderDirectorEditorShell();
  renderDirectorWorkflowGuidance();
}

export function confirmDiscardUnsaved() {
  if (!hasUnsavedChanges()) return true;
  return confirmUser("You have unsaved changes. Leave anyway?");
}

function renderDirectorDashboardLayout() {
  const render = getDirectorDashboardRenderer();
  render?.();
}

function renderDirectorContextPanel() {
  const render = getDirectorContextPanelRenderer();
  render?.();
}

function renderDirectorEditorShell() {
  const render = getDirectorEditorShellRenderer();
  render?.();
}

let preEventGuidedFlowInFlight = false;
let preEventGuidedFlowQueued = false;
let adminPreflightRefreshTimer = null;
let adminPreflightRefreshInFlight = false;
let adminViewController = null;
let adminRenderers = null;
let adminLiveRenderers = null;
let authHandlerBinder = null;
let adminHandlerBinder = null;
let adminMockPacketPreviewRenderer = null;
let directorEntryFormRenderers = null;
let directorDashboardRenderer = null;
let directorContextPanelRenderer = null;
let directorEditorShellRenderer = null;
let judgeOpenRenderers = null;
let judgeOpenHandlerBinder = null;
let judgeOpenCore = null;
let judgeOpenDirectorReference = null;
let judgeOpenSession = null;
let directorEnsembleRenderer = null;
let directorHandlerBinder = null;
let directorPacketRenderers = null;
let directorDayOfRenderer = null;
let directorRegistrationRenderers = null;
let directorEventRenderers = null;
let appHandlerBinder = null;

function schedulePreEventGuidedFlowRender() {
  if (preEventGuidedFlowInFlight) {
    preEventGuidedFlowQueued = true;
    return;
  }
  preEventGuidedFlowInFlight = true;
  queueMicrotask(async () => {
    try {
      await renderPreEventGuidedFlow();
    } finally {
      preEventGuidedFlowInFlight = false;
      if (preEventGuidedFlowQueued) {
        preEventGuidedFlowQueued = false;
        schedulePreEventGuidedFlowRender();
      }
    }
  });
}

async function runAdminPreflightRefresh() {
  if (adminPreflightRefreshInFlight) return;
  if (state.admin.readinessInFlight) {
    scheduleAdminPreflightRefresh();
    return;
  }
  const role = getEffectiveRole(state.auth.userProfile);
  if (role !== "admin" && role !== "teamLead") return;
  const eventId = state.event.active?.id || "";
  if (!eventId) return;
  adminPreflightRefreshInFlight = true;
  state.admin.readinessInFlight = true;
  if (els.adminRunPreflightBtn) {
    els.adminRunPreflightBtn.disabled = true;
  }
  try {
    await runEventPreflight({ eventId });
    if (state.app.currentTab === "admin" && state.admin.currentView === "readiness") {
      await renderAdminReadinessView();
    }
  } catch (error) {
    console.warn("Auto preflight refresh skipped", error);
  } finally {
    state.admin.readinessInFlight = false;
    adminPreflightRefreshInFlight = false;
    if (els.adminRunPreflightBtn && state.event.active?.id) {
      els.adminRunPreflightBtn.disabled = false;
    }
    if (state.app.currentTab === "admin" && state.admin.currentView === "readiness") {
      await renderAdminReadinessView();
    }
  }
}

function scheduleAdminPreflightRefresh({ immediate = false } = {}) {
  if (adminPreflightRefreshTimer) {
    clearTimeout(adminPreflightRefreshTimer);
    adminPreflightRefreshTimer = null;
  }
  const delay = immediate ? 0 : 900;
  adminPreflightRefreshTimer = setTimeout(() => {
    adminPreflightRefreshTimer = null;
    void runAdminPreflightRefresh();
  }, delay);
}

function getAdminViewController() {
  if (adminViewController) return adminViewController;
  adminViewController = createAdminViewController({
    els,
    state,
    isAdminLiveEventEnabled,
    isAdminSettingsEnabled,
    getEffectiveRole,
    renderLiveEventCheckinQueue,
    renderAdminSchoolDetail,
    renderRegisteredEnsemblesList,
    renderAdminPacketsBySchedule,
    renderAdminReadinessView,
    renderEventList,
    renderAdminSchoolsDirectory,
    renderDirectorAssignmentsDirectory,
    renderAdminUsersDirectory,
  });
  return adminViewController;
}

function getAuthHandlerBinder() {
  if (authHandlerBinder) return authHandlerBinder;
  authHandlerBinder = createAuthHandlerBinder({
    els,
    DEV_FLAGS,
    state,
    openAuthModal,
    setAuthView,
    closeAuthModal,
    setRoleHint,
    setAuthFormDisabled,
    setSavingState,
    signIn,
    requestPasswordReset,
    createDirectorAccount,
    setAuthSuccess,
    signOut,
  });
  return authHandlerBinder;
}

function getAdminHandlerBinder() {
  if (adminHandlerBinder) return adminHandlerBinder;
  adminHandlerBinder = createAdminHandlerBinder({
    els,
    state,
    windowObj: window,
    isAdminLiveEventEnabled,
    isAdminSettingsEnabled,
    applyAdminView,
    closeAdminSchoolDetail,
    renderAdminPacketsBySchedule,
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
    saveSchool,
    resetAdminSchoolForm,
    getSelectedAdminSchool,
    startAdminSchoolEdit,
    deleteSchool,
    deleteEnsemble,
    bulkImportSchools,
    provisionUser,
    deleteUserAccount,
    renderAdminUsersDirectory,
    renderDirectorAssignmentsDirectory,
    getSelectedDirectorForAdmin,
    assignDirectorSchool,
    getSchoolNameById,
    unassignDirectorSchool,
    renderAdminSchoolEnsembleManage,
    withLoading,
  });
  return adminHandlerBinder;
}

function getAdminRenderers() {
  if (adminRenderers) return adminRenderers;
  adminRenderers = createAdminRenderers({
    els,
    state,
    db,
    COLLECTIONS,
    collection,
    getDocs,
    query,
    where,
    fetchRegisteredEnsembles,
    resolveCurrentRegisteredEnsembles,
    fetchScheduleEntries,
    getSchoolNameById,
    normalizeEnsembleDisplayName,
    toDateOrNull,
    toLocalDatetimeValue,
    deriveAutoScheduleDayBreaks,
    mergeScheduleDayBreaks,
    formatPerformanceAt,
    getPacketData,
    releasePacket,
    unreleasePacket,
    deleteScheduledPacket,
    lockOpenPacket,
    unlockOpenPacket,
    releaseOpenPacket,
    unreleaseOpenPacket,
    deleteOpenPacket,
    attachManualAudioToScheduledPacket,
    attachManualAudioToOpenPacket,
    createAudioOnlyResultFromFile,
    releaseAudioOnlyResult,
    unreleaseAudioOnlyResult,
    repairManualAudioOverrides,
    deleteAllUnreleasedPackets,
    cleanupTestArtifacts,
    renderSubmissionCard,
    loadAdminPacketView,
    confirmUser,
    alertUser,
    createScheduleEntry,
    deleteScheduleEntry,
    updateScheduleEntryTime,
    computeScheduleTimeline,
    formatAdminDayOfReadOnly,
    openDirectorDayOfFromAdmin,
    closeAdminSchoolDetail,
    applyAdminView,
    schedulePreEventGuidedFlowRender,
    scheduleAdminPreflightRefresh,
    refreshPreEventScheduleTimelineStarts,
  });
  return adminRenderers;
}

function getAdminMockPacketPreviewRenderer() {
  if (adminMockPacketPreviewRenderer) return adminMockPacketPreviewRenderer;
  adminMockPacketPreviewRenderer = createAdminMockPacketPreviewRenderer({
    els,
    JUDGE_POSITIONS,
    JUDGE_POSITION_LABELS,
    FORM_TYPES,
    CAPTION_TEMPLATES,
    STATUSES,
    calculateCaptionTotal,
    computeFinalRating,
    levelToRoman,
    renderSubmissionCard,
  });
  return adminMockPacketPreviewRenderer;
}

function getAdminLiveRenderers() {
  if (adminLiveRenderers) return adminLiveRenderers;
  adminLiveRenderers = createAdminLiveRenderers({
    els,
    state,
    db,
    COLLECTIONS,
    FIELDS,
    collection,
    getDocs,
    query,
    where,
    fetchScheduleEntries,
    fetchRegisteredEnsembles,
    getSchoolNameById,
    normalizeEnsembleDisplayName,
    toDateOrNull,
    computeEnsembleCheckinStatus,
    escapeHtml,
    formatStartTime,
    formatSchoolEnsembleLabel,
    buildAdminLogisticsEntryPanel,
    buildAdminLogisticsDiffPanel,
    updateEntryCheckinFields,
    openModal: openManagedModal,
    closeModal: closeManagedModal,
  });
  return adminLiveRenderers;
}

function getJudgeOpenRenderers() {
  if (judgeOpenRenderers) return judgeOpenRenderers;
  judgeOpenRenderers = createJudgeOpenRenderers({
    els,
    state,
    confirmUser,
    withLoading,
    deleteOpenPacket,
    resetJudgeOpenState,
    setJudgeOpenDirectorReferenceState,
    renderJudgeOpenDirectorReference,
    renderOpenSegments,
    renderOpenCaptionForm,
    updateOpenHeader,
    hideOpenDetailView,
    updateOpenEmptyState,
    updateOpenSubmitState,
    saveOpenPrefs,
    saveOpenPrefsToServer,
    openJudgeOpenPacket,
    setOpenPacketHint,
  });
  return judgeOpenRenderers;
}

function getJudgeOpenHandlerBinder() {
  if (judgeOpenHandlerBinder) return judgeOpenHandlerBinder;
  judgeOpenHandlerBinder = createJudgeOpenHandlerBinder({
    els,
    state,
    hideOpenDetailView,
    openJudgeOpenPacket,
    hasLinkedOpenEnsemble,
    setOpenPacketHint,
    withLoading,
    gatherOpenPacketMeta,
    createOpenPacket,
    renderOpenSegments,
    saveOpenPrefsToServer,
    renderOpenCaptionForm,
    updateOpenHeader,
    showOpenDetailView,
    updateOpenEmptyState,
    updateOpenSubmitState,
    saveOpenPrefs,
    markJudgeOpenDirty,
    buildOpenEnsembleSnapshot,
    updateOpenPacketDraft,
    refreshJudgeOpenDirectorReference,
    syncOpenFormTypeSegmented,
    draftCaptionsFromTranscript,
    applyOpenCaptionDraft,
    transcribeOpenTape,
    finalizeOpenTapeAutoTranscription,
    startOpenRecording,
    updateOpenRecordingStatus,
    stopOpenRecording,
    applyOpenCaptionState,
    submitOpenPacket,
    selectOpenPacket,
    chooseJudgeOpenMode,
    backToJudgeOpenLanding,
  });
  return judgeOpenHandlerBinder;
}

function getJudgeOpenCore() {
  if (judgeOpenCore) return judgeOpenCore;
  judgeOpenCore = createJudgeOpenCore({
    els,
    state,
    withLoading,
    getOpenCaptionTemplate,
    calculateCaptionTotal,
    computeFinalRating,
    formatPerformanceAt,
    retryOpenSessionUploads,
    transcribeOpenSegment,
    setOpenPacketHint,
    updateTapePlayback,
    isOpenPacketEditable,
    hasLinkedOpenEnsemble,
    startOpenLevelMeter,
    stopOpenLevelMeter,
  });
  setJudgeOpenAutoTranscriptionHooks({
    onTranscriptUpdated: (transcript) => {
      state.judgeOpen.transcriptText = transcript || "";
      if (els.judgeOpenTranscriptInput) {
        els.judgeOpenTranscriptInput.value = transcript || "";
      }
      updateOpenSubmitState();
    },
    onStatus: () => {
      updateOpenRecordingStatus();
    },
  });
  return judgeOpenCore;
}

function getJudgeOpenDirectorReference() {
  if (judgeOpenDirectorReference) return judgeOpenDirectorReference;
  judgeOpenDirectorReference = createJudgeOpenDirectorReference({
    els,
    state,
    STANDARD_INSTRUMENTS,
    loadDirectorEntrySnapshotForJudge,
    updateOpenPacketDraft,
  });
  return judgeOpenDirectorReference;
}

function getJudgeOpenSession() {
  if (judgeOpenSession) return judgeOpenSession;
  judgeOpenSession = createJudgeOpenSession({
    els,
    state,
    selectOpenPacket,
    renderOpenSegments,
    setJudgeOpenDirectorReferenceState,
    renderJudgeOpenDirectorReference,
    refreshJudgeOpenDirectorReference,
    renderOpenCaptionForm,
    updateOpenHeader,
    updateOpenEmptyState,
    updateOpenSubmitState,
    showOpenDetailView,
    saveOpenPrefsToServer,
    loadOpenPrefs,
    canUseOpenJudge,
    syncOpenEventDefaultsUI,
    refreshOpenEventDefaultsState,
    applyOpenEventAssignmentDefaults,
    setOpenPacketHint,
  });
  return judgeOpenSession;
}

function getAppHandlerBinder() {
  if (appHandlerBinder) return appHandlerBinder;
  appHandlerBinder = createAppHandlerBinder({
    els,
    state,
    hideSessionExpiredModal,
    openAuthModal,
    showSessionExpiredModal,
    openUserProfileModal,
    closeUserProfileModal,
    closeLiveEventCheckinModal,
    saveUserDisplayName,
    updateAuthUI,
    requestPasswordReset,
  });
  return appHandlerBinder;
}

function getDirectorEnsembleRenderer() {
  if (directorEnsembleRenderer) return directorEnsembleRenderer;
  directorEnsembleRenderer = createDirectorEnsembleRenderer({
    els,
    state,
    withLoading,
    handleDirectorEnsembleDelete,
    setDirectorEnsembleFormMode,
    handleDirectorEnsembleSelection,
    handleDirectorEnsembleOpenForms,
  });
  return directorEnsembleRenderer;
}

function getDirectorDashboardRenderer() {
  if (directorDashboardRenderer) return directorDashboardRenderer;
  directorDashboardRenderer = createDirectorDashboardRenderer({ els, state });
  return directorDashboardRenderer;
}

function getDirectorContextPanelRenderer() {
  if (directorContextPanelRenderer) return directorContextPanelRenderer;
  directorContextPanelRenderer = createDirectorContextPanelRenderer({ els, state });
  return directorContextPanelRenderer;
}

function getDirectorEditorShellRenderer() {
  if (directorEditorShellRenderer) return directorEditorShellRenderer;
  directorEditorShellRenderer = createDirectorEditorShellRenderer({ els, state });
  return directorEditorShellRenderer;
}

function getDirectorHandlerBinder() {
  if (directorHandlerBinder) return directorHandlerBinder;
  directorHandlerBinder = createDirectorHandlerBinder({
    els,
    state,
    alertUser,
    setDirectorEvent,
    checkDirectorHasRegistrationForEvent,
    updateDirectorAttachUI,
    renderDirectorRegistrationPanel,
    openDirectorProfileModal,
    getDirectorSchoolId,
    upsertRegistrationForEnsemble,
    renderDayOfEnsembleSelector,
    loadDirectorEntry,
    applyDirectorEntryUpdate,
    applyDirectorEntryClear,
    generateSignatureFormPdf,
    uploadSignedSignatureForm,
    setDirectorEnsembleFormMode,
    closeDirectorEnsembleForm,
    attachDirectorSchool,
    returnToAdminPreEventFromDirector,
    setDirectorSchoolName,
    refreshDirectorWatchers,
    confirmUser,
    renderDirectorEnsembles,
    discardDirectorDraftChanges,
    setDirectorEntryStatusLabel,
    setDirectorReadyControls,
    renderDirectorChecklist,
    computeDirectorCompletionState,
    hasDirectorUnsavedChanges,
    updateDirectorEventMeta,
    renameDirectorEnsemble,
    createDirectorEnsemble,
    updateDirectorActiveEnsembleLabel,
    withLoading,
    renderInstrumentationNonStandard,
    applyDirectorDirty,
    markEntryDraft,
    markEntryReady,
    saveRepertoireSection,
    applyDirectorSaveResult,
    saveInstrumentationSection,
    saveRule3cSection,
    saveSeatingSection,
    savePercussionSection,
    saveLunchSection,
    uploadEventSchedulePdf,
    renderEventScheduleDetail,
    setDirectorProfileStatus,
    saveDirectorProfile,
    closeDirectorProfileModal,
    uploadDirectorProfileCard,
    renderDirectorProfile,
  });
  return directorHandlerBinder;
}

function getDirectorPacketRenderers() {
  if (directorPacketRenderers) return directorPacketRenderers;
  directorPacketRenderers = createDirectorPacketRenderers({
    els,
    state,
    JUDGE_POSITIONS,
    JUDGE_POSITION_LABELS,
    STATUSES,
    FORM_TYPES,
    CAPTION_TEMPLATES,
    renderSubmissionCard,
    fetchDirectorPacketAssets,
    fetchDirectorAudioResultAsset,
    withLoading,
  });
  return directorPacketRenderers;
}

function getDirectorDayOfRenderer() {
  if (directorDayOfRenderer) return directorDayOfRenderer;
  directorDayOfRenderer = createDirectorDayOfRenderer({
    state,
    loadDirectorEntry,
    applyDirectorEntryUpdate,
    applyDirectorEntryClear,
  });
  return directorDayOfRenderer;
}

function getDirectorRegistrationRenderers() {
  if (directorRegistrationRenderers) return directorRegistrationRenderers;
  directorRegistrationRenderers = createDirectorRegistrationRenderers({
    els,
    state,
    db,
    COLLECTIONS,
    doc,
    getDoc,
    getDirectorSchoolId,
    getEventCardLabel,
    alertUser,
    createDirectorEnsemble,
    refreshDirectorWatchers,
    upsertRegistrationForEnsemble,
  });
  return directorRegistrationRenderers;
}

function getDirectorEventRenderers() {
  if (directorEventRenderers) return directorEventRenderers;
  directorEventRenderers = createDirectorEventRenderers({
    els,
    state,
    hasDirectorUnsavedChanges,
    getEventCardLabel,
    formatDateHeading,
    loadDirectorEntry,
    applyDirectorEntryUpdate,
    applyDirectorEntryClear,
  });
  return directorEventRenderers;
}

function getDirectorEntryFormRenderers() {
  if (directorEntryFormRenderers) return directorEntryFormRenderers;
  directorEntryFormRenderers = createDirectorEntryFormRenderers({
    els,
    state,
    REPERTOIRE_FIELDS,
    STANDARD_INSTRUMENTS,
    PERCUSSION_OPTIONS,
    romanToLevel,
    derivePerformanceGrade,
    normalizeGrade,
    getMpaRepertoireForGrade,
    applyDirectorDirty,
    setDirectorPerformanceGradeValue,
    setPerformanceGradeError,
    updateLunchTotalCost,
  });
  return directorEntryFormRenderers;
}

function isAdminHeavyViewLoaded(view) {
  return getAdminViewController().isAdminHeavyViewLoaded(view);
}

function isAdminSchoolDetailOpen() {
  return getAdminViewController().isAdminSchoolDetailOpen();
}

function closeAdminSchoolDetail() {
  return getAdminViewController().closeAdminSchoolDetail();
}

function applyAdminView(view) {
  return getAdminViewController().applyAdminView(view);
}

function updateTabUI(tabName, role) {
  if (tabName === "judge-open" && state.app.features?.enableJudgeOpen === false) {
    setTab("admin", { force: true });
    const adminHash = getAdminHashForView("preEvent");
    if (window.location.hash !== adminHash) window.location.hash = adminHash;
    return;
  }
  if (!role) {
    if (els.adminCard) {
      els.adminCard.hidden = true;
    }
    if (els.directorCard) {
      els.directorCard.hidden = true;
    }
    return;
  }
  els.tabButtons.forEach((button) => {
    const allowed = isTabAllowed(button.dataset.tab, role);
    const isSelected = button.dataset.tab === tabName;
    const isJudgeTab = button.dataset.tab === "judge-open";
    const hiddenByFeature = isJudgeTab && state.app.features?.enableJudgeOpen === false;
    button.setAttribute("aria-selected", isSelected ? "true" : "false");
    button.disabled = !allowed || hiddenByFeature;
    button.hidden = hiddenByFeature || (role === "admin" ? false : !allowed);
    button.tabIndex = isSelected ? 0 : -1;
  });
  updateRoleTabBar(role);
  const showAdmin = tabName === "admin";
  const showJudgeOpen = tabName === "judge-open";
  const showDirector = tabName === "director";
  if (els.adminCard) els.adminCard.style.display = "";
  if (els.judgeOpenCard) els.judgeOpenCard.style.display = "";
  if (els.directorCard) els.directorCard.style.display = "";
  document.body.classList.toggle("admin-active", showAdmin);
  document.body.classList.toggle("judge-open-active", showJudgeOpen);
  document.body.classList.toggle("director-active", showDirector);
  if (els.adminCard) {
    els.adminCard.hidden = !showAdmin;
  }
  if (showAdmin) {
    applyAdminView(state.admin.currentView);
  }
  if (els.judgeOpenCard) {
    els.judgeOpenCard.hidden = !showJudgeOpen;
  }
  if (els.directorCard) {
    els.directorCard.hidden = !showDirector;
  }
  if (showDirector) {
    refreshDirectorWatchers();
  } else {
    stopDirectorWatchers();
  }
  if (showJudgeOpen) {
    resetJudgeOpenModeSelection();
    refreshOpenEventDefaultsState();
    renderOpenExistingOptions([]);
    renderOpenPacketOptions([]);
    updateOpenEmptyState();
    updateOpenSubmitState();
    if (!els.judgeOpenCaptionForm?.children?.length) {
      renderOpenCaptionForm();
    }
    setOpenPacketHint("Choose Practice or Official to begin.");
  }
  if (els.eventDetailPage && !els.eventDetailPage.classList.contains("is-hidden")) {
    hideEventDetail();
  }
}

export function setTab(tabName, { force } = {}) {
  if (
    state.judgeOpen.packetMutationInFlight &&
    state.app.currentTab &&
    tabName !== state.app.currentTab
  ) {
    setOpenPacketHint("Please wait for adjudication create/delete to finish before navigating.");
    return { changed: false, reason: "judge-open-busy" };
  }
  if (state.app.currentTab === "director" && tabName !== "director") {
    if (!confirmDiscardUnsaved()) return { changed: false, reason: "unsaved" };
    state.director.adminLaunchContext = null;
  }
  const result = setTabState(tabName, { force });
  if (!result.changed) return result;
  updateTabUI(result.tabName, result.role);
  return result;
}

const EVENT_DETAIL_VIEW_MODE = {
  admin: "admin",
  directorSchedule: "directorSchedule",
};

let eventDetailRenderVersion = 0;

function getEventDetailViewMode(rawMode) {
  return rawMode === EVENT_DETAIL_VIEW_MODE.directorSchedule
    ? EVENT_DETAIL_VIEW_MODE.directorSchedule
    : EVENT_DETAIL_VIEW_MODE.admin;
}

function resetEventScheduleDetailPanels() {
  if (els.eventScheduleStatus) {
    els.eventScheduleStatus.textContent = "";
  }
  if (els.eventScheduleDirectorWrap) {
    els.eventScheduleDirectorWrap.classList.add("is-hidden");
  }
  if (els.eventScheduleDirectorHint) {
    els.eventScheduleDirectorHint.textContent = "";
  }
  if (els.eventScheduleDirectorTableWrap) {
    els.eventScheduleDirectorTableWrap.innerHTML = "";
  }
  if (els.eventScheduleLinkRow) {
    els.eventScheduleLinkRow.style.display = "none";
  }
  if (els.eventScheduleFrame) {
    els.eventScheduleFrame.removeAttribute("src");
    els.eventScheduleFrame.style.display = "none";
  }
  if (els.eventScheduleEmpty) {
    els.eventScheduleEmpty.style.display = "none";
  }
}

function renderEventScheduleAdminDetail(event) {
  const isAdmin = getEffectiveRole(state.auth.userProfile) === "admin";
  const pdfUrl = event?.schedulePdfUrl || "";
  const pdfName = event?.schedulePdfName || "Schedule PDF";

  if (els.eventScheduleDirectorWrap) {
    els.eventScheduleDirectorWrap.classList.add("is-hidden");
  }
  if (els.eventScheduleAdminControls) {
    els.eventScheduleAdminControls.style.display = isAdmin ? "flex" : "none";
  }
  if (els.eventScheduleLinkRow) {
    els.eventScheduleLinkRow.style.display = pdfUrl ? "flex" : "none";
  }
  if (els.eventScheduleLink) {
    els.eventScheduleLink.href = pdfUrl || "#";
    els.eventScheduleLink.textContent = pdfUrl ? `Open ${pdfName}` : "Open Schedule PDF";
  }
  if (els.eventScheduleFrame) {
    if (pdfUrl) {
      els.eventScheduleFrame.src = pdfUrl;
      els.eventScheduleFrame.style.display = "block";
    } else {
      els.eventScheduleFrame.removeAttribute("src");
      els.eventScheduleFrame.style.display = "none";
    }
  }
  if (els.eventScheduleEmpty) {
    els.eventScheduleEmpty.style.display = pdfUrl ? "none" : "block";
  }
}

async function renderEventScheduleDirectorDetail(event, eventId, renderVersion) {
  if (els.eventScheduleAdminControls) {
    els.eventScheduleAdminControls.style.display = "none";
  }
  if (els.eventScheduleDirectorWrap) {
    els.eventScheduleDirectorWrap.classList.remove("is-hidden");
  }
  if (els.eventScheduleStatus) {
    els.eventScheduleStatus.textContent = "Loading schedule times...";
  }
  const schoolId = getDirectorSchoolId();
  if (!schoolId) {
    if (els.eventScheduleStatus) {
      els.eventScheduleStatus.textContent = "Attach or select a school to view schedule times.";
    }
    return;
  }

  const [scheduleEntries, registeredEntries] = await Promise.all([
    fetchScheduleEntries(eventId),
    fetchRegisteredEnsembles(eventId),
  ]);
  if (renderVersion !== eventDetailRenderVersion) return;

  const schoolName = getSchoolNameById(state.admin.schoolsList, schoolId) || schoolId;
  const regByEnsembleId = new Map(
    (registeredEntries || []).map((entry) => [entry.ensembleId || entry.id, entry])
  );
  const sortedSchedule = [...(scheduleEntries || [])].sort((a, b) => {
    const aTime = toDateOrNull(a.performanceAt)?.getTime() || 0;
    const bTime = toDateOrNull(b.performanceAt)?.getTime() || 0;
    return aTime - bTime;
  });
  const autoDayBreaks = deriveAutoScheduleDayBreaks(sortedSchedule);
  const dayBreaks = mergeScheduleDayBreaks(event?.scheduleDayBreaks || {}, autoDayBreaks);
  const firstPerf = sortedSchedule[0]?.performanceAt;
  if (!firstPerf) {
    if (els.eventScheduleStatus) {
      els.eventScheduleStatus.textContent = "No scheduled ensembles for this event.";
    }
    if (els.eventScheduleDirectorTableWrap) {
      els.eventScheduleDirectorTableWrap.innerHTML = "";
    }
    return;
  }
  const getGrade = (row) => {
    const reg = regByEnsembleId.get(row.ensembleId || row.id) || {};
    return reg.declaredGradeLevel || reg.performanceGrade || null;
  };
  const timeline = computeScheduleTimeline(
    firstPerf,
    sortedSchedule,
    Array.isArray(event?.scheduleBreaks) ? event.scheduleBreaks : [],
    getGrade,
    dayBreaks
  );
  const timelineByEntryId = new Map(timeline.map((row) => [row.entryId, row]));
  const rows = sortedSchedule
    .filter((row) => row.schoolId === schoolId)
    .map((row) => {
      const slot = timelineByEntryId.get(row.id);
      if (!slot) return null;
      const ensembleId = row.ensembleId || row.id || "";
      const reg = regByEnsembleId.get(ensembleId) || {};
      const ensembleName =
        normalizeEnsembleDisplayName({
          schoolName,
          ensembleName: row.ensembleName || reg.ensembleName || "",
          ensembleId,
        }) || ensembleId || "Ensemble";
      return {
        ensembleName,
        grade: slot.grade || "—",
        holdingStart: slot.holdingStart,
        warmUpStart: slot.warmUpStart,
        performStart: slot.performStart,
        sightStart: slot.sightStart,
      };
    })
    .filter(Boolean);

  if (els.eventScheduleDirectorHint) {
    els.eventScheduleDirectorHint.textContent = `${schoolName} start times from the active event schedule.`;
  }

  if (!rows.length) {
    if (els.eventScheduleStatus) {
      els.eventScheduleStatus.textContent = "No scheduled ensembles for your school in this event.";
    }
    if (els.eventScheduleDirectorTableWrap) {
      els.eventScheduleDirectorTableWrap.innerHTML = "";
    }
    return;
  }

  const table = document.createElement("table");
  table.className = "schedule-timeline-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Ensemble</th>
        <th>Grade</th>
        <th>Holding</th>
        <th>Warm-up</th>
        <th>Performance</th>
        <th>Sightreading</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(row.ensembleName)}</td>
      <td>${escapeHtml(row.grade)}</td>
      <td>${escapeHtml(formatStartTime(row.holdingStart))}</td>
      <td>${escapeHtml(formatStartTime(row.warmUpStart))}</td>
      <td>${escapeHtml(formatStartTime(row.performStart))}</td>
      <td>${escapeHtml(formatStartTime(row.sightStart))}</td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  if (els.eventScheduleDirectorTableWrap) {
    els.eventScheduleDirectorTableWrap.innerHTML = "";
    els.eventScheduleDirectorTableWrap.appendChild(table);
  }
  if (els.eventScheduleStatus) {
    els.eventScheduleStatus.textContent = `Loaded ${rows.length} scheduled ensemble${rows.length === 1 ? "" : "s"}.`;
  }
}

async function renderEventScheduleDetail(event, eventId, viewMode = EVENT_DETAIL_VIEW_MODE.admin) {
  resetEventScheduleDetailPanels();
  const nextMode = getEventDetailViewMode(viewMode);
  if (nextMode === EVENT_DETAIL_VIEW_MODE.directorSchedule) {
    try {
      await renderEventScheduleDirectorDetail(event, eventId, eventDetailRenderVersion);
    } catch (error) {
      console.error("Failed to render director schedule view", error);
      if (els.eventScheduleStatus) {
        const code = String(error?.code || "").toLowerCase();
        if (code.includes("permission-denied")) {
          els.eventScheduleStatus.textContent =
            "Schedule access is denied. Confirm this director account is attached to the same school.";
        } else {
          const message = error?.message || error?.code || "Unable to load schedule times.";
          els.eventScheduleStatus.textContent = String(message);
        }
      }
    }
    return;
  }
  renderEventScheduleAdminDetail(event);
}

async function uploadEventSchedulePdf(eventId, file) {
  if (!eventId) throw new Error("Missing eventId.");
  if (!file) throw new Error("Select a PDF file.");
  if (file.type && file.type !== "application/pdf") {
    throw new Error("Schedule must be a PDF.");
  }
  const ext = file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "pdf";
  const objectPath = `event_schedules/${eventId}/schedule.${ext}`;
  const storageRef = ref(storage, objectPath);
  await uploadBytes(storageRef, file, { contentType: file.type || "application/pdf" });
  const url = await getDownloadURL(storageRef);
  const eventRef = doc(db, "events", eventId);
  await updateDoc(eventRef, {
    schedulePdfUrl: url,
    schedulePdfPath: objectPath,
    schedulePdfName: file.name || "schedule.pdf",
    updatedAt: serverTimestamp(),
  });
  const localEvent = state.event.list.find((item) => item.id === eventId);
  if (localEvent) {
    localEvent.schedulePdfUrl = url;
    localEvent.schedulePdfPath = objectPath;
    localEvent.schedulePdfName = file.name || "schedule.pdf";
  }
  if (state.event.active?.id === eventId) {
    state.event.active = {
      ...state.event.active,
      schedulePdfUrl: url,
      schedulePdfPath: objectPath,
      schedulePdfName: file.name || "schedule.pdf",
    };
  }
  return { url, objectPath };
}

export function showEventDetail(eventId, viewMode = EVENT_DETAIL_VIEW_MODE.admin) {
  if (!els.eventDetailPage) return;
  const event = state.event.list.find((item) => item.id === eventId);
  const nextMode = getEventDetailViewMode(viewMode);
  eventDetailRenderVersion += 1;
  els.eventDetailPage.dataset.eventId = eventId || "";
  els.eventDetailPage.dataset.viewMode = nextMode;
  els.eventDetailPage.classList.toggle(
    "director-event-detail",
    nextMode === EVENT_DETAIL_VIEW_MODE.directorSchedule
  );
  if (els.eventDetailDirectorNav) {
    els.eventDetailDirectorNav.classList.toggle(
      "is-hidden",
      nextMode !== EVENT_DETAIL_VIEW_MODE.directorSchedule
    );
  }
  if (els.eventDetailBackBtn) {
    els.eventDetailBackBtn.classList.toggle(
      "is-hidden",
      nextMode === EVENT_DETAIL_VIEW_MODE.directorSchedule
    );
  }
  if (els.eventDetailDirectorLandingBtn) {
    els.eventDetailDirectorLandingBtn.disabled = false;
  }
  [
    {el: els.eventDetailDirectorRegisterBtn, path: "register"},
    {el: els.eventDetailDirectorEnsemblesBtn, path: "ensembles"},
    {el: els.eventDetailDirectorInfoBtn, path: "info"},
    {el: els.eventDetailDirectorResultsBtn, path: "results"},
  ].forEach(({el, path}) => {
    if (!el) return;
    el.disabled = false;
    el.classList.toggle(
      "is-active",
      nextMode === EVENT_DETAIL_VIEW_MODE.directorSchedule && path === "info"
    );
  });
  void renderEventScheduleDetail(event, eventId, nextMode);
  els.eventDetailPage.classList.remove("is-hidden");
  if (els.adminCard) els.adminCard.style.display = "none";
  if (els.directorCard) els.directorCard.style.display = "none";
}

export function hideEventDetail() {
  if (!els.eventDetailPage) return;
  els.eventDetailPage.classList.add("is-hidden");
  els.eventDetailPage.classList.remove("director-event-detail");
  if (els.adminCard) els.adminCard.style.display = "";
  if (els.judgeOpenCard) els.judgeOpenCard.style.display = "";
  if (els.directorCard) els.directorCard.style.display = "";
  if (state.app.currentTab) {
    updateTabUI(state.app.currentTab, getEffectiveRole(state.auth.userProfile));
  }
}

export function handleHashChange() {
  const action = resolveHash(window.location.hash || "");
  if (action.type === "event") {
    if (state.app.currentTab === "director" && hasUnsavedChanges()) {
      if (!confirmDiscardUnsaved()) {
        if (window.location.hash !== "#director") {
          window.location.hash = "#director";
        }
        return;
      }
    }
    showEventDetail(action.eventId, action.viewMode);
    return;
  }
  if (action.type === "tab") {
    if (!state.auth.currentUser && action.tab === "judge-open") {
      window.location.hash = "";
      hideEventDetail();
      return;
    }
    const role = getEffectiveRole(state.auth.userProfile);
    if (role && !isTabAllowed(action.tab, role)) {
      const fallback = getDefaultTabForRole(role);
      if (fallback) {
        setTab(fallback, { force: true });
        if (window.location.hash !== `#${fallback}`) {
          window.location.hash = `#${fallback}`;
        }
        hideEventDetail();
        return;
      }
    }
    if (action.tab === "director" && !state.auth.currentUser) {
      openAuthModal();
      setAuthView("director");
      return;
    }
    if (action.tab === "admin" && action.adminView) {
      const nextAdminView = resolveAdminView(action.adminView, {
        liveEnabled: isAdminLiveEventEnabled(),
        settingsEnabled: isAdminSettingsEnabled(),
        fallback: "preEvent",
      });
      const activeView = resolveAdminView(state.admin.currentView, {
        liveEnabled: isAdminLiveEventEnabled(),
        settingsEnabled: isAdminSettingsEnabled(),
        fallback: "preEvent",
      });
      if (state.admin.readinessInFlight && nextAdminView !== activeView) {
        const activeHash = getAdminHashForView(activeView);
        if (window.location.hash !== activeHash) {
          window.location.hash = activeHash;
        }
        return;
      }
      state.admin.currentView = nextAdminView;
    }
    setTab(action.tab, { force: true });
  }
  hideEventDetail();
}

export function updateRoleUI() {
  updateRoleTabBar(null);
  if (!state.auth.currentUser) {
    document.body.classList.add("auth-locked");
    document.body.classList.remove("director-only");
    setMainInteractionDisabled(true);
    if (els.adminCard) els.adminCard.style.display = "none";
    if (els.judgeOpenCard) els.judgeOpenCard.style.display = "none";
    if (els.directorCard) els.directorCard.style.display = "none";
    els.tabButtons.forEach((button) => {
      button.setAttribute("aria-selected", "false");
      button.disabled = true;
      button.hidden = false;
    });
    setRoleHint("Sign in with your provisioned account.");
    setProvisioningNotice("");
    setDirectorSchoolName("No school attached");
    if (els.tabLockHint) {
      els.tabLockHint.textContent = "Sign in to access role dashboards.";
    }
    return;
  }
  if (els.tabLockHint) {
    els.tabLockHint.textContent = "";
  }

  if (state.auth.profileLoading) {
    document.body.classList.add("auth-locked");
    document.body.classList.remove("director-only");
    setMainInteractionDisabled(true);
    if (els.adminCard) els.adminCard.style.display = "none";
    if (els.judgeOpenCard) els.judgeOpenCard.style.display = "none";
    if (els.directorCard) els.directorCard.style.display = "none";
    setRoleHint("Signing in...");
    setProvisioningNotice("");
    if (els.tabLockHint) {
      els.tabLockHint.textContent = "Loading account access...";
    }
    return;
  }

  if (!state.auth.userProfile) {
    document.body.classList.add("auth-locked");
    document.body.classList.remove("director-only");
    setMainInteractionDisabled(true);
    if (els.adminCard) els.adminCard.style.display = "none";
    if (els.judgeOpenCard) els.judgeOpenCard.style.display = "none";
    if (els.directorCard) els.directorCard.style.display = "none";
    els.tabButtons.forEach((button) => {
      button.setAttribute("aria-selected", "false");
      button.disabled = true;
      button.hidden = false;
    });
    setRoleHint("Account not provisioned. Contact the chair/admin to be added.");
    setProvisioningNotice(
      "Account not provisioned. Contact the chair/admin to be added before you can access the consoles."
    );
    setDirectorSchoolName("No school attached");
    return;
  }

  document.body.classList.remove("auth-locked");
  if (els.adminCard) els.adminCard.style.display = "";
  if (els.judgeOpenCard) els.judgeOpenCard.style.display = "";
  if (els.directorCard) els.directorCard.style.display = "";
  const effectiveRole = getEffectiveRole(state.auth.userProfile);
  setMainInteractionDisabled(false);
  updateRoleTabBar(effectiveRole);
  if (effectiveRole === "director") {
    document.body.classList.add("director-only");
  } else {
    document.body.classList.remove("director-only");
  }
  setRoleHint(`Role: ${effectiveRole || "unknown"}`);
  setProvisioningNotice("");
  els.tabButtons.forEach((button) => {
    const allowed = isTabAllowed(button.dataset.tab, effectiveRole);
    const isJudgeTab = button.dataset.tab === "judge-open";
    const hiddenByFeature = isJudgeTab && state.app.features?.enableJudgeOpen === false;
    button.style.display = allowed && !hiddenByFeature ? "inline-flex" : "none";
  });
  const defaultTab = getDefaultTabForRole(effectiveRole);
  setTab(defaultTab, { force: true });
  if (isTabAllowed("director", effectiveRole)) {
    const name =
      state.auth.userProfile.displayName ||
      state.auth.currentUser?.displayName ||
      state.auth.userProfile.email ||
      state.auth.currentUser?.email ||
      "Director";
    const email = state.auth.userProfile.email || state.auth.currentUser?.email || "";
    setDirectorSummaryName(name);
    if (els.directorSummaryEmail) {
      els.directorSummaryEmail.textContent = email;
    }
  }
  updateDirectorAttachUI();
}

export function stopWatchers() {
  if (state.judgeOpen.openPacketsRafId != null) {
    window.cancelAnimationFrame(state.judgeOpen.openPacketsRafId);
    state.judgeOpen.openPacketsRafId = null;
  }
  state.judgeOpen.openPacketsPendingRender = null;
  state.judgeOpen.openPacketsLastSig = "";
  if (state.subscriptions.events) state.subscriptions.events();
  if (state.subscriptions.activeEvent) state.subscriptions.activeEvent();
  if (state.subscriptions.roster) state.subscriptions.roster();
  if (state.subscriptions.readyEntries) state.subscriptions.readyEntries();
  if (state.subscriptions.assignments) state.subscriptions.assignments();
  if (state.subscriptions.judgeSubmission) state.subscriptions.judgeSubmission();
  if (state.subscriptions.directorPackets) state.subscriptions.directorPackets();
  if (state.subscriptions.directorOpenPackets) state.subscriptions.directorOpenPackets();
  if (state.subscriptions.directorSchool) state.subscriptions.directorSchool();
  if (state.subscriptions.directorSchoolDirectors) state.subscriptions.directorSchoolDirectors();
  if (state.subscriptions.directorEnsembles) state.subscriptions.directorEnsembles();
  if (state.subscriptions.directorEntry) state.subscriptions.directorEntry();
  if (state.subscriptions.judges) state.subscriptions.judges();
  if (state.subscriptions.directors) state.subscriptions.directors();
  if (state.subscriptions.users) state.subscriptions.users();
  if (state.subscriptions.scheduleEnsembles) state.subscriptions.scheduleEnsembles();
  if (state.subscriptions.openPackets) state.subscriptions.openPackets();
  if (state.subscriptions.openSessions) state.subscriptions.openSessions();
  if (state.subscriptions.schools) state.subscriptions.schools();
  state.subscriptions.events = null;
  state.subscriptions.activeEvent = null;
  state.subscriptions.roster = null;
  state.subscriptions.readyEntries = null;
  state.subscriptions.assignments = null;
  state.subscriptions.judgeSubmission = null;
  state.subscriptions.directorPackets = null;
  state.subscriptions.directorOpenPackets = null;
  state.subscriptions.directorSchool = null;
  state.subscriptions.directorSchoolDirectors = null;
  state.subscriptions.directorEnsembles = null;
  state.subscriptions.directorEntry = null;
  state.subscriptions.judges = null;
  state.subscriptions.directors = null;
  state.subscriptions.users = null;
  state.subscriptions.scheduleEnsembles = null;
  state.subscriptions.openPackets = null;
  state.subscriptions.openSessions = null;
  state.subscriptions.schools = null;
  state.admin.lastRosterEventId = "";
}

function maybeRefreshJudgeOpenExistingEnsembles({ force = false } = {}) {
  if (!canUseOpenJudge(state.auth.userProfile)) return;
  const mode = state.judgeOpen.mode;
  if (!mode) return;
  const key = JSON.stringify(
    (state.admin.schoolsList || [])
      .map((school) => [school.id || "", school.name || ""])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  );
  const changed = key !== state.judgeOpen.existingEnsembleIndexKey;
  if (!changed && !force) {
    if (state.app.currentTab === "judge-open") {
      renderOpenExistingOptions(state.judgeOpen.existingEnsembles || []);
    }
    return;
  }
  state.judgeOpen.existingEnsembleIndexKey = key;
  const loadVersion = (state.judgeOpen.existingEnsembleIndexLoadVersion || 0) + 1;
  state.judgeOpen.existingEnsembleIndexLoadVersion = loadVersion;
  state.judgeOpen.existingEnsembleIndexDirty = false;
  fetchOpenEnsembleIndex(state.admin.schoolsList)
    .then(async (items) => {
      if (state.judgeOpen.mode === "official") {
        return fetchOfficialOpenEnsembleIndex(state.event.active?.id || "");
      }
      return items;
    })
    .then((items) => {
      if (state.judgeOpen.existingEnsembleIndexLoadVersion !== loadVersion) return;
      state.judgeOpen.existingEnsembles = items;
      if (state.app.currentTab === "judge-open") {
        renderOpenExistingOptions(items);
      }
    })
    .catch((error) => {
      console.error("fetchOpenEnsembleIndex failed", error);
    });
}

function buildOpenPacketRenderSig(packets = []) {
  return packets
    .map((packet) => {
      const updatedAt = packet.updatedAt?.toMillis ? packet.updatedAt.toMillis() : "";
      return [
        packet.id || "",
        packet.mode || "practice",
        packet.status || "",
        updatedAt,
        Number(packet.segmentCount || 0),
        Number(packet.audioSessionCount || 0),
      ].join(":");
    })
    .join("|");
}

function scheduleOpenPacketOptionsRender() {
  const rawPackets = Array.isArray(state.judgeOpen.openPacketsPendingRender)
    ? state.judgeOpen.openPacketsPendingRender
    : [];
  const mode = state.judgeOpen.mode || "";
  const packets = !mode ? [] : rawPackets.filter((packet) => (packet.mode || "practice") === mode);
  const nextSig = buildOpenPacketRenderSig(packets);
  if (nextSig === state.judgeOpen.openPacketsLastSig) return;
  if (state.judgeOpen.openPacketsRafId != null) return;
  state.judgeOpen.openPacketsRafId = window.requestAnimationFrame(() => {
    state.judgeOpen.openPacketsRafId = null;
    const pendingRaw = Array.isArray(state.judgeOpen.openPacketsPendingRender)
      ? state.judgeOpen.openPacketsPendingRender
      : [];
    const mode = state.judgeOpen.mode || "";
    const pending = !mode ? [] : pendingRaw.filter((packet) => (packet.mode || "practice") === mode);
    state.judgeOpen.openPacketsPendingRender = null;
    const renderSig = buildOpenPacketRenderSig(pending);
    if (renderSig === state.judgeOpen.openPacketsLastSig) return;
    state.judgeOpen.openPacketsLastSig = renderSig;
    if (state.app.currentTab === "judge-open") {
      renderOpenPacketOptions(pending);
    }
  });
}

export function startWatchers() {
  stopWatchers();
  const liveEnabled = isAdminLiveEventEnabled();
  const settingsEnabled = isAdminSettingsEnabled();
  const judgeEnabled = state.app.features?.enableJudgeOpen !== false;
  const onRosterUpdate = (entries) => {
    if (state.app.currentTab !== "admin") return;
    const shouldRenderScheduleData =
      state.admin.currentView === "preEvent" &&
      isAdminHeavyViewLoaded("preEvent") &&
      !isAdminSchoolDetailOpen();
    if (shouldRenderScheduleData) {
      renderAdminScheduleList(entries);
    }
    if (state.admin.currentView === "preEvent" && isAdminHeavyViewLoaded("preEvent")) {
      if (isAdminSchoolDetailOpen()) {
        renderAdminSchoolDetail();
      } else {
        renderRegisteredEnsemblesList();
      }
    }
    if (liveEnabled && state.admin.currentView === "liveEvent" && isAdminHeavyViewLoaded("liveEvent")) {
      renderLiveEventCheckinQueue();
    }
    if (state.admin.currentView === "packets") {
      renderAdminPacketsBySchedule();
    }
  };
  const syncRosterWatcherForActiveEvent = () => {
    const nextEventId = state.event.active?.id || "";
    if (state.admin.lastRosterEventId === nextEventId) return;
    state.admin.lastRosterEventId = nextEventId;
    watchRoster(onRosterUpdate);
  };
  watchEvents(() => {
    if (settingsEnabled && state.app.currentTab === "admin" && state.admin.currentView === "settings") {
      renderEventList();
    }
    if (state.app.currentTab === "admin" && state.admin.currentView === "preEvent" && !isAdminSchoolDetailOpen()) {
      if (isAdminHeavyViewLoaded("preEvent")) renderRegisteredEnsemblesList();
    }
    if (state.app.currentTab === "admin" && state.admin.currentView === "packets") {
      renderAdminPacketsBySchedule();
    }
    if (state.app.currentTab === "admin" && state.admin.currentView === "readiness") {
      renderAdminReadinessView();
    }
    renderDirectorEventOptions();
    if (els.eventDetailPage && !els.eventDetailPage.classList.contains("is-hidden")) {
      const detailEventId = els.eventDetailPage.dataset.eventId || "";
      const detailViewMode = getEventDetailViewMode(els.eventDetailPage.dataset.viewMode || "");
      if (detailEventId) {
        showEventDetail(detailEventId, detailViewMode);
      }
    }
  });
  watchActiveEvent(() => {
    state.admin.assignmentsDirty = false;
    state.admin.assignmentsDraft = {
      stage1Uid: "",
      stage2Uid: "",
      stage3Uid: "",
      sightUid: "",
    };
    state.admin.readinessBulkResetSupport = "unknown";
    state.admin.readinessBulkResetCheckedAt = 0;
    if (state.admin.safeMode) {
      state.admin.preEventHeavyLoaded = false;
      state.admin.liveEventHeavyLoaded = false;
    }
    invalidateDirectorSchoolLunchTotalCache({
      eventId: state.director.selectedEventId || state.event.active?.id || null,
      schoolId: getDirectorSchoolId() || null,
    });
    renderActiveEventDisplay();
    updateEventModeBanner();
    updateAdminEmptyState();
    renderDirectorEventOptions();
    renderAdminReadiness();
    if (judgeEnabled) {
      refreshOpenEventDefaultsState();
      refreshJudgeOpenDirectorReference({ persistToPacket: true });
    }
    startActiveAssignmentsWatcher();
    if (liveEnabled && state.app.currentTab === "admin" && state.admin.currentView === "liveEvent" && isAdminHeavyViewLoaded("liveEvent")) {
      renderLiveEventCheckinQueue();
    }
    if (state.app.currentTab === "admin" && state.admin.currentView === "preEvent" && isAdminHeavyViewLoaded("preEvent")) {
      if (isAdminSchoolDetailOpen()) {
        renderAdminSchoolDetail();
      } else {
        renderRegisteredEnsemblesList();
      }
    }
    if (state.app.currentTab === "admin" && state.admin.currentView === "packets") {
      renderAdminPacketsBySchedule();
    }
    if (state.app.currentTab === "admin" && state.admin.currentView === "readiness") {
      renderAdminReadinessView();
    }
    if (state.app.currentTab === "director") renderDirectorRegistrationPanel();
    syncRosterWatcherForActiveEvent();
  });
  startActiveAssignmentsWatcher();
  syncRosterWatcherForActiveEvent();
  watchSchools(() => {
    if (settingsEnabled && state.app.currentTab === "admin" && state.admin.currentView === "settings") {
      renderAdminSchoolsDirectory();
      renderDirectorAssignmentsDirectory();
      renderAdminUsersDirectory();
      if (
        state.admin.schoolEditId &&
        !state.admin.schoolsList.some((school) => school.id === state.admin.schoolEditId)
      ) {
        resetAdminSchoolForm();
      }
    }
    refreshSchoolDropdowns();
    if (liveEnabled && state.app.currentTab === "admin" && state.admin.currentView === "liveEvent") {
      renderLiveEventCheckinQueue();
    }
    if (state.app.currentTab === "admin" && state.admin.currentView === "packets") {
      renderAdminPacketsBySchedule();
    }
    if (judgeEnabled && canUseOpenJudge(state.auth.userProfile)) {
      if (state.app.currentTab === "judge-open") {
        maybeRefreshJudgeOpenExistingEnsembles();
      } else {
        state.judgeOpen.existingEnsembleIndexDirty = true;
      }
    }
  });
  if (settingsEnabled) {
    watchDirectors((directors) => {
      state.admin.directorsList = directors;
      if (state.app.currentTab === "admin" && state.admin.currentView === "settings") {
        renderDirectorAssignmentsDirectory();
      }
    });
    watchUsers((users) => {
      state.admin.usersList = users;
      if (state.app.currentTab === "admin" && state.admin.currentView === "settings") {
        renderAdminUsersDirectory();
      }
    });
  }

  if (state.app.currentTab === "director" || state.director.view === "dayOfForms") {
    refreshDirectorWatchers();
  }
  if (judgeEnabled) {
    refreshOpenEventDefaultsState();
    if (state.app.currentTab === "judge-open") {
      maybeRefreshJudgeOpenExistingEnsembles({ force: true });
    } else {
      state.judgeOpen.existingEnsembleIndexDirty = true;
    }
  }
  if (judgeEnabled && canUseOpenJudge(state.auth.userProfile)) {
    state.subscriptions.openPackets = watchOpenPackets((packets) => {
      state.judgeOpen.packets = packets || [];
      state.judgeOpen.openPacketsPendingRender = state.judgeOpen.packets;
      scheduleOpenPacketOptionsRender();
    });
  }
  if (judgeEnabled && getEffectiveRole(state.auth.userProfile) === "admin") {
    watchJudges((judges) => {
      state.admin.judgesList = Array.isArray(judges) ? judges : [];
      if (!state.admin.assignmentsDirty) {
        renderJudgeOptions(state.admin.judgesList);
      }
    });
  }
}

function refreshDirectorWatchers() {
  if (!isDirectorManager()) return;
  watchDirectorPackets(({ groups, hint } = {}) => {
    renderDirectorPackets(groups || []);
    setDirectorHint(hint || "");
  });
  watchDirectorSchool((name) => {
    setDirectorSchoolName(name);
    refreshDirectorSchoolLunchTotal();
  });
  watchDirectorSchoolDirectors((directors) => {
    renderDirectorSchoolDirectors(directors || []);
  });
  watchDirectorEnsembles((ensembles) => {
    renderDirectorEnsembles(ensembles || []);
    updateDirectorActiveEnsembleLabel();
    refreshDirectorSchoolLunchTotal();
    renderDirectorRegistrationPanel();
    loadDirectorEntry({
      onUpdate: applyDirectorEntryUpdate,
      onClear: applyDirectorEntryClear,
    });
  });
}

function stopDirectorWatchers() {
  if (state.subscriptions.directorPackets) state.subscriptions.directorPackets();
  if (state.subscriptions.directorOpenPackets) state.subscriptions.directorOpenPackets();
  if (state.subscriptions.directorSchool) state.subscriptions.directorSchool();
  if (state.subscriptions.directorSchoolDirectors) state.subscriptions.directorSchoolDirectors();
  if (state.subscriptions.directorEnsembles) state.subscriptions.directorEnsembles();
  if (state.subscriptions.directorEntry) state.subscriptions.directorEntry();
  state.subscriptions.directorPackets = null;
  state.subscriptions.directorOpenPackets = null;
  state.subscriptions.directorSchool = null;
  state.subscriptions.directorSchoolDirectors = null;
  state.subscriptions.directorEnsembles = null;
  state.subscriptions.directorEntry = null;
}

export function initTabs() {
  if (state.app.tabsBound) return;
  state.app.tabsBound = true;
  els.tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setTab(button.dataset.tab);
    });
    button.addEventListener("keydown", (event) => {
      const key = event.key;
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;
      event.preventDefault();
      const buttons = els.tabButtons;
      if (!buttons.length) return;
      const currentIndex = buttons.indexOf(button);
      let nextIndex = currentIndex;
      if (key === "ArrowLeft") nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      if (key === "ArrowRight") nextIndex = (currentIndex + 1) % buttons.length;
      if (key === "Home") nextIndex = 0;
      if (key === "End") nextIndex = buttons.length - 1;
      const target = buttons[nextIndex];
      if (target) {
        target.focus();
        setTab(target.dataset.tab);
      }
    });
  });
  if (els.roleSwitcherSelect) {
    els.roleSwitcherSelect.addEventListener("change", () => {
      const targetTab = els.roleSwitcherSelect.value;
      if (!targetTab) return;
      setTab(targetTab);
    });
  }
  setTab(state.app.features?.enableJudgeOpen === false ? "admin" : "judge-open");
}

export function updateAdminEmptyState() {
  if (els.adminEmpty) {
    els.adminEmpty.style.display = state.event.active ? "none" : "block";
  }
  if (els.adminStatusBadge) {
    els.adminStatusBadge.textContent = state.event.active
      ? "Active event"
      : "No active event";
  }
  renderAdminReadiness();
}

function getEventModeLabel(eventMode) {
  return String(eventMode || "").trim().toLowerCase() === "rehearsal" ?
    "REHEARSAL EVENT" :
    "LIVE EVENT";
}

function updateEventModeBanner() {
  if (!els.eventModeBanner || !els.eventModeBannerLabel || !els.eventModeBannerDetail) return;
  const isSignedIn = Boolean(state.auth.currentUser);
  const event = state.event.active || null;
  if (!isSignedIn) {
    els.eventModeBanner.classList.add("is-hidden");
    return;
  }
  if (!event) {
    els.eventModeBanner.classList.remove("is-hidden");
    els.eventModeBannerLabel.textContent = "NO ACTIVE EVENT";
    els.eventModeBannerDetail.textContent = "Practice and setup actions are available.";
    return;
  }
  const modeLabel = getEventModeLabel(event.eventMode);
  els.eventModeBanner.classList.remove("is-hidden");
  els.eventModeBannerLabel.textContent = modeLabel;
  els.eventModeBannerDetail.textContent = `${event.name || "Active Event"}`;
}

function formatReadinessTimestamp(value) {
  if (!value) return "";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

export function renderEventList() {
  if (!els.eventList) return;
  els.eventList.innerHTML = "";
  if (!state.event.list.length) {
    const li = document.createElement("li");
    li.className = "note";
    li.textContent = "No events yet.";
    els.eventList.appendChild(li);
    return;
  }
  state.event.list.forEach((event) => {
    const li = document.createElement("li");
    const isEditing = state.admin.eventEditId === event.id;
    const title = document.createElement("div");
    if (isEditing) {
      const input = document.createElement("input");
      input.type = "text";
      input.value = state.admin.eventEditName || event.name || "";
      input.placeholder = "Event name";
      input.addEventListener("input", () => {
        state.admin.eventEditName = input.value;
      });
      title.appendChild(input);
    } else {
      title.textContent = getEventCardLabel(event);
    }
    const actions = document.createElement("div");
    actions.className = "actions";

    const activeBadge = document.createElement("span");
    activeBadge.className = "badge";
    const modeLabel = String(event.eventMode || "").trim().toLowerCase() === "rehearsal" ?
      "Rehearsal" :
      "Live";
    activeBadge.textContent = `${event.isActive ? "Active" : "Inactive"} · ${modeLabel}`;

    const activateBtn = document.createElement("button");
    activateBtn.className = "ghost";
    activateBtn.textContent = event.isActive ? "Active" : "Set Active";
    activateBtn.disabled = Boolean(event.isActive);
    activateBtn.style.display = event.isActive ? "none" : "inline-flex";
    activateBtn.addEventListener("click", async () => {
      await setActiveEvent(event.id);
      scheduleAdminPreflightRefresh({ immediate: true });
    });

    const deactivateBtn = document.createElement("button");
    deactivateBtn.className = "ghost";
    deactivateBtn.textContent = "Deactivate";
    deactivateBtn.style.display = event.isActive ? "inline-flex" : "none";
    deactivateBtn.addEventListener("click", async () => {
      await setActiveEvent("");
      scheduleAdminPreflightRefresh({ immediate: true });
    });

    const detailBtn = document.createElement("button");
    detailBtn.className = "ghost";
    detailBtn.textContent = "View Details";
    detailBtn.addEventListener("click", () => {
      window.location.hash = `#event/${event.id}/admin`;
    });

    const editBtn = document.createElement("button");
    editBtn.className = "ghost";
    editBtn.textContent = isEditing ? "Save" : "Edit";
    editBtn.addEventListener("click", async () => {
      if (!isEditing) {
        state.admin.eventEditId = event.id;
        state.admin.eventEditName = event.name || "";
        renderEventList();
        return;
      }
      const trimmed = String(state.admin.eventEditName || "").trim();
      if (!trimmed) {
        alertUser("Event name cannot be empty.");
        return;
      }
      if (trimmed !== (event.name || "")) {
        await renameEvent({ eventId: event.id, name: trimmed });
        const localEvent = state.event.list.find((item) => item.id === event.id);
        if (localEvent) {
          localEvent.name = trimmed;
        }
        if (state.event.active?.id === event.id) {
          state.event.active = {
            ...state.event.active,
            name: trimmed,
          };
          renderActiveEventDisplay();
          refreshOpenEventDefaultsState();
        }
      }
      state.admin.eventEditId = null;
      state.admin.eventEditName = "";
      renderEventList();
    });

    if (isEditing) {
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "ghost";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => {
        state.admin.eventEditId = null;
        state.admin.eventEditName = "";
        renderEventList();
      });
      actions.appendChild(cancelBtn);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "ghost";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async () => {
      if (!confirmUser("Delete this event? This cannot be undone.")) return;
      await deleteEvent(event.id);
    });

    actions.appendChild(activeBadge);
    actions.appendChild(activateBtn);
    actions.appendChild(deactivateBtn);
    actions.appendChild(editBtn);
    actions.appendChild(detailBtn);
    actions.appendChild(deleteBtn);

    li.appendChild(title);
    li.appendChild(actions);
    els.eventList.appendChild(li);
  });
}

export function renderActiveEventDisplay() {
  if (!els.activeEventDisplay) return;
  if (!state.event.active) {
    els.activeEventDisplay.textContent = "No active event.";
    return;
  }
  els.activeEventDisplay.textContent = getEventLabel(state.event.active);
}

export async function renderAdminReadinessView() {
  if (!els.adminReadinessChecklist || !els.adminReadinessPreflightSummary) return;
  els.adminReadinessChecklist.innerHTML = "";
  if (els.adminReadinessHistoryList) els.adminReadinessHistoryList.innerHTML = "";
  const event = state.event.active || null;
  const hasActiveEvent = Boolean(event?.id);
  const isRehearsalEvent = String(event?.eventMode || "").trim().toLowerCase() === "rehearsal";
  const controlState = computeReadinessControlState({
    hasActiveEvent,
    readinessInFlight: state.admin.readinessInFlight,
    isRehearsalEvent,
  });

  if (els.adminRunPreflightBtn) {
    els.adminRunPreflightBtn.disabled = controlState.runPreflight.disabled;
    els.adminRunPreflightBtn.title = controlState.runPreflight.title;
  }
  if (els.adminCleanupRehearsalBtn) {
    els.adminCleanupRehearsalBtn.disabled = controlState.cleanupRehearsal.disabled;
    els.adminCleanupRehearsalBtn.title = controlState.cleanupRehearsal.title;
  }
  if (els.adminWalkthroughStartBtn) {
    els.adminWalkthroughStartBtn.disabled = controlState.walkthroughStart.disabled;
    els.adminWalkthroughStartBtn.title = controlState.walkthroughStart.title;
  }
  if (els.adminWalkthroughResetBtn) {
    els.adminWalkthroughResetBtn.disabled = controlState.walkthroughReset.disabled;
    els.adminWalkthroughResetBtn.title = controlState.walkthroughReset.title;
  }
  Array.from(document.querySelectorAll("[data-readiness-step]")).forEach((btn) => {
    btn.disabled = controlState.readinessStepsDisabled;
  });
  Array.from(document.querySelectorAll("[data-readiness-open-view]")).forEach((btn) => {
    btn.disabled = controlState.readinessOpenViewDisabled;
  });

  if (!event?.id) {
    els.adminReadinessPreflightSummary.textContent = "Set an active event to run preflight.";
    if (els.adminReadinessStepSummary) {
      els.adminReadinessStepSummary.textContent = "";
    }
    if (els.adminReadinessWalkthroughSummary) {
      const initial = buildWalkthroughSummary();
      els.adminReadinessWalkthroughSummary.textContent = initial.summaryText;
    }
    if (els.adminReadinessHistorySummary) {
      els.adminReadinessHistorySummary.textContent = "No readiness history yet.";
    }
    return;
  }

  const readiness = event.readinessState && typeof event.readinessState === "object" ?
    event.readinessState :
    {};
  const preflight = readiness.preflight && typeof readiness.preflight === "object" ?
    readiness.preflight :
    {};
  const blockers = Array.isArray(preflight.blockers) ? preflight.blockers : [];
  const checks = Array.isArray(preflight.checks) ? preflight.checks : [];
  const steps = readiness.steps && typeof readiness.steps === "object" ? readiness.steps : {};
  const walkthrough = readiness.walkthrough && typeof readiness.walkthrough === "object" ?
    readiness.walkthrough :
    {};
  const isLiveEvent = String(event.eventMode || "").trim().toLowerCase() !== "rehearsal";
  const walkthroughStepsReady = WALKTHROUGH_STEP_KEYS.every(
    (key) => String(steps?.[key]?.status || "").trim().toLowerCase() === "complete"
  );
  const fallbackChecks = buildFallbackReadinessChecks({
    assignmentsComplete:
      Boolean(state.event.assignments?.stage1Uid) &&
      Boolean(state.event.assignments?.stage2Uid) &&
      Boolean(state.event.assignments?.stage3Uid) &&
      Boolean(state.event.assignments?.sightUid),
    isLiveEvent,
    walkthroughStepsReady,
  });
  const resolvedChecks = mergeReadinessChecks({
    preflightChecks: checks,
    fallbackChecks,
  });
  const { passCount, total, pass } = summarizeReadinessChecks({
    checks: resolvedChecks,
    preflightPass: preflight.pass === true,
  });
  const blockerSuffix = blockers.length ? ` · ${blockers.length} blocker(s)` : "";
  els.adminReadinessPreflightSummary.textContent =
    `Preflight: ${pass ? "PASS" : "BLOCKED"} · ${passCount}/${total} checks passed${blockerSuffix}.`;
  const blockerViewByKey = {
    activeEvent: "settings",
    assignmentsComplete: "settings",
    assignmentsUnique: "settings",
    assignedUsersValid: "settings",
    schedulePresent: "preEvent",
    entriesPresentForScheduled: "preEvent",
    directorEntriesReady: "preEvent",
    walkthroughComplete: "readiness",
  };

  resolvedChecks.forEach((check) => {
    const li = document.createElement("li");
    li.className = "checklist-item";
    const left = document.createElement("span");
    left.textContent = check.label || check.key || "Check";
    const right = document.createElement("span");
    const ok = Boolean(check.pass);
    right.textContent = ok ? "Pass" : "Blocked";
    right.className = ok ? "check" : "check is-missing";
    li.appendChild(left);
    li.appendChild(right);
    if (check.message) {
      const hint = document.createElement("div");
      hint.className = "note";
      hint.textContent = check.message;
      li.appendChild(hint);
    }
    if (!ok) {
      const goToView = blockerViewByKey[String(check.key || "").trim()] || "preEvent";
      const fixBtn = document.createElement("button");
      fixBtn.type = "button";
      fixBtn.className = "ghost";
      fixBtn.textContent = goToView === "settings" ?
        "Fix in Settings" :
        "Fix in Pre-Event";
      fixBtn.addEventListener("click", () => {
        state.admin.currentView = goToView;
        applyAdminView(goToView);
        const hash = getAdminHashForView(goToView);
        if (window.location.hash !== hash) window.location.hash = hash;
      });
      li.appendChild(fixBtn);
    }
    els.adminReadinessChecklist.appendChild(li);
  });

  const walkthroughSummary = buildWalkthroughSummary({ steps, walkthrough });
  const completeSteps = walkthroughSummary.completeSteps;
  const summaryText = walkthroughSummary.summaryText;
  if (els.adminReadinessStepSummary) {
    els.adminReadinessStepSummary.textContent = summaryText;
  }
  if (els.adminReadinessWalkthroughSummary) {
    const walkStartAt = formatReadinessTimestamp(walkthrough?.startedAt);
    const walkStartBy = String(walkthrough?.startedBy || "").trim();
    const walkedAt = formatReadinessTimestamp(walkthrough?.updatedAt);
    const walkedBy = String(walkthrough?.updatedBy || "").trim();
    const walkCompletedAt = formatReadinessTimestamp(walkthrough?.completedAt);
    const walkCompletedBy = String(walkthrough?.completedBy || "").trim();
    const startMeta = walkStartAt || walkStartBy ?
      ` Started: ${walkStartAt || "time pending"}${walkStartBy ? ` · by ${walkStartBy}` : ""}.` :
      "";
    const walkedMeta = walkedAt || walkedBy ?
      ` Last update: ${walkedAt || "time pending"}${walkedBy ? ` · by ${walkedBy}` : ""}.` :
      "";
    const completedMeta = walkCompletedAt || walkCompletedBy ?
      ` Completed: ${walkCompletedAt || "time pending"}${walkCompletedBy ? ` · by ${walkCompletedBy}` : ""}.` :
      "";
    els.adminReadinessWalkthroughSummary.textContent = `${summaryText}${startMeta}${walkedMeta}${completedMeta}`;
  }

  WALKTHROUGH_STEP_KEYS.forEach((stepKey) => {
    const isComplete = String(steps?.[stepKey]?.status || "").trim().toLowerCase() === "complete";
    const row = document.querySelector(`[data-readiness-step-row="${stepKey}"]`);
    const stateBadge = row?.querySelector("[data-readiness-step-state]");
    if (stateBadge) {
      stateBadge.textContent = isComplete ? "Complete" : "Pending";
      stateBadge.classList.toggle("is-done", isComplete);
    }
    const btn = document.querySelector(`[data-readiness-step="${stepKey}"]`);
    if (!btn) return;
    btn.dataset.targetStatus = isComplete ? "incomplete" : "complete";
    btn.classList.toggle("is-done", isComplete);
    btn.textContent = isComplete ? "Mark Incomplete" : "Mark Complete";
  });

  if (els.adminReadinessHistorySummary && els.adminReadinessHistoryList) {
    const preflightWhen = formatReadinessTimestamp(preflight.ranAt);
    const preflightBy = String(preflight.ranBy || "").trim();
    const walkthroughWhen = formatReadinessTimestamp(walkthrough.updatedAt);
    const walkthroughBy = String(walkthrough.updatedBy || "").trim();
    const walkthroughNote = String(walkthrough.note || "").trim();
    const walkthroughStartedAt = formatReadinessTimestamp(walkthrough.startedAt);
    const walkthroughStartedBy = String(walkthrough.startedBy || "").trim();
    const walkthroughCompletedAt = formatReadinessTimestamp(walkthrough.completedAt);
    const walkthroughCompletedBy = String(walkthrough.completedBy || "").trim();
    const walkthroughStatusRaw = String(walkthrough.status || "").trim().toLowerCase();
    const walkthroughStatusLabel = walkthroughStatusRaw === "complete" ?
      "complete" :
      (walkthroughStatusRaw === "not-started" ? "not-started" : "in-progress");
    const stepEntries = Object.entries(steps || {})
      .map(([key, value]) => ({
        key,
        status: String(value?.status || "").trim().toLowerCase(),
        note: String(value?.note || "").trim(),
        source: String(value?.source || "").trim().toLowerCase(),
        updatedAt: value?.updatedAt || null,
        updatedBy: String(value?.updatedBy || "").trim(),
      }))
      .sort((a, b) => {
        const aMs = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : 0;
        const bMs = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : 0;
        return bMs - aMs;
      });
    const historyCount = (preflightWhen ? 1 : 0) + (walkthroughWhen || walkthroughBy || walkthroughNote ? 1 : 0) + stepEntries.length;
    els.adminReadinessHistorySummary.textContent = historyCount ?
      `History entries: ${historyCount}.` :
      "No readiness history yet.";

    if (preflightWhen || preflightBy) {
      const li = document.createElement("li");
      li.className = "note";
      li.textContent = `Preflight ${pass ? "passed" : "blocked"} · ${preflightWhen || "time pending"}${preflightBy ? ` · by ${preflightBy}` : ""}`;
      els.adminReadinessHistoryList.appendChild(li);
    }
    if (walkthroughWhen || walkthroughBy || walkthroughNote) {
      const li = document.createElement("li");
      li.className = "note";
      const startedMeta = walkthroughStartedAt || walkthroughStartedBy ?
        ` · started ${walkthroughStartedAt || "time pending"}${walkthroughStartedBy ? ` by ${walkthroughStartedBy}` : ""}` :
        "";
      const completedMeta = walkthroughCompletedAt || walkthroughCompletedBy ?
        ` · completed ${walkthroughCompletedAt || "time pending"}${walkthroughCompletedBy ? ` by ${walkthroughCompletedBy}` : ""}` :
        "";
      li.textContent = `Walkthrough ${walkthroughStatusLabel} · ${walkthroughWhen || "time pending"}${walkthroughBy ? ` · by ${walkthroughBy}` : ""}${startedMeta}${completedMeta}${walkthroughNote ? ` · ${walkthroughNote}` : ""}`;
      els.adminReadinessHistoryList.appendChild(li);
    }
    stepEntries.forEach((entry) => {
      const li = document.createElement("li");
      li.className = "note";
      const when = formatReadinessTimestamp(entry.updatedAt) || "time pending";
      const by = entry.updatedBy ? ` · by ${entry.updatedBy}` : "";
      const source = entry.source ? ` · source ${entry.source}` : "";
      const note = entry.note ? ` · ${entry.note}` : "";
      li.textContent = `${entry.key}: ${entry.status || "unknown"} · ${when}${by}${source}${note}`;
      els.adminReadinessHistoryList.appendChild(li);
    });
  }
}

export function setOpenPacketHint(message) {
  if (!els.judgeOpenPacketHint) return;
  els.judgeOpenPacketHint.textContent = message || "";
}

export function updateOpenEmptyState() {
  if (!els.judgeOpenEmpty) return;
  const show = !state.judgeOpen.currentPacketId;
  els.judgeOpenEmpty.style.display = show ? "block" : "none";
  if (els.judgeOpenStatusBadge) {
    if (!state.judgeOpen.mode) {
      els.judgeOpenStatusBadge.textContent = "Choose Mode";
    } else {
      const packet = state.judgeOpen.currentPacket || {};
      if (packet.status) {
        els.judgeOpenStatusBadge.textContent = packet.status;
      } else {
        els.judgeOpenStatusBadge.textContent =
          state.judgeOpen.mode === "official" ? "Official" : "Practice";
      }
    }
  }
  if (show) {
    if (els.judgeOpenCaptionTotal) {
      els.judgeOpenCaptionTotal.textContent = "0";
    }
    if (els.judgeOpenFinalRating) {
      els.judgeOpenFinalRating.textContent = "N/A";
    }
    hideOpenDetailView();
  }
  syncJudgeOpenStickyBarVisibility();
}

export function renderOpenPacketOptions(packets) {
  return getJudgeOpenRenderers().renderOpenPacketOptions(packets || []);
}

function updateOpenHeader() {
  return getJudgeOpenCore().updateOpenHeader();
}

function setJudgeOpenDirectorReferenceState(status, message = "", snapshot = null) {
  return getJudgeOpenDirectorReference().setJudgeOpenDirectorReferenceState(
    status,
    message,
    snapshot
  );
}

function hasLinkedOpenEnsemble() {
  const existing = state.judgeOpen.selectedExisting || {};
  return Boolean(existing.schoolId && existing.ensembleId);
}

function renderJudgeOpenDirectorReference() {
  return getJudgeOpenDirectorReference().renderJudgeOpenDirectorReference();
}

async function refreshJudgeOpenDirectorReference({ persistToPacket = true } = {}) {
  return getJudgeOpenDirectorReference().refreshJudgeOpenDirectorReference({ persistToPacket });
}

function syncOpenDirectorEntrySnapshotDraft(nextSnapshot) {
  return getJudgeOpenDirectorReference().syncOpenDirectorEntrySnapshotDraft(nextSnapshot);
}

function updateRoleTabBar(role) {
  if (!els.roleSwitcherWrap || !els.roleSwitcherSelect) return;
  const isAdmin = role === "admin";
  els.roleSwitcherWrap.classList.toggle("is-hidden", !isAdmin);
  if (!isAdmin) {
    els.roleSwitcherSelect.innerHTML = "";
    return;
  }

  const options = [
    { value: "admin", label: "Admin" },
    { value: "judge-open", label: "Judge" },
    { value: "director", label: "Director" },
  ].filter((option) => isTabAllowed(option.value, role));
  const existingValues = Array.from(els.roleSwitcherSelect.options).map((option) => option.value);
  const nextValues = options.map((option) => option.value);
  const needsRebuild =
    existingValues.length !== nextValues.length ||
    existingValues.some((value, index) => value !== nextValues[index]);

  if (needsRebuild) {
    els.roleSwitcherSelect.innerHTML = "";
    options.forEach((option) => {
      const node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.label;
      els.roleSwitcherSelect.appendChild(node);
    });
  }

  const fallbackValue = options[0]?.value || "admin";
  const selectedValue = options.some((option) => option.value === state.app.currentTab)
    ? state.app.currentTab
    : fallbackValue;
  els.roleSwitcherSelect.value = selectedValue;
}

function scrollToSection(target) {
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showOpenDetailView() {
  state.judgeOpen.detailViewIntent = "detail";
  if (els.judgeOpenListView) {
    els.judgeOpenListView.style.display = "none";
  }
  if (els.judgeOpenDetailView) {
    els.judgeOpenDetailView.classList.add("is-open");
    els.judgeOpenDetailView.style.display = "grid";
  }
  syncJudgeOpenStickyBarVisibility();
}

function hideOpenDetailView() {
  state.judgeOpen.detailViewIntent = "list";
  if (state.subscriptions.openSessions) {
    state.subscriptions.openSessions();
    state.subscriptions.openSessions = null;
  }
  if (state.judgeOpen.openSessionsRafId != null) {
    window.cancelAnimationFrame(state.judgeOpen.openSessionsRafId);
    state.judgeOpen.openSessionsRafId = null;
  }
  state.judgeOpen.openSessionsPendingRender = null;
  state.judgeOpen.openSessionsLastSig = "";
  state.judgeOpen.openSessionsSnapshotCount = 0;
  state.judgeOpen.openSessionsRenderCount = 0;
  state.judgeOpen.sessions = [];
  state.judgeOpen.tapePlaylist = [];
  state.judgeOpen.tapePlaylistIndex = 0;
  state.judgeOpen.loadedSegmentAudioSessionId = null;
  if (els.judgeOpenTapePlayback) {
    try {
      els.judgeOpenTapePlayback.pause();
    } catch {
      // no-op
    }
    els.judgeOpenTapePlayback.removeAttribute("src");
    try {
      els.judgeOpenTapePlayback.load();
    } catch {
      // no-op
    }
  }
  renderOpenSegments([]);
  if (els.judgeOpenListView) {
    els.judgeOpenListView.style.display = "grid";
  }
  if (els.judgeOpenDetailView) {
    els.judgeOpenDetailView.classList.remove("is-open");
    els.judgeOpenDetailView.style.display = "none";
  }
  syncJudgeOpenStickyBarVisibility();
}

function syncOpenFormTypeSegmented() {
  return getJudgeOpenSession().syncOpenFormTypeSegmented();
}

async function openJudgeOpenPacket(packetId) {
  return getJudgeOpenSession().openJudgeOpenPacket(packetId);
}

export function renderOpenExistingOptions(items) {
  return getJudgeOpenRenderers().renderOpenExistingOptions(items || []);
}

export function renderOpenCaptionForm() {
  return getJudgeOpenCore().renderOpenCaptionForm();
}

export function applyOpenCaptionState() {
  return getJudgeOpenCore().applyOpenCaptionState();
}

export function renderOpenSegments(sessions) {
  return getJudgeOpenCore().renderOpenSegments(sessions || []);
}

export function updateOpenSubmitState() {
  return getJudgeOpenCore().updateOpenSubmitState();
}

export async function restoreOpenPacketFromPrefs() {
  return getJudgeOpenSession().restoreOpenPacketFromPrefs();
}

function updateTapePlayback(sessions) {
  return getJudgeOpenSession().updateTapePlayback(sessions || []);
}

export function setStageJudgeSelectValues({
  stage1Uid = "",
  stage2Uid = "",
  stage3Uid = "",
  sightUid = "",
} = {}) {
  state.admin.assignmentsDraft = {
    stage1Uid: stage1Uid || "",
    stage2Uid: stage2Uid || "",
    stage3Uid: stage3Uid || "",
    sightUid: sightUid || "",
  };
  if (els.stage1JudgeSelect) els.stage1JudgeSelect.value = stage1Uid;
  if (els.stage2JudgeSelect) els.stage2JudgeSelect.value = stage2Uid;
  if (els.stage3JudgeSelect) els.stage3JudgeSelect.value = stage3Uid;
  if (els.sightJudgeSelect) els.sightJudgeSelect.value = sightUid;
}

export function renderDirectorEventOptions() {
  const result = getDirectorEventRenderers().renderDirectorEventOptions();
  updateDirectorAttachUI();
  return result;
}

export function updateDirectorEventMeta() {
  const result = getDirectorEventRenderers().updateDirectorEventMeta();
  renderDirectorContextPanel();
  return result;
}

export async function checkDirectorHasRegistrationForEvent(eventId) {
  return getDirectorRegistrationRenderers().checkDirectorHasRegistrationForEvent(eventId);
}

export async function renderDirectorRegistrationPanel() {
  return getDirectorRegistrationRenderers().renderDirectorRegistrationPanel();
}

export async function renderDirectorPostRegistration() {
  return getDirectorRegistrationRenderers().renderDirectorPostRegistration();
}

function renderDayOfEnsembleSelector() {
  return getDirectorDayOfRenderer()();
}

function generateSignatureFormPdf() {
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) {
    alertUser("PDF library not loaded. Try again in a moment.");
    return;
  }
  const eventId = state.director.selectedEventId;
  const event = eventId ? (state.event.list || []).find((e) => e.id === eventId) : null;
  const schoolName = els.directorSummarySchool?.textContent || "School";
  const ensembles = state.director.ensemblesCache || [];
  if (!event) {
    alertUser("No event selected.");
    return;
  }

  const pdf = new jsPDF();
  let y = 20;
  const lm = 20;
  const pw = 170;

  pdf.setFontSize(16);
  pdf.text("NORTH CAROLINA BANDMASTERS ASSOCIATION", lm, y);
  y += 8;
  pdf.setFontSize(14);
  pdf.text(getEventCardLabel(event), lm, y);
  y += 7;
  const startDate = event.startAt?.toDate ? event.startAt.toDate().toLocaleDateString() : "";
  const endDate = event.endAt?.toDate ? event.endAt.toDate().toLocaleDateString() : "";
  const dateStr = startDate && endDate && startDate !== endDate
    ? `${startDate} – ${endDate}` : startDate || endDate || "";
  pdf.setFontSize(11);
  pdf.text(dateStr, lm, y);
  y += 10;

  pdf.setFontSize(12);
  pdf.text(`School: ${schoolName}`, lm, y);
  y += 10;

  const deadline = event.registrationDeadline?.toDate
    ? event.registrationDeadline.toDate().toLocaleDateString()
    : null;
  if (deadline) {
    pdf.text(`Registration Deadline: ${deadline}`, lm, y);
    y += 8;
  }

  pdf.setFontSize(11);
  pdf.text("Registered Ensembles:", lm, y);
  y += 7;

  const summaryEl = els.directorRegisteredEnsemblesSummary;
  const rows = summaryEl?.querySelectorAll(".registration-ensemble-row") || [];
  let count = 0;
  rows.forEach((row) => {
    count++;
    const name = row.querySelector("strong")?.textContent || "Ensemble";
    const hints = row.querySelectorAll(".hint");
    const meta = hints[0]?.textContent || "";
    pdf.text(`${count}. ${name}`, lm + 5, y);
    y += 5;
    if (meta) {
      pdf.setFontSize(9);
      pdf.text(`   ${meta}`, lm + 5, y);
      pdf.setFontSize(11);
      y += 5;
    }
    y += 2;
  });
  if (!count) {
    pdf.text("No ensembles registered.", lm + 5, y);
    y += 7;
  }

  y += 5;
  pdf.setFontSize(12);
  pdf.text("INVOICE", lm, y);
  y += 7;
  pdf.setFontSize(11);
  const total = count * 225;
  pdf.text(`${count} ensemble(s) x $225.00 = $${total.toFixed(2)}`, lm, y);
  y += 7;
  pdf.text("Make checks payable to: Ashley High School Band Boosters", lm, y);
  y += 6;
  pdf.text("Payment accepted by check or cash.", lm, y);
  y += 15;

  pdf.setFontSize(11);
  pdf.text("I certify that the information above is correct and that all participating", lm, y);
  y += 6;
  pdf.text("ensembles are approved by the school administration.", lm, y);
  y += 15;
  pdf.line(lm, y, lm + 100, y);
  pdf.text("Principal Signature", lm, y + 5);
  pdf.line(lm + 115, y, lm + pw - 5, y);
  pdf.text("Date", lm + 115, y + 5);

  const safeName = schoolName.replace(/[^a-zA-Z0-9]/g, "_");
  pdf.save(`SignatureForm_${safeName}.pdf`);
}

export function updateRepertoirePreview(wrapper, key) {
  return getDirectorEntryFormRenderers().updateRepertoirePreview(wrapper, key);
}

export function renderRepertoireFields() {
  return getDirectorEntryFormRenderers().renderRepertoireFields();
}

export function renderInstrumentationStandard() {
  return getDirectorEntryFormRenderers().renderInstrumentationStandard();
}

export function renderInstrumentationNonStandard() {
  return getDirectorEntryFormRenderers().renderInstrumentationNonStandard();
}

export function renderRule3cRows() {
  return getDirectorEntryFormRenderers().renderRule3cRows();
}

export function renderSeatingRows() {
  return getDirectorEntryFormRenderers().renderSeatingRows();
}

export function renderPercussionOptions() {
  return getDirectorEntryFormRenderers().renderPercussionOptions();
}

export function renderDirectorEntryForm() {
  return getDirectorEntryFormRenderers().renderDirectorEntryForm();
}

export function setDirectorEntryHint(message) {
  return getDirectorEntryFormRenderers().setDirectorEntryHint(message);
}

export function renderStatusSummary({
  rootId,
  root,
  title,
  done,
  total,
  pillText,
  hintText,
  openWhenIncomplete = true,
}) {
  return getDirectorEntryFormRenderers().renderStatusSummary({
    rootId,
    root,
    title,
    done,
    total,
    pillText,
    hintText,
    openWhenIncomplete,
  });
}

export function renderChecklist(listEl, items, status) {
  return getDirectorEntryFormRenderers().renderChecklist(listEl, items, status);
}

export function renderDirectorChecklist(entry, completionState) {
  return getDirectorEntryFormRenderers().renderDirectorChecklist(entry, completionState);
}

export function renderAdminReadiness() {
  if (state.app.currentTab === "admin" && state.admin.currentView === "readiness") {
    return renderAdminReadinessView();
  }
  return null;
}

function setPreEventStatusBadge(el, label, tone) {
  if (!el) return;
  el.textContent = label;
  el.classList.remove("status--ok", "status--warn", "status--wait");
  if (tone === "ok") el.classList.add("status--ok");
  else if (tone === "warn") el.classList.add("status--warn");
  else el.classList.add("status--wait");
}

function setPreEventStatusHint(el, text) {
  if (!el) return;
  el.textContent = text || "";
}

async function getCurrentSchoolEnsembleIndex(schoolIds = []) {
  const ids = Array.from(new Set((schoolIds || []).map((id) => String(id || "").trim()).filter(Boolean)));
  const index = new Map();
  if (!ids.length) return index;
  await Promise.all(
    ids.map(async (schoolId) => {
      try {
        const snap = await getDocs(
          collection(db, COLLECTIONS.schools, schoolId, COLLECTIONS.ensembles)
        );
        index.set(
          schoolId,
          new Set(snap.docs.map((docSnap) => String(docSnap.id || "").trim()).filter(Boolean))
        );
      } catch (error) {
        console.warn("getCurrentSchoolEnsembleIndex failed", { schoolId, error });
        index.set(schoolId, new Set());
      }
    })
  );
  return index;
}

async function resolveCurrentRegisteredEnsembles(eventId, registered = []) {
  if (!eventId || !Array.isArray(registered) || !registered.length) {
    return { active: [], stale: [] };
  }
  const schoolIds = Array.from(
    new Set(
      registered
        .map((entry) => String(entry.schoolId || "").trim())
        .filter(Boolean)
    )
  );
  const ensembleIndex = await getCurrentSchoolEnsembleIndex(schoolIds);
  const active = [];
  const stale = [];
  registered.forEach((entry) => {
    const schoolId = String(entry.schoolId || "").trim();
    const ensembleId = String(entry.ensembleId || entry.id || "").trim();
    if (!schoolId || !ensembleId) {
      stale.push(entry);
      return;
    }
    const schoolSet = ensembleIndex.get(schoolId);
    if (schoolSet && schoolSet.has(ensembleId)) {
      active.push(entry);
    } else {
      stale.push(entry);
    }
  });
  return { active, stale };
}

function setPreEventStepChip(el, { label, done = false, active = false } = {}) {
  if (!el) return;
  el.textContent = label || "";
  el.classList.toggle("is-done", Boolean(done));
  el.classList.toggle("is-active", Boolean(active));
}

function renderPreEventWorkflowGuidance({
  hasActiveEvent = false,
  registrationDone = false,
  scheduleDone = false,
  directorInputDone = false,
} = {}) {
  if (!els.preEventWorkflowCard) return;

  let step = "Start";
  let nextTitle = "Set an active event to begin.";
  let nextHint = "Then complete registration coverage, schedule, and director input checks.";

  if (hasActiveEvent && !registrationDone) {
    step = "Registration";
    nextTitle = "Confirm all expected schools and ensembles are registered.";
    nextHint = "Use Registration Coverage to verify sign form/payment and catch missing entries.";
  } else if (hasActiveEvent && registrationDone && !scheduleDone) {
    step = "Schedule";
    nextTitle = "Complete the full event schedule.";
    nextHint = "Assign performance times and recalculate so all registered ensembles are scheduled.";
  } else if (hasActiveEvent && registrationDone && scheduleDone && !directorInputDone) {
    step = "Director Input";
    nextTitle = "Verify day-of form readiness for scheduled ensembles.";
    nextHint = "Use school detail to review director data and resolve incomplete entries.";
  } else if (hasActiveEvent && registrationDone && scheduleDone && directorInputDone) {
    step = "Ready";
    nextTitle = "Pre-Event setup is complete.";
    nextHint = "You can move to Live Event operations when check-in begins.";
  }

  if (els.preEventCurrentStepPill) els.preEventCurrentStepPill.textContent = step;
  if (els.preEventNextStepTitle) els.preEventNextStepTitle.textContent = nextTitle;
  if (els.preEventNextStepHint) els.preEventNextStepHint.textContent = nextHint;

  setPreEventStepChip(els.preEventStepChipRegistration, {
    label: "Registration",
    done: registrationDone,
    active: hasActiveEvent && !registrationDone,
  });
  setPreEventStepChip(els.preEventStepChipSchedule, {
    label: "Schedule",
    done: scheduleDone,
    active: hasActiveEvent && registrationDone && !scheduleDone,
  });
  setPreEventStepChip(els.preEventStepChipDirectorInput, {
    label: "Director Input",
    done: directorInputDone,
    active: hasActiveEvent && registrationDone && scheduleDone && !directorInputDone,
  });
}

export async function renderPreEventGuidedFlow() {
  const hasUI = Boolean(
    els.preEventFlowSummary &&
      els.preEventStatusRegistration &&
      els.preEventStatusSchedule &&
      els.preEventStatusDirectorInput
  );
  if (!hasUI) return;

  const eventId = state.event.active?.id || "";
  if (!eventId) {
    if (els.preEventFlowSummary) {
      els.preEventFlowSummary.textContent = "Set an active event to begin.";
    }
    setPreEventStatusBadge(els.preEventStatusRegistration, "Waiting", "wait");
    setPreEventStatusBadge(els.preEventStatusSchedule, "Waiting", "wait");
    setPreEventStatusBadge(els.preEventStatusDirectorInput, "Waiting", "wait");
    setPreEventStatusHint(els.preEventStatusRegistrationHint, "No active event.");
    setPreEventStatusHint(els.preEventStatusScheduleHint, "No active event.");
    setPreEventStatusHint(els.preEventStatusDirectorInputHint, "No active event.");
    renderPreEventWorkflowGuidance({
      hasActiveEvent: false,
      registrationDone: false,
      scheduleDone: false,
      directorInputDone: false,
    });
    return;
  }

  const loadVersion = (state.admin.preEventFlowLoadVersion || 0) + 1;
  state.admin.preEventFlowLoadVersion = loadVersion;

  const registeredRaw = await fetchRegisteredEnsembles(eventId);
  const { active: registered, stale } = await resolveCurrentRegisteredEnsembles(eventId, registeredRaw);
  if (state.admin.preEventFlowLoadVersion !== loadVersion) return;

  const registeredCount = registered.length;
  const scheduledIds = new Set((state.event.rosterEntries || []).map((entry) => entry.ensembleId));
  const scheduledRegistered = registered.filter((entry) =>
    scheduledIds.has(entry.ensembleId || entry.id)
  );
  const scheduledCount = scheduledRegistered.length;

  const directorInputTarget = scheduledCount > 0 ? scheduledRegistered : registered;
  let directorReadyCount = 0;
  if (directorInputTarget.length > 0) {
    const statuses = await Promise.all(
      directorInputTarget.map((entry) => fetchEntryStatus(eventId, entry.ensembleId || entry.id))
    );
    if (state.admin.preEventFlowLoadVersion !== loadVersion) return;
    directorReadyCount = statuses.filter((status) => status === "ready").length;
  }

  const registrationDone = registeredCount > 0;
  const scheduleDone = registeredCount > 0 && scheduledCount === registeredCount;
  const directorInputDone =
    directorInputTarget.length > 0 && directorReadyCount === directorInputTarget.length;

  if (els.preEventFlowSummary) {
    const staleLabel = stale.length ? ` · Hidden stale ${stale.length}` : "";
    els.preEventFlowSummary.textContent =
      `Registered ${registeredCount}${staleLabel} · Scheduled ${scheduledCount}/${registeredCount} · Director Input Ready ${directorReadyCount}/${directorInputTarget.length}`;
  }

  setPreEventStatusBadge(
    els.preEventStatusRegistration,
    registrationDone ? "Ready" : "Waiting",
    registrationDone ? "ok" : "wait"
  );
  setPreEventStatusHint(
    els.preEventStatusRegistrationHint,
    registrationDone
      ? `${registeredCount} ensemble(s) registered.`
      : "No ensembles registered yet."
  );

  setPreEventStatusBadge(
    els.preEventStatusSchedule,
    scheduleDone ? "Ready" : registeredCount ? "In Progress" : "Waiting",
    scheduleDone ? "ok" : registeredCount ? "warn" : "wait"
  );
  setPreEventStatusHint(
    els.preEventStatusScheduleHint,
    registeredCount
      ? `${scheduledCount} of ${registeredCount} registered ensemble(s) scheduled.`
      : "Registration must start before scheduling."
  );

  setPreEventStatusBadge(
    els.preEventStatusDirectorInput,
    directorInputDone
      ? "Ready"
      : directorInputTarget.length
        ? "In Progress"
        : "Waiting",
    directorInputDone
      ? "ok"
      : directorInputTarget.length
        ? "warn"
        : "wait"
  );
  setPreEventStatusHint(
    els.preEventStatusDirectorInputHint,
    directorInputTarget.length
      ? `${directorReadyCount} of ${directorInputTarget.length} target ensemble(s) marked ready.`
      : "Schedule at least one ensemble to track day-of readiness."
  );
  renderPreEventWorkflowGuidance({
    hasActiveEvent: true,
    registrationDone,
    scheduleDone,
    directorInputDone,
  });
}

export function updateDirectorActiveEnsembleLabel() {
  if (!state.director.selectedEnsembleId && state.director.ensemblesCache.length) {
    state.director.selectedEnsembleId = state.director.ensemblesCache[0].id;
  }
  const active = state.director.ensemblesCache.find(
    (ensemble) => ensemble.id === state.director.selectedEnsembleId
  );
  if (els.directorEditorActiveEnsembleLabel) {
    els.directorEditorActiveEnsembleLabel.textContent = active?.name || "No active ensemble selected";
  }
  renderDirectorWorkflowGuidance();
}

function buildAdminLogisticsEntryPanel(entry, titleText) {
  const seating = entry.seating || {};
  const seatingRows = Array.isArray(seating.rows) ? seating.rows : [];
  const percussionNeeds = entry.percussionNeeds || {};
  const selectedPercussion = Array.isArray(percussionNeeds.selected)
    ? percussionNeeds.selected.filter(Boolean)
    : [];

  const wrapper = document.createElement("div");
  wrapper.className = "panel stack";
  const title = document.createElement("strong");
  title.textContent = titleText;
  wrapper.appendChild(title);

  const seatingHeading = document.createElement("div");
  seatingHeading.className = "note";
  seatingHeading.textContent = "Seating Chart";
  wrapper.appendChild(seatingHeading);
  const seatingBody = document.createElement("div");
  seatingBody.className = "stack";
  if (!seatingRows.length) {
    const empty = document.createElement("div");
    empty.className = "note";
    empty.textContent = "No seating rows entered.";
    seatingBody.appendChild(empty);
  } else {
    seatingRows.forEach((row, index) => {
      const line = document.createElement("div");
      line.className = "note";
      line.textContent = `Row ${index + 1}: Chairs ${Number(row?.chairs || 0)} - Stands ${Number(
        row?.stands || 0
      )}`;
      seatingBody.appendChild(line);
    });
  }
  if (seating.notes) {
    const notes = document.createElement("div");
    notes.className = "note";
    notes.textContent = `Notes: ${seating.notes}`;
    seatingBody.appendChild(notes);
  }
  wrapper.appendChild(seatingBody);

  const percussionTitle = document.createElement("div");
  percussionTitle.className = "note";
  percussionTitle.textContent = "Percussion";
  wrapper.appendChild(percussionTitle);
  const percussionBody = document.createElement("div");
  percussionBody.className = "stack";
  const requested = document.createElement("div");
  requested.className = "note";
  requested.textContent = selectedPercussion.length
    ? `Requested: ${selectedPercussion.join(" - ")}`
    : "Requested: None selected";
  percussionBody.appendChild(requested);
  if (percussionNeeds.notes) {
    const notes = document.createElement("div");
    notes.className = "note";
    notes.textContent = `Notes: ${percussionNeeds.notes}`;
    percussionBody.appendChild(notes);
  }
  wrapper.appendChild(percussionBody);
  return wrapper;
}

function formatSignedDiff(value) {
  const n = Number(value || 0);
  if (n > 0) return `+${n}`;
  if (n < 0) return `${n}`;
  return "0";
}

function buildAdminLogisticsDiffPanel(currentEntry, nextEntry) {
  const panel = document.createElement("div");
  panel.className = "panel stack";
  const title = document.createElement("strong");
  title.textContent = "Changeover Diff (Next Band - Band On Stage)";
  panel.appendChild(title);

  const currentRows = Array.isArray(currentEntry?.seating?.rows) ? currentEntry.seating.rows : [];
  const nextRows = Array.isArray(nextEntry?.seating?.rows) ? nextEntry.seating.rows : [];
  const rowCount = Math.max(currentRows.length, nextRows.length, SEATING_ROWS);
  const seatingHeading = document.createElement("div");
  seatingHeading.className = "note";
  seatingHeading.textContent = "Seating";
  panel.appendChild(seatingHeading);
  for (let i = 0; i < rowCount; i += 1) {
    const currentRow = currentRows[i] || {};
    const nextRow = nextRows[i] || {};
    const currentChairs = Number(currentRow.chairs || 0);
    const nextChairs = Number(nextRow.chairs || 0);
    const currentStands = Number(currentRow.stands || 0);
    const nextStands = Number(nextRow.stands || 0);
    const line = document.createElement("div");
    line.className = "note";
    line.textContent =
      `Row ${i + 1}: Chairs ${currentChairs} -> ${nextChairs} (${formatSignedDiff(nextChairs - currentChairs)}), ` +
      `Stands ${currentStands} -> ${nextStands} (${formatSignedDiff(nextStands - currentStands)})`;
    panel.appendChild(line);
  }

  const percussionHeading = document.createElement("div");
  percussionHeading.className = "note";
  percussionHeading.textContent = "Percussion";
  panel.appendChild(percussionHeading);
  const currentPerc = new Set(
    Array.isArray(currentEntry?.percussionNeeds?.selected)
      ? currentEntry.percussionNeeds.selected.filter(Boolean)
      : []
  );
  const nextPerc = new Set(
    Array.isArray(nextEntry?.percussionNeeds?.selected)
      ? nextEntry.percussionNeeds.selected.filter(Boolean)
      : []
  );
  const added = Array.from(nextPerc).filter((item) => !currentPerc.has(item));
  const removed = Array.from(currentPerc).filter((item) => !nextPerc.has(item));
  const addedRow = document.createElement("div");
  addedRow.className = "note";
  addedRow.textContent = `Add: ${added.length ? added.join(" - ") : "None"}`;
  panel.appendChild(addedRow);
  const removedRow = document.createElement("div");
  removedRow.className = "note";
  removedRow.textContent = `Remove: ${removed.length ? removed.join(" - ") : "None"}`;
  panel.appendChild(removedRow);

  return panel;
}

async function refreshPreEventScheduleTimelineStarts(entries = state.event.rosterEntries || []) {
  if (!els.preEventScheduleTimelineContainer || !els.preEventScheduleTimelineMessage) return;
  const eventId = state.event.active?.id || "";
  if (!eventId) {
    els.preEventScheduleTimelineMessage.textContent = "Set an active event to view timeline starts.";
    els.preEventScheduleTimelineContainer.innerHTML = "";
    if (els.preEventBreakList) els.preEventBreakList.innerHTML = "";
    if (els.preEventBreakStatus) els.preEventBreakStatus.textContent = "";
    if (els.preEventBreakAddBtn) els.preEventBreakAddBtn.disabled = true;
    return;
  }
  if (!entries.length) {
    els.preEventScheduleTimelineMessage.textContent = "No scheduled ensembles yet.";
    els.preEventScheduleTimelineContainer.innerHTML = "";
    if (els.preEventBreakList) els.preEventBreakList.innerHTML = "";
    if (els.preEventBreakStatus) els.preEventBreakStatus.textContent = "";
    if (els.preEventBreakAddBtn) els.preEventBreakAddBtn.disabled = true;
    return;
  }

  const sorted = [...entries].sort((a, b) => {
    const aTime = toDateOrNull(a.performanceAt)?.getTime() || 0;
    const bTime = toDateOrNull(b.performanceAt)?.getTime() || 0;
    return aTime - bTime;
  });
  const autoDayBreaks = deriveAutoScheduleDayBreaks(sorted);
  const dayBreaks = mergeScheduleDayBreaks(state.event.active?.scheduleDayBreaks || {}, autoDayBreaks);

  const gradeMap = new Map();
  await Promise.all(
    sorted.map(async (entry) => {
      const grade = await fetchEnsembleGrade(eventId, entry.ensembleId);
      gradeMap.set(entry.ensembleId, grade || null);
    })
  );
  const firstPerf = sorted[0]?.performanceAt;
  const getGrade = (entry) => gradeMap.get(entry.ensembleId) || null;
  const timeline = computeScheduleTimeline(
    firstPerf,
    sorted,
    Array.isArray(state.event.active?.scheduleBreaks) ? state.event.active.scheduleBreaks : [],
    getGrade,
    dayBreaks
  );
  const timelineByEntryId = new Map(timeline.map((row) => [row.entryId, row]));
  const breakSet = new Set(
    Array.isArray(state.event.active?.scheduleBreaks) ? state.event.active.scheduleBreaks : []
  );

  const renderBreakControls = () => {
    if (!els.preEventBreakList || !els.preEventBreakAddBtn || !els.preEventBreakAtInput) return;
    const boundaries = [];
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const currentEntry = sorted[i];
      const nextEntry = sorted[i + 1];
      const currentSlot = timelineByEntryId.get(currentEntry.id);
      if (!currentSlot) continue;
      const boundaryTime = currentSlot.sightStart;
      const nextSchoolName =
        nextEntry.schoolName ||
        getSchoolNameById(state.admin.schoolsList, nextEntry.schoolId) ||
        nextEntry.schoolId ||
        "—";
      const nextEnsemble = normalizeEnsembleNameForSchool({
        schoolName: nextSchoolName,
        ensembleName: nextEntry.ensembleName || nextEntry.ensembleId || "—",
      });
      boundaries.push({
        afterEntryId: currentEntry.id,
        boundaryTime,
        nextLabel: `${nextSchoolName} ${nextEnsemble}`.trim(),
      });
    }

    const formatBoundary = (item) =>
      `${formatStartTime(item.boundaryTime)} - before ${item.nextLabel}`;

    if (!boundaries.length) {
      els.preEventBreakList.innerHTML = "<div class='hint'>Breaks become available once at least two ensembles are scheduled.</div>";
      els.preEventBreakAddBtn.disabled = true;
      return;
    }
    els.preEventBreakAddBtn.disabled = false;
    if (!els.preEventBreakAtInput.value) {
      els.preEventBreakAtInput.value = toLocalDatetimeValue(boundaries[0].boundaryTime);
    }

    const applied = boundaries.filter((item) => breakSet.has(item.afterEntryId));
    if (!applied.length) {
      els.preEventBreakList.innerHTML = "<div class='hint'>No breaks added yet.</div>";
    } else {
      const wrap = document.createElement("div");
      wrap.className = "stack";
      applied.forEach((item) => {
        const row = document.createElement("div");
        row.className = "row row--between";
        const label = document.createElement("span");
        label.className = "note";
        label.textContent = formatBoundary(item);
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "ghost";
        removeBtn.textContent = "Remove";
        removeBtn.addEventListener("click", async () => {
          removeBtn.disabled = true;
          const next = Array.from(breakSet).filter((id) => id !== item.afterEntryId);
          await updateEventSchedulerFields({ eventId, scheduleBreaks: next });
          if (state.event.active?.id === eventId) {
            state.event.active = { ...state.event.active, scheduleBreaks: next };
          }
          scheduleAdminPreflightRefresh({ immediate: true });
          if (els.preEventBreakStatus) {
            els.preEventBreakStatus.textContent = `Removed break at ${formatStartTime(item.boundaryTime)}.`;
          }
          await refreshPreEventScheduleTimelineStarts(state.event.rosterEntries || []);
        });
        row.appendChild(label);
        row.appendChild(removeBtn);
        wrap.appendChild(row);
      });
      els.preEventBreakList.innerHTML = "";
      els.preEventBreakList.appendChild(wrap);
    }

    els.preEventBreakAddBtn.onclick = async () => {
      const raw = els.preEventBreakAtInput.value;
      const target = raw ? new Date(raw) : null;
      if (!target || Number.isNaN(target.getTime())) {
        if (els.preEventBreakStatus) {
          els.preEventBreakStatus.textContent = "Enter a valid break time.";
        }
        return;
      }
      const match = boundaries.find((item) => item.boundaryTime.getTime() >= target.getTime());
      if (!match) {
        if (els.preEventBreakStatus) {
          els.preEventBreakStatus.textContent =
            "No valid break point at or after that time.";
        }
        return;
      }
      if (breakSet.has(match.afterEntryId)) {
        if (els.preEventBreakStatus) {
          els.preEventBreakStatus.textContent =
            `Break already exists at ${formatStartTime(match.boundaryTime)}.`;
        }
        return;
      }
      els.preEventBreakAddBtn.disabled = true;
      try {
        const next = [...Array.from(breakSet), match.afterEntryId];
        await updateEventSchedulerFields({ eventId, scheduleBreaks: next });
        if (state.event.active?.id === eventId) {
          state.event.active = { ...state.event.active, scheduleBreaks: next };
        }
        scheduleAdminPreflightRefresh({ immediate: true });
        if (els.preEventBreakStatus) {
          els.preEventBreakStatus.textContent =
            `Added 30-min break at ${formatStartTime(match.boundaryTime)} (snapped).`;
        }
        await refreshPreEventScheduleTimelineStarts(state.event.rosterEntries || []);
      } finally {
        els.preEventBreakAddBtn.disabled = false;
      }
    };
  };
  renderBreakControls();

  els.preEventScheduleTimelineMessage.textContent = "";
  els.preEventScheduleTimelineContainer.innerHTML = "";

  const table = document.createElement("table");
  table.setAttribute("role", "grid");
  table.className = "schedule-timeline-table";
  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>School</th><th>Ensemble</th><th>Grade</th><th>Holding</th><th>Warm-up</th><th>Performance</th><th>Sightreading</th></tr>";
  table.appendChild(thead);
  const tbody = document.createElement("tbody");

  sorted.forEach((entry) => {
    const slot = timelineByEntryId.get(entry.id);
    if (!slot) return;
    const grade = slot.grade || null;
    const schoolName =
      entry.schoolName ||
      getSchoolNameById(state.admin.schoolsList, entry.schoolId) ||
      entry.schoolId ||
      "—";
    const rawEnsembleName = entry.ensembleName || entry.ensembleId || "—";
    const ensembleName = normalizeEnsembleNameForSchool({
      schoolName,
      ensembleName: rawEnsembleName,
    });

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(schoolName)}</td>
      <td>${escapeHtml(ensembleName)}</td>
      <td>${escapeHtml(grade || "—")}</td>
      <td>${escapeHtml(formatStartTime(slot.holdingStart))}</td>
      <td>${escapeHtml(formatStartTime(slot.warmUpStart))}</td>
      <td>${escapeHtml(formatStartTime(slot.performStart))}</td>
      <td>${escapeHtml(formatStartTime(slot.sightStart))}</td>
    `;
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  const wrap = document.createElement("div");
  wrap.className = "schedule-timeline-table-wrap";
  wrap.appendChild(table);
  els.preEventScheduleTimelineContainer.appendChild(wrap);
}

function setAdminSchedulerMessage(msg) {
  if (els.adminSchedulerMessage) els.adminSchedulerMessage.textContent = msg || "";
}

/**
 * @param {{ firstPerformanceAt?: Date | { toDate: () => Date } | null, scheduleBreaks?: string[] } | void} override
 *   When provided, used instead of state for that run (avoids race with Firestore listener overwriting state after save).
 */
export async function refreshSchedulerTimeline(override) {
  if (!els.adminSchedulerMessage || !els.adminSchedulerTimelineContainer) return;
  const eventId = state.event.active?.id;
  const event = state.event.active;
  const roster = state.event.rosterEntries || [];

  if (!eventId || !event) {
    setAdminSchedulerMessage("Set an active event to use the schedule timeline.");
    if (els.schedulerFirstPerformanceInput) els.schedulerFirstPerformanceInput.value = "";
    els.adminSchedulerTimelineContainer.innerHTML = "";
    if (els.schedulerApplyBtn) els.schedulerApplyBtn.classList.add("is-hidden");
    return;
  }

  if (!roster.length) {
    setAdminSchedulerMessage("Add bands to the schedule first.");
    if (els.schedulerFirstPerformanceInput) els.schedulerFirstPerformanceInput.value = "";
    els.adminSchedulerTimelineContainer.innerHTML = "";
    if (els.schedulerApplyBtn) els.schedulerApplyBtn.classList.add("is-hidden");
    return;
  }

  const firstPerformanceAt =
    override?.firstPerformanceAt !== undefined
      ? override.firstPerformanceAt
      : event.firstPerformanceAt ?? null;
  const scheduleBreaks =
    override?.scheduleBreaks !== undefined
      ? override.scheduleBreaks
      : Array.isArray(event.scheduleBreaks)
        ? [...event.scheduleBreaks]
        : [];

  if (els.schedulerFirstPerformanceInput) {
    if (firstPerformanceAt) {
      const d = firstPerformanceAt.toDate ? firstPerformanceAt.toDate() : new Date(firstPerformanceAt);
      els.schedulerFirstPerformanceInput.value = toLocalDatetimeValue(d);
    } else {
      els.schedulerFirstPerformanceInput.value = "";
    }
  }

  if (!firstPerformanceAt) {
    setAdminSchedulerMessage("Set first performance time to see timeline.");
    els.adminSchedulerTimelineContainer.innerHTML = "";
    if (els.schedulerApplyBtn) els.schedulerApplyBtn.classList.add("is-hidden");
    return;
  }

  setAdminSchedulerMessage("");
  const gradeMap = new Map();
  await Promise.all(
    roster.map(async (entry) => {
      const grade = await fetchEnsembleGrade(eventId, entry.ensembleId);
      gradeMap.set(entry.ensembleId, grade || null);
    })
  );
  const getGrade = (entry) => gradeMap.get(entry.ensembleId) ?? null;
  const breakSet = new Set(scheduleBreaks);
  const autoDayBreaks = deriveAutoScheduleDayBreaks(roster);
  const dayBreaks = mergeScheduleDayBreaks(event?.scheduleDayBreaks || {}, autoDayBreaks);
  const timeline = computeScheduleTimeline(firstPerformanceAt, roster, breakSet, getGrade, dayBreaks);

  els.adminSchedulerTimelineContainer.innerHTML = "";
  const table = document.createElement("table");
  table.setAttribute("role", "grid");
  table.className = "schedule-timeline-table";
  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>Band</th><th>Grade</th><th>Slot</th><th>Holding</th><th>Warm-up</th><th>Perform</th><th>Sight</th><th></th></tr>";
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  timeline.forEach((row, index) => {
    const rosterEntry = roster[index];
    const schoolName = rosterEntry.schoolName || getSchoolNameById(state.admin.schoolsList, rosterEntry.schoolId) || rosterEntry.schoolId || "";
    const ensembleName = normalizeEnsembleDisplayName({
      schoolName,
      ensembleName: rosterEntry.ensembleName || "",
      ensembleId: rosterEntry.ensembleId || "",
    });
    const bandLabel = formatSchoolEnsembleLabel({
      schoolName,
      ensembleName,
      ensembleId: rosterEntry.ensembleId || "",
    });
    const gradeLabel = row.grade || "—";
    const sightEnd = new Date(row.sightStart.getTime() + row.slotMins * 60 * 1000);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(bandLabel)}</td>
      <td>${escapeHtml(gradeLabel)}</td>
      <td>${row.slotMins} min</td>
      <td>${escapeHtml(formatTimeRange(row.holdingStart, row.warmUpStart))}</td>
      <td>${escapeHtml(formatTimeRange(row.warmUpStart, row.performStart))}</td>
      <td>${escapeHtml(formatTimeRange(row.performStart, row.sightStart))}</td>
      <td>${escapeHtml(formatTimeRange(row.sightStart, sightEnd))}</td>
      <td></td>
    `;
    const breakCell = tr.querySelector("td:last-child");
    const breakBtn = document.createElement("button");
    breakBtn.type = "button";
    breakBtn.className = "ghost";
    const hasBreak = breakSet.has(row.entryId);
    breakBtn.textContent = hasBreak ? "Remove break after" : "Add break after";
    breakBtn.addEventListener("click", async () => {
      const next = hasBreak
        ? scheduleBreaks.filter((id) => id !== row.entryId)
        : [...scheduleBreaks, row.entryId];
      await updateEventSchedulerFields({ eventId, scheduleBreaks: next });
      if (state.event.active?.id === eventId) {
        state.event.active = { ...state.event.active, scheduleBreaks: next };
      }
      scheduleAdminPreflightRefresh({ immediate: true });
      refreshSchedulerTimeline();
    });
    breakCell.appendChild(breakBtn);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  const schedWrap = document.createElement("div");
  schedWrap.className = "schedule-timeline-table-wrap";
  schedWrap.appendChild(table);
  els.adminSchedulerTimelineContainer.appendChild(schedWrap);

  if (els.schedulerApplyBtn) {
    els.schedulerApplyBtn.classList.remove("is-hidden");
    els.schedulerApplyBtn.disabled = timeline.length === 0;
  }
}

async function renderLiveEventCheckinQueue() {
  return getAdminLiveRenderers().renderLiveEventCheckinQueue();
}

function closeLiveEventCheckinModal() {
  return getAdminLiveRenderers().closeLiveEventCheckinModal();
}

export function renderJudgeOptions(judges) {
  const selects = [
    els.stage1JudgeSelect,
    els.stage2JudgeSelect,
    els.stage3JudgeSelect,
    els.sightJudgeSelect,
  ].filter(Boolean);
  const validJudgeUids = new Set((judges || []).map((judge) => judge.uid));
  selects.forEach((select) => {
    const previousValue = select.value || "";
    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a judge";
    select.appendChild(placeholder);
    judges.forEach((judge) => {
      const option = document.createElement("option");
      option.value = judge.uid;
      option.textContent = judge.label;
      select.appendChild(option);
    });
    if (previousValue && validJudgeUids.has(previousValue)) {
      select.value = previousValue;
    } else {
      select.value = "";
    }
  });
}

export function renderAdminSchedule({
  entries = state.event.rosterEntries,
} = {}) {
  state.subscriptions.entryStatusMap.forEach((unsub) => unsub());
  state.subscriptions.entryStatusMap.clear();
  const sorted = [...entries].sort((a, b) => {
    const aTime = a.performanceAt?.toMillis ? a.performanceAt.toMillis() : 0;
    const bTime = b.performanceAt?.toMillis ? b.performanceAt.toMillis() : 0;
    if (aTime !== bTime) return aTime - bTime;
    const aName = (a.ensembleName || a.ensembleId || "").toLowerCase();
    const bName = (b.ensembleName || b.ensembleId || "").toLowerCase();
    return aName.localeCompare(bName);
  });

  renderAdminReadiness();
  refreshPreEventScheduleTimelineStarts(sorted);
}

export function renderAdminScheduleList(entries) {
  renderAdminSchedule({ entries });
}

function formatAdminDayOfReadOnly(entryData = {}) {
  if (!entryData || typeof entryData !== "object") {
    return "No day-of information saved yet.";
  }
  const bits = [];
  const status = entryData.status || "draft";
  bits.push(`Status: ${status === "ready" ? "Ready" : "Draft"}`);

  const repertoire = entryData.mpaSelections || entryData.repertoire || {};
  const repText = REPERTOIRE_FIELDS.map(({ key, label }) => `${label}: ${repertoire?.[key] || "—"}`).join(" · ");
  bits.push(repText);

  const instrumentation = entryData.instrumentation || {};
  const totalPerc = Number(instrumentation.totalPercussion || 0);
  if (totalPerc > 0) bits.push(`Total percussion: ${totalPerc}`);

  const seatingNotes = String(entryData.seating?.notes || "").trim();
  if (seatingNotes) bits.push(`Seating: ${seatingNotes}`);

  const percussionNotes = String(entryData.percussionNeeds?.notes || "").trim();
  if (percussionNotes) bits.push(`Percussion: ${percussionNotes}`);

  const lunch = entryData.lunchOrder || {};
  const lunchTotal = Number(lunch.pepperoniQty || 0) + Number(lunch.cheeseQty || 0);
  if (lunchTotal > 0) {
    const pickupTiming = lunch.pickupTiming === "before"
      ? "Before performance"
      : lunch.pickupTiming === "after"
        ? "After performance"
        : "Timing not set";
    bits.push(`Pizza order total: ${lunchTotal} (${pickupTiming})`);
  }

  return bits.join(" · ");
}

async function openDirectorDayOfFromAdmin({ eventId, schoolId, ensembleId }) {
  try {
    state.director.adminLaunchContext = {
      source: "admin-pre-event",
      adminView: state.admin.currentView || "preEvent",
      selectedSchoolId: state.admin.selectedSchoolId || null,
      selectedSchoolName: state.admin.selectedSchoolName || "",
      eventId: eventId || state.event.active?.id || null,
      ensembleId: ensembleId || null,
    };
    const attachResult = await attachDirectorSchool(schoolId, { persistPrimary: false });
    if (!attachResult?.ok) {
      throw new Error(attachResult?.reason || "Attach school failed.");
    }
    setDirectorEvent(eventId);
    selectDirectorEnsemble(ensembleId);
    state.director.view = "dayOfForms";
    state.director.activePath = "ensembles";
    updateDirectorAttachUI();
    renderDayOfEnsembleSelector();
    if (els.directorDayOfEnsembleSelect) {
      els.directorDayOfEnsembleSelect.value = ensembleId;
      els.directorDayOfEnsembleSelect.dispatchEvent(new Event("change"));
    }
    setTab("director", { force: true });
    if (window.location.hash !== "#director") window.location.hash = "#director";
  } catch (error) {
    state.director.adminViewSchoolId = null;
    state.director.selectedEnsembleId = null;
    state.director.entryDraft = null;
    state.director.entryRef = null;
    state.director.entryExists = false;
    state.director.adminLaunchContext = null;
    console.error("Open director day-of from admin failed", error);
    alertUser("Unable to open Director Day-of view.");
  }
}

function returnToAdminPreEventFromDirector() {
  const context = state.director.adminLaunchContext;
  if (!context || state.auth.userProfile?.role !== "admin") return;
  const targetView = resolveAdminView(
    resolveAdminDirectorReturnView(context.adminView, "preEvent"),
    {
      liveEnabled: isAdminLiveEventEnabled(),
      settingsEnabled: isAdminSettingsEnabled(),
      fallback: "preEvent",
    }
  );
  state.director.adminViewSchoolId = null;
  state.director.adminLaunchContext = null;
  state.director.activePath = null;
  state.director.view = "landing";
  state.admin.currentView = targetView;
  state.admin.selectedSchoolId = context.selectedSchoolId || null;
  state.admin.selectedSchoolName = context.selectedSchoolName || "";
  setTab("admin", { force: true });
  const targetHash = getAdminHashForView(targetView);
  if (window.location.hash !== targetHash) {
    window.location.hash = targetHash;
  }
  applyAdminView(targetView);
  if (targetView === "preEvent" && state.admin.selectedSchoolId) {
    void renderAdminSchoolDetail();
  } else if (targetView === "preEvent") {
    closeAdminSchoolDetail();
    void renderRegisteredEnsemblesList();
  }
}

async function renderAdminSchoolDetail() {
  return getAdminRenderers().renderAdminSchoolDetail();
}

async function renderAdminPacketsBySchedule() {
  return getAdminRenderers().renderAdminPacketsBySchedule();
}

export async function renderRegisteredEnsemblesList() {
  return getAdminRenderers().renderRegisteredEnsemblesList();
}

function renderMockAdminPacketPreview() {
  return getAdminMockPacketPreviewRenderer().renderMockAdminPacketPreview();
}

export function renderSubmissionCard(submission, position, { showTranscript = true } = {}) {
  const card = document.createElement("div");
  card.className = "packet-card";
  if (!submission) {
    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = JUDGE_POSITION_LABELS[position];
    const note = document.createElement("div");
    note.className = "note";
    note.textContent = "No submission yet.";
    card.appendChild(badge);
    card.appendChild(note);
    return card;
  }

  const header = document.createElement("div");
  header.className = "row";
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = JUDGE_POSITION_LABELS[position] || "Open";
  const status = document.createElement("span");
  status.className = "note";
  status.textContent = `Status: ${submission.status || "unknown"}`;
  const locked = document.createElement("span");
  locked.className = "note";
  locked.textContent = `Locked: ${submission.locked ? "yes" : "no"}`;
  header.appendChild(badge);
  header.appendChild(status);
  header.appendChild(locked);

  const judgeInfo = document.createElement("div");
  judgeInfo.className = "note";
  const judgeName = submission.judgeName || "";
  const judgeEmail = submission.judgeEmail || "";
  const judgeTitle = submission.judgeTitle || "";
  const judgeAffiliation = submission.judgeAffiliation || "";
  const judgeLabel = judgeName && judgeEmail
    ? `${judgeName} - ${judgeEmail}`
    : judgeName || judgeEmail || "Unknown judge";
  judgeInfo.textContent = `${judgeLabel}${judgeTitle ? ` - ${judgeTitle}` : ""}${judgeAffiliation ? ` - ${judgeAffiliation}` : ""}`;

  const audio = document.createElement("audio");
  audio.controls = true;
  audio.preload = "metadata";
  audio.className = "audio";
  if (submission.audioUrl) {
    audio.src = submission.audioUrl;
  }
  const supplementalAudioUrl = String(submission.supplementalAudioUrl || "").trim();

  const captionSummary = renderPacketCaptionSummary(
    submission.captions || {},
    submission.formType || FORM_TYPES.stage
  );

  const footer = document.createElement("div");
  footer.className = "note";
  footer.textContent = `Caption Total: ${submission.captionScoreTotal || 0} - Final Rating: ${submission.computedFinalRatingLabel || "N/A"}`;

  card.appendChild(header);
  card.appendChild(judgeInfo);
  card.appendChild(audio);
  if (supplementalAudioUrl) {
    const supplementalLabel = document.createElement("div");
    supplementalLabel.className = "note";
    supplementalLabel.textContent = "Supplemental Audio";
    const supplementalAudio = document.createElement("audio");
    supplementalAudio.controls = true;
    supplementalAudio.preload = "metadata";
    supplementalAudio.className = "audio";
    supplementalAudio.src = supplementalAudioUrl;
    card.appendChild(supplementalLabel);
    card.appendChild(supplementalAudio);
  }
  card.appendChild(captionSummary);
  if (showTranscript) {
    const transcript = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Transcript";
    transcript.appendChild(summary);
    const transcriptBody = document.createElement("div");
    transcriptBody.className = "note";
    transcriptBody.textContent = submission.transcript || "No transcript.";
    transcript.appendChild(transcriptBody);
    card.appendChild(transcript);
  }
  card.appendChild(footer);

  return card;
}

function renderPacketCaptionSummary(captions = {}, formType = FORM_TYPES.stage) {
  const captionSummary = document.createElement("div");
  captionSummary.className = "caption-grid";
  const template = CAPTION_TEMPLATES[formType] || CAPTION_TEMPLATES.stage || [];
  const seen = new Set();

  template.forEach(({ key, label }) => {
    seen.add(key);
    const value = captions[key] || {};
    const row = document.createElement("div");
    row.className = "caption-row";
    const gradeDisplay = `${value.gradeLetter || ""}${value.gradeModifier || ""}`;
    const title = document.createElement("strong");
    title.textContent = label || key;
    const grade = document.createElement("div");
    grade.textContent = `Grade: ${gradeDisplay || "N/A"}`;
    const comment = document.createElement("div");
    comment.textContent = value.comment || "";
    row.appendChild(title);
    row.appendChild(grade);
    row.appendChild(comment);
    captionSummary.appendChild(row);
  });

  Object.entries(captions).forEach(([key, value]) => {
    if (seen.has(key)) return;
    const row = document.createElement("div");
    row.className = "caption-row";
    const gradeDisplay = `${value?.gradeLetter || ""}${value?.gradeModifier || ""}`;
    const title = document.createElement("strong");
    title.textContent = key;
    const grade = document.createElement("div");
    grade.textContent = `Grade: ${gradeDisplay || "N/A"}`;
    const comment = document.createElement("div");
    comment.textContent = value?.comment || "";
    row.appendChild(title);
    row.appendChild(grade);
    row.appendChild(comment);
    captionSummary.appendChild(row);
  });

  return captionSummary;
}

export async function loadAdminPacketView(entry, packetPanel, eventIdOverride) {
  if (!packetPanel) return;
  packetPanel.innerHTML = "Loading packet...";
  const eventId = eventIdOverride || state.event.active?.id;
  if (!eventId) {
    packetPanel.textContent = "No active event.";
    return;
  }
  try {
    const { grade, directorName, submissions, summary } = await getPacketData({
      eventId,
      entry,
    });
    packetPanel.innerHTML = "";

    const header = document.createElement("div");
    header.className = "packet-header";
    header.textContent = `Director: ${directorName || "Unknown"} - Grade: ${
      grade || "Unknown"
    } - Overall: ${summary?.overall?.label || "N/A"}`;
    packetPanel.appendChild(header);

    const actionRow = document.createElement("div");
    actionRow.className = "actions";
    const releaseBtn = document.createElement("button");
    const shouldRelease = !summary?.requiredReleased;
    releaseBtn.textContent = shouldRelease ? "Release Packet" : "Unrelease Packet";
    releaseBtn.disabled = shouldRelease ? !summary?.requiredComplete : false;
    releaseBtn.addEventListener("click", async () => {
      if (shouldRelease) {
      await releasePacket({ eventId, ensembleId: entry.ensembleId });
    } else {
        await unreleasePacket({ eventId, ensembleId: entry.ensembleId });
      }
    });
    actionRow.appendChild(releaseBtn);
    packetPanel.appendChild(actionRow);

    const grid = document.createElement("div");
    grid.className = "packet-grid";
    Object.values(JUDGE_POSITIONS).forEach((position) => {
      const submission = submissions[position];
      const wrapper = document.createElement("div");
      wrapper.className = "packet-slot";
      wrapper.appendChild(renderSubmissionCard(submission, position));
      if (submission) {
        const lockRow = document.createElement("div");
        lockRow.className = "actions";
        const lockBtn = document.createElement("button");
        const isLocked = Boolean(submission.locked);
        lockBtn.textContent = isLocked ? "Unlock" : "Lock";
        lockBtn.className = "ghost";
        lockBtn.addEventListener("click", async () => {
          if (isLocked) {
            await unlockSubmission({
              eventId,
              ensembleId: entry.ensembleId,
              judgePosition: position,
            });
          } else {
            await lockSubmission({
              eventId,
              ensembleId: entry.ensembleId,
              judgePosition: position,
            });
          }
        });
        lockRow.appendChild(lockBtn);
        wrapper.appendChild(lockRow);
      }
      grid.appendChild(wrapper);
    });
    packetPanel.appendChild(grid);
  } catch (error) {
    console.error("Failed to load packet view", error);
    packetPanel.textContent = "Unable to load packet details.";
  }
}

function renderDirectorPacketAssetsSection(group, wrapper) {
  return getDirectorPacketRenderers().renderDirectorPacketAssetsSection(group, wrapper);
}

export function renderDirectorPackets(groups) {
  return getDirectorPacketRenderers().renderDirectorPackets(groups || []);
}

export function renderDirectorEnsembles(ensembles) {
  return getDirectorEnsembleRenderer()(ensembles || []);
}

export function bindAdminHandlers() {
  return getAdminHandlerBinder()();
}

export function bindJudgeOpenHandlers() {
  return getJudgeOpenHandlerBinder()();
}

function gatherOpenPacketMeta() {
  const existing = state.judgeOpen.selectedExisting || {};
  const mode = state.judgeOpen.mode === "official" ? "official" : "practice";
  const officialEventId =
    mode === "official"
      ? String(
          state.judgeOpen.currentPacket?.officialEventId ||
            state.judgeOpen.currentPacket?.assignmentEventId ||
            state.judgeOpen.activeEventAssignment?.eventId ||
            ""
        ).trim()
      : "";
  const officialJudgePosition =
    mode === "official"
      ? String(
          state.judgeOpen.currentPacket?.officialJudgePosition ||
            state.judgeOpen.currentPacket?.judgePosition ||
            state.judgeOpen.activeEventAssignment?.judgePosition ||
            ""
        ).trim()
      : "";
  return {
    mode,
    schoolName: existing.schoolName || "",
    ensembleName: existing.ensembleName || "",
    schoolId: existing.schoolId || "",
    ensembleId: existing.ensembleId || "",
    officialEventId,
    officialJudgePosition,
    ensembleSnapshot: buildOpenEnsembleSnapshot(),
    directorEntrySnapshot:
      state.judgeOpen.directorEntryReferenceStatus === "loaded"
        ? state.judgeOpen.directorEntryReference
        : null,
    formType: els.judgeOpenFormTypeSelect?.value || "stage",
  };
}

function buildOpenEnsembleSnapshot() {
  const schoolId = state.judgeOpen.selectedExisting?.schoolId || "";
  const schoolName = state.judgeOpen.selectedExisting?.schoolName || "";
  const ensembleId = state.judgeOpen.selectedExisting?.ensembleId || "";
  const ensembleName = state.judgeOpen.selectedExisting?.ensembleName || "";
  if (!schoolId || !ensembleId) return null;
  return {
    schoolId,
    schoolName,
    ensembleId,
    ensembleName,
  };
}

function applyOpenCaptionDraft({ captions = {}, overwrite = false } = {}) {
  const template = getOpenCaptionTemplate();
  let appliedCount = 0;
  let skippedExistingCount = 0;
  let emptyCaptionCount = 0;

  template.forEach(({ key }) => {
    const text = String(captions[key] || "").trim();
    if (!text) {
      emptyCaptionCount += 1;
      return;
    }
    const existing = state.judgeOpen.captions[key]?.comment || "";
    if (!overwrite && existing) {
      skippedExistingCount += 1;
      return;
    }
    if (!state.judgeOpen.captions[key]) {
      state.judgeOpen.captions[key] = {
        gradeLetter: "",
        gradeModifier: "",
        comment: "",
      };
    }
    state.judgeOpen.captions[key].comment = text;
    appliedCount += 1;
  });
  if (appliedCount > 0) {
    applyOpenCaptionState();
    markJudgeOpenDirty();
  }
  return {
    appliedCount,
    skippedExistingCount,
    emptyCaptionCount,
  };
}

function updateOpenRecordingStatus() {
  return getJudgeOpenCore().updateOpenRecordingStatus();
}

export function bindDirectorHandlers() {
  return getDirectorHandlerBinder()();
}

export function bindAppHandlers() {
  return getAppHandlerBinder()();
}
